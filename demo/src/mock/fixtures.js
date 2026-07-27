// Deterministic-ish fake data for the LogOctopus demo.
// Nothing here talks to a real network — it's all in-memory.

const now = Date.now();
const iso = (offsetMs) => new Date(now - offsetMs).toISOString().replace("T", " ").slice(0, 19);

export const DEMO_DEVICES = [
  {
    id: "dev-router-a",
    name: "Router-Alpha",
    connection: "connected",
    logAccess: true,
    collecting: true,
    autoCollectionEnabled: true,
    autoCollectionInterval: 4,
    config: {
      ip_address: "10.0.1.11",
      port: 22,
      user: "netadmin",
      log_sources: ["syslog", "journalctl", "dmesg"],
      auto_collection_enabled: true,
      auto_collection_interval: 4,
    },
  },
  {
    id: "dev-router-b",
    name: "Router-Beta",
    connection: "connected",
    logAccess: true,
    collecting: false,
    autoCollectionEnabled: false,
    autoCollectionInterval: 1,
    config: {
      ip_address: "10.0.1.12",
      port: 22,
      user: "netadmin",
      log_sources: ["syslog", "journalctl"],
    },
  },
  {
    id: "dev-switch-core",
    name: "Switch-Core-01",
    connection: "connected",
    logAccess: true,
    collecting: false,
    autoCollectionEnabled: false,
    autoCollectionInterval: 1,
    config: {
      ip_address: "10.0.0.2",
      port: 22,
      user: "admin",
      log_sources: ["syslog"],
      packets_capture_config: { interface: "eth0", filter: "tcp port 443" },
    },
  },
  {
    id: "dev-firewall",
    name: "Firewall-Edge",
    connection: "disconnected",
    logAccess: false,
    collecting: false,
    autoCollectionEnabled: false,
    autoCollectionInterval: 1,
    config: {
      ip_address: "10.0.0.1",
      port: 22,
      user: "fwadmin",
      log_sources: ["syslog"],
    },
  },
  {
    id: "dev-iot-gw",
    name: "IoT-Gateway",
    connection: "connected",
    logAccess: true,
    collecting: false,
    autoCollectionEnabled: true,
    autoCollectionInterval: 12,
    config: {
      ip_address: "10.0.2.5",
      port: 22,
      user: "iot",
      log_sources: ["journalctl", "cpu_temp"],
    },
  },
  {
    id: "dev-sensor-hub",
    name: "Sensor-Hub-3",
    connection: "connected",
    logAccess: true,
    collecting: false,
    autoCollectionEnabled: false,
    autoCollectionInterval: 1,
    config: {
      ip_address: "10.0.2.9",
      port: 22,
      user: "sensor",
      log_sources: ["cpu_temp", "packet_capture"],
    },
  },
];

const SESSION_1 = "8cd7112719ac";
const SESSION_2 = "44b2e0a1c9df";
const SESSION_3 = "f01a9c3e7b22";

const SYSLOG_LEVELS = ["INFO", "WARN", "ERROR", "DEBUG"];
const SYSLOG_MSGS = [
  "interface eth0 link state changed to up",
  "dhcp lease renewed for 10.0.1.44",
  "authentication failure for user 'guest' from 10.0.1.201",
  "ntp sync completed, offset 0.0021s",
  "config checkpoint saved",
  "bgp neighbor 10.0.1.1 established",
  "temperature sensor reading 42.3C",
  "watchdog heartbeat ok",
  "firewall rule 118 matched, packet dropped",
  "disk usage at 71%, above warning threshold",
];

function genTextRows(deviceName, logName, count) {
  const rows = [];
  let t = now - count * 1500;
  for (let i = 0; i < count; i++) {
    const level = SYSLOG_LEVELS[Math.floor(Math.random() * SYSLOG_LEVELS.length)];
    const msg = SYSLOG_MSGS[Math.floor(Math.random() * SYSLOG_MSGS.length)];
    rows.push({
      timestamp: iso(now - t),
      log_name: logName,
      content: `[${deviceName}] [${logName}] ${level} ${msg}`,
    });
    t -= 1500 + Math.random() * 2500;
  }
  return rows;
}

function genChartRows(count, base, amplitude) {
  const rows = [];
  let t = now - count * 5000;
  for (let i = 0; i < count; i++) {
    const value = base + amplitude * Math.sin(i / 6) + (Math.random() - 0.5) * amplitude * 0.2;
    rows.push({ time: iso(now - t), content: Number(value.toFixed(2)) });
    t -= 5000;
  }
  return rows;
}

function genPacketRows(count) {
  const rows = [];
  let t = now - count * 300;
  const protos = ["TCP", "UDP", "TLSv1.3", "DNS", "ICMP"];
  for (let i = 1; i <= count; i++) {
    const proto = protos[Math.floor(Math.random() * protos.length)];
    rows.push({
      timestamp: iso(now - t),
      log_name: "network capture",
      content: `${i}\t${(i * 0.0231).toFixed(6)}\t10.0.1.${10 + (i % 20)} → 10.0.1.1\t${proto}\t${60 + (i % 200)}\tSeq=${i} Len=${i % 128}`,
    });
    t -= 300;
  }
  return rows;
}

