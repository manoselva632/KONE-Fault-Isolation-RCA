import threading
from datetime import datetime, timezone


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class DiagnosisEngine:
    def __init__(self, fault_database):
        self.fault_database = fault_database
        self._active = {}
        self._history = []
        self._next_id = 1
        self._lock = threading.RLock()

    def diagnose(self, rows, state):
        with self._lock:
            return self._diagnose(rows, state)

    def _diagnose(self, rows, state):
        by_id = {row["id"]: row for row in rows}
        live_payload = state["live"]["payload"] if state["live"]["connected"] else None
        humidity = live_payload.get("hum") if live_payload and live_payload.get("dhtOk") else None

        for row in rows:
            if row["status"] in ("WARNING", "FAULT"):
                self._enrich(row)

        door = by_id.get("door_sensor")
        door_motor = by_id.get("door_motor")
        if door and door["status"] in ("WARNING", "FAULT") and door_motor:
            if door_motor["status"] in ("WARNING", "FAULT") or (
                isinstance(door_motor["reading"], (int, float)) and door_motor["reading"] > 1.2
            ):
                evidence = "Door obstruction coincides with elevated door-motor current."
                door["supporting_evidence"].append(evidence)
                door["root_causes"] = self._unique(door["root_causes"] + [
                    "Door obstruction or door-operator friction"
                ])
                door_motor["supporting_evidence"].append(
                    "Door sensor reports a continuing obstruction at the same time."
                )
                door_motor["root_causes"] = self._unique(door_motor["root_causes"] + [
                    "Door obstruction or door-operator friction"
                ])

        position = by_id.get("position_sensor")
        limit_switch = by_id.get("limit_switch")
        if position and position["status"] in ("WARNING", "FAULT") and limit_switch:
            if limit_switch["status"] in ("WARNING", "FAULT"):
                evidence = "Low/no-echo position indication coincides with a limit-switch indication fault."
                position["supporting_evidence"].append(evidence)
                position["root_causes"] = self._unique(position["root_causes"] + [
                    "Overtravel risk requires qualified investigation"
                ])
                limit_switch["supporting_evidence"].append(
                    "Position sensor also reports low clearance or no echo."
                )

        motor = by_id.get("traction_motor")
        if motor and humidity is not None and humidity >= 70 and motor["status"] in ("WARNING", "FAULT"):
            motor["supporting_evidence"].append(
                "Live machine-room humidity is " + str(round(humidity, 1)) + "%."
            )
            motor["root_causes"] = self._unique(motor["root_causes"] + [
                "Ventilation or condensation conditions"
            ])

        active_now = {}
        for row in rows:
            if row["status"] not in ("WARNING", "FAULT"):
                continue
            identity = (row["id"], row.get("fault_type") or row["status"])
            active_now[identity] = row

        for identity, report in list(self._active.items()):
            if identity not in active_now:
                report["status"] = "Resolved"
                report["resolved_at"] = _now()
                self._history.insert(0, report)
                del self._active[identity]

        for identity, row in active_now.items():
            report = self._active.get(identity)
            if report is None:
                report = {
                    "fault_id": "F-" + str(self._next_id).zfill(5),
                    "component_id": row["id"],
                    "component": row["name"],
                    "detected_fault": row.get("fault_type") or row["description"],
                    "sensor_reading": self._reading(row),
                    "data_source": row.get("diagnosis_source", row["source"]),
                    "expected_range": row.get("diagnosis_normal_range", row["normal_range"]),
                    "severity": row["severity"] or "WARNING",
                    "possible_root_causes": list(row["root_causes"]),
                    "supporting_evidence": list(row["supporting_evidence"]),
                    "recommended_inspection_steps": list(row["recommended_checks"]),
                    "timestamp": _now(),
                    "last_updated": _now(),
                    "status": "Active",
                    "resolved_at": None,
                    "injected": row["injected"],
                }
                self._next_id += 1
                self._active[identity] = report
            else:
                report.update({
                    "sensor_reading": self._reading(row),
                    "data_source": row.get("diagnosis_source", row["source"]),
                    "expected_range": row.get("diagnosis_normal_range", row["normal_range"]),
                    "severity": row["severity"] or "WARNING",
                    "possible_root_causes": list(row["root_causes"]),
                    "supporting_evidence": list(row["supporting_evidence"]),
                    "recommended_inspection_steps": list(row["recommended_checks"]),
                    "last_updated": _now(),
                    "injected": row["injected"],
                })
            row["fault_id"] = report["fault_id"]

        self._history = self._history[:250]
        reports = list(self._active.values()) + self._history
        reports.sort(key=lambda item: item["timestamp"], reverse=True)
        return reports

    def _enrich(self, row):
        if row["injected"]:
            template = self.fault_database.get("injection_faults", {}).get(row["id"], {}).get(
                row["fault_type"], {}
            )
        else:
            template = self.fault_database.get("diagnosis_templates", {}).get(row["fault_type"], {})
        row["root_causes"] = list(template.get("root_causes", []))
        row["recommended_checks"] = list(template.get("checks", []))
        if not row["root_causes"]:
            row["root_causes"] = ["Sensor, wiring, or component condition requires verification."]
        if not row["recommended_checks"]:
            row["recommended_checks"] = [
                "Review this educational prototype's readings and event history.",
                "Use approved service procedures and qualified personnel for real equipment.",
            ]

    @staticmethod
    def _unique(values):
        result = []
        for value in values:
            if value not in result:
                result.append(value)
        return result

    @staticmethod
    def _reading(row):
        if row["id"] == "door_sensor":
            return str(row.get("diagnosis_reading", row["reading"])) + (
                " " + str(row.get("diagnosis_unit", row["unit"]))
                if row.get("diagnosis_unit", row["unit"]) else ""
            )
        value = row.get("diagnosis_reading", row["reading"])
        unit = row.get("diagnosis_unit", row.get("unit"))
        return str(value) + (" " + str(unit) if unit else "")


