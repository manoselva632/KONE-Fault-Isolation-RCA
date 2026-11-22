# KONE SentinIQ 🚀 | Autonomous Fault Isolation & Root Cause Analysis (AFIRCA)

[![GitHub Repository](https://img.shields.io/badge/GitHub-manoselva632%2FKONE--Fault--Isolation--RCA-blue?logo=github)](https://github.com/manoselva632/KONE-Fault-Isolation-RCA)
[![Python 3.11+](https://img.shields.io/badge/Python-3.11+-brightgreen.svg)](https://www.python.org/)
[![Flask 3.0](https://img.shields.io/badge/Flask-3.0-lightgrey.svg)](https://flask.palletsprojects.com/)
[![ESP32 IoT](https://img.shields.io/badge/Hardware-ESP32%20IoT-red.svg)](https://www.espressif.com/en/products/socs/esp32)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Official Repository**: [https://github.com/manoselva632/KONE-Fault-Isolation-RCA](https://github.com/manoselva632/KONE-Fault-Isolation-RCA)

---

## 📌 Executive Summary

Modern smart elevators (such as the **KONE MonoSpace® DX** series) generate millions of multivariate telemetry events per second across drives, hoist machines, door operators, safety lines, and cab environmental sensors.

When an operational failure occurs, it triggers **cascading symptom storms** (e.g., an overheated inverter trips the motor drive, which interrupts the safety line, which logs a door interlock error). Traditional monitoring tools cause severe **alert fatigue**, while sending raw diagnostic logs to large cloud LLMs creates latency, hallucination risks, and consumes **hundreds of expensive cloud tokens**.

**KONE SentinIQ & AFIRCA** provides an end-to-end, hardware-in-the-loop diagnostic solution:
1. **Physical & Simulated IoT Sensing**: Real-time ESP32 edge telemetry (IR door sensor, ultrasonic positioning, DHT11 machine-room temperature/humidity) with live-backed and hybrid simulation fallback.
2. **Topological Symptom Pruning**: Traverses subsystem dependency graphs to suppress downstream cascading alerts.
3. **Causal Graph Root Cause Isolation**: Pinpoints the exact origin fault node (e.g., cooling intake fan bearing seizure instead of the safety loop trip).
4. **Ultra-Low-Token RCA Protocol**: Compresses complex incident diagnostics into dense payloads consuming **<45 tokens** (an **89% token saving** over raw JSON/text logs) to generate automated 5-Whys and field technician dispatch work orders.
5. **Interactive Operator Consoles**: Integrated Flask diagnostic workspace with live Chart.js telemetry, fault injection, AI technician chatbot, and a 10-floor Hoistway Digital Twin.

---

## 🏗️ System Architecture

```mermaid
flowchart TD
    subgraph EdgeHardware["IoT Edge Hardware & Telemetry"]
        ESP32[ESP32 Microcontroller] -->|WiFi HTTP /data| Poller[Backend Poller Engine]
        IR[IR Beam Obstruction Sensor] --> ESP32
        Sonic[Ultrasonic Distance Sensor] --> ESP32
        DHT[DHT11 Temp & Humidity] --> ESP32
    end

    subgraph CoreEngine["AFIRCA Core & Diagnosis"]
        Poller --> Evaluator[Component Health Evaluator]
        Sim[Multi-Floor Simulator & Fault Injector] --> Evaluator
        Evaluator --> Pruner[Topological Symptom Pruner]
        Pruner --> Diagnosis[Causal Graph Diagnosis Engine]
        Diagnosis --> Episodes[Fault Episode Lifecycle Tracker]
    end

    subgraph Dashboards["Visualization & Interaction"]
        Diagnosis --> RCACConsole[Flask Diagnostic Console (Port 5000)]
        Diagnosis --> DigitalTwin[SentinIQ 10-Floor Hoistway Twin]
        Episodes --> Reports[JSON / CSV RCA Dossiers]
        Episodes --> Chatbot[AI Grounded Technician Chatbot]
    end
```

---

## 🌟 Key Features

| Capability | Technical Details |
| :--- | :--- |
| **Hybrid Live + Simulation** | Seamlessly transitions between live ESP32 hardware telemetry and deterministic multi-floor simulation. |
| **10-Component Monitored Matrix** | Traction Motor, Inverter (VVVF), Brake System, Door Operator, Safety Line, Levelling Sensors, Cab Ventilation, Hoistway Rail Shoes, Power Supply, and Machine Room Ambient. |
| **Topological Dependency Pruning** | Graph traversal suppresses secondary cascading symptoms, preventing technician alert fatigue. |
| **Causal Graph Visualizer** | Interactive SVG dependency graph highlighting the root cause node in pulsing crimson and pruned symptom nodes in amber. |
| **Digital Twin Hoistway** | Live animated 10-floor hoistway twin with car motion, door cycling, and real-time IoT telemetry gauges. |
| **Grounded AI Technician Chatbot** | Deterministic rule-based assistant answering technical queries directly from live state, sensor readings, and active RCA episodes. |
| **One-Click Fault Injection** | Controlled scenario testing for 10 distinct failure modes with instant auto-recovery and normal simulation reset. |
| **Standardized Export Dossiers** | Download full fault histories and root cause analysis in JSON or CSV for SAP PM / KONE Field Operations dispatch. |

---

## 📁 Repository Structure

```
KONE-Fault-Isolation-RCA/
├── app.py                      # Multi-threaded Flask backend with REST API & SentinIQ routing
├── components.py               # Component evaluation against operational thresholds
├── config.py                   # Centralized configuration (polling intervals, ESP32 IP, ports)
├── diagnosis.py                # Rule-based RCA engine, 5-Whys builder, and technician chatbot
├── esp32_client.py             # Resilient asynchronous ESP32 HTTP client with auto-reconnect
├── simulator.py                # Thread-safe multi-floor elevator simulator & fault injection
├── requirements.txt            # Python dependencies (Flask, requests)
├── .gitignore                  # Git hygiene rules
│
├── data/                       # Configuration & knowledge databases
│   ├── component_data.json     # Normal ranges, warning/critical thresholds, and units
│   └── fault_database.json     # Root-cause templates, inspection steps, and injection maps
│
├── static/                     # Web assets for primary RCA console
│   ├── script.js               # Reactive dashboard controller, Chart.js graphs, and REST sync
│   └── style.css               # Clean high-contrast responsive styling
│
├── templates/                  # Flask HTML views
│   └── index.html              # Monitoring Console with sidebar navigation & live controls
│
└── sentiniq-dashboard/         # SentinIQ Hoistway Digital Twin & Low-Token Visualizer
    ├── index.html              # Standalone 10-floor digital twin hoistway dashboard
    ├── app.js                  # Hoistway animation engine & scenario controller
    ├── engine.js               # Dependency topology & token efficiency calculator
    ├── style.css               # Glassmorphic dark theme design system
    ├── sample-dossier.json     # Sample exported KONE SentinIQ RCA dossier
    └── run.bat                 # One-click Windows launch script
```

---

## 🚀 Quickstart & Installation

### 1. Prerequisites
- **Python 3.11+** installed.
- (Optional) ESP32 development board running the sensor firmware on the same Wi-Fi network.

### 2. Setup Environment
Clone the repository and install dependencies:
```powershell
# Clone the repository
git clone https://github.com/manoselva632/KONE-Fault-Isolation-RCA.git
cd KONE-Fault-Isolation-RCA

# Create and activate virtual environment
python -m venv .venv
.\.venv\Scripts\Activate.ps1

# Install requirements
pip install -r requirements.txt
```

### 3. Launch the Application
Run the primary Flask application:
```powershell
python app.py
```

### 4. Access the Dashboards
Once the server is running:
- **Primary Diagnostic & RCA Console**: [http://localhost:5000](http://localhost:5000)
- **SentinIQ Hoistway Digital Twin**: [http://localhost:5000/sentiniq](http://localhost:5000/sentiniq)

*(Alternatively, you can launch the SentinIQ dashboard standalone by opening `sentiniq-dashboard/index.html` directly in any web browser).*

---

## 🔌 ESP32 Hardware Setup (Optional)

The application features full hardware-in-the-loop capabilities with an ESP32 microcontroller:

### Hardware Connections
| Sensor | ESP32 GPIO Pin | Monitored Metric |
| :--- | :---: | :--- |
| **Infrared (IR) Beam Sensor** | GPIO 14 | Door obstruction & dwell clearance |
| **Ultrasonic Transducer (HC-SR04)** | Trig: 5, Echo: 18 | Car position & floor levelling |
| **DHT11 Sensor** | GPIO 4 | Machine-room temperature & relative humidity |

### Connecting to the Dashboard
1. Connect the ESP32 and your computer to the same local Wi-Fi network.
2. Note the ESP32 IP address output in the Arduino Serial Monitor (115200 baud).
3. In the web dashboard under **ESP32 Connection**, enter the IP address and click **Save IP** or **Test Connection**.
4. The dashboard will automatically transition to **HYBRID** mode with live sensor telemetry!

*(If no ESP32 is connected, the application runs seamlessly in **SIMULATION ONLY** mode).*

---

## 🛠️ Included Failure Scenarios

The system includes pre-configured, real-world failure scenarios for rapid verification:

1. **SCN-01: VVVF Inverter Thermal Overload**
   - *Cascading Symptoms*: Inverter throttling → IGBT desync → Safety line trip.
   - *Isolated Root Cause*: Drive cabinet intake fan seizure (`KONE PN: KM713210G01`).
2. **SCN-02: Landing Door Sill Debris & Contact Chattering**
   - *Cascading Symptoms*: Interlock switch open → Passenger hold timer timeout.
   - *Isolated Root Cause*: Floor 7 sill groove debris obstruction (Door motor current 3.42A).
3. **SCN-03: Traction Brake MX-18 Mechanical Retardation Lag**
   - *Cascading Symptoms*: Levelling laser overshoot ±5.8mm → Passenger step hazard.
   - *Isolated Root Cause*: BCM discharge snubber varistor drift & brake gap drift.
4. **SCN-04: Counterweight Guide Rail Bearing Degradation**
   - *Cascading Symptoms*: Cabin acoustic flutter → Lateral vibration FFT peak 0.44g.
   - *Isolated Root Cause*: Counterweight polyurethane roller shoe bearing seizure.

---

## 📄 License
This project is released under the **MIT License**.

> **Disclaimer**: This software is an educational diagnostic-support prototype and hackathon project. It is not a certified elevator safety system and must never be connected to real elevator operating or safety-critical circuits.
