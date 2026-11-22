import math
import threading
import time

import requests

import config
from simulator import utc_now


INTEGER_FIELDS = ("ir", "count", "doorSec", "doorLvl", "posLvl", "dhtOk", "tempLvl", "humLvl")
LEVEL_FIELDS = ("doorLvl", "posLvl", "tempLvl", "humLvl")
FLOAT_FIELDS = ("distance", "temp", "hum")
REQUIRED_FIELDS = set(INTEGER_FIELDS + FLOAT_FIELDS)


class ESP32Client:
    def __init__(self, state, poll_interval=config.POLL_INTERVAL, timeout=config.TIMEOUT):
        self.state = state
        self.poll_interval = poll_interval
        self.timeout = timeout
        self._stop = threading.Event()
        self._thread = None
        self._ever_connected = False

    @staticmethod
    def validate_payload(payload):
        if not isinstance(payload, dict):
            raise ValueError("ESP32 /data response must be a JSON object.")
        missing = REQUIRED_FIELDS.difference(payload)
        if missing:
            raise ValueError("ESP32 /data is missing required fields: " + ", ".join(sorted(missing)))
        clean = {}
        for field in INTEGER_FIELDS:
            value = payload[field]
            if isinstance(value, bool) or not isinstance(value, int):
                raise ValueError("ESP32 field '" + field + "' must be an integer.")
            if value < 0:
                raise ValueError("ESP32 field '" + field + "' cannot be negative.")
            clean[field] = value
        for field in LEVEL_FIELDS:
            if clean[field] not in (0, 1, 2):
                raise ValueError("ESP32 field '" + field + "' must be 0, 1, or 2.")
        if clean["ir"] not in (0, 1) or clean["dhtOk"] not in (0, 1):
            raise ValueError("ESP32 fields 'ir' and 'dhtOk' must be 0 or 1.")
        for field in FLOAT_FIELDS:
            value = payload[field]
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise ValueError("ESP32 field '" + field + "' must be numeric.")
            if not math.isfinite(float(value)):
                raise ValueError("ESP32 field '" + field + "' must be finite.")
            clean[field] = float(value)
        if clean["distance"] < 0 and clean["distance"] != -1:
            raise ValueError("ESP32 distance must be -1 (no echo) or non-negative.")
        if clean["temp"] < -40 or clean["temp"] > 125:
            raise ValueError("ESP32 temperature is outside the DHT11-valid range.")
        if clean["hum"] < 0 or clean["hum"] > 100:
            raise ValueError("ESP32 humidity must be between 0 and 100.")
        return clean

    def start(self):
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._poll_loop, name="esp32-poller", daemon=True)
        self._thread.start()

    def stop(self):
        self._stop.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=self.timeout + self.poll_interval)

    def _poll_loop(self):
        while not self._stop.is_set():
            started = time.monotonic()
            try:
                self.fetch_and_update()
            except (requests.RequestException, ValueError) as error:
                self._mark_disconnected(str(error))
            remaining = max(0, self.poll_interval - (time.monotonic() - started))
            self._stop.wait(remaining)

    def fetch_and_update(self):
        with self.state.lock:
            ip = self.state.live["ip"]
        response = requests.get("http://" + ip + "/data", timeout=self.timeout)
        response.raise_for_status()
        try:
            payload = self.validate_payload(response.json())
        except (ValueError, requests.exceptions.JSONDecodeError) as error:
            raise ValueError("Invalid ESP32 /data response: " + str(error)) from error
        with self.state.lock:
            if self.state.live["ip"] != ip:
                raise ValueError("ESP32 target changed during the request; stale response ignored.")
        self._mark_connected(payload, response.elapsed.total_seconds() * 1000)
        return payload

    def test_connection(self):
        return self.fetch_and_update()

    def reset_door_count(self):
        with self.state.lock:
            ip = self.state.live["ip"]
        response = requests.get("http://" + ip + "/reset", timeout=self.timeout)
        response.raise_for_status()
        with self.state.lock:
            payload = self.state.live["payload"]
            if payload is not None:
                payload["count"] = 0
            self.state.live["last_update"] = utc_now()
        self.state.log("ESP32 door obstruction count reset")
        return response.text[:200]

    def set_ip(self, ip):
        with self.state.lock:
            previous = self.state.live["ip"]
            self.state.live.update({
                "ip": ip,
                "connected": False,
                "last_error": None,
                "last_update": None,
                "latency_ms": None,
                "payload": None,
            })
        if previous != ip:
            self.state.log("ESP32 target changed to " + ip)

    def _mark_connected(self, payload, latency_ms):
        with self.state.lock:
            was_connected = self.state.live["connected"]
            self.state.live.update({
                "connected": True,
                "payload": payload,
                "last_update": utc_now(),
                "latency_ms": round(latency_ms, 1),
                "last_error": None,
            })
        if not was_connected:
            self.state.log("ESP32 connected and valid sensor data received", "connection")
        self._ever_connected = True

    def _mark_disconnected(self, message):
        with self.state.lock:
            was_connected = self.state.live["connected"]
            self.state.live.update({
                "connected": False,
                "last_error": message[:240],
                "latency_ms": None,
            })
        if was_connected or self._ever_connected:
            self.state.log("ESP32 connection lost: " + message[:160], "connection")
