"""
LogOctopus – Flask REST API backend
Replaces the Dash app.py with pure REST endpoints consumable by the React frontend.
"""

import os
import signal
import uuid
import json
import hashlib
from pathlib import Path

from flask import Flask, jsonify, request
from flask_cors import CORS

from backend.models.device import Device
from backend.models.device_config import DeviceConfig
from backend.utils.device_config_loader import DeviceConfigLoader
from backend.utils.config_helper import ConfigurationHelper



SETTINGS_FILE = Path("settings.json")
HOST = os.getenv("HOST", "localhost")
PORT = int(os.getenv("PORT", 8050))
FRONTEND_BASE = os.getenv("FRONTEND_BASE", "http://localhost:8100")

app = Flask(__name__)
CORS(app)  # allow the React dev-server / built bundle to call the API


# ── helpers ───────────────────────────────────────────────────────────────────

def get_current_devices() -> list[Device]:
    """Load all persisted device instances from the data directory."""
    return DeviceConfigLoader("data").load_all_devices()


def get_target_device(device_id: str) -> Device | None:
    """Return a Device whose config ID matches *device_id*, or None."""
    for device in get_current_devices():
        if device.device_config_id == device_id:
            return device
    return None


def device_to_dict(device: Device) -> dict:
    """Serialise a Device to a JSON-safe dict for the frontend."""

    return {
        "id":          device.device_config_id,
        "name":        device.device_name,
        "connection":  device.connection_status,
        "logAccess":   device.log_access,
        "collecting":  device.collection_ongoing,
        "config":      device.device_config,
    }


def snapshot_to_dict(snapshot) -> dict:
    """Serialise a log snapshot object to a JSON-safe dict."""
    return {
        "id":          snapshot.id,
        "deviceName":  snapshot.device_name,
        "logName":     snapshot.log_name,
        "startTime":   str(snapshot.start_time),
        "finishTime":  str(snapshot.finish_time),
        "duration":    snapshot.logs_collection_duration,
        "sizeKb":      int(snapshot.size_in_bytes/1000),
        "sessionId":   snapshot.session_id,
        "isChart":     snapshot.log_type
    }


def _bad(msg: str, code: int = 400):
    return jsonify({"error": msg}), code


def _load_settings() -> dict:
    if SETTINGS_FILE.exists():
        try:
            return json.loads(SETTINGS_FILE.read_text())
        except Exception:
            pass
    return {}


def _save_settings(settings: dict) -> None:
    SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    SETTINGS_FILE.write_text(json.dumps(settings, indent=2))


# ── devices ───────────────────────────────────────────────────────────────────

@app.get("/api/devices")
def list_devices():
    """
    Return the list of all managed devices with their current statuses.

    Response 200:
        [{ id, name, connection, logAccess, collecting, config }, …]
    """
    return jsonify([device_to_dict(d) for d in get_current_devices()])


@app.post("/api/devices")
def add_device():
    """
    Add a new device from a base-64-encoded JSON config payload.

    Request body:
        { "contents": "<base64-encoded config file content>" }

    Response 201:
        { "device": { … } }
    Response 422:
        { "error": "invalid_config" }
    """
    body = request.get_json(force=True)
    contents = body.get("contents", "")

    # The frontend sends "data:<mime>;base64,<data>" – strip the prefix if present
    if "," in contents:
        contents = contents.split(",", 1)[1]

    device_config = DeviceConfig(contents)
    if not device_config.validate_device_config():
        device_config.remove_device_config()
        return _bad("invalid_config", 422)

    device_instance = Device(device_config_instance=device_config)
    return jsonify({"device": device_to_dict(device_instance)}), 201


@app.delete("/api/devices/<device_id>")
def remove_device(device_id: str):
    """
    Remove a single device and kill its watchdog process.

    Response 204: (no body)
    Response 404: { "error": "not_found" }
    """
    device = get_target_device(device_id)
    if not device:
        return _bad("not_found", 404)

    pid = device.device_config.get("watchdog_process_pid")
    if pid:
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass

    device.remove_device_data()
    return "", 204


@app.get("/api/devices/<device_id>")
def get_device(device_id: str):
    """
    Return details for a single device.

    Response 200: { id, name, connection, logAccess, collecting, config }
    Response 404: { "error": "not_found" }
    """
    device = get_target_device(device_id)
    if not device:
        return _bad("not_found", 404)
    return jsonify(device_to_dict(device))


# ── log snapshots ─────────────────────────────────────────────────────────────

@app.get("/api/snapshots")
def list_snapshots():
    """
    Return log snapshots, optionally filtered.

    Query params:
        search_param  – "Device" | "Log Name" | "Session ID"
        search_value  – filter value
        log_type      – "text" | "chart"   (default: "text")

    Response 200:
        [{ id, deviceName, logName, startTime, finishTime, duration, sizeKb, sessionId, isChart }, …]
    """
    search_param  = request.args.get("search_param")
    search_value  = request.args.get("search_value")
    log_type      = request.args.get("log_type", "text")
    is_chart      = log_type == "chart"

    devices = get_current_devices()

    if search_param and search_value:
        snapshots = ConfigurationHelper.get_filtered_log_snapshots_list(
            devices, search_param, search_value, is_chart
        )
    else:
        snapshots = ConfigurationHelper.get_log_snapshots_list(devices, is_chart)

    return jsonify([snapshot_to_dict(s) for s in snapshots])


