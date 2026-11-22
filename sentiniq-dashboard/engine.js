/**
 * KONE SentinIQ - Autonomous Fault Isolation & Root Cause Analysis Engine
 * Engineered for Ultra-Low Edge Token Budgets (<100 tokens per incident)
 */

const KONE_TOPOLOGY = {
  nodes: [
    { id: 'COOLING', label: 'VFD Fan & Vent', sub: 'Sub-Sys A1', x: 70, y: 55, group: 'power' },
    { id: 'IGBT_DRIVE', label: 'VVVF Inverter', sub: 'KDL16S', x: 200, y: 55, group: 'power' },
    { id: 'MOTOR_TRACTION', label: 'EcoDisc Motor', sub: 'MX-18 Machine', x: 340, y: 55, group: 'drive' },
    { id: 'BRAKE_MECH', label: 'Electro-Brake', sub: 'Spring & Coil', x: 480, y: 55, group: 'drive' },
    { id: 'SAFETY_CHAIN', label: 'Safety Line', sub: '110V Loop', x: 480, y: 175, group: 'safety' },
    { id: 'DOOR_OPERATOR', label: 'Door Drive', sub: 'Advanced Door', x: 70, y: 175, group: 'car' },
    { id: 'SILL_INTERLOCK', label: 'Landing Sill', sub: 'Interlock Switch', x: 200, y: 175, group: 'car' },
    { id: 'HOIST_GUIDE', label: 'Guide Rails', sub: 'Roller Shoes', x: 340, y: 175, group: 'shaft' }
  ],
  edges: [
    { from: 'COOLING', to: 'IGBT_DRIVE', type: 'thermal_dep' },
    { from: 'IGBT_DRIVE', to: 'MOTOR_TRACTION', type: 'power_delivery' },
    { from: 'MOTOR_TRACTION', to: 'BRAKE_MECH', type: 'torque_hold' },
    { from: 'BRAKE_MECH', to: 'SAFETY_CHAIN', type: 'safety_trip' },
    { from: 'DOOR_OPERATOR', to: 'SILL_INTERLOCK', type: 'mechanical_travel' },
    { from: 'SILL_INTERLOCK', to: 'SAFETY_CHAIN', type: 'interlock_circuit' },
    { from: 'MOTOR_TRACTION', to: 'HOIST_GUIDE', type: 'kinetic_coupling' }
  ]
};

