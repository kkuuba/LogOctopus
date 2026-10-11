import { useEffect, useState } from "react";
import { subscribe } from "../mock/events.js";
import { SAMPLE_LINKS } from "../mock/fixtures.js";

const mono = "var(--font-mono, 'JetBrains Mono', ui-monospace, monospace)";
const COLLAPSE_KEY = "lo_demo_tour_collapsed";

const here = () => window.location.pathname;
const link = (ids, type) => `${here()}?open_snaps=${ids.join(",")}&log_type=${type}`;

// Steps complete automatically when the mock API sees the matching request.
// (Collecting and browsing work as a guest — only config editing needs admin.)
const STEPS = [
  { id: "startCollection", title: "Start a collection", hint: "Tick Router-Beta and IoT-Gateway, press Start Collection and name the scenario." },
  { id: "stopCollection", title: "Stop it and open the session", hint: "Press Stop Collection, watch the snapshots get saved, then follow the session link." },
  { id: "openCapture", title: "Explore a network capture", hint: "Opens a packet capture. Try the Visualize button for 3D flow and topology views.", action: () => ({ label: "Open sample capture", href: link([SAMPLE_LINKS.captureId], "text") }) },
  { id: "inspectPacket", title: "Inspect a packet", hint: "Click the 🔎 icon in the gutter next to a packet line, or click a point in the 3D view." },
  { id: "openCharts", title: "Chart some metrics", hint: "Plots temperature, humidity and Wi-Fi signal from one sensor session.", action: () => ({ label: "Open sample charts", href: link(SAMPLE_LINKS.chartIds, "chart") }) },
  { id: "buildConfig", title: "Build a device config", hint: "Needs admin (Sign In, top right: admin / admin). Then Add Device → build a config: test the connection, run a command, mark a log line to auto-generate the regex." },
];

export default function TourPanel() {
  const [done, setDone] = useState(new Set());
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const saved = sessionStorage.getItem(COLLAPSE_KEY);
      return saved === null ? window.innerWidth < 760 : saved === "1";
    } catch { return false; }
  });

  useEffect(() => subscribe((s) => setDone(new Set(s))), []);

  const toggle = (next) => {
    setCollapsed(next);
    try { sessionStorage.setItem(COLLAPSE_KEY, next ? "1" : "0"); } catch { /* ignore */ }
  };

  const completed = STEPS.filter((s) => done.has(s.id)).length;
  const next = STEPS.find((s) => !done.has(s.id));
  const pct = Math.round((completed / STEPS.length) * 100);

  const shell = {
    position: "fixed", right: 16, bottom: 16, zIndex: 900, fontFamily: mono,
    color: "var(--text, #e4e4f0)", background: "var(--modal-bg, #0f0f1c)",
    border: "1px solid rgba(129,140,248,0.35)", borderRadius: 12,
    boxShadow: "0 12px 40px rgba(0,0,0,0.55)",
  };

  if (collapsed) {
    return (
      <button type="button" onClick={() => toggle(false)} aria-label="Open guided tour"
        style={{ ...shell, padding: "9px 14px", fontSize: 12, cursor: "pointer", display: "inline-flex", gap: 8, alignItems: "center" }}>
        <span style={{ color: "var(--accent, #818cf8)" }}>◆</span> Guided tour · {completed}/{STEPS.length}
      </button>
    );
  }

  return (
    <aside style={{ ...shell, width: 320, maxWidth: "calc(100vw - 32px)", maxHeight: "calc(100vh - 32px)", overflowY: "auto" }} aria-label="Guided tour">
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px 8px" }}>
        <strong style={{ fontSize: 13, letterSpacing: "0.04em" }}>Guided tour</strong>
        <span style={{ fontSize: 11, color: "var(--muted, #64648a)" }}>{completed}/{STEPS.length}</span>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={() => toggle(true)} aria-label="Minimise tour" style={{ background: "none", border: "none", color: "var(--muted, #64648a)", cursor: "pointer", fontSize: 16 }}>–</button>
      </div>
      <div style={{ height: 3, margin: "0 14px 6px", background: "rgba(255,255,255,0.07)", borderRadius: 2 }}>
        <div style={{ width: `${pct}%`, height: "100%", background: "var(--accent, #818cf8)", borderRadius: 2, transition: "width .3s" }} />
      </div>
      <ol style={{ listStyle: "none", margin: 0, padding: "4px 8px 12px" }}>
        {STEPS.map((s, i) => {
          const isDone = done.has(s.id);
          const isNext = next && next.id === s.id;
          const action = s.action?.();
          return (
            <li key={s.id} style={{ display: "flex", gap: 10, padding: "7px 6px", borderRadius: 8, background: isNext ? "rgba(129,140,248,0.10)" : "transparent" }}>
              <span aria-hidden style={{
                flex: "0 0 18px", height: 18, marginTop: 1, borderRadius: "50%", fontSize: 10, display: "grid", placeItems: "center",
                background: isDone ? "#4ade80" : "transparent", color: isDone ? "#052e16" : "var(--muted, #64648a)",
                border: isDone ? "none" : "1px solid rgba(255,255,255,0.18)", fontWeight: 700,
              }}>{isDone ? "✓" : i + 1}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: isDone ? "var(--muted, #64648a)" : "var(--text, #e4e4f0)", textDecoration: isDone ? "line-through" : "none" }}>{s.title}</div>
                {!isDone && <div style={{ fontSize: 11, lineHeight: 1.5, color: "var(--muted, #64648a)", marginTop: 2 }}>{s.hint}</div>}
                {!isDone && action && (
                  <a href={action.href} style={{ display: "inline-block", marginTop: 6, fontSize: 11, padding: "3px 10px", borderRadius: 6, color: "var(--accent, #818cf8)", border: "1px solid rgba(129,140,248,0.4)", textDecoration: "none" }}>{action.label} →</a>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {completed === STEPS.length && (
        <div style={{ padding: "0 14px 14px", fontSize: 11, color: "#86efac" }}>
          You've seen the main features. The real thing connects to your devices over SSH — see the GitHub link above.
        </div>
      )}
    </aside>
  );
}
