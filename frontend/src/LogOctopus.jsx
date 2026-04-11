import { useState, useEffect, useCallback, useRef } from "react";

// ── CONFIG ────────────────────────────────────────────────────────────────────
const API_BASE = (import.meta.env.VITE_API_BASE) || "http://localhost:8050"
;

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
        '<p style="color:#f87171;font-family:monospace;font-size:12px;padding:16px">Plotly not loaded — add the CDN script to index.html</p>';
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
    const palette = ["#818cf8", "#a78bfa", "#f472b6", "#fb923c", "#34d399", "#60a5fa"];
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
      plot_bgcolor: "rgba(9,9,15,0.6)",
      font: { color: "#6b7280", family: "JetBrains Mono, monospace", size: 11 },
      xaxis: {
        gridcolor: "rgba(255,255,255,0.06)",
        zerolinecolor: "rgba(255,255,255,0.08)",
        tickfont: { color: "#6b7280", size: 10 },
        showspikes: true,
        spikecolor: "rgba(129,140,248,0.4)",
        spikethickness: 1,
        spikedash: "dot",
      },
      yaxis: {
        gridcolor: "rgba(255,255,255,0.06)",
        zerolinecolor: "rgba(255,255,255,0.08)",
        tickfont: { color: "#6b7280", size: 10 },
        showspikes: true,
        spikecolor: "rgba(129,140,248,0.4)",
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

// ── MONACO LOADER HOOK ────────────────────────────────────────────────────────
// Lazily injects the Monaco AMD bundle from jsDelivr the first time it is
// needed, then resolves the global `monaco` object.  Subsequent calls return
// immediately from the module-level promise cache.
let _monacoPromise = null;
function loadMonaco() {
  if (_monacoPromise) return _monacoPromise;
  _monacoPromise = new Promise((resolve, reject) => {
    if (window.monaco) { resolve(window.monaco); return; }

    // Loader script
    const loaderScript = document.createElement("script");
    loaderScript.src = "https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs/loader.js";
    loaderScript.onload = () => {
      window.require.config({
        paths: { vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs" },
      });
      window.require(["vs/editor/editor.main"], () => {
        // ── Register LogOctopus language ───────────────────────────────────
        const LANG = "logoctopus";
        if (!window.monaco.languages.getLanguages().some((l) => l.id === LANG)) {
          window.monaco.languages.register({ id: LANG });

          window.monaco.languages.setMonarchTokensProvider(LANG, {
            tokenizer: {
              root: [
                // Timestamp  [2024-01-01 12:00:00]
                [/\[\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[^\]]*\]/, "log.timestamp"],
                // Device column  [device_name]
                [/\[[^\]]+\](?=\s*\[)/, "log.device"],
                // Log-name column  [log_name]
                [/\[[^\]]+\](?!\s*\[)/, "log.logname"],
                // Severity keywords
                [/\bERROR\b/, "log.error"],
                [/\bWARN(?:ING)?\b/, "log.warn"],
                [/\bINFO\b/, "log.info"],
                [/\bDEBUG\b/, "log.debug"],
                [/\bCRITICAL\b|\bFATAL\b/, "log.critical"],
                // IP addresses
                [/\b\d{1,3}(?:\.\d{1,3}){3}\b/, "log.ip"],
                // Hex / numbers
                [/\b0x[0-9a-fA-F]+\b/, "log.hex"],
                [/\b\d+\b/, "log.number"],
                // Quoted strings
                [/"[^"]*"/, "log.string"],
                [/'[^']*'/, "log.string"],
              ],
            },
          });

          // ── Dark theme ─────────────────────────────────────────────────
          window.monaco.editor.defineTheme("logoctopus-dark", {
            base: "vs-dark",
            inherit: true,
            rules: [
              { token: "log.timestamp", foreground: "6b7280" },
              { token: "log.device",    foreground: "818cf8", fontStyle: "bold" },
              { token: "log.logname",   foreground: "22d3ee" },
              { token: "log.error",     foreground: "f87171", fontStyle: "bold" },
              { token: "log.critical",  foreground: "ff4444", fontStyle: "bold" },
              { token: "log.warn",      foreground: "fbbf24", fontStyle: "bold" },
              { token: "log.info",      foreground: "4ade80" },
              { token: "log.debug",     foreground: "94a3b8" },
              { token: "log.ip",        foreground: "fb923c" },
              { token: "log.hex",       foreground: "a78bfa" },
              { token: "log.number",    foreground: "f472b6" },
              { token: "log.string",    foreground: "34d399" },
            ],
            colors: {
              "editor.background":           "#09090f",
              "editor.foreground":           "#e4e4f0",
              "editorLineNumber.foreground": "#3f3f5a",
              "editorLineNumber.activeForeground": "#818cf8",
              "editor.lineHighlightBackground": "#ffffff0a",
              "editorCursor.foreground":     "#818cf8",
              "editor.selectionBackground":  "#818cf820",
              "editorBracketMatch.background": "#818cf830",
              "scrollbar.shadow":            "#00000000",
              "scrollbarSlider.background":  "#ffffff14",
              "scrollbarSlider.hoverBackground": "#ffffff22",
            },
          });

          // ── Color-mode theme (per-logname background stripes) ──────────
          window.monaco.editor.defineTheme("logoctopus-color", {
            base: "vs-dark",
            inherit: true,
            rules: [
              { token: "log.timestamp", foreground: "6b7280" },
              { token: "log.device",    foreground: "c084fc", fontStyle: "bold" },
              { token: "log.logname",   foreground: "67e8f9" },
              { token: "log.error",     foreground: "fca5a5", fontStyle: "bold" },
              { token: "log.critical",  foreground: "ff6666", fontStyle: "bold" },
              { token: "log.warn",      foreground: "fde68a", fontStyle: "bold" },
              { token: "log.info",      foreground: "86efac" },
              { token: "log.debug",     foreground: "cbd5e1" },
              { token: "log.ip",        foreground: "fdba74" },
              { token: "log.hex",       foreground: "c4b5fd" },
              { token: "log.number",    foreground: "f9a8d4" },
              { token: "log.string",    foreground: "6ee7b7" },
            ],
            colors: {
              "editor.background":           "#0d0d1a",
              "editor.foreground":           "#f0f0ff",
              "editorLineNumber.foreground": "#4040608",
              "editorLineNumber.activeForeground": "#a78bfa",
              "editor.lineHighlightBackground": "#ffffff0d",
              "editorCursor.foreground":     "#a78bfa",
              "editor.selectionBackground":  "#a78bfa25",
              "scrollbarSlider.background":  "#ffffff18",
              "scrollbarSlider.hoverBackground": "#ffffff28",
            },
          });
        }
        resolve(window.monaco);
      });
    };
    loaderScript.onerror = reject;
    document.head.appendChild(loaderScript);
  });
  return _monacoPromise;
}

// ── LINE-NUMBER COLOR PALETTE ─────────────────────────────────────────────────
// Each unique (device_name, log_name) pair gets a stable color from this list.
const LN_COLOR_PALETTE = [
  "#818cf8", // indigo
  "#34d399", // emerald
  "#fb923c", // orange
  "#f472b6", // pink
  "#60a5fa", // blue
  "#a78bfa", // violet
  "#facc15", // yellow
  "#2dd4bf", // teal
  "#f87171", // red
  "#c084fc", // purple
];

// Singleton <style> element that holds .lo-ln-N rules injected once.
let _lnStyleEl = null;
function ensureLnStyleEl() {
  if (_lnStyleEl) return _lnStyleEl;
  _lnStyleEl = document.createElement("style");
  _lnStyleEl.id = "lo-ln-colors";
  document.head.appendChild(_lnStyleEl);
  // Generate one CSS rule per palette slot up front.
  // .lo-ln-N targets the full line content area (via Monaco's className option).
  // The left-border acts as a color indicator; background tints the whole line.
  _lnStyleEl.textContent = LN_COLOR_PALETTE.map(
    (color, i) => [
      // isWholeLine:true makes Monaco render a single <div> spanning the full
      // editor width — setting background on it gives the full-line tint.
      `.lo-ln-${i} { background: ${color}22 !important; }`,
      // Line number colored to match the line's accent color
      `.lo-ln-num-${i} { color: ${color} !important; }`,
      // Gutter strip — thin colored bar left of the line number
      `.lo-ln-gutter-${i} { background: ${color} !important; width: 3px !important; margin-left: 2px; }`,
    ].join("\n")
  ).join("\n");
  return _lnStyleEl;
}

// Build a key→colorIndex map from the current rows, preserving insertion order.
function buildPairColorMap(rows) {
  const map = new Map(); // key → index
  if (!rows) return map;
  for (const r of rows) {
    const key = `${r.device_name ?? ""}|${r.log_name ?? ""}`;
    if (!map.has(key)) map.set(key, map.size % LN_COLOR_PALETTE.length);
  }
  return map;
}

// ── MONACO LOG VIEWER ─────────────────────────────────────────────────────────
/**
 * Renders log rows inside a Monaco Editor instance (read-only).
 * Each row is formatted as:  [timestamp] [device] [log_name]  content
 * Monaco tokenises the text with the logoctopus language for rich colouring.
 *
 * When colorMode is on, each unique (device_name, log_name) pair gets its own
 * full-line background tint + gutter color strip applied via Monaco decorations
 * (isWholeLine:true + className) and injected CSS classes.
 *
 * Props:
 *   rows      – array of { time, device_name, log_name, content }
 *   colorMode – bool; switches between logoctopus-dark and logoctopus-color themes
 */
function MonacoLogViewer({ rows, colorMode }) {
  const containerRef      = useRef(null);
  const editorRef         = useRef(null);
  const modelRef          = useRef(null);
  const decorationsRef    = useRef([]); // current decoration IDs
  const [ready, setReady] = useState(false);
  const [loadErr, setLoadErr] = useState(null);

  // Build flat log text from rows
  const logText = useRef("");
  logText.current = rows && rows.length > 0
    ? rows.map((r) =>
        `[${r.time ?? ""}] [${r.device_name ?? ""}] [${r.log_name ?? ""}]  ${r.content ?? ""}`
      ).join("\n")
    : "";

  // ── Apply / clear line-number decorations ────────────────────────────────
  const applyLineNumberDecorations = useCallback((rowsData, isColor) => {
    const editor = editorRef.current;
    if (!editor) return;

    if (!isColor) {
      // Clear all decorations in raw mode
      decorationsRef.current = editor.deltaDecorations(decorationsRef.current, []);
      return;
    }

    ensureLnStyleEl();
    const pairColorMap = buildPairColorMap(rowsData);

    const newDecorations = (rowsData ?? []).map((r, lineIndex) => {
      const key = `${r.device_name ?? ""}|${r.log_name ?? ""}`;
      const colorIndex = pairColorMap.get(key) ?? 0;
      return {
        range: {
          startLineNumber: lineIndex + 1,
          startColumn: 1,
          endLineNumber: lineIndex + 1,
          endColumn: 1,
        },
        options: {
          // isWholeLine stretches the decoration div across the full editor
          // width so the background tint covers the entire line, not just tokens.
          isWholeLine:               true,
          className:                `lo-ln-${colorIndex}`,
          // Color the line number to match the line's accent color
          lineNumberClassName:      `lo-ln-num-${colorIndex}`,
          // Separate class for the gutter strip (left of line numbers)
          linesDecorationsClassName: `lo-ln-gutter-${colorIndex}`,
        },
      };
    });

    decorationsRef.current = editor.deltaDecorations(
      decorationsRef.current,
      newDecorations
    );
  }, []);

  // Load Monaco once, then create the editor
  useEffect(() => {
    let cancelled = false;
    loadMonaco()
      .then((monaco) => {
        if (cancelled || !containerRef.current) return;

        const model = monaco.editor.createModel(logText.current, "logoctopus");
        modelRef.current = model;

        const editor = monaco.editor.create(containerRef.current, {
          model,
          theme:             colorMode ? "logoctopus-color" : "logoctopus-dark",
          readOnly:          true,
          minimap:           { enabled: true, renderCharacters: false },
          scrollBeyondLastLine: false,
          wordWrap:          "off",
          lineNumbers:       "on",
          renderLineHighlight: "line",
          fontFamily:        "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
          fontSize:          12,
          lineHeight:        20,
          padding:           { top: 12, bottom: 12 },
          smoothScrolling:   true,
          cursorBlinking:    "smooth",
          scrollbar: {
            verticalScrollbarSize:   10,
            horizontalScrollbarSize: 10,
            useShadows:              false,
          },
          overviewRulerLanes: 3,
          folding:           false,
          contextmenu:       true,
          quickSuggestions:  false,
          links:             false,
          // Highlight find matches without the widget stealing focus
          find: {
            addExtraSpaceOnTop:       false,
            autoFindInSelection:      "never",
            seedSearchStringFromSelection: "never",
          },
        });
        editorRef.current = editor;
        setReady(true);
      })
      .catch((e) => {
        if (!cancelled) setLoadErr(e?.message || "Monaco failed to load");
      });

    return () => {
      cancelled = true;
      editorRef.current?.dispose();
      modelRef.current?.dispose();
      editorRef.current = null;
      modelRef.current  = null;
      decorationsRef.current = [];
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync model content when rows change (after initial mount)
  useEffect(() => {
    if (!modelRef.current) return;
    const model = modelRef.current;
    const newText = logText.current;
    if (model.getValue() !== newText) {
      model.setValue(newText);
      // Jump to last line for live-appended logs
      editorRef.current?.revealLine(model.getLineCount());
    }
  }, [rows]);

  // Apply decorations whenever rows or colorMode change (and editor is ready)
  useEffect(() => {
    if (!ready) return;
    applyLineNumberDecorations(rows, colorMode);
  }, [rows, colorMode, ready, applyLineNumberDecorations]);

  // Swap theme when colorMode toggles
  useEffect(() => {
    if (!ready || !window.monaco) return;
    window.monaco.editor.setTheme(colorMode ? "logoctopus-color" : "logoctopus-dark");
  }, [colorMode, ready]);

  // Resize editor when the container resizes (e.g. modal expand)
  useEffect(() => {
    if (!ready || !editorRef.current || !containerRef.current) return;
    const ro = new ResizeObserver(() => editorRef.current?.layout());
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [ready]);

  if (loadErr) {
    return (
      <div style={{
        padding: 24, fontFamily: "var(--font-mono)", fontSize: 12,
        color: "#f87171", background: "rgba(248,113,113,0.06)",
        border: "1px solid rgba(248,113,113,0.2)", borderRadius: 8,
      }}>
        ⚠ Monaco failed to load: {loadErr}
      </div>
    );
  }

  return (
    <div style={{ position: "relative", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {!ready && (
        <div style={{
          position: "absolute", inset: 0, display: "flex",
          alignItems: "center", justifyContent: "center",
          background: "#09090f", borderRadius: 8, zIndex: 1,
        }}>
          <Spinner />
        </div>
      )}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          minHeight: 0,
          borderRadius: 8,
          overflow: "hidden",
          opacity: ready ? 1 : 0,
          transition: "opacity 0.2s",
        }}
      />
    </div>
  );
}

// ── LOG CONTENT VIEW ──────────────────────────────────────────────────────────
function LogContentView({ rows, isChart, colorMode, chartGroups }) {
  if (isChart) return <ChartContentView chartGroups={chartGroups} />;

  if (!rows || rows.length === 0)
    return <p style={{ color: "var(--muted)" }}>No data.</p>;

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <MonacoLogViewer rows={rows} colorMode={colorMode} />
    </div>
  );
}

// ── DOWNLOAD MENU ─────────────────────────────────────────────────────────────
function DownloadMenu({ onDownload }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const formats = [
    { id: "csv",  label: "CSV",  icon: "📊", desc: "Spreadsheet-compatible" },
    { id: "txt",  label: "TXT",  icon: "📄", desc: "Plain text, one line per row" },
    { id: "json", label: "JSON", icon: "🗂", desc: "Structured JSON array" },
    { id: "html", label: "HTML", icon: "🌐", desc: "Styled HTML table" },
  ];

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          background: open ? "rgba(129,140,248,0.12)" : "rgba(255,255,255,0.06)",
          border: `1px solid ${open ? "rgba(129,140,248,0.35)" : "var(--border)"}`,
          borderRadius: 8, color: open ? "var(--accent)" : "var(--text)",
          fontFamily: "var(--font-mono)", fontSize: 12, padding: "7px 14px",
          cursor: "pointer", transition: "all 0.15s",
        }}
      >
        ⬇ Download
        <span style={{ fontSize: 9, marginLeft: 2, opacity: 0.7 }}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div
          style={{
            position: "absolute", bottom: "calc(100% + 6px)", right: 0,
            background: "var(--card-bg)", border: "1px solid var(--border)",
            borderRadius: 10, overflow: "hidden", minWidth: 200,
            boxShadow: "0 8px 32px rgba(0,0,0,0.5)", zIndex: 200,
          }}
        >
          {formats.map((f) => (
            <button
              key={f.id}
              onClick={() => { onDownload(f.id); setOpen(false); }}
              style={{
                display: "flex", alignItems: "center", gap: 10, width: "100%",
                background: "transparent", border: "none", borderBottom: "1px solid var(--border)",
                padding: "10px 14px", cursor: "pointer", textAlign: "left",
                transition: "background 0.1s",
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = "rgba(129,140,248,0.08)"}
              onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
            >
              <span style={{ fontSize: 16 }}>{f.icon}</span>
              <div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{f.label}</div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--muted)" }}>{f.desc}</div>
              </div>
            </button>
          ))}
        </div>
      )}
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
function SettingsModal({ open, onClose, isAdmin, onRequestLogin, auth, addToast }) {
  const [tab, setTab] = useState("security");

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

  if (!open) return null;

  const tabStyle = (active) => ({
    padding: "8px 18px",
    borderRadius: 7,
    fontFamily: "var(--font-display)",
    fontWeight: 700,
    fontSize: 12,
    cursor: "pointer",
    border: "none",
    background: active ? "rgba(129,140,248,0.15)" : "transparent",
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
          <button style={tabStyle(tab === "security")} onClick={() => setTab("security")}>🔐 Security</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>

          {/* ── SECURITY TAB ── */}
          {tab === "security" && (
            <div>
              {!isAdmin ? (
                <div style={{
                  background: "rgba(129,140,248,0.07)", border: "1px solid rgba(129,140,248,0.2)",
                  borderRadius: 8, padding: "24px 20px", textAlign: "center",
                  fontFamily: "var(--font-mono)", fontSize: 12, color: "#a78bfa",
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
                        <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#f87171", background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 6, padding: "7px 12px" }}>
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
                      Currently signed in as <span style={{ color: "#a78bfa" }}>admin</span>. Session persists until you sign out or close the browser.
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
          boxShadow: "0 24px 80px rgba(129,140,248,0.08), 0 0 0 1px rgba(129,140,248,0.08)",
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
              background: "rgba(129,140,248,0.12)",
              border: "1px solid rgba(129,140,248,0.3)",
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
                color: "#f87171",
                background: "rgba(248,113,113,0.08)",
                border: "1px solid rgba(248,113,113,0.2)",
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
          height:    size === "full" ? "calc(100vh - 40px)" : undefined,
          maxHeight: size === "full" ? "calc(100vh - 40px)" : "calc(100vh - 40px)",
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
        <div
          data-log-scroll
          style={{
            flex: 1,
            overflowY: "auto",
            padding: size === "full" ? "12px 16px" : "20px 24px",
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
          }}
        >
          {children}
        </div>
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
    green:   { bg: "rgba(74,222,128,0.13)",   text: "#4ade80",  border: "rgba(74,222,128,0.28)" },
    red:     { bg: "rgba(248,113,113,0.13)",  text: "#f87171",  border: "rgba(248,113,113,0.28)" },
    yellow:  { bg: "rgba(251,191,36,0.13)",   text: "#fbbf24",  border: "rgba(251,191,36,0.28)" },
    cyan:    { bg: "rgba(129,140,248,0.14)",  text: "#818cf8",  border: "rgba(129,140,248,0.3)" },
    violet:  { bg: "rgba(167,139,250,0.14)",  text: "#a78bfa",  border: "rgba(167,139,250,0.3)" },
    default: { bg: "rgba(255,255,255,0.06)", text: "var(--muted)", border: "var(--border)" },
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
    primary: { background: "var(--accent)", color: "#06061a" },
    success: { background: "#4ade80", color: "#06061a" },
    danger:  { background: "#f87171", color: "#06061a" },
    ghost:   { background: "transparent", color: "var(--muted)", border: "1px solid var(--border)" },
    subtle:  { background: "rgba(255,255,255,0.05)", color: "var(--text)", border: "1px solid var(--border)" },
    admin:   { background: "rgba(167,139,250,0.13)", color: "#a78bfa", border: "1px solid rgba(167,139,250,0.3)" },
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
    error:   { bg: "rgba(248,113,113,0.12)",  border: "rgba(248,113,113,0.3)",  text: "#f87171" },
    success: { bg: "rgba(74,222,128,0.12)",  border: "rgba(74,222,128,0.3)",  text: "#4ade80" },
    info:    { bg: "rgba(129,140,248,0.12)",  border: "rgba(129,140,248,0.3)",  text: "#818cf8" },
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
function DeviceCard({ device, selected, onSelect, onInfo, onAutoCollectionSave, addToast }) {
  const [hovered,       setHovered]       = useState(false);
  const [settingsOpen,  setSettingsOpen]  = useState(false);
  const [autoEnabled,   setAutoEnabled]   = useState(device.autoCollectionEnabled ?? false);
  const [intervalHours, setIntervalHours] = useState(device.autoCollectionInterval ?? 1);
  const [saving,        setSaving]        = useState(false);

  // Sync if device prop changes (e.g. after a poll refresh)
  useEffect(() => {
    setAutoEnabled(device.autoCollectionEnabled ?? false);
    setIntervalHours(device.autoCollectionInterval ?? 1);
  }, [device.autoCollectionEnabled, device.autoCollectionInterval]);

  const saveAutoCollection = async () => {
    setSaving(true);
    try {
      await apiFetch("/api/settings/auto-collection", {
        method: "POST",
        body: JSON.stringify({ enabled: autoEnabled, interval_hours: intervalHours, device_ids: [device.id] }),
      });
      onAutoCollectionSave?.(device.id, autoEnabled, intervalHours);
      addToast?.(
        autoEnabled
          ? `Auto-collection on "${device.name}" — every ${intervalHours}h.`
          : `Auto-collection disabled for "${device.name}".`,
        "success"
      );
    } catch (e) {
      addToast?.(`Failed to save: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const INTERVALS = [1, 2, 4, 6, 12, 24];

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "relative",
        width: 220,
        borderRadius: 12,
        background: selected ? "var(--accent-dim)" : "var(--card-bg)",
        border: `1px solid ${selected ? "var(--accent)" : hovered ? "var(--accent-border)" : "var(--border)"}`,
        transition: "all 0.2s",
        cursor: "default",
        boxShadow: selected ? "0 0 20px rgba(129,140,248,0.1)" : "none",
        overflow: "hidden",
      }}
    >
      {/* ── Card header ── */}
      <div style={{ padding: "16px 14px" }}>
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onSelect(e.target.checked)}
          style={{ position: "absolute", top: 12, left: 12, width: 16, height: 16, accentColor: "var(--accent)", cursor: "pointer" }}
        />

        {/* Info + Settings toggle buttons */}
        <div style={{ position: "absolute", top: 10, right: 10, display: "flex", gap: 4 }}>
          <button
            onClick={onInfo}
            title="Device details"
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--muted)", cursor: "pointer", fontSize: 13, padding: "2px 7px" }}
          >
            ℹ
          </button>
          <button
            onClick={() => setSettingsOpen(v => !v)}
            title="Auto-collection settings"
            style={{
              background: settingsOpen ? "rgba(129,140,248,0.15)" : "rgba(255,255,255,0.05)",
              border: `1px solid ${settingsOpen ? "rgba(129,140,248,0.4)" : "var(--border)"}`,
              borderRadius: 6, color: settingsOpen ? "var(--accent)" : "var(--muted)",
              cursor: "pointer", fontSize: 13, padding: "2px 7px",
              transition: "all 0.15s",
            }}
          >
            ⚙
          </button>
        </div>

        <div style={{ marginTop: 20, marginBottom: 10, fontFamily: "var(--font-display)", fontSize: 15, fontWeight: 700, color: "var(--text)", letterSpacing: "0.03em" }}>
          {device.name}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <StatusRow label="Connection" ok={device.connection} />
          <StatusRow label="Log Access" ok={device.logAccess} />
          <StatusRow label="Collecting"  ok={device.collecting} pulseWhenTrue />
        </div>

        {/* Auto-collection active badge */}
        {autoEnabled && (
          <div style={{ marginTop: 10 }}>
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              background: "rgba(129,140,248,0.13)", border: "1px solid rgba(129,140,248,0.35)",
              borderRadius: 20, padding: "3px 9px",
              fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, color: "var(--accent)",
            }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)", boxShadow: "0 0 5px var(--accent)", display: "inline-block" }} />
              ⏰ Auto · {intervalHours}h
            </span>
          </div>
        )}
      </div>

      {/* ── Auto-collection settings panel ── */}
      {settingsOpen && (
        <div style={{
          borderTop: "1px solid var(--border)",
          padding: "14px 14px 12px",
          background: "rgba(0,0,0,0.18)",
        }}>
          {/* Enable toggle */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted)" }}>Auto-collection</span>
            <Toggle checked={autoEnabled} onChange={setAutoEnabled} />
          </div>

          {/* Interval grid */}
          <div style={{ opacity: autoEnabled ? 1 : 0.4, pointerEvents: autoEnabled ? "auto" : "none", transition: "opacity 0.15s" }}>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 7 }}>
              Interval
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 5 }}>
              {INTERVALS.map(h => {
                const active = intervalHours === h;
                return (
                  <button key={h} onClick={() => setIntervalHours(h)}
                    style={{
                      padding: "6px 0", borderRadius: 6, border: "1px solid",
                      fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600,
                      cursor: "pointer", textAlign: "center",
                      background: active ? "rgba(129,140,248,0.16)" : "rgba(255,255,255,0.03)",
                      color: active ? "var(--accent)" : "var(--muted)",
                      borderColor: active ? "rgba(129,140,248,0.45)" : "var(--border)",
                      transition: "all 0.12s",
                    }}>
                    {h}h
                  </button>
                );
              })}
            </div>
          </div>

          {/* Save button */}
          <button
            onClick={saveAutoCollection}
            disabled={saving}
            style={{
              marginTop: 11, width: "100%", padding: "7px 0",
              borderRadius: 7, border: "1px solid rgba(129,140,248,0.35)",
              background: "rgba(129,140,248,0.12)", color: "var(--accent)",
              fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600,
              cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.6 : 1,
              transition: "all 0.15s",
            }}
          >
            {saving ? "Saving…" : "💾 Save"}
          </button>
        </div>
      )}
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
          background: ok ? "#4ade80" : "#cb0f0f",
          boxShadow: ok && pulseWhenTrue ? "0 0 6px #4ade80" : "none",
        }}
      />
      <span style={{ color: "var(--muted)" }}>{label}</span>
      <span style={{ marginLeft: "auto", color: ok ? "#4ade80" : "#cb0f0f" }}>{ok ? "OK" : "❌"}</span>
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
  const cols = ["", "Device", "Log Name", "Started", "Finished", "Duration", "Size", "Session ID", "Scenario", ""];
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
                {s.sessionScenario ? (
                  <Badge color="violet">{s.sessionScenario}</Badge>
                ) : (
                  <span style={{ color: "var(--muted)", fontFamily: "var(--font-mono)", fontSize: 10 }}>—</span>
                )}
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
  const [active, setActive]   = useState(0);
  const [copied, setCopied]   = useState(null);

  const copy = (text, key) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 1600);
    });
  };

  const pyCode = `import requests

BASE = "${API_BASE}"

# Start collection
r = requests.post(f"{BASE}/api/start-logs-collection",
    json={"selected_devices": ["device_1", "device_2"], "session_scenario": "example_test_scenario"})
session_id = r.json()["session_id"]

# Stop collection
requests.post(f"{BASE}/api/stop-logs-collection",
    json={"selected_devices": ["device_1"], "session_id": session_id})`;

  const endpoints = [
    {
      method: "GET", path: "/api/devices",
      desc: "Return the list of all managed devices with their current statuses.",
      req: null,
      res: `[\n  {\n    "id": "abc123",\n    "name": "Router-Alpha",\n    "connection": true,\n    "logAccess": true,\n    "collecting": false\n  }\n]`,
    },
    {
      method: "POST", path: "/api/devices",
      desc: "Add a new device from a base64-encoded JSON config file.",
      req: `{\n  "contents": "data:application/json;base64,<data>"\n}`,
      res: `{\n  "device": { "id": "abc123", "name": "Router-Alpha" }\n}`,
    },
    {
      method: "DELETE", path: "/api/devices/:id",
      desc: "Remove a device and terminate its watchdog process.",
      req: null,
      res: `204 No Content`,
    },
    {
      method: "GET", path: "/api/snapshots",
      desc: "List log snapshots. Supports optional filtering via query parameters: search_param (Device | Log Name | Session ID), search_value, log_type (text | chart).",
      req: null,
      res: `[\n  {\n    "id": 1,\n    "deviceName": "Router-Alpha",\n    "logName": "syslog",\n    "startTime": "2024-01-01 10:00:00",\n    "sessionId": "8cd7112719ac",\n    "isChart": false\n  }\n]`,
    },
    {
      method: "GET", path: "/api/snapshots/:id/content",
      desc: "Retrieve full log content rows for a single snapshot.",
      req: null,
      res: `{\n  "rows": [\n    {\n      "time": "2024-01-01 10:00:01",\n      "log_name": "syslog",\n      "content": "INFO kernel: started"\n    }\n  ]\n}`,
    },
    {
      method: "POST", path: "/api/start-logs-collection",
      desc: "Start log collection on the specified devices.",
      req: `{\n  "selected_devices": ["device_1", "device_2"]\n}`,
      res: `{\n  "status": "logs collection started",\n  "session_id": "8cd7112719ac"\n}`,
    },
    {
      method: "POST", path: "/api/stop-logs-collection",
      desc: "Stop log collection and persist the collected snapshots.",
      req: `{\n  "selected_devices": ["device_1"],\n  "session_id": "8cd7112719ac"\n}`,
      res: `{\n  "status": "logs collection stopped",\n  "session_id": "8cd7112719ac",\n  "text_logs_url": "http://...",\n  "chart_logs_url": "http://..."\n}`,
    },
  ];

  const METHOD_COLORS = {
    GET:    { bg: "rgba(74,222,128,0.12)",  text: "#4ade80",  border: "rgba(74,222,128,0.25)" },
    POST:   { bg: "rgba(129,140,248,0.12)", text: "#818cf8",  border: "rgba(129,140,248,0.25)" },
    DELETE: { bg: "rgba(248,113,113,0.12)", text: "#f87171",  border: "rgba(248,113,113,0.25)" },
  };

  const ep = active < endpoints.length ? endpoints[active] : null;
  const mc = ep ? METHOD_COLORS[ep.method] || METHOD_COLORS.GET : METHOD_COLORS.GET;

  return (
    <div style={{ display: "flex", gap: 0, height: "100%", minHeight: 420 }}>

      {/* ── Sidebar ── */}
      <div style={{
        width: 220, flexShrink: 0, borderRight: "1px solid var(--border)",
        paddingRight: 0, display: "flex", flexDirection: "column", gap: 2, paddingTop: 2,
      }}>
        {endpoints.map((e, i) => {
          const mc2 = METHOD_COLORS[e.method] || METHOD_COLORS.GET;
          const isActive = i === active;
          return (
            <button key={i} onClick={() => setActive(i)}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "9px 14px", background: isActive ? "var(--accent-dim)" : "transparent",
                border: "none", borderRight: isActive ? `2px solid var(--accent)` : "2px solid transparent",
                cursor: "pointer", textAlign: "left", transition: "all 0.12s",
                borderRadius: "6px 0 0 6px",
              }}
            >
              <span style={{
                fontSize: 9, fontWeight: 700, fontFamily: "var(--font-mono)",
                padding: "2px 5px", borderRadius: 4,
                background: mc2.bg, color: mc2.text, border: `1px solid ${mc2.border}`,
                minWidth: 42, textAlign: "center", letterSpacing: "0.04em",
              }}>{e.method}</span>
              <span style={{
                fontFamily: "var(--font-mono)", fontSize: 11,
                color: isActive ? "var(--text)" : "var(--muted)",
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              }}>{e.path.replace("/api/", "")}</span>
            </button>
          );
        })}

        {/* Python example link */}
        <button onClick={() => setActive(endpoints.length)}
          style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "9px 14px", marginTop: 8,
            background: active === endpoints.length ? "var(--accent-dim)" : "transparent",
            border: "none", borderRight: active === endpoints.length ? `2px solid var(--accent)` : "2px solid transparent",
            cursor: "pointer", textAlign: "left", transition: "all 0.12s",
            borderTop: "1px solid var(--border)", borderRadius: "6px 0 0 6px",
          }}
        >
          <span style={{ fontSize: 14 }}>🐍</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: active === endpoints.length ? "var(--text)" : "var(--muted)" }}>
            Python example
          </span>
        </button>
      </div>

      {/* ── Detail panel ── */}
      <div style={{ flex: 1, paddingLeft: 24, paddingTop: 2, overflowY: "auto", display: "flex", flexDirection: "column", gap: 18 }}>

        {active < endpoints.length ? (
          <>
            {/* Endpoint title */}
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{
                fontSize: 11, fontWeight: 700, fontFamily: "var(--font-mono)",
                padding: "4px 10px", borderRadius: 6,
                background: mc.bg, color: mc.text, border: `1px solid ${mc.border}`,
                letterSpacing: "0.05em",
              }}>{ep.method}</span>
              <code style={{ fontFamily: "var(--font-mono)", fontSize: 14, color: "var(--text)", letterSpacing: "0.02em" }}>
                {ep.path}
              </code>
              <button onClick={() => copy(ep.path, "path")}
                style={{ marginLeft: "auto", background: "transparent", border: "none", cursor: "pointer", color: "var(--muted)", fontSize: 12, fontFamily: "var(--font-mono)", padding: "3px 8px" }}>
                {copied === "path" ? "✓ copied" : "copy"}
              </button>
            </div>

            {/* Description */}
            <p style={{ color: "var(--muted)", fontSize: 13, margin: 0, lineHeight: 1.7, fontFamily: "var(--font-mono)" }}>
              {ep.desc}
            </p>

            {/* Request body */}
            {ep.req && (
              <div>
                <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: "var(--font-mono)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span>Request Body</span>
                  <button onClick={() => copy(ep.req, "req")}
                    style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--muted)", fontSize: 11, fontFamily: "var(--font-mono)" }}>
                    {copied === "req" ? "✓ copied" : "copy"}
                  </button>
                </div>
                <pre style={{
                  background: "rgba(0,0,0,0.35)", border: "1px solid var(--border)",
                  borderLeft: "3px solid rgba(129,140,248,0.5)",
                  borderRadius: "0 6px 6px 0", padding: "14px 16px", margin: 0,
                  fontFamily: "var(--font-mono)", fontSize: 12, color: "#c4b5fd", overflowX: "auto", lineHeight: 1.6,
                }}>{ep.req}</pre>
              </div>
            )}

            {/* Response */}
            <div>
              <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: "var(--font-mono)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span>Response</span>
                <button onClick={() => copy(ep.res, "res")}
                  style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--muted)", fontSize: 11, fontFamily: "var(--font-mono)" }}>
                  {copied === "res" ? "✓ copied" : "copy"}
                </button>
              </div>
              <pre style={{
                background: "rgba(0,0,0,0.35)", border: "1px solid var(--border)",
                borderLeft: "3px solid rgba(74,222,128,0.5)",
                borderRadius: "0 6px 6px 0", padding: "14px 16px", margin: 0,
                fontFamily: "var(--font-mono)", fontSize: 12, color: "#86efac", overflowX: "auto", lineHeight: 1.6,
              }}>{ep.res}</pre>
            </div>

            {/* Base URL reference */}
            <div style={{ marginTop: "auto", paddingTop: 12, borderTop: "1px solid var(--border)", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted)" }}>
              Base URL: <code style={{ color: "var(--accent)" }}>{API_BASE}</code>
            </div>
          </>
        ) : (
          /* Python example panel */
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 18 }}>🐍</span>
              <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 14, color: "var(--text)" }}>Python Quick-Start</span>
              <button onClick={() => copy(pyCode, "py")}
                style={{ marginLeft: "auto", background: "var(--accent-dim)", border: "1px solid var(--accent-border)", borderRadius: 6, cursor: "pointer", color: "var(--accent)", fontSize: 11, fontFamily: "var(--font-mono)", padding: "4px 12px" }}>
                {copied === "py" ? "✓ Copied" : "Copy"}
              </button>
            </div>
            <p style={{ color: "var(--muted)", fontSize: 12, margin: 0, fontFamily: "var(--font-mono)", lineHeight: 1.7 }}>
              Install <code style={{ color: "var(--accent)" }}>requests</code> via pip, then use the snippet below to start and stop log collection programmatically.
            </p>
            <pre style={{
              background: "rgba(0,0,0,0.4)", border: "1px solid var(--border)",
              borderLeft: "3px solid rgba(129,140,248,0.5)",
              borderRadius: "0 8px 8px 0", padding: "16px 18px", margin: 0,
              fontFamily: "var(--font-mono)", fontSize: 12, color: "#c4b5fd", overflowX: "auto", lineHeight: 1.7,
            }}>{pyCode}</pre>
          </>
        )}
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
              background: "rgba(129,140,248,0.07)",
              border: "1px solid rgba(129,140,248,0.2)",
              borderRadius: 8,
              padding: "18px 20px",
              display: "flex",
              alignItems: "center",
              gap: 14,
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              color: "#a78bfa",
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
              color: "#86efac",
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
        background: "rgba(9,9,15,0.88)",
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

        {/* Animated concentric rings + logo */}
        <div style={{ position: "relative", width: 96, height: 96 }}>
          {/* Outer ring */}
          <svg
            width="96" height="96"
            style={{ position: "absolute", inset: 0, animation: "lo-spin 3s linear infinite" }}
          >
            <circle cx="48" cy="48" r="44"
              fill="none" stroke="rgba(129,140,248,0.18)" strokeWidth="2"
              strokeDasharray="40 8 20 8" />
          </svg>
          {/* Middle ring */}
          <svg
            width="96" height="96"
            style={{ position: "absolute", inset: 0, animation: "lo-rspin 2s linear infinite" }}
          >
            <circle cx="48" cy="48" r="34"
              fill="none" stroke="rgba(129,140,248,0.3)" strokeWidth="2.5"
              strokeDasharray="30 6" />
          </svg>
          {/* Inner pulsing core — same SVG as the header logo */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              animation: "lo-pulse 1.6s ease-in-out infinite",
              filter: "drop-shadow(0 0 12px rgba(129,140,248,0.45))",
            }}
          >
            <svg width="36" height="36" viewBox="0 0 36 36">
              <circle cx="18" cy="18" r="17" fill="none" stroke="#818cf8" strokeWidth="1.5" />
              <circle cx="18" cy="18" r="6" fill="#818cf8" />
              {[0, 45, 90, 135, 180, 225, 270, 315].map((a, i) => {
                const rad = (a * Math.PI) / 180;
                return (
                  <line key={i}
                    x1={18 + 7 * Math.cos(rad)} y1={18 + 7 * Math.sin(rad)}
                    x2={18 + 15 * Math.cos(rad)} y2={18 + 15 * Math.sin(rad)}
                    stroke="#818cf8" strokeWidth="1.8" strokeLinecap="round"
                  />
                );
              })}
            </svg>
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
  const [loginModal,              setLoginModal]              = useState(false);
  const [settingsModal,           setSettingsModal]           = useState(false);
  const [scenarioModal,           setScenarioModal]           = useState(false);
  const [scenarioInput,           setScenarioInput]           = useState("");
  const [scenarioError,           setScenarioError]           = useState(false);

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

  const startCollection = () => {
    setScenarioInput("");
    setScenarioError(false);
    setScenarioModal(true);
  };

  const confirmStartCollection = async () => {
    if (!scenarioInput.trim()) { setScenarioError(true); return; }
    const names = devices.filter((d) => selectedDevices.includes(d.id)).map((d) => d.name);
    setScenarioModal(false);
    try {
      await apiFetch("/api/start-logs-collection", {
        method: "POST",
        body: JSON.stringify({ selected_devices: names, session_scenario: scenarioInput.trim() }),
      });
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
        setLogRows(results.flatMap((r) =>
          r.rows.map((row) => ({ ...row, device_name: r.snapInfo.deviceName ?? r.snapInfo.device_name ?? "" }))
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

  const downloadLogs = (format = "csv") => {
    if (isChart) {
      addToast("Chart export requires backend — use the API endpoint directly.", "info");
      return;
    }
    if (!logRows || logRows.length === 0) {
      addToast("No log data to export.", "info");
      return;
    }

    let blob, filename;

    if (format === "csv") {
      const content =
        "Time,Device,Log Name,Content\n" +
        logRows.map((r) => `"${r.time}","${r.device_name ?? ""}","${r.log_name}","${(r.content ?? "").replace(/"/g, '""')}"`).join("\n");
      blob = new Blob([content], { type: "text/csv" });
      filename = "logs.csv";

    } else if (format === "txt") {
      const lines = logRows.map(
        (r) => `[${r.time}] [${r.device_name ?? ""}] [${r.log_name}] ${r.content ?? ""}`
      );
      blob = new Blob([lines.join("\n")], { type: "text/plain" });
      filename = "logs.txt";

    } else if (format === "json") {
      const data = logRows.map((r) => ({
        time: r.time,
        device: r.device_name ?? "",
        log_name: r.log_name,
        content: r.content,
      }));
      blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      filename = "logs.json";

    } else if (format === "html") {
      const rows = logRows
        .map(
          (r) =>
            `<tr><td>${r.time ?? ""}</td><td>${r.device_name ?? ""}</td><td>${r.log_name ?? ""}</td><td style="color:${
              (r.content ?? "").startsWith("ERROR") ? "#f87171" : (r.content ?? "").startsWith("WARN") ? "#fbbf24" : "inherit"
            }">${(r.content ?? "").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</td></tr>`
        )
        .join("\n");
      const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>LogOctopus Export</title>
<style>
  body{font-family:'JetBrains Mono',monospace;background:#09090f;color:#e4e4f0;margin:0;padding:24px}
  h1{font-size:16px;color:#818cf8;margin-bottom:16px}
  table{border-collapse:collapse;width:100%;font-size:12px}
  th{text-align:left;padding:8px 12px;border-bottom:2px solid rgba(255,255,255,0.12);color:#6b7280;text-transform:uppercase;font-size:10px;letter-spacing:.06em}
  td{padding:7px 12px;border-bottom:1px solid rgba(255,255,255,0.04);vertical-align:top;word-break:break-word}
  tr:hover td{background:rgba(255,255,255,0.03)}
</style>
</head>
<body>
<h1>LogOctopus — Log Export (${new Date().toISOString()})</h1>
<table>
<thead><tr><th>Timestamp</th><th>Device</th><th>Log Name</th><th>Content</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</body>
</html>`;
      blob = new Blob([html], { type: "text/html" });
      filename = "logs.html";
    }

    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    addToast(`Logs exported as ${format.toUpperCase()}.`, "success");
  };

  // Modal title with chart count info
  const logModalTitle = isChart && chartGroups.length > 0
    ? `Chart Data — ${chartGroups.length} snapshot${chartGroups.length > 1 ? "s" : ""}`
    : "Logs Content";

  // ── Inject SVG favicon matching the header logo color ──────────────────────
  useEffect(() => {
    const svgFavicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36">
      <circle cx="18" cy="18" r="17" fill="none" stroke="#818cf8" stroke-width="1.5"/>
      <circle cx="18" cy="18" r="6" fill="#818cf8"/>
      ${[0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
        const rad = (a * Math.PI) / 180;
        const x1 = (18 + 7 * Math.cos(rad)).toFixed(3);
        const y1 = (18 + 7 * Math.sin(rad)).toFixed(3);
        const x2 = (18 + 15 * Math.cos(rad)).toFixed(3);
        const y2 = (18 + 15 * Math.sin(rad)).toFixed(3);
        return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#818cf8" stroke-width="1.8" stroke-linecap="round"/>`;
      }).join("")}
    </svg>`;
    const encoded = `data:image/svg+xml,${encodeURIComponent(svgFavicon)}`;
    let link = document.querySelector("link[rel~='icon']");
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.href = encoded;
  }, []);

  // ── CSS ────────────────────────────────────────────────────────────────────
  const cssVars = `
    @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');
    :root {
      --bg: #09090f; --surface: #0e0e1a; --card-bg: #12121f; --modal-bg: #0f0f1c;
      --border: rgba(255,255,255,0.07); --text: #e4e4f0; --muted: #64648a; --accent: #818cf8;
      --accent-dim: rgba(129,140,248,0.12); --accent-border: rgba(129,140,248,0.3);
      --font-display: 'Syne', ui-sans-serif, sans-serif;
      --font-mono: 'JetBrains Mono', 'Fira Code', monospace;
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); }
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-thumb { background: rgba(129,140,248,0.18); border-radius: 3px; }
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
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#4ade80", boxShadow: "0 0 8px #4ade80", animation: "pulse 2s infinite" }} />
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted)" }}>LIVE</span>
            </div>
            {/* Auth controls */}
            {auth.isAdmin ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    color: "#a78bfa",
                    background: "rgba(129,140,248,0.1)",
                    border: "1px solid rgba(129,140,248,0.25)",
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
            <Btn variant="subtle" size="sm" onClick={() => setApiModal(true)}>⚡ REST API</Btn>
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
                    onAutoCollectionSave={(id, enabled, interval) => {
                      setDevices(prev => prev.map(dev =>
                        dev.id === id
                          ? { ...dev, autoCollectionEnabled: enabled, autoCollectionInterval: interval }
                          : dev
                      ));
                    }}
                    addToast={addToast}
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
                <option>Device</option><option>Log Name</option><option>Session ID</option><option>Scenario</option><option>Started</option><option>Finished</option>
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

      {/* Session scenario modal — shown when the user clicks ▶ Start Collection */}
      <Modal
        open={scenarioModal}
        onClose={() => setScenarioModal(false)}
        title="Start Logs Collection"
        size="sm"
        footer={
          <>
            <Btn variant="success" onClick={confirmStartCollection}>▶ Start</Btn>
            <Btn variant="ghost" onClick={() => setScenarioModal(false)}>Cancel</Btn>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <p style={{ margin: 0, fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--muted)" }}>
              Session scenario
            </p>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#f87171" }}>* required</span>
          </div>
          <input
            autoFocus
            value={scenarioInput}
            onChange={(e) => { setScenarioInput(e.target.value); if (e.target.value.trim()) setScenarioError(false); }}
            onKeyDown={(e) => { if (e.key === "Enter") confirmStartCollection(); }}
            placeholder="e.g. reboot-test, baseline, stress-run…"
            style={{
              background: "var(--card-bg)",
              border: `1px solid ${scenarioError ? "#f87171" : "var(--border)"}`,
              borderRadius: 7,
              color: "var(--text)",
              fontFamily: "var(--font-mono)",
              fontSize: 13,
              padding: "9px 14px",
              outline: "none",
              width: "100%",
              boxSizing: "border-box",
              transition: "border-color 0.15s",
            }}
          />
          {scenarioError && (
            <p style={{ margin: 0, fontFamily: "var(--font-mono)", fontSize: 11, color: "#f87171" }}>
              Please enter a scenario before starting collection.
            </p>
          )}
        </div>
      </Modal>

      {/* Settings modal */}
      <SettingsModal
        open={settingsModal}
        onClose={() => setSettingsModal(false)}
        isAdmin={auth.isAdmin}
        onRequestLogin={() => { setSettingsModal(false); setLoginModal(true); }}
        auth={auth}
        addToast={addToast}
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
            {!isChart && <DownloadMenu onDownload={downloadLogs} />}
            <Btn variant="ghost" onClick={() => setLogModal(false)}>Close</Btn>
          </>
        }
      >
        {logRowsLoading ? (
          <Spinner />
        ) : (
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <LogContentView
              rows={logRows}
              isChart={isChart}
              colorMode={colorMode}
              chartGroups={chartGroups}
            />
          </div>
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
