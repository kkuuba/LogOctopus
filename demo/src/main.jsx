import { installMockApi } from "./mock/mockApi.js";

// Must run before LogOctopus.jsx's App ever calls fetch().
installMockApi();

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./LogOctopus.jsx";

function DemoBanner() {
  return (
    <div
      style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 100000,
        background: "linear-gradient(90deg,#4c1d95,#5b21b6)",
        color: "#fff", fontSize: 13, padding: "6px 14px",
        display: "flex", gap: 10, alignItems: "center", justifyContent: "center",
        fontFamily: "system-ui, sans-serif", flexWrap: "wrap",
      }}
    >
      <span><strong>LogOctopus Demo</strong> — fake data, runs entirely in your browser, no backend attached.</span>
      <span style={{ opacity: 0.85 }}>Admin login: <code>admin</code> / <code>admin</code></span>
      <a href="https://github.com/kkuuba/LogOctopus" target="_blank" rel="noreferrer" style={{ color: "#fff", textDecoration: "underline" }}>
        View source
      </a>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <div style={{ paddingTop: 34 }}>
      <DemoBanner />
      <App />
    </div>
  </React.StrictMode>
);
