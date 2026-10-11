// In-browser stand-in for the LogOctopus REST backend.
//
// `installMockApi()` replaces window.fetch for "/api/*" requests so the real,
// unmodified frontend (src/LogOctopus.jsx) runs with no server at all.
//
// Design notes
//  • All routes live in one table (see `on(...)` below). `npm run check:api`
//    compares that table against every /api path used in LogOctopus.jsx, so a
//    newly-added frontend endpoint can't silently go missing in the demo.
//  • State is kept in memory and mirrored to sessionStorage, so a page reload
//    (or a deep-link) keeps the visitor's work; closing the tab resets it.
//  • Row content is never stored — it is derived from snapshot ids (generators.js).

import {
  DEMO_DEVICES, DEMO_GROUPS, DEMO_DISSECTORS, DEMO_SNAPSHOTS, DEMO_SESSIONS,
  buildSnapshotsForDevice,
} from "./fixtures.js";
import * as G from "./generators.js";
import { emit } from "./events.js";
import { fmtMetaTime } from "./prng.js";

const STORAGE_KEY = "lo_demo_state";
// Bump when the *shape* of persisted state changes; the fixture counts below
// also invalidate stale state automatically when the seed data grows/shrinks.
const STATE_REV = 2;
const SIGNATURE = `${STATE_REV}.${DEMO_DEVICES.length}.${DEMO_SNAPSHOTS.length}.${Object.keys(DEMO_SESSIONS).length}`;

const clone = (x) => JSON.parse(JSON.stringify(x));
const rand = (a, b) => a + Math.random() * (b - a);
const hex12 = () => Array.from({ length: 12 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const fail = (status, message) => json({ error: message }, status);
const noContent = () => new Response(null, { status: 204 });

const hasStorage = () => {
  try { return typeof sessionStorage !== "undefined"; } catch { return false; }
};

function freshState() {
  return {
    sig: SIGNATURE,
    devices: clone(DEMO_DEVICES),
    snapshots: clone(DEMO_SNAPSHOTS),
    sessions: clone(DEMO_SESSIONS),
    groups: clone(DEMO_GROUPS),
    dissectors: clone(DEMO_DISSECTORS),
    autoCollection: {},
    password: "admin",
    counter: 0,
  };
}

function loadState() {
  if (!hasStorage()) return null;
  try {
    const s = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "null");
    return s && s.sig === SIGNATURE ? s : null;
  } catch { return null; }
}

// ── config contents (base64 data-URL, as sent by the Config Builder) ─────────
function parseConfigContents(contents) {
  const raw = String(contents ?? "");
  const b64 = raw.includes(",") ? raw.split(",")[1] : raw;
  let cfg;
  try {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    cfg = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw Object.assign(new Error("Configuration is not valid base64-encoded JSON."), { status: 422 });
  }
  if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) throw Object.assign(new Error("Configuration must be a JSON object."), { status: 422 });
  if (!cfg.device_name || typeof cfg.device_name !== "string") throw Object.assign(new Error("Configuration needs a device_name."), { status: 422 });
  if (!cfg.ip_address || typeof cfg.ip_address !== "string") throw Object.assign(new Error("Configuration needs an ip_address."), { status: 422 });
  if (!Array.isArray(cfg.log_file_configs)) cfg.log_file_configs = [];
  return cfg;
}

const deviceToDict = (d) => ({
  id: d.id,
  name: d.name,
  connection: d.connection,
  logAccess: d.logAccess,
  collecting: d.collecting,
  config: d.config,
  autoCollectionEnabled: d.autoCollectionEnabled,
  autoCollectionInterval: d.autoCollectionInterval,
});

const snapshotToDict = (s) => ({
  id: s.id,
  deviceName: s.deviceName,
  logName: s.logName,
  startTime: fmtMetaTime(s.startMs),
  finishTime: fmtMetaTime(s.finishMs),
  duration: Number(((s.finishMs - s.startMs) / 1000).toFixed(1)),
  sizeKb: s.sizeKb,
  sessionId: s.sessionId,
  sessionScenario: s.sessionScenario || "",
  isChart: !!s.isChart,
  dataUnit: s.dataUnit || "",
});

