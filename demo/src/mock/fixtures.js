// Fake-but-realistic data for the LogOctopus demo.
//
// Shapes mirror what the real backend returns (see the REST API docs inside the
// app): device.config uses the real config schema (device_name, log_file_configs,
// packets_capture_config, nested gateway…), `connection` is a boolean, and
// snapshot rows are generated on demand from a seed (see generators.js).
//
// Nothing here talks to a network.

import { fmtMetaTime, rngFor } from "./prng.js";

const HOUR = 3_600_000;
const MIN = 60_000;
export const NOW = Date.now();

// ── log entry helpers ────────────────────────────────────────────────────────
const text = (log_name, log_file_cmd, data_extraction_regex, description, extra = {}) => ({
  log_name, log_file_cmd, data_extraction_regex, log_type: "text", description, ...extra,
});
const chart = (log_name, log_file_cmd, data_unit, description, extra = {}) => ({
  log_name, log_file_cmd, data_extraction_regex: "^(?P<ENTRY>-?[\\d.]+)$", log_type: "chart", data_unit, description, ...extra,
});

const SYSLOG_RE = "^(?P<TIME>\\w{3}\\s+\\d+\\s[\\d:]+)\\s(?P<ENTRY>.*)$";
const JOURNAL_RE = "^(?P<TIME>\\d{4}-\\d{2}-\\d{2}T[\\d:+]+)\\s(?P<ENTRY>.*)$";
const DMESG_RE = "^\\[\\s*(?P<TIME>[\\d.]+)\\](?P<ENTRY>.*)$";

const syslog = () => text("syslog", "tail -n 0 -F /var/log/syslog", SYSLOG_RE, "System messages");
const journalctl = () => text("journalctl", "journalctl -f -n 0 -o short-iso", JOURNAL_RE, "systemd journal");
const dmesg = () => text("dmesg", "dmesg --follow --nopager", DMESG_RE, "Kernel ring buffer");
const cpuTemp = () =>
  chart("cpu_temp", "awk '{print $1/1000}' /sys/class/thermal/thermal_zone0/temp", "°C", "SoC temperature");

// ── devices ──────────────────────────────────────────────────────────────────
const LIVE_SESSION_ID = "c0ffee5e5510";

function device(id, name, o) {
  const config = {
    device_name: name,
    ip_address: o.ip,
    port: 22,
    user: o.user,
    collection_interval: o.interval ?? 30,
    log_file_configs: o.logs,
    ...(o.gateway ? { gateway: o.gateway } : {}),
    ...(o.capture ? { packets_capture_config: o.capture } : {}),
  };
  return {
    id,
    name,
    connection: o.online !== false,
    logAccess: o.online !== false,
    collecting: false,
    autoCollectionEnabled: !!o.auto,
    autoCollectionInterval: o.auto || 1,
    config,
    errors: o.errors || [],
  };
}

