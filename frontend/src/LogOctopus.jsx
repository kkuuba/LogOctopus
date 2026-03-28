import { useState, useEffect, useCallback, useRef } from "react";

// ── CONFIG ────────────────────────────────────────────────────────────────────
// Prefer the build-time env var (set in docker-compose VITE_API_BASE).
// Fall back to the current browser's hostname + port 8100 so the app works
// when opened from any device on the network (not just localhost).
const API_BASE =
  (import.meta?.env?.VITE_API_BASE) ||
  `${window.location.protocol}//${window.location.hostname}:8100`;

// Plotly is expected as a global (loaded via CDN script tag in index.html):
// <script src="https://cdn.plot.ly/plotly-2.32.0.min.js"></script>
// Or install: npm i plotly.js-dist-min  →  import Plotly from 'plotly.js-dist-min'

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

// ── AUTH CONTEXT ──────────────────────────────────────────────────────────────
// Simple client-side auth gate. In production, back this with a real session/JWT.
// Default credentials come from env vars; admin password can be changed at runtime
// and is persisted in localStorage so it survives page refreshes.
const ADMIN_USER_DEFAULT = import.meta?.env?.VITE_ADMIN_USER || "admin";
const ADMIN_PASS_DEFAULT = import.meta?.env?.VITE_ADMIN_PASS || "logoctopus";

function useAuth() {
  const [role, setRole] = useState(() => sessionStorage.getItem("lo_role") || "guest");
  // Password persisted in localStorage so changes survive refreshes.
  const [adminPass, setAdminPassState] = useState(
    () => localStorage.getItem("lo_admin_pass") || ADMIN_PASS_DEFAULT
  );

  const login = (user, pass) => {
    if (user === ADMIN_USER_DEFAULT && pass === adminPass) {
      sessionStorage.setItem("lo_role", "admin");
      setRole("admin");
      return true;
    }
    return false;
  };

  const logout = () => {
    sessionStorage.removeItem("lo_role");
    setRole("guest");
  };

  const changePassword = (currentPass, newPass) => {
    if (currentPass !== adminPass) return false;
    localStorage.setItem("lo_admin_pass", newPass);
    setAdminPassState(newPass);
    return true;
  };

  return { role, isAdmin: role === "admin", login, logout, changePassword };
}

// ── PLOTLY CHART PANEL ────────────────────────────────────────────────────────
/**
 * Renders one Plotly chart for a single snapshot's row data.
 * Supports numeric line charts and categorical scatter plots.
 * Hover tooltips, zoom, and pan are enabled by default via Plotly config.
 */
function PlotlyChart({ rows, title, index }) {
  const divRef = useRef(null);

  useEffect(() => {
    if (!divRef.current || !rows || rows.length === 0) return;

    const Plotly = window.Plotly;
    if (!Plotly) {
      divRef.current.innerHTML =
        '<p style="color:#ff6666;font-family:monospace;font-size:12px;padding:16px">Plotly not loaded — add the CDN script to index.html</p>';
      return;
    }

    const isNumeric = rows.some(
      (d) => d.content !== null && !isNaN(parseFloat(d.content))
    );

    const xValues = rows.map((d) => d.time);
    const yValues = isNumeric
      ? rows.map((d) => parseFloat(d.content))
      : rows.map((d) => d.content);

    // Cycle through a palette of accent colours for multi-chart display
    const palette = ["#00e5c8", "#7c6aff", "#ff6b6b", "#ffd166", "#06d6a0", "#118ab2"];
    const lineColor = palette[index % palette.length];

    const trace = isNumeric
      ? {
          x: xValues,
          y: yValues,
          type: "scatter",
          mode: "lines+markers",
          name: title,
          line: { color: lineColor, width: 2.5, shape: "spline", smoothing: 0.8 },
          marker: { size: 5, color: lineColor, symbol: "circle" },
          hovertemplate: "<b>%{y}<extra></extra>",
        }
      : {
          x: xValues,
          y: yValues,
          type: "scatter",
          mode: "markers",
          name: title,
          marker: { size: 8, color: lineColor, opacity: 0.85, symbol: "diamond" },
          hovertemplate: "<b>%{y}<extra></extra>",
        };

    const layout = {
      title: {
        text: title,
        font: { color: "#e8eaf0", size: 13, family: "JetBrains Mono, monospace" },
        x: 0.04,
      },
      paper_bgcolor: "transparent",
      plot_bgcolor: "rgba(8,13,28,0.6)",
      font: { color: "#6b7280", family: "JetBrains Mono, monospace", size: 11 },
      xaxis: {
        gridcolor: "rgba(255,255,255,0.06)",
        zerolinecolor: "rgba(255,255,255,0.08)",
        tickfont: { color: "#6b7280", size: 10 },
        showspikes: true,
        spikecolor: "rgba(0,229,200,0.4)",
        spikethickness: 1,
        spikedash: "dot",
      },
      yaxis: {
        gridcolor: "rgba(255,255,255,0.06)",
        zerolinecolor: "rgba(255,255,255,0.08)",
        tickfont: { color: "#6b7280", size: 10 },
        showspikes: true,
        spikecolor: "rgba(0,229,200,0.4)",
        spikethickness: 1,
        spikedash: "dot",
      },
      margin: { t: 40, r: 20, b: 48, l: 56 },
      hovermode: "x unified",
      hoverlabel: {
        bgcolor: "#111827",
        bordercolor: lineColor,
        font: { color: "#e8eaf0", size: 12, family: "JetBrains Mono, monospace" },
      },
      showlegend: false,
    };

    const config = {
      responsive: true,
      displayModeBar: true,
      modeBarButtonsToRemove: ["select2d", "lasso2d", "toggleSpikelines"],
      displaylogo: false,
      toImageButtonOptions: {
        format: "png",
        filename: title.replace(/\s+/g, "_"),
        scale: 2,
      },
    };

    Plotly.newPlot(divRef.current, [trace], layout, config);

    return () => {
      if (divRef.current) Plotly.purge(divRef.current);
    };
  }, [rows, title, index]);

  if (!rows || rows.length === 0) {
    return (
      <div
        style={{
          height: 220,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--muted)",
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          border: "1px dashed var(--border)",
          borderRadius: 8,
        }}
      >
        No data for this snapshot
      </div>
    );
  }

  return (
    <div
      style={{ marginBottom: 24, borderRadius: 8, overflow: "hidden", border: "1px solid var(--border)" }}
    >
      <div ref={divRef} style={{ width: "100%", height: 280 }} />
    </div>
  );
}

// ── MULTI-CHART LOG CONTENT VIEW ──────────────────────────────────────────────
/**
 * When isChart=true and multiple snapshots are selected, renders each
 * snapshot as its own titled Plotly panel inside the modal — side by side
 * (2-column grid) or stacked depending on count.
 */
