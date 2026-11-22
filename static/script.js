(() => {
  "use strict";

  const stateUrl = "/api/state";
  const history = { labels: [], door: [], distance: [], temperature: [], humidity: [] };
  const charts = {};
  const chartSpecs = {};
  let latestState = null;
  let faultOptionsInitialized = false;
  let toastTimer = null;

  const byId = (id) => document.getElementById(id);
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  };

  async function api(url, method = "GET", data = null) {
    const options = { method, headers: {} };
    if (data !== null) {
      options.headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(data);
    }
    const response = await fetch(url, options);
    let result;
    try {
      result = await response.json();
    } catch (_error) {
      throw new Error("The server returned an unreadable response.");
    }
    if (!response.ok) throw new Error(result.error || "Request failed (" + response.status + ").");
    return result;
  }

  function showToast(message, isError = false) {
    const toast = byId("toast");
    toast.textContent = message;
    toast.classList.toggle("error", isError);
    toast.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("visible"), 3200);
  }

  function safeTime(value) {
    if (!value) return "No valid update received";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString();
  }

  function numeric(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

  function readingText(component) {
    if (component.id === "door_sensor") return component.reading;
    if (component.reading === "No echo" || component.reading === "No live data") return component.reading;
    return String(component.reading);
  }

  function statusClass(status) {
    return status === "FAULT" ? "fault" : status === "WARNING" ? "warning" : status === "OFFLINE" ? "offline" : "normal";
  }

  function updateConnection(state) {
    const connected = state.esp32.connected;
    const badge = byId("connection-badge");
    badge.classList.toggle("connected", connected);
    badge.classList.toggle("disconnected", !connected);
    byId("connection-text").textContent = connected ? "ESP32 CONNECTED" : "ESP32 DISCONNECTED";
    byId("connection-indicator").classList.toggle("connected", connected);
    byId("connection-indicator").classList.toggle("disconnected", !connected);
    byId("connection-detail-title").textContent = connected ? "Connected" : "Disconnected";
    byId("connection-detail-time").textContent = connected
      ? "Last update " + safeTime(state.esp32.last_update)
      : (state.esp32.last_error || "No valid update received");
    byId("latency").textContent = state.esp32.latency_ms === null ? "— ms" : Math.round(state.esp32.latency_ms) + " ms";
    byId("esp32-ip").value = state.esp32.ip || "";
    byId("reset-door-count").disabled = !connected || state.mode !== "hybrid";
    byId("reset-door-count").title = state.mode !== "hybrid" ? "Switch to Hybrid mode to reset the ESP32." : "";
  }

  function updateMetrics(state) {
    byId("metric-total").textContent = state.summary.total;
    byId("metric-normal").textContent = state.summary.normal;
    byId("metric-warning").textContent = state.summary.warning;
    byId("metric-fault").textContent = state.summary.faulty;
    byId("metric-active").textContent = state.summary.active_fault_count;
    byId("mode-select").value = state.mode;
    byId("mode-badge").textContent = state.mode_label;
    byId("last-updated").textContent = state.esp32.last_update ? "Updated " + safeTime(state.esp32.last_update) : "Live data pending";
    byId("current-floor").textContent = state.summary.floor_label === "0" ? "Ground" : "Floor " + state.summary.floor_label;
    byId("movement-status").textContent = state.elevator.display_status;
    byId("simulation-status-large").textContent = state.elevator.display_status;
    byId("simulation-hint").textContent = state.elevator.display_status === "Fault Detected"
      ? "Review active findings before using simulation controls."
      : state.elevator.door_open ? "Simulated doors are open." : "Select a floor or use the directional controls.";
    const level = Math.max(0, Math.min(5, Number(state.elevator.position) || 0));
    const carPosition = Math.max(1, Math.min(91, (level / 5) * 90 + 1));
    ["elevator-car", "elevator-car-large"].forEach((id) => {
      const car = byId(id);
      if (!car) return;
      car.style.bottom = carPosition + "%";
      car.classList.toggle("doors-open", state.elevator.door_open);
    });
    const floorName = state.summary.floor_label === "0" ? "G" : state.summary.floor_label;
    ["car-floor", "car-floor-large"].forEach((id) => { if (byId(id)) byId(id).textContent = floorName; });
    document.querySelectorAll(".floor-buttons button").forEach((button) => {
      button.classList.toggle("selected", Number(button.dataset.floor) === Math.round(level));
    });
    const positionComponent = state.components.find((component) => component.id === "position_sensor");
    const clearance = positionComponent && positionComponent.status !== "OFFLINE" ? numeric(positionComponent.reading) : null;
    const distanceText = clearance === null ? (positionComponent && positionComponent.reading === "No echo" ? "No echo" : "— cm") : clearance.toFixed(1) + " cm";
    ["clearance-value", "clearance-value-large"].forEach((id) => { if (byId(id)) byId(id).textContent = distanceText; });
    const fillClass = clearance !== null && clearance <= 10 ? "critical" : clearance !== null && clearance <= 30 ? "warning" : "";
    ["clearance-fill", "clearance-fill-large"].forEach((id) => {
      const fill = byId(id);
      if (!fill) return;
      fill.className = "meter-fill " + fillClass;
      fill.style.height = clearance === null ? "0%" : Math.max(4, Math.min(100, clearance / 2)) + "%";
    });
    const blocked = state.components.find((component) => component.id === "door_sensor");
    const alert = byId("elevator-alert");
    const liveBlocked = state.mode === "hybrid" && blocked && blocked.source === "LIVE ESP32" && blocked.blocked;
    const positionCritical = positionComponent && positionComponent.status === "FAULT";
    const motor = state.components.find((component) => component.id === "traction_motor");
    const motorCritical = motor && motor.status === "FAULT" && motor.severity === "CRITICAL";
    const message = liveBlocked ? "Door Blocked — live IR input is active."
      : positionCritical ? "Overtravel Risk — simulation movement is stopped."
        : motorCritical ? "Critical motor temperature — simulation movement is stopped."
          : "";
    alert.textContent = message;
    alert.classList.toggle("hidden", !message);
  }

  function renderComponents(components) {
    const grid = byId("component-grid");
    grid.replaceChildren();
    components.forEach((component) => {
      const status = statusClass(component.status);
      const card = el("article", "component-card " + status + (component.injected ? " injected" : ""));
      const top = el("div", "component-top");
      top.append(el("h3", "", component.name));
      const pill = el("span", "status-pill " + status, component.status);
      top.append(pill);
      card.append(top);
      const reading = el("div", "component-reading");
      reading.append(el("strong", "", readingText(component)));
      if (component.id !== "door_sensor") reading.append(el("span", "", component.unit || ""));
      card.append(reading);
      const meta = el("div", "component-meta");
      const source = el("div");
      source.append(el("span", "", "DATA SOURCE"), el("strong", "", component.source));
      const range = el("div");
      range.append(el("span", "", "EXPECTED RANGE"), el("strong", "", component.normal_range));
      meta.append(source, range);
      card.append(meta);
      card.append(el("p", "component-description", component.description));
      if (component.fault_type) {
        const detail = component.injected ? "Injected simulated override" : component.fault_type.replaceAll("_", " ");
        card.append(el("p", "component-description", "Finding: " + detail +
          (component.live_reading !== undefined && component.live_reading !== null
            ? " · underlying live reading " + component.live_reading
            : "")));
      }
      if (component.supporting_evidence && component.supporting_evidence.length) {
        const evidence = component.supporting_evidence.map((item) =>
          typeof item === "string" ? item : item.description + " " + item.reading + item.unit
        ).join(" ");
        card.append(el("p", "component-description", "Evidence: " + evidence));
      }
      grid.append(card);
    });
  }

  function renderFindings(reports) {
    const active = reports.filter((report) => report.status === "Active");
    const list = byId("active-findings");
    list.replaceChildren();
    if (!active.length) {
      list.append(el("div", "empty-state", "No active findings."));
      return;
    }
    active.slice(0, 5).forEach((report) => {
      const item = el("article", "finding-item" + (report.severity === "WARNING" ? " warning" : ""));
      item.append(el("strong", "", report.component + " · " + report.severity));
      item.append(el("p", "", report.detected_fault.replaceAll("_", " ") + " — " + report.sensor_reading));
      item.append(el("div", "finding-meta", report.data_source + " · " + report.fault_id));
      list.append(item);
    });
  }

  function renderEvents(events) {
    const list = byId("recent-events");
    list.replaceChildren();
    if (!events.length) {
      list.append(el("div", "empty-state", "Waiting for system events."));
      return;
    }
    events.slice(0, 6).forEach((event) => {
      const item = el("div", "event-item " + (event.type || ""));
      const time = new Date(event.timestamp);
      item.append(el("time", "", Number.isNaN(time.getTime()) ? "" : time.toLocaleTimeString()));
      item.append(el("span", "", event.message));
      list.append(item);
    });
  }

  function renderDiagnoses(reports) {
    const active = reports.filter((report) => report.status === "Active").slice(0, 4);
    const rail = byId("rail-diagnosis");
    rail.replaceChildren();
    if (!active.length) {
      rail.append(el("div", "empty-state", "No current diagnosis."));
      return;
    }
    active.forEach((report) => {
      const item = el("article", "diagnosis-item");
      const top = el("div", "diagnosis-top");
      top.append(el("strong", "", report.component));
      top.append(el("span", "severity-pill" + (report.severity === "WARNING" ? " warning" : ""), report.severity));
      item.append(top);
      item.append(el("p", "", report.possible_root_causes.slice(0, 2).join("; ")));
      item.append(el("small", "", report.sensor_reading + " · " + report.data_source));
      rail.append(item);
    });
  }

  function addReportDetail(parent, title, values) {
    const detail = el("div", "report-detail");
    detail.append(el("span", "", title));
    detail.append(el("p", "", Array.isArray(values) ? (values.length ? values.join("; ") : "None recorded") : values));
    parent.append(detail);
  }

  function reportCard(report) {
    const card = el("article", "report-card" + (report.status === "Resolved" ? " resolved" : ""));
    const header = el("div", "report-card-header");
    const title = el("h3");
    title.append(el("span", "report-id", report.fault_id), document.createTextNode(report.component));
    header.append(title);
    const status = el("div", "report-status");
    status.append(el("span", "severity-pill" + (report.severity === "WARNING" ? " warning" : ""), report.severity));
    status.append(el("span", "source-pill", report.data_source));
    status.append(el("span", "status-pill " + (report.status === "Resolved" ? "offline" : "fault"), report.status));
    header.append(status);
    card.append(header);
    card.append(el("p", "", report.detected_fault.replaceAll("_", " ") + " · Reading: " + report.sensor_reading));
    const details = el("div", "report-details");
    addReportDetail(details, "Expected range", report.expected_range);
    addReportDetail(details, "Possible root causes", report.possible_root_causes);
    addReportDetail(details, "Supporting evidence", report.supporting_evidence.map((item) =>
      typeof item === "string" ? item : item.description + " " + item.reading + item.unit
    ));
    addReportDetail(details, "Recommended inspection steps", report.recommended_inspection_steps);
    card.append(details);
    card.append(el("div", "report-timestamp", "Detected " + report.timestamp + " · Updated " + report.last_updated +
      (report.resolved_at ? " · Resolved " + report.resolved_at : "")));
    return card;
  }

  function renderReports(reports) {
    const full = byId("report-list");
    const historyList = byId("history-list");
    full.replaceChildren();
    historyList.replaceChildren();
    if (!reports.length) {
      full.append(el("div", "empty-state", "No reports yet. Reports appear when a warning or fault is detected."));
      historyList.append(el("div", "empty-state", "No fault history yet."));
      return;
    }
    reports.forEach((report) => {
      full.append(reportCard(report));
      historyList.append(reportCard(report));
    });
  }

  function chartPlugin(thresholds) {
    return {
      id: "thresholdLines",
      afterDraw(chart) {
        const y = chart.scales.y;
        const ctx = chart.ctx;
        if (!y) return;
        thresholds.forEach((item) => {
          const pixel = y.getPixelForValue(item.value);
          if (pixel < chart.chartArea.top || pixel > chart.chartArea.bottom) return;
          ctx.save();
          ctx.strokeStyle = item.color;
          ctx.setLineDash([4, 4]);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(chart.chartArea.left, pixel);
          ctx.lineTo(chart.chartArea.right, pixel);
          ctx.stroke();
          ctx.fillStyle = item.color;
          ctx.font = "8px DM Mono, monospace";
          ctx.fillText(item.label, chart.chartArea.left + 4, pixel - 3);
          ctx.restore();
        });
      },
    };
  }

  function createChart(canvasId, series, color, thresholds = [], suggestedMax = null) {
    const canvas = byId(canvasId);
    if (!canvas) return;
    chartSpecs[series] = { canvasId, color, thresholds, max: suggestedMax || 100 };
    if (typeof window.Chart !== "function") return;
    charts[series] = new window.Chart(canvas, {
      type: "line",
      data: { labels: history.labels, datasets: [{
        data: history[series],
        borderColor: color,
        backgroundColor: color + "20",
        fill: true,
        pointRadius: 0,
        borderWidth: 1.7,
        tension: 0.3,
        spanGaps: false,
      }] },
      plugins: thresholds.length ? [chartPlugin(thresholds)] : [],
      options: {
        animation: false,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: true } },
        scales: {
          x: { display: false, grid: { display: false } },
          y: { min: 0, suggestedMax, ticks: { color: "#718797", font: { size: 8 }, maxTicksLimit: 4 },
            grid: { color: "#1a2b39" }, border: { display: false } },
        },
      },
    });
  }

  function drawFallbackChart(series, spec) {
    const canvas = byId(spec.canvasId);
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(100, canvas.clientWidth);
    const height = Math.max(70, canvas.clientHeight);
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    const context = canvas.getContext("2d");
    context.scale(ratio, ratio);
    context.clearRect(0, 0, width, height);
    const padding = { left: 28, right: 7, top: 8, bottom: 8 };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const values = history[series];
    const finiteValues = values.filter((value) => value !== null && Number.isFinite(value));
    const max = Math.max(spec.max, ...finiteValues, ...spec.thresholds.map((line) => line.value));
    const yFor = (value) => padding.top + plotHeight - (value / max) * plotHeight;

    context.font = "8px monospace";
    context.textBaseline = "middle";
    for (let step = 0; step <= 3; step += 1) {
      const y = padding.top + (plotHeight * step) / 3;
      const label = Math.round(max * (1 - step / 3));
      context.strokeStyle = "#1a2b39";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(padding.left, y);
      context.lineTo(width - padding.right, y);
      context.stroke();
      context.fillStyle = "#718797";
      context.fillText(String(label), 2, y);
    }
    spec.thresholds.forEach((line) => {
      const y = yFor(line.value);
      context.strokeStyle = line.color;
      context.setLineDash([4, 4]);
      context.beginPath();
      context.moveTo(padding.left, y);
      context.lineTo(width - padding.right, y);
      context.stroke();
      context.setLineDash([]);
      context.fillStyle = line.color;
      context.fillText(line.label, padding.left + 3, Math.max(5, y - 5));
    });
    context.strokeStyle = spec.color;
    context.lineWidth = 1.7;
    context.beginPath();
    let drawing = false;
    values.forEach((value, index) => {
      if (value === null || !Number.isFinite(value)) {
        drawing = false;
        return;
      }
      const x = padding.left + (values.length <= 1 ? 0 : (index / (values.length - 1)) * plotWidth);
      const y = yFor(value);
      if (drawing) context.lineTo(x, y);
      else context.moveTo(x, y);
      drawing = true;
    });
    context.stroke();
  }

  function drawFallbackCharts() {
    Object.entries(chartSpecs).forEach(([series, spec]) => drawFallbackChart(series, spec));
  }

  function initializeCharts() {
    createChart("chart-door", "door", "#f0bf5a", [
      { value: 5, label: "WARN 5 s", color: "#e9b64d" },
      { value: 10, label: "CRIT 10 s", color: "#ef676c" },
    ], 12);
    createChart("chart-distance", "distance", "#56c9c4", [
      { value: 30, label: "WARN 30 cm", color: "#e9b64d" },
      { value: 10, label: "CRIT 10 cm", color: "#ef676c" },
    ], 150);
    createChart("chart-temp", "temperature", "#ee8b63", [
      { value: 35, label: "WARN 35 C", color: "#e9b64d" },
      { value: 40, label: "CRIT 40 C", color: "#ef676c" },
    ], 50);
    createChart("chart-humidity", "humidity", "#8e9df4", [
      { value: 70, label: "WARN 70%", color: "#e9b64d" },
      { value: 85, label: "CRIT 85%", color: "#ef676c" },
    ], 100);
  }

  function updateCharts(state) {
    const sensor = state.sensor_readings || {};
    const timestamp = new Date();
    history.labels.push(timestamp.toLocaleTimeString());
    history.door.push(numeric(sensor.doorSec));
    history.distance.push(numeric(sensor.distance));
    history.temperature.push(numeric(sensor.temp));
    history.humidity.push(numeric(sensor.hum));
    Object.keys(history).forEach((key) => { if (history[key].length > 60) history[key].shift(); });
    if (typeof window.Chart === "function") Object.values(charts).forEach((chart) => chart.update("none"));
    else drawFallbackCharts();
    byId("chart-door-current").textContent = sensor.doorSec === null || sensor.doorSec === undefined ? "—" : sensor.doorSec + " s";
    byId("chart-distance-current").textContent = sensor.distance === -1 ? "No echo" : sensor.distance === null || sensor.distance === undefined ? "—" : Number(sensor.distance).toFixed(1) + " cm";
    byId("chart-temp-current").textContent = sensor.temp === null || sensor.temp === undefined ? "—" : Number(sensor.temp).toFixed(1) + " C";
    byId("chart-humidity-current").textContent = sensor.hum === null || sensor.hum === undefined ? "—" : Number(sensor.hum).toFixed(1) + "%";
  }

  function renderInjectionOptions(state) {
    const componentSelect = byId("inject-component");
    const faultSelect = byId("inject-fault");
    if (!componentSelect || !faultSelect || faultOptionsInitialized) return;
    const current = componentSelect.value;
    componentSelect.replaceChildren();
    state.fault_options.forEach((option) => {
      const item = el("option", "", option.component);
      item.value = option.component_id;
      componentSelect.append(item);
    });
    if (current && state.fault_options.some((option) => option.component_id === current)) componentSelect.value = current;
    updateFaultSelect(state);
    const library = byId("fault-library");
    library.replaceChildren();
    state.fault_options.forEach((option) => {
      const item = el("div", "fault-library-item");
      item.append(el("strong", "", option.component));
      item.append(el("span", "", option.faults.map((fault) => fault.label).join(" · ")));
      library.append(item);
    });
    faultOptionsInitialized = true;
  }

  function updateFaultSelect(state = latestState) {
    const selected = byId("inject-component").value;
    const option = state && state.fault_options.find((item) => item.component_id === selected);
    const select = byId("inject-fault");
    select.replaceChildren();
    if (!option) {
      select.append(el("option", "", "Select a component first"));
      return;
    }
    option.faults.forEach((fault) => {
      const item = el("option", "", fault.label);
      item.value = fault.id;
      select.append(item);
    });
  }

  function renderState(state) {
    latestState = state;
    updateConnection(state);
    updateMetrics(state);
    renderComponents(state.components);
    renderFindings(state.reports);
    renderEvents(state.events);
    renderDiagnoses(state.reports);
    renderReports(state.reports);
    renderInjectionOptions(state);
    updateCharts(state);
  }

  async function pollState() {
    try {
      renderState(await api(stateUrl));
    } catch (error) {
      showToast(error.message, true);
    }
  }

  function selectView(view) {
    document.querySelectorAll(".view-panel").forEach((panel) => panel.classList.toggle("active", panel.id === "view-" + view));
    document.querySelectorAll(".nav-link").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
    const titles = {
      dashboard: "System overview",
      simulation: "Elevator simulation",
      components: "Component monitoring",
      injection: "Fault injection",
      reports: "Root cause analysis",
      chatbot: "AI technician chatbot",
      history: "Fault history",
    };
    byId("page-title").textContent = titles[view] || "System overview";
  }

  async function runAction(url, data, message) {
    try {
      const result = await api(url, "POST", data);
      if (result.state) renderState(result.state);
      else renderState(result);
      if (message) showToast(message);
      return true;
    } catch (error) {
      showToast(error.message, true);
      return false;
    }
  }

  function appendChat(container, text, isUser) {
    if (!container) return;
    const message = el("div", "chat-message" + (isUser ? " user" : ""), text);
    container.append(message);
    container.scrollTop = container.scrollHeight;
  }

  async function submitChat(input, isPage) {
    const question = input.value.trim();
    if (!question) return;
    input.value = "";
    const containers = [byId("chat-messages"), byId("chat-messages-page")];
    containers.forEach((container) => appendChat(container, question, true));
    try {
      const result = await api("/api/chat", "POST", { question });
      containers.forEach((container) => appendChat(container, result.answer, false));
    } catch (error) {
      containers.forEach((container) => appendChat(container, error.message, false));
    }
    if (isPage) selectView("chatbot");
  }

  document.querySelectorAll(".nav-link").forEach((button) => {
    button.addEventListener("click", () => selectView(button.dataset.view));
  });
  document.querySelectorAll("[data-view-link]").forEach((button) => {
    button.addEventListener("click", () => selectView(button.dataset.viewLink));
  });
  document.querySelectorAll("[data-move]").forEach((button) => {
    button.addEventListener("click", () => runAction("/api/elevator/move", { direction: button.dataset.move }));
  });
  document.querySelectorAll(".floor-buttons button").forEach((button) => {
    button.addEventListener("click", () => runAction("/api/elevator/floor", { floor: Number(button.dataset.floor) }));
  });
  document.querySelectorAll("[data-door]").forEach((button) => {
    button.addEventListener("click", () => runAction("/api/elevator/door", { action: button.dataset.door }));
  });
  byId("mode-select").addEventListener("change", (event) => {
    runAction("/api/mode", { mode: event.target.value }, "Data source mode updated.");
  });
  byId("save-ip").addEventListener("click", () => {
    runAction("/api/esp32/settings", { ip: byId("esp32-ip").value.trim() }, "ESP32 IP address saved.");
  });
  byId("test-connection").addEventListener("click", async () => {
    const saved = await runAction("/api/esp32/settings", { ip: byId("esp32-ip").value.trim() });
    if (!saved) return;
    try {
      const result = await api("/api/esp32/test", "POST", {});
      renderState(result.state);
      showToast("ESP32 connected — valid sensor data received.");
    } catch (error) {
      showToast(error.message, true);
      await pollState();
    }
  });
  byId("reset-door-count").addEventListener("click", () => {
    runAction("/api/esp32/reset", {}, "ESP32 door obstruction count reset.");
  });
  byId("inject-component").addEventListener("change", () => updateFaultSelect());
  byId("inject-button").addEventListener("click", () => {
    runAction("/api/faults/inject", {
      component_id: byId("inject-component").value,
      fault_id: byId("inject-fault").value,
    }, "Simulated fault injected.");
  });
  byId("reset-faults").addEventListener("click", () => runAction("/api/faults/reset", {}, "Simulated fault injections reset."));
  byId("normal-simulation").addEventListener("click", () => runAction("/api/simulation/normal", {}, "Normal simulation restored."));
  byId("chat-form").addEventListener("submit", (event) => {
    event.preventDefault();
    submitChat(byId("chat-input"), false);
  });
  byId("chat-form-page").addEventListener("submit", (event) => {
    event.preventDefault();
    submitChat(byId("chat-input-page"), true);
  });
  document.querySelectorAll("[data-question]").forEach((button) => {
    button.addEventListener("click", () => {
      const isPage = button.closest("#view-chatbot") !== null;
      const input = byId(isPage ? "chat-input-page" : "chat-input");
      input.value = button.dataset.question;
      submitChat(input, isPage);
    });
  });

  initializeCharts();
  pollState();
  setInterval(pollState, 500);
})();