@app.get("/api/snapshots/<snapshot_id>/content")
def get_snapshot_content(snapshot_id: str):
    """
    Return the full log content for a single snapshot.

    Response 200:
        { "rows": [{ timestamp, log_name, content }, …] }   (text logs)
      OR
        { "rows": [{ time, content }, …] }                   (chart data)
    Response 404: { "error": "not_found" }
    """
    is_chart  = request.args.get("log_type", "text") == "chart"
    devices   = get_current_devices()
    snapshots = ConfigurationHelper.get_log_snapshots_list(devices, is_chart)
    target = next((s for s in snapshots if s.id == snapshot_id), None)
    if not target:
        return _bad("not_found", 404)

    rows = ConfigurationHelper.get_log_content_for_selected_snapshots([target]).to_dict(orient="records")
    return jsonify({"rows": rows})


# ── log collection ────────────────────────────────────────────────────────────

@app.post("/api/start-logs-collection")
def start_logs_collection():
    """
    Start log collection on the specified devices.

    Request body:
        { "selected_devices": ["device_name_1", …] }

    Response 200:
        { "status": "logs collection started", "session_id": "…" }
    """
    body             = request.get_json(force=True)
    selected_devices = body.get("selected_devices", [])

    if not isinstance(selected_devices, list):
        return _bad("selected_devices must be a list")

    session_id = uuid.uuid1().hex[:12]
    for device in get_current_devices():
        if device.device_name in selected_devices:
            device.start_logs_collection(session_id)

    return jsonify({"status": "logs collection started", "session_id": session_id})


@app.post("/api/stop-logs-collection")
def stop_logs_collection():
    """
    Stop log collection on the specified devices.

    Request body:
        { "selected_devices": ["device_name_1", …], "session_id": "…" }

    Response 200:
        {
          "status": "logs collection stopped",
          "session_id": "…",
          "text_logs_url": "…",
          "chart_logs_url": "…"
        }
    """
    body             = request.get_json(force=True)
    selected_devices = body.get("selected_devices", [])
    session_id       = body.get("session_id", "")

    if not isinstance(selected_devices, list):
        return _bad("selected_devices must be a list")
    if not isinstance(session_id, str):
        return _bad("session_id must be a string")

    for device in get_current_devices():
        if device.device_name in selected_devices:
            device.stop_logs_collection()
            device.wait_for_log_collection_teardown(timeout=60)

    return jsonify({
        "status":         "logs collection stopped",
        "session_id":     session_id,
        "text_logs_url":  f"{FRONTEND_BASE}/?search_param=Session%20ID&search_value={session_id}&log_type=text",
        "chart_logs_url": f"{FRONTEND_BASE}/?search_param=Session%20ID&search_value={session_id}&log_type=chart",
    })


@app.post("/api/settings/auto-collection")
def set_auto_collection():
    """
    Persist the auto-collection schedule and (if APScheduler is installed)
    register or update the server-side interval job.

    Request body:
        {
          "enabled":        true | false,
          "interval_hours": 1 | 2 | 4 | 6 | 12 | 24,
          "device_ids":     ["<id>", …]
        }

    Response 200:
        { "status": "ok", "scheduler_active": true | false }
    """
    body           = request.get_json(force=True)
    enabled        = bool(body.get("enabled", False))
    interval_hours = float(body.get("interval_hours", 1))
    device_ids     = body.get("device_ids", [])

    if not isinstance(device_ids, list):
        return _bad("device_ids must be a list")
    if interval_hours <= 0:
        return _bad("interval_hours must be positive")

    for device in get_current_devices():
        if device.device_config_id in device_ids:
            device.device_config_instance.update_runtime_parameter("auto_collection_enabled", enabled)
            device.device_config_instance.update_runtime_parameter("auto_collection_interval", interval_hours)

    return jsonify({"status": "ok", "auto_collection_active": enabled})


@app.post("/api/settings/change-password")
def change_password():
    """
    Update the admin password hash stored in settings.json.
    The frontend validates the current password client-side; this endpoint
    only persists the new hash for future reference and server-side tooling.

    Request body:
        { "new_password": "…" }

    Response 200:
        { "status": "ok" }
    Response 400:
        { "error": "…" }
    """
    body         = request.get_json(force=True)
    new_password = body.get("new_password", "")

    if not new_password or len(new_password) < 6:
        return _bad("new_password must be at least 6 characters")

    pw_hash = hashlib.sha256(new_password.encode()).hexdigest()
    settings = _load_settings()
    settings["admin_password_hash"] = pw_hash
    _save_settings(settings)

    return jsonify({"status": "ok"})


# ── entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    app.run(host=HOST, port=PORT, debug=True, use_reloader=False)