function ChartContentView({ chartGroups }) {
  // chartGroups: [{ snapInfo, rows }]
  if (!chartGroups || chartGroups.length === 0)
    return <p style={{ color: "var(--muted)" }}>No chart data.</p>;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr",
        gap: 24,
      }}
    >
      {chartGroups.map((g, i) => {
        const label = `${g.snapInfo.deviceName} — ${g.snapInfo.logName}`;
        return (
          <div key={g.snapInfo.id}>
            <PlotlyChart rows={g.rows} title={label} index={i} />
            <div
              style={{
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
                marginTop: -12,
                marginBottom: 8,
                paddingLeft: 4,
              }}
            >
              <Badge color="cyan">{g.snapInfo.logName}</Badge>
              <Badge color="default">{g.snapInfo.deviceName}</Badge>
              <Badge color="default">{g.rows.length} points</Badge>
              <Badge color="default">Session: {g.snapInfo.sessionId}</Badge>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── LOG CONTENT VIEW (text) ───────────────────────────────────────────────────
function LogContentView({ rows, isChart, colorMode, chartGroups }) {
  if (isChart) return <ChartContentView chartGroups={chartGroups} />;

  if (!rows || rows.length === 0) return <p style={{ color: "var(--muted)" }}>No data.</p>;

  const logColors = {};
  const palette = ["#2d6a4f", "#1d3557", "#5c2d91", "#7b2d00", "#004e64", "#3d2645"];
  [...new Set(rows.map((r) => r.log_name))].forEach((n, i) => {
    logColors[n] = palette[i % palette.length];
  });

  return (
    <div style={{ overflowX: "auto" }}>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontFamily: "var(--font-mono)",
          fontSize: 12,
        }}
      >
        <thead>
          <tr>
            {["Timestamp", "Device", "Log Name", "Content"].map((h) => (
              <th
                key={h}
                style={{
                  padding: "8px 12px",
                  textAlign: "left",
                  color: "var(--muted)",
                  borderBottom: "1px solid var(--border)",
                  fontSize: 10,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const bg = colorMode ? logColors[r.log_name] + "66" : "transparent";
            const isErr = (r.content || "").startsWith("ERROR");
            const isWarn = (r.content || "").startsWith("WARN");
            return (
              <tr
                key={i}
                style={{ borderBottom: "1px solid rgba(255,255,255,0.04)", background: bg }}
              >
                <td style={{ padding: "7px 12px", color: "var(--muted)", whiteSpace: "nowrap" }}>
                  {r.time}
                </td>
                <td style={{ padding: "7px 12px", whiteSpace: "nowrap" }}>
                  {r.device_name ? <Badge color="default">{r.device_name}</Badge> : null}
                </td>
                <td style={{ padding: "7px 12px" }}>
                  <Badge color="cyan">{r.log_name}</Badge>
                </td>
                <td
                  style={{
                    padding: "7px 12px",
                    color: isErr ? "#ff6666" : isWarn ? "#ffc800" : "var(--text)",
                  }}
                >
                  {r.content}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── SETTINGS MODAL ────────────────────────────────────────────────────────────
/**
 * Settings panel with two tabs:
 *  1. Auto-Collection — configure hourly (or custom interval) scheduled log
 *     collection per device. The schedule is stored in localStorage and driven
 *     by a setInterval registered in the App component on mount, so it runs
 *     as long as the browser tab is open. For server-side scheduling (runs even
 *     when the browser is closed) the backend exposes POST /api/settings/auto-collection
 *     which persists the schedule and uses APScheduler to execute collections.
 *  2. Security — admin password change (stored in localStorage).
 */
function SettingsModal({ open, onClose, isAdmin, onRequestLogin, devices, auth, addToast, autoSchedule, setAutoSchedule }) {
  const [tab, setTab] = useState("schedule");

  // ── Password change state ──
  const [curPass,  setCurPass]  = useState("");
  const [newPass,  setNewPass]  = useState("");
  const [confPass, setConfPass] = useState("");
  const [pwError,  setPwError]  = useState("");
  const [pwShake,  setPwShake]  = useState(false);

  const submitPasswordChange = () => {
    if (newPass.length < 6)      { setPwError("New password must be at least 6 characters."); shake(); return; }
    if (newPass !== confPass)    { setPwError("Passwords do not match.");                      shake(); return; }
    const ok = auth.changePassword(curPass, newPass);
    if (!ok)                     { setPwError("Current password is incorrect.");               shake(); return; }
    setPwError(""); setCurPass(""); setNewPass(""); setConfPass("");
    addToast("Admin password updated successfully.", "success");
    // Also push to backend if available (best-effort)
    apiFetch("/api/settings/change-password", {
      method: "POST",
      body: JSON.stringify({ new_password: newPass }),
    }).catch(() => {});
  };

  const shake = () => { setPwShake(true); setTimeout(() => setPwShake(false), 420); };

  // ── Schedule state ──
  // autoSchedule shape: { enabled: bool, intervalHours: number, deviceIds: string[] }
  const toggleDevice = (id) =>
    setAutoSchedule(prev => ({
      ...prev,
      deviceIds: prev.deviceIds.includes(id)
        ? prev.deviceIds.filter(x => x !== id)
        : [...prev.deviceIds, id],
    }));

  const saveSchedule = async () => {
    // Persist to localStorage (client-side scheduler)
    localStorage.setItem("lo_auto_schedule", JSON.stringify(autoSchedule));
    // Best-effort push to backend (server-side APScheduler)
    try {
      await apiFetch("/api/settings/auto-collection", {
        method: "POST",
        body: JSON.stringify({
          enabled:        autoSchedule.enabled,
          interval_hours: autoSchedule.intervalHours,
          device_ids:     autoSchedule.deviceIds,
        }),
      });
    } catch {
      // Backend endpoint optional — client-side schedule still works
    }
    addToast("Schedule saved. Collection will run every " + autoSchedule.intervalHours + "h while this tab is open.", "success");
  };

  if (!open) return null;

  const tabStyle = (active) => ({
    padding: "8px 18px",
    borderRadius: 7,
    fontFamily: "var(--font-display)",
    fontWeight: 700,
    fontSize: 12,
    cursor: "pointer",
    border: "none",
    background: active ? "rgba(0,229,200,0.15)" : "transparent",
    color: active ? "var(--accent)" : "var(--muted)",
    letterSpacing: "0.05em",
    transition: "all 0.15s",
  });

  const sectionLabel = { fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: "var(--font-mono)", marginBottom: 8 };
  const card = { background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 10, padding: "18px 20px", marginBottom: 16 };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1500, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.78)", backdropFilter: "blur(5px)" }} />
      <div style={{
        position: "relative", zIndex: 1,
        background: "var(--modal-bg)", border: "1px solid var(--border)", borderRadius: 14,
        width: 580, maxWidth: "calc(100vw - 40px)", maxHeight: "calc(100vh - 60px)",
        display: "flex", flexDirection: "column",
        boxShadow: "0 24px 60px rgba(0,0,0,0.6)",
      }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 24px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 20 }}>⚙️</span>
            <h3 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 800, color: "var(--text)", letterSpacing: "0.04em" }}>Settings</h3>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 20, lineHeight: 1, padding: "2px 6px" }}>×</button>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 4, padding: "12px 20px 0", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <button style={tabStyle(tab === "schedule")} onClick={() => setTab("schedule")}>⏰ Auto-Collection</button>
          <button style={tabStyle(tab === "security")} onClick={() => setTab("security")}>🔐 Security</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>

          {/* ── AUTO-COLLECTION TAB ── */}
          {tab === "schedule" && (
            <div>
              <div style={{ ...card, borderColor: autoSchedule.enabled ? "rgba(0,229,200,0.3)" : "var(--border)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: autoSchedule.enabled ? 16 : 0 }}>
                  <div>
                    <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 14, color: "var(--text)", marginBottom: 3 }}>Scheduled Auto-Collection</div>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted)" }}>
                      Automatically collect logs from selected devices on a recurring interval.
                    </div>
                  </div>
                  <Toggle
                    checked={autoSchedule.enabled}
                    onChange={v => setAutoSchedule(prev => ({ ...prev, enabled: v }))}
                  />
                </div>

                {autoSchedule.enabled && (
                  <>
                    <div style={{ ...sectionLabel }}>Collection Interval</div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 20 }}>
                      {[1, 2, 4, 6, 12, 24].map(h => (
                        <button key={h} onClick={() => setAutoSchedule(prev => ({ ...prev, intervalHours: h }))}
                          style={{
                            padding: "6px 14px", borderRadius: 7, border: "1px solid",
                            fontFamily: "var(--font-mono)", fontSize: 12, cursor: "pointer",
                            background: autoSchedule.intervalHours === h ? "rgba(0,229,200,0.15)" : "rgba(255,255,255,0.04)",
                            color: autoSchedule.intervalHours === h ? "var(--accent)" : "var(--muted)",
                            borderColor: autoSchedule.intervalHours === h ? "rgba(0,229,200,0.4)" : "var(--border)",
                            transition: "all 0.12s",
                          }}>
                          {h}h
                        </button>
                      ))}
                    </div>

                    <div style={{ ...sectionLabel }}>Devices to collect from</div>
                    {devices.length === 0 ? (
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--muted)" }}>No devices added yet.</div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {devices.map(d => {
                          const checked = autoSchedule.deviceIds.includes(d.id);
                          return (
                            <div key={d.id} onClick={() => toggleDevice(d.id)}
                              style={{
                                display: "flex", alignItems: "center", gap: 12, padding: "10px 14px",
                                borderRadius: 8, border: "1px solid", cursor: "pointer",
                                background: checked ? "rgba(0,229,200,0.06)" : "rgba(255,255,255,0.02)",
                                borderColor: checked ? "rgba(0,229,200,0.3)" : "var(--border)",
                                transition: "all 0.12s",
                              }}>
                              <input type="checkbox" checked={checked} readOnly
                                style={{ accentColor: "var(--accent)", width: 14, height: 14, pointerEvents: "none" }} />
                              <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 13, color: "var(--text)", flex: 1 }}>{d.name}</span>
                              <span style={{ width: 8, height: 8, borderRadius: "50%", background: d.connection ? "#00e564" : "#555", flexShrink: 0 }} />
                              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted)" }}>{d.connection ? "Online" : "Offline"}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Info box about server-side persistence */}
              {/* <div style={{
                background: "rgba(255,200,0,0.06)", border: "1px solid rgba(255,200,0,0.2)",
                borderRadius: 8, padding: "12px 16px", marginBottom: 16,
                fontFamily: "var(--font-mono)", fontSize: 11, color: "#ffc800", lineHeight: 1.6,
              }}>
                <strong>ℹ Browser-tab scheduling:</strong> The interval timer runs while this tab is open.
                For server-side scheduling (runs even when the browser is closed), the schedule is also
                pushed to <code style={{ background: "rgba(255,200,0,0.1)", padding: "1px 5px", borderRadius: 3 }}>POST /api/settings/auto-collection</code> — add APScheduler to the Flask backend to activate it.
              </div> */}

              <Btn variant="primary" onClick={saveSchedule} style={{ width: "100%", justifyContent: "center" }}>
                💾 Save Schedule
              </Btn>
            </div>
          )}

          {/* ── SECURITY TAB ── */}
          {tab === "security" && (
            <div>
              {!isAdmin ? (
                <div style={{
                  background: "rgba(124,106,255,0.07)", border: "1px solid rgba(124,106,255,0.2)",
                  borderRadius: 8, padding: "24px 20px", textAlign: "center",
                  fontFamily: "var(--font-mono)", fontSize: 12, color: "#a89aff",
                }}>
                  <div style={{ fontSize: 28, marginBottom: 12 }}>🔒</div>
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>Admin login required</div>
                  <div style={{ color: "var(--muted)", marginBottom: 16 }}>Sign in as admin to manage security settings.</div>
                  <Btn variant="admin" onClick={onRequestLogin}>🔐 Sign In</Btn>
                </div>
              ) : (
                <div style={{ animation: pwShake ? "shake 0.4s ease" : "none" }}>
                  <style>{`@keyframes shake { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-7px)} 75%{transform:translateX(7px)} }`}</style>
                  <div style={card}>
                    <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 14, color: "var(--text)", marginBottom: 14 }}>Change Admin Password</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      <div>
                        <div style={sectionLabel}>Current Password</div>
                        <input type="password" value={curPass} onChange={e => { setCurPass(e.target.value); setPwError(""); }}
                          placeholder="Current password" style={inputStyle} />
                      </div>
                      <div>
                        <div style={sectionLabel}>New Password</div>
                        <input type="password" value={newPass} onChange={e => { setNewPass(e.target.value); setPwError(""); }}
                          placeholder="Min. 6 characters" style={inputStyle} />
                      </div>
                      <div>
                        <div style={sectionLabel}>Confirm New Password</div>
                        <input type="password" value={confPass} onChange={e => { setConfPass(e.target.value); setPwError(""); }}
                          onKeyDown={e => e.key === "Enter" && submitPasswordChange()}
                          placeholder="Repeat new password" style={inputStyle} />
                      </div>
                      {pwError && (
                        <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#ff6666", background: "rgba(255,60,60,0.08)", border: "1px solid rgba(255,60,60,0.2)", borderRadius: 6, padding: "7px 12px" }}>
                          ⚠ {pwError}
                        </div>
                      )}
                      <Btn variant="primary" onClick={submitPasswordChange} style={{ justifyContent: "center", marginTop: 4 }}>
                        Update Password
                      </Btn>
                    </div>
                  </div>

                  <div style={{ ...card, marginBottom: 0 }}>
                    <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 14, color: "var(--text)", marginBottom: 6 }}>Session</div>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--muted)", marginBottom: 14 }}>
                      Currently signed in as <span style={{ color: "#a89aff" }}>admin</span>. Session persists until you sign out or close the browser.
                    </div>
                    <Btn variant="danger" size="sm" onClick={() => { auth.logout(); onClose(); addToast("Signed out.", "info"); }}>
                      Sign Out
                    </Btn>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── LOGIN MODAL ───────────────────────────────────────────────────────────────
function LoginModal({ open, onClose, onLogin }) {
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [error, setError] = useState("");
  const [shaking, setShaking] = useState(false);

  const attempt = () => {
    if (onLogin(user, pass)) {
      setUser(""); setPass(""); setError(""); onClose();
    } else {
      setError("Invalid credentials");
      setShaking(true);
      setTimeout(() => setShaking(false), 500);
    }
  };

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.8)", backdropFilter: "blur(6px)" }} />
      <div
        style={{
          position: "relative",
          zIndex: 1,
          background: "var(--modal-bg)",
          border: "1px solid var(--border)",
          borderRadius: 14,
          padding: "36px 40px",
          width: 380,
          boxShadow: "0 24px 80px rgba(0,229,200,0.08), 0 0 0 1px rgba(0,229,200,0.08)",
          animation: shaking ? "shake 0.4s ease" : "none",
        }}
      >
        <style>{`@keyframes shake { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-8px)} 75%{transform:translateX(8px)} }`}</style>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: "50%",
              background: "rgba(0,229,200,0.12)",
              border: "1px solid rgba(0,229,200,0.3)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 16px",
              fontSize: 22,
            }}
          >
            🔐
          </div>
          <h3
            style={{
              margin: 0,
              fontFamily: "var(--font-display)",
              fontSize: 18,
              fontWeight: 800,
              color: "var(--text)",
              letterSpacing: "-0.01em",
            }}
          >
            Admin Login
          </h3>
          <p style={{ margin: "6px 0 0", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted)" }}>
            Required to view device configuration
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <input
            value={user}
            onChange={(e) => setUser(e.target.value)}
            placeholder="Username"
            autoFocus
            onKeyDown={(e) => e.key === "Enter" && attempt()}
            style={inputStyle}
          />
          <input
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            placeholder="Password"
            onKeyDown={(e) => e.key === "Enter" && attempt()}
            style={inputStyle}
          />
          {error && (
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "#ff6666",
                background: "rgba(255,60,60,0.08)",
                border: "1px solid rgba(255,60,60,0.2)",
                borderRadius: 6,
                padding: "7px 12px",
              }}
            >
              ⚠ {error}
            </div>
          )}
          <Btn variant="primary" onClick={attempt} style={{ width: "100%", justifyContent: "center", marginTop: 4 }}>
            Sign In
          </Btn>
          <Btn variant="ghost" onClick={onClose} style={{ width: "100%", justifyContent: "center" }}>
            Cancel
          </Btn>
        </div>
      </div>
    </div>
  );
}

