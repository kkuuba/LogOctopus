import { useState } from "react";
import { getMockApi } from "../mock/mockApi.js";
import { resetProgress } from "../mock/events.js";

const REPO_URL = "https://github.com/kkuuba/LogOctopus";
const DISMISS_KEY = "lo_demo_banner_dismissed";

const mono = "var(--font-mono, 'JetBrains Mono', ui-monospace, monospace)";

const chip = {
  fontFamily: mono, fontSize: 11, padding: "2px 8px", borderRadius: 6,
  background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.08)", color: "#e4e4f0",
};
const ghostBtn = {
  fontFamily: mono, fontSize: 11, padding: "4px 10px", borderRadius: 6, cursor: "pointer",
  background: "transparent", color: "#c7c9f5", border: "1px solid rgba(129,140,248,0.35)",
};

/**
 * Slim info bar above the app. It lives in normal document flow on purpose: the
 * app's own header is `position: sticky; top: 0`, so a fixed banner would sit on
 * top of it while scrolling. Scrolling the banner away is the right behaviour.
 */
export default function DemoBanner() {
  const [hidden, setHidden] = useState(() => {
    try { return sessionStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; }
  });
  const [copied, setCopied] = useState(false);

  if (hidden) return null;

  const copyPassword = async () => {
    try { await navigator.clipboard.writeText("admin"); setCopied(true); setTimeout(() => setCopied(false), 1400); } catch { /* clipboard blocked */ }
  };

  const reset = () => {
    getMockApi()?.reset();
    resetProgress();
    try { ["lo_role", "lo_token", "lo_collapsed_groups", "lo_tour_seen", "lo_builder_tour_seen", DISMISS_KEY].forEach((k) => { sessionStorage.removeItem(k); localStorage.removeItem(k); }); } catch { /* ignore */ }
    window.location.assign(window.location.pathname);
  };

  const dismiss = () => {
    try { sessionStorage.setItem(DISMISS_KEY, "1"); } catch { /* ignore */ }
    setHidden(true);
  };

  return (
    <div
      role="region"
      aria-label="Demo information"
      style={{
        display: "flex", alignItems: "center", flexWrap: "wrap", gap: "8px 14px",
        padding: "8px 20px", fontFamily: mono, fontSize: 12, color: "#c7c9f5",
        background: "linear-gradient(90deg, rgba(129,140,248,0.18), rgba(167,139,250,0.07))",
        borderBottom: "1px solid rgba(129,140,248,0.28)",
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontWeight: 700, letterSpacing: "0.08em", color: "#fff" }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#4ade80", boxShadow: "0 0 8px #4ade80" }} />
        LIVE DEMO
      </span>
      <span style={{ opacity: 0.85, flex: "1 1 280px" }}>
        Simulated devices and logs, running entirely in your browser — no backend, nothing leaves this page.
      </span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        Admin login <code style={chip}>admin</code> / <code style={chip}>admin</code>
        <button type="button" onClick={copyPassword} style={ghostBtn} aria-label="Copy password">{copied ? "Copied ✓" : "Copy"}</button>
      </span>
      <button type="button" onClick={reset} style={ghostBtn} title="Restore the original demo data and show the Help hints again">Reset demo</button>
      <a href={REPO_URL} target="_blank" rel="noreferrer" style={{ ...ghostBtn, textDecoration: "none" }}>GitHub ↗</a>
      <button type="button" onClick={dismiss} aria-label="Dismiss banner" style={{ ...ghostBtn, border: "none", fontSize: 16, lineHeight: 1, padding: "2px 6px" }}>×</button>
    </div>
  );
}
