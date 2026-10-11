// Regression tests for the demo's mock backend. Run: npm test
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createMockApi } from "../src/mock/mockApi.js";
import { checkApiCoverage } from "../scripts/check-api-coverage.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const JSX = path.join(here, "../src/LogOctopus.jsx");

// The packet-line regex is read from the real frontend so the test fails if the
// app's parser and the mock's packet rows ever drift apart.
const NV_PKT_RE = eval(fs.readFileSync(JSX, "utf8").match(/const NV_PKT_RE = (\/.*\/);/)[1]);

const api = () => createMockApi({ latency: false, persist: false });
const call = async (a, method, url, body) => {
  const res = await a.handle(new URL(url, "http://x"), { method, body: body === undefined ? undefined : JSON.stringify(body) });
  const ct = res.headers.get("content-type") || "";
  return { status: res.status, res, data: ct.includes("json") ? await res.json() : null };
};
const b64 = (obj) => `data:application/json;base64,${Buffer.from(JSON.stringify(obj)).toString("base64")}`;

test("every /api path used by LogOctopus.jsx has a mock handler", () => {
  const { missing } = checkApiCoverage(JSX);
  assert.deepEqual(missing.map((m) => m.path), []);
});

test("devices: boolean statuses, real config schema, live session seeded", async () => {
  const a = api();
  const { data } = await call(a, "GET", "/api/devices");
  assert.ok(data.length >= 6);
  for (const d of data) {
    assert.equal(typeof d.connection, "boolean");
    assert.ok(Array.isArray(d.config.log_file_configs) && d.config.device_name === d.name);
  }
  assert.equal(data.find((d) => d.name === "Firewall-Edge").connection, false);
  const live = data.filter((d) => d.collecting);
  assert.ok(live.length >= 1 && live.every((d) => d.config.current_session_id));
});

test("auth + change-password", async () => {
  const a = api();
  assert.equal((await call(a, "POST", "/api/auth/login", { username: "admin", password: "nope" })).status, 401);
  const ok = await call(a, "POST", "/api/auth/login", { username: "admin", password: "admin" });
  assert.equal(ok.status, 200); assert.ok(ok.data.token);
  await call(a, "POST", "/api/settings/change-password", { new_password: "secret1" });
  assert.equal((await call(a, "POST", "/api/auth/login", { username: "admin", password: "admin" })).status, 401);
});

test("device groups round-trip", async () => {
  const a = api();
  const { data } = await call(a, "GET", "/api/settings/device-groups");
  assert.ok(data.length >= 1 && data[0].deviceIds.length);
  await call(a, "PUT", "/api/settings/device-groups", { groups: [{ id: "g1", name: "Only", deviceIds: ["x"] }] });
  assert.deepEqual((await call(a, "GET", "/api/settings/device-groups")).data, [{ id: "g1", name: "Only", deviceIds: ["x"] }]);
});

test("snapshots: paging, filters, text/chart split", async () => {
  const a = api();
  const t = (await call(a, "GET", "/api/snapshots?log_type=text&page_size=10")).data;
  assert.equal(t.items.length, 10); assert.ok(t.total_pages > 1);
  assert.ok(t.items.every((s) => s.isChart === false));
  const c = (await call(a, "GET", "/api/snapshots?log_type=chart&page_size=9999")).data;
  assert.ok(c.items.length === c.total && c.items.every((s) => s.isChart && "dataUnit" in s));
  const bySession = (await call(a, "GET", `/api/snapshots?log_type=text&page_size=9999&search_param=Session%20ID&search_value=${t.items[0].sessionId}`)).data;
  assert.ok(bySession.items.every((s) => s.sessionId === t.items[0].sessionId));
  const byScenario = (await call(a, "GET", "/api/snapshots?log_type=text&search_param=Scenario&search_value=bgp")).data;
  assert.ok(byScenario.total > 0);
  const sorted = [...t.items].map((s) => s.startTime).sort().reverse();
  assert.deepEqual(t.items.map((s) => s.startTime), sorted);
});