const inputStyle = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--text)",
  fontFamily: "var(--font-mono)",
  fontSize: 13,
  padding: "10px 14px",
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

// ── MODAL ─────────────────────────────────────────────────────────────────────
function Modal({ open, onClose, title, size = "lg", children, footer }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    if (open) document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;
  const widths = { sm: 480, md: 600, lg: 860, xl: 1100, full: "calc(100vw - 40px)" };
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)" }} />
      <div
        style={{
          position: "relative",
          zIndex: 1,
          background: "var(--modal-bg)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          width: widths[size] || widths.lg,
          maxWidth: "calc(100vw - 40px)",
          maxHeight: "calc(100vh - 40px)",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 24px 60px rgba(0,0,0,0.6)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "18px 24px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <h3
            style={{
              margin: 0,
              fontSize: 16,
              fontFamily: "var(--font-display)",
              letterSpacing: "0.04em",
              color: "var(--text)",
            }}
          >
            {title}
          </h3>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "var(--muted)",
              cursor: "pointer",
              fontSize: 20,
              lineHeight: 1,
              padding: "2px 6px",
            }}
          >
            ×
          </button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>{children}</div>
        {footer && (
          <div
            style={{
              padding: "14px 24px",
              borderTop: "1px solid var(--border)",
              display: "flex",
              gap: 10,
              justifyContent: "flex-end",
              flexShrink: 0,
            }}
          >
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
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "3px 10px",
        borderRadius: 20,
        fontSize: 11,
        fontFamily: "var(--font-mono)",
        fontWeight: 600,
        background: c.bg,
        color: c.text,
        border: `1px solid ${c.border}`,
      }}
    >
      {children}
    </span>
  );
}

