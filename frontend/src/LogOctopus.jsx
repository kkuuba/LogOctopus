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
function PlotlyChart({ rows, title, index, dataUnit }) {
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
          hovertemplate: dataUnit ? `<b>%{y} ${dataUnit}<extra></extra>` : "<b>%{y}<extra></extra>",
        }
      : {
          x: xValues,
          y: yValues,
          type: "scatter",
          mode: "markers",
          name: title,
          marker: { size: 8, color: lineColor, opacity: 0.85, symbol: "diamond" },
          hovertemplate: dataUnit ? `<b>%{y} ${dataUnit}<extra></extra>` : "<b>%{y}<extra></extra>",
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
        ...(dataUnit ? { title: { text: dataUnit, font: { color: "#6b7280", size: 11, family: "JetBrains Mono, monospace" } } } : {}),
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
  }, [rows, title, index, dataUnit]);

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
            <PlotlyChart rows={g.rows} title={label} index={i} dataUnit={g.snapInfo.dataUnit || ""} />
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
              <Badge color="default">Data unit: {g.snapInfo.dataUnit}</Badge>
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

// ── DOWNLOAD FORMATS ──────────────────────────────────────────────────────────
const DOWNLOAD_FORMATS = [
  { id: "csv",        label: "CSV",  icon: "📊", desc: "Spreadsheet-compatible" },
  { id: "txt",        label: "TXT",  icon: "📄", desc: "Plain text, one row per line" },
  { id: "json",       label: "JSON", icon: "🗂",  desc: "Structured JSON array" },
  { id: "html-color", label: "HTML", icon: "🌐", desc: "Styled HTML with per-source color stripes" },
];

// ── DOWNLOAD MENU ─────────────────────────────────────────────────────────────
function DownloadMenu({ onDownload, disabled = false, loading = false, isChart = false }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Chart mode: JSON + HTML; text mode: all formats
  const formats = isChart
    ? [
        { id: "json",       label: "JSON", icon: "🗂",  desc: "Structured JSON array" },
        { id: "html-color", label: "HTML", icon: "🌐", desc: "Interactive charts in a standalone page" },
      ]
    : DOWNLOAD_FORMATS;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => { if (!disabled && !loading) setOpen((v) => !v); }}
        disabled={disabled || loading}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          background: open ? "rgba(129,140,248,0.12)" : "rgba(255,255,255,0.06)",
          border: `1px solid ${open ? "rgba(129,140,248,0.35)" : "var(--border)"}`,
          borderRadius: 8, color: (disabled || loading) ? "var(--muted)" : open ? "var(--accent)" : "var(--text)",
          fontFamily: "var(--font-mono)", fontSize: 12, padding: "7px 14px",
          cursor: (disabled || loading) ? "not-allowed" : "pointer",
          opacity: disabled ? 0.45 : 1,
          transition: "all 0.15s",
        }}
      >
        {loading ? "⏳ Fetching…" : "⬇ Download"}
        {!loading && <span style={{ fontSize: 9, marginLeft: 2, opacity: 0.7 }}>{open ? "▲" : "▼"}</span>}
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

// ── DOWNLOAD SELECTED SPLIT BUTTON ───────────────────────────────────────────
/**
 * Split-button for the snapshot toolbar.
 * Left half: immediately downloads in the last-used format (default: csv).
 * Right half (▾): opens a format picker dropdown.
 * Shows a spinner while fetching, and is greyed out when nothing is selected.
 */
function DownloadSelectedBtn({ onDownload, disabled = false, loading = false, isChart = false }) {
  const [open, setOpen]           = useState(false);
  const [lastFmt, setLastFmt]     = useState("html-color");
  const ref                       = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const formats = isChart
    ? [
        { id: "json",       label: "JSON", icon: "🗂",  desc: "Structured JSON array" },
        { id: "html-color", label: "HTML", icon: "🌐", desc: "Interactive charts in a standalone page" },
      ]
    : DOWNLOAD_FORMATS;

  const handlePick = (id) => {
    setLastFmt(id);
    setOpen(false);
    onDownload(id);
  };

  const handleMain = () => {
    if (disabled || loading) return;
    onDownload(lastFmt);
  };

  const accentColor  = "var(--accent)";           // same indigo as the rest of the UI
  const accentDim    = "var(--accent-dim)";        // rgba(129,140,248,0.12)
  const accentBorder = "var(--accent-border)";     // rgba(129,140,248,0.3)
  const isOff        = disabled || loading;

  const sharedStyle = {
    display: "inline-flex", alignItems: "center",
    background: isOff ? "rgba(255,255,255,0.04)" : accentDim,
    border: "none",
    color: isOff ? "var(--muted)" : accentColor,
    fontFamily: "var(--font-display)", fontWeight: 700,
    fontSize: 13, letterSpacing: "0.03em",
    cursor: isOff ? "not-allowed" : "pointer",
    opacity: disabled ? 0.45 : 1,
    transition: "background 0.15s, color 0.15s",
  };

  const currentFmtLabel = formats.find(f => f.id === lastFmt)?.label ?? formats[0].label;

  return (
    <div
      ref={ref}
      style={{
        position: "relative",
        display: "inline-flex",
        borderRadius: 9,
        border: `1px solid ${isOff ? "var(--border)" : accentBorder}`,
        overflow: "visible",
        boxShadow: isOff ? "none" : `0 0 0 0px ${accentColor}`,
        transition: "box-shadow 0.2s",
      }}
    >
      {/* ── Main action half ── */}
      <button
        onClick={handleMain}
        disabled={isOff}
        title={`Download as ${isChart ? "JSON" : currentFmtLabel}`}
        style={{
          ...sharedStyle,
          borderRadius: "8px 0 0 8px",
          padding: "8px 14px",
          gap: 7,
          borderRight: `1px solid ${isOff ? "var(--border)" : accentBorder}`,
        }}
        onMouseEnter={e => { if (!isOff) e.currentTarget.style.background = "rgba(129,140,248,0.22)"; }}
        onMouseLeave={e => { e.currentTarget.style.background = isOff ? "rgba(255,255,255,0.04)" : "var(--accent-dim)"; }}
      >
        {loading
          ? <><span style={{ fontSize: 13 }}>⏳</span> Fetching…</>
          : <><span style={{ fontSize: 13 }}>⬇</span> Download {currentFmtLabel}</>
        }
      </button>

      {/* ── Chevron / picker half ── */}
      <button
        onClick={() => { if (!isOff) setOpen(v => !v); }}
        disabled={isOff}
        title="Choose format"
        style={{
          ...sharedStyle,
          borderRadius: "0 8px 8px 0",
          padding: "8px 10px",
          fontSize: 10,
        }}
        onMouseEnter={e => { if (!isOff) e.currentTarget.style.background = "rgba(129,140,248,0.22)"; }}
        onMouseLeave={e => { e.currentTarget.style.background = isOff ? "rgba(255,255,255,0.04)" : "var(--accent-dim)"; }}
      >
        {open ? "▲" : "▼"}
      </button>

      {/* ── Dropdown ── */}
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", left: 0,
          background: "var(--modal-bg)",
          border: `1px solid ${accentBorder}`,
          borderRadius: 10,
          overflow: "hidden",
          minWidth: 210,
          boxShadow: `0 12px 40px rgba(0,0,0,0.55), 0 0 0 1px ${accentBorder}`,
          zIndex: 300,
        }}>
          <div style={{
            padding: "8px 14px 6px",
            fontFamily: "var(--font-mono)", fontSize: 10,
            color: accentColor, letterSpacing: "0.1em", textTransform: "uppercase",
            borderBottom: "1px solid rgba(129,140,248,0.12)",
          }}>
            Download as
          </div>
          {formats.map((f, i) => {
            const isActive = f.id === lastFmt;
            return (
              <button
                key={f.id}
                onClick={() => handlePick(f.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 10, width: "100%",
                  background: isActive ? "rgba(129,140,248,0.1)" : "transparent",
                  border: "none",
                  borderBottom: i < formats.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                  padding: "9px 14px", cursor: "pointer", textAlign: "left",
                  transition: "background 0.1s",
                }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = "rgba(129,140,248,0.08)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = isActive ? "rgba(129,140,248,0.1)" : "transparent"; }}
              >
                <span style={{ fontSize: 15 }}>{f.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{
                    fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600,
                    color: isActive ? accentColor : "var(--text)",
                  }}>{f.label}</div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--muted)" }}>{f.desc}</div>
                </div>
                {isActive && (
                  <span style={{ fontSize: 10, color: accentColor, marginLeft: "auto" }}>✓</span>
                )}
              </button>
            );
          })}
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

