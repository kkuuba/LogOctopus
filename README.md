<p align="center">
  <svg width="64" height="64" viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg">
    <circle cx="18" cy="18" r="17" fill="none" stroke="#818cf8" stroke-width="1.5"/>
    <circle cx="18" cy="18" r="6" fill="#818cf8"/>
    <line x1="25" y1="18" x2="33" y2="18" stroke="#818cf8" stroke-width="1.8" stroke-linecap="round"/>
    <line x1="22.95" y1="22.95" x2="28.59" y2="28.59" stroke="#818cf8" stroke-width="1.8" stroke-linecap="round"/>
    <line x1="18" y1="25" x2="18" y2="33" stroke="#818cf8" stroke-width="1.8" stroke-linecap="round"/>
    <line x1="13.05" y1="22.95" x2="7.41" y2="28.59" stroke="#818cf8" stroke-width="1.8" stroke-linecap="round"/>
    <line x1="11" y1="18" x2="3" y2="18" stroke="#818cf8" stroke-width="1.8" stroke-linecap="round"/>
    <line x1="13.05" y1="13.05" x2="7.41" y2="7.41" stroke="#818cf8" stroke-width="1.8" stroke-linecap="round"/>
    <line x1="18" y1="11" x2="18" y2="3" stroke="#818cf8" stroke-width="1.8" stroke-linecap="round"/>
    <line x1="22.95" y1="13.05" x2="28.59" y2="7.41" stroke="#818cf8" stroke-width="1.8" stroke-linecap="round"/>
  </svg>
</p>

<h1 align="center">LogOctopus</h1>
<p align="center"><em>Automated log collection and monitoring tool for multi-device test environments.</em></p>

<p align="center">
  <a href="https://github.com/YOUR_ORG/YOUR_REPO/actions/workflows/ci.yml">
    <img src="https://github.com/YOUR_ORG/YOUR_REPO/actions/workflows/ci.yml/badge.svg" alt="CI">
  </a>
  <a href="https://github.com/YOUR_ORG/YOUR_REPO/graphs/contributors">
    <img src="https://img.shields.io/github/contributors/YOUR_ORG/YOUR_REPO?color=818cf8" alt="Contributors">
  </a>
  <a href="https://github.com/YOUR_ORG/YOUR_REPO/commits/main">
    <img src="https://img.shields.io/github/last-commit/YOUR_ORG/YOUR_REPO?color=34d399" alt="Last Commit">
  </a>
  <a href="https://github.com/YOUR_ORG/YOUR_REPO/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/YOUR_ORG/YOUR_REPO?color=f472b6" alt="License">
  </a>
</p>