export const DEMO_DEVICES = [
  device("dev-router-alpha", "Router-Alpha", {
    ip: "10.0.1.11", user: "netadmin", auto: 4,
    logs: [
      syslog(), journalctl(), dmesg(),
      chart("bandwidth", "ifstat -i eth0 -q 1 1 | tail -1 | awk '{print ($2*8)/1000}'", "Mbps", "WAN throughput"),
    ],
    errors: [
      { time: fmtMetaTime(NOW - 31 * HOUR), error_info: "Log command 'dmesg --follow --nopager' exited with status 1 (permission denied) — retried with sudo" },
    ],
  }),
  device("dev-router-beta", "Router-Beta", {
    ip: "10.0.1.12", user: "netadmin",
    logs: [
      syslog(), journalctl(),
      chart("link_latency", "ping -c1 -W1 10.0.1.1 | sed -n 's/.*time=\\([0-9.]*\\) ms/\\1/p'", "ms", "Latency to upstream gateway"),
    ],
  }),
  device("dev-switch-core", "Switch-Core-01", {
    ip: "10.0.0.2", user: "admin",
    logs: [syslog(), cpuTemp()],
    capture: {
      capture_start_cmd: "tcpdump -i any -U -w -",
      capture_stop_cmd: "pkill -INT -f 'tcpdump -i any'",
      capture_description: "Core uplink capture",
      max_pcap_size_mb: 64,
    },
  }),
  device("dev-firewall", "Firewall-Edge", {
    ip: "10.0.0.1", user: "fwadmin", online: false,
    logs: [
      syslog(),
      text("firewall", "tail -n 0 -F /var/log/ufw.log", SYSLOG_RE, "Packet filter decisions"),
    ],
    errors: [
      { time: fmtMetaTime(NOW - 4 * MIN), error_info: "SSH connection to 10.0.0.1:22 timed out after 10s" },
      { time: fmtMetaTime(NOW - 34 * MIN), error_info: "SSH connection to 10.0.0.1:22 timed out after 10s" },
      { time: fmtMetaTime(NOW - 64 * MIN), error_info: "Authentication failed for user 'fwadmin' (publickey)" },
    ],
  }),
  device("dev-iot-gw", "IoT-Gateway", {
    ip: "10.0.2.5", user: "iot", auto: 12,
    gateway: { ip_address: "10.0.0.250", port: 22, user: "jump" },
    logs: [
      journalctl(), cpuTemp(),
      chart("link_state", "cat /run/uplink.state", "", "Uplink state (up / degraded / down)"),
    ],
  }),
  device("dev-sensor-hub", "Sensor-Hub-3", {
    ip: "10.0.2.9", user: "sensor",
    gateway: { ip_address: "10.0.0.250", port: 22, user: "jump" },
    logs: [
      cpuTemp(),
      chart("humidity", "cat /sys/bus/iio/devices/iio:device0/in_humidityrelative_input", "%", "Relative humidity"),
      chart("rssi", "iw dev wlan0 link | awk '/signal/ {print $2}'", "dBm", "Wi-Fi signal strength"),
    ],
    capture: {
      capture_start_cmd: "tcpdump -i wlan0 -U -w -",
      capture_stop_cmd: "pkill -INT -f 'tcpdump -i wlan0'",
      capture_description: "Sensor uplink (MQTT)",
    },
  }),
];

// Two devices are mid-collection when the demo loads, so the UI opens in a
// lively state (pulsing "Collecting" pills, animated packet-capture icon).
for (const d of DEMO_DEVICES) {
  if (d.id === "dev-router-alpha" || d.id === "dev-switch-core") {
    d.collecting = true;
    d.config.current_session_id = LIVE_SESSION_ID;
  }
}

export const DEMO_GROUPS = [
  { id: "grp-core", name: "Core network", deviceIds: ["dev-router-alpha", "dev-router-beta", "dev-switch-core", "dev-firewall"] },
  { id: "grp-field", name: "Field devices", deviceIds: ["dev-iot-gw", "dev-sensor-hub"] },
];

export const DEMO_DISSECTORS = [
  { name: "custom_iot.lua", size_bytes: 2148, extension: ".lua" },
  { name: "sparkplug_b.lua", size_bytes: 5632, extension: ".lua" },
];

// ── snapshots ────────────────────────────────────────────────────────────────

// Per-session history. `ageH` = hours before "now" the session started.
const HISTORY = [
  { id: "8cd7112719ac", scenario: "pre-deploy sanity check",         ageH: 5,   durS: 180,  devices: ["dev-router-alpha", "dev-router-beta", "dev-sensor-hub"] },
  { id: "44b2e0a1c9df", scenario: "weekly health check",             ageH: 26,  durS: 600,  devices: ["dev-router-alpha", "dev-router-beta", "dev-switch-core", "dev-iot-gw", "dev-sensor-hub"] },
  { id: "f01a9c3e7b22", scenario: "field trial - batch 12",          ageH: 51,  durS: 900,  devices: ["dev-iot-gw", "dev-sensor-hub"] },
  { id: "a7d3395e0b14", scenario: "BGP flap investigation",          ageH: 74,  durS: 1200, devices: ["dev-router-alpha", "dev-router-beta", "dev-switch-core"] },
  { id: "19be6c20f7a8", scenario: "firmware 2.4.1 soak test",        ageH: 98,  durS: 3600, devices: ["dev-router-beta", "dev-switch-core", "dev-iot-gw"] },
  { id: "5e0c8d4a31f9", scenario: "scheduled run (auto-collection)", ageH: 121, durS: 300,  devices: ["dev-router-alpha", "dev-iot-gw"] },
  { id: "d92f04b6c7e1", scenario: "DHCP storm repro",                ageH: 146, durS: 420,  devices: ["dev-router-beta", "dev-firewall"] },
  { id: "73ac1e58b0d2", scenario: "post-incident capture",           ageH: 195, durS: 300,  devices: ["dev-switch-core", "dev-router-alpha"] },
  { id: "0b6f5d19a4c3", scenario: "baseline measurement",            ageH: 262, durS: 1800, devices: DEMO_DEVICES.map((d) => d.id) },
];