// ── BUTTON ────────────────────────────────────────────────────────────────────
function Btn({ variant = "default", size = "md", onClick, disabled, children, style }) {
  const base = {
    cursor: disabled ? "not-allowed" : "pointer",
    border: "none",
    borderRadius: 8,
    fontFamily: "var(--font-display)",
    fontWeight: 600,
    letterSpacing: "0.03em",
    transition: "all 0.15s",
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    opacity: disabled ? 0.5 : 1,
  };
  const sizes = {
    sm: { padding: "5px 12px", fontSize: 12 },
    md: { padding: "9px 18px", fontSize: 13 },
    lg: { padding: "12px 24px", fontSize: 14 },
  };
  const variants = {
    default: { background: "var(--card-bg)", color: "var(--text)", border: "1px solid var(--border)" },
    primary: { background: "var(--accent)", color: "#0a0f1e" },
    success: { background: "#00e564", color: "#0a0f1e" },
    danger:  { background: "#ff4444", color: "#fff" },
    ghost:   { background: "transparent", color: "var(--muted)", border: "1px solid var(--border)" },
    subtle:  { background: "rgba(255,255,255,0.06)", color: "var(--text)", border: "1px solid var(--border)" },
    admin:   { background: "rgba(124,106,255,0.15)", color: "#a89aff", border: "1px solid rgba(124,106,255,0.35)" },
  };
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{ ...base, ...sizes[size], ...variants[variant], ...style }}
    >
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
    error:   { bg: "rgba(255,60,60,0.12)",  border: "rgba(255,60,60,0.3)",  text: "#ff6666" },
    success: { bg: "rgba(0,229,100,0.12)",  border: "rgba(0,229,100,0.3)",  text: "#00e564" },
    info:    { bg: "rgba(0,229,200,0.12)",  border: "rgba(0,229,200,0.3)",  text: "#00e5c8" },
  };
  const c = colors[type] || colors.info;
  return (
    <div
      style={{
        background: c.bg,
        border: `1px solid ${c.border}`,
        borderRadius: 8,
        padding: "12px 18px",
        marginBottom: 12,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        color: c.text,
        fontFamily: "var(--font-mono)",
        fontSize: 13,
      }}
    >
      {message}
      <button
        onClick={onDismiss}
        style={{ background: "none", border: "none", color: c.text, cursor: "pointer", fontSize: 18 }}
      >
        ×
      </button>
    </div>
  );
}