// Preset Scenarios with Telemetry Vectors & Ground Truth Root Causes
const SCENARIOS = {
  'NOMINAL': {
    name: 'SYSTEM NOMINAL / ALL OK',
    telemetry: {
      motorTemp: 48.2,
      vibe: 0.08,
      doorCurrent: 1.45,
      busVoltage: 565,
      safetyLoop: 'CLOSED (OK)',
      levelOffset: 1.1
    },
    rootCauseNode: null,
    symptomNodes: [],
    activeFaults: 0
  },
  'SCN-01': {
    name: 'VVVF Drive Inverter Thermal Overload',
    telemetry: {
      motorTemp: 89.4,
      vibe: 0.12,
      doorCurrent: 1.48,
      busVoltage: 522,
      safetyLoop: 'INTERMITTENT TRIP',
      levelOffset: 2.8
    },
    rootCauseNode: 'COOLING',
    symptomNodes: ['IGBT_DRIVE', 'MOTOR_TRACTION', 'SAFETY_CHAIN'],
    fiveWhys: [
      { step: 1, why: 'Elevator stopped between floors with error code #0104 (Drive Trip)?', answer: 'Safety circuit opened due to VVVF thermal overload alarm.' },
      { step: 2, why: 'Why did the VVVF drive trigger thermal overload?', answer: 'IGBT heatsink temperature rose beyond 95°C safe limit, dropping DC bus voltage.' },
      { step: 3, why: 'Why did the heatsink overheat under standard duty cycle?', answer: 'Cooling fan rpm dropped to 0 due to bearing seizure.' },
      { step: 4, why: 'Why did the fan seize without prior warning?', answer: 'Lint/dust ingress in drive cabinet filter blocked airflow impeller.' },
      { step: 5, why: 'ROOT CAUSE', answer: 'Cooling assembly filter clogged + axial fan bearing failure (PN: KM713210G01).', isRoot: true }
    ],
    prescriptiveAction: {
      urgency: 'HIGH (Immediate Dispatch)',
      isolationSummary: 'Pruned cascading IGBT and Safety Loop symptoms; isolated primary root cause to VFD Cabinet Cooling Fan Assembly.',
      procedure: '1. Lock out/Tag out 400V 3-phase supply.\n2. Replace Auxiliary Fan Module (KM713210G01).\n3. Vacuum drive cabinet intake micro-filter.\n4. Perform VVVF thermal recalibration drive test.',
      parts: ['KM713210G01 (Drive Fan)', 'KM811902H03 (Cabinet Filter)', 'Thermal Paste Dow-340'],
      estimatedMTTR: '35 minutes'
    },
    compactEdgeTokens: 46
  },
  'SCN-02': {
    name: 'Landing Door Sill Debris & Interlock Chattering',
    telemetry: {
      motorTemp: 52.1,
      vibe: 0.09,
      doorCurrent: 3.42,
      busVoltage: 562,
      safetyLoop: 'CHATTERING (OPEN)',
      levelOffset: 1.2
    },
    rootCauseNode: 'DOOR_OPERATOR',
    symptomNodes: ['SILL_INTERLOCK', 'SAFETY_CHAIN'],
    fiveWhys: [
      { step: 1, why: 'Elevator holds at Floor 7 with repeated door re-opening?', answer: 'Door interlock circuit fails to make firm electrical contact within 3.5s timeout.' },
      { step: 2, why: 'Why does the interlock contact fail to close?', answer: 'Door operator torque limiter triggers reversal before full sill mechanical engagement.' },
      { step: 3, why: 'Why did the torque limit trip?', answer: 'Door motor current surged to 3.42A (threshold 2.80A) due to mechanical resistance.' },
      { step: 4, why: 'Why was there mechanical resistance in the door travel path?', answer: 'Gravel and construction debris wedged in the lower landing sill guide channel.' },
      { step: 5, why: 'ROOT CAUSE', answer: 'Foreign object in Floor 7 sill groove jamming car door skate guide shoes.', isRoot: true }
    ],
    prescriptiveAction: {
      urgency: 'MEDIUM (Passenger Entrapment Prevention)',
      isolationSummary: 'Pruned false safety chain open alert; isolated to Floor 7 sill obstruction causing door drive current surge.',
      procedure: '1. Place car in Inspection Mode.\n2. Clear sill groove at Floor 7 landing.\n3. Inspect door skate rollers and coupler gap (spec: 6.0mm ± 0.5mm).\n4. Reset door cycle counter in LCE controller.',
      parts: ['KM50006023 (Door Skate Rollers)', 'KM602980G02 (Sill Scraper Blade)'],
      estimatedMTTR: '20 minutes'
    },
    compactEdgeTokens: 41
  },
  'SCN-03': {
    name: 'Traction Brake MX-18 Mechanical Retardation Lag',
    telemetry: {
      motorTemp: 55.4,
      vibe: 0.16,
      doorCurrent: 1.50,
      busVoltage: 564,
      safetyLoop: 'CLOSED (OK)',
      levelOffset: 5.8
    },
    rootCauseNode: 'BRAKE_MECH',
    symptomNodes: ['MOTOR_TRACTION'],
    fiveWhys: [
      { step: 1, why: 'Elevator leveling error exceeds ±4mm at terminal landings?', answer: 'Car overshoots leveling laser zone by 5.8mm during creep speed deceleration.' },
      { step: 2, why: 'Why did deceleration overshoot nominal profile?', answer: 'Mechanical brake pad engagement delayed by 280ms after VFD stop command.' },
      { step: 3, why: 'Why did the brake pads take 280ms to contact the drum?', answer: 'Brake coil drop-off voltage decayed sluggishly due to degraded snubber varistor.' },
      { step: 4, why: 'Why did snubber varistor degrade?', answer: 'Repeated high-frequency switching transients during intense peak-hour cycles.' },
      { step: 5, why: 'ROOT CAUSE', answer: 'Brake Control Module (BCM) discharge varistor drift & micro-switch gap out of spec (0.25mm -> 0.65mm).', isRoot: true }
    ],
    prescriptiveAction: {
      urgency: 'HIGH (Safety Compliance EN 81-20)',
      isolationSummary: 'Pruned levelling sensor fault; isolated delay to Brake MX-18 electro-mechanical drop-out lag.',
      procedure: '1. Secure car with safety gear.\n2. Gauge brake air gap with feeler gauge (set to 0.30mm).\n3. Replace BCM brake contactor snubber board.\n4. Perform 125% rated load brake holding test.',
      parts: ['KM897451G01 (MX-18 Brake Shoe Kit)', 'KM764420G04 (BCM Snubber Board)'],
      estimatedMTTR: '45 minutes'
    },
    compactEdgeTokens: 44
  },
  'SCN-04': {
    name: 'Guide Rail Roller Bearing Degradation & Vibration',
    telemetry: {
      motorTemp: 51.0,
      vibe: 0.44,
      doorCurrent: 1.44,
      busVoltage: 566,
      safetyLoop: 'CLOSED (OK)',
      levelOffset: 1.4
    },
    rootCauseNode: 'HOIST_GUIDE',
    symptomNodes: ['MOTOR_TRACTION'],
    fiveWhys: [
      { step: 1, why: 'Ride comfort acoustic fluttering reported in car cabin?', answer: 'Lateral vibration peak reached 0.44g at 2.5 m/s (ISO 18738 threshold: 0.25g).' },
      { step: 2, why: 'Why did car frame vibrate laterally during ascent?', answer: 'Counterweight frame oscillation transmitting across traction steel ropes.' },
      { step: 3, why: 'Why is the counterweight oscillating?', answer: 'Left counterweight guide shoe roller polyurethane tyre has peeled/flatted.' },
      { step: 4, why: 'Why did the roller flat-spot?', answer: 'Bearing inner race seized due to lubricant loss in high-temperature hoistway zone.' },
      { step: 5, why: 'ROOT CAUSE', answer: 'Counterweight Roller Guide Bearing (150mm) seized; uneven guide rail friction.', isRoot: true }
    ],
    prescriptiveAction: {
      urgency: 'MEDIUM (Predictive Maintenance)',
      isolationSummary: 'Isolated lateral vibration harmonic to Counterweight Roller Guide Assembly; traction motor verified healthy.',
      procedure: '1. Run elevator to hoistway mid-point on car top inspection.\n2. Inspect counterweight roller guide assemblies.\n3. Replace degraded 150mm polyurethane roller shoes.\n4. Check rail alignment and lubricate guide blades.',
      parts: ['KM902140G01 (150mm PU Roller Shoe x2)', 'KM50012030 (Rail Guide Oil LCE)'],
      estimatedMTTR: '50 minutes'
    },
    compactEdgeTokens: 39
  }
};

