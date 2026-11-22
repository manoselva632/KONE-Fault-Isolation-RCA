import copy
import threading
import time
from datetime import datetime, timezone

import config


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class RuntimeState:
    def __init__(self, component_data):
        self.lock = threading.RLock()
        defaults = component_data["simulation_defaults"]
        self.mode = "hybrid"
        self.sim_readings = copy.deepcopy(defaults)
        self.injected_faults = {}
        self.live = {
            "connected": False,
            "payload": None,
            "last_update": None,
            "latency_ms": None,
            "last_error": None,
            "ip": config.ESP32_IP,
        }
        self.events = []
        self.elevator = {
            "position": 0.0,
            "target": None,
            "door_open": False,
            "status": "Idle",
            "updated_at": utc_now(),
        }
        self._last_tick = time.monotonic()

    def log(self, message, event_type="info"):
        with self.lock:
            self.events.insert(0, {
                "timestamp": utc_now(),
                "type": event_type,
                "message": message,
            })
            del self.events[100:]

    def snapshot(self):
        with self.lock:
            return {
                "mode": self.mode,
                "sim_readings": copy.deepcopy(self.sim_readings),
                "injected_faults": copy.deepcopy(self.injected_faults),
                "live": copy.deepcopy(self.live),
                "events": copy.deepcopy(self.events),
                "elevator": copy.deepcopy(self.elevator),
            }

    def set_mode(self, mode):
        with self.lock:
            self.mode = mode
            self.log("Data mode changed to " + ("LIVE + SIM (HYBRID)" if mode == "hybrid" else "SIMULATION ONLY"))

    def inject_fault(self, component_id, fault_id, fault):
        with self.lock:
            self.injected_faults[component_id] = {
                "fault_id": fault_id,
                "fault": copy.deepcopy(fault),
                "injected_at": utc_now(),
            }
            self.log("Simulated fault injected: " + fault["label"] + " on " + component_id, "fault")

    def reset_faults(self):
        with self.lock:
            count = len(self.injected_faults)
            self.injected_faults.clear()
            self.log("Reset all simulated fault injections (" + str(count) + " cleared)")

    def normal_simulation(self, defaults):
        with self.lock:
            self.sim_readings = copy.deepcopy(defaults)
            self.injected_faults.clear()
            self.elevator.update({
                "position": 0.0,
                "target": None,
                "door_open": False,
                "status": "Idle",
                "updated_at": utc_now(),
            })
            self.log("Simulation returned to normal readings and ground floor")

    def request_floor(self, floor):
        with self.lock:
            self.elevator["target"] = float(floor)
            self.elevator["door_open"] = False
            self.elevator["status"] = "Moving Up" if floor > self.elevator["position"] else (
                "Moving Down" if floor < self.elevator["position"] else "Idle"
            )
            self.elevator["updated_at"] = utc_now()

    def request_direction(self, direction):
        with self.lock:
            current_floor = round(self.elevator["position"])
            target = min(5, current_floor + 1) if direction == "up" else max(0, current_floor - 1)
        self.request_floor(target)

    def set_door(self, is_open):
        with self.lock:
            self.elevator["door_open"] = is_open
            self.elevator["target"] = None
            self.elevator["status"] = "Door Open" if is_open else "Idle"
            self.elevator["updated_at"] = utc_now()

    def halt_movement(self):
        with self.lock:
            if self.elevator["target"] is not None:
                self.elevator["target"] = None
                self.elevator["status"] = "Fault Detected"
                self.elevator["updated_at"] = utc_now()
                self.log("Elevator simulation movement stopped by a critical finding", "fault")

    def clear_fault_status(self):
        with self.lock:
            if self.elevator["target"] is None and self.elevator["status"] == "Fault Detected":
                self.elevator["status"] = "Idle"
                self.elevator["updated_at"] = utc_now()

    def tick(self):
        with self.lock:
            now = time.monotonic()
            elapsed = min(now - self._last_tick, 0.5)
            self._last_tick = now
            target = self.elevator["target"]
            if target is None:
                return
            position = self.elevator["position"]
            step = 0.75 * elapsed
            if abs(target - position) <= step:
                self.elevator["position"] = target
                self.elevator["target"] = None
                self.elevator["status"] = "Idle"
            elif target > position:
                self.elevator["position"] = position + step
                self.elevator["status"] = "Moving Up"
            else:
                self.elevator["position"] = position - step
                self.elevator["status"] = "Moving Down"
            self.elevator["updated_at"] = utc_now()


def simulation_loop(state, interval=config.STATE_POLL_INTERVAL):
    while True:
        state.tick()
        time.sleep(interval)