// ── DEVICE CARD ───────────────────────────────────────────────────────────────
function DeviceCard({ device, selected, onSelect, onInfo }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "relative",
        width: 220,
        borderRadius: 12,
        padding: "16px 14px",
        background: selected ? "rgba(0,229,200,0.07)" : "var(--card-bg)",
        border: `1px solid ${selected ? "var(--accent)" : hovered ? "rgba(0,229,200,0.3)" : "var(--border)"}`,
        transition: "all 0.2s",
        cursor: "default",
        boxShadow: selected ? "0 0 16px rgba(0,229,200,0.12)" : "none",
      }}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={(e) => onSelect(e.target.checked)}
        style={{ position: "absolute", top: 12, left: 12, width: 16, height: 16, accentColor: "var(--accent)", cursor: "pointer" }}
      />
      <button
        onClick={onInfo}
        style={{
          position: "absolute",
          top: 10,
          right: 10,
          background: "rgba(255,255,255,0.07)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          color: "var(--muted)",
          cursor: "pointer",
          fontSize: 13,
          padding: "2px 7px",
        }}
      >
        ⚙
      </button>
      <div
        style={{
          marginTop: 20,
          marginBottom: 10,
          fontFamily: "var(--font-display)",
          fontSize: 15,
          fontWeight: 700,
          color: "var(--text)",
          letterSpacing: "0.03em",
        }}
      >
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
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: ok ? "#00e564" : "#555",
          boxShadow: ok && pulseWhenTrue ? "0 0 6px #00e564" : "none",
        }}
      />
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
              <th
                key={i}
                style={{
                  padding: "10px 14px",
                  textAlign: "left",
                  color: "var(--muted)",
                  borderBottom: "1px solid var(--border)",
                  fontWeight: 600,
                  letterSpacing: "0.06em",
                  fontSize: 10,
                  textTransform: "uppercase",
                  whiteSpace: "nowrap",
                }}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {snapshots.map((s) => (
            <tr
              key={s.id}
              style={{ borderBottom: "1px solid var(--border)", transition: "background 0.12s" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.03)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <td style={{ padding: "10px 14px" }}>
                <input
                  type="checkbox"
                  checked={selected.includes(s.id)}
                  onChange={(e) => onSelect(s.id, e.target.checked)}
                  style={{ accentColor: "var(--accent)", width: 14, height: 14 }}
                />
              </td>
              <td style={{ padding: "10px 14px", color: "var(--text)" }}>{s.deviceName}</td>
              <td style={{ padding: "10px 14px" }}><Badge color="cyan">{s.logName}</Badge></td>
              <td style={{ padding: "10px 14px", color: "var(--muted)" }}>{s.startTime}</td>
              <td style={{ padding: "10px 14px", color: "var(--muted)" }}>{s.finishTime}</td>
              <td style={{ padding: "10px 14px", color: "var(--text)" }}>{s.duration}s</td>
              <td style={{ padding: "10px 14px", color: "var(--text)" }}>{s.sizeKb} kB</td>
              <td style={{ padding: "10px 14px" }}>
                <code style={{ fontSize: 10, color: "var(--muted)", background: "rgba(255,255,255,0.05)", padding: "2px 6px", borderRadius: 4 }}>
                  {s.sessionId}
                </code>
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
    { method: "GET",    path: "/api/devices",               desc: "List all managed devices with current statuses.", req: null, res: `[{ "id": "…", "name": "Router-Alpha", "connection": true, "logAccess": true, "collecting": false }]` },
    { method: "POST",   path: "/api/devices",               desc: "Add a new device from a base64-encoded JSON config file.", req: `{ "contents": "<base64 data URI>" }`, res: `{ "device": { "id": "…", "name": "…" } }` },
    { method: "DELETE", path: "/api/devices/:id",           desc: "Remove a device and stop its watchdog process.", req: null, res: `204 No Content` },
    { method: "GET",    path: "/api/snapshots",             desc: "List snapshots. Supports ?search_param=&search_value=&log_type=text|chart", req: null, res: `[{ "id": 1, "deviceName": "…", "logName": "syslog", "sessionId": "…", "isChart": false }]` },
    { method: "GET",    path: "/api/snapshots/:id/content", desc: "Retrieve full log content rows for a snapshot.", req: null, res: `{ "rows": [{ "timestamp": "…", "log_name": "syslog", "content": "INFO …" }] }` },
    { method: "POST",   path: "/api/start-logs-collection", desc: "Start log collection on selected devices.", req: `{ "selected_devices": ["device_1"] }`, res: `{ "status": "logs collection started", "session_id": "8cd7112719ac" }` },
    { method: "POST",   path: "/api/stop-logs-collection",  desc: "Stop log collection and save collected logs.", req: `{ "selected_devices": ["device_1"], "session_id": "8cd7112719ac" }`, res: `{ "status": "logs collection stopped", "text_logs_url": "…", "chart_logs_url": "…" }` },
  ];

  const methodColor = { GET: "cyan", POST: "green", DELETE: "red" };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {endpoints.map((ep) => (
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
function DeviceDetails({ device, isAdmin, onRequestLogin }) {
  const [configVisible, setConfigVisible] = useState(false);

  const handleShowConfig = () => {
    if (!isAdmin) { onRequestLogin(); return; }
    setConfigVisible((v) => !v);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        {[
          ["Name",       device.name],
          ["Connection", device.connection ? "✅ Online" : "❌ Offline"],
          ["Log Access", device.logAccess  ? "✅ Yes"    : "❌ No"],
          ["Collecting", device.collecting ? "🟢 Active" : "🟡 Idle"],
        ].map(([k, v]) => (
          <div
            key={k}
            style={{
              background: "var(--card-bg)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "12px 18px",
              minWidth: 140,
            }}
          >
            <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>{k}</div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 14, color: "var(--text)" }}>{v}</div>
          </div>
        ))}
      </div>

      {/* Config section — guarded by admin role */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
          <h4 style={{ fontFamily: "var(--font-display)", fontSize: 13, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em", margin: 0 }}>
            JSON Configuration
          </h4>
          <Btn size="sm" variant={isAdmin ? "subtle" : "admin"} onClick={handleShowConfig}>
            {isAdmin
              ? configVisible ? "🙈 Hide" : "👁 Show"
              : "🔐 Admin only"}
          </Btn>
        </div>

        {!isAdmin && (
          <div
            style={{
              background: "rgba(124,106,255,0.07)",
              border: "1px solid rgba(124,106,255,0.2)",
              borderRadius: 8,
              padding: "18px 20px",
              display: "flex",
              alignItems: "center",
              gap: 14,
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              color: "#a89aff",
            }}
          >
            <span style={{ fontSize: 22 }}>🔒</span>
            <div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Configuration is restricted</div>
              <div style={{ color: "var(--muted)" }}>Sign in as admin to view the raw device JSON configuration.</div>
            </div>
            <Btn size="sm" variant="admin" onClick={onRequestLogin} style={{ marginLeft: "auto", whiteSpace: "nowrap" }}>
              Sign In
            </Btn>
          </div>
        )}

        {isAdmin && configVisible && device.config && (
          <pre
            style={{
              background: "rgba(0,0,0,0.4)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: 16,
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              color: "#a8ff78",
              overflowX: "auto",
              margin: 0,
            }}
          >
            {JSON.stringify(device.config, null, 2)}
          </pre>
        )}

        {isAdmin && configVisible && !device.config && (
          <p style={{ color: "var(--muted)", fontFamily: "var(--font-mono)", fontSize: 12 }}>No configuration data available.</p>
        )}
      </div>
    </div>
  );
}

// ── UPLOAD BUTTON ─────────────────────────────────────────────────────────────
function UploadBtn({ onUpload }) {
  const ref = useRef();
  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => onUpload(ev.target.result);
    reader.readAsDataURL(file);
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
      {labelLeft && (
        <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 12, color: checked ? "var(--muted)" : "var(--text)" }}>
          {labelLeft}
        </span>
      )}
      <div
        onClick={() => onChange(!checked)}
        style={{
          width: 44,
          height: 24,
          borderRadius: 12,
          background: checked ? "var(--accent)" : "var(--border)",
          position: "relative",
          cursor: "pointer",
          transition: "background 0.2s",
          border: "1px solid var(--border)",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 3,
            left: checked ? 22 : 2,
            width: 16,
            height: 16,
            borderRadius: "50%",
            background: "#fff",
            transition: "left 0.2s",
            boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
          }}
        />
      </div>
      {labelRight && (
        <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 12, color: checked ? "var(--text)" : "var(--muted)" }}>
          {labelRight}
        </span>
      )}
    </div>
  );
}

// ── COLLECTION LOADING OVERLAY ────────────────────────────────────────────────
/**
 * Full-screen blocking overlay shown while stop-collection is in flight.
 * The backend may take up to 60 s (teardown timeout) before it responds,
 * so we give the user clear visual feedback with an animated octopus tentacle
 * ring, a progress-style pulse, and a step-by-step status carousel.
 */
const STOP_MESSAGES = [
  "Signalling watchdog processes…",
  "Draining log buffers…",
  "Waiting for teardown…",
  "Packaging snapshots…",
  "Almost there…",
];

function CollectionLoadingOverlay({ open }) {
  const [msgIdx, setMsgIdx] = useState(0);

  useEffect(() => {
    if (!open) { setMsgIdx(0); return; }
    const id = setInterval(() => setMsgIdx((i) => (i + 1) % STOP_MESSAGES.length), 2200);
    return () => clearInterval(id);
  }, [open]);

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 3000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(8,13,28,0.88)",
        backdropFilter: "blur(8px)",
      }}
    >
      <style>{`
        @keyframes lo-spin   { from{transform:rotate(0deg)}   to{transform:rotate(360deg)} }
        @keyframes lo-rspin  { from{transform:rotate(0deg)}   to{transform:rotate(-360deg)} }
        @keyframes lo-pulse  { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.55;transform:scale(1.18)} }
        @keyframes lo-fadein { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
        @keyframes lo-dot    { 0%,80%,100%{opacity:0.15;transform:scale(0.8)} 40%{opacity:1;transform:scale(1)} }
        .lo-dot:nth-child(1){animation-delay:0s}
        .lo-dot:nth-child(2){animation-delay:0.2s}
        .lo-dot:nth-child(3){animation-delay:0.4s}
      `}</style>

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 28 }}>

        {/* Animated concentric rings */}
        <div style={{ position: "relative", width: 96, height: 96 }}>
          {/* Outer ring */}
          <svg
            width="96" height="96"
            style={{ position: "absolute", inset: 0, animation: "lo-spin 3s linear infinite" }}
          >
            <circle cx="48" cy="48" r="44"
              fill="none" stroke="rgba(0,229,200,0.18)" strokeWidth="2"
              strokeDasharray="40 8 20 8" />
          </svg>
          {/* Middle ring */}
          <svg
            width="96" height="96"
            style={{ position: "absolute", inset: 0, animation: "lo-rspin 2s linear infinite" }}
          >
            <circle cx="48" cy="48" r="34"
              fill="none" stroke="rgba(124,106,255,0.3)" strokeWidth="2.5"
              strokeDasharray="30 6" />
          </svg>
          {/* Inner pulsing core */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                width: 42,
                height: 42,
                borderRadius: "50%",
                background: "radial-gradient(circle at 40% 40%, rgba(0,229,200,0.35), rgba(8,13,28,0.9))",
                border: "1.5px solid rgba(0,229,200,0.5)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 20,
                animation: "lo-pulse 1.6s ease-in-out infinite",
                boxShadow: "0 0 24px rgba(0,229,200,0.25)",
              }}
            >
              🐙
            </div>
          </div>
        </div>

        {/* Title */}
        <div style={{
          fontFamily: "var(--font-display)",
          fontWeight: 800,
          fontSize: 17,
          color: "var(--text)",
          letterSpacing: "-0.01em",
        }}>
          Stopping Collection
        </div>

        {/* Cycling status message */}
        <div
          key={msgIdx}
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            color: "var(--accent)",
            animation: "lo-fadein 0.35s ease",
            minHeight: 18,
          }}
        >
          {STOP_MESSAGES[msgIdx]}
        </div>

        {/* Bouncing dots */}
        <div style={{ display: "flex", gap: 7 }}>
          {[0,1,2].map(i => (
            <div
              key={i}
              className="lo-dot"
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: "var(--accent)",
                animation: "lo-dot 1.2s ease-in-out infinite",
              }}
            />
          ))}
        </div>

        {/* Subtle disclaimer */}
        <div style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          color: "var(--muted)",
          maxWidth: 280,
          textAlign: "center",
          lineHeight: 1.6,
        }}>
          Waiting for device teardown — this may take up to 60 s.
          <br />Do not close the tab.
        </div>
      </div>
    </div>
  );
}

