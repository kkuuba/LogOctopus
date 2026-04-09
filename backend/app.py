"""
LogOctopus - Flask REST API backend
"""

import hashlib
import json
import os
import signal
import uuid
from pathlib import Path

from flask import Flask, jsonify, request
from flask_cors import CORS

from backend.models.device import Device
from backend.models.device_config import DeviceConfig
from backend.utils.config_helper import ConfigurationHelper
from backend.utils.device_config_loader import DeviceConfigLoader


SETTINGS_FILE = Path("settings.json")
FRONTEND_BASE = os.getenv("FRONTEND_BASE", "http://localhost:8100")

app = Flask(__name__)
CORS(app)  # allow the React dev-server / built bundle to call the API


# ── helpers ───────────────────────────────────────────────────────────────────

def get_current_devices() -> list[Device]:
    """Load all persisted device instances from the data directory.

    Returns:
        list[Device]: All 'Device' objects found under 'data/'.
    """
    return DeviceConfigLoader("data").load_all_devices()


def get_target_device(device_id: str) -> Device | None:
    """Return the 'Device' whose config ID matches device_id.

    Args:
        device_id (str): The device config ID to look up.

    Returns:
        Device | None: The matching 'Device', or 'None' if not found.
    """
    for device in get_current_devices():
        if device.device_config_id == device_id:
            return device
    return None


def device_to_dict(device: Device) -> dict:
    """Serialise a 'Device' to a JSON-safe dict for the frontend.

    Args:
        device (Device): The device instance to serialise.

    Returns:
        dict: A dictionary with the following keys:

        - id (str) - Unique device config ID.
        - name (str) - Human-readable device name.
        - connection (str) - Current connection status (e.g. '"connected"', '"disconnected"').
        - logAccess (bool) - Whether log access is available on the device.
        - collecting (bool) - Whether log collection is currently in progress.
        - config (dict) - Raw device configuration mapping.
        - auto_collection_enabled (bool) - Define if auto logs collection enabled on device.
        - auto_collection_interval (float) - Define auto logs collection interval in hours.
    """
    return {
        "id":                       device.device_config_id,
        "name":                     device.device_name,
        "connection":               device.connection_status,
        "logAccess":                device.log_access,
        "collecting":               device.collection_ongoing,
        "config":                   device.device_config,
        "auto_collection_enabled":  device.auto_collection_enabled,
        "auto_collection_interval": device.auto_collection_interval
    }


def snapshot_to_dict(snapshot) -> dict:
    """Serialise a log snapshot object to a JSON-safe dict.

    Args:
        snapshot: A log snapshot instance (text or chart).

    Returns:
        dict: A dictionary with the following keys:

        - id (str) - Unique snapshot ID.
        - deviceName (str) - Name of the originating device.
        - logName (str) - Name of the log source.
        - startTime (str) - ISO-formatted collection start timestamp.
        - finishTime (str) - ISO-formatted collection finish timestamp.
        - duration (float) - Collection duration in seconds.
        - sizeKb (int) - Snapshot file size in kilobytes.
        - sessionId (str) - Session identifier shared across a collection run.
        - sessionScenario (str) - Scenario label provided when the session was started.
        - isChart (bool) - 'True' when the snapshot contains chart data, 'False' for plain text.
    """
    return {
        "id":              snapshot.id,
        "deviceName":      snapshot.device_name,
        "logName":         snapshot.log_name,
        "startTime":       str(snapshot.start_time),
        "finishTime":      str(snapshot.finish_time),
        "duration":        snapshot.logs_collection_duration,
        "sizeKb":          int(snapshot.size_in_bytes / 1000),
        "sessionId":       snapshot.session_id,
        "sessionScenario": getattr(snapshot, "session_scenario", ""),
        "isChart":         snapshot.log_type,
    }


def _bad(msg: str, code: int = 400):
    """Return a JSON error response.

    Args:
        msg (str): Human-readable error message.
        code (int): HTTP status code. Defaults to '400'.

    Returns:
        tuple[Response, int]: Flask response with '{"error": msg}' body and code.
    """
    return jsonify({"error": msg}), code


def _load_settings() -> dict:
    """Load application settings from 'settings.json'.

    Returns:
        dict: Parsed settings, or an empty dict if the file is missing or malformed.
    """
    if SETTINGS_FILE.exists():
        try:
            return json.loads(SETTINGS_FILE.read_text())
        except Exception:
            pass
    return {}


def _save_settings(settings: dict) -> None:
    """Persist application settings to 'settings.json'.

    Args:
        settings (dict): Settings mapping to serialise and write.
    """
    SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    SETTINGS_FILE.write_text(json.dumps(settings, indent=2))


# ── devices ───────────────────────────────────────────────────────────────────

