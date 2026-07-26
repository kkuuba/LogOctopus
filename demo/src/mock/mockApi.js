import { DEMO_DEVICES, DEMO_SNAPSHOTS, findSnapshot } from "./fixtures.js";

// ── in-memory "database", reset on page reload ────────────────────────────────
const state = {
  devices: DEMO_DEVICES.map((d) => ({ ...d, config: { ...d.config } })),
  snapshots: DEMO_SNAPSHOTS.map((s) => ({ ...s })),
  dissectors: [
    { name: "custom_iot.lua", size_bytes: 2148, extension: ".lua" },
  ],
  authTokens: [],
  autoCollection: Object.fromEntries(
    DEMO_DEVICES.map((d) => [d.id, { enabled: !!d.autoCollectionEnabled, interval_hours: d.autoCollectionInterval || 1 }])
  ),
};

const DEMO_USER = "admin";
const DEMO_PASS = "admin";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

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
  startTime: s.startTime,
  finishTime: s.finishTime,
  duration: s.duration,
  sizeKb: s.sizeKb,
  sessionId: s.sessionId,
  sessionScenario: s.sessionScenario || "",
  isChart: s.isChart,
  dataUnit: s.dataUnit || "",
});

// small artificial latency so loading states are visible, like a real API
const delay = (ms = 220 + Math.random() * 260) => new Promise((r) => setTimeout(r, ms));