test("content: text rows use `time`, are deterministic; charts and packets parse", async () => {
  const a = api();
  const list = (await call(a, "GET", "/api/snapshots?log_type=text&page_size=9999")).data.items;
  const syslog = list.find((s) => s.logName === "syslog");
  const r1 = (await call(a, "GET", `/api/snapshots/${syslog.id}/content?log_type=text`)).data.rows;
  const r2 = (await call(a, "GET", `/api/snapshots/${syslog.id}/content?log_type=text`)).data.rows;
  assert.deepEqual(r1, r2);
  assert.ok(r1.length > 20 && r1.every((r) => r.time && r.content && r.log_name === "syslog"));
  assert.ok(r1.every((r, i) => i === 0 || r.time >= r1[i - 1].time));

  const cap = list.find((s) => s.logName === "network capture");
  const pk = (await call(a, "GET", `/api/snapshots/${cap.id}/content?log_type=text`)).data.rows;
  assert.ok(pk.every((r) => NV_PKT_RE.test(r.content) && !Number.isNaN(Date.parse(r.time))));
  assert.ok(pk.some((r) => r.content.includes("arp")) || pk.length > 100);

  const det = await call(a, "GET", `/api/snapshots/${cap.id}/packets/3`);
  assert.equal(det.data.packet_number, 3); assert.ok(det.data.details.Frame);
  assert.equal((await call(a, "GET", `/api/snapshots/${cap.id}/packets/999999`)).status, 404);

  const pcap = new DataView(await (await call(a, "GET", `/api/snapshots/${cap.id}/pcap`)).res.arrayBuffer());
  assert.equal(pcap.getUint32(0), 0xa1b2c3d4);

  const ch = (await call(a, "GET", "/api/snapshots?log_type=chart&page_size=9999")).data.items[0];
  const rows = (await call(a, "GET", `/api/snapshots/${ch.id}/content?log_type=chart`)).data.rows;
  assert.ok(rows.length >= 24 && rows.every((r) => r.time && r.content !== undefined));
  assert.equal((await call(a, "GET", `/api/snapshots/${ch.id}/content?log_type=text`)).status, 404);
});

test("device lifecycle via base64 config: create / duplicate / invalid / edit / delete", async () => {
  const a = api();
  const cfg = { device_name: "Lab-Pi", ip_address: "10.9.9.9", port: 22, user: "pi", collection_interval: 30,
    log_file_configs: [{ log_name: "syslog", log_type: "text" }, { log_name: "temp", log_type: "chart", data_unit: "°C" }] };
  const made = await call(a, "POST", "/api/devices", { contents: b64(cfg) });
  assert.equal(made.status, 201); assert.equal(made.data.device.name, "Lab-Pi");
  assert.equal((await call(a, "POST", "/api/devices", { contents: b64(cfg) })).status, 409);
  assert.equal((await call(a, "POST", "/api/devices", { contents: "data:application/json;base64,e30=" })).status, 422);
  const id = made.data.device.id;
  const edited = await call(a, "PUT", `/api/devices/${id}`, { contents: b64({ ...cfg, device_name: "Lab-Pi-2" }) });
  assert.equal(edited.data.device.name, "Lab-Pi-2");
  assert.equal((await call(a, "DELETE", `/api/devices/${id}`)).status, 204);
  assert.equal((await call(a, "GET", `/api/devices/${id}`)).status, 404);
});