@app.get("/api/devices")
def list_devices():
    """Return the list of all managed devices with their current statuses.

    GET '/api/devices'

    Returns:
        200 OK:
            JSON array of device objects.  Each element contains:

            - id (str) - Unique device config ID.
            - name (str) - Human-readable device name.
            - connection (str) - Current connection status.
            - logAccess (bool) - Whether log access is available.
            - collecting (bool) - Whether collection is in progress.
            - config (dict) - Raw device configuration.

            Example::

                [
                    {
                        "id": "abc123",
                        "name": "Router-A",
                        "connection": "connected",
                        "logAccess": true,
                        "collecting": false,
                        "config": {}
                    }
                ]
    """
    return jsonify([device_to_dict(d) for d in get_current_devices()])


@app.post("/api/devices")
def add_device():
    """Add a new device from a base-64-encoded JSON config payload.

    POST '/api/devices'

    Request body (JSON):
        - contents (str) - Base-64-encoded config file content.
          Optionally prefixed with a data-URI header
          ('data:<mime>;base64,<data>'); the prefix is stripped automatically.

    Returns:
        201 Created:
            JSON object containing the newly created device:

            - device (dict) - Serialised device (see :func:`device_to_dict`).

            Example::

                { "device": { "id": "abc123", "name": "Router-A", … } }

        422 Unprocessable Entity:
            '{ "error": "invalid_config" }' - The decoded config failed
            validation; it has been cleaned up and no device was persisted.
    """
    body = request.get_json(force=True)
    contents = body.get("contents", "")

    # Strip data-URI prefix if the frontend sent "data:<mime>;base64,<data>"
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
    """Remove a single device and terminate its watchdog process.

    DELETE '/api/devices/<device_id>'

    Path parameters:
        - device_id (str) - The config ID of the device to remove.

    Returns:
        204 No Content:
            Empty body; device data has been deleted and the watchdog
            process (if any) has received 'SIGTERM'.

        404 Not Found:
            '{ "error": "not_found" }' - No device with the given ID exists.
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
    """Return details for a single device.

    GET '/api/devices/<device_id>'

    Path parameters:
        - device_id (str) - The config ID of the device to retrieve.

    Returns:
        200 OK:
            Serialised device object (see :func:`device_to_dict`).

            Example::

                {
                    "id": "abc123",
                    "name": "Router-A",
                    "connection": "connected",
                    "logAccess": true,
                    "collecting": false,
                    "config": {}
                }

        404 Not Found:
            '{ "error": "not_found" }' - No device with the given ID exists.
    """
    device = get_target_device(device_id)
    if not device:
        return _bad("not_found", 404)
    return jsonify(device_to_dict(device))


# ── log snapshots ─────────────────────────────────────────────────────────────

@app.get("/api/snapshots")
def list_snapshots():
    """Return log snapshots, optionally filtered by a search predicate.

    GET '/api/snapshots'

    Query parameters:
        - search_param (str, optional) - Field to filter on.
          Accepted values: '"Device"', '"Log Name"', '"Session ID"'.
        - search_value (str, optional) - Value to match against search_param.
          Filtering is only applied when both parameters are present.
        - log_type (str, optional) - '"text"' (default) or '"chart"'.

    Returns:
        200 OK:
            JSON array of snapshot objects.  Each element contains:

            - id (str) - Unique snapshot ID.
            - deviceName (str) - Originating device name.
            - logName (str) - Log source name.
            - startTime (str) - ISO-formatted collection start timestamp.
            - finishTime (str) - ISO-formatted collection finish timestamp.
            - duration (float) - Collection duration in seconds.
            - sizeKb (int) - File size in kilobytes.
            - sessionId (str) - Shared session identifier.
            - isChart (bool) - 'True' for chart snapshots.

            Example::

                [
                    {
                        "id": "snap-001",
                        "deviceName": "Router-A",
                        "logName": "syslog",
                        "startTime": "2024-01-01 10:00:00",
                        "finishTime": "2024-01-01 10:05:00",
                        "duration": 300.0,
                        "sizeKb": 42,
                        "sessionId": "a1b2c3d4e5f6",
                        "isChart": false
                    }
                ]
    """
    search_param = request.args.get("search_param")
    search_value = request.args.get("search_value")
    log_type     = request.args.get("log_type", "text")
    is_chart     = log_type == "chart"

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
    """Return the full log content for a single snapshot.

    GET '/api/snapshots/<snapshot_id>/content'

    Path parameters:
        - snapshot_id (str) - The ID of the snapshot to retrieve.

    Query parameters:
        - log_type (str, optional) - '"text"' (default) or '"chart"'.
          Must match the type of the target snapshot.

    Returns:
        200 OK - Text logs:
            '{ "rows": [{ "timestamp": "…", "log_name": "…", "content": "…" }, …] }'

        200 OK - Chart data:
            '{ "rows": [{ "time": "…", "content": … }, …] }'

        404 Not Found:
            '{ "error": "not_found" }' - No snapshot with the given ID exists
            for the requested log type.
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
    """Start log collection on the specified devices.

    POST '/api/start-logs-collection'

    Request body (JSON):
        - selected_devices (list[str]) - Device names to start collecting from.
        - session_scenario (str, **required**) - A label describing the scenario
          under which this collection session is being started.  Must be a
          non-empty string.  Passed as the second argument to
          ``device.start_logs_collection``.

    Returns:
        200 OK:
            '{ "status": "logs collection started", "session_id": "<12-char hex>" }'

            - status (str) - Human-readable confirmation.
            - session_id (str) - Randomly generated 12-character hex string
              that groups all snapshots produced in this collection run.

        400 Bad Request:
            '{ "error": "selected_devices must be a list" }'
            or '{ "error": "session_scenario must be a string" }'
    """
    body             = request.get_json(force=True)
    selected_devices = body.get("selected_devices", [])
    session_scenario = body.get("session_scenario", "")

    if not isinstance(selected_devices, list):
        return _bad("selected_devices must be a list")
    if not isinstance(session_scenario, str):
        return _bad("session_scenario is required and must be a non-empty string")

    session_id = uuid.uuid1().hex[:12]
    for device in get_current_devices():
        if device.device_name in selected_devices:
            device.start_logs_collection(session_id, session_scenario)

    return jsonify({"status": "logs collection started", "session_id": session_id})