def answer_question(question, rows, reports, state):
    text = " ".join(question.lower().replace("-", " ").split())
    by_id = {row["id"]: row for row in rows}
    active_reports = [item for item in reports if item["status"] == "Active"]
    fault_rows = [row for row in rows if row["status"] in ("WARNING", "FAULT")]
    normal_rows = [row for row in rows if row["status"] == "NORMAL"]

    if any(word in text for word in ("complete fault report", "fault report", "report")):
        if not active_reports:
            return "There are no active findings to include in a report."
        return "Active report: " + "; ".join(
            item["fault_id"] + " " + item["component"] + " — " + item["detected_fault"] +
            ", reading " + item["sensor_reading"] + ", source " + item["data_source"] +
            ", cause candidates: " + ", ".join(item["possible_root_causes"])
            for item in active_reports
        )
    if any(word in text for word in ("normal component", "working normally", "which components are normal")):
        return "Normal components: " + (
            ", ".join(row["name"] for row in normal_rows) if normal_rows else "none currently."
        )
    if any(word in text for word in ("all fault", "faulty component", "which component", "active fault")):
        if not fault_rows:
            return "There are no active warnings or faults in the current readings."
        return "Current findings: " + "; ".join(
            row["name"] + " — " + row["status"] + " (" + (row["severity"] or "WARNING") +
            "): " + row["description"] for row in fault_rows
        )
    if any(word in text for word in ("root cause", "cause", "troubleshoot", "check")):
        if not active_reports:
            return "There are no active findings with root-cause candidates. All current readings are normal or offline."
        return "; ".join(
            item["component"] + ": possible causes are " + ", ".join(item["possible_root_causes"]) +
            ". Recommended checks: " + "; ".join(item["recommended_inspection_steps"])
            for item in active_reports
        )
    if any(word in text for word in ("esp32", "connected", "live reading", "which readings are live")):
        live = state["live"]
        if "which readings" in text or "live reading" in text:
            live_names = [row["name"] for row in rows if row["source"] == "LIVE ESP32"]
            return "Live-backed components in the current mode: " + (
                ", ".join(live_names) if live_names else "none (Simulation Only mode)."
            ) + ("." if live_names else "")
        if state["mode"] != "hybrid":
            return "The dashboard is in Simulation Only mode. ESP32 polling status is " + (
                "connected" if live["connected"] else "disconnected"
            ) + "."
        message = "ESP32 is " + ("connected" if live["connected"] else "disconnected")
        if live["last_update"]:
            message += "; last valid update " + live["last_update"]
        if live["latency_ms"] is not None:
            message += "; latency " + str(round(live["latency_ms"])) + " ms"
        return message + "."
    if any(word in text for word in ("why", "not moving", "not move")) and (
        "move" in text or "elevator" in text
    ):
        critical = [row["name"] for row in fault_rows if row["severity"] == "CRITICAL"]
        if critical:
            return "The simulation blocks elevator movement while critical findings are active: " + ", ".join(critical) + "."
        if state["elevator"]["door_open"]:
            return "The simulation will not move while its doors are open. Close the simulated doors first."
        if state["elevator"]["target"] is None:
            return "The elevator simulation is idle; choose a floor or use UP/DOWN. No real elevator is controlled."
        return "The elevator simulation is moving; current status: " + state["elevator"]["status"] + "."
    if "brake" in text:
        return _component_answer(by_id.get("motor_brake"))
    if "door motor" in text:
        return _component_answer(by_id.get("door_motor"))
    if "temperature" in text or "hot" in text or "motor" in text:
        row = by_id.get("traction_motor")
        return _component_answer(row)
    if "humidity" in text or "humid" in text or "condensation" in text:
        live = state["live"]
        if state["mode"] == "hybrid" and live["connected"] and live["payload"]:
            payload = live["payload"]
            if not payload["dhtOk"]:
                return "The DHT11 reported a communication failure, so humidity is unavailable."
            value = payload["hum"]
            threshold = 85 if value >= 85 else 70 if value >= 70 else None
            finding = " It is above the " + ("critical" if threshold == 85 else "warning") + " threshold." if threshold else " It is within configured thresholds."
            return "Machine-room humidity is " + str(round(value, 1)) + "% (LIVE ESP32)." + finding
        if state["mode"] == "simulation":
            return "Illustrative simulated machine-room humidity is " + str(state["sim_readings"]["humidity"]) + "% (not a certified measurement)."
        return "Live humidity is unavailable in the current state; the configured mode is " + state["mode"] + "."
    if any(word in text for word in ("clearance", "position", "ultrasonic", "distance")):
        return _component_answer(by_id.get("position_sensor"))
    if any(word in text for word in ("door", "ir", "obstruction")):
        return _component_answer(by_id.get("door_sensor"))
    component_terms = {
        "motor brake": "motor_brake",
        "brake": "motor_brake",
        "door motor": "door_motor",
        "limit switch": "limit_switch",
        "overload": "overload_sensor",
        "safety relay": "safety_relay",
        "power supply": "power_supply",
        "controller": "elevator_controller",
        "relay": "safety_relay",
    }
    for term, component_id in component_terms.items():
        if term in text:
            return _component_answer(by_id.get(component_id))
    return (
        "I answer from the current dashboard state and diagnosis only. Try: "
        "\"Which components have faults?\", \"Why is the elevator not moving?\", "
        "\"What is the motor temperature?\", \"What is the car top clearance?\", "
        "\"Is the door blocked?\", or \"Is the ESP32 connected?\""
    )


def _component_answer(row):
    if not row:
        return "That component is not available in the current state."
    status = row["status"]
    unit = "" if row["id"] == "door_sensor" or row["reading"] == "No echo" else " " + str(row["unit"])
    return (
        row["name"] + " reading is " + str(row["reading"]) + unit +
        " (" + row["source"] + "); status " + status +
        (": " + row["description"] if status != "NORMAL" else ".")
    )
