// Demo entry point.
//
// LogOctopus.jsx is the REAL, unmodified frontend. The only thing that makes it
// a demo is that window.fetch is replaced for "/api/*" calls (see mock/mockApi.js)
// before React renders anything.

import { installMockApi } from "./mock/mockApi.js";
installMockApi();

// Device groups should always be visible: forget any collapse preference saved by
// an earlier visit before the app reads it. (Collapsing manually still works.)
try { localStorage.removeItem("lo_collapsed_groups"); } catch { /* storage blocked */ }

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./LogOctopus.jsx";
import DemoBanner from "./demo/DemoBanner.jsx";
import TourPanel from "./demo/TourPanel.jsx";

// NOTE: deliberately no <React.StrictMode>. In development StrictMode runs every
// effect twice, and the app's "save device groups" effect (guarded by a ref that is
// only meant to skip the first run) then sends PUT /api/settings/device-groups with
// an empty list on mount — wiping the groups on most reloads. Production builds
// are unaffected, but `npm run dev` must behave the same.
ReactDOM.createRoot(document.getElementById("root")).render(
  <>
    <DemoBanner />
    <App />
    <TourPanel />
  </>
);
