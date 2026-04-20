
<p align="center">
  <img src="docs/logo.png" alt="LogOctopus logo">
</p>

<p align="center">
  <a href="https://github.com/kkuuba/LogOctopus/actions/workflows/ci.yml">
    <img src="https://github.com/kkuuba/LogOctopus/actions/workflows/ci.yml/badge.svg" alt="CI">
  </a>
  <a href="https://github.com/kkuuba/LogOctopus/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/kkuuba/LogOctopus?color=f472b6" alt="License">
  </a>
</p>

LogOctopus collects, stores, and visualises logs from remote devices over SSH. It is designed for use in automated test pipelines where you need to capture system events, performance metrics, and application/hardware logs from multiple machines simultaneously — and then analyse them through a web UI or query them programmatically via REST API.

## Fast Track

**What is it?** - LogOctopus is a tool that collects, stores, and visualises logs from remote devices over SSH, offering both a web UI and a REST API for querying the data.
**What problem does it solves?** - It eliminates the manual effort of capturing and correlating system logs from multiple machines during automated test runs, centralising everything into a single searchable interface.
**Who should us that?** - QA and DevOps engineers who need to monitor and analyse logs across multiple remote devices as part of automated test pipelines or CI workflows.

### Deploy with Docker

```bash
nano .env
# Edit this file with correct values for your Docker host
docker compose up -d
# Above cmds should build and start 2 containers for frontend and backend.
```

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
- [Planned Features](#planned-features)
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

**Backend**
- Python 3.11+
- fabric
- pandas
- python-dateutil
- pytest
- fastapi
- pyarrow
- flask_cors

**Frontend**
- Node.js 18+ (for development builds)
- Plotly.js 2.32+ (loaded via CDN or npm)

---

## Installation

```bash
# 1. Clone the repository
git clone https://github.com/kkuuba/LogOctopus.git
cd LogOctopus

# 2. Create and activate a virtual environment
python -m venv .venv
source .venv/bin/activate

# 3. Install Python dependencies
pip install -r requirements.txt

# 4. Install frontend dependencies (development only)
cd frontend
npm install
```

---

## Configuration

### device_config.json

Each device is described by a single JSON file that you upload through the UI. Below is a commented breakdown of every field:

```jsonc
{
  // Human-readable label shown in the UI
  "device_name": "Windows-PC",

  // SSH target
  "ip_address": "192.168.100.10",
  "port": 22,
  "user": "example_user",
  "password": "example_password",   // or omit and use an SSH key

  // How often cmds for all log configs should be executed. Interaval in seconds.
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

      // Command run once before collection starts (e.g. to clear current logs content before target scenario execution)
      "log_activation_cmd": "sudo journalctl --rotate;sudo journalctl --vacuum-time=1s",

      // "text" → event/audit logs   |   "chart" → numeric time-series
      "log_type": "text"
    }
  ]
}
```

In directory 'docs/example_configs/' there is about 10 example device configs for multiple device types. These files can be treated as example to create own custom configs for specialized devices which can have diferent sets of commands for target metrics.

```bash
docs/example_configs/
├── config_cisco_router.json
├── config_cisco_switch.json
├── config_linux_server.json
├── config_mikrotik.json
├── config_pfsense.json
├── config_proxmox.json
├── config_raspberry_pi.json
├── config_synology_nas.json
└── config_windows_server.json
```

### WARNING

Before adding of some device config in web UI, make sure that provided commands are safe to use.
Commands used in this configuration must be validated on a real device before deployment to ensure 
correctness, compatibility, and to prevent unintended impact on system.

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

**Backend (development)**

```bash
python -m backend.app
# Starts Flask on http://localhost:8050 by default
```

**Frontend (development)**

```bash
cd frontend
npm run dev
# Vite dev server on http://localhost:8100
```

**Backend (production build)**

```bash
gunicorn --bind "localhost:8050"  backend.app:app
# Starts Flask on http://localhost:8050 by default
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

## Planned Features

1. **Device config create with AI** — add UI for device config generation with usage of some AI agent. All generated cmd should be
checked during generation from safety and correctness perspective.
2. **Log trends view** — For same test scenario historic data should be analysed and some trends charts + text logs prediction should be calculated with some AI model. With that user should be able to compare current scenario results with current history baseline.
3. **Device watchdog refactor** — Analyse and refactor code for device_watchdog service in order to make it more roboust and efficient.

---

## Contributing

Pull requests are welcome. Please open an issue first to discuss significant changes.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes (`git commit -m 'Add my feature'`)
4. Push and open a Pull Request

---

## License

This project is licensed under the [MIT License](LICENSE).