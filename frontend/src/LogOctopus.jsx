import { useState, useEffect, useCallback, useRef } from "react";

// ── CONFIG ────────────────────────────────────────────────────────────────────
const API_BASE = (import.meta?.env?.VITE_API_BASE) || "http://localhost:8050";

async function apiFetch(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw Object.assign(new Error(err.error || res.statusText), { status: res.status });
  }
  if (res.status === 204) return null;
  return res.json();
}

// ── MINI LINE / SCATTER CHART (pure SVG) ─────────────────────────────────────
function TinyChart({ data, title, isNumeric }) {
  const W = 460, H = 180, PAD = { t: 28, r: 16, b: 36, l: 44 };
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;

  if (!data || data.length === 0) return <p style={{ color: "var(--muted)" }}>No data</p>;

  const nums = isNumeric ? data.map(d => parseFloat(d.content)).filter(v => !isNaN(v)) : [];
  const minV = Math.min(...nums);
  const maxV = Math.max(...nums);
  const range = maxV - minV || 1;

  const xScale = i => PAD.l + (i / (data.length - 1)) * innerW;
  const yScale = v => PAD.t + innerH - ((v - minV) / range) * innerH;
  const points = data.map((d, i) => ({ x: xScale(i), y: yScale(parseFloat(d.content)) }));
  const polyline = points.map(p => `${p.x},${p.y}`).join(" ");

  const categories = [...new Set(data.map(d => d.content))];
  const catY = v => PAD.t + ((categories.indexOf(v) / Math.max(categories.length - 1, 1)) * innerH);

  const ACCENT = "#00e5c8";
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 13, fontFamily: "var(--font-mono)", color: "var(--muted)", marginBottom: 6 }}>{title}</div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", background: "var(--card-bg)", borderRadius: 8, border: "1px solid var(--border)" }}>
        {[0, 0.25, 0.5, 0.75, 1].map((t, i) => (
          <line key={i} x1={PAD.l} x2={W - PAD.r} y1={PAD.t + t * innerH} y2={PAD.t + t * innerH}
            stroke="var(--border)" strokeWidth={0.5} />
        ))}
        {isNumeric ? (
          <polyline fill="none" stroke={ACCENT} strokeWidth={2} points={polyline} />
        ) : (
          data.map((d, i) => (
            <circle key={i} cx={xScale(i)} cy={catY(d.content)} r={5} fill={ACCENT} opacity={0.8} />
          ))
        )}
        {[0, Math.floor(data.length / 2), data.length - 1].map((idx) => (
          <text key={idx} x={xScale(idx)} y={H - 6} textAnchor="middle"
            fontSize={9} fill="var(--muted)" fontFamily="var(--font-mono)">
            {data[idx]?.time}
          </text>
        ))}
        {isNumeric && [minV, (minV + maxV) / 2, maxV].map((v, i) => (
          <text key={i} x={PAD.l - 4} y={yScale(v) + 4} textAnchor="end"
            fontSize={9} fill="var(--muted)" fontFamily="var(--font-mono)">
            {v.toFixed(1)}
          </text>
        ))}
      </svg>
    </div>
  );
}