// Filter keys accepted by the "Filter by…" dropdown in the snapshots table.
const SEARCH_FIELDS = {
  "Device": (s) => s.deviceName,
  "Log Name": (s) => s.logName,
  "Session ID": (s) => s.sessionId,
  "Scenario": (s) => s.sessionScenario,
  "Started": (s) => fmtMetaTime(s.startMs),
  "Finished": (s) => fmtMetaTime(s.finishMs),
};

export function createMockApi({ latency = true, persist = true } = {}) {
  let state = (persist && loadState()) || freshState();
  const save = () => {
    if (!persist || !hasStorage()) return;
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* quota */ }
  };
  const sleep = (ms) => (latency ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());
  const findDevice = (id) => state.devices.find((d) => d.id === id);
  const findSnap = (id) => state.snapshots.find((s) => s.id === id);
  const nextSnapId = () => `snap-r${(++state.counter).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

  // simple, smoothly-wandering host stats
  let cpu = 34, ram = 38;

  // ── route table ────────────────────────────────────────────────────────────
  const routes = [];
  const on = (method, pattern, handler) => {
    const names = [];
    const re = new RegExp("^" + pattern.replace(/:([a-zA-Z_]+)/g, (_, n) => { names.push(n); return "([^/]+)"; }) + "$");
    routes.push({ method, pattern, re, names, handler });
  };

  // system ───────────────────────────────────────────────────────────────────
  on("GET", "/api/system/stats", () => {
    cpu = clamp(cpu + rand(-7, 7), 12, 78);
    ram = clamp(ram + rand(-1.5, 1.5), 30, 62);
    return {
      cpuPercent: Number(cpu.toFixed(1)),
      ramPercent: Number(ram.toFixed(1)),
      ramUsedGb: Number(((ram / 100) * 16).toFixed(1)),
      ramTotalGb: 16.0,
      diskPercent: 58.1,
      diskUsedGb: 232.4,
      diskTotalGb: 400.0,
    };
  });

  // devices ──────────────────────────────────────────────────────────────────
  on("GET", "/api/devices", () => state.devices.map(deviceToDict));

  on("POST", "/api/devices", ({ body }) => {
    const cfg = parseConfigContents(body?.contents);
    if (state.devices.some((d) => d.name.toLowerCase() === cfg.device_name.toLowerCase()))
      return fail(409, `A device named "${cfg.device_name}" already exists.`);
    const device = {
      id: `dev-${Math.random().toString(36).slice(2, 10)}`,
      name: cfg.device_name,
      connection: true,
      logAccess: true,
      collecting: false,
      autoCollectionEnabled: false,
      autoCollectionInterval: 1,
      config: cfg,
      errors: [],
    };
    state.devices.push(device);
    save(); emit("buildConfig");
    return json({ device: deviceToDict(device) }, 201);
  });

  on("POST", "/api/devices/test-connection", async ({ body }) => {
    await sleep(700);
    const { ip_address: ip, port, user, gateways } = body || {};
    if (!ip || !user) return { success: false, message: "IP address and user are required." };
    const known = state.devices.find((d) => d.config?.ip_address === ip);
    if (known && !known.connection)
      return { success: false, message: `Connection to ${ip}:${port || 22} timed out after 10s (this device is simulated as offline).` };
    const hops = Array.isArray(gateways) && gateways.length ? ` via ${gateways.length} gateway hop${gateways.length > 1 ? "s" : ""}` : "";
    return { success: true, message: `Connected to ${ip}:${port || 22} as ${user}${hops} (demo mode — simulated)` };
  });

  on("POST", "/api/devices/exec-command", async ({ body }) => {
    await sleep(450);
    return G.simulateShell({ command: body?.command, user: body?.user, host: body?.ip_address });
  });

  on("GET", "/api/devices/:id/errors", ({ params }) => {
    const d = findDevice(params.id);
    return d ? { errors: d.errors || [] } : fail(404, "Device not found.");
  });

  on("GET", "/api/devices/:id", ({ params }) => {
    const d = findDevice(params.id);
    return d ? deviceToDict(d) : fail(404, "Device not found.");
  });

  on("PUT", "/api/devices/:id", ({ params, body }) => {
    const d = findDevice(params.id);
    if (!d) return fail(404, "Device not found.");
    const cfg = parseConfigContents(body?.contents);
    if (state.devices.some((x) => x.id !== d.id && x.name.toLowerCase() === cfg.device_name.toLowerCase()))
      return fail(409, `A device named "${cfg.device_name}" already exists.`);
    d.name = cfg.device_name;
    d.config = d.config?.current_session_id ? { ...cfg, current_session_id: d.config.current_session_id } : cfg;
    save(); emit("buildConfig");
    return { device: deviceToDict(d) };
  });

  on("DELETE", "/api/devices/:id", ({ params }) => {
    const i = state.devices.findIndex((d) => d.id === params.id);
    if (i === -1) return fail(404, "Device not found.");
    state.devices.splice(i, 1);
    state.groups.forEach((g) => { g.deviceIds = g.deviceIds.filter((id) => id !== params.id); });
    save();
    return noContent();
  });

  // snapshots ────────────────────────────────────────────────────────────────
  on("GET", "/api/snapshots", ({ query }) => {
    const wantChart = query.get("log_type") === "chart";
    const page = Math.max(1, parseInt(query.get("page") || "1", 10));
    const pageSize = clamp(parseInt(query.get("page_size") || "25", 10) || 25, 1, 10000);
    const param = query.get("search_param");
    const value = (query.get("search_value") || "").toLowerCase();

    let list = state.snapshots.filter((s) => !!s.isChart === wantChart);
    const pick = SEARCH_FIELDS[param];
    if (pick && value) list = list.filter((s) => String(pick(s) ?? "").toLowerCase().includes(value));
    list = [...list].sort((a, b) => b.startMs - a.startMs);

    const total = list.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const p = Math.min(page, totalPages);
    return {
      items: list.slice((p - 1) * pageSize, p * pageSize).map(snapshotToDict),
      total, page: p, page_size: pageSize, total_pages: totalPages,
    };
  });

  on("DELETE", "/api/snapshots", ({ body }) => {
    const removed = [], notFound = [];
    for (const id of body?.snapshot_ids || []) {
      const i = state.snapshots.findIndex((s) => s.id === id);
      if (i === -1) notFound.push(id);
      else { state.snapshots.splice(i, 1); removed.push(id); }
    }
    save();
    return { removed, not_found: notFound };
  });

  on("GET", "/api/snapshots/:id/content", async ({ params, query }) => {
    const s = findSnap(params.id);
    const wantChart = query.get("log_type") === "chart";
    if (!s || !!s.isChart !== wantChart) return fail(404, "Snapshot not found.");
    await sleep(Math.min(600, 120 + s.rowCount * 0.6));
    if (s.kind === "chart") { emit("openCharts"); return { rows: G.genChartRows(s) }; }
    if (s.kind === "pcap") { emit("openCapture"); return { rows: G.genPacketRows(s) }; }
    return { rows: G.genTextRows(s) };
  });

  on("GET", "/api/snapshots/:id/packets/:n", ({ params }) => {
    const s = findSnap(params.id);
    if (!s || s.kind !== "pcap") return fail(404, "Snapshot is not a network capture.");
    const n = parseInt(params.n, 10);
    const details = G.genPacketDetails(s, n);
    if (!details) return fail(404, `Packet ${n} not found in this capture.`);
    emit("inspectPacket");
    return { packet_number: n, details };
  });

  on("GET", "/api/snapshots/:id/pcap", ({ params }) => {
    const s = findSnap(params.id);
    if (!s || s.kind !== "pcap") return fail(404, "Snapshot is not a network capture.");
    return new Response(G.buildPcap(s), {
      status: 200,
      headers: { "Content-Type": "application/vnd.tcpdump.pcap", "Content-Disposition": `attachment; filename="${s.deviceName}_${s.sessionId}.pcap"` },
    });
  });

  // log collection ───────────────────────────────────────────────────────────
  on("POST", "/api/start-logs-collection", async ({ body }) => {
    const ids = body?.selected_devices || [];
    const scenario = String(body?.session_scenario || "").trim() || "unnamed session";
    const targets = state.devices.filter((d) => ids.includes(d.id));
    if (!targets.length) return fail(400, "No valid devices selected.");
    const eligible = targets.filter((d) => d.connection && !d.collecting);
    if (!eligible.length)
      return fail(409, targets.every((d) => d.collecting) ? "The selected devices are already collecting." : "None of the selected devices is reachable right now.");

    const sessionId = hex12();
    state.sessions[sessionId] = { id: sessionId, scenario, startedAt: Date.now(), deviceIds: eligible.map((d) => d.id) };
    for (const d of eligible) {
      d.collecting = true;
      d.config = { ...d.config, current_session_id: sessionId };
    }
    save(); emit("startCollection");
    await sleep(350);
    return { status: "logs collection started", session_id: sessionId };
  });

  on("POST", "/api/stop-logs-collection", async ({ body }) => {
    const ids = body?.selected_devices || [];
    const targets = state.devices.filter((d) => ids.includes(d.id) && d.collecting);
    if (!targets.length) return fail(409, "None of the selected devices is collecting.");

    const now = Date.now();
    const jobs = [];
    for (const d of targets) {
      const sid = d.config?.current_session_id || body?.session_id || hex12();
      const session = state.sessions[sid] || (state.sessions[sid] = { id: sid, scenario: "demo session", startedAt: now - 60000, deviceIds: [d.id] });
      const startMs = Math.min(session.startedAt, now - 4000);
      jobs.push(...buildSnapshotsForDevice({ device: d, session, startMs, finishMs: now, nextId: nextSnapId }));
    }
    const primarySession = body?.session_id || targets[0].config?.current_session_id || jobs[0]?.sessionId || hex12();

    // Persist snapshots one at a time, like a real teardown, so the app's
    // "saving snapshots… 3/7" progress overlay has something to show.
    const perSnap = Math.min(600, 4200 / Math.max(1, jobs.length));
    for (const meta of jobs) {
      await sleep(perSnap);
      state.snapshots.push(meta);
    }
    for (const d of targets) {
      d.collecting = false;
      const { current_session_id: _gone, ...rest } = d.config || {};
      d.config = rest;
    }
    save(); emit("stopCollection");

    const base = typeof location !== "undefined" ? `${location.origin}${location.pathname}` : "http://localhost/";
    const qs = `search_param=Session%20ID&search_value=${primarySession}`;
    return {
      status: "logs collection stopped",
      session_id: primarySession,
      text_logs_url: `${base}?${qs}&log_type=text`,
      chart_logs_url: `${base}?${qs}&log_type=chart`,
    };
  });

  // settings ─────────────────────────────────────────────────────────────────
  on("GET", "/api/settings/auto-collection", () => ({
    devices: state.devices.map((d) => ({ device_id: d.id, enabled: !!d.autoCollectionEnabled, interval_hours: d.autoCollectionInterval || 1 })),
  }));

  on("POST", "/api/settings/auto-collection", ({ body }) => {
    const enabled = !!body?.enabled;
    const interval = Number(body?.interval_hours || 1);
    const updated = [];
    for (const id of body?.device_ids || []) {
      const d = findDevice(id);
      if (!d) continue;
      d.autoCollectionEnabled = enabled;
      d.autoCollectionInterval = interval;
      updated.push({ device_id: id, enabled, interval_hours: interval });
    }
    save();
    return { status: "ok", devices: updated };
  });

  on("GET", "/api/settings/device-groups", () => state.groups);

  on("PUT", "/api/settings/device-groups", ({ body }) => {
    if (!Array.isArray(body?.groups)) return fail(422, "Body must be { groups: [...] }.");
    state.groups = body.groups
      .filter((g) => g && typeof g.id === "string" && typeof g.name === "string")
      .map((g) => ({ id: g.id, name: g.name, deviceIds: Array.isArray(g.deviceIds) ? g.deviceIds : [] }));
    save();
    return { status: "ok", groups: state.groups };
  });

  on("GET", "/api/settings/dissectors", () => state.dissectors);

  on("POST", "/api/settings/dissectors", async ({ form }) => {
    const file = form?.get?.("file");
    if (!file || !file.name) return fail(400, "No file provided.");
    const dot = file.name.lastIndexOf(".");
    const entry = { name: file.name, size_bytes: file.size ?? 0, extension: dot >= 0 ? file.name.slice(dot).toLowerCase() : "" };
    state.dissectors = [...state.dissectors.filter((d) => d.name !== entry.name), entry];
    save();
    await sleep(250);
    return json(entry, 201);
  });

  on("DELETE", "/api/settings/dissectors/:name", ({ params }) => {
    const name = decodeURIComponent(params.name);
    const before = state.dissectors.length;
    state.dissectors = state.dissectors.filter((d) => d.name !== name);
    save();
    return { deleted: state.dissectors.length < before };
  });

  on("POST", "/api/settings/change-password", ({ body }) => {
    if (!body?.new_password) return fail(422, "new_password is required.");
    state.password = String(body.new_password);
    save();
    return { status: "ok" };
  });

  // auth ─────────────────────────────────────────────────────────────────────
  on("POST", "/api/auth/login", async ({ body }) => {
    await sleep(250);
    const { username, password } = body || {};
    if (username !== "admin" || password !== state.password) return fail(401, "invalid credentials");
    emit("signIn");
    return { status: "ok", token: Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("") };
  });

  on("POST", "/api/auth/logout", () => ({ status: "ok" }));

  // ── dispatcher ─────────────────────────────────────────────────────────────
  async function handle(input, init = {}) {
    const url = input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url, "http://localhost");
    const method = String(init.method || (typeof input === "object" && input.method) || "GET").toUpperCase();
    const route = routes.find((r) => r.method === method && r.re.test(url.pathname));
    if (!route) {
      const otherMethod = routes.some((r) => r.re.test(url.pathname));
      return fail(otherMethod ? 405 : 404, `demo mock has no handler for ${method} ${url.pathname}`);
    }

    const m = route.re.exec(url.pathname);
    const params = Object.fromEntries(route.names.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
    let body = null, form = null;
    if (typeof FormData !== "undefined" && init.body instanceof FormData) form = init.body;
    else if (typeof init.body === "string" && init.body) { try { body = JSON.parse(init.body); } catch { body = null; } }

    await sleep(rand(110, 300));
    try {
      const out = await route.handler({ params, query: url.searchParams, body, form, method });
      return out instanceof Response ? out : json(out);
    } catch (e) {
      return fail(e.status || 500, e.message || "demo mock error");
    }
  }

  return {
    handle,
    routes,
    getState: () => state,
    reset() {
      state = freshState();
      if (persist && hasStorage()) { try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ } }
    },
  };
}

// ── browser install ──────────────────────────────────────────────────────────
let installed = null;

export function installMockApi(opts) {
  if (installed) return installed;
  installed = createMockApi(opts);
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    let url;
    try {
      url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, window.location.href);
    } catch {
      return realFetch(input, init);
    }
    // Only our own API is faked; CDN scripts (Plotly, Monaco, fonts) pass straight through.
    if (!url.pathname.startsWith("/api/")) return realFetch(input, init);
    const fromRequest = typeof input === "object" && !(input instanceof URL) ? { method: input.method } : {};
    return installed.handle(url, { ...fromRequest, ...(init || {}) });
  };
  return installed;
}

export const getMockApi = () => installed;
