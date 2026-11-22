import os


ESP32_IP = os.environ.get("ESP32_IP", "192.168.137.125")
POLL_INTERVAL = 0.5
TIMEOUT = 1.5
STATE_POLL_INTERVAL = 0.1
COMPONENT_DATA_PATH = os.path.join(os.path.dirname(__file__), "data", "component_data.json")
FAULT_DATABASE_PATH = os.path.join(os.path.dirname(__file__), "data", "fault_database.json")
