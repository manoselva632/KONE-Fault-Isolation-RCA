def _record(definition, reading, source, status="NORMAL", severity=None,
            fault_type=None, description=None, normal_range=None, evidence=None):
    return {
        "id": definition["id"],
        "name": definition["name"],
        "reading": reading,
        "unit": definition["unit"],
        "source": source,
        "normal_range": normal_range or definition["normal_range"],
        "status": status,
        "severity": severity,
        "fault_type": fault_type,
        "description": description or definition["description"],
        "root_causes": [],
        "recommended_checks": [],
        "supporting_evidence": evidence or [],
        "injected": False,
        "updated_at": None,
    }


def evaluate_components(component_data, state):
    thresholds = component_data["thresholds"]
    live_mode = state["mode"] == "hybrid"
    live = state["live"]
    payload = live["payload"] if live_mode and live["connected"] else None
    sim = state["sim_readings"]
    definitions = component_data["components"]
    records = []

    for definition in definitions:
        component_id = definition["id"]
        if component_id == "traction_motor":
            if definition["source"] == "live" and live_mode:
                if payload is None:
                    row = _record(definition, "No live data", "LIVE ESP32", "OFFLINE",
                                  description="ESP32 is disconnected; live motor-temperature data is unavailable.")
                elif payload["dhtOk"] == 0:
                    row = _record(definition, "DHT11 read failed", "LIVE ESP32", "FAULT", "CRITICAL",
                                  "sensor_communication", "DHT11 communication fault.")
                    row["unit"] = ""
                else:
                    value = payload["temp"]
                    row = _record(definition, round(value, 1), "LIVE ESP32")
                    band = thresholds["machine_room_temperature_c"]
                    if value >= band["critical_min"]:
                        row.update(status="FAULT", severity="CRITICAL", fault_type="motor_overtemperature",
                                   description="Machine-room temperature is at or above the critical threshold.")
                    elif value >= band["warning_min"]:
                        row.update(status="WARNING", severity="WARNING", fault_type="motor_temperature_high",
                                   description="Machine-room temperature is at or above the warning threshold.")
                    row["updated_at"] = live["last_update"]
            else:
                value = sim["traction_motor"]
                row = _record(definition, value, "SIMULATED")
                band = thresholds["machine_room_temperature_c"]
                if value >= band["critical_min"]:
                    row.update(status="FAULT", severity="CRITICAL", fault_type="motor_overtemperature",
                               description="Illustrative motor temperature is at or above the critical threshold.")
                elif value >= band["warning_min"]:
                    row.update(status="WARNING", severity="WARNING", fault_type="motor_temperature_high",
                               description="Illustrative motor temperature is at or above the warning threshold.")
        elif component_id == "door_sensor":
            if live_mode and payload is None:
                row = _record(definition, "No live data", "LIVE ESP32", "OFFLINE",
                              description="ESP32 is disconnected; live IR door-sensor data is unavailable.")
            else:
                ir = payload["ir"] if live_mode else sim["door_sensor"]["ir"]
                seconds = payload["doorSec"] if live_mode else sim["door_sensor"]["blocked_seconds"]
                count = payload["count"] if live_mode else sim["door_sensor"]["count"]
                row = _record(definition, ("BLOCKED " if ir else "CLEAR ") + str(seconds) + " s",
                              "LIVE ESP32" if live_mode else "SIMULATED")
                row.update(value=seconds, blocked=bool(ir), count=count,
                           normal_range="CLEAR / blocked < " + str(thresholds["door_blocked_seconds"]["warning_min"]) + " s")
                row["diagnosis_reading"] = ("BLOCKED " if ir else "CLEAR ") + str(seconds)
                row["diagnosis_unit"] = "s"
                band = thresholds["door_blocked_seconds"]
                if ir and seconds >= band["critical_min"]:
                    row.update(status="FAULT", severity="CRITICAL", fault_type="door_obstruction_timeout",
                               description="Door obstruction input has remained blocked beyond the critical duration.")
                elif ir and seconds >= band["warning_min"]:
                    row.update(status="WARNING", severity="WARNING", fault_type="door_obstruction",
                               description="Door obstruction input has remained blocked beyond the warning duration.")
                row["updated_at"] = live["last_update"] if live_mode else None
        elif component_id == "position_sensor":
            if live_mode and payload is None:
                row = _record(definition, "No live data", "LIVE ESP32", "OFFLINE",
                              description="ESP32 is disconnected; live ultrasonic distance is unavailable.")
            else:
                value = payload["distance"] if live_mode else sim["position_sensor"]
                row = _record(definition, "No echo" if value == -1 else round(value, 1),
                              "LIVE ESP32" if live_mode else "SIMULATED")
                row["updated_at"] = live["last_update"] if live_mode else None
                band = thresholds["position_clearance_cm"]
                if value == band["no_echo"]:
                    row.update(status="FAULT", severity="CRITICAL", fault_type="position_no_echo",
                               description="Ultrasonic sensor returned no echo.")
                    row["diagnosis_reading"] = "No echo"
                    row["diagnosis_unit"] = ""
                elif value <= band["critical_max"]:
                    row.update(status="FAULT", severity="CRITICAL", fault_type="position_clearance_critical",
                               description="Car-top clearance is at or below the critical threshold.")
                elif value <= band["warning_max"]:
                    row.update(status="WARNING", severity="WARNING", fault_type="position_clearance_low",
                               description="Car-top clearance is at or below the warning threshold.")
        elif component_id in ("motor_brake", "door_motor", "limit_switch", "overload_sensor",
                               "safety_relay", "power_supply", "elevator_controller"):
            key = {
                "motor_brake": "motor_brake",
                "door_motor": "door_motor",
                "limit_switch": "limit_switch",
                "overload_sensor": "overload_sensor",
                "safety_relay": "safety_relay",
                "power_supply": "power_supply",
                "elevator_controller": "elevator_controller",
            }[component_id]
            value = sim[key]
            row = _record(definition, value, "SIMULATED")
            if component_id == "door_motor" and isinstance(value, (int, float)) and value > 1.2:
                row.update(status="WARNING", severity="WARNING", fault_type="door_motor_current_high",
                           description="Illustrative door-operator current is above its normal range.")
            elif component_id == "overload_sensor" and isinstance(value, (int, float)):
                if value >= 90:
                    row.update(status="FAULT", severity="CRITICAL", fault_type="overload_critical",
                               description="Illustrative load is at or above the simulation's critical threshold.")
                elif value >= 80:
                    row.update(status="WARNING", severity="WARNING", fault_type="overload_high",
                               description="Illustrative load is at or above the simulation's warning threshold.")
            elif component_id == "power_supply" and isinstance(value, (int, float)):
                if value < 20 or value > 28:
                    row.update(status="FAULT", severity="CRITICAL", fault_type="power_voltage_critical",
                               description="Illustrative supply voltage is outside its critical range.")
                elif value < 22 or value > 26:
                    row.update(status="WARNING", severity="WARNING", fault_type="power_voltage_warning",
                               description="Illustrative supply voltage is outside its normal range.")
            if component_id in ("power_supply", "elevator_controller") and live_mode and payload is not None:
                humidity = payload["hum"] if payload["dhtOk"] else None
                if humidity is not None:
                    row["supporting_evidence"].append({
                        "reading": round(humidity, 1),
                        "unit": "%",
                        "source": "LIVE ESP32",
                        "description": "Machine-room humidity; elevated humidity can support a condensation-risk hypothesis.",
                    })
                    humidity_band = thresholds["machine_room_humidity_percent"]
                    if humidity >= humidity_band["warning_min"]:
                        row["supporting_evidence"].append({
                            "reading": round(humidity, 1),
                            "unit": "%",
                            "source": "LIVE ESP32",
                            "description": "Humidity is above the configured warning threshold.",
                        })
                    if humidity >= humidity_band["critical_min"] and row["status"] == "NORMAL":
                        row.update(status="FAULT", severity="CRITICAL", fault_type="condensation_risk",
                                   description="High live humidity exceeds the critical threshold; review condensation risk.")
                        row["diagnosis_reading"] = round(humidity, 1)
                        row["diagnosis_unit"] = "%"
                        row["diagnosis_source"] = "LIVE ESP32"
                        row["diagnosis_normal_range"] = (
                            "Below " + str(humidity_band["warning_min"]) +
                            "%; warning at or above " + str(humidity_band["warning_min"]) +
                            "%, critical at or above " + str(humidity_band["critical_min"]) + "%"
                        )
                    elif humidity >= humidity_band["warning_min"] and row["status"] == "NORMAL":
                        row.update(status="WARNING", severity="WARNING", fault_type="condensation_risk",
                                   description="High live humidity is supporting evidence for a condensation-risk review.")
                        row["diagnosis_reading"] = round(humidity, 1)
                        row["diagnosis_unit"] = "%"
                        row["diagnosis_source"] = "LIVE ESP32"
                        row["diagnosis_normal_range"] = (
                            "Below " + str(humidity_band["warning_min"]) +
                            "%; warning at or above " + str(humidity_band["warning_min"]) +
                            "%, critical at or above " + str(humidity_band["critical_min"]) + "%"
                        )
                    row["updated_at"] = live["last_update"]
        else:
            continue

        injected = state["injected_faults"].get(component_id)
        if injected:
            fault = injected["fault"]
            row.pop("diagnosis_reading", None)
            row.pop("diagnosis_unit", None)
            row.pop("diagnosis_source", None)
            row.pop("diagnosis_normal_range", None)
            live_value = None
            if payload is not None:
                live_value = {
                    "traction_motor": payload["temp"],
                    "door_sensor": payload["doorSec"],
                    "position_sensor": payload["distance"],
                }.get(component_id)
            row.update(
                reading=fault["reading"],
                unit=fault["unit"],
                source="SIMULATED OVERRIDE",
                status="FAULT",
                severity=fault["severity"],
                fault_type=injected["fault_id"],
                description=fault["problem"] + " This is an injected simulated override.",
                injected=True,
                injected_at=injected["injected_at"],
                live_reading=live_value,
            )
        records.append(row)

    return records
