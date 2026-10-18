<div align="center">

<img src="docs/logo.svg" alt="LogOctopus logo" width="140">

# LogOctopus

### One test. Multiple devices. One place to debug.

Collect logs, metrics, command outputs and packet captures from every device
in a test, and investigate them together in a single **test session**.

<br>

<a href="https://kkuuba.github.io/LogOctopus/">
  <img src="https://img.shields.io/badge/%F0%9F%9A%80%20Try%20the%20Live%20Demo-no%20install%20needed-818cf8?style=for-the-badge" alt="Try the live demo">
</a>

<br><br>

[![CI](https://github.com/kkuuba/LogOctopus/actions/workflows/ci.yml/badge.svg)](https://github.com/kkuuba/LogOctopus/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/kkuuba/LogOctopus?color=818cf8)](LICENSE)
[![Stars](https://img.shields.io/github/stars/kkuuba/LogOctopus?style=flat&color=818cf8)](https://github.com/kkuuba/LogOctopus/stargazers)
[![Docker](https://img.shields.io/badge/docker-compose-2496ED?logo=docker&logoColor=white)](#-quick-start)
[![Agentless](https://img.shields.io/badge/agentless-SSH--based-22d3ee)](#-features)

[**Live demo**](https://kkuuba.github.io/LogOctopus/) ·
[**Quick start**](#-quick-start) ·
[**Features**](#-features) ·
[**REST API**](#-rest-api) ·
[**Contributing**](#-contributing)

<br>

<a href="https://kkuuba.github.io/LogOctopus/">
  <img src="docs/demo-preview.gif" alt="LogOctopus live demo preview" width="880">
</a>

<sub>👆 Click the preview to open the interactive demo.</sub>

</div>

---

## 🎯 Why LogOctopus?

When a multi-device test fails, the evidence is scattered across machines. LogOctopus is built around **test sessions**, not generic log aggregation, and answers one question:

> **What happened during this test?**

<table>
<tr>
<td width="50%" valign="top">

### ❌ Without LogOctopus

```text
Test failed
   ↓
SSH into device A → find logs
   ↓
SSH into device B → find logs
   ↓
Check system state
   ↓
Compare timestamps by hand
   ↓
Open Wireshark
   ↓
Reconstruct what happened
```

</td>
<td width="50%" valign="top">

### ✅ With LogOctopus

```text
Test failed
   ↓
Open the test session
   ↓
All evidence, one timeline:
  • application logs
  • system logs & metrics
  • command output
  • packet capture
   ↓
Investigate the failure
```

</td>
</tr>
</table>

### See the failure in one timeline

```text
14:31:07.120  Client     request started
14:31:07.124  Router     packet forwarded
14:31:07.131  Server     request received
14:31:07.145  Embedded   application error   ← root cause
14:31:10.145  Client     timeout
```

No more correlating timestamps across four terminals.

---

## ✨ Features

| | |
|---|---|
| 🔌 **Multi-device collection** | Collect from many SSH-accessible devices at once: direct connections, gateway / jump hosts, custom commands, log files. **No agent required.** |
| 🧪 **Test-session investigation** | Every run is a session with scenario name, timestamps, device info, logs, metrics, command outputs and captures. |
| 📋 **Unified log explorer** | Merged timeline, filtering, highlighting, CSV export, interactive charts with zoom & pan, device comparison. |
| 📡 **Packet capture** | Collect `pcap` data and inspect decoded packets next to your logs. Ideal for timeouts, packet loss and protocol issues. |
| 🤖 **Automation friendly** | Start/stop collection from CI/CD, Python test suites or any runner via REST API. |
| 🗄️ **Zero-dependency storage** | Local snapshot storage. No external database for the basic setup. |

**Works with:** Linux · Windows · Raspberry Pi · Cisco · MikroTik · pfSense · Proxmox · Synology NAS · embedded devices · custom test infrastructure

---

## 🚀 Quick start

**Requirements:** Docker, Docker Compose, and SSH access to the devices you want to collect from.

```bash
# 1. Clone
git clone https://github.com/kkuuba/LogOctopus.git
cd LogOctopus

# 2. Configure (see docs/example_configs/ for ready-made device configs)
nano .env

# 3. Run
docker compose up -d
```

| Service  | URL                     |
| -------- | ----------------------- |
| Frontend | <http://localhost:8100> |
| Backend  | <http://localhost:8050> |

> 💡 Not ready to install? **[Explore the live demo →](https://kkuuba.github.io/LogOctopus/)**

<details>
<summary><b>⚙️ Device configuration example</b></summary>

<br>

Devices are configured in JSON:

```json
{
  "device_name": "Raspberry-PI-Zero",
  "ip_address": "192.168.12.2",
  "port": 22,
  "user": "pi_user",
  "password": "pi_password",
  "collection_interval": 30,
  "log_file_configs": [
    {
      "log_name": "syslog",
      "log_file_cmd": "sudo journalctl -n 200 --no-pager",
      "data_extraction_regex": "^(?P<TIME>\\w+\\s+\\d+\\s+\\d+\\:\\d+\\:\\d+)\\s+(?P<ENTRY>.*)",
      "log_type": "text",
      "data_unit": "",
      "description": ""
    },
    {
      "log_name": "kernel",
      "log_file_cmd": "dmesg -T",
      "data_extraction_regex": "^\\[(?P<TIME>\\w+\\s+\\w+\\s+\\d+\\s\\d+\\:\\d+\\:\\d+\\s+\\d+)\\]\\s+(?P<ENTRY>.*)",
      "log_type": "text",
      "data_unit": "",
      "description": ""
    },
    {
      "log_name": "ssh_logs",
      "log_file_cmd": "journalctl -u ssh -n 200 --no-pager",
      "data_extraction_regex": "^(?P<TIME>\\w+\\s+\\d+\\s+\\d+\\:\\d+\\:\\d+)\\s+(?P<ENTRY>.*)",
      "log_type": "text",
      "data_unit": "",
      "description": ""
    },
    {
      "log_name": "cron_logs",
      "log_file_cmd": "journalctl -u cron -n 200 --no-pager",
      "data_extraction_regex": "^(?P<TIME>\\w+\\s+\\d+\\s+\\d+\\:\\d+\\:\\d+)\\s+(?P<ENTRY>.*)",
      "log_type": "text",
      "data_unit": "",
      "description": ""
    },
    {
      "log_name": "system_errors",
      "log_file_cmd": "journalctl -p err -n 200 --no-pager",
      "data_extraction_regex": "^(?P<TIME>\\w+\\s+\\d+\\s+\\d+\\:\\d+\\:\\d+)\\s+(?P<ENTRY>.*)",
      "log_type": "text",
      "data_unit": "",
      "description": ""
    },
    {
      "log_name": "system_warnings",
      "log_file_cmd": "journalctl -p warning -n 200 --no-pager",
      "data_extraction_regex": "^(?P<TIME>\\w+\\s+\\d+\\s+\\d+\\:\\d+\\:\\d+)\\s+(?P<ENTRY>.*)",
      "log_type": "text",
      "data_unit": "",
      "description": ""
    },
    {
      "log_name": "boot_logs",
      "log_file_cmd": "journalctl -b -n 200 --no-pager",
      "data_extraction_regex": "^(?P<TIME>\\w+\\s+\\d+\\s+\\d+\\:\\d+\\:\\d+)\\s+(?P<ENTRY>.*)",
      "log_type": "text",
      "data_unit": "",
      "description": ""
    },
    {
      "log_name": "cpu_usage_percent",
      "log_file_cmd": "echo $(date '+%Y-%m-%d %H:%M:%S'),$(top -bn1 | grep 'Cpu(s)' | awk '{print 100-$8}')",
      "data_extraction_regex": "^(?P<TIME>\\d+\\-\\d+\\-\\d+\\s\\d+\\:\\d+\\:\\d+)\\,(?P<ENTRY>.*)",
      "log_type": "chart",
      "data_unit": "%",
      "description": ""
    },
    {
      "log_name": "free_memory_mb",
      "log_file_cmd": "echo $(date '+%Y-%m-%d %H:%M:%S'),$(free -m | awk '/Mem:/ {print $4}')",
      "data_extraction_regex": "^(?P<TIME>\\d+\\-\\d+\\-\\d+\\s\\d+\\:\\d+\\:\\d+)\\,(?P<ENTRY>.*)",
      "log_type": "chart",
      "data_unit": "MB",
      "description": ""
    },
    {
      "log_name": "used_memory_mb",
      "log_file_cmd": "echo $(date '+%Y-%m-%d %H:%M:%S'),$(free -m | awk '/Mem:/ {print $3}')",
      "data_extraction_regex": "^(?P<TIME>\\d+\\-\\d+\\-\\d+\\s\\d+\\:\\d+\\:\\d+)\\,(?P<ENTRY>.*)",
      "log_type": "chart",
      "data_unit": "MB",
      "description": ""
    },
    {
      "log_name": "disk_usage_percent",
      "log_file_cmd": "echo $(date '+%Y-%m-%d %H:%M:%S'),$(df / | awk 'NR==2 {print $5}' | tr -d '%')",
      "data_extraction_regex": "^(?P<TIME>\\d+\\-\\d+\\-\\d+\\s\\d+\\:\\d+\\:\\d+)\\,(?P<ENTRY>.*)",
      "log_type": "chart",
      "data_unit": "%",
      "description": ""
    },
    {
      "log_name": "cpu_temp_c",
      "log_file_cmd": "echo $(date '+%Y-%m-%d %H:%M:%S'),$(vcgencmd measure_temp | grep -o '[0-9.]*')",
      "data_extraction_regex": "^(?P<TIME>\\d+\\-\\d+\\-\\d+\\s\\d+\\:\\d+\\:\\d+)\\,(?P<ENTRY>.*)",
      "log_type": "chart",
      "data_unit": "° C",
      "description": ""
    },
    {
      "log_name": "load_avg_1min",
      "log_file_cmd": "echo $(date '+%Y-%m-%d %H:%M:%S'),$(cat /proc/loadavg | awk '{print $1}')",
      "data_extraction_regex": "^(?P<TIME>\\d+\\-\\d+\\-\\d+\\s\\d+\\:\\d+\\:\\d+)\\,(?P<ENTRY>.*)",
      "log_type": "chart",
      "data_unit": "",
      "description": ""
    },
    {
      "log_name": "load_avg_5min",
      "log_file_cmd": "echo $(date '+%Y-%m-%d %H:%M:%S'),$(cat /proc/loadavg | awk '{print $2}')",
      "data_extraction_regex": "^(?P<TIME>\\d+\\-\\d+\\-\\d+\\s\\d+\\:\\d+\\:\\d+)\\,(?P<ENTRY>.*)",
      "log_type": "chart",
      "data_unit": "",
      "description": ""
    },
    {
      "log_name": "process_count",
      "log_file_cmd": "echo $(date '+%Y-%m-%d %H:%M:%S'),$(ps -e | wc -l)",
      "data_extraction_regex": "^(?P<TIME>\\d+\\-\\d+\\-\\d+\\s\\d+\\:\\d+\\:\\d+)\\,(?P<ENTRY>.*)",
      "log_type": "chart",
      "data_unit": "",
      "description": ""
    },
    {
      "log_name": "active_devices_count",
      "log_file_cmd": "echo $(date '+%Y-%m-%d %H:%M:%S'),$(nmap -sn 192.168.0.0/24 2>/dev/null | grep -c 'Host is up')",
      "data_extraction_regex": "^(?P<TIME>\\d+\\-\\d+\\-\\d+\\s\\d+\\:\\d+\\:\\d+)\\,(?P<ENTRY>.*)",
      "log_type": "chart",
      "data_unit": "",
      "description": ""
    },
    {
      "log_name": "network_rx_bytes",
      "log_file_cmd": "F=/tmp/rx_prev; RX=$(< /sys/class/net/wlan0/statistics/rx_bytes); NOW=$(date +%s); read T R < $F 2>/dev/null; [ \"$T\" ] && echo \"$(date '+%F %T'),$(( (RX - R) * 30 / (NOW - T) ))\"; echo $NOW $RX > $F",
      "data_extraction_regex": "^(?P<TIME>\\d+\\-\\d+\\-\\d+\\s\\d+\\:\\d+\\:\\d+)\\,(?P<ENTRY>.*)",
      "log_type": "chart",
      "data_unit": "bytes",
      "description": ""
    },
    {
      "log_name": "network_tx_bytes",
      "log_file_cmd": "F=/tmp/tx_prev; TX=$(< /sys/class/net/wlan0/statistics/tx_bytes); NOW=$(date +%s); read T R < $F 2>/dev/null; [ \"$T\" ] && echo \"$(date '+%F %T'),$(( (TX - R) * 30 / (NOW - T) ))\"; echo \"$NOW $TX\" > $F",
      "data_extraction_regex": "^(?P<TIME>\\d+\\-\\d+\\-\\d+\\s\\d+\\:\\d+\\:\\d+)\\,(?P<ENTRY>.*)",
      "log_type": "chart",
      "data_unit": "bytes",
      "description": ""
    }
  ],
  "packets_capture_config": {
    "capture_start_cmd": "sudo tcpdump",
    "capture_stop_cmd": "sudo pkill -INT -f 'tcpdump -i'",
    "capture_description": "Network capture for 'wlan0' interface"
  }
}
```

More examples (Linux, Windows, Cisco, MikroTik, pfSense, Proxmox, Raspberry Pi, Synology NAS) live in [`docs/example_configs/`](docs/example_configs/).

</details>

---

## 🤖 REST API

Integrate collection into automated tests in three steps:

```mermaid
flowchart LR
    A[Start collection] --> B[Run automated test]
    B --> C[Stop collection]
    C --> D[Open test session]
    D --> E[Investigate failure]
```

```bash
curl -X POST http://localhost:8050/api/start-logs-collection \
  -H "Content-Type: application/json" \
  -d '{
    "selected_devices": ["server-01"],
    "session_scenario": "test"
  }'
```

The API lets you start/stop collection, manage devices, query snapshots and retrieve logs. It plugs into **CI/CD pipelines, Python test suites, custom runners and automation frameworks**.

---

## 🏗️ Architecture

```mermaid
flowchart TB
    UI[React Frontend] -->|REST API| BE[Flask Backend]
    BE -->|SSH / commands| A[Device A]
    BE -->|SSH / commands| B[Device B]
    BE -->|SSH / commands| C[Device C]
    BE --> S[(Local snapshot storage)]
```

**Stack:** React · Flask · SSH-based collection layer · local snapshot storage

<details>
<summary><b>📁 Project structure</b></summary>

```text
LogOctopus/
├── backend/             # Flask backend
├── frontend/            # React frontend
├── demo/                # Demo environment
├── docs/                # Documentation and examples
├── tests/               # Tests
├── Dockerfile.backend
├── Dockerfile.frontend
├── docker-compose.yml
└── README.md
```

</details>

---

## 🆚 How it compares

|                             | **LogOctopus** | Manual SSH | Generic log platform |
| --------------------------- | :------------: | :--------: | :------------------: |
| Multi-device collection     |       ✅       |     ⚠️     |          ✅          |
| SSH-based collection        |       ✅       |     ✅     |       Usually        |
| No agent required           |       ✅       |     ✅     |       Usually        |
| Test-session grouping       |       ✅       |     ❌     |          ⚠️          |
| Test-oriented investigation |       ✅       |     ❌     |          ⚠️          |
| Network captures            |       ✅       |   Manual   |       Depends        |
| Quick local setup           |       ✅       |     ✅     |       Usually        |
| CI/CD integration           |       ✅       |     ⚠️     |          ✅          |

> LogOctopus is **not** a replacement for general-purpose observability platforms. It solves a different problem: *collecting and investigating evidence from distributed test executions.*

---

## 👥 Who is it for?

| Role | How LogOctopus helps |
| --- | --- |
| 🔧 **Embedded engineers** | Application and system logs from embedded Linux devices during automated tests |
| 🧪 **QA / test automation** | Evidence for failed integration and system tests, collected automatically |
| 🌐 **Network engineers** | Logs and packet captures from routers, switches, firewalls, servers and clients |
| ⚙️ **DevOps / CI engineers** | Test-session evidence attached to automated workflows |
| 🔩 **Hardware validation teams** | Logs and system info from every device, kept together per test run |

**Great for:** distributed integration tests · system testing · network testing · embedded testing · hardware validation · QA automation · manual troubleshooting · CI/CD test environments

---

## 🗺️ Roadmap

- [ ] Historical test comparison
- [ ] Test-to-test diffing
- [ ] Trend analysis
- [ ] Improved device monitoring
- [ ] More test-framework integrations
- [ ] AI-assisted configuration generation
- [ ] Improved CI/CD integrations

Have an idea? [Open an issue](https://github.com/kkuuba/LogOctopus/issues) and start a discussion.

---

## 🤝 Contributing

Contributions are welcome, whether it's a bug fix, support for a new device, or a test-framework integration.

1. Open an issue and discuss the change
2. Fork the repository
3. Create a feature branch: `git checkout -b feature/my-feature`
4. Submit a pull request

---

## ⭐ Support the project

If LogOctopus saves you time, a star helps other engineers find it.

[![Star on GitHub](https://img.shields.io/badge/%E2%AD%90%20Star%20on%20GitHub-kkuuba%2FLogOctopus-818cf8?style=for-the-badge)](https://github.com/kkuuba/LogOctopus)

🐛 Report bugs · 💡 Suggest features · 🔧 Contribute code · 📖 Improve docs · 🗣️ Tell a colleague

---

<div align="center">

**LogOctopus** is released under the [MIT License](LICENSE).

Built for engineers who would rather investigate a failed test than SSH into ten machines to find out what happened.

<a href="https://kkuuba.github.io/LogOctopus/"><b>🚀 Try the live demo</b></a>

</div>
