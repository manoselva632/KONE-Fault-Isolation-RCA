/**
 * KONE SentinIQ - UI Controller & Digital Twin Orchestrator
 */

document.addEventListener('DOMContentLoaded', () => {
  const engine = window.FaultEngine;

  // DOM Elements
  const shaftFloorsEl = document.getElementById('shaft-floors');
  const elevatorCarEl = document.getElementById('elevator-car');
  const doorLeftEl = document.getElementById('door-left');
  const doorRightEl = document.getElementById('door-right');
  const carDoorsWrapper = elevatorCarEl.querySelector('.car-doors');
  const carFloorDisplay = document.getElementById('car-floor-display');
  const carMotionState = document.getElementById('car-motion-state');

  // Gauges
  const valMotorTemp = document.getElementById('val-motor-temp');
  const barMotorTemp = document.getElementById('bar-motor-temp');
  const cardMotorTemp = document.getElementById('card-motor-temp');

  const valVibe = document.getElementById('val-vibe');
  const barVibe = document.getElementById('bar-vibe');
  const cardVibe = document.getElementById('card-vibe');

  const valDoorCurrent = document.getElementById('val-door-current');
  const barDoorCurrent = document.getElementById('bar-door-current');
  const cardDoorCurrent = document.getElementById('card-door-current');

  const valBusVoltage = document.getElementById('val-bus-voltage');
  const barBusVoltage = document.getElementById('bar-bus-voltage');
  const cardBusVoltage = document.getElementById('card-bus-voltage');

  const valSafetyLoop = document.getElementById('val-safety-loop');
  const barSafetyLoop = document.getElementById('bar-safety-loop');
  const cardSafetyLoop = document.getElementById('card-safety-loop');

  const valLevelOffset = document.getElementById('val-level-offset');
  const barLevelOffset = document.getElementById('bar-level-offset');
  const cardLevelOffset = document.getElementById('card-level-offset');

  // Indicators
  const incidentPill = document.getElementById('incident-pill');
  const incidentName = document.getElementById('incident-name');
  const tokenUsageCounter = document.getElementById('token-usage-counter');
  const packetBytes = document.getElementById('packet-bytes');
  const compactJsonOutput = document.getElementById('compact-json-output');

  // RCA Blocks
  const whysContainer = document.getElementById('whys-container');
  const actionDetailsBox = document.getElementById('action-details-box');
  const causalGraphSvg = document.getElementById('causal-graph-svg');

  // Modal
  const scenarioModal = document.getElementById('scenario-modal');
  const btnInjectModal = document.getElementById('btn-inject-modal');
  const btnCloseModal = document.getElementById('btn-close-modal');
  const btnResetNominal = document.getElementById('btn-reset-nominal');
  const btnExportReport = document.getElementById('btn-export-report');

  let currentFloor = 7;
  let carAnimationInterval = null;

  // 1. Generate Hoistway Floors 10 to 1
  function initHoistwayFloors() {
    shaftFloorsEl.innerHTML = '';
    for (let f = 10; f >= 1; f--) {
      const marker = document.createElement('div');
      marker.className = `floor-marker ${f === currentFloor ? 'active' : ''}`;
      marker.id = `floor-marker-${f}`;
      marker.innerText = `F${f.toString().padStart(2, '0')}`;
      shaftFloorsEl.appendChild(marker);
    }
  }

  // 2. Position Elevator Car at Given Floor (1-10)
  function moveCarToFloor(floor, shouldCycleDoors = true) {
    currentFloor = floor;
    // Shaft height is ~480px, Machine room top is ~20px, bottom ~20px
    const percent = ((10 - floor) / 9) * 75 + 5; 
    elevatorCarEl.style.top = `${percent}%`;

    carMotionState.innerText = 'TRAVELLING';
    carMotionState.className = 'badge-floor';

    // Update floor markers
    document.querySelectorAll('.floor-marker').forEach(m => m.classList.remove('active'));
    const currentMarker = document.getElementById(`floor-marker-${floor}`);
    if (currentMarker) currentMarker.classList.add('active');

    setTimeout(() => {
      carFloorDisplay.innerText = `FL ${floor.toString().padStart(2, '0')}`;
      carMotionState.innerText = 'STATIONARY';
      carMotionState.className = 'badge-neutral';

      if (shouldCycleDoors) {
        cycleDoors();
      }
    }, 1800);
  }

  function cycleDoors() {
    carDoorsWrapper.classList.add('open');
    setTimeout(() => {
      carDoorsWrapper.classList.remove('open');
    }, 1600);
  }

  // 3. Render Topological Causal Graph (SVG)
  function renderTopologyGraph(rootCauseId, symptomIds = []) {
    causalGraphSvg.innerHTML = '';

    // Draw Edges First
    KONE_TOPOLOGY.edges.forEach(edge => {
      const fromNode = KONE_TOPOLOGY.nodes.find(n => n.id === edge.from);
      const toNode = KONE_TOPOLOGY.nodes.find(n => n.id === edge.to);
      if (!fromNode || !toNode) return;

      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', fromNode.x);
      line.setAttribute('y1', fromNode.y);
      line.setAttribute('x2', toNode.x);
      line.setAttribute('y2', toNode.y);

      let edgeClass = 'graph-edge';
      const isFaultPath = (fromNode.id === rootCauseId && symptomIds.includes(toNode.id)) ||
                          (symptomIds.includes(fromNode.id) && symptomIds.includes(toNode.id));

      if (isFaultPath) {
        edgeClass += ' edge-fault-path';
      } else if (rootCauseId && !isFaultPath) {
        edgeClass += ' edge-pruned';
      }

      line.setAttribute('class', edgeClass);
      causalGraphSvg.appendChild(line);
    });

    // Draw Nodes
    KONE_TOPOLOGY.nodes.forEach(node => {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'node-group');

      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', node.x);
      circle.setAttribute('cy', node.y);
      circle.setAttribute('r', 22);

      let statusClass = 'status-nominal';
      if (node.id === rootCauseId) {
        statusClass = 'status-root';
      } else if (symptomIds.includes(node.id)) {
        statusClass = 'status-symptom';
      }
      circle.setAttribute('class', `node-circle ${statusClass}`);

      // Node label
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', node.x);
      text.setAttribute('y', node.y - 2);
      text.setAttribute('class', 'node-label');
      text.textContent = node.label.split(' ')[0];

      // Sub label
      const subText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      subText.setAttribute('x', node.x);
      subText.setAttribute('y', node.y + 10);
      subText.setAttribute('class', 'node-sublabel');
      subText.textContent = node.id === rootCauseId ? 'ROOT CAUSE' : (symptomIds.includes(node.id) ? 'SYMPTOM' : node.sub);

      g.appendChild(circle);
      g.appendChild(text);
      g.appendChild(subText);
      causalGraphSvg.appendChild(g);
    });
  }

  // 4. Update Telemetry Dashboard & RCA Visuals
  function updateDashboard() {
    const sc = engine.currentScenario;
    const telem = sc.telemetry;

    // 1. Telemetry Gauges
    valMotorTemp.innerText = `${telem.motorTemp.toFixed(1)} °C`;
    barMotorTemp.style.width = `${Math.min(100, (telem.motorTemp / 110) * 100)}%`;
    cardMotorTemp.className = `telemetry-card ${telem.motorTemp > 80 ? 'alert' : (telem.motorTemp > 65 ? 'warning' : '')}`;

    valVibe.innerText = `${telem.vibe.toFixed(2)} g`;
    barVibe.style.width = `${Math.min(100, (telem.vibe / 0.6) * 100)}%`;
    cardVibe.className = `telemetry-card ${telem.vibe > 0.3 ? 'alert' : (telem.vibe > 0.18 ? 'warning' : '')}`;

    valDoorCurrent.innerText = `${telem.doorCurrent.toFixed(2)} A`;
    barDoorCurrent.style.width = `${Math.min(100, (telem.doorCurrent / 4.0) * 100)}%`;
    cardDoorCurrent.className = `telemetry-card ${telem.doorCurrent > 2.8 ? 'alert' : (telem.doorCurrent > 2.0 ? 'warning' : '')}`;

    valBusVoltage.innerText = `${telem.busVoltage} V`;
    barBusVoltage.style.width = `${Math.min(100, (telem.busVoltage / 650) * 100)}%`;
    cardBusVoltage.className = `telemetry-card ${Math.abs(telem.busVoltage - 560) > 30 ? 'alert' : ''}`;

    valSafetyLoop.innerText = telem.safetyLoop;
    barSafetyLoop.style.width = telem.safetyLoop.includes('OK') ? '100%' : '35%';
    cardSafetyLoop.className = `telemetry-card ${!telem.safetyLoop.includes('OK') ? 'alert' : ''}`;

    valLevelOffset.innerText = `±${telem.levelOffset.toFixed(1)} mm`;
    barLevelOffset.style.width = `${Math.min(100, (telem.levelOffset / 10.0) * 100)}%`;
    cardLevelOffset.className = `telemetry-card ${telem.levelOffset > 4.0 ? 'alert' : (telem.levelOffset > 2.5 ? 'warning' : '')}`;

    // 2. Incident Status Header
    if (engine.currentScenarioKey === 'NOMINAL') {
      incidentPill.className = 'active-incident-tag';
      incidentName.innerText = 'SYSTEM STATE: HEALTHY';
      document.getElementById('p-step-1').className = 'stage-step active';
      document.getElementById('p-step-2').className = 'stage-step';
      document.getElementById('p-step-3').className = 'stage-step';
      document.getElementById('p-step-4').className = 'stage-step';

      whysContainer.innerHTML = '<div class="empty-state">No anomalies detected. Telemetry streams operating within nominal baseline parameters.</div>';
      actionDetailsBox.innerHTML = '<div class="empty-state">System healthy. Standby for IoT edge sensor anomalies.</div>';
    } else {
      incidentPill.className = 'active-incident-tag incident-active';
      incidentName.innerText = `FAULT ISOLATED: ${sc.name.toUpperCase()}`;

      // Highlight all pipeline stages
      document.getElementById('p-step-1').className = 'stage-step active';
      document.getElementById('p-step-2').className = 'stage-step active';
      document.getElementById('p-step-3').className = 'stage-step active';
      document.getElementById('p-step-4').className = 'stage-step active';

      // 3. Render 5-Whys
      whysContainer.innerHTML = '';
      sc.fiveWhys.forEach(item => {
        const div = document.createElement('div');
        div.className = `why-node ${item.isRoot ? 'root-cause' : ''}`;
        div.innerHTML = `
          <div class="why-node-header">
            <span>${item.isRoot ? '★ ROOT CAUSE ISOLATED' : `WHY #${item.step}`}</span>
          </div>
          <div class="why-node-text">
            <strong>${item.why}</strong><br>
            <span>↳ ${item.answer}</span>
          </div>
        `;
        whysContainer.appendChild(div);
      });

      // 4. Render Prescriptive Actions
      const pa = sc.prescriptiveAction;
      actionDetailsBox.innerHTML = `
        <div class="prescriptive-box">
          <div class="prescriptive-title">Topological Isolation Diagnosis</div>
          <div class="prescriptive-text">${pa.isolationSummary}</div>
        </div>

        <div class="prescriptive-box">
          <div class="prescriptive-title">Prescriptive Procedure (MTTR: ${pa.estimatedMTTR})</div>
          <div class="prescriptive-text" style="white-space: pre-line;">${pa.procedure}</div>
        </div>

        <div class="prescriptive-box">
          <div class="prescriptive-title">Required KONE Genuine Replacement Parts</div>
          <div class="parts-badge-row">
            ${pa.parts.map(p => `<span class="part-tag">${p}</span>`).join('')}
          </div>
        </div>
      `;
    }

    // 5. Causal Graph
    renderTopologyGraph(sc.rootCauseNode, sc.symptomNodes);

    // 6. Ultra-Low Token Payload
    const edgeData = engine.generateUltraLowTokenPayload();
    tokenUsageCounter.innerText = `${edgeData.tokens} / 256 tokens`;
    packetBytes.innerText = `${edgeData.bytes} bytes`;
    compactJsonOutput.innerText = JSON.stringify(edgeData.payload, null, 2);
  }

  // 5. Auto car simulation in background
  function startHoistwaySimulation() {
    if (carAnimationInterval) clearInterval(carAnimationInterval);
    carAnimationInterval = setInterval(() => {
      if (engine.currentScenarioKey === 'NOMINAL') {
        const nextFloor = Math.floor(Math.random() * 10) + 1;
        if (nextFloor !== currentFloor) {
          moveCarToFloor(nextFloor);
        }
      }
    }, 6500);
  }

  // 6. Modal & Scenario Interactions
  btnInjectModal.addEventListener('click', () => {
    scenarioModal.classList.remove('hidden');
  });

  btnCloseModal.addEventListener('click', () => {
    scenarioModal.classList.add('hidden');
  });

  scenarioModal.addEventListener('click', (e) => {
    if (e.target === scenarioModal) {
      scenarioModal.classList.add('hidden');
    }
  });

  document.querySelectorAll('.scenario-item').forEach(item => {
    item.addEventListener('click', () => {
      const scnKey = item.getAttribute('data-scenario');
      engine.setScenario(scnKey);
      updateDashboard();
      scenarioModal.classList.add('hidden');

      // Stop auto moving car and focus at problem floor
      if (scnKey === 'SCN-02') moveCarToFloor(7, false);
      if (scnKey === 'SCN-03') moveCarToFloor(9, false);
      if (scnKey === 'SCN-01') moveCarToFloor(4, false);
      if (scnKey === 'SCN-04') moveCarToFloor(6, false);
    });
  });

  btnResetNominal.addEventListener('click', () => {
    engine.setScenario('NOMINAL');
    updateDashboard();
    scenarioModal.classList.add('hidden');
    startHoistwaySimulation();
  });

  // 7. Export Dossier
  btnExportReport.addEventListener('click', () => {
    const sc = engine.currentScenario;
    const reportData = {
      project: "KONE SentinIQ - Autonomous Fault Isolation & Root Cause Analysis",
      generatedAt: new Date().toISOString(),
      equipmentId: "KONE-MONOSPACE-700DX-CAR04",
      activeScenario: sc.name,
      telemetrySnapshot: sc.telemetry,
      isolatedRootCause: sc.rootCauseNode || "NONE (NOMINAL)",
      topologicalSymptomsPruned: sc.symptomNodes || [],
      tokenEfficiency: {
        budgetUsed: engine.generateUltraLowTokenPayload().tokens,
        tokenSavingsVsVerboseLogs: "89.2% reduction"
      },
      rcaDecomposition: sc.fiveWhys || [],
      prescriptiveFieldAction: sc.prescriptiveAction || "No maintenance required."
    };

    const blob = new Blob([JSON.stringify(reportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `KONE-RCA-Dossier-${engine.currentScenarioKey}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // Boot up
  initHoistwayFloors();
  updateDashboard();
  startHoistwaySimulation();
});