// ── MODAL ─────────────────────────────────────────────────────────────────────
function Modal({ open, onClose, title, size = "lg", children, footer }) {
  useEffect(() => {
    const handler = e => { if (e.key === "Escape") onClose(); };
    if (open) document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;
  const widths = { sm: 480, md: 600, lg: 860, xl: 1100, full: "calc(100vw - 40px)" };
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)" }} />
      <div style={{
        position: "relative", zIndex: 1, background: "var(--modal-bg)", border: "1px solid var(--border)",
        borderRadius: 12, width: widths[size] || widths.lg, maxWidth: "calc(100vw - 40px)",
        maxHeight: "calc(100vh - 40px)", display: "flex", flexDirection: "column",
        boxShadow: "0 24px 60px rgba(0,0,0,0.6)"
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "18px 24px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontFamily: "var(--font-display)", letterSpacing: "0.04em", color: "var(--text)" }}>{title}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 20, lineHeight: 1, padding: "2px 6px" }}>×</button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>{children}</div>
        {footer && (
          <div style={{ padding: "14px 24px", borderTop: "1px solid var(--border)", display: "flex", gap: 10, justifyContent: "flex-end", flexShrink: 0 }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

// ── BADGE ─────────────────────────────────────────────────────────────────────
function Badge({ color = "default", children }) {
  const colors = {
    green:   { bg: "rgba(0,229,100,0.15)",  text: "#00e564",  border: "rgba(0,229,100,0.3)" },
    red:     { bg: "rgba(255,80,80,0.15)",   text: "#ff5050",  border: "rgba(255,80,80,0.3)" },
    yellow:  { bg: "rgba(255,200,0,0.15)",   text: "#ffc800",  border: "rgba(255,200,0,0.3)" },
    cyan:    { bg: "rgba(0,229,200,0.15)",   text: "#00e5c8",  border: "rgba(0,229,200,0.3)" },
    default: { bg: "rgba(255,255,255,0.08)", text: "var(--muted)", border: "var(--border)" },
  };
  const c = colors[color] || colors.default;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 10px",
      borderRadius: 20, fontSize: 11, fontFamily: "var(--font-mono)", fontWeight: 600,
      background: c.bg, color: c.text, border: `1px solid ${c.border}` }}>
      {children}
    </span>
  );
}

// ── BUTTON ────────────────────────────────────────────────────────────────────
function Btn({ variant = "default", size = "md", onClick, disabled, children, style }) {
  const base = { cursor: disabled ? "not-allowed" : "pointer", border: "none", borderRadius: 8,
    fontFamily: "var(--font-display)", fontWeight: 600, letterSpacing: "0.03em",
    transition: "all 0.15s", display: "inline-flex", alignItems: "center", gap: 7, opacity: disabled ? 0.5 : 1 };
  const sizes = { sm: { padding: "5px 12px", fontSize: 12 }, md: { padding: "9px 18px", fontSize: 13 }, lg: { padding: "12px 24px", fontSize: 14 } };
  const variants = {
    default: { background: "var(--card-bg)", color: "var(--text)", border: "1px solid var(--border)" },
    primary: { background: "var(--accent)", color: "#0a0f1e" },
    success: { background: "#00e564", color: "#0a0f1e" },
    danger:  { background: "#ff4444", color: "#fff" },
    ghost:   { background: "transparent", color: "var(--muted)", border: "1px solid var(--border)" },
    subtle:  { background: "rgba(255,255,255,0.06)", color: "var(--text)", border: "1px solid var(--border)" },
  };
  return (
    <button onClick={disabled ? undefined : onClick} disabled={disabled}
      style={{ ...base, ...sizes[size], ...variants[variant], ...style }}>
      {children}
    </button>
  );
}

// ── TOAST ─────────────────────────────────────────────────────────────────────
function Toast({ message, type = "error", onDismiss }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 4000);
    return () => clearTimeout(t);
  }, [onDismiss]);
  const colors = {
    error:   { bg: "rgba(255,60,60,0.12)", border: "rgba(255,60,60,0.3)", text: "#ff6666" },
    success: { bg: "rgba(0,229,100,0.12)", border: "rgba(0,229,100,0.3)", text: "#00e564" },
    info:    { bg: "rgba(0,229,200,0.12)", border: "rgba(0,229,200,0.3)", text: "#00e5c8" },
  };
  const c = colors[type] || colors.info;
  return (
    <div style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 8,
      padding: "12px 18px", marginBottom: 12, display: "flex", alignItems: "center",
      justifyContent: "space-between", color: c.text, fontFamily: "var(--font-mono)", fontSize: 13 }}>
      {message}
      <button onClick={onDismiss} style={{ background: "none", border: "none", color: c.text, cursor: "pointer", fontSize: 18 }}>×</button>
    </div>
  );
}

// ── DEVICE CARD ───────────────────────────────────────────────────────────────
function DeviceCard({ device, selected, onSelect, onInfo }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{
        position: "relative", width: 220, borderRadius: 12, padding: "16px 14px",
        background: selected ? "rgba(0,229,200,0.07)" : "var(--card-bg)",
        border: `1px solid ${selected ? "var(--accent)" : hovered ? "rgba(0,229,200,0.3)" : "var(--border)"}`,
        transition: "all 0.2s", cursor: "default",
        boxShadow: selected ? "0 0 16px rgba(0,229,200,0.12)" : "none"
      }}>
      <input type="checkbox" checked={selected} onChange={e => onSelect(e.target.checked)}
        style={{ position: "absolute", top: 12, left: 12, width: 16, height: 16, accentColor: "var(--accent)", cursor: "pointer" }} />
      <button onClick={onInfo} style={{ position: "absolute", top: 10, right: 10,
        background: "rgba(255,255,255,0.07)", border: "1px solid var(--border)", borderRadius: 6,
        color: "var(--muted)", cursor: "pointer", fontSize: 13, padding: "2px 7px" }}>⚙</button>
      <div style={{ marginTop: 20, marginBottom: 10, fontFamily: "var(--font-display)", fontSize: 15, fontWeight: 700, color: "var(--text)", letterSpacing: "0.03em" }}>
        {device.name}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <StatusRow label="Connection" ok={device.connection} />
        <StatusRow label="Log Access" ok={device.logAccess} />
        <StatusRow label="Collecting" ok={device.collecting} pulseWhenTrue />
      </div>
    </div>
  );
}