@app.post("/api/stop-logs-collection")
def stop_logs_collection():
    """Stop log collection on the specified devices and return result URLs.

    POST '/api/stop-logs-collection'

    Each device is stopped and the call blocks (up to 60 seconds per device)
    until its teardown is complete before returning.

    Request body (JSON):
        - selected_devices (list[str]) - Device names to stop collecting from.
        - session_id (str) - The session ID returned by '/api/start-logs-collection'.

    Returns:
        200 OK:
            - status (str) - Human-readable confirmation ('"logs collection stopped"').
            - session_id (str) - Echo of the provided session ID.
            - text_logs_url (str) - Deep-link to the frontend filtered to text
              snapshots for this session.
            - chart_logs_url (str) - Deep-link to the frontend filtered to chart
              snapshots for this session.

            Example::

                {
                    "status": "logs collection stopped",
                    "session_id": "a1b2c3d4e5f6",
                    "text_logs_url": "http://localhost:8100/?search_param=Session%20ID&search_value=a1b2c3d4e5f6&log_type=text",
                    "chart_logs_url": "http://localhost:8100/?search_param=Session%20ID&search_value=a1b2c3d4e5f6&log_type=chart"
                }

        400 Bad Request:
            '{ "error": "selected_devices must be a list" }'
            or '{ "error": "session_id must be a string" }'.
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

    base = FRONTEND_BASE
    qs   = f"search_param=Session%20ID&search_value={session_id}"
    return jsonify({
        "status":         "logs collection stopped",
        "session_id":     session_id,
        "text_logs_url":  f"{base}/?{qs}&log_type=text",
        "chart_logs_url": f"{base}/?{qs}&log_type=chart",
    })


@app.post("/api/settings/auto-collection")
def set_auto_collection():
    """Persist the auto-collection schedule and register the server-side interval job.

    POST '/api/settings/auto-collection'

    If APScheduler is installed, a recurring interval job is registered (or
    updated if one already exists) using the provided interval_hours.

    Request body (JSON):
        - enabled (bool) - Whether auto-collection should be active.
        - interval_hours (float) - Collection interval.
          Typical values: '1', '2', '4', '6', '12', '24'.
          Must be positive.
        - device_ids (list[str]) - Config IDs of devices to configure.

    Returns:
        200 OK:
            - status (str) - '"ok"'.
            - auto_collection_active (bool) - Reflects the enabled value
              that was persisted.

            Example::

                { "status": "ok", "auto_collection_active": true }

        400 Bad Request:
            '{ "error": "device_ids must be a list" }'
            or '{ "error": "interval_hours must be positive" }'.
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
            device.device_config_instance.update_runtime_parameter("session_scenario", "auto_logs_collection")
            device.device_config_instance.update_runtime_parameter("auto_collection_interval", interval_hours)

    return jsonify({"status": "ok", "auto_collection_active": enabled})


@app.post("/api/settings/change-password")
def change_password():
    """Update the admin password hash stored in 'settings.json'.

    The plain-text password is never persisted; only its SHA-256 digest is
    stored under the 'admin_password_hash' key.

    POST '/api/settings/change-password'

    Request body (JSON):
        - new_password (str) - The desired new password.
          Must be at least 6 characters long.

    Returns:
        200 OK:
            '{ "status": "ok" }' - Password hash updated successfully.

        400 Bad Request:
            '{ "error": "new_password must be at least 6 characters" }' -
            The provided password is empty or too short.
    """
    body         = request.get_json(force=True)
    new_password = body.get("new_password", "")

    if not new_password or len(new_password) < 6:
        return _bad("new_password must be at least 6 characters")

    pw_hash  = hashlib.sha256(new_password.encode()).hexdigest()
    settings = _load_settings()
    settings["admin_password_hash"] = pw_hash
    _save_settings(settings)

    return jsonify({"status": "ok"})