async function route(pathname, search, method, body) {
  const params = new URLSearchParams(search);

  // ── system ──────────────────────────────────────────────────────────────
  if (pathname === "/api/system/stats" && method === "GET") {
    const wobble = () => 20 + Math.random() * 45;
    return json({
      cpuPercent: Number(wobble().toFixed(1)),
      ramPercent: Number((35 + Math.random() * 20).toFixed(1)),
      ramUsedGb: 5.6,
      ramTotalGb: 16.0,
      diskPercent: 58.1,
      diskUsedGb: 232.4,
      diskTotalGb: 400.0,
    });
  }

  // ── devices ─────────────────────────────────────────────────────────────
  if (pathname === "/api/devices" && method === "GET") {
    return json(state.devices.map(deviceToDict));
  }
  if (pathname === "/api/devices" && method === "POST") {
    const newDevice = {
      id: `dev-demo-${Math.random().toString(36).slice(2, 8)}`,
      name: `New-Device-${state.devices.length + 1}`,
      connection: "disconnected",
      logAccess: false,
      collecting: false,
      autoCollectionEnabled: false,
      autoCollectionInterval: 1,
      config: { ip_address: "0.0.0.0", port: 22, user: "demo", note: "Imported in demo mode — not a real connection." },
    };
    state.devices.push(newDevice);
    return json({ device: deviceToDict(newDevice) }, 201);
  }
  let m;
  if ((m = pathname.match(/^\/api\/devices\/([^/]+)\/errors$/)) && method === "GET") {
    return json({
      errors: [
        { time: new Date().toISOString(), error_info: "demo mode: no real error log — this is placeholder data" },
      ],
    });
  }
  if ((m = pathname.match(/^\/api\/devices\/([^/]+)$/)) && method === "GET") {
    const dev = state.devices.find((d) => d.id === m[1]);
    if (!dev) return json({ error: "not_found" }, 404);
    return json(deviceToDict(dev));
  }
  if ((m = pathname.match(/^\/api\/devices\/([^/]+)$/)) && method === "DELETE") {
    const idx = state.devices.findIndex((d) => d.id === m[1]);
    if (idx === -1) return json({ error: "not_found" }, 404);
    state.devices.splice(idx, 1);
    return new Response(null, { status: 204 });
  }
  if (pathname === "/api/devices/test-connection" && method === "POST") {
    await delay(500);
    return json({ success: true, message: `Connected to ${body?.ip_address || "device"}:${body?.port || 22} as ${body?.user || "user"} (demo mode — simulated)` });
  }
  if (pathname === "/api/devices/exec-command" && method === "POST") {
    await delay(400);
    const cmd = (body?.command || "").trim();
    return json({
      stdout: `demo@${body?.ip_address || "device"}:~$ ${cmd}\n[demo mode] simulated output — no real device is connected.\nExit status 0.`,
      stderr: "",
      exit_code: 0,
    });
  }

  // ── snapshots ───────────────────────────────────────────────────────────
  if (pathname === "/api/snapshots" && method === "GET") {
    const searchParam = params.get("search_param");
    const searchValue = params.get("search_value");
    const isChart = params.get("log_type") === "chart";
    const page = Math.max(1, parseInt(params.get("page") || "1", 10));
    const pageSize = Math.max(1, Math.min(500, parseInt(params.get("page_size") || "25", 10)));

    let list = state.snapshots.filter((s) => Boolean(s.isChart) === isChart);
    if (searchParam && searchValue) {
      const key = { Device: "deviceName", "Log Name": "logName", "Session ID": "sessionId" }[searchParam];
      if (key) {
        const needle = searchValue.toLowerCase();
        list = list.filter((s) => String(s[key] || "").toLowerCase().includes(needle));
      }
    }
    list = [...list].sort((a, b) => new Date(b.startTime) - new Date(a.startTime));

    const total = list.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const clampedPage = Math.min(page, totalPages);
    const start = (clampedPage - 1) * pageSize;
    const items = list.slice(start, start + pageSize).map(snapshotToDict);

    return json({ items, total, page: clampedPage, page_size: pageSize, total_pages: totalPages });
  }
  if (pathname === "/api/snapshots" && method === "DELETE") {
    const ids = body?.snapshot_ids || [];
    const removed = [];
    const notFound = [];
    for (const id of ids) {
      const idx = state.snapshots.findIndex((s) => s.id === id);
      if (idx === -1) { notFound.push(id); continue; }
      state.snapshots.splice(idx, 1);
      removed.push(id);
    }
    return json({ removed, not_found: notFound });
  }
  if ((m = pathname.match(/^\/api\/snapshots\/([^/]+)\/content$/)) && method === "GET") {
    const snap = findSnapshot(m[1]) || state.snapshots.find((s) => s.id === m[1]);
    if (!snap) return json({ error: "not_found" }, 404);
    await delay(300);
    return json({ rows: snap.rows() });
  }
  if ((m = pathname.match(/^\/api\/snapshots\/([^/]+)\/packets\/(\d+)$/)) && method === "GET") {
    const snap = findSnapshot(m[1]);
    if (!snap || snap.logName !== "network capture") return json({ error: "not_found" }, 404);
    const packetNumber = Number(m[2]);
    return json({
      packet_number: packetNumber,
      details: {
        "Frame": { "Frame Number": String(packetNumber), "Frame Length": "128 bytes", "Capture Length": "128 bytes" },
        "Ethernet II": { "Source": "aa:bb:cc:dd:ee:ff", "Destination": "11:22:33:44:55:66" },
        "Internet Protocol": { "Source": "10.0.1.11", "Destination": "10.0.1.1", "TTL": "64", "Protocol": "TCP" },
        "Transmission Control Protocol": { "Source Port": "443", "Destination Port": String(40000 + packetNumber), "Sequence Number": String(packetNumber), "Flags": "ACK" },
      },
    });
  }
  if ((m = pathname.match(/^\/api\/snapshots\/([^/]+)\/pcap$/)) && method === "GET") {
    return json({ error: "pcap download isn't available in the hosted demo — this endpoint streams a real file from disk in the full app." }, 404);
  }

  // ── log collection ──────────────────────────────────────────────────────
  if (pathname === "/api/start-logs-collection" && method === "POST") {
    const ids = body?.selected_devices || [];
    const sessionId = Math.random().toString(16).slice(2, 14);
    state.devices.forEach((d) => { if (ids.includes(d.id)) d.collecting = true; });
    await delay(300);
    return json({ status: "logs collection started", session_id: sessionId });
  }
  if (pathname === "/api/stop-logs-collection" && method === "POST") {
    const ids = body?.selected_devices || [];
    const sessionId = body?.session_id || Math.random().toString(16).slice(2, 14);
    state.devices.forEach((d) => {
      if (ids.includes(d.id)) {
        d.collecting = false;
        state.snapshots.unshift({
          id: `snap-live-${Math.random().toString(36).slice(2, 8)}`,
          deviceName: d.name,
          logName: "syslog",
          sessionId,
          sessionScenario: body?.session_scenario || "demo session",
          startTime: new Date(Date.now() - 60000).toISOString().replace("T", " ").slice(0, 19),
          finishTime: new Date().toISOString().replace("T", " ").slice(0, 19),
          duration: 60,
          sizeKb: 12,
          isChart: false,
          dataUnit: "",
          rows: () => [
            { timestamp: new Date().toISOString(), log_name: "syslog", content: `[${d.name}] [syslog] INFO demo collection session ${sessionId} captured` },
          ],
        });
      }
    });
    await delay(600);
    const qs = `search_param=Session%20ID&search_value=${sessionId}`;
    return json({
      status: "logs collection stopped",
      session_id: sessionId,
      text_logs_url: `${location.origin}${location.pathname}?${qs}&log_type=text`,
      chart_logs_url: `${location.origin}${location.pathname}?${qs}&log_type=chart`,
    });
  }

  // ── auto-collection ─────────────────────────────────────────────────────
  if (pathname === "/api/settings/auto-collection" && method === "GET") {
    return json({
      devices: state.devices.map((d) => ({
        device_id: d.id,
        enabled: state.autoCollection[d.id]?.enabled ?? false,
        interval_hours: state.autoCollection[d.id]?.interval_hours ?? 1,
      })),
    });
  }
  if (pathname === "/api/settings/auto-collection" && method === "POST") {
    const enabled = !!body?.enabled;
    const interval = Number(body?.interval_hours || 1);
    const ids = body?.device_ids || [];
    const updated = [];
    ids.forEach((id) => {
      state.autoCollection[id] = { enabled, interval_hours: interval };
      const dev = state.devices.find((d) => d.id === id);
      if (dev) { dev.autoCollectionEnabled = enabled; dev.autoCollectionInterval = interval; }
      updated.push({ device_id: id, enabled, interval_hours: interval });
    });
    return json({ status: "ok", devices: updated });
  }

  // ── dissectors ───────────────────────────────────────────────────────────
  if (pathname === "/api/settings/dissectors" && method === "GET") {
    return json(state.dissectors);
  }
  if (pathname === "/api/settings/dissectors" && method === "POST") {
    // multipart form in the real app; demo just fabricates an entry
    const name = `uploaded_${Date.now()}.lua`;
    const entry = { name, size_bytes: 1024, extension: ".lua" };
    state.dissectors.push(entry);
    return json(entry, 201);
  }
  if ((m = pathname.match(/^\/api\/settings\/dissectors\/([^/]+)$/)) && method === "DELETE") {
    const idx = state.dissectors.findIndex((f) => f.name === decodeURIComponent(m[1]));
    if (idx === -1) return json({ deleted: false });
    state.dissectors.splice(idx, 1);
    return json({ deleted: true });
  }
  if (pathname === "/api/settings/change-password" && method === "POST") {
    return json({ status: "ok" });
  }

  // ── auth ────────────────────────────────────────────────────────────────
  if (pathname === "/api/auth/login" && method === "POST") {
    await delay(300);
    const { username, password } = body || {};
    if (username !== DEMO_USER || password !== DEMO_PASS) {
      return json({ error: "invalid credentials" }, 401);
    }
    const token = Math.random().toString(16).slice(2).padEnd(32, "0");
    state.authTokens = [...state.authTokens, token].slice(-10);
    return json({ status: "ok", token });
  }
  if (pathname === "/api/auth/logout" && method === "POST") {
    state.authTokens = state.authTokens.filter((t) => t !== body?.token);
    return json({ status: "ok" });
  }

  return json({ error: `demo mock has no handler for ${method} ${pathname}` }, 404);
}

export function installMockApi() {
  const realFetch = window.fetch.bind(window);

  window.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    let u;
    try {
      u = new URL(url, location.origin);
    } catch {
      return realFetch(input, init);
    }

    // Only intercept our own API calls; let CDN scripts (Monaco, Plotly) through untouched.
    if (!u.pathname.startsWith("/api/")) {
      return realFetch(input, init);
    }

    await delay();
    let body = null;
    if (init.body) {
      try { body = JSON.parse(init.body); } catch { body = null; }
    }
    return route(u.pathname, u.search, (init.method || "GET").toUpperCase(), body);
  };
}