// ── DEVICE GROUP ──────────────────────────────────────────────────────────────
function DeviceGroup({ group, groupDevices, collapsed, onToggleCollapse, selectedDevices, onSelect, onSelectAll, onInfo, onAutoCollectionSave, onDropDevice, onRemoveDevice, onReorderDevice, onRename, onDelete, addToast, isUngrouped }) {
  const [dragOver, setDragOver] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(group.name || "");
  // Intra-group card reordering state
  const [dragSrcId,  setDragSrcId]  = useState(null);
  const [dragOverId, setDragOverId] = useState(null);

  const handleDragOver = (e) => { e.preventDefault(); setDragOver(true); };
  const handleDragLeave = () => setDragOver(false);
  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    setDragOverId(null);
    const deviceId = e.dataTransfer.getData("deviceId");
    const srcGroup = e.dataTransfer.getData("srcGroupId");
    if (!deviceId) return;
    // Intra-group reorder: source and target group are the same
    if (srcGroup === group.id && dragSrcId && dragOverId && dragSrcId !== dragOverId && onReorderDevice) {
      onReorderDevice(group.id, dragSrcId, dragOverId);
    } else if (isUngrouped) {
      onRemoveDevice(deviceId);
    } else {
      onDropDevice(deviceId, group.id);
    }
    setDragSrcId(null);
  };

  const commitRename = () => {
    const n = nameInput.trim();
    if (n && onRename) {
      const ok = onRename(n);
      if (ok !== false) setEditingName(false);  // keep editor open if rejected
    } else {
      setEditingName(false);
    }
  };

  const showHeader = group.name !== null;
  const isCollapsed = collapsed && showHeader && !isUngrouped;
  // Selected count in this group
  const selectedCount = groupDevices.filter(d => selectedDevices.includes(d.id)).length;
  const allSelected  = groupDevices.length > 0 && selectedCount === groupDevices.length;
  const someSelected = selectedCount > 0 && !allSelected;

  const handleGroupCheckbox = (e) => {
    if (onSelectAll) onSelectAll(groupDevices.map(d => d.id), e.target.checked);
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{
        borderRadius: 12,
        border: dragOver
          ? "2px dashed var(--accent)"
          : showHeader ? `1px solid ${isCollapsed ? "rgba(255,255,255,0.05)" : "var(--border)"}` : "none",
        background: dragOver
          ? "rgba(129,140,248,0.05)"
          : isCollapsed ? "rgba(255,255,255,0.01)" : showHeader ? "rgba(255,255,255,0.015)" : "transparent",
        padding: showHeader ? "14px 16px" : 0,
        transition: "all 0.18s",
      }}
    >
      {showHeader && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: isCollapsed ? 0 : 12 }}>
          {/* Group select-all checkbox */}
          {groupDevices.length > 0 && (
            <input
              type="checkbox"
              checked={allSelected}
              ref={el => { if (el) el.indeterminate = someSelected; }}
              onChange={handleGroupCheckbox}
              title={allSelected ? "Deselect all in group" : "Select all in group"}
              style={{ width: 15, height: 15, accentColor: "var(--accent)", cursor: "pointer", flexShrink: 0 }}
            />
          )}

          {/* Collapse toggle chevron */}
          {!isUngrouped && onToggleCollapse && (
            <button
              onClick={onToggleCollapse}
              title={isCollapsed ? "Expand group" : "Collapse group"}
              style={{
                background: "none", border: "none", cursor: "pointer", padding: "2px 4px",
                color: "var(--muted)", fontSize: 11, lineHeight: 1, transition: "transform 0.18s",
                transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)",
                flexShrink: 0,
              }}
            >▼</button>
          )}

          {/* Drag-drop hint icon */}
          <span style={{ fontSize: 14, opacity: 0.5 }}>⊞</span>

          {editingName ? (
            <input
              autoFocus
              value={nameInput}
              onChange={e => setNameInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setEditingName(false); }}
              onBlur={commitRename}
              style={{ ...inputStyle, width: 180, padding: "4px 8px", fontSize: 12, display: "inline" }}
            />
          ) : (
            <span
              style={{
                fontFamily: "var(--font-display)", fontSize: 12, fontWeight: 700, letterSpacing: "0.08em",
                textTransform: "uppercase", color: isUngrouped ? "var(--muted)" : "var(--text)",
                cursor: onRename ? "pointer" : "default",
                opacity: isCollapsed ? 0.7 : 1,
                transition: "opacity 0.18s",
              }}
              onDoubleClick={() => { if (onRename) { setNameInput(group.name); setEditingName(true); } }}
              title={onRename ? "Double-click to rename" : undefined}
            >
              {group.name}
            </span>
          )}

          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--muted)" }}>
            {groupDevices.length} device{groupDevices.length !== 1 ? "s" : ""}
            {isCollapsed && selectedCount > 0 && (
              <span style={{ color: "var(--accent)", marginLeft: 5 }}>· {selectedCount} selected</span>
            )}
          </span>

          {dragOver && (
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--accent)", marginLeft: 4 }}>
              Drop to {isUngrouped ? "ungroup" : "add"}
            </span>
          )}

          {onDelete && (
            <button
              onClick={onDelete}
              title="Delete group"
              style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 14, padding: "2px 6px", opacity: 0.6 }}
            >🗑</button>
          )}
        </div>
      )}

      {!isCollapsed && (
        groupDevices.length === 0 && showHeader ? (
          <div style={{
            padding: "18px",
            border: "1px dashed var(--border)",
            borderRadius: 8,
            textAlign: "center",
            color: "var(--muted)",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            opacity: 0.7,
          }}>
            Drag device cards here
          </div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
            {groupDevices.map(d => (
              <div
                key={d.id}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOverId(d.id); }}
                onDragLeave={(e) => { e.stopPropagation(); setDragOverId(null); }}
                style={{
                  outline: dragOverId === d.id && dragSrcId !== d.id
                    ? "2px dashed var(--accent)"
                    : "2px solid transparent",
                  borderRadius: 14,
                  opacity: dragSrcId === d.id ? 0.45 : 1,
                  transition: "opacity 0.15s, outline 0.1s",
                }}
              >
                <DeviceCard
                  device={d}
                  selected={selectedDevices.includes(d.id)}
                  onSelect={(checked) => onSelect(d.id, checked)}
                  onInfo={() => onInfo(d)}
                  onAutoCollectionSave={onAutoCollectionSave}
                  onDragStart={() => { setDragSrcId(d.id); }}
                  onDragEnd={() => { setDragSrcId(null); setDragOverId(null); }}
                  srcGroupId={group.id}
                  addToast={addToast}
                />
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}

// ── DEVICE CARD ───────────────────────────────────────────────────────────────
function DeviceCard({ device, selected, onSelect, onInfo, onAutoCollectionSave, onDragStart, onDragEnd, srcGroupId, addToast }) {
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
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("deviceId", device.id);
        e.dataTransfer.setData("srcGroupId", srcGroupId || "");
        e.dataTransfer.effectAllowed = "move";
        onDragStart?.();
      }}
      onDragEnd={() => onDragEnd?.()}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "relative",
        width: 220,
        borderRadius: 12,
        background: selected ? "var(--accent-dim)" : "var(--card-bg)",
        border: `1px solid ${selected ? "var(--accent)" : hovered ? "var(--accent-border)" : "var(--border)"}`,
        transition: "all 0.2s",
        cursor: "grab",
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
              Auto collection - {intervalHours}h
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
      <span style={{ marginLeft: "auto", color: ok ? "#4ade80" : "#cb0f0f", fontSize: 16 }}>{ok ? "✔" : "✖"}</span>
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
// ── CONFIG BUILDER ────────────────────────────────────────────────────────────

const EMPTY_LOG_ENTRY = () => ({
  _id: Math.random().toString(36).slice(2),
  log_name: "",
  log_file_cmd: "",
  data_extraction_regex: "",
  log_activation_cmd: "",
  log_deactivation_cmd: "",
  custom_shell_prompt: "",
  log_type: "text",
  data_unit: "",
});

const FIELD_LABEL = {
  fontSize: 10, color: "var(--muted)", textTransform: "uppercase",
  letterSpacing: "0.09em", fontFamily: "var(--font-mono)", marginBottom: 5,
};

const CARD = {
  background: "var(--card-bg)", border: "1px solid var(--border)",
  borderRadius: 12, padding: "18px 22px", marginBottom: 16,
};

// Convert Python-style (?P<NAME>...) named groups to JS (?<NAME>...) syntax
function pyRegexToJs(pattern) {
  return pattern.replace(/\(\?P</g, "(?<");
}

// Escape a literal string for use inside a regex pattern
function escapeForRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── REGEX BUILDER ─────────────────────────────────────────────────────────────
// Given a sample line, two optional marked spans (TIME / ENTRY), build a
// Python named-group regex that captures those spans.
//
// Strategy: for each marked span we generalise it to a pattern:
//   - digits-only chunks  → \d+
//   - alpha-only chunks   → \w+
//   - word characters     → \S+ (non-space run)
//   - everything          → .*
// Surrounding literal text is escaped and anchored.
function buildRegexFromSpans(line, timeSpan, entrySpan) {
  // Sort spans left-to-right
  const spans = [];
  if (timeSpan)  spans.push({ ...timeSpan,  group: "TIME"  });
  if (entrySpan) spans.push({ ...entrySpan, group: "ENTRY" });
  spans.sort((a, b) => a.start - b.start);

  if (spans.length === 0) return "";

  let pattern = "^";
  let cursor = 0;

  for (const span of spans) {
    // Literal prefix between cursor and span start
    if (span.start > cursor) {
      pattern += escapeForRegex(line.slice(cursor, span.start));
    }
    // Generalise the captured text into a pattern
    const captured = line.slice(span.start, span.end);
    const inner = generaliseCapture(captured);
    pattern += `(?P<${span.group}>${inner})`;
    cursor = span.end;
  }

  // If the last span is ENTRY and it goes to end-of-line, anchor with .*
  const lastSpan = spans[spans.length - 1];
  if (lastSpan.group === "ENTRY" && lastSpan.end >= line.length) {
    // already captured to end
  } else if (cursor < line.length) {
    // literal suffix — omit for flexibility, just don't anchor end
  }

  return pattern;
}

function generaliseCapture(text) {
  // Pure digits (and separators like : - /)  → timestamp-like pattern
  if (/^[\d:.\-/ ]+$/.test(text)) {
    // Build a pattern that allows digits, colons, dashes, slashes, dots, spaces
    return "[\\d:.\\/\\- ]+";
  }
  // Pure word characters  → \w+
  if (/^\w+$/.test(text)) return "\\w+";
  // Mix of word + common separators → \S+
  if (!/\s/.test(text)) return "\\S+";
  // Has whitespace inside (e.g. "Jan 12 10:00:00") → collapse runs
  return text
    .split(/(\s+)/)
    .map(tok => tok.match(/^\s+$/) ? "\\s+" : (tok ? generaliseCapture(tok) : ""))
    .join("");
}

// ── TERMINAL OUTPUT WITH REGEX HIGHLIGHTING ───────────────────────────────────
function TerminalOutput({ lines, regex, regexError, onMarkSpan, markMode }) {
  // markMode: null | "TIME" | "ENTRY"
  // onMarkSpan(lineIdx, start, end, text)

  const handleMouseUp = (lineIdx, lineText) => {
    if (!markMode) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const selected = sel.toString();
    if (!selected) return;
    // Find the start offset within the line text
    const start = lineText.indexOf(selected);
    if (start === -1) return;
    onMarkSpan(lineIdx, start, start + selected.length, selected);
    sel.removeAllRanges();
  };

  let re = null;
  try { if (regex && !regexError) re = new RegExp(pyRegexToJs(regex)); } catch {}

  return (
    <div style={{
      fontFamily: "var(--font-mono)", fontSize: 11, lineHeight: 1.7,
      background: "rgba(0,0,0,0.45)", borderRadius: "0 0 8px 8px",
      padding: "10px 14px", maxHeight: 400, overflowY: "auto",
      whiteSpace: "pre-wrap", wordBreak: "break-all",
      cursor: markMode ? "crosshair" : "text",
      userSelect: markMode ? "text" : "auto",
    }}>
      {lines.map((line, i) => {
        if (!line) return <div key={i} style={{ height: 3 }} />;
        if (!re) {
          return (
            <div key={i} onMouseUp={() => handleMouseUp(i, line)}
              style={{ color: "#94a3b8", padding: "1px 0" }}>
              {line}
            </div>
          );
        }
        const m = re.exec(line);
        if (!m) {
          return (
            <div key={i} onMouseUp={() => handleMouseUp(i, line)}
              style={{ color: "#374151", borderLeft: "2px solid rgba(255,255,255,0.04)", paddingLeft: 8, padding: "1px 0 1px 8px" }}>
              {line}
            </div>
          );
        }
        // Render matched line with TIME/ENTRY segments highlighted
        const groups = m.groups || {};
        const TIME  = groups.TIME  !== undefined ? groups.TIME  : null;
        const ENTRY = groups.ENTRY !== undefined ? groups.ENTRY : null;
        const timeIdx  = TIME  != null ? line.indexOf(TIME)  : -1;
        const entryIdx = ENTRY != null ? line.indexOf(ENTRY, timeIdx >= 0 ? timeIdx + TIME.length : 0) : -1;

        const parts = [];
        let cur = 0;
        const addPart = (end, color, label) => {
          if (cur < end) {
            parts.push({ text: line.slice(cur, end), color, label });
            cur = end;
          }
        };
        // Build parts in order
        const segs = [];
        if (TIME  != null && timeIdx  >= 0) segs.push({ start: timeIdx,  end: timeIdx  + TIME.length,  color: "#f59e0b", label: "TIME"  });
        if (ENTRY != null && entryIdx >= 0) segs.push({ start: entryIdx, end: entryIdx + ENTRY.length, color: "#86efac", label: "ENTRY" });
        segs.sort((a, b) => a.start - b.start);
        for (const seg of segs) {
          if (seg.start > cur) parts.push({ text: line.slice(cur, seg.start), color: "#4b5563", label: null });
          parts.push({ text: line.slice(seg.start, seg.end), color: seg.color, label: seg.label });
          cur = seg.end;
        }
        if (cur < line.length) parts.push({ text: line.slice(cur), color: "#4b5563", label: null });

        return (
          <div key={i} onMouseUp={() => handleMouseUp(i, line)}
            style={{ display: "flex", flexWrap: "wrap", gap: 0, alignItems: "baseline", padding: "1px 0" }}>
            {parts.map((p, pi) => (
              <span key={pi} style={{
                color: p.color,
                background: p.label ? (p.label === "TIME" ? "rgba(245,158,11,0.15)" : "rgba(134,239,172,0.12)") : "transparent",
                borderRadius: p.label ? 2 : 0,
              }}>{p.text}</span>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ── LOG ENTRY EDITOR ──────────────────────────────────────────────────────────
function LogEntryEditor({ entry, conn, index, onChange, onRemove, onDuplicate }) {
  const [expanded, setExpanded] = useState(index === 0);
  const [activeTab, setActiveTab] = useState("collect"); // "collect" | "activate" | "deactivate"

  // Per-command terminal state
  const [outputs, setOutputs]   = useState({ collect: null, activate: null, deactivate: null });
  const [errors,  setErrors]    = useState({ collect: "",   activate: "",   deactivate: ""   });
  const [running, setRunning]   = useState(null); // null | "collect" | "activate" | "deactivate"

  // Regex builder state
  const [markMode,   setMarkMode]   = useState(null);  // null | "TIME" | "ENTRY"
  const [markedLine, setMarkedLine] = useState(null);  // index of line used for regex building
  const [timeSpan,   setTimeSpan]   = useState(null);  // { start, end, text }
  const [entrySpan,  setEntrySpan]  = useState(null);  // { start, end, text }

  // Local editable command strings (so the user can edit without committing on every keystroke)
  const set = (k, v) => onChange({ ...entry, [k]: v });

  const execCmd = async (tab) => {
    const cmdMap = { collect: entry.log_file_cmd, activate: entry.log_activation_cmd, deactivate: entry.log_deactivation_cmd };
    const cmd = cmdMap[tab];
    if (!conn.ip_address || !conn.user) {
      setErrors(p => ({ ...p, [tab]: "Fill in connection details first (Step 1)." }));
      return;
    }
    if (!cmd || !cmd.trim()) {
      setErrors(p => ({ ...p, [tab]: "No command entered." }));
      return;
    }
    setRunning(tab);
    setOutputs(p => ({ ...p, [tab]: null }));
    setErrors(p => ({ ...p, [tab]: "" }));
    try {
      const payload = {
        ip_address: conn.ip_address, port: Number(conn.port || 22),
        user: conn.user, password: conn.password,
        ssh_key_string: conn.ssh_key_string || "",
        gateways: conn.gateways || [], command: cmd,
      };
      if (entry.custom_shell_prompt?.trim()) payload.custom_shell_prompt = entry.custom_shell_prompt.trim();
      const res = await apiFetch("/api/devices/exec-command", { method: "POST", body: JSON.stringify(payload) });
      const out = res.stdout || res.stderr || "(empty output)";
      setOutputs(p => ({ ...p, [tab]: out }));
      if (res.exit_code !== 0 && res.stderr) {
        setErrors(p => ({ ...p, [tab]: `exit ${res.exit_code}: ${res.stderr.slice(0, 200)}` }));
      }
    } catch (e) {
      setErrors(p => ({ ...p, [tab]: e.message }));
    } finally {
      setRunning(null);
    }
  };

  // When user marks a span in the terminal, update timeSpan/entrySpan and rebuild regex
  const handleMarkSpan = (lineIdx, start, end, text) => {
    if (!markMode) return;
    const span = { start, end, text };
    let newTime = timeSpan, newEntry = entrySpan;
    if (markMode === "TIME")  { newTime  = span; setTimeSpan(span);  setMarkedLine(lineIdx); }
    if (markMode === "ENTRY") { newEntry = span; setEntrySpan(span); setMarkedLine(lineIdx); }
    setMarkMode(null);
    // Rebuild regex from the line
    const lines = (outputs.collect || "").split("\n").filter(l => l.trim());
    const line = lines[markedLine != null && markMode === "ENTRY" ? markedLine : lineIdx] || "";
    const built = buildRegexFromSpans(line, markMode === "TIME" ? span : newTime, markMode === "ENTRY" ? span : newEntry);
    if (built) set("data_extraction_regex", built);
  };

  const clearSpans = () => { setTimeSpan(null); setEntrySpan(null); setMarkedLine(null); setMarkMode(null); };

  // Regex validation
  let reErr = "";
  try { if (entry.data_extraction_regex) new RegExp(pyRegexToJs(entry.data_extraction_regex)); }
  catch (e) { reErr = e.message; }

  const collectLines = (outputs.collect || "").split("\n");
  const matchCount = (() => {
    if (!entry.data_extraction_regex || reErr) return null;
    try {
      const re = new RegExp(pyRegexToJs(entry.data_extraction_regex));
      const nonEmpty = collectLines.filter(l => l.trim());
      return { matched: nonEmpty.filter(l => re.test(l)).length, total: nonEmpty.length };
    } catch { return null; }
  })();

  // Tab config
  const TABS = [
    { key: "collect",    icon: "▶", label: "collect",    cmdKey: "log_file_cmd",        hint: "Command that fetches log data" },
    { key: "activate",   icon: "⚡", label: "activate",   cmdKey: "log_activation_cmd",  hint: "Runs before collection. Must exit 0 to enable. Use `true` to always enable." },
    { key: "deactivate", icon: "⛔", label: "deactivate", cmdKey: "log_deactivation_cmd", hint: "Runs on collection stop to disable the log source. Optional." },
  ];
  const currentTab = TABS.find(t => t.key === activeTab);

  // Styles
  const S = {
    terminal: {
      background: "#0a0d12", border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: 8, overflow: "hidden",
    },
    termBar: {
      background: "#111520", borderBottom: "1px solid rgba(255,255,255,0.07)",
      display: "flex", alignItems: "center", padding: "0 0 0 14px", gap: 0,
    },
    termTab: (active, hasOutput, hasErr) => ({
      display: "flex", alignItems: "center", gap: 5,
      fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: active ? 700 : 400,
      padding: "7px 14px", cursor: "pointer", border: "none",
      borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
      background: active ? "rgba(129,140,248,0.08)" : "transparent",
      color: active ? "var(--accent)" : (hasErr ? "#f87171" : hasOutput ? "#4ade80" : "var(--muted)"),
      transition: "all 0.12s", whiteSpace: "nowrap",
    }),
    promptLine: {
      display: "flex", alignItems: "center", gap: 8,
      padding: "8px 14px", borderTop: "1px solid rgba(255,255,255,0.05)",
      background: "rgba(0,0,0,0.2)",
    },
    runBtn: (busy) => ({
      display: "flex", alignItems: "center", gap: 6,
      background: busy ? "rgba(129,140,248,0.06)" : "rgba(129,140,248,0.12)",
      border: "1px solid rgba(129,140,248,0.3)", borderRadius: 5,
      color: "var(--accent)", fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 700,
      padding: "4px 12px", cursor: busy ? "not-allowed" : "pointer",
      opacity: busy ? 0.6 : 1, flexShrink: 0, whiteSpace: "nowrap",
    }),
    cmdInput: {
      flex: 1, background: "transparent", border: "none", outline: "none",
      color: "#e2e8f0", fontFamily: "var(--font-mono)", fontSize: 11,
      padding: 0, caretColor: "var(--accent)",
    },
    markBtn: (active, color) => ({
      display: "flex", alignItems: "center", gap: 4,
      background: active ? `${color}22` : "rgba(255,255,255,0.04)",
      border: `1px solid ${active ? color : "rgba(255,255,255,0.1)"}`,
      borderRadius: 4, color: active ? color : "var(--muted)",
      fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 700,
      padding: "3px 8px", cursor: "pointer", transition: "all 0.12s", whiteSpace: "nowrap",
    }),
  };

  const logTypeColors = { text: "cyan", chart: "violet" };

  return (
    <div style={{
      background: "#0d1117", border: `1px solid ${expanded ? "rgba(129,140,248,0.25)" : "var(--border)"}`,
      borderRadius: 10, marginBottom: 10, overflow: "hidden", transition: "border-color 0.15s",
    }}>
      {/* ── Header ── */}
      <div
        onClick={() => setExpanded(v => !v)}
        style={{
          display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
          cursor: "pointer", background: expanded ? "rgba(129,140,248,0.04)" : "transparent",
          borderBottom: expanded ? "1px solid rgba(255,255,255,0.07)" : "none",
        }}
      >
        {/* index pill */}
        <span style={{
          fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 700,
          background: "rgba(129,140,248,0.12)", color: "var(--accent)",
          border: "1px solid rgba(129,140,248,0.2)", borderRadius: 4,
          padding: "1px 6px", flexShrink: 0,
        }}>{String(index + 1).padStart(2, "0")}</span>

        {/* log name */}
        <span style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: 12, color: entry.log_name ? "#e2e8f0" : "#374151" }}>
          {entry.log_name || <span style={{ fontStyle: "italic", color: "#374151" }}>unnamed entry</span>}
        </span>

        {/* badges */}
        <Badge color={logTypeColors[entry.log_type] || "default"}>{entry.log_type}</Badge>
        {outputs.collect    && <Badge color="green">collect ✔</Badge>}
        {outputs.activate   && <Badge color="cyan">activate ✔</Badge>}
        {outputs.deactivate && <Badge color="violet">deactivate ✔</Badge>}
        {entry.data_extraction_regex && !reErr && matchCount && (
          <Badge color={matchCount.matched > 0 ? "green" : "red"}>
            {matchCount.matched}/{matchCount.total} lines
          </Badge>
        )}

        <button onClick={e => { e.stopPropagation(); onDuplicate(); }} title="Duplicate"
          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", fontSize: 13, padding: "2px 6px" }}>⎘</button>
        <button onClick={e => { e.stopPropagation(); onRemove(); }} title="Remove"
          style={{ background: "none", border: "none", cursor: "pointer", color: "#f87171", fontSize: 15, padding: "2px 6px" }}>×</button>
        <span style={{ color: "var(--muted)", fontSize: 10 }}>{expanded ? "▲" : "▼"}</span>
      </div>

      {expanded && (
        <div style={{ padding: "14px 16px 16px" }}>

          {/* ── Row 1: Log Name / Type / Data Unit ── */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 10, marginBottom: 14, alignItems: "end" }}>
            <div>
              <div style={FIELD_LABEL}>Log Name *</div>
              <input value={entry.log_name} onChange={e => set("log_name", e.target.value)}
                placeholder="e.g. syslog, cpu_usage" style={inputStyle} />
            </div>
            <div>
              <div style={FIELD_LABEL}>Type</div>
              <div style={{ display: "flex", gap: 4 }}>
                {["text", "chart"].map(t => (
                  <button key={t} onClick={() => set("log_type", t)} style={{
                    padding: "9px 14px", borderRadius: 7, cursor: "pointer", border: "1px solid",
                    fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600,
                    background: entry.log_type === t ? (t === "text" ? "rgba(34,211,238,0.14)" : "rgba(167,139,250,0.14)") : "rgba(255,255,255,0.03)",
                    color: entry.log_type === t ? (t === "text" ? "#22d3ee" : "#a78bfa") : "var(--muted)",
                    borderColor: entry.log_type === t ? (t === "text" ? "rgba(34,211,238,0.4)" : "rgba(167,139,250,0.4)") : "var(--border)",
                    transition: "all 0.12s",
                  }}>{t === "text" ? "📄 text" : "📈 chart"}</button>
                ))}
              </div>
            </div>
            {entry.log_type === "chart" && (
              <div>
                <div style={FIELD_LABEL}>Unit</div>
                <input value={entry.data_unit || ""} onChange={e => set("data_unit", e.target.value)}
                  placeholder="%, °C, ms…" style={{ ...inputStyle, width: 90 }} />
              </div>
            )}
          </div>

          {/* ── Custom Shell Prompt (collapsed inline) ── */}
          <div style={{ marginBottom: 14, display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--muted)", flexShrink: 0 }}>shell prompt</span>
            <input value={entry.custom_shell_prompt || ""}
              onChange={e => set("custom_shell_prompt", e.target.value)}
              placeholder="leave empty for standard exec  ·  e.g. router# or $"
              style={{ ...inputStyle, fontSize: 11, padding: "7px 12px", background: "rgba(255,255,255,0.02)" }} />
          </div>

          {/* ── Terminal Panel ── */}
          <div style={S.terminal}>
            {/* Tab bar */}
            <div style={S.termBar}>
              {/* Traffic lights */}
              <div style={{ display: "flex", gap: 5, marginRight: 12 }}>
                {["#f87171","#fbbf24","#4ade80"].map((c, i) => (
                  <div key={i} style={{ width: 9, height: 9, borderRadius: "50%", background: c, opacity: 0.6 }} />
                ))}
              </div>
              {TABS.map(tab => (
                <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                  style={S.termTab(
                    activeTab === tab.key,
                    outputs[tab.key] != null,
                    !!errors[tab.key],
                  )}>
                  <span>{tab.icon}</span>
                  <span>{tab.label}</span>
                  {running === tab.key && (
                    <svg width="9" height="9" viewBox="0 0 9 9" style={{ animation: "spin 1s linear infinite", flexShrink: 0 }}>
                      <circle cx="4.5" cy="4.5" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="11" strokeDashoffset="5.5" />
                    </svg>
                  )}
                  {outputs[tab.key] != null && running !== tab.key && (
                    <span style={{ fontSize: 9, color: errors[tab.key] ? "#f87171" : "#4ade80" }}>
                      {errors[tab.key] ? "✖" : "✔"}
                    </span>
                  )}
                </button>
              ))}
              <div style={{ flex: 1 }} />
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "#1f2937", paddingRight: 12 }}>
                {conn.user && conn.ip_address ? `${conn.user}@${conn.ip_address}` : "not connected"}
              </span>
            </div>

            {/* Command prompt input line */}
            <div style={S.promptLine}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#4ade80", flexShrink: 0 }}>$</span>
              <input
                value={entry[currentTab.cmdKey] || ""}
                onChange={e => set(currentTab.cmdKey, e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); execCmd(activeTab); } }}
                placeholder={currentTab.hint}
                style={S.cmdInput}
              />
              <button onClick={() => execCmd(activeTab)} disabled={!!running} style={S.runBtn(!!running)}>
                {running === activeTab ? (
                  <><svg width="9" height="9" viewBox="0 0 9 9" style={{ animation: "spin 1s linear infinite" }}>
                    <circle cx="4.5" cy="4.5" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="11" strokeDashoffset="5.5" />
                  </svg> running</>
                ) : "run ↵"}
              </button>
            </div>

            {/* Error bar */}
            {errors[activeTab] && (
              <div style={{
                fontFamily: "var(--font-mono)", fontSize: 11, color: "#f87171",
                background: "rgba(248,113,113,0.07)", borderTop: "1px solid rgba(248,113,113,0.15)",
                padding: "6px 14px",
              }}>⚠ {errors[activeTab]}</div>
            )}

            {/* Output area */}
            {outputs[activeTab] != null ? (
              <TerminalOutput
                lines={outputs[activeTab].split("\n")}
                regex={activeTab === "collect" ? entry.data_extraction_regex : null}
                regexError={reErr}
                onMarkSpan={handleMarkSpan}
                markMode={activeTab === "collect" ? markMode : null}
              />
            ) : (
              <div style={{
                fontFamily: "var(--font-mono)", fontSize: 11, color: "#1f2937",
                padding: "18px 14px", textAlign: "center",
              }}>
                {running === activeTab
                  ? "executing…"
                  : `press run ↵ to test ${activeTab} command`}
              </div>
            )}
          </div>

          {/* ── Regex Builder (only shown when collect has output) ── */}
          {activeTab === "collect" && outputs.collect != null && (
            <div style={{
              marginTop: 10, background: "#0a0d12",
              border: `1px solid ${reErr ? "rgba(248,113,113,0.3)" : "rgba(129,140,248,0.18)"}`,
              borderRadius: 8, padding: "12px 14px",
            }}>
              {/* Header row */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  extraction regex
                </span>
                {matchCount && (
                  <span style={{
                    fontFamily: "var(--font-mono)", fontSize: 10,
                    color: matchCount.matched > 0 ? "#4ade80" : "#f87171",
                    background: matchCount.matched > 0 ? "rgba(74,222,128,0.08)" : "rgba(248,113,113,0.08)",
                    border: `1px solid ${matchCount.matched > 0 ? "rgba(74,222,128,0.2)" : "rgba(248,113,113,0.2)"}`,
                    borderRadius: 4, padding: "2px 7px",
                  }}>
                    {matchCount.matched > 0 ? `✔ ${matchCount.matched}/${matchCount.total} lines matched` : `✖ 0/${matchCount.total} matched`}
                  </span>
                )}
                <div style={{ flex: 1 }} />
                {/* Mark-mode buttons */}
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "#374151" }}>click to mark →</span>
                <button
                  onClick={() => setMarkMode(markMode === "TIME" ? null : "TIME")}
                  style={S.markBtn(markMode === "TIME", "#f59e0b")}
                >
                  {timeSpan ? `TIME: "${timeSpan.text.slice(0,16)}${timeSpan.text.length>16?"…":""}"` : "⏱ mark TIME"}
                </button>
                <button
                  onClick={() => setMarkMode(markMode === "ENTRY" ? null : "ENTRY")}
                  style={S.markBtn(markMode === "ENTRY", "#86efac")}
                >
                  {entrySpan ? `ENTRY: "${entrySpan.text.slice(0,16)}${entrySpan.text.length>16?"…":""}"` : "📌 mark ENTRY"}
                </button>
                {(timeSpan || entrySpan) && (
                  <button onClick={clearSpans} style={{ background: "none", border: "none", color: "#374151", fontFamily: "var(--font-mono)", fontSize: 10, cursor: "pointer", padding: "2px 4px" }}>
                    ✕ clear
                  </button>
                )}
              </div>

              {/* Mark-mode active hint */}
              {markMode && (
                <div style={{
                  fontFamily: "var(--font-mono)", fontSize: 11,
                  color: markMode === "TIME" ? "#f59e0b" : "#86efac",
                  background: markMode === "TIME" ? "rgba(245,158,11,0.08)" : "rgba(134,239,172,0.08)",
                  border: `1px solid ${markMode === "TIME" ? "rgba(245,158,11,0.25)" : "rgba(134,239,172,0.2)"}`,
                  borderRadius: 5, padding: "6px 10px", marginBottom: 8,
                }}>
                  ✦ Select the <strong>{markMode}</strong> portion in the terminal output above, then release.
                  {markMode === "TIME" ? " This will capture the timestamp." : " This will capture the log value/content."}
                </div>
              )}

              {/* Regex input */}
              <input
                value={entry.data_extraction_regex}
                onChange={e => { set("data_extraction_regex", e.target.value); clearSpans(); }}
                placeholder="^(?P<TIME>\\w+\\s+\\d+\\s+\\d+:\\d+:\\d+)\\s+(?P<ENTRY>.*)"
                style={{
                  ...inputStyle,
                  fontFamily: "var(--font-mono)", fontSize: 11,
                  background: "rgba(0,0,0,0.4)",
                  borderColor: reErr ? "rgba(248,113,113,0.5)" : "rgba(129,140,248,0.25)",
                  color: reErr ? "#f87171" : "#a5b4fc",
                }}
              />
              {reErr && (
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "#f87171", marginTop: 5 }}>
                  ⚠ {reErr}
                </div>
              )}
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "#1f2937", marginTop: 5 }}>
                Named groups: <span style={{ color: "#f59e0b" }}>(?P&lt;TIME&gt;…)</span> for timestamp · <span style={{ color: "#86efac" }}>(?P&lt;ENTRY&gt;…)</span> for value
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  );
}

// ── CONFIG BUILDER WIZARD ──────────────────────────────────────────────────────
function ConfigBuilderModal({ open, onClose, onSave }) {
  const [step, setStep] = useState(1); // 1=connection, 2=log entries
  const EMPTY_CONN = () => ({
    device_name: "", ip_address: "", port: 22,
    user: "pi", password: "", ssh_key_string: "", authMode: "password", collection_interval: 30,
    gateways: [],
  });
  const [conn, setConn] = useState(EMPTY_CONN);
  const [entries, setEntries] = useState([EMPTY_LOG_ENTRY()]);
  const [connStatus, setConnStatus] = useState(null); // null | "testing" | {success, message}
  const [saving, setSaving] = useState(false);

  const setC = (k, v) => setConn(prev => ({ ...prev, [k]: v }));

  const testConnection = async () => {
    setConnStatus("testing");
    try {
      const res = await apiFetch("/api/devices/test-connection", {
        method: "POST",
        body: JSON.stringify({
          ip_address: conn.ip_address,
          port: Number(conn.port),
          user: conn.user,
          password: conn.password,
          ssh_key_string: conn.ssh_key_string || "",
          gateways: conn.gateways,
        }),
      });
      setConnStatus(res);
    } catch (e) {
      setConnStatus({ success: false, message: e.message });
    }
  };

  const addEntry = () => setEntries(prev => [...prev, EMPTY_LOG_ENTRY()]);

  const updateEntry = (idx, updated) =>
    setEntries(prev => prev.map((e, i) => i === idx ? updated : e));

  const removeEntry = (idx) =>
    setEntries(prev => prev.filter((_, i) => i !== idx));

  const duplicateEntry = (idx) => {
    const src = entries[idx];
    const clone = { ...src, _id: Math.random().toString(36).slice(2), log_name: src.log_name + "_copy" };
    setEntries(prev => [...prev.slice(0, idx + 1), clone, ...prev.slice(idx + 1)]);
  };

  const buildConfig = () => {
    const log_file_configs = entries.map(({ _id, ...rest }) => {
      // Drop optional keys that were left empty so they don't appear in the config
      const entry = { ...rest };
      if (!entry.log_activation_cmd)   delete entry.log_activation_cmd;
      if (!entry.log_deactivation_cmd) delete entry.log_deactivation_cmd;
      if (!entry.custom_shell_prompt)  delete entry.custom_shell_prompt;
      return entry;
    });
    const config = {
      device_name: conn.device_name || `device-${conn.ip_address}`,
      ip_address: conn.ip_address,
      port: Number(conn.port),
      user: conn.user,
      collection_interval: Number(conn.collection_interval),
      log_file_configs,
    };

    // Include whichever auth method is populated; omit the other if empty
    if (conn.ssh_key_string) config.ssh_key_string = conn.ssh_key_string;
    if (conn.password)       config.password        = conn.password;

    // Convert flat gateways[] → nested { gateway: { ..., gateway: { ... } } }
    // Hops are ordered outermost-first, so fold right-to-left.
    if (conn.gateways && conn.gateways.length > 0) {
      const nested = [...conn.gateways]
        .reverse()
        .reduce((inner, hop) => {
          const hopObj = {
            ip_address: hop.ip_address,
            port: Number(hop.port || 22),
            user: hop.user,
          };
          if (hop.ssh_key_string) hopObj.ssh_key_string = hop.ssh_key_string;
          if (hop.password)       hopObj.password        = hop.password;
          if (inner) hopObj.gateway = inner;
          return hopObj;
        }, null);

      config.gateway = nested;
    }

    return config;
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const config = buildConfig();
      const b64 = btoa(JSON.stringify(config, null, 2));
      await onSave(`data:application/json;base64,${b64}`);
      onClose();
      // Reset
      setStep(1);
      setConn(EMPTY_CONN());
      setEntries([EMPTY_LOG_ENTRY()]);
      setConnStatus(null);
    } finally {
      setSaving(false);
    }
  };

  const downloadConfig = () => {
    const config = buildConfig();
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${conn.device_name || "device"}_config.json`;
    a.click();
  };

  if (!open) return null;

  const step1Valid = conn.ip_address && conn.user && conn.port;
  const step2Valid = entries.length > 0 && entries.every(e => e.log_name && e.log_file_cmd);

  const stepTabStyle = (s) => ({
    display: "flex", alignItems: "center", gap: 9, padding: "12px 24px",
    background: step === s ? "rgba(129,140,248,0.08)" : "transparent",
    border: "none", borderBottom: `2px solid ${step === s ? "var(--accent)" : "transparent"}`,
    color: step === s ? "var(--accent)" : step > s ? "#4ade80" : "var(--muted)",
    fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 13,
    cursor: "pointer", transition: "all 0.15s", letterSpacing: "0.04em",
    opacity: (s === 2 && !step1Valid) ? 0.4 : 1,
  });

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1200, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.8)", backdropFilter: "blur(6px)" }} />
      <div style={{
        position: "relative", zIndex: 1, background: "var(--modal-bg)", border: "1px solid var(--border)",
        borderRadius: 16, width: 1060, maxWidth: "calc(100vw - 32px)",
        maxHeight: "calc(100vh - 40px)", display: "flex", flexDirection: "column",
        boxShadow: "0 32px 96px rgba(0,0,0,0.7), 0 0 0 1px rgba(129,140,248,0.06)",
      }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 28px", borderBottom: "1px solid var(--border)", flexShrink: 0, background: "rgba(129,140,248,0.03)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, background: "linear-gradient(135deg, rgba(129,140,248,0.2) 0%, rgba(167,139,250,0.12) 100%)", border: "1px solid rgba(129,140,248,0.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, boxShadow: "0 2px 8px rgba(129,140,248,0.15)" }}>
              🛠
            </div>
            <div>
              <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 17, color: "var(--text)", letterSpacing: "0.02em" }}>Device Config Builder</div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted)", marginTop: 2 }}>Build and test your configuration interactively</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--muted)", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "5px 9px", transition: "all 0.15s" }}
            onMouseEnter={e => e.currentTarget.style.color = "var(--text)"}
            onMouseLeave={e => e.currentTarget.style.color = "var(--muted)"}
          >×</button>
        </div>

        {/* Step tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <button style={stepTabStyle(1)} onClick={() => setStep(1)}>
            <span style={{ width: 20, height: 20, borderRadius: "50%", background: step > 1 ? "rgba(74,222,128,0.2)" : "rgba(129,140,248,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, color: step > 1 ? "#4ade80" : "var(--accent)" }}>
              {step > 1 ? "✔" : "1"}
            </span>
            Connection
          </button>
          <button style={stepTabStyle(2)} onClick={() => step1Valid && setStep(2)}>
            <span style={{ width: 20, height: 20, borderRadius: "50%", background: "rgba(129,140,248,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, color: "var(--accent)" }}>2</span>
            Log Entries
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--muted)", marginLeft: 4 }}>({entries.length})</span>
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "26px 32px", minHeight: 0 }}>

          {/* ── STEP 1: Connection ── */}
          {step === 1 && (
            <div>
              <div style={CARD}>
                <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 13, color: "var(--text)", marginBottom: 14 }}>Device Identity</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                  <div>
                    <div style={FIELD_LABEL}>Device Name *</div>
                    <input value={conn.device_name} onChange={e => setC("device_name", e.target.value)}
                      placeholder="Raspberry-PI-Zero" style={inputStyle} />
                  </div>
                  <div>
                    <div style={FIELD_LABEL}>Collection Interval (sec)</div>
                    <input type="number" value={conn.collection_interval} onChange={e => setC("collection_interval", e.target.value)}
                      min={5} style={inputStyle} />
                  </div>
                </div>
              </div>

              <div style={CARD}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                  <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 13, color: "var(--text)" }}>SSH Credentials</div>
                  {/* Auth mode toggle */}
                  <div style={{ display: "flex", gap: 0, borderRadius: 7, border: "1px solid var(--border)", overflow: "hidden" }}>
                    {["password", "key"].map(mode => (
                      <button key={mode} onClick={() => setC("authMode", mode)} style={{
                        padding: "5px 14px", border: "none", cursor: "pointer",
                        fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600,
                        background: conn.authMode === mode ? "rgba(129,140,248,0.18)" : "transparent",
                        color: conn.authMode === mode ? "var(--accent)" : "var(--muted)",
                        transition: "all 0.12s",
                      }}>
                        {mode === "password" ? "🔑 Password" : "📄 SSH Key"}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 14, marginBottom: 12 }}>
                  <div>
                    <div style={FIELD_LABEL}>IP Address *</div>
                    <input value={conn.ip_address} onChange={e => setC("ip_address", e.target.value)}
                      placeholder="10.01.230.23" style={inputStyle} />
                  </div>
                  <div>
                    <div style={FIELD_LABEL}>Port</div>
                    <input type="number" value={conn.port} onChange={e => setC("port", e.target.value)}
                      style={{ ...inputStyle, width: 80 }} />
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: conn.authMode === "key" ? 12 : 0 }}>
                  <div>
                    <div style={FIELD_LABEL}>Username *</div>
                    <input value={conn.user} onChange={e => setC("user", e.target.value)}
                      placeholder="pi" style={inputStyle} />
                  </div>
                  {conn.authMode === "password" ? (
                    <div>
                      <div style={FIELD_LABEL}>Password</div>
                      <input type="password" value={conn.password} onChange={e => setC("password", e.target.value)}
                        placeholder="••••••••" style={inputStyle} />
                    </div>
                  ) : (
                    <div style={{ display: "flex", alignItems: "flex-end" }}>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--muted)", padding: "10px 0 10px 2px", letterSpacing: "0.04em" }}>
                        Paste the private key below
                      </div>
                    </div>
                  )}
                </div>
                {conn.authMode === "key" && (
                  <div style={{ marginBottom: 0 }}>
                    <div style={FIELD_LABEL}>Private Key (PEM)</div>
                    <textarea
                      value={conn.ssh_key_string}
                      onChange={e => setC("ssh_key_string", e.target.value)}
                      placeholder={"-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----"}
                      rows={6}
                      style={{
                        ...inputStyle,
                        fontFamily: "var(--font-mono)", fontSize: 11, lineHeight: 1.6,
                        resize: "vertical", minHeight: 110,
                        whiteSpace: "pre", overflowX: "auto",
                      }}
                    />
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--muted)", marginTop: 5 }}>
                      Paste the full contents of your private key file (e.g. <span style={{ color: "var(--accent)" }}>~/.ssh/id_rsa</span>)
                    </div>
                  </div>
                )}

                {/* Test connection */}
                <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <button
                    onClick={testConnection}
                    disabled={!step1Valid || connStatus === "testing"}
                    style={{
                      display: "flex", alignItems: "center", gap: 7,
                      background: "rgba(129,140,248,0.1)", border: "1px solid rgba(129,140,248,0.3)",
                      borderRadius: 8, color: "var(--accent)", fontFamily: "var(--font-mono)",
                      fontSize: 12, padding: "8px 16px", cursor: (!step1Valid || connStatus === "testing") ? "not-allowed" : "pointer",
                      opacity: !step1Valid ? 0.5 : 1, transition: "all 0.15s",
                    }}
                  >
                    {connStatus === "testing" ? (
                      <><svg width="11" height="11" viewBox="0 0 11 11" style={{ animation: "spin 1s linear infinite" }}>
                        <circle cx="5.5" cy="5.5" r="4.5" fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeDasharray="14" strokeDashoffset="7" />
                      </svg> Testing…</>
                    ) : "🔌 Test Connection"}
                  </button>

                  {connStatus && connStatus !== "testing" && (
                    <div style={{
                      display: "flex", alignItems: "center", gap: 7,
                      fontFamily: "var(--font-mono)", fontSize: 12,
                      color: connStatus.success ? "#4ade80" : "#f87171",
                      background: connStatus.success ? "rgba(74,222,128,0.08)" : "rgba(248,113,113,0.08)",
                      border: `1px solid ${connStatus.success ? "rgba(74,222,128,0.25)" : "rgba(248,113,113,0.25)"}`,
                      borderRadius: 7, padding: "7px 13px",
                    }}>
                      {connStatus.success ? "✔" : "✖"} {connStatus.message}
                    </div>
                  )}
                </div>
              </div>

              {/* ── Gateway Hops ── */}
              <div style={CARD}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <div>
                    <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 13, color: "var(--text)" }}>SSH Gateway Hops</div>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--muted)", marginTop: 3 }}>
                      Optional jump hosts. Hops are chained left-to-right: hop 1 → hop 2 → … → target device.
                    </div>
                  </div>
                  <button
                    onClick={() => setC("gateways", [...(conn.gateways || []), { _id: Math.random().toString(36).slice(2), ip_address: "", port: 22, user: "", password: "", ssh_key_string: "", authMode: "password" }])}
                    style={{ background: "rgba(129,140,248,0.1)", border: "1px solid rgba(129,140,248,0.3)", borderRadius: 7, color: "var(--accent)", fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 700, padding: "5px 12px", cursor: "pointer", whiteSpace: "nowrap" }}
                  >
                    + Add Hop
                  </button>
                </div>

                {(!conn.gateways || conn.gateways.length === 0) && (
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted)", textAlign: "center", padding: "10px 0", border: "1px dashed var(--border)", borderRadius: 7 }}>
                    No gateway hops — direct connection to target device.
                  </div>
                )}

                {(conn.gateways || []).map((hop, hi) => {
                  const setHop = (k, v) => {
                    const updated = conn.gateways.map((h, i) => i === hi ? { ...h, [k]: v } : h);
                    setC("gateways", updated);
                  };
                  const removeHop = () => setC("gateways", conn.gateways.filter((_, i) => i !== hi));
                  const moveUp    = () => { if (hi === 0) return; const g = [...conn.gateways]; [g[hi-1], g[hi]] = [g[hi], g[hi-1]]; setC("gateways", g); };
                  const moveDown  = () => { if (hi === conn.gateways.length - 1) return; const g = [...conn.gateways]; [g[hi], g[hi+1]] = [g[hi+1], g[hi]]; setC("gateways", g); };
                  return (
                    <div key={hop._id} style={{ marginBottom: 10, background: "rgba(0,0,0,0.18)", border: "1px solid var(--border)", borderRadius: 8, padding: "12px 14px" }}>
                      {/* Hop header */}
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--accent)", background: "rgba(129,140,248,0.12)", border: "1px solid rgba(129,140,248,0.25)", borderRadius: 4, padding: "2px 7px", fontWeight: 700 }}>
                          HOP {hi + 1}
                        </span>
                        {hop.ip_address && (
                          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted)" }}>
                            {hop.user ? `${hop.user}@` : ""}{hop.ip_address}:{hop.port || 22}
                          </span>
                        )}
                        <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                          <button onClick={moveUp}   disabled={hi === 0}                        title="Move up"   style={{ background: "none", border: "none", color: hi === 0 ? "var(--border)" : "var(--muted)", cursor: hi === 0 ? "default" : "pointer", fontSize: 13, padding: "2px 5px" }}>▲</button>
                          <button onClick={moveDown} disabled={hi === conn.gateways.length - 1} title="Move down" style={{ background: "none", border: "none", color: hi === conn.gateways.length - 1 ? "var(--border)" : "var(--muted)", cursor: hi === conn.gateways.length - 1 ? "default" : "pointer", fontSize: 13, padding: "2px 5px" }}>▼</button>
                          <button onClick={removeHop} title="Remove" style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer", fontSize: 15, padding: "2px 5px" }}>×</button>
                        </div>
                      </div>
                      {/* Hop fields */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 70px 1fr 1fr", gap: 10, marginBottom: hop.authMode === "key" ? 10 : 0 }}>
                        <div>
                          <div style={FIELD_LABEL}>IP Address</div>
                          <input value={hop.ip_address} onChange={e => setHop("ip_address", e.target.value)} placeholder="10.0.1.1" style={inputStyle} />
                        </div>
                        <div>
                          <div style={FIELD_LABEL}>Port</div>
                          <input type="number" value={hop.port || 22} onChange={e => setHop("port", e.target.value)} style={inputStyle} />
                        </div>
                        <div>
                          <div style={FIELD_LABEL}>Username</div>
                          <input value={hop.user} onChange={e => setHop("user", e.target.value)} placeholder="admin" style={inputStyle} />
                        </div>
                        <div>
                          <div style={{ ...FIELD_LABEL, display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5 }}>
                            <span>Auth</span>
                            <div style={{ display: "flex", gap: 0, borderRadius: 5, border: "1px solid var(--border)", overflow: "hidden" }}>
                              {["password", "key"].map(mode => (
                                <button key={mode} onClick={() => setHop("authMode", mode)} style={{
                                  padding: "2px 9px", border: "none", cursor: "pointer",
                                  fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600,
                                  background: hop.authMode === mode ? "rgba(129,140,248,0.18)" : "transparent",
                                  color: hop.authMode === mode ? "var(--accent)" : "var(--muted)",
                                  transition: "all 0.12s",
                                }}>{mode === "password" ? "pwd" : "key"}</button>
                              ))}
                            </div>
                          </div>
                          {hop.authMode !== "key" ? (
                            <input type="password" value={hop.password} onChange={e => setHop("password", e.target.value)} placeholder="••••••" style={inputStyle} />
                          ) : (
                            <input value="(key set below)" readOnly style={{ ...inputStyle, color: "var(--accent)", cursor: "default", opacity: 0.7 }} />
                          )}
                        </div>
                      </div>
                      {hop.authMode === "key" && (
                        <div>
                          <div style={FIELD_LABEL}>Private Key (PEM)</div>
                          <textarea
                            value={hop.ssh_key_string}
                            onChange={e => setHop("ssh_key_string", e.target.value)}
                            placeholder={"-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----"}
                            rows={4}
                            style={{
                              ...inputStyle,
                              fontFamily: "var(--font-mono)", fontSize: 11, lineHeight: 1.6,
                              resize: "vertical", minHeight: 80,
                              whiteSpace: "pre", overflowX: "auto",
                            }}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}

                {(conn.gateways || []).length > 0 && (
                  <div style={{ marginTop: 8, fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--muted)", display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ color: "var(--accent)" }}>→</span>
                    {(conn.gateways || []).map((h, i) => (
                      <span key={i}>{h.ip_address || `hop${i+1}`}{i < conn.gateways.length - 1 ? " → " : ""}</span>
                    ))}
                    <span style={{ color: "var(--accent)" }}> → {conn.ip_address || "target"}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── STEP 2: Log Entries ── */}
          {step === 2 && (
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted)" }}>
                  {entries.length} log entr{entries.length === 1 ? "y" : "ies"} · Click ▶ Run on Device to test each command live
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={() => {
                      // Add a set of common Raspberry Pi log entries as a template
                      setEntries(prev => [...prev,
                        { _id: Math.random().toString(36).slice(2), log_name: "syslog", log_file_cmd: "sudo journalctl -n 200 --no-pager", data_extraction_regex: "^(?P<TIME>\\w+\\s+\\d+\\s+\\d+:\\d+:\\d+)\\s+(?P<ENTRY>.*)", log_activation_cmd: "ls -la", log_type: "text", data_unit: "" },
                        { _id: Math.random().toString(36).slice(2), log_name: "cpu_usage_percent", log_file_cmd: "echo $(date '+%Y-%m-%d %H:%M:%S'),$(top -bn1 | grep 'Cpu(s)' | awk '{print 100-$8}')", data_extraction_regex: "^(?P<TIME>\\d+-\\d+-\\d+\\s\\d+:\\d+:\\d+),(?P<ENTRY>.*)", log_activation_cmd: "true", log_type: "chart", data_unit: "%" },
                      ]);
                    }}
                    style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", borderRadius: 7, color: "var(--muted)", fontFamily: "var(--font-mono)", fontSize: 11, padding: "6px 12px", cursor: "pointer" }}
                  >
                    + Add Templates
                  </button>
                  <button
                    onClick={addEntry}
                    style={{ background: "rgba(129,140,248,0.1)", border: "1px solid rgba(129,140,248,0.3)", borderRadius: 7, color: "var(--accent)", fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 700, padding: "6px 14px", cursor: "pointer" }}
                  >
                    + Add Entry
                  </button>
                </div>
              </div>

              {entries.map((entry, idx) => (
                <LogEntryEditor
                  key={entry._id}
                  entry={entry}
                  conn={{ ip_address: conn.ip_address, port: Number(conn.port), user: conn.user, password: conn.password, gateways: conn.gateways || [] }}
                  index={idx}
                  onChange={updated => updateEntry(idx, updated)}
                  onRemove={() => removeEntry(idx)}
                  onDuplicate={() => duplicateEntry(idx)}
                />
              ))}

              {entries.length === 0 && (
                <div style={{ padding: "32px", textAlign: "center", border: "1px dashed var(--border)", borderRadius: 10, color: "var(--muted)", fontFamily: "var(--font-mono)", fontSize: 12 }}>
                  No entries yet. Click "+ Add Entry" to get started.
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ borderTop: "1px solid var(--border)", padding: "16px 28px", display: "flex", gap: 10, justifyContent: "space-between", alignItems: "center", flexShrink: 0, background: "rgba(0,0,0,0.12)" }}>
          <div style={{ display: "flex", gap: 8 }}>
            {step === 2 && (
              <button
                onClick={downloadConfig}
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", borderRadius: 7, color: "var(--muted)", fontFamily: "var(--font-mono)", fontSize: 12, padding: "8px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
              >
                ⬇ Download JSON
              </button>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {step === 1 && (
              <Btn variant="primary" onClick={() => setStep(2)} disabled={!step1Valid}>
                Next: Log Entries →
              </Btn>
            )}
            {step === 2 && (
              <>
                <Btn variant="ghost" onClick={() => setStep(1)}>← Back</Btn>
                <Btn variant="success" onClick={handleSave} disabled={saving || !step2Valid}>
                  {saving ? "Saving…" : "💾 Save Device"}
                </Btn>
              </>
            )}
            <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── ADD DEVICE BUTTON + CHOICE MODAL ──────────────────────────────────────────
function AddDeviceBtn({ onUpload, onBuildConfig }) {
  const [choiceOpen, setChoiceOpen] = useState(false);
  const fileRef = useRef();

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => { onUpload(ev.target.result); setChoiceOpen(false); };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  return (
    <>
      <input ref={fileRef} type="file" accept=".json" style={{ display: "none" }} onChange={handleFile} />
      <Btn variant="primary" onClick={() => setChoiceOpen(true)}>＋ Add Device</Btn>

      {choiceOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={e => { if (e.target === e.currentTarget) setChoiceOpen(false); }}>
          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(5px)" }} />
          <div style={{
            position: "relative", zIndex: 1,
            background: "var(--modal-bg)", border: "1px solid var(--border)", borderRadius: 16,
            padding: "32px 28px", width: 480, maxWidth: "calc(100vw - 32px)",
            boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
          }}>
            <div style={{ textAlign: "center", marginBottom: 28 }}>
              <div style={{
                width: 52, height: 52, borderRadius: "50%", margin: "0 auto 16px",
                background: "rgba(129,140,248,0.12)", border: "1px solid rgba(129,140,248,0.3)",
                display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24,
              }}>＋</div>
              <h3 style={{ margin: "0 0 6px", fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 18, color: "var(--text)", letterSpacing: "-0.01em" }}>
                Add Device
              </h3>
              <p style={{ margin: 0, fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--muted)", lineHeight: 1.6 }}>
                Choose how you'd like to configure the device.
              </p>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              {/* Upload option */}
              <button
                onClick={() => fileRef.current.click()}
                style={{
                  background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)",
                  borderRadius: 12, padding: "22px 16px", cursor: "pointer", textAlign: "center",
                  transition: "all 0.18s",
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(129,140,248,0.4)"; e.currentTarget.style.background = "rgba(129,140,248,0.06)"; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}
              >
                <div style={{ fontSize: 32, marginBottom: 12 }}>📄</div>
                <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 14, color: "var(--text)", marginBottom: 6 }}>
                  Upload JSON
                </div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted)", lineHeight: 1.55 }}>
                  Import an existing device configuration file
                </div>
              </button>

              {/* Builder option */}
              <button
                onClick={() => { setChoiceOpen(false); onBuildConfig(); }}
                style={{
                  background: "rgba(129,140,248,0.06)", border: "1px solid rgba(129,140,248,0.25)",
                  borderRadius: 12, padding: "22px 16px", cursor: "pointer", textAlign: "center",
                  transition: "all 0.18s",
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(129,140,248,0.55)"; e.currentTarget.style.background = "rgba(129,140,248,0.12)"; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(129,140,248,0.25)"; e.currentTarget.style.background = "rgba(129,140,248,0.06)"; }}
              >
                <div style={{ fontSize: 32, marginBottom: 12 }}>🛠</div>
                <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 14, color: "var(--accent)", marginBottom: 6 }}>
                  Build Config
                </div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted)", lineHeight: 1.55 }}>
                  Interactive wizard with live command testing
                </div>
              </button>
            </div>

            <button
              onClick={() => setChoiceOpen(false)}
              style={{ display: "block", width: "100%", marginTop: 18, background: "transparent", border: "none", color: "var(--muted)", fontFamily: "var(--font-mono)", fontSize: 12, cursor: "pointer", padding: "6px 0" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
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
 * The backend may take up to 300 s (teardown timeout) before it responds,
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

function CollectionLoadingOverlay({ open, saved, expected }) {
  const [msgIdx, setMsgIdx] = useState(0);

  useEffect(() => {
    if (!open) { setMsgIdx(0); return; }
    const id = setInterval(() => setMsgIdx((i) => (i + 1) % STOP_MESSAGES.length), 2200);
    return () => clearInterval(id);
  }, [open]);

  if (!open) return null;

  const pct = expected > 0 ? Math.min(100, Math.round((saved / expected) * 100)) : null;

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
        @keyframes lo-bar    { from{opacity:0;transform:scaleX(0)} to{opacity:1;transform:scaleX(1)} }
        .lo-dot:nth-child(1){animation-delay:0s}
        .lo-dot:nth-child(2){animation-delay:0.2s}
        .lo-dot:nth-child(3){animation-delay:0.4s}
      `}</style>

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 24, width: 320 }}>

        {/* Animated concentric rings + logo */}
        <div style={{ position: "relative", width: 96, height: 96 }}>
          <svg width="96" height="96" style={{ position: "absolute", inset: 0, animation: "lo-spin 3s linear infinite" }}>
            <circle cx="48" cy="48" r="44" fill="none" stroke="rgba(129,140,248,0.18)" strokeWidth="2" strokeDasharray="40 8 20 8" />
          </svg>
          <svg width="96" height="96" style={{ position: "absolute", inset: 0, animation: "lo-rspin 2s linear infinite" }}>
            <circle cx="48" cy="48" r="34" fill="none" stroke="rgba(129,140,248,0.3)" strokeWidth="2.5" strokeDasharray="30 6" />
          </svg>
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", animation: "lo-pulse 1.6s ease-in-out infinite", filter: "drop-shadow(0 0 12px rgba(129,140,248,0.45))" }}>
            <svg width="36" height="36" viewBox="0 0 36 36">
              <circle cx="18" cy="18" r="17" fill="none" stroke="#818cf8" strokeWidth="1.5" />
              <circle cx="18" cy="18" r="6" fill="#818cf8" />
              {[0, 45, 90, 135, 180, 225, 270, 315].map((a, i) => {
                const rad = (a * Math.PI) / 180;
                return <line key={i} x1={18 + 7 * Math.cos(rad)} y1={18 + 7 * Math.sin(rad)} x2={18 + 15 * Math.cos(rad)} y2={18 + 15 * Math.sin(rad)} stroke="#818cf8" strokeWidth="1.8" strokeLinecap="round" />;
              })}
            </svg>
          </div>
        </div>

        {/* Title */}
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 17, color: "var(--text)", letterSpacing: "-0.01em" }}>
          Stopping Collection
        </div>

        {/* Progress bar */}
        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 8 }}>
          {/* Bar track */}
          <div style={{ width: "100%", height: 6, borderRadius: 99, background: "rgba(255,255,255,0.07)", overflow: "hidden", position: "relative" }}>
            {pct !== null ? (
              <div style={{
                height: "100%",
                width: `${pct}%`,
                borderRadius: 99,
                background: pct === 100
                  ? "linear-gradient(90deg, #4ade80, #34d399)"
                  : "linear-gradient(90deg, #818cf8, #a78bfa)",
                transition: "width 0.6s cubic-bezier(0.4,0,0.2,1)",
                boxShadow: pct === 100
                  ? "0 0 8px rgba(74,222,128,0.5)"
                  : "0 0 8px rgba(129,140,248,0.45)",
              }} />
            ) : (
              /* Indeterminate shimmer when no expected count */
              <div style={{
                position: "absolute", inset: 0,
                background: "linear-gradient(90deg, transparent 0%, rgba(129,140,248,0.5) 50%, transparent 100%)",
                animation: "lo-shimmer 1.6s ease-in-out infinite",
              }} />
            )}
          </div>
          <style>{`@keyframes lo-shimmer { 0%{transform:translateX(-100%)} 100%{transform:translateX(200%)} }`}</style>

          {/* Counts row */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted)" }}>
              {saved > 0 ? (
                <><span style={{ color: pct === 100 ? "#4ade80" : "var(--accent)", fontWeight: 600 }}>{saved}</span>
                {expected > 0 ? ` / ${expected} snapshot${expected !== 1 ? "s" : ""} saved` : ` snapshot${saved !== 1 ? "s" : ""} saved`}</>
              ) : (
                "Waiting for snapshots…"
              )}
            </span>
            {pct !== null && (
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: pct === 100 ? "#4ade80" : "var(--accent)", fontWeight: 600 }}>
                {pct}%
              </span>
            )}
          </div>
        </div>

        {/* Cycling status message */}
        <div key={msgIdx} style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--accent)", animation: "lo-fadein 0.35s ease", minHeight: 18, textAlign: "center" }}>
          {STOP_MESSAGES[msgIdx]}
        </div>

        {/* Bouncing dots */}
        <div style={{ display: "flex", gap: 7 }}>
          {[0,1,2].map(i => (
            <div key={i} className="lo-dot" style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--accent)", animation: "lo-dot 1.2s ease-in-out infinite" }} />
          ))}
        </div>

        {/* Subtle disclaimer */}
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--muted)", maxWidth: 280, textAlign: "center", lineHeight: 1.6 }}>
          Waiting for device teardown — this may take up to 5 min.
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
  // Device groups: { id, name, deviceIds[] }
  const [groups, setGroups] = useState(() => {
    try { return JSON.parse(localStorage.getItem("lo_device_groups") || "[]"); } catch { return []; }
  });
  const [collapsedGroups, setCollapsedGroups] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem("lo_collapsed_groups") || "[]")); } catch { return new Set(); }
  });
  const [newGroupName, setNewGroupName] = useState("");
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [snapshots,       setSnapshots]       = useState([]);
  const [snapsLoading,    setSnapsLoading]    = useState(true);
  const [selectedSnaps,   setSelectedSnaps]   = useState([]);
  const [isChart,         setIsChart]         = useState(false);
  const [searchParam,     setSearchParam]     = useState("");
  const [searchValue,     setSearchValue]     = useState("");
  const [filterActive,    setFilterActive]    = useState(false);

  // stop-collection loading overlay
  const [stoppingCollection, setStoppingCollection] = useState(false);
  const [stopProgress, setStopProgress] = useState({ saved: 0, expected: 0, sessionId: "" });

  // modals
  const [logModal,        setLogModal]        = useState(false);
  const [logRows,         setLogRows]         = useState([]);
  const [chartGroups,     setChartGroups]     = useState([]); // [{ snapInfo, rows }]
  const [logRowsLoading,  setLogRowsLoading]  = useState(false);
  const [colorMode,       setColorMode]       = useState(false);
  const [deviceModal,     setDeviceModal]     = useState(null);
  const [sessionModal,    setSessionModal]    = useState(null);
  const [apiModal,        setApiModal]        = useState(false);
  const [builderModal,    setBuilderModal]    = useState(false);
  const [loginModal,              setLoginModal]              = useState(false);
  const [settingsModal,           setSettingsModal]           = useState(false);
  const [scenarioModal,           setScenarioModal]           = useState(false);
  const [scenarioInput,           setScenarioInput]           = useState("");
  const [scenarioError,           setScenarioError]           = useState(false);
  const [downloadingSnaps,        setDownloadingSnaps]        = useState(false);

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

  useEffect(() => {
    localStorage.setItem("lo_device_groups", JSON.stringify(groups));
  }, [groups]);

  useEffect(() => {
    localStorage.setItem("lo_collapsed_groups", JSON.stringify([...collapsedGroups]));
  }, [collapsedGroups]);

  const toggleGroupCollapse = (groupId) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  // ── group helpers ──────────────────────────────────────────────────────────
  const createGroup = () => {
    const name = newGroupName.trim();
    if (!name) return;
    const taken = [
      ...groups.map(g => g.name.toLowerCase()),
      ...devices.map(d => d.name.toLowerCase()),
    ];
    if (taken.includes(name.toLowerCase())) {
      addToast(`Name "${name}" is already in use by a device or group.`);
      return;
    }
    setGroups(prev => [...prev, { id: Date.now().toString(36), name, deviceIds: [] }]);
    setNewGroupName("");
    setCreatingGroup(false);
  };

  const deleteGroup = (groupId) =>
    setGroups(prev => prev.filter(g => g.id !== groupId));

  const renameGroup = (groupId, name) => {
    const nameLower = name.toLowerCase();
    const taken = [
      ...groups.filter(g => g.id !== groupId).map(g => g.name.toLowerCase()),
      ...devices.map(d => d.name.toLowerCase()),
    ];
    if (taken.includes(nameLower)) {
      addToast(`Name "${name}" is already in use by a device or group.`);
      return false;
    }
    setGroups(prev => prev.map(g => g.id === groupId ? { ...g, name } : g));
    return true;
  };

  // Move a device into a group (removes from other groups first)
  const moveDeviceToGroup = (deviceId, targetGroupId) => {
    setGroups(prev => prev.map(g => {
      if (g.id === targetGroupId) {
        return { ...g, deviceIds: g.deviceIds.includes(deviceId) ? g.deviceIds : [...g.deviceIds, deviceId] };
      }
      return { ...g, deviceIds: g.deviceIds.filter(id => id !== deviceId) };
    }));
  };

  // Reorder a device within its group: move srcId to be placed before destId
  const reorderDeviceInGroup = (groupId, srcId, destId) => {
    setGroups(prev => prev.map(g => {
      if (g.id !== groupId) return g;
      const ids = g.deviceIds.filter(id => id !== srcId);
      const destIdx = ids.indexOf(destId);
      if (destIdx === -1) return { ...g, deviceIds: [...ids, srcId] };
      ids.splice(destIdx, 0, srcId);
      return { ...g, deviceIds: ids };
    }));
  };

  // Remove a device from all groups
  const removeDeviceFromGroups = (deviceId) =>
    setGroups(prev => prev.map(g => ({ ...g, deviceIds: g.deviceIds.filter(id => id !== deviceId) })));

  // Devices not in any group
  const ungroupedDevices = devices.filter(d => !groups.some(g => g.deviceIds.includes(d.id)));

  // Device names visible in non-collapsed groups (used to filter snapshots table)
  const visibleDeviceNames = new Set(
    devices
      .filter(d => {
        const ownerGroup = groups.find(g => g.deviceIds.includes(d.id));
        // Ungrouped devices are always visible; grouped devices only if group not collapsed
        return !ownerGroup || !collapsedGroups.has(ownerGroup.id);
      })
      .map(d => d.name)
  );

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
      // Decode name from config to check for conflicts before hitting the API
      const raw = contents.includes(",") ? contents.split(",")[1] : contents;
      const parsed = JSON.parse(atob(raw));
      const { device } = await apiFetch("/api/devices", { method: "POST", body: JSON.stringify({ contents }) });
      setDevices((prev) => [...prev, device]);
      addToast("Device added successfully.", "success");
    } catch (e) {
      addToast(e.status === 422 ? "Incorrect config file — could not parse device configuration." : `Upload failed: ${e.message}`);
    }
  };

  const toggleDevice = (id, checked) =>
    setSelectedDevices((prev) => (checked ? [...prev, id] : prev.filter((x) => x !== id)));

  const selectAllInGroup = (ids, checked) =>
    setSelectedDevices(prev =>
      checked
        ? [...new Set([...prev, ...ids])]
        : prev.filter(x => !ids.includes(x))
    );

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
    const selectedDevObjs = devices.filter((d) => selectedDevices.includes(d.id));
    const names = selectedDevObjs.map((d) => d.name);
    const runningDev = selectedDevObjs.find((d) => d.collecting);
    const session_id = runningDev?.config?.current_session_id || "";

    // Estimate expected snapshots: sum of log_file_configs entries across selected collecting devices
    const expected = selectedDevObjs.reduce((sum, d) => {
      const cfgs = d.config?.log_file_configs;
      return sum + (Array.isArray(cfgs) ? cfgs.length : 1);
    }, 0);

    setStopProgress({ saved: 0, expected, sessionId: session_id });
    setStoppingCollection(true);

    // Poll snapshot count for this session while backend tears down
    let pollId = null;
    const pollSaved = async () => {
      try {
        const url = session_id
          ? `/api/snapshots?log_type=text&search_param=Session%20ID&search_value=${session_id}`
          : `/api/snapshots?log_type=text`;
        const snaps = await apiFetch(url);
        // Count both text and chart snapshots produced so far
        const chartUrl = session_id
          ? `/api/snapshots?log_type=chart&search_param=Session%20ID&search_value=${session_id}`
          : `/api/snapshots?log_type=chart`;
        const chartSnaps = await apiFetch(chartUrl);
        const total = (snaps?.length || 0) + (chartSnaps?.length || 0);
        setStopProgress(prev => ({ ...prev, saved: total }));
      } catch { /* ignore poll errors */ }
    };
    pollId = setInterval(pollSaved, 1500);

    try {
      const result = await apiFetch("/api/stop-logs-collection", { method: "POST", body: JSON.stringify({ selected_devices: names, session_id }) });
      clearInterval(pollId);
      // Final poll to get accurate count
      await pollSaved();
      setSessionModal({ sessionId: result.session_id, textUrl: result.text_logs_url, chartUrl: result.chart_logs_url });
      fetchDevices();
      fetchSnapshots(filterActive ? searchParam : "", filterActive ? searchValue : "", isChart);
    } catch (e) {
      clearInterval(pollId);
      addToast(`Failed to stop collection: ${e.message}`);
    } finally {
      setStoppingCollection(false);
      setStopProgress({ saved: 0, expected: 0, sessionId: "" });
    }
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
        const merged = results.flatMap((r) =>
          r.rows.map((row) => ({ ...row, device_name: r.snapInfo.deviceName ?? r.snapInfo.device_name ?? "" }))
        );
        // Sort all text entries by timestamp ascending
        merged.sort((a, b) => {
          const ta = a.timestamp || a.time || "";
          const tb = b.timestamp || b.time || "";
          return ta < tb ? -1 : ta > tb ? 1 : 0;
        });
        setLogRows(merged);
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

  const downloadLogs = (format = "html-color") => {
    if (isChart) {
      const palette = ["#818cf8","#34d399","#fb923c","#f472b6","#60a5fa","#a78bfa","#facc15","#2dd4bf","#f87171","#c084fc"];

      if (format === "json") {
        const data = chartGroups.map((g) => ({
          device: g.snapInfo.deviceName,
          log_name: g.snapInfo.logName,
          session_id: g.snapInfo.sessionId,
          data_unit: g.snapInfo.dataUnit || "",
          rows: g.rows,
        }));
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "chart_data.json";
        a.click();
        addToast("Chart data exported as JSON.", "success");

      } else {
        const chartSections = chartGroups.map((g, i) => {
          const color = palette[i % palette.length];
          const label = `${g.snapInfo.deviceName} — ${g.snapInfo.logName}`;
          const unit  = g.snapInfo.dataUnit || "";
          const xs    = g.rows.map(d => d.time);
          const ys    = g.rows.map(d => parseFloat(d.content));
          const isNum = ys.some(v => !isNaN(v));
          return `
  <div class="chart-wrap">
    <div id="chart-${i}" class="chart"></div>
    <div class="badges">
      <span class="badge" style="border-color:${color};color:${color};background:${color}18">${g.snapInfo.logName}</span>
      <span class="badge">${g.snapInfo.deviceName}</span>
      <span class="badge">${g.rows.length} points${unit ? " · " + unit : ""}</span>
      <span class="badge">Session: ${g.snapInfo.sessionId}</span>
    </div>
  </div>
  <script>
    Plotly.newPlot('chart-${i}',
      [{ x: ${JSON.stringify(xs)}, y: ${JSON.stringify(isNum ? ys : g.rows.map(d => d.content))},
         type:'scatter', mode:'lines+markers', name:${JSON.stringify(label)},
         line:{color:'${color}',width:2.5,shape:'spline',smoothing:0.8},
         marker:{size:5,color:'${color}'},
         hovertemplate: ${unit ? `'<b>%{y} ${unit}<extra></extra>'` : "'<b>%{y}<extra></extra>'"} }],
      { title:{text:${JSON.stringify(label)},font:{color:'#e8eaf0',size:13,family:'JetBrains Mono,monospace'},x:0.04},
        paper_bgcolor:'transparent', plot_bgcolor:'rgba(9,9,15,0.6)',
        font:{color:'#6b7280',family:'JetBrains Mono,monospace',size:11},
        xaxis:{gridcolor:'rgba(255,255,255,0.06)',tickfont:{color:'#6b7280',size:10}},
        yaxis:{gridcolor:'rgba(255,255,255,0.06)',tickfont:{color:'#6b7280',size:10}${unit ? `,title:{text:'${unit}',font:{color:'#6b7280',size:11}}` : ""}},
        margin:{t:40,r:20,b:48,l:56}, hovermode:'x unified',
        hoverlabel:{bgcolor:'#111827',bordercolor:'${color}',font:{color:'#e8eaf0',size:12}} },
      { responsive:true, displayModeBar:true, displaylogo:false }
    );
  <\/script>`;
        }).join("\n");

        const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>LogOctopus — Chart Export</title>
<script src="https://cdn.plot.ly/plotly-2.32.0.min.js"><\/script>
<style>
  body{font-family:'JetBrains Mono',monospace;background:#09090f;color:#e4e4f0;margin:0;padding:24px}
  h1{font-size:16px;color:#818cf8;margin-bottom:20px}
  .chart-wrap{margin-bottom:32px;border:1px solid rgba(255,255,255,0.07);border-radius:10px;overflow:hidden;background:#12121f}
  .chart{width:100%;height:300px}
  .badges{display:flex;flex-wrap:wrap;gap:6px;padding:10px 14px;border-top:1px solid rgba(255,255,255,0.06)}
  .badge{font-size:11px;padding:2px 10px;border-radius:12px;border:1px solid rgba(255,255,255,0.12);color:#6b7280;background:rgba(255,255,255,0.04)}
</style>
</head>
<body>
<h1>LogOctopus — Chart Export (${new Date().toISOString()})</h1>
${chartSections}
</body>
</html>`;
        const blob = new Blob([html], { type: "text/html" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "charts.html";
        a.click();
        addToast(`${chartGroups.length} chart(s) exported as HTML.`, "success");
      }
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

    } else if (format === "html" || format === "html-color") {
      const palette = ["#818cf8","#34d399","#fb923c","#f472b6","#60a5fa","#a78bfa","#facc15","#2dd4bf","#f87171","#c084fc"];
      // Build a stable (device, log_name) → color index map for the color variant
      const pairColorMap = new Map();
      if (format === "html-color") {
        for (const r of logRows) {
          const key = `${r.device_name ?? ""}|${r.log_name ?? ""}`;
          if (!pairColorMap.has(key)) pairColorMap.set(key, pairColorMap.size % palette.length);
        }
      }
      const rows = logRows
        .map((r) => {
          const contentColor = (r.content ?? "").startsWith("ERROR") ? "#f87171"
            : (r.content ?? "").startsWith("WARN") ? "#fbbf24" : "inherit";
          const rowStyle = format === "html-color"
            ? (() => {
                const idx = pairColorMap.get(`${r.device_name ?? ""}|${r.log_name ?? ""}`) ?? 0;
                const c = palette[idx];
                return `style="background:${c}18;border-left:3px solid ${c}"`;
              })()
            : "";
          return `<tr ${rowStyle}><td>${r.time ?? ""}</td><td>${r.device_name ?? ""}</td><td>${r.log_name ?? ""}</td><td style="color:${contentColor}">${(r.content ?? "").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</td></tr>`;
        })
        .join("\n");
      const legendHtml = format === "html-color"
        ? `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px">${
            [...pairColorMap.entries()].map(([key, idx]) => {
              const [dev, log] = key.split("|");
              return `<span style="font-size:11px;padding:3px 10px;border-radius:12px;border:1px solid ${palette[idx]};color:${palette[idx]};background:${palette[idx]}18">${dev} · ${log}</span>`;
            }).join("")
          }</div>`
        : "";
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
  tr:hover td{filter:brightness(1.15)}
</style>
</head>
<body>
<h1>LogOctopus — Log Export (${new Date().toISOString()})</h1>
${legendHtml}<table>
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
    addToast(`Logs exported as ${format === "html-color" ? "HTML" : format.toUpperCase()}.`, "success");
  };

  /**
   * Fetches content for all selected snapshots and triggers a file download
   * directly — without opening the log modal. Reuses the same fetch logic as
   * openLogContent and the same format serialisation as downloadLogs.
   */
  const downloadSelectedLogs = async (format) => {
    if (selectedSnaps.length === 0) return;
    setDownloadingSnaps(true);
    try {
      const snapsToDownload = snapshots.filter((s) => selectedSnaps.includes(s.id));
      const results = await Promise.all(
        snapsToDownload.map((s) =>
          apiFetch(`/api/snapshots/${s.id}/content?log_type=${isChart ? "chart" : "text"}`).then((r) => ({
            snapInfo: s,
            rows: r.rows,
          }))
        )
      );

      if (isChart) {
        const palette = ["#818cf8","#34d399","#fb923c","#f472b6","#60a5fa","#a78bfa","#facc15","#2dd4bf","#f87171","#c084fc"];

        if (format === "json") {
          const data = results.map((r) => ({
            device: r.snapInfo.deviceName,
            log_name: r.snapInfo.logName,
            session_id: r.snapInfo.sessionId,
            data_unit: r.snapInfo.dataUnit || "",
            rows: r.rows,
          }));
          const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = "chart_data.json";
          a.click();
          addToast("Chart data exported as JSON.", "success");

        } else {
          // HTML — embed Plotly CDN and render one chart per snapshot
          const chartSections = results.map((r, i) => {
            const color = palette[i % palette.length];
            const label = `${r.snapInfo.deviceName} — ${r.snapInfo.logName}`;
            const unit  = r.snapInfo.dataUnit || "";
            const xs    = r.rows.map(d => d.time);
            const ys    = r.rows.map(d => parseFloat(d.content));
            const isNum = ys.some(v => !isNaN(v));
            return `
  <div class="chart-wrap">
    <div id="chart-${i}" class="chart"></div>
    <div class="badges">
      <span class="badge" style="border-color:${color};color:${color};background:${color}18">${r.snapInfo.logName}</span>
      <span class="badge">${r.snapInfo.deviceName}</span>
      <span class="badge">${r.rows.length} points${unit ? " · " + unit : ""}</span>
      <span class="badge">Session: ${r.snapInfo.sessionId}</span>
    </div>
  </div>
  <script>
    Plotly.newPlot('chart-${i}',
      [{ x: ${JSON.stringify(xs)}, y: ${JSON.stringify(isNum ? ys : r.rows.map(d => d.content))},
         type:'scatter', mode:'lines+markers', name:${JSON.stringify(label)},
         line:{color:'${color}',width:2.5,shape:'spline',smoothing:0.8},
         marker:{size:5,color:'${color}'},
         hovertemplate: ${unit ? `'<b>%{y} ${unit}<extra></extra>'` : "'<b>%{y}<extra></extra>'"} }],
      { title:{text:${JSON.stringify(label)},font:{color:'#e8eaf0',size:13,family:'JetBrains Mono,monospace'},x:0.04},
        paper_bgcolor:'transparent', plot_bgcolor:'rgba(9,9,15,0.6)',
        font:{color:'#6b7280',family:'JetBrains Mono,monospace',size:11},
        xaxis:{gridcolor:'rgba(255,255,255,0.06)',tickfont:{color:'#6b7280',size:10}},
        yaxis:{gridcolor:'rgba(255,255,255,0.06)',tickfont:{color:'#6b7280',size:10}${unit ? `,title:{text:'${unit}',font:{color:'#6b7280',size:11}}` : ""}},
        margin:{t:40,r:20,b:48,l:56}, hovermode:'x unified',
        hoverlabel:{bgcolor:'#111827',bordercolor:'${color}',font:{color:'#e8eaf0',size:12}} },
      { responsive:true, displayModeBar:true, displaylogo:false }
    );
  <\/script>`;
          }).join("\n");

          const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>LogOctopus — Chart Export</title>
<script src="https://cdn.plot.ly/plotly-2.32.0.min.js"><\/script>
<style>
  body{font-family:'JetBrains Mono',monospace;background:#09090f;color:#e4e4f0;margin:0;padding:24px}
  h1{font-size:16px;color:#818cf8;margin-bottom:20px}
  .chart-wrap{margin-bottom:32px;border:1px solid rgba(255,255,255,0.07);border-radius:10px;overflow:hidden;background:#12121f}
  .chart{width:100%;height:300px}
  .badges{display:flex;flex-wrap:wrap;gap:6px;padding:10px 14px;border-top:1px solid rgba(255,255,255,0.06)}
  .badge{font-size:11px;padding:2px 10px;border-radius:12px;border:1px solid rgba(255,255,255,0.12);color:#6b7280;background:rgba(255,255,255,0.04)}
</style>
</head>
<body>
<h1>LogOctopus — Chart Export (${new Date().toISOString()})</h1>
${chartSections}
</body>
</html>`;
          const blob = new Blob([html], { type: "text/html" });
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = "charts.html";
          a.click();
          addToast(`${results.length} chart(s) exported as HTML.`, "success");
        }
        return;
      }

      // Merge and sort text rows (same as openLogContent)
      const merged = results.flatMap((r) =>
        r.rows.map((row) => ({ ...row, device_name: r.snapInfo.deviceName ?? r.snapInfo.device_name ?? "" }))
      );
      merged.sort((a, b) => {
        const ta = a.timestamp || a.time || "";
        const tb = b.timestamp || b.time || "";
        return ta < tb ? -1 : ta > tb ? 1 : 0;
      });

      if (merged.length === 0) { addToast("No log data to export.", "info"); return; }

      let blob, filename;
      if (format === "csv") {
        const content =
          "Time,Device,Log Name,Content\n" +
          merged.map((r) => `"${r.time}","${r.device_name ?? ""}","${r.log_name}","${(r.content ?? "").replace(/"/g, '""')}"`).join("\n");
        blob = new Blob([content], { type: "text/csv" });
        filename = "logs.csv";
      } else if (format === "txt") {
        const lines = merged.map((r) => `[${r.time}] [${r.device_name ?? ""}] [${r.log_name}] ${r.content ?? ""}`);
        blob = new Blob([lines.join("\n")], { type: "text/plain" });
        filename = "logs.txt";
      } else if (format === "json") {
        const data = merged.map((r) => ({ time: r.time, device: r.device_name ?? "", log_name: r.log_name, content: r.content }));
        blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        filename = "logs.json";
      } else if (format === "html" || format === "html-color") {
        const palette = ["#818cf8","#34d399","#fb923c","#f472b6","#60a5fa","#a78bfa","#facc15","#2dd4bf","#f87171","#c084fc"];
        const pairColorMap = new Map();
        if (format === "html-color") {
          for (const r of merged) {
            const key = `${r.device_name ?? ""}|${r.log_name ?? ""}`;
            if (!pairColorMap.has(key)) pairColorMap.set(key, pairColorMap.size % palette.length);
          }
        }
        const rowsHtml = merged.map((r) => {
          const contentColor = (r.content ?? "").startsWith("ERROR") ? "#f87171"
            : (r.content ?? "").startsWith("WARN") ? "#fbbf24" : "inherit";
          const rowStyle = format === "html-color"
            ? (() => {
                const idx = pairColorMap.get(`${r.device_name ?? ""}|${r.log_name ?? ""}`) ?? 0;
                const c = palette[idx];
                return `style="background:${c}18;border-left:3px solid ${c}"`;
              })()
            : "";
          return `<tr ${rowStyle}><td>${r.time ?? ""}</td><td>${r.device_name ?? ""}</td><td>${r.log_name ?? ""}</td><td style="color:${contentColor}">${(r.content ?? "").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</td></tr>`;
        }).join("\n");
        const legendHtml = format === "html-color"
          ? `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px">${
              [...pairColorMap.entries()].map(([key, idx]) => {
                const [dev, log] = key.split("|");
                return `<span style="font-size:11px;padding:3px 10px;border-radius:12px;border:1px solid ${palette[idx]};color:${palette[idx]};background:${palette[idx]}18">${dev} · ${log}</span>`;
              }).join("")
            }</div>`
          : "";
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
  tr:hover td{filter:brightness(1.15)}
</style>
</head>
<body>
<h1>LogOctopus — Log Export (${new Date().toISOString()})</h1>
${legendHtml}<table>
<thead><tr><th>Timestamp</th><th>Device</th><th>Log Name</th><th>Content</th></tr></thead>
<tbody>
${rowsHtml}
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
      addToast(`${merged.length} log rows exported as ${format === "html-color" ? "HTML" : format.toUpperCase()}.`, "success");
    } catch (e) {
      addToast(`Download failed: ${e.message}`);
    } finally {
      setDownloadingSnaps(false);
    }
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
            <AddDeviceBtn onUpload={handleUpload} onBuildConfig={() => setBuilderModal(true)} />
            <Btn variant="success" onClick={startCollection} disabled={!anySelected}>▶ Start Collection</Btn>
            <Btn variant="danger"  onClick={stopCollection}  disabled={!anySelected}>⏹ Stop Collection</Btn>
            <Btn variant="ghost"   onClick={removeSelected}  disabled={!anySelected}>🗑 Remove Selected</Btn>
            <div style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted)" }}>
              {selectedDevices.length} device(s) selected
            </div>
          </div>

          {/* DEVICES */}
          <section style={{ marginBottom: 32 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--muted)" }}>
                Managed Devices — {devices.length}
              </div>
              <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
                {creatingGroup ? (
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input
                      autoFocus
                      value={newGroupName}
                      onChange={e => setNewGroupName(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") createGroup(); if (e.key === "Escape") { setCreatingGroup(false); setNewGroupName(""); } }}
                      placeholder="Group name…"
                      style={{ ...inputStyle, width: 160, padding: "6px 10px", fontSize: 12 }}
                    />
                    <Btn variant="success" size="sm" onClick={createGroup}>Create</Btn>
                    <Btn variant="ghost" size="sm" onClick={() => { setCreatingGroup(false); setNewGroupName(""); }}>✕</Btn>
                  </div>
                ) : (
                  <Btn variant="subtle" size="sm" onClick={() => setCreatingGroup(true)}>＋ New Group</Btn>
                )}
              </div>
            </div>

            {devicesLoading ? <Spinner /> : devices.length === 0 ? (
              <div style={{ padding: "32px 24px", background: "var(--card-bg)", border: "1px dashed var(--border)", borderRadius: 12, textAlign: "center", color: "var(--muted)", fontFamily: "var(--font-mono)", fontSize: 13 }}>
                No devices. Upload a JSON config file to add one.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

                {/* Named groups */}
                {groups.map(group => {
                  const groupDevices = group.deviceIds.map(id => devices.find(d => d.id === id)).filter(Boolean);
                  return (
                    <DeviceGroup
                      key={group.id}
                      group={group}
                      groupDevices={groupDevices}
                      collapsed={collapsedGroups.has(group.id)}
                      onToggleCollapse={() => toggleGroupCollapse(group.id)}
                      selectedDevices={selectedDevices}
                      onSelect={(id, checked) => toggleDevice(id, checked)}
                      onSelectAll={selectAllInGroup}
                      onInfo={(d) => setDeviceModal(d)}
                      onAutoCollectionSave={(id, enabled, interval) => {
                        setDevices(prev => prev.map(dev => dev.id === id ? { ...dev, autoCollectionEnabled: enabled, autoCollectionInterval: interval } : dev));
                      }}
                      onDropDevice={moveDeviceToGroup}
                      onRemoveDevice={removeDeviceFromGroups}
                      onReorderDevice={reorderDeviceInGroup}
                      onRename={(name) => renameGroup(group.id, name)}
                      onDelete={() => deleteGroup(group.id)}
                      addToast={addToast}
                    />
                  );
                })}

                {/* Ungrouped devices — only shown when there are any */}
                {ungroupedDevices.length > 0 && (
                <DeviceGroup
                  group={{ id: "__ungrouped__", name: groups.length > 0 ? "Ungrouped" : null }}
                  groupDevices={ungroupedDevices}
                  selectedDevices={selectedDevices}
                  onSelect={(id, checked) => toggleDevice(id, checked)}
                  onSelectAll={selectAllInGroup}
                  onInfo={(d) => setDeviceModal(d)}
                  onAutoCollectionSave={(id, enabled, interval) => {
                    setDevices(prev => prev.map(dev => dev.id === id ? { ...dev, autoCollectionEnabled: enabled, autoCollectionInterval: interval } : dev));
                  }}
                  onDropDevice={moveDeviceToGroup}
                  onRemoveDevice={removeDeviceFromGroups}
                  addToast={addToast}
                  isUngrouped
                />
                )}
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
            <DownloadSelectedBtn
              onDownload={downloadSelectedLogs}
              disabled={selectedSnaps.length === 0}
              loading={downloadingSnaps}
              isChart={isChart}
            />
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
              {snapshots.filter(s => visibleDeviceNames.size === 0 || visibleDeviceNames.has(s.deviceName)).length} snapshot(s)
              {collapsedGroups.size > 0 && (
                <span style={{ marginLeft: 6, color: "#fbbf24" }}>· {collapsedGroups.size} group{collapsedGroups.size > 1 ? "s" : ""} collapsed</span>
              )}
              {isChart && selectedSnaps.length > 0 && (
                <span style={{ marginLeft: 8, color: "var(--accent)" }}>· {selectedSnaps.length} selected for chart</span>
              )}
            </div>
          </div>

          {/* SNAPSHOTS TABLE */}
          <div style={{ background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
            {snapsLoading ? <Spinner /> : (
              <SnapshotsTable
                snapshots={snapshots.filter(s => visibleDeviceNames.size === 0 || visibleDeviceNames.has(s.deviceName))}
                selected={selectedSnaps}
                onSelect={toggleSnap}
                onView={openLogContent}
              />
            )}
          </div>
        </div>
      </div>

      {/* COLLECTION STOP LOADING OVERLAY */}
      <CollectionLoadingOverlay open={stoppingCollection} saved={stopProgress.saved} expected={stopProgress.expected} />

      {/* MODALS */}

      {/* Config Builder Modal */}
      <ConfigBuilderModal
        open={builderModal}
        onClose={() => setBuilderModal(false)}
        onSave={handleUpload}
      />

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
            <DownloadMenu onDownload={downloadLogs} isChart={isChart} />
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