class FaultIsolationEngine {
  constructor() {
    this.currentScenarioKey = 'NOMINAL';
    this.currentScenario = SCENARIOS['NOMINAL'];
  }

  setScenario(key) {
    if (SCENARIOS[key]) {
      this.currentScenarioKey = key;
      this.currentScenario = SCENARIOS[key];
    }
  }

  // Token-Optimized Edge Payload Generator (Reduces 450 tokens to ~40 tokens)
  generateUltraLowTokenPayload() {
    if (this.currentScenarioKey === 'NOMINAL') {
      return {
        tokens: 12,
        bytes: 42,
        payload: {
          u: "KONE-04",
          st: "OK",
          ts: Date.now()
        }
      };
    }

    const sc = this.currentScenario;
    // Ultra-compact dense schema designed for LLM Prompt or Edge Gateway LoRaWAN/Cellular:
    // u: Unit ID, f: Fault code, rc: Root Cause Node, sy: Symptom Nodes, m: MTTR, p: Primary Part
    const compactObj = {
      u: "KONE-04",
      sc: this.currentScenarioKey,
      f: sc.name.substring(0, 24),
      rc: sc.rootCauseNode,
      sy: sc.symptomNodes,
      telem: {
        t: sc.telemetry.motorTemp,
        v: sc.telemetry.vibe,
        dc: sc.telemetry.doorCurrent,
        vlt: sc.telemetry.busVoltage,
        sft: sc.telemetry.safetyLoop === 'CLOSED (OK)' ? 1 : 0
      },
      mttr: sc.prescriptiveAction.estimatedMTTR,
      act: sc.prescriptiveAction.procedure.split('\n')[1] || "Inspect"
    };

    const jsonStr = JSON.stringify(compactObj);
    return {
      tokens: sc.compactEdgeTokens || 42,
      bytes: new TextEncoder().encode(jsonStr).length,
      payload: compactObj
    };
  }
}

window.FaultEngine = new FaultIsolationEngine();