function StatusRow({ label, ok, pulseWhenTrue }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontFamily: "var(--font-mono)" }}>
      <span style={{
        width: 8, height: 8, borderRadius: "50%",
        background: ok ? "#00e564" : "#555",
        boxShadow: ok && pulseWhenTrue ? "0 0 6px #00e564" : "none"
      }} />
      <span style={{ color: "var(--muted)" }}>{label}</span>
      <span style={{ marginLeft: "auto", color: ok ? "#00e564" : "#666" }}>{ok ? "OK" : "—"}</span>
    </div>
  );
}

// ── SNAPSHOTS TABLE ───────────────────────────────────────────────────────────
function SnapshotsTable({ snapshots, selected, onSelect, onView }) {
  if (snapshots.length === 0) {
    return (
      <div style={{ padding: "40px 0", textAlign: "center", color: "var(--muted)", fontFamily: "var(--font-mono)", fontSize: 13 }}>
        — no log snapshots —
      </div>
    );
  }
  const cols = ["", "Device", "Log Name", "Started", "Finished", "Duration", "Size", "Session ID", ""];
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--font-mono)", fontSize: 12 }}>
        <thead>
          <tr>
            {cols.map((c, i) => (
              <th key={i} style={{ padding: "10px 14px", textAlign: "left", color: "var(--muted)",
                borderBottom: "1px solid var(--border)", fontWeight: 600, letterSpacing: "0.06em",
                fontSize: 10, textTransform: "uppercase", whiteSpace: "nowrap" }}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {snapshots.map(s => (
            <tr key={s.id} style={{ borderBottom: "1px solid var(--border)", transition: "background 0.12s" }}
              onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.03)"}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
              <td style={{ padding: "10px 14px" }}>
                <input type="checkbox" checked={selected.includes(s.id)}
                  onChange={e => onSelect(s.id, e.target.checked)}
                  style={{ accentColor: "var(--accent)", width: 14, height: 14 }} />
              </td>
              <td style={{ padding: "10px 14px", color: "var(--text)" }}>{s.deviceName}</td>
              <td style={{ padding: "10px 14px" }}><Badge color="cyan">{s.logName}</Badge></td>
              <td style={{ padding: "10px 14px", color: "var(--muted)" }}>{s.startTime}</td>
              <td style={{ padding: "10px 14px", color: "var(--muted)" }}>{s.finishTime}</td>
              <td style={{ padding: "10px 14px", color: "var(--text)" }}>{s.duration}s</td>
              <td style={{ padding: "10px 14px", color: "var(--text)" }}>{s.sizeKb} kB</td>
              <td style={{ padding: "10px 14px" }}>
                <code style={{ fontSize: 10, color: "var(--muted)", background: "rgba(255,255,255,0.05)", padding: "2px 6px", borderRadius: 4 }}>{s.sessionId}</code>
              </td>
              <td style={{ padding: "10px 14px" }}>
                <Btn size="sm" variant="subtle" onClick={() => onView([s])}>View</Btn>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── LOG CONTENT VIEW ──────────────────────────────────────────────────────────
function LogContentView({ rows, isChart, colorMode }) {
  if (!rows || rows.length === 0) return <p style={{ color: "var(--muted)" }}>No data.</p>;

  if (isChart) {
    const isNum = rows.some(d => !isNaN(parseFloat(d.content)) && d.content !== null);
    return <TinyChart data={rows} title="Chart Data" isNumeric={isNum} />;
  }

  const logColors = {};
  const palette = ["#2d6a4f", "#1d3557", "#5c2d91", "#7b2d00", "#004e64", "#3d2645"];
  [...new Set(rows.map(r => r.log_name))].forEach((n, i) => { logColors[n] = palette[i % palette.length]; });

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--font-mono)", fontSize: 12 }}>
        <thead>
          <tr>
            {["Timestamp", "Log Name", "Content"].map(h => (
              <th key={h} style={{ padding: "8px 12px", textAlign: "left", color: "var(--muted)",
                borderBottom: "1px solid var(--border)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const bg = colorMode ? logColors[r.log_name] + "66" : "transparent";
            const isErr  = (r.content || "").startsWith("ERROR");
            const isWarn = (r.content || "").startsWith("WARN");
            return (
              <tr key={i} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)", background: bg }}>
                <td style={{ padding: "7px 12px", color: "var(--muted)", whiteSpace: "nowrap" }}>{r.time}</td>
                <td style={{ padding: "10px 14px", color: "var(--text)" }}>{r.device}</td>
                <td style={{ padding: "7px 12px" }}><Badge color="cyan">{r.log_name}</Badge></td>
                <td style={{ padding: "7px 12px", color: isErr ? "#ff6666" : isWarn ? "#ffc800" : "var(--text)" }}>{r.content}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── SPINNER ───────────────────────────────────────────────────────────────────
function Spinner() {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 0", gap: 10, color: "var(--muted)", fontFamily: "var(--font-mono)", fontSize: 13 }}>
      <svg width="16" height="16" viewBox="0 0 16 16" style={{ animation: "spin 1s linear infinite" }}>
        <circle cx="8" cy="8" r="6" fill="none" stroke="var(--accent)" strokeWidth="2" strokeDasharray="20" strokeDashoffset="10" />
      </svg>
      Loading…
    </div>
  );
}

// ── REST API DOCS ─────────────────────────────────────────────────────────────
function ApiDocs() {
  const [copied, setCopied] = useState(null);
  const copy = (text, key) => {
    navigator.clipboard.writeText(text).then(() => { setCopied(key); setTimeout(() => setCopied(null), 1500); });
  };
  const pyCode = `import requests

# Start collection
r = requests.post("${API_BASE}/api/start-logs-collection",
    json={"selected_devices": ["device_1", "device_2"]})
session_id = r.json()["session_id"]

# Stop collection
requests.post("${API_BASE}/api/stop-logs-collection",
    json={"selected_devices": ["device_1"], "session_id": session_id})`;

  const endpoints = [
    { method: "GET",    path: "/api/devices",                    desc: "List all managed devices with current statuses.", req: null, res: `[{ "id": "…", "name": "Router-Alpha", "connection": true, "logAccess": true, "collecting": false }]` },
    { method: "POST",   path: "/api/devices",                    desc: "Add a new device from a base64-encoded JSON config file.", req: `{ "contents": "<base64 data URI>" }`, res: `{ "device": { "id": "…", "name": "…" } }` },
    { method: "DELETE", path: "/api/devices/:id",                desc: "Remove a device and stop its watchdog process.", req: null, res: `204 No Content` },
    { method: "GET",    path: "/api/snapshots",                  desc: "List snapshots. Supports ?search_param=&search_value=&log_type=text|chart", req: null, res: `[{ "id": 1, "deviceName": "…", "logName": "syslog", "sessionId": "…", "isChart": false }]` },
    { method: "GET",    path: "/api/snapshots/:id/content",      desc: "Retrieve full log content rows for a snapshot.", req: null, res: `{ "rows": [{ "timestamp": "…", "log_name": "syslog", "content": "INFO …" }] }` },
    { method: "POST",   path: "/api/start-logs-collection",      desc: "Start log collection on selected devices.", req: `{ "selected_devices": ["device_1"] }`, res: `{ "status": "logs collection started", "session_id": "8cd7112719ac" }` },
    { method: "POST",   path: "/api/stop-logs-collection",       desc: "Stop log collection and save collected logs.", req: `{ "selected_devices": ["device_1"], "session_id": "8cd7112719ac" }`, res: `{ "status": "logs collection stopped", "text_logs_url": "…", "chart_logs_url": "…" }` },
  ];

  const methodColor = { GET: "cyan", POST: "green", DELETE: "red" };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {endpoints.map(ep => (
        <div key={ep.path + ep.method} style={{ background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 10, padding: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
            <Badge color={methodColor[ep.method] || "default"}>{ep.method}</Badge>
            <code style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--text)" }}>{ep.path}</code>
          </div>
          <p style={{ color: "var(--muted)", fontSize: 13, margin: "0 0 10px" }}>{ep.desc}</p>
          {ep.req && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>Request body</div>
              <pre style={{ background: "rgba(0,0,0,0.4)", border: "1px solid var(--border)", borderRadius: 6, padding: "10px 14px", margin: 0, fontFamily: "var(--font-mono)", fontSize: 12, color: "#00e5c8", overflowX: "auto" }}>{ep.req}</pre>
            </div>
          )}
          <div>
            <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>Response</div>
            <pre style={{ background: "rgba(0,0,0,0.4)", border: "1px solid var(--border)", borderRadius: 6, padding: "10px 14px", margin: 0, fontFamily: "var(--font-mono)", fontSize: 12, color: "#a8ff78", overflowX: "auto" }}>{ep.res}</pre>
          </div>
        </div>
      ))}
      <div style={{ background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 10, padding: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <span style={{ fontFamily: "var(--font-display)", fontSize: 13, color: "var(--text)" }}>📋 Example Python code</span>
          <Btn size="sm" variant="subtle" onClick={() => copy(pyCode, "py")}>{copied === "py" ? "✓ Copied" : "Copy"}</Btn>
        </div>
        <pre style={{ background: "rgba(0,0,0,0.4)", border: "1px solid var(--border)", borderRadius: 6, padding: "12px 14px", margin: 0, fontFamily: "var(--font-mono)", fontSize: 12, color: "#c9b1ff", overflowX: "auto" }}>{pyCode}</pre>
      </div>
    </div>
  );
}

// ── DEVICE DETAILS ────────────────────────────────────────────────────────────
function DeviceDetails({ device }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        {[
          ["Name",       device.name],
          ["Connection", device.connection ? "✅ Online" : "❌ Offline"],
          ["Log Access", device.logAccess  ? "✅ Yes"    : "❌ No"],
          ["Collecting", device.collecting ? "🟢 Active" : "🟡 Idle"],
        ].map(([k, v]) => (
          <div key={k} style={{ background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "12px 18px", minWidth: 140 }}>
            <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>{k}</div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 14, color: "var(--text)" }}>{v}</div>
          </div>
        ))}
      </div>
      {device.config && (
        <div>
          <h4 style={{ fontFamily: "var(--font-display)", fontSize: 13, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 10px" }}>JSON Configuration</h4>
          <pre style={{ background: "rgba(0,0,0,0.4)", border: "1px solid var(--border)", borderRadius: 8, padding: 16, fontFamily: "var(--font-mono)", fontSize: 12, color: "#a8ff78", overflowX: "auto", margin: 0 }}>
            {JSON.stringify(device.config, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

// ── UPLOAD BUTTON ─────────────────────────────────────────────────────────────
function UploadBtn({ onUpload }) {
  const ref = useRef();
  const handleFile = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => onUpload(ev.target.result);
    reader.readAsDataURL(file); // sends full data-URI; backend strips the prefix
    e.target.value = "";
  };
  return (
    <>
      <input ref={ref} type="file" accept=".json" style={{ display: "none" }} onChange={handleFile} />
      <Btn variant="primary" onClick={() => ref.current.click()}>＋ Add Device</Btn>
    </>
  );
}

// ── TOGGLE ────────────────────────────────────────────────────────────────────
function Toggle({ checked, onChange, labelLeft, labelRight }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      {labelLeft && <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 12, color: checked ? "var(--muted)" : "var(--text)" }}>{labelLeft}</span>}
      <div onClick={() => onChange(!checked)}
        style={{ width: 44, height: 24, borderRadius: 12, background: checked ? "var(--accent)" : "var(--border)",
          position: "relative", cursor: "pointer", transition: "background 0.2s", border: "1px solid var(--border)" }}>
        <div style={{ position: "absolute", top: 3, left: checked ? 22 : 2, width: 16, height: 16,
          borderRadius: "50%", background: "#fff", transition: "left 0.2s", boxShadow: "0 1px 4px rgba(0,0,0,0.3)" }} />
      </div>
      {labelRight && <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 12, color: checked ? "var(--text)" : "var(--muted)" }}>{labelRight}</span>}
    </div>
  );
}

// ── SESSION INFO ──────────────────────────────────────────────────────────────
function SessionInfo({ sessionId, textUrl, chartUrl }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, alignItems: "center", padding: "10px 0" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Session ID</div>
        <code style={{ fontSize: 20, fontFamily: "var(--font-mono)", color: "var(--accent)", letterSpacing: "0.1em" }}>{sessionId}</code>
      </div>
      <div style={{ display: "flex", gap: 12 }}>
        {textUrl  && <a href={textUrl}  target="_blank" rel="noreferrer"><Btn variant="subtle">📄 Show Text Logs</Btn></a>}
        {chartUrl && <a href={chartUrl} target="_blank" rel="noreferrer"><Btn variant="subtle">📈 Show Chart Logs</Btn></a>}
      </div>
    </div>
  );
}

// ── MAIN APP ──────────────────────────────────────────────────────────────────
const PULSE_KF = `
  @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.4;transform:scale(1.6)} }
  @keyframes spin   { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
`;

export default function App() {
  const [devices,         setDevices]         = useState([]);
  const [devicesLoading,  setDevicesLoading]  = useState(true);
  const [selectedDevices, setSelectedDevices] = useState([]);
  const [snapshots,       setSnapshots]       = useState([]);
  const [snapsLoading,    setSnapsLoading]    = useState(true);
  const [selectedSnaps,   setSelectedSnaps]   = useState([]);
  const [isChart,         setIsChart]         = useState(false);
  const [searchParam,     setSearchParam]     = useState("");
  const [searchValue,     setSearchValue]     = useState("");
  const [filterActive,    setFilterActive]    = useState(false);

  // modals
  const [logModal,        setLogModal]        = useState(false);
  const [logRows,         setLogRows]         = useState([]);
  const [logRowsLoading,  setLogRowsLoading]  = useState(false);
  const [colorMode,       setColorMode]       = useState(false);
  const [deviceModal,     setDeviceModal]     = useState(null);
  const [sessionModal,    setSessionModal]    = useState(null);
  const [apiModal,        setApiModal]        = useState(false);

  // toasts: [{ id, message, type }]
  const [toasts, setToasts] = useState([]);
  const addToast    = useCallback((message, type = "error") => setToasts(prev => [...prev, { id: Date.now(), message, type }]), []);
  const dismissToast = useCallback(id => setToasts(prev => prev.filter(t => t.id !== id)), []);

  // ── data fetching ──────────────────────────────────────────────────────────
  const fetchDevices = useCallback(async () => {
    try {
      setDevices(await apiFetch("/api/devices"));
    } catch (e) {
      addToast(`Failed to load devices: ${e.message}`);
    } finally {
      setDevicesLoading(false);
    }
  }, [addToast]);

  const fetchSnapshots = useCallback(async (param, value, chart) => {
    setSnapsLoading(true);
    try {
      let url = `/api/snapshots?log_type=${chart ? "chart" : "text"}`;
      if (param && value) url += `&search_param=${encodeURIComponent(param)}&search_value=${encodeURIComponent(value)}`;
      setSnapshots(await apiFetch(url));
    } catch (e) {
      addToast(`Failed to load snapshots: ${e.message}`);
    } finally {
      setSnapsLoading(false);
    }
  }, [addToast]);

  useEffect(() => { fetchDevices(); }, [fetchDevices]);
  useEffect(() => { fetchSnapshots("", "", false); }, [fetchSnapshots]);

  // refresh statuses every 10 s
  useEffect(() => {
    const id = setInterval(fetchDevices, 10000);
    return () => clearInterval(id);
  }, [fetchDevices]);

  // re-fetch snapshots when log type toggles
  const prevIsChart = useRef(isChart);
  useEffect(() => {
    if (prevIsChart.current === isChart) return;
    prevIsChart.current = isChart;
    fetchSnapshots(filterActive ? searchParam : "", filterActive ? searchValue : "", isChart);
  });

  // hydrate filter from URL on first load
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const sp = p.get("search_param") || "";
    const sv = p.get("search_value")  || "";
    const lt = p.get("log_type") === "chart";
    if (sp || sv) {
      setSearchParam(sp); setSearchValue(sv); setIsChart(lt); setFilterActive(true);
      fetchSnapshots(sp, sv, lt);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── handlers ───────────────────────────────────────────────────────────────
  const handleUpload = async contents => {
    try {
      const { device } = await apiFetch("/api/devices", { method: "POST", body: JSON.stringify({ contents }) });
      setDevices(prev => [...prev, device]);
      addToast("Device added successfully.", "success");
    } catch (e) {
      addToast(e.status === 422 ? "Incorrect config file — could not parse device configuration." : `Upload failed: ${e.message}`);
    }
  };

  const toggleDevice = (id, checked) =>
    setSelectedDevices(prev => checked ? [...prev, id] : prev.filter(x => x !== id));

  const startCollection = async () => {
    const names = devices.filter(d => selectedDevices.includes(d.id)).map(d => d.name);
    try {
      await apiFetch("/api/start-logs-collection", { method: "POST", body: JSON.stringify({ selected_devices: names }) });
      addToast("Log collection started.", "success");
      fetchDevices();
      fetchSnapshots(filterActive ? searchParam : "", filterActive ? searchValue : "", isChart);
    } catch (e) { addToast(`Failed to start collection: ${e.message}`); }
  };

  const stopCollection = async () => {
    const names = devices.filter(d => selectedDevices.includes(d.id)).map(d => d.name);
    const runningDev = devices.find(d => selectedDevices.includes(d.id) && d.collecting);
    const session_id = runningDev?.config?.current_session_id || "";
    try {
      const result = await apiFetch("/api/stop-logs-collection", { method: "POST", body: JSON.stringify({ selected_devices: names, session_id }) });
      setSessionModal({ sessionId: result.session_id, textUrl: result.text_logs_url, chartUrl: result.chart_logs_url });
      fetchDevices();
      fetchSnapshots(filterActive ? searchParam : "", filterActive ? searchValue : "", isChart);
    } catch (e) { addToast(`Failed to stop collection: ${e.message}`); }
  };

  const removeSelected = async () => {
    await Promise.all(selectedDevices.map(id =>
      apiFetch(`/api/devices/${id}`, { method: "DELETE" }).catch(e => addToast(`Remove failed: ${e.message}`))
    ));
    setSelectedDevices([]);
    fetchDevices();
  };

  const toggleSnap = (id, checked) =>
    setSelectedSnaps(prev => checked ? [...prev, id] : prev.filter(x => x !== id));

  const openLogContent = async snapsToView => {
    setLogModal(true); setLogRowsLoading(true); setLogRows([]);
    try {
      const results = await Promise.all(
        snapsToView.map(s => apiFetch(`/api/snapshots/${s.id}/content?log_type=${isChart ? "chart" : "text"}`))
      );
      setLogRows(results.flatMap(r => r.rows));
    } catch (e) { addToast(`Failed to load content: ${e.message}`); setLogModal(false); }
    finally { setLogRowsLoading(false); }
  };

  const applyFilter = () => {
    setFilterActive(true);
    fetchSnapshots(searchParam, searchValue, isChart);
    const p = new URLSearchParams();
    if (searchParam) p.set("search_param", searchParam);
    if (searchValue) p.set("search_value", searchValue);
    p.set("log_type", isChart ? "chart" : "text");
    window.history.replaceState(null, "", `?${p.toString()}`);
  };

  const clearFilter = () => {
    setSearchParam(""); setSearchValue(""); setFilterActive(false);
    window.history.replaceState(null, "", window.location.pathname);
    fetchSnapshots("", "", isChart);
  };

  const downloadLogs = () => {
    if (isChart) { addToast("Chart export requires backend — use the API endpoint directly.", "info"); return; }
    const csv = "Time,Device,Log Name,Content\n" + logRows.map(r => `"${r.time}","${r.device}","${r.log_name}","${r.content}"`).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "logs.csv"; a.click();
  };

  // ── CSS ────────────────────────────────────────────────────────────────────
  const cssVars = `
    @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');
    :root {
      --bg: #080d1c; --surface: #0d1426; --card-bg: #111827; --modal-bg: #0f1625;
      --border: rgba(255,255,255,0.08); --text: #e8eaf0; --muted: #6b7280; --accent: #00e5c8;
      --font-display: 'Syne', ui-sans-serif, sans-serif;
      --font-mono: 'JetBrains Mono', 'Fira Code', monospace;
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); }
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 3px; }
    a { text-decoration: none; }
    ${PULSE_KF}
  `;

  const anySelected = selectedDevices.length > 0;

  return (
    <>
      <style>{cssVars}</style>
      <div style={{ minHeight: "100vh", background: "var(--bg)", paddingBottom: 60 }}>

        {/* HEADER */}
        <header style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)",
          padding: "0 32px", position: "sticky", top: 0, zIndex: 100,
          boxShadow: "0 2px 20px rgba(0,0,0,0.4)", display: "flex", alignItems: "center", height: 64 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <svg width="36" height="36" viewBox="0 0 36 36">
              <circle cx="18" cy="18" r="17" fill="none" stroke="var(--accent)" strokeWidth="1.5" />
              <circle cx="18" cy="18" r="6" fill="var(--accent)" />
              {[0,45,90,135,180,225,270,315].map((a, i) => {
                const rad = a * Math.PI / 180;
                return <line key={i} x1={18 + 7 * Math.cos(rad)} y1={18 + 7 * Math.sin(rad)}
                  x2={18 + 15 * Math.cos(rad)} y2={18 + 15 * Math.sin(rad)}
                  stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" />;
              })}
            </svg>
            <div>
              <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 20, color: "var(--text)", letterSpacing: "-0.02em", lineHeight: 1 }}>LogOctopus</div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--muted)", marginTop: 2, letterSpacing: "0.08em" }}>Collect & Analyze Logs Efficiently</div>
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginRight: 20 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#00e564", boxShadow: "0 0 8px #00e564", animation: "pulse 2s infinite" }} />
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted)" }}>LIVE</span>
          </div>
          <Btn variant="subtle" onClick={() => setApiModal(true)}>REST API</Btn>
        </header>

        <div style={{ maxWidth: 1400, margin: "0 auto", padding: "28px 32px" }}>

          {/* TOASTS */}
          {toasts.map(t => <Toast key={t.id} message={t.message} type={t.type} onDismiss={() => dismissToast(t.id)} />)}

          {/* ACTION BAR */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 24, alignItems: "center" }}>
            <UploadBtn onUpload={handleUpload} />
            <Btn variant="success" onClick={startCollection} disabled={!anySelected}>▶ Start Collection</Btn>
            <Btn variant="danger"  onClick={stopCollection}  disabled={!anySelected}>⏹ Stop Collection</Btn>
            <Btn variant="ghost"   onClick={removeSelected}  disabled={!anySelected}>🗑 Remove Selected</Btn>
            <div style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted)" }}>
              {selectedDevices.length} device(s) selected
            </div>
          </div>

          {/* DEVICES */}
          <section style={{ marginBottom: 32 }}>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 14 }}>
              Managed Devices — {devices.length}
            </div>
            {devicesLoading ? <Spinner /> : devices.length === 0 ? (
              <div style={{ padding: "32px 24px", background: "var(--card-bg)", border: "1px dashed var(--border)", borderRadius: 12, textAlign: "center", color: "var(--muted)", fontFamily: "var(--font-mono)", fontSize: 13 }}>
                No devices. Upload a JSON config file to add one.
              </div>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
                {devices.map(d => (
                  <DeviceCard key={d.id} device={d}
                    selected={selectedDevices.includes(d.id)}
                    onSelect={checked => toggleDevice(d.id, checked)}
                    onInfo={() => setDeviceModal(d)} />
                ))}
              </div>
            )}
          </section>

          <div style={{ borderTop: "1px solid var(--border)", margin: "0 0 24px" }} />

          {/* SNAPSHOT TOOLBAR */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
            <Btn variant="primary" onClick={() => openLogContent(snapshots.filter(s => selectedSnaps.includes(s.id)))} disabled={selectedSnaps.length === 0}>📋 View Selected</Btn>
            <Toggle checked={isChart} onChange={v => { setIsChart(v); setSelectedSnaps([]); }} labelLeft="Text" labelRight="Chart" />
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: 8 }}>
              <select value={searchParam} onChange={e => setSearchParam(e.target.value)}
                style={{ background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 7, color: "var(--text)", fontFamily: "var(--font-mono)", fontSize: 12, padding: "7px 12px" }}>
                <option value="">Filter by…</option>
                <option>Device</option><option>Log Name</option><option>Session ID</option><option>Started</option><option>Finished</option>
              </select>
              <span style={{ color: "var(--muted)", fontWeight: 700, fontSize: 16 }}>=</span>
              <input value={searchValue} onChange={e => setSearchValue(e.target.value)} placeholder="Value"
                onKeyDown={e => { if (e.key === "Enter") applyFilter(); }}
                style={{ background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 7, color: "var(--text)", fontFamily: "var(--font-mono)", fontSize: 12, padding: "7px 12px", width: 160 }} />
              <Btn variant="subtle" size="sm" onClick={applyFilter}>🔍 Filter</Btn>
              {filterActive && <Btn variant="ghost" size="sm" onClick={clearFilter}>✕ Clear</Btn>}
            </div>
            <div style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted)" }}>
              {snapshots.length} snapshot(s)
            </div>
          </div>

          {/* SNAPSHOTS TABLE */}
          <div style={{ background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
            {snapsLoading ? <Spinner /> : (
              <SnapshotsTable snapshots={snapshots} selected={selectedSnaps} onSelect={toggleSnap} onView={openLogContent} />
            )}
          </div>
        </div>
      </div>

      {/* MODALS */}
      <Modal open={logModal} onClose={() => setLogModal(false)} title="Logs Content" size="full"
        footer={<>
          {!isChart && <Toggle checked={colorMode} onChange={setColorMode} labelLeft="Raw" labelRight="Color mode" />}
          <Btn variant="subtle" onClick={downloadLogs}>⬇ Download</Btn>
          <Btn variant="ghost" onClick={() => setLogModal(false)}>Close</Btn>
        </>}>
        {logRowsLoading ? <Spinner /> : <LogContentView rows={logRows} isChart={isChart} colorMode={colorMode} />}
      </Modal>

      <Modal open={!!deviceModal} onClose={() => setDeviceModal(null)} title="Device Details" size="xl"
        footer={<Btn variant="ghost" onClick={() => setDeviceModal(null)}>Close</Btn>}>
        {deviceModal && <DeviceDetails device={deviceModal} />}
      </Modal>

      <Modal open={!!sessionModal} onClose={() => setSessionModal(null)} title="Logs Collection Session Details" size="sm">
        {sessionModal && <SessionInfo {...sessionModal} />}
      </Modal>

      <Modal open={apiModal} onClose={() => setApiModal(false)} title="Logs Collection REST API" size="xl"
        footer={<Btn variant="ghost" onClick={() => setApiModal(false)}>Close</Btn>}>
        <ApiDocs />
      </Modal>
    </>
  );
}
