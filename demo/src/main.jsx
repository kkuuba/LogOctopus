// Demo entry point.
//
// LogOctopus.jsx is the REAL, unmodified frontend. The only thing that makes it
// a demo is that window.fetch is replaced for "/api/*" calls (see mock/mockApi.js)
// before React renders anything.

import { installMockApi } from "./mock/mockApi.js";
installMockApi();

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./LogOctopus.jsx";
import DemoBanner from "./demo/DemoBanner.jsx";
import TourPanel from "./demo/TourPanel.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <DemoBanner />
    <App />
    <TourPanel />
  </React.StrictMode>
);
