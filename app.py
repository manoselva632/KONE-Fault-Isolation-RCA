import csv
import io
import ipaddress
import json
import os
import threading
import time

import requests
from flask import Flask, Response, jsonify, render_template, request

import config
from components import evaluate_components
from diagnosis import DiagnosisEngine, answer_question
from esp32_client import ESP32Client
from simulator import RuntimeState


def _read_json(path):
    with open(path, "r", encoding="utf-8") as file:
        return json.load(file)


def create_app():
    component_data = _read_json(config.COMPONENT_DATA_PATH)
    fault_database = _read_json(config.FAULT_DATABASE_PATH)
    app = Flask(__name__)
    app.config["JSON_SORT_KEYS"] = False

    runtime = RuntimeState(component_data)
    esp32 = ESP32Client(runtime)
    esp32.set_ip("10.255.116.32")
    diagnosis = DiagnosisEngine(fault_database)
    app.extensions["runtime_state"] = runtime
    app.extensions["esp32_client"] = esp32
    app.extensions["component_data"] = component_data
    app.extensions["fault_database"] = fault_database

    def current_state():
        snapshot = runtime.snapshot()
        components = evaluate_components(component_data, snapshot)
        reports = diagnosis.diagnose(components, snapshot)
        active = [report for report in reports if report["status"] == "Active"]
        counts = {
            "total": len(components),
            "normal": sum(row["status"] == "NORMAL" for row in components),
            "warning": sum(row["status"] == "WARNING" for row in components),
            "faulty": sum(row["status"] == "FAULT" for row in components),
            "offline": sum(row["status"] == "OFFLINE" for row in components),
        }
        elevator = snapshot["elevator"]
        movement_status = elevator["status"]
        if active and not movement_status.startswith("Moving"):
            movement_status = "Fault Detected"
        fault_options = []
        for component_id, fault_map in fault_database["injection_faults"].items():
            definition = next((item for item in component_data["components"] if item["id"] == component_id), None)
            if definition:
                fault_options.append({
                    "component_id": component_id,
                    "component": definition["name"],
                    "faults": [
                        {"id": fault_id, "label": fault["label"]}
                        for fault_id, fault in fault_map.items()
                    ],
                })
        return {
            "timestamp": snapshot["live"]["last_update"],
            "mode": snapshot["mode"],
            "mode_label": "LIVE + SIM (HYBRID)" if snapshot["mode"] == "hybrid" else "SIMULATION ONLY",
            "components": components,
            "summary": {
                **counts,
                "active_fault_count": len(active),
                "current_floor": round(elevator["position"], 2),
                "floor_label": "Ground" if round(elevator["position"]) == 0 else str(round(elevator["position"])),
                "movement_status": movement_status,
            },
            "elevator": {**elevator, "display_status": movement_status},
            "esp32": {
                "connected": snapshot["live"]["connected"],
                "ip": snapshot["live"]["ip"],
                "last_update": snapshot["live"]["last_update"],
                "latency_ms": snapshot["live"]["latency_ms"],
                "last_error": snapshot["live"]["last_error"],
            },
            "reports": reports,
            "active_reports": active,
            "events": snapshot["events"],
            "fault_options": fault_options,
            "disclaimer": "Educational simulation and diagnostic-support prototype only; not a certified elevator safety system.",
        }

    def require_json_object():
        body = request.get_json()
        if not isinstance(body, dict):
            raise ValueError("Request body must be a JSON object.")
        return body

    @app.get("/")
    def index():
        return render_template("index.html")

    @app.get("/sentiniq")
    @app.get("/sentiniq/<path:filename>")
    def sentiniq(filename="index.html"):
        from flask import send_from_directory
        sentiniq_dir = os.path.join(os.path.dirname(__file__), "sentiniq-dashboard")
        return send_from_directory(sentiniq_dir, filename)

    @app.get("/api/state")
    def api_state():
        return jsonify(current_state())

    @app.post("/api/mode")
    def api_mode():
        body = require_json_object()
        mode = body.get("mode")
        if mode not in ("hybrid", "simulation"):
            return jsonify(error="mode must be 'hybrid' or 'simulation'"), 400
        runtime.set_mode(mode)
        return jsonify(current_state())

    @app.post("/api/esp32/settings")
    def api_esp32_settings():
        body = require_json_object()
        address = body.get("ip")
        if not isinstance(address, str):
            return jsonify(error="ip must be a valid IPv4 address."), 400
        try:
            parsed = ipaddress.ip_address(address.strip())
        except ValueError:
            return jsonify(error="ip must be a valid IPv4 address."), 400
        if parsed.version != 4:
            return jsonify(error="Only an IPv4 address is supported."), 400
        esp32.set_ip(str(parsed))
        return jsonify(current_state())

    @app.post("/api/esp32/test")
    def api_esp32_test():
        try:
            payload = esp32.test_connection()
        except (requests.RequestException, ValueError) as error:
            esp32._mark_disconnected(str(error))
            return jsonify(error="ESP32 connection test failed: " + str(error)), 502
        return jsonify(
            connected=True,
            message="Valid sensor data received.",
            readings=payload,
            state=current_state(),
        )

    @app.post("/api/esp32/reset")
    def api_esp32_reset():
        try:
            response_text = esp32.reset_door_count()
        except requests.RequestException as error:
            esp32._mark_disconnected(str(error))
            return jsonify(error="ESP32 door count reset failed: " + str(error)), 502
        return jsonify(message="Door obstruction count reset.", response=response_text, state=current_state())

    @app.post("/api/faults/inject")
    def api_fault_inject():
        body = require_json_object()
        component_id = body.get("component_id")
        fault_id = body.get("fault_id")
        fault = fault_database.get("injection_faults", {}).get(component_id, {}).get(fault_id)
        if not fault:
            return jsonify(error="Choose a supported component and fault."), 400
        runtime.inject_fault(component_id, fault_id, fault)
        return jsonify(current_state())

    @app.post("/api/faults/reset")
    def api_fault_reset():
        runtime.reset_faults()
        return jsonify(current_state())

    @app.post("/api/simulation/normal")
    def api_simulation_normal():
        runtime.normal_simulation(component_data["simulation_defaults"])
        return jsonify(current_state())

    def movement_block_reason(snapshot):
        rows = evaluate_components(component_data, snapshot)
        critical = [
            row["name"] for row in rows
            if row["status"] == "FAULT" and row["severity"] == "CRITICAL"
        ]
        if critical:
            return "Movement is blocked in the simulation by critical findings: " + ", ".join(critical) + "."
        return None

    @app.post("/api/elevator/move")
    def api_elevator_move():
        body = require_json_object()
        direction = body.get("direction")
        if direction not in ("up", "down"):
            return jsonify(error="direction must be 'up' or 'down'."), 400
        snapshot = runtime.snapshot()
        reason = movement_block_reason(snapshot)
        if reason:
            return jsonify(error=reason), 409
        if snapshot["elevator"]["door_open"]:
            return jsonify(error="Close the simulated doors before moving."), 409
        runtime.request_direction(direction)
        return jsonify(current_state())

    @app.post("/api/elevator/floor")
    def api_elevator_floor():
        body = require_json_object()
        floor = body.get("floor")
        if isinstance(floor, bool) or not isinstance(floor, int) or not 0 <= floor <= 5:
            return jsonify(error="floor must be an integer from 0 through 5."), 400
        snapshot = runtime.snapshot()
        reason = movement_block_reason(snapshot)
        if reason:
            return jsonify(error=reason), 409
        if snapshot["elevator"]["door_open"]:
            return jsonify(error="Close the simulated doors before moving."), 409
        runtime.request_floor(floor)
        return jsonify(current_state())

    @app.post("/api/elevator/door")
    def api_elevator_door():
        body = require_json_object()
        action = body.get("action")
        if action not in ("open", "close"):
            return jsonify(error="action must be 'open' or 'close'."), 400
        snapshot = runtime.snapshot()
        if snapshot["elevator"]["target"] is not None:
            return jsonify(error="Wait for the simulated car to stop before operating the doors."), 409
        if action == "close" and snapshot["mode"] == "hybrid":
            payload = snapshot["live"]["payload"]
            if snapshot["live"]["connected"] and payload and payload["ir"] == 1:
                return jsonify(error="Door Blocked: live IR sensor reports an obstruction."), 409
        runtime.set_door(action == "open")
        return jsonify(current_state())

    @app.get("/api/report")
    def api_report():
        reports = current_state()["reports"]
        file_format = request.args.get("format", "json").lower()
        if file_format == "json":
            return Response(
                json.dumps(reports, indent=2, ensure_ascii=False),
                mimetype="application/json",
                headers={"Content-Disposition": "attachment; filename=elevator-fault-report.json"},
            )
        if file_format == "csv":
            output = io.StringIO()
            fields = [
                "fault_id", "component", "detected_fault", "sensor_reading", "data_source",
                "expected_range", "severity", "possible_root_causes", "supporting_evidence",
                "recommended_inspection_steps", "timestamp", "last_updated", "status", "resolved_at",
            ]
            writer = csv.DictWriter(output, fieldnames=fields)
            writer.writeheader()
            for report in reports:
                row = dict(report)
                for field in ("possible_root_causes", "supporting_evidence", "recommended_inspection_steps"):
                    row[field] = json.dumps(row.get(field, []), ensure_ascii=False)
                writer.writerow({field: row.get(field, "") for field in fields})
            return Response(
                output.getvalue(),
                mimetype="text/csv",
                headers={"Content-Disposition": "attachment; filename=elevator-fault-report.csv"},
            )
        return jsonify(error="format must be json or csv."), 400

    @app.post("/api/chat")
    def api_chat():
        body = require_json_object()
        question = body.get("question")
        if not isinstance(question, str) or not question.strip() or len(question) > 1000:
            return jsonify(error="question must be a non-empty string of at most 1000 characters."), 400
        state = runtime.snapshot()
        components = evaluate_components(component_data, state)
        reports = diagnosis.diagnose(components, state)
        return jsonify(answer=answer_question(question, components, reports, state))

    @app.errorhandler(400)
    def bad_request(error):
        return jsonify(error="Invalid request: " + (getattr(error, "description", "bad request"))), 400

    @app.errorhandler(404)
    def not_found(_error):
        return jsonify(error="Route not found."), 404

    @app.errorhandler(500)
    def server_error(_error):
        app.logger.exception("Unhandled server error")
        return jsonify(error="Internal server error. Check the Flask log for details."), 500

    def monitor_loop():
        while True:
            snapshot = runtime.snapshot()
            rows = evaluate_components(component_data, snapshot)
            diagnosis.diagnose(rows, snapshot)
            time.sleep(config.POLL_INTERVAL)

    app.extensions["monitor_loop"] = monitor_loop
    return app


app = create_app()


def _run_simulation(state):
    while True:
        state.tick()
        time.sleep(config.STATE_POLL_INTERVAL)


if __name__ == "__main__":
    app.extensions["esp32_client"].start()

    monitor = threading.Thread(
        target=app.extensions["monitor_loop"],
        name="diagnosis-monitor",
        daemon=True,
    )
    monitor.start()

    movement = threading.Thread(
        target=lambda: _run_simulation(app.extensions["runtime_state"]),
        name="elevator-simulation",
        daemon=True,
    )
    movement.start()

    app.run(
        host="0.0.0.0",
        port=5000,
        debug=False,
        use_reloader=False,
        threaded=True,
    )