test("collection: start → stop yields one snapshot per log config (+capture) in one session", async () => {
  const a = api();
  const devs = (await call(a, "GET", "/api/devices")).data;
  const pick = devs.filter((d) => ["Router-Beta", "Sensor-Hub-3"].includes(d.name));
  const expected = pick.reduce((n, d) => n + d.config.log_file_configs.length + (d.config.packets_capture_config ? 1 : 0), 0);
  const start = await call(a, "POST", "/api/start-logs-collection", { selected_devices: pick.map((d) => d.id), session_scenario: "unit test" });
  assert.equal(start.status, 200);
  assert.ok((await call(a, "GET", "/api/devices")).data.filter((d) => pick.some((p) => p.id === d.id)).every((d) => d.collecting && d.config.current_session_id === start.data.session_id));
  assert.equal((await call(a, "POST", "/api/start-logs-collection", { selected_devices: pick.map((d) => d.id) })).status, 409);

  const stop = await call(a, "POST", "/api/stop-logs-collection", { selected_devices: pick.map((d) => d.id), session_id: start.data.session_id });
  assert.equal(stop.status, 200); assert.match(stop.data.text_logs_url, /log_type=text/);
  const q = (t) => call(a, "GET", `/api/snapshots?log_type=${t}&page_size=9999&search_param=Session%20ID&search_value=${start.data.session_id}`);
  const got = (await q("text")).data.total + (await q("chart")).data.total;
  assert.equal(got, expected);
  assert.ok((await q("text")).data.items.every((s) => s.sessionScenario === "unit test"));
  assert.equal((await call(a, "POST", "/api/stop-logs-collection", { selected_devices: pick.map((d) => d.id) })).status, 409);
});

test("offline device can't start; seeded live session can be stopped", async () => {
  const a = api();
  const devs = (await call(a, "GET", "/api/devices")).data;
  const fw = devs.find((d) => d.name === "Firewall-Edge");
  assert.equal((await call(a, "POST", "/api/start-logs-collection", { selected_devices: [fw.id], session_scenario: "x" })).status, 409);
  const live = devs.filter((d) => d.collecting);
  const stop = await call(a, "POST", "/api/stop-logs-collection", { selected_devices: live.map((d) => d.id), session_id: live[0].config.current_session_id });
  assert.equal(stop.status, 200);
});

test("auto-collection, dissectors, exec-command, test-connection, snapshot delete", async () => {
  const a = api();
  const id = (await call(a, "GET", "/api/devices")).data[1].id;
  await call(a, "POST", "/api/settings/auto-collection", { enabled: true, interval_hours: 6, device_ids: [id] });
  assert.equal((await call(a, "GET", `/api/devices/${id}`)).data.autoCollectionInterval, 6);

  const fd = new FormData(); fd.append("file", new File(["-- lua"], "my_proto.lua"));
  const up = await a.handle(new URL("/api/settings/dissectors", "http://x"), { method: "POST", body: fd });
  assert.equal(up.status, 201);
  assert.ok((await call(a, "GET", "/api/settings/dissectors")).data.some((d) => d.name === "my_proto.lua"));
  assert.equal((await call(a, "DELETE", "/api/settings/dissectors/my_proto.lua")).data.deleted, true);

  const ex = await call(a, "POST", "/api/devices/exec-command", { command: "tail -n 5 /var/log/syslog", ip_address: "10.0.1.11", user: "u" });
  assert.equal(ex.data.exit_code, 0); assert.ok(ex.data.stdout.split("\n").length >= 5);
  assert.equal((await call(a, "POST", "/api/devices/test-connection", { ip_address: "10.0.1.11", port: 22, user: "u" })).data.success, true);
  assert.equal((await call(a, "POST", "/api/devices/test-connection", { ip_address: "10.0.0.1", port: 22, user: "u" })).data.success, false);

  const s = (await call(a, "GET", "/api/snapshots?log_type=text&page_size=3")).data.items.map((x) => x.id);
  const del = await call(a, "DELETE", "/api/snapshots", { snapshot_ids: [...s, "nope"], log_type: "text" });
  assert.deepEqual(del.data.removed, s); assert.deepEqual(del.data.not_found, ["nope"]);
});

test("unknown route → 404 JSON error", async () => {
  const r = await call(api(), "GET", "/api/nope");
  assert.equal(r.status, 404); assert.ok(r.data.error);
});