LogOctopus collects, stores, and visualises logs from remote devices over SSH. It is designed for use in automated test pipelines where you need to capture system events, performance metrics, and application logs from multiple machines simultaneously — and then analyse them through a web UI or query them programmatically via REST API.

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Requirements](#requirements)
- [Installation](#installation)
- [Configuration](#configuration)
  - [device_config.json](#device_configjson)
  - [Log Types](#log-types)
  - [Environment Variables](#environment-variables)
- [Running the Application](#running-the-application)
- [Web Interface](#web-interface)
- [REST API](#rest-api)
- [Integrating with Automated Tests](#integrating-with-automated-tests)
- [Auto-Collection](#auto-collection)
- [Project Structure](#project-structure)
- [Contributing](#contributing)
- [License](#license)

---

## Overview

LogOctopus connects to remote devices via SSH (directly or through a gateway) and runs configurable shell commands to collect log data on demand. Each collection run produces **snapshots** — timestamped captures of a log source — grouped under a **session ID** and a **scenario label** that you define (e.g. `reboot-test`, `stress-run`, `baseline`).

Two snapshot types are supported:

- **Text logs** — event logs, service lists, audit trails, etc. Displayed in a time-sorted table with colour-coded keyword highlighting.
- **Chart logs** — numeric time-series metrics (CPU %, memory, disk, network I/O). Rendered as interactive Plotly charts; multiple snapshots from different devices can be overlaid in a single view.

---

## Features

- **Multi-device support** — manage and collect from any number of devices simultaneously.
- **SSH + gateway tunnelling** — connect directly or through a jump/gateway host.
- **Fully customisable log sources** — define any shell command as a log source via JSON config.
- **Regex-based parsing** — extract timestamps and payload from raw command output.
- **Text log viewer** — time-sorted unified view across devices, with colour mode and CSV/plain-text download.
- **Chart viewer** — Plotly-powered interactive charts with zoom, pan, spike lines, and PNG export.
- **Session & scenario labelling** — group every snapshot under a named test scenario for easy retrieval.
- **Snapshot filtering** — filter by Device, Log Name, Session ID, Scenario, or time range.
- **REST API** — start/stop collection, query snapshots, and fetch log content programmatically.
- **Auto-collection** — schedule periodic log collection per device at a configurable interval.
- **Admin authentication** — simple role-based access gate for write operations; password changeable at runtime.
- **Deep-link URLs** — stop-collection response returns ready-made URLs to open the relevant session directly in the UI.

---

## Architecture

```
┌─────────────────────────────────┐
│         React Frontend          │  LogOctopus.jsx  (Vite / CDN)
│  Devices · Snapshots · Charts   │
└────────────┬────────────────────┘
             │ HTTP (REST)
┌────────────▼────────────────────┐
│      Flask Backend (app.py)     │  Python 3.11+
│  /api/devices  /api/snapshots   │
│  /api/start|stop-logs-collection│
└────────────┬────────────────────┘
             │ SSH / Gateway SSH
┌────────────▼────────────────────┐
│        Remote Devices           │  Windows / Linux / …
│  PowerShell · bash · any shell  │
└─────────────────────────────────┘
```

Snapshot data is persisted locally under `data/` as files managed by the backend. No external database is required.

---

## Requirements

<!-- TODO: fill in exact version constraints from your pyproject.toml / requirements.txt -->

**Backend**
- Python 3.11+
- Flask
- flask-cors
- paramiko (SSH)
- pandas
- *(add any additional dependencies here)*

**Frontend**
- Node.js 18+ (for development builds)
- Plotly.js 2.32+ (loaded via CDN or npm)

---

## Installation

```bash
# 1. Clone the repository
git clone https://github.com/<your-org>/logoctopus.git
cd logoctopus

# 2. Create and activate a virtual environment
python -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate

# 3. Install Python dependencies
pip install -r requirements.txt

# 4. Install frontend dependencies (development only)
cd frontend
npm install
```

---

## Configuration

### device_config.json

Each device is described by a single JSON file that you upload through the UI or drop into the `data/` directory. Below is a commented breakdown of every field:

```jsonc
{
  // Human-readable label shown in the UI
  "device_name": "Windows-PC",

  // SSH target
  "ip_address": "192.168.100.10",
  "port": 22,
  "user": "example_user",
  "password": "example_password",   // or omit and use an SSH key

  // How often auto-collection fires (seconds) — used when auto-collection is enabled
  "collection_interval": 30,

  // Optional: jump/gateway host (if the device is not directly reachable)
  "gateway": {
    "ip_address": "192.168.100.12",
    "port": 22,
    "user": "example_user_1",
    "ssh_key_string": "-----BEGIN OPENSSH PRIVATE KEY-----\n..."
  },

  // List of log sources to collect
  "log_file_configs": [
    {
      // Shell command executed on the remote device
      "log_file_cmd": "powershell.exe -Command \"...\"",

      // Unique name for this log source; used as the snapshot label
      "log_name": "system_log",

      // Named-group regex applied to each output line.
      // Required groups: TIME (timestamp) and ENTRY (payload).
      "data_extraction_regex": "^(?P<TIME>\\d+-\\d+-\\d+ \\d+:\\d+:\\d+)\\s(?P<ENTRY>.*)",

      // Command run once before collection starts (e.g. to activate a log sink)
      "log_activation_cmd": "dir",

      // "text" → event/audit logs   |   "chart" → numeric time-series
      "log_type": "text"
    }
  ]
}
```

A full working example for a Windows PC (system log, app log, hardware, network, security, RDP sessions, installed updates, running services, CPU/memory/disk/network metrics) is provided in [`device_config.json`](device_config.json).

### Log Types

| `log_type` | Collected data | How it is displayed |
|------------|----------------|---------------------|
| `text`     | Multi-field event lines | Time-sorted table, colour mode, downloadable |
| `chart`    | Single numeric value per timestamp | Interactive Plotly line chart |

For `chart` logs the regex `ENTRY` group must capture a single number (integer or float).

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_API_BASE` | `http://localhost:8050` | Backend URL used by the frontend |
| `FRONTEND_BASE` | `http://localhost:8100` | Frontend URL embedded in deep-link responses |
| `VITE_ADMIN_USER` | `admin` | Default admin username |
| `VITE_ADMIN_PASS` | `logoctopus` | Default admin password (change on first use) |

---

## Running the Application

**Backend**

```bash
python app.py
# Starts Flask on http://localhost:8050 by default
```

**Frontend (development)**

```bash
cd frontend
npm run dev
# Vite dev server on http://localhost:8100
```

**Frontend (production build)**

```bash
cd frontend
npm run build
# Serve the dist/ folder with any static file server
```

---

## Web Interface

After opening the UI in your browser you will see:

1. **Device panel** — cards for each managed device showing connection status and collection state. Upload a `device_config.json` with the **+ Add Device** button to register a new device.
2. **Snapshot toolbar** — switch between *Text* and *Chart* mode, filter snapshots, and start/stop collection.
3. **Snapshots table** — lists every snapshot with device name, log name, session ID, scenario, timestamps, duration, and size. Select one or more rows to view content.
4. **Log viewer modal** — for text logs: time-sorted rows with optional colour highlighting and download. For chart logs: one Plotly panel per selected snapshot with zoom, pan, and PNG export.

**Admin features** (require login — default `admin` / `logoctopus`):

- Remove devices
- Configure auto-collection schedules
- Change the admin password via Settings

---

## REST API

The built-in API documentation is accessible from the **API** button in the top navigation bar. Key endpoints:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/devices` | List all devices |
| `POST` | `/api/devices` | Add a device (base64-encoded config) |
| `DELETE` | `/api/devices/<id>` | Remove a device |
| `GET` | `/api/snapshots` | List snapshots (filterable) |
| `GET` | `/api/snapshots/<id>/content` | Fetch snapshot rows |
| `POST` | `/api/start-logs-collection` | Start collection session |
| `POST` | `/api/stop-logs-collection` | Stop collection, returns deep-link URLs |
| `GET` | `/api/settings/auto-collection` | Read auto-collection config |
| `POST` | `/api/settings/auto-collection` | Write auto-collection config |
| `POST` | `/api/settings/change-password` | Update admin password |

**Start collection example:**

```bash
curl -X POST http://localhost:8050/api/start-logs-collection \
  -H "Content-Type: application/json" \
  -d '{"selected_devices": ["Windows-PC"], "session_scenario": "reboot-test"}'
```

Response:
```json
{ "status": "logs collection started", "session_id": "a1b2c3d4e5f6" }
```

**Stop collection example:**

```bash
curl -X POST http://localhost:8050/api/stop-logs-collection \
  -H "Content-Type: application/json" \
  -d '{"selected_devices": ["Windows-PC"], "session_id": "a1b2c3d4e5f6"}'
```

Response includes ready-made URLs to open the session directly in the UI:
```json
{
  "status": "logs collection stopped",
  "session_id": "a1b2c3d4e5f6",
  "text_logs_url": "http://localhost:8100/?search_param=Session%20ID&search_value=a1b2c3d4e5f6&log_type=text",
  "chart_logs_url": "http://localhost:8100/?search_param=Session%20ID&search_value=a1b2c3d4e5f6&log_type=chart"
}
```

---

## Integrating with Automated Tests

LogOctopus is designed to wrap test runs. A typical test-framework integration looks like this:

```python
import requests

API = "http://localhost:8050"
DEVICES = ["Windows-PC"]

def start_collection(scenario: str) -> str:
    r = requests.post(f"{API}/api/start-logs-collection", json={
        "selected_devices": DEVICES,
        "session_scenario": scenario,
    })
    return r.json()["session_id"]

def stop_collection(session_id: str) -> dict:
    r = requests.post(f"{API}/api/stop-logs-collection", json={
        "selected_devices": DEVICES,
        "session_id": session_id,
    })
    return r.json()

# --- in your test ---
session_id = start_collection("my-test-scenario")
try:
    run_test()
finally:
    result = stop_collection(session_id)
    print("Logs →", result["text_logs_url"])
    print("Charts →", result["chart_logs_url"])
```

The returned URLs can be attached to test reports or CI artefacts so that reviewers can jump straight into the relevant session.

---

## Auto-Collection

Auto-collection lets LogOctopus gather logs on a recurring schedule without any test-framework integration. Configure it per device through the **Settings → Auto-collection** panel in the UI, or via the API:

```bash
curl -X POST http://localhost:8050/api/settings/auto-collection \
  -H "Content-Type: application/json" \
  -d '{
    "device_ids": ["<device_id>"],
    "enabled": true,
    "interval_hours": 4.0
  }'
```

Auto-collection sessions are labelled with the scenario `auto-logs-collection`.

---

## Project Structure

```
logoctopus/
├── app.py                   # Flask application entry point
├── settings.json            # Runtime settings (auto-generated)
├── data/                    # Persisted device configs and snapshots
├── backend/
│   ├── models/
│   │   ├── device.py
│   │   └── device_config.py
│   └── utils/
│       ├── config_helper.py
│       └── device_config_loader.py
└── frontend/
    ├── index.html           # Loads Plotly CDN script
    ├── src/
    │   └── LogOctopus.jsx   # Single-file React application
    └── vite.config.js
```

---

## Contributing

<!-- TODO: fill in your contribution guidelines, branch strategy, and PR process -->

Pull requests are welcome. Please open an issue first to discuss significant changes.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes (`git commit -m 'Add my feature'`)
4. Push and open a Pull Request

---

## License

<!-- TODO: add your licence (MIT, Apache-2.0, proprietary, etc.) -->

This project is licensed under the [MIT License](LICENSE).