// snapshot "meta" records — the list shown in the Snapshots table.
// contentGenerator is resolved lazily so we don't build thousands of rows up front.
export const DEMO_SNAPSHOTS = [
  {
    id: "snap-001", deviceName: "Router-Alpha", logName: "syslog", sessionId: SESSION_1,
    sessionScenario: "pre-deploy sanity check", startTime: iso(1000 * 60 * 60 * 5), finishTime: iso(1000 * 60 * 60 * 5 - 180000),
    duration: 180.4, sizeKb: 38, isChart: false, dataUnit: "",
    rows: () => genTextRows("Router-Alpha", "syslog", 120),
  },
  {
    id: "snap-002", deviceName: "Router-Alpha", logName: "journalctl", sessionId: SESSION_1,
    sessionScenario: "pre-deploy sanity check", startTime: iso(1000 * 60 * 60 * 5), finishTime: iso(1000 * 60 * 60 * 5 - 180000),
    duration: 179.9, sizeKb: 52, isChart: false, dataUnit: "",
    rows: () => genTextRows("Router-Alpha", "journalctl", 160),
  },
  {
    id: "snap-003", deviceName: "Router-Beta", logName: "syslog", sessionId: SESSION_2,
    sessionScenario: "weekly health check", startTime: iso(1000 * 60 * 60 * 26), finishTime: iso(1000 * 60 * 60 * 26 - 60000),
    duration: 60.1, sizeKb: 21, isChart: false, dataUnit: "",
    rows: () => genTextRows("Router-Beta", "syslog", 80),
  },
  {
    id: "snap-004", deviceName: "Switch-Core-01", logName: "syslog", sessionId: SESSION_2,
    sessionScenario: "weekly health check", startTime: iso(1000 * 60 * 60 * 26), finishTime: iso(1000 * 60 * 60 * 26 - 60000),
    duration: 59.7, sizeKb: 33, isChart: false, dataUnit: "",
    rows: () => genTextRows("Switch-Core-01", "syslog", 95),
  },
  {
    id: "snap-005", deviceName: "Switch-Core-01", logName: "network capture", sessionId: SESSION_2,
    sessionScenario: "weekly health check", startTime: iso(1000 * 60 * 60 * 26), finishTime: iso(1000 * 60 * 60 * 26 - 60000),
    duration: 60.0, sizeKb: 410, isChart: false, dataUnit: "",
    rows: () => genPacketRows(150),
  },
  {
    id: "snap-006", deviceName: "IoT-Gateway", logName: "journalctl", sessionId: SESSION_3,
    sessionScenario: "field trial - batch 12", startTime: iso(1000 * 60 * 30), finishTime: iso(1000 * 60 * 25),
    duration: 300.2, sizeKb: 18, isChart: false, dataUnit: "",
    rows: () => genTextRows("IoT-Gateway", "journalctl", 60),
  },
  {
    id: "snap-007", deviceName: "IoT-Gateway", logName: "cpu_temp", sessionId: SESSION_3,
    sessionScenario: "field trial - batch 12", startTime: iso(1000 * 60 * 30), finishTime: iso(1000 * 60 * 25),
    duration: 300.0, sizeKb: 9, isChart: true, dataUnit: "°C",
    rows: () => genChartRows(80, 44, 6),
  },
  {
    id: "snap-008", deviceName: "Sensor-Hub-3", logName: "cpu_temp", sessionId: SESSION_1,
    sessionScenario: "pre-deploy sanity check", startTime: iso(1000 * 60 * 60 * 5), finishTime: iso(1000 * 60 * 60 * 5 - 180000),
    duration: 180.0, sizeKb: 11, isChart: true, dataUnit: "°C",
    rows: () => genChartRows(60, 38, 4),
  },
  {
    id: "snap-009", deviceName: "Router-Alpha", logName: "bandwidth", sessionId: SESSION_3,
    sessionScenario: "field trial - batch 12", startTime: iso(1000 * 60 * 30), finishTime: iso(1000 * 60 * 25),
    duration: 300.0, sizeKb: 14, isChart: true, dataUnit: "Mbps",
    rows: () => genChartRows(70, 220, 90),
  },
];

// Duplicate/extend the snapshot list a bit so pagination has something to do.
for (let i = 10; i <= 34; i++) {
  const base = DEMO_SNAPSHOTS[i % 9];
  DEMO_SNAPSHOTS.push({
    ...base,
    id: `snap-${String(i).padStart(3, "0")}`,
    startTime: iso(1000 * 60 * 60 * (24 + i)),
    finishTime: iso(1000 * 60 * 60 * (24 + i) - 120000),
  });
}

export function findSnapshot(id) {
  return DEMO_SNAPSHOTS.find((s) => s.id === id);
}