// ── SESSION INFO ──────────────────────────────────────────────────────────────
function SessionInfo({ sessionId, textUrl, chartUrl }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, alignItems: "center", padding: "10px 0" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Session ID</div>
        <code style={{ fontSize: 20, fontFamily: "var(--font-mono)", color: "var(--accent)", letterSpacing: "0.1em" }}>
          {sessionId}
        </code>
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
  const auth = useAuth();

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

  // stop-collection loading overlay
  const [stoppingCollection, setStoppingCollection] = useState(false);

  // modals
  const [logModal,        setLogModal]        = useState(false);
  const [logRows,         setLogRows]         = useState([]);
  const [chartGroups,     setChartGroups]     = useState([]); // [{ snapInfo, rows }]
  const [logRowsLoading,  setLogRowsLoading]  = useState(false);
  const [colorMode,       setColorMode]       = useState(false);
  const [deviceModal,     setDeviceModal]     = useState(null);
  const [sessionModal,    setSessionModal]    = useState(null);
  const [apiModal,        setApiModal]        = useState(false);
  const [loginModal,      setLoginModal]      = useState(false);
  const [settingsModal,   setSettingsModal]   = useState(false);

  // Auto-collection schedule — persisted in localStorage, re-hydrated on mount.
  // Timer runs while this tab is open. Also pushed to /api/settings/auto-collection
  // for server-side APScheduler support (backend must implement that endpoint).
  const [autoSchedule, setAutoSchedule] = useState(() => {
    try {
      const saved = localStorage.getItem("lo_auto_schedule");
      return saved ? JSON.parse(saved) : { enabled: false, intervalHours: 1, deviceIds: [] };
    } catch { return { enabled: false, intervalHours: 1, deviceIds: [] }; }
  });

  // toasts
  const [toasts, setToasts] = useState([]);
  const addToast    = useCallback((message, type = "error") => setToasts((prev) => [...prev, { id: Date.now(), message, type }]), []);
  const dismissToast = useCallback((id) => setToasts((prev) => prev.filter((t) => t.id !== id)), []);

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

  useEffect(() => {
    const id = setInterval(fetchDevices, 10000);
    return () => clearInterval(id);
  }, [fetchDevices]);

  const prevIsChart = useRef(isChart);
  useEffect(() => {
    if (prevIsChart.current === isChart) return;
    prevIsChart.current = isChart;
    fetchSnapshots(filterActive ? searchParam : "", filterActive ? searchValue : "", isChart);
  });

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

  // Auto-collection interval — client-side scheduler
  useEffect(() => {
    if (!autoSchedule.enabled || autoSchedule.deviceIds.length === 0) return;
    const ms = autoSchedule.intervalHours * 60 * 60 * 1000;
    const id = setInterval(async () => {
      const names = devices
        .filter(d => autoSchedule.deviceIds.includes(d.id))
        .map(d => d.name);
      if (names.length === 0) return;
      try {
        const { session_id } = await apiFetch("/api/start-logs-collection", {
          method: "POST", body: JSON.stringify({ selected_devices: names }),
        });
        // Give collection 30 s then stop
        setTimeout(async () => {
          try {
            await apiFetch("/api/stop-logs-collection", {
              method: "POST", body: JSON.stringify({ selected_devices: names, session_id }),
            });
            fetchDevices();
            fetchSnapshots("", "", false);
          } catch (e) { console.warn("Auto-collect stop failed", e); }
        }, 30000);
      } catch (e) { console.warn("Auto-collect start failed", e); }
    }, ms);
    return () => clearInterval(id);
  }, [autoSchedule.enabled, autoSchedule.intervalHours, autoSchedule.deviceIds, devices, fetchDevices, fetchSnapshots]);

  // ── handlers ───────────────────────────────────────────────────────────────
  const handleUpload = async (contents) => {
    try {
      const { device } = await apiFetch("/api/devices", { method: "POST", body: JSON.stringify({ contents }) });
      setDevices((prev) => [...prev, device]);
      addToast("Device added successfully.", "success");
    } catch (e) {
      addToast(e.status === 422 ? "Incorrect config file — could not parse device configuration." : `Upload failed: ${e.message}`);
    }
  };

  const toggleDevice = (id, checked) =>
    setSelectedDevices((prev) => (checked ? [...prev, id] : prev.filter((x) => x !== id)));

  const startCollection = async () => {
    const names = devices.filter((d) => selectedDevices.includes(d.id)).map((d) => d.name);
    try {
      await apiFetch("/api/start-logs-collection", { method: "POST", body: JSON.stringify({ selected_devices: names }) });
      addToast("Log collection started.", "success");
      fetchDevices();
      fetchSnapshots(filterActive ? searchParam : "", filterActive ? searchValue : "", isChart);
    } catch (e) { addToast(`Failed to start collection: ${e.message}`); }
  };

  const stopCollection = async () => {
    const names = devices.filter((d) => selectedDevices.includes(d.id)).map((d) => d.name);
    const runningDev = devices.find((d) => selectedDevices.includes(d.id) && d.collecting);
    const session_id = runningDev?.config?.current_session_id || "";
    setStoppingCollection(true);
    try {
      const result = await apiFetch("/api/stop-logs-collection", { method: "POST", body: JSON.stringify({ selected_devices: names, session_id }) });
      setSessionModal({ sessionId: result.session_id, textUrl: result.text_logs_url, chartUrl: result.chart_logs_url });
      fetchDevices();
      fetchSnapshots(filterActive ? searchParam : "", filterActive ? searchValue : "", isChart);
    } catch (e) { addToast(`Failed to stop collection: ${e.message}`); }
    finally { setStoppingCollection(false); }
  };

  const removeSelected = async () => {
    await Promise.all(
      selectedDevices.map((id) =>
        apiFetch(`/api/devices/${id}`, { method: "DELETE" }).catch((e) => addToast(`Remove failed: ${e.message}`))
      )
    );
    setSelectedDevices([]);
    fetchDevices();
  };

  const toggleSnap = (id, checked) =>
    setSelectedSnaps((prev) => (checked ? [...prev, id] : prev.filter((x) => x !== id)));

  /**
   * Opens the log/chart modal.
   * For chart mode: fetches each snapshot separately and builds chartGroups
   * so each snapshot gets its own Plotly panel inside the modal.
   * For text mode: merges all rows as before.
   */
  const openLogContent = async (snapsToView) => {
    setLogModal(true);
    setLogRowsLoading(true);
    setLogRows([]);
    setChartGroups([]);

    try {
      const results = await Promise.all(
        snapsToView.map((s) =>
          apiFetch(`/api/snapshots/${s.id}/content?log_type=${isChart ? "chart" : "text"}`).then((r) => ({
            snapInfo: s,
            rows: r.rows,
          }))
        )
      );

      if (isChart) {
        setChartGroups(results);
      } else {
        // Attach device_name from snapInfo so the table and exports can show it
        setLogRows(results.flatMap((r) =>
          r.rows.map((row) => ({ ...row, device_name: r.snapInfo.deviceName || "" }))
        ));
      }
    } catch (e) {
      addToast(`Failed to load content: ${e.message}`);
      setLogModal(false);
    } finally {
      setLogRowsLoading(false);
    }
  };

  const applyFilter = () => {
    setFilterActive(true);
    fetchSnapshots(searchParam, searchValue, isChart);
    const p = new URLSearchParams();
    if (searchParam) p.set("search_param", searchParam);
    if (searchValue)  p.set("search_value", searchValue);
    p.set("log_type", isChart ? "chart" : "text");
    window.history.replaceState(null, "", `?${p.toString()}`);
  };

  const clearFilter = () => {
    setSearchParam(""); setSearchValue(""); setFilterActive(false);
    window.history.replaceState(null, "", window.location.pathname);
    fetchSnapshots("", "", isChart);
  };

  const [downloadFormat, setDownloadFormat] = useState("csv");

  const downloadLogs = () => {
    if (isChart) {
      addToast("Chart export requires backend — use the API endpoint directly.", "info");
      return;
    }
    if (!logRows || logRows.length === 0) {
      addToast("No log rows to export.", "info");
      return;
    }

    let content, mimeType, filename;

    const esc = (s) => String(s || "").replace(/"/g, '""');
    const escHtml = (s) => String(s || "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    if (downloadFormat === "csv") {
      content =
        "Time,Device,Log Name,Content\n" +
        logRows
          .map((r) => `"${esc(r.time)}","${esc(r.device_name)}","${esc(r.log_name)}","${esc(r.content)}"`)
          .join("\n");
      mimeType = "text/csv";
      filename = "logs.csv";
    } else if (downloadFormat === "tsv") {
      content =
        "Time\tDevice\tLog Name\tContent\n" +
        logRows
          .map((r) => `${r.time||""}\t${r.device_name||""}\t${r.log_name||""}\t${(r.content||"").replace(/\t/g," ")}`)
          .join("\n");
      mimeType = "text/tab-separated-values";
      filename = "logs.tsv";
    } else if (downloadFormat === "json") {
      content = JSON.stringify(
        logRows.map((r) => ({ time: r.time, device_name: r.device_name, log_name: r.log_name, content: r.content })),
        null,
        2
      );
      mimeType = "application/json";
      filename = "logs.json";
    } else if (downloadFormat === "txt") {
      content = logRows
        .map((r) => `[${r.time||""}] [${r.device_name||""}] [${r.log_name||""}] ${r.content||""}`)
        .join("\n");
      mimeType = "text/plain";
      filename = "logs.txt";
    } else if (downloadFormat === "html") {
      const rows = logRows.map((r) => {
        const isErr  = (r.content || "").startsWith("ERROR");
        const isWarn = (r.content || "").startsWith("WARN");
        const color  = isErr ? "#ff6666" : isWarn ? "#ffc800" : "#e8eaf0";
        return `    <tr>
      <td style="white-space:nowrap;color:#6b7280">${escHtml(r.time)}</td>
      <td><span style="background:#1a2235;border:1px solid rgba(255,255,255,0.12);border-radius:4px;padding:2px 7px;font-size:11px;color:#e8eaf0">${escHtml(r.device_name)}</span></td>
      <td><span style="background:rgba(0,229,200,0.12);border:1px solid rgba(0,229,200,0.25);border-radius:4px;padding:2px 7px;font-size:11px;color:#00e5c8">${escHtml(r.log_name)}</span></td>
      <td style="color:${color}">${escHtml(r.content)}</td>
    </tr>`;
      }).join("\n");
      content = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>LogOctopus Export</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; background: #080d1c; color: #e8eaf0; font-family: 'JetBrains Mono', 'Fira Code', monospace; font-size: 12px; }
  header { background: #0d1426; border-bottom: 1px solid rgba(255,255,255,0.08); padding: 16px 24px; display: flex; align-items: center; gap: 12px; }
  header h1 { margin: 0; font-size: 18px; font-weight: 800; letter-spacing: -0.02em; }
  header p  { margin: 0; font-size: 11px; color: #6b7280; }
  .meta { padding: 12px 24px; font-size: 11px; color: #6b7280; border-bottom: 1px solid rgba(255,255,255,0.06); }
  table { width: 100%; border-collapse: collapse; }
  th { padding: 8px 16px; text-align: left; color: #6b7280; border-bottom: 1px solid rgba(255,255,255,0.08); font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; position: sticky; top: 0; background: #080d1c; }
  td { padding: 7px 16px; border-bottom: 1px solid rgba(255,255,255,0.04); vertical-align: middle; }
  tr:hover td { background: rgba(255,255,255,0.02); }
</style>
</head>
<body>
<header>
  <div>
    <h1>🐙 LogOctopus</h1>
    <p>Exported ${logRows.length} rows &mdash; ${new Date().toISOString()}</p>
  </div>
</header>
<div class="meta">Generated by LogOctopus &bull; ${logRows.length} entries</div>
<table>
  <thead>
    <tr>
      <th>Timestamp</th><th>Device</th><th>Log Name</th><th>Content</th>
    </tr>
  </thead>
  <tbody>
${rows}
  </tbody>
</table>
</body>
</html>`;
      mimeType = "text/html";
      filename = "logs.html";
    }

    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([content], { type: mimeType }));
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
    addToast(`Downloaded ${filename} (${logRows.length} rows).`, "success");
  };

  // Modal title with chart count info
  const logModalTitle = isChart && chartGroups.length > 0
    ? `Chart Data — ${chartGroups.length} snapshot${chartGroups.length > 1 ? "s" : ""}`
    : "Logs Content";

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
        <header
          style={{
            background: "var(--surface)",
            borderBottom: "1px solid var(--border)",
            padding: "0 32px",
            position: "sticky",
            top: 0,
            zIndex: 100,
            boxShadow: "0 2px 20px rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            height: 64,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <svg width="36" height="36" viewBox="0 0 36 36">
              <circle cx="18" cy="18" r="17" fill="none" stroke="var(--accent)" strokeWidth="1.5" />
              <circle cx="18" cy="18" r="6" fill="var(--accent)" />
              {[0, 45, 90, 135, 180, 225, 270, 315].map((a, i) => {
                const rad = (a * Math.PI) / 180;
                return (
                  <line key={i}
                    x1={18 + 7 * Math.cos(rad)} y1={18 + 7 * Math.sin(rad)}
                    x2={18 + 15 * Math.cos(rad)} y2={18 + 15 * Math.sin(rad)}
                    stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round"
                  />
                );
              })}
            </svg>
            <div>
              <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 20, color: "var(--text)", letterSpacing: "-0.02em", lineHeight: 1 }}>
                LogOctopus
              </div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--muted)", marginTop: 2, letterSpacing: "0.08em" }}>
                Collect & Analyze Logs Efficiently
              </div>
            </div>
          </div>

          <div style={{ flex: 1 }} />

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginRight: 12 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#00e564", boxShadow: "0 0 8px #00e564", animation: "pulse 2s infinite" }} />
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted)" }}>LIVE</span>
            </div>
            {autoSchedule.enabled && autoSchedule.deviceIds.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(0,229,200,0.08)", border: "1px solid rgba(0,229,200,0.2)", borderRadius: 20, padding: "3px 10px" }}>
                <span style={{ fontSize: 11 }}>⏰</span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--accent)" }}>AUTO {autoSchedule.intervalHours}h</span>
              </div>
            )}
            {/* Auth controls */}
            {auth.isAdmin ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    color: "#a89aff",
                    background: "rgba(124,106,255,0.1)",
                    border: "1px solid rgba(124,106,255,0.25)",
                    borderRadius: 20,
                    padding: "3px 10px",
                  }}
                >
                  🔐 Admin
                </span>
                <Btn variant="ghost" size="sm" onClick={auth.logout}>Sign out</Btn>
              </div>
            ) : (
              <Btn variant="admin" size="sm" onClick={() => setLoginModal(true)}>🔐 Admin Login</Btn>
            )}

            <Btn variant="subtle" size="sm" onClick={() => setSettingsModal(true)}>⚙️ Settings</Btn>
            <Btn variant="subtle" onClick={() => setApiModal(true)}>REST API</Btn>
          </div>
        </header>

        <div style={{ maxWidth: 1400, margin: "0 auto", padding: "28px 32px" }}>

          {/* TOASTS */}
          {toasts.map((t) => (
            <Toast key={t.id} message={t.message} type={t.type} onDismiss={() => dismissToast(t.id)} />
          ))}

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
                {devices.map((d) => (
                  <DeviceCard
                    key={d.id}
                    device={d}
                    selected={selectedDevices.includes(d.id)}
                    onSelect={(checked) => toggleDevice(d.id, checked)}
                    onInfo={() => setDeviceModal(d)}
                  />
                ))}
              </div>
            )}
          </section>

          <div style={{ borderTop: "1px solid var(--border)", margin: "0 0 24px" }} />

          {/* SNAPSHOT TOOLBAR */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
            <Btn
              variant="primary"
              onClick={() => openLogContent(snapshots.filter((s) => selectedSnaps.includes(s.id)))}
              disabled={selectedSnaps.length === 0}
            >
              {isChart ? `📈 View ${selectedSnaps.length > 1 ? `${selectedSnaps.length} Charts` : "Chart"}` : "📋 View Selected"}
            </Btn>
            <Toggle checked={isChart} onChange={(v) => { setIsChart(v); setSelectedSnaps([]); }} labelLeft="Text" labelRight="Chart" />
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: 8 }}>
              <select
                value={searchParam}
                onChange={(e) => setSearchParam(e.target.value)}
                style={{ background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 7, color: "var(--text)", fontFamily: "var(--font-mono)", fontSize: 12, padding: "7px 12px" }}
              >
                <option value="">Filter by…</option>
                <option>Device</option><option>Log Name</option><option>Session ID</option><option>Started</option><option>Finished</option>
              </select>
              <span style={{ color: "var(--muted)", fontWeight: 700, fontSize: 16 }}>=</span>
              <input
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                placeholder="Value"
                onKeyDown={(e) => { if (e.key === "Enter") applyFilter(); }}
                style={{ background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 7, color: "var(--text)", fontFamily: "var(--font-mono)", fontSize: 12, padding: "7px 12px", width: 160 }}
              />
              <Btn variant="subtle" size="sm" onClick={applyFilter}>🔍 Filter</Btn>
              {filterActive && <Btn variant="ghost" size="sm" onClick={clearFilter}>✕ Clear</Btn>}
            </div>
            <div style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted)" }}>
              {snapshots.length} snapshot(s)
              {isChart && selectedSnaps.length > 0 && (
                <span style={{ marginLeft: 8, color: "var(--accent)" }}>· {selectedSnaps.length} selected for chart</span>
              )}
            </div>
          </div>

          {/* SNAPSHOTS TABLE */}
          <div style={{ background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
            {snapsLoading ? <Spinner /> : (
              <SnapshotsTable
                snapshots={snapshots}
                selected={selectedSnaps}
                onSelect={toggleSnap}
                onView={openLogContent}
              />
            )}
          </div>
        </div>
      </div>

      {/* COLLECTION STOP LOADING OVERLAY */}
      <CollectionLoadingOverlay open={stoppingCollection} />

      {/* MODALS */}

      {/* Settings modal */}
      <SettingsModal
        open={settingsModal}
        onClose={() => setSettingsModal(false)}
        isAdmin={auth.isAdmin}
        onRequestLogin={() => { setSettingsModal(false); setLoginModal(true); }}
        devices={devices}
        auth={auth}
        addToast={addToast}
        autoSchedule={autoSchedule}
        setAutoSchedule={setAutoSchedule}
      />


      {/* Login modal — higher z-index so it stacks above device details */}
      <LoginModal
        open={loginModal}
        onClose={() => setLoginModal(false)}
        onLogin={(u, p) => {
          const ok = auth.login(u, p);
          if (ok) addToast("Signed in as admin.", "success");
          return ok;
        }}
      />

      <Modal
        open={logModal}
        onClose={() => setLogModal(false)}
        title={logModalTitle}
        size="full"
        footer={
          <>
            {!isChart && <Toggle checked={colorMode} onChange={setColorMode} labelLeft="Raw" labelRight="Color mode" />}
            {!isChart && (
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <select
                  value={downloadFormat}
                  onChange={(e) => setDownloadFormat(e.target.value)}
                  style={{
                    background: "var(--card-bg)",
                    border: "1px solid var(--border)",
                    borderRadius: 7,
                    color: "var(--text)",
                    fontFamily: "var(--font-mono)",
                    fontSize: 12,
                    padding: "6px 10px",
                    cursor: "pointer",
                  }}
                >
                  <option value="csv">CSV</option>
                  <option value="tsv">TSV</option>
                  <option value="json">JSON</option>
                  <option value="txt">Plain text</option>
                  <option value="html">HTML</option>
                </select>
                <Btn variant="subtle" onClick={downloadLogs}>⬇ Download</Btn>
              </div>
            )}
            <Btn variant="ghost" onClick={() => setLogModal(false)}>Close</Btn>
          </>
        }
      >
        {logRowsLoading ? (
          <Spinner />
        ) : (
          <LogContentView
            rows={logRows}
            isChart={isChart}
            colorMode={colorMode}
            chartGroups={chartGroups}
          />
        )}
      </Modal>

      <Modal
        open={!!deviceModal}
        onClose={() => setDeviceModal(null)}
        title="Device Details"
        size="xl"
        footer={<Btn variant="ghost" onClick={() => setDeviceModal(null)}>Close</Btn>}
      >
        {deviceModal && (
          <DeviceDetails
            device={deviceModal}
            isAdmin={auth.isAdmin}
            onRequestLogin={() => setLoginModal(true)}
          />
        )}
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