// How many rows a freshly-generated log has, by kind and duration.
const TEXT_RATE = { syslog: 0.8, journalctl: 0.6, dmesg: 0.12, firewall: 1.4 };
export function rowCountFor(kind, logName, durS) {
  if (kind === "pcap") return Math.max(150, Math.min(900, Math.round(durS * 1.2)));
  if (kind === "chart") return Math.max(24, Math.min(200, Math.round(durS / 5)));
  const rate = TEXT_RATE[logName] ?? 0.5;
  return Math.max(30, Math.min(700, Math.round(durS * rate)));
}
export function sizeKbFor(kind, rows) {
  const perRow = kind === "pcap" ? 0.34 : kind === "chart" ? 0.03 : 0.11;
  return Math.max(1, Math.round(rows * perRow));
}

/** Which "traffic profile" the packet generator should use for a device. */
export function profileFor(deviceLike) {
  const hay = `${deviceLike?.name || ""} ${deviceLike?.config?.packets_capture_config?.capture_description || ""}`;
  return /sensor|iot|gateway|mqtt/i.test(hay) ? "iot" : "core";
}

/**
 * Builds the snapshot metadata records one device produces in one session:
 * one per log_file_configs entry, plus a "network capture" if configured.
 * Row content is NOT stored — generators.js derives it from `id` + these fields.
 */
export function buildSnapshotsForDevice({ device: d, session, startMs, finishMs, nextId }) {
  const rng = rngFor(`${session.id}:${d.id}`);
  const base = {
    deviceId: d.id,
    deviceName: d.name,
    sessionId: session.id,
    sessionScenario: session.scenario,
    profile: profileFor(d),
  };
  const out = [];
  const mk = (kind, logName, dataUnit) => {
    const s = startMs + rng.int(0, 1800);
    const f = Math.max(s + 1000, finishMs - rng.int(0, 1800));
    const rows = rowCountFor(kind, logName, (f - s) / 1000);
    out.push({
      ...base,
      id: nextId(),
      kind,
      isChart: kind === "chart",
      logName,
      dataUnit,
      startMs: s,
      finishMs: f,
      rowCount: rows,
      sizeKb: sizeKbFor(kind, rows),
    });
  };
  for (const e of d.config?.log_file_configs || []) {
    mk(e.log_type === "chart" ? "chart" : "text", e.log_name, e.data_unit || "");
  }
  if (d.config?.packets_capture_config) mk("pcap", "network capture", "");
  return out;
}

function seedHistory() {
  let n = 0;
  const nextId = () => `snap-${String(++n).padStart(4, "0")}`;
  const metas = [];
  const sessions = {};
  for (const h of HISTORY) {
    const startMs = NOW - h.ageH * HOUR;
    sessions[h.id] = { id: h.id, scenario: h.scenario, startedAt: startMs, deviceIds: h.devices };
    for (const id of h.devices) {
      const d = DEMO_DEVICES.find((x) => x.id === id);
      metas.push(...buildSnapshotsForDevice({ device: d, session: sessions[h.id], startMs, finishMs: startMs + h.durS * 1000, nextId }));
    }
  }
  return { metas, sessions };
}

const seeded = seedHistory();
export const DEMO_SNAPSHOTS = seeded.metas;

export const DEMO_SESSIONS = {
  ...seeded.sessions,
  [LIVE_SESSION_ID]: {
    id: LIVE_SESSION_ID,
    scenario: "live soak test",
    startedAt: NOW - 14 * MIN,
    deviceIds: ["dev-router-alpha", "dev-switch-core"],
  },
};

/** Deep-link targets for the guided tour (stable ids from the seed above). */
export const SAMPLE_LINKS = (() => {
  const newest = (pred) => DEMO_SNAPSHOTS.filter(pred).sort((a, b) => b.startMs - a.startMs)[0];
  const capture = newest((s) => s.kind === "pcap" && s.profile === "core");
  const chartSnap = newest((s) => s.isChart && s.deviceId === "dev-sensor-hub");
  const charts = DEMO_SNAPSHOTS
    .filter((s) => s.isChart && s.sessionId === chartSnap.sessionId && s.deviceId === "dev-sensor-hub")
    .map((s) => s.id);
  return { captureId: capture.id, chartIds: charts };
})();
