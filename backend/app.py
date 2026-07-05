"""
LogOctopus - Flask REST API backend
"""

import hashlib
import json
import os
import signal
import uuid
from pathlib import Path

from flask import Flask, jsonify, request, send_file
from flask_cors import CORS
from paramiko_expect import SSHClientInteraction

from backend.models.device import Device
from backend.models.device_config import DeviceConfig
from backend.utils.config_helper import ConfigurationHelper
from backend.utils.device_config_loader import DeviceConfigLoader
from backend.utils.pcap_decoder import DissectorRegistry, PcapDecoder


SETTINGS_FILE   = Path("settings.json")
FRONTEND_BASE   = os.getenv("FRONTEND_BASE", "http://localhost:8100")
PROJECT_ROOT    = Path(__file__).resolve().parent.parent
DISSECTORS_DIR  = PROJECT_ROOT / "data" / "dissectors"

app = Flask(__name__)
CORS(app)  # allow the React dev-server / built bundle to call the API

# Shared dissector registry — created once at startup so every request that
# decodes packets automatically picks up whatever Lua / native plugins the
# user has uploaded via the settings UI.
dissector_registry = DissectorRegistry(DISSECTORS_DIR)


# ── helpers ───────────────────────────────────────────────────────────────────

def get_current_devices() -> list[Device]:
    """Load all persisted device instances from the data directory.

    Returns:
        list[Device]: All 'Device' objects found under 'data/'.
    """
    return DeviceConfigLoader("data").load_all_devices()


def get_target_device(device_id: str) -> Device | None:
    """Return the 'Device' whose config ID matches device_id.

    Calls get_current_devices() once and searches the result, avoiding a
    second filesystem scan inside a single request.

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
    """
    return {
        "id":                      device.device_config_id,
        "name":                    device.device_name,
        "connection":              device.connection_status,
        "logAccess":               device.log_access,
        "collecting":              device.collection_ongoing,
        "config":                  device.device_config,
        "autoCollectionEnabled":   device.auto_collection_enabled,
        "autoCollectionInterval":  device.auto_collection_interval
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
        "dataUnit":        getattr(snapshot, "data_unit", ""),
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


@app.get("/api/devices/<device_id>/errors")
def get_device_errors(device_id: str):
    """Return the error log for a single device.

    Reads the ``errors.feather`` file written by the device watchdog whenever
    a command execution fails or an SSH exception is recorded.

    GET '/api/devices/<device_id>/errors'

    Path parameters:
        - device_id (str) - The config ID of the device.

    Returns:
        200 OK:
            JSON object with an ``errors`` list.  Each entry contains:

            - time (str) - ISO-formatted timestamp of the error.
            - error_info (str) - Human-readable error description.

            Example::

                {
                    "errors": [
                        {
                            "time": "2024-01-01 10:03:12.456789",
                            "error_info": "cmd 'journalctl -b -n 200 --no-pager' failed with -> timed out"
                        }
                    ]
                }

        404 Not Found:
            '{ "error": "not_found" }' - No device with the given ID exists.
    """
    device = get_target_device(device_id)
    if not device:
        return _bad("not_found", 404)

    errors_path = Path("data") / device_id / "errors.feather"
    if not errors_path.exists():
        return jsonify({"errors": []})

    try:
        import pandas as pd  # lazy import — pandas is a heavy dep; keep it out of module scope
        df = pd.read_feather(str(errors_path))
        # Ensure consistent column presence even if the file is empty
        if df.empty or "time" not in df.columns:
            return jsonify({"errors": []})
        rows = df[["time", "error_info"]].copy()
        rows["time"] = rows["time"].astype(str)
        # Most-recent errors first
        errors = rows.iloc[::-1].to_dict(orient="records")
        return jsonify({"errors": errors})
    except ImportError:
        return _bad("pandas is not installed on the server", 500)
    except Exception as exc:
        return _bad(f"failed to read error log: {exc}", 500)


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
        - page (int, optional) - 1-based page number. Defaults to '1'.
        - page_size (int, optional) - Items per page. Defaults to '25'.
          Clamped to the range [1, 500].

    Returns:
        200 OK:
            JSON object with pagination envelope:

            - items (list[dict]) - Snapshot objects for the requested page.
            - total (int) - Total matching snapshots across all pages.
            - page (int) - Current 1-based page number.
            - page_size (int) - Number of items per page.
            - total_pages (int) - Total number of pages.

            Each item contains:

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

                {
                    "items": [
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
                    ],
                    "total": 1,
                    "page": 1,
                    "page_size": 25,
                    "total_pages": 1
                }
    """
    search_param = request.args.get("search_param")
    search_value = request.args.get("search_value")
    log_type     = request.args.get("log_type", "text")
    is_chart     = log_type == "chart"

    try:
        page      = max(1, int(request.args.get("page", 1)))
        page_size = max(1, min(500, int(request.args.get("page_size", 25))))
    except (TypeError, ValueError):
        return _bad("page and page_size must be integers")

    devices = get_current_devices()

    if search_param and search_value:
        snapshots = ConfigurationHelper.get_filtered_log_snapshots_list(
            devices, search_param, search_value, is_chart
        )
    else:
        snapshots = ConfigurationHelper.get_log_snapshots_list(devices, is_chart)

    total       = len(snapshots)
    total_pages = max(1, -(-total // page_size))   # ceiling division
    page        = min(page, total_pages)            # clamp to valid range
    start       = (page - 1) * page_size
    page_items  = snapshots[start : start + page_size]

    return jsonify({
        "items":       [snapshot_to_dict(s) for s in page_items],
        "total":       total,
        "page":        page,
        "page_size":   page_size,
        "total_pages": total_pages,
    })


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


@app.get("/api/snapshots/<snapshot_id>/packets/<int:packet_number>")
def get_packet_details(snapshot_id: str, packet_number: int):
    """Return the full decoded tshark field detail for a single packet.

    Only valid for "packet_capture" snapshots (produced by
    PcapDecoder.to_log_snapshot / DeviceWatchdog.save_log_snapshots).
    Locates the snapshot's saved '<session_id>.pcap' file via the
    snapshot's device_config_id/session_id and decodes the requested frame
    with PcapDecoder.get_session_packet_details.

    GET '/api/snapshots/<snapshot_id>/packets/<packet_number>'

    Path parameters:
        - snapshot_id (str) - ID of the packet_capture snapshot.
        - packet_number (int) - 1-based tshark frame number, i.e. the
          leading field of PacketInfo.to_content_str() shown at the start
          of each packet line's "content".

    Returns:
        200 OK:
            '{ "packet_number": N, "details": { "<layer>": { "<field>": "<value>", … }, … } }'

        404 Not Found:
            '{ "error": "not_found" }' - No snapshot with the given ID
            exists, it isn't a "packet_capture" snapshot, or no packet
            with that frame number exists in the capture.

        500 Internal Server Error:
            '{ "error": "tshark not available: …" }' - tshark is not
            installed on the server, or the session's pcap file is
            missing on disk.
    """
    devices   = get_current_devices()
    snapshots = ConfigurationHelper.get_log_snapshots_list(devices, log_type_chart=False)

    target = next((s for s in snapshots if s.id == snapshot_id), None)
    if not target or getattr(target, "log_name", "") != "network capture":
        return _bad("not_found", 404)

    device_data_dir = os.path.join("data", target.device_id)
    try:
        details = PcapDecoder.get_session_packet_details(
            device_data_dir, target.session_id, packet_number,
            dissectors_dir=dissector_registry,
        )
    except FileNotFoundError as exc:
        return _bad(f"tshark not available: {exc}", 500)

    if not details:
        return _bad("not_found", 404)

    return jsonify({"packet_number": packet_number, "details": details})


@app.get("/api/snapshots/<snapshot_id>/pcap")
def download_snapshot_pcap(snapshot_id: str):
    """Download the full raw pcap file backing a "network capture" snapshot.

    Only valid for "packet_capture" snapshots (see get_packet_details for
    how the underlying '<session_id>.pcap' file is produced/located).
    Unlike the decoded/paginated view used by the log content and packet
    detail endpoints, this streams the untouched pcap file as-is so it can
    be opened directly in Wireshark or any other pcap tool.

    GET '/api/snapshots/<snapshot_id>/pcap'

    Path parameters:
        - snapshot_id (str) - ID of the "network capture" snapshot.

    Returns:
        200 OK:
            The raw pcap file, streamed as an attachment
            ('application/vnd.tcpdump.pcap').

        404 Not Found:
            '{ "error": "not_found" }' - No snapshot with the given ID
            exists, it isn't a "network capture" snapshot, or its pcap
            file is missing on disk.
    """
    devices   = get_current_devices()
    snapshots = ConfigurationHelper.get_log_snapshots_list(devices, log_type_chart=False)

    target = next((s for s in snapshots if s.id == snapshot_id), None)
    if not target or getattr(target, "log_name", "") != "network capture":
        return _bad("not_found", 404)

    pcap_path = os.path.join(PROJECT_ROOT, "data", target.device_id, f"{target.session_id}.pcap")
    print(pcap_path)
    if not os.path.exists(pcap_path):
        return _bad("not_found", 404)

    device_name = getattr(target, "device_name", "device")
    safe_name = "_".join(device_name.split())
    download_name = f"{safe_name}_{target.session_id}.pcap"

    return send_file(
        pcap_path,
        mimetype="application/vnd.tcpdump.pcap",
        as_attachment=True,
        download_name=download_name,
    )


@app.delete("/api/snapshots")
def remove_snapshots():
    """Remove one or more log snapshots and delete their underlying files.

    DELETE '/api/snapshots'

    Request body (JSON):
        - snapshot_ids (list[str]) - IDs of the snapshots to remove. Required,
          must be a non-empty list.
        - log_type (str, optional) - '"text"' (default) or '"chart"'.
          Must match the type of the target snapshots.

    Returns:
        200 OK:
            JSON object summarising the outcome:

            - removed (list[str]) - IDs that were found and removed.
            - not_found (list[str]) - IDs that did not match any snapshot
              of the requested log_type.

            Example::

                { "removed": ["snap-001", "snap-002"], "not_found": [] }

        400 Bad Request:
            '{ "error": "snapshot_ids must be a non-empty list" }'
    """
    body         = request.get_json(force=True)
    snapshot_ids = body.get("snapshot_ids", [])
    is_chart     = body.get("log_type", "text") == "chart"

    if not isinstance(snapshot_ids, list) or not snapshot_ids:
        return _bad("snapshot_ids must be a non-empty list")

    devices   = get_current_devices()
    snapshots = ConfigurationHelper.get_log_snapshots_list(devices, is_chart)
    by_id     = {s.id: s for s in snapshots}

    removed   = []
    not_found = []
    for snapshot_id in snapshot_ids:
        target = by_id.get(snapshot_id)
        if not target:
            not_found.append(snapshot_id)
            continue
        target.remove_log_snapshot()
        removed.append(snapshot_id)

    return jsonify({"removed": removed, "not_found": not_found})


# ── log collection ────────────────────────────────────────────────────────────

@app.post("/api/start-logs-collection")
def start_logs_collection():
    """Start log collection on the specified devices.

    POST '/api/start-logs-collection'

    Request body (JSON):
        - selected_devices (list[str]) - Device IDs to start collecting from.
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
            or '{ "error": "session_scenario is required and must be a non-empty string" }'
    """
    body             = request.get_json(force=True)
    selected_devices = body.get("selected_devices", [])
    session_scenario = body.get("session_scenario", "")

    if not isinstance(selected_devices, list):
        return _bad("selected_devices must be a list")
    # FIX: also reject empty strings, not just non-str types
    if not isinstance(session_scenario, str) or not session_scenario.strip():
        return _bad("session_scenario is required and must be a non-empty string")

    session_id = uuid.uuid1().hex[:12]
    for device in get_current_devices():
        if device.device_config_id in selected_devices:
            device.start_logs_collection(session_id, session_scenario)

    return jsonify({"status": "logs collection started", "session_id": session_id})


@app.post("/api/stop-logs-collection")
def stop_logs_collection():
    """Stop log collection on the specified devices and return result URLs.

    POST '/api/stop-logs-collection'

    Each device is stopped and the call blocks (up to 300 seconds per device)
    until its teardown is complete before returning. If teardown does not
    finish within the timeout for a device (i.e. not all snapshots were
    saved in time), the request still returns 200 with whatever session
    URLs are available — partial results are preferred over failing the
    request outright.

    Request body (JSON):
        - selected_devices (list[str]) - Device IDs to stop collecting from.
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

    current_devices = get_current_devices()
    for device in current_devices:
        if device.device_config_id in selected_devices:
            device.stop_logs_collection()
    for device in current_devices:
        if device.device_config_id in selected_devices:
            try:
                device.wait_for_log_collection_teardown(timeout=300)
            except Exception:
                # Teardown didn't finish within the timeout (e.g. not all
                # snapshots were saved in time). Don't fail the request for
                # this — fall through and return the session URLs anyway so
                # the frontend can still show whatever was saved so far.
                pass

    base = FRONTEND_BASE
    qs   = f"search_param=Session%20ID&search_value={session_id}"
    return jsonify({
        "status":         "logs collection stopped",
        "session_id":     session_id,
        "text_logs_url":  f"{base}/?{qs}&log_type=text",
        "chart_logs_url": f"{base}/?{qs}&log_type=chart",
    })


@app.get("/api/settings/auto-collection")
def get_auto_collection():
    """Return the current auto-collection settings for all devices.

    GET '/api/settings/auto-collection'

    Returns:
        200 OK:
            - devices (list[dict]) - Per-device auto-collection config.
              Each entry contains:

              - device_id (str) - Device config ID.
              - enabled (bool) - Whether auto-collection is active.
              - interval_hours (float) - Configured collection interval.

            Example::

                {
                    "devices": [
                        {
                            "device_id": "abc123",
                            "enabled": true,
                            "interval_hours": 4.0
                        }
                    ]
                }
    """
    result = []
    for device in get_current_devices():
        cfg = device.device_config or {}
        result.append({
            "device_id":      device.device_config_id,
            "enabled":        bool(cfg.get("auto_collection_enabled", False)),
            "interval_hours": float(cfg.get("auto_collection_interval", 1)),
        })
    return jsonify({"devices": result})


@app.post("/api/settings/auto-collection")
def set_auto_collection():
    """Persist the auto-collection schedule and register the server-side interval job.

    POST '/api/settings/auto-collection'

    Configures auto-collection for one or more devices independently.
    Each device can have its own enabled flag and interval.

    Request body (JSON):
        - enabled (bool) - Whether auto-collection should be active for these devices.
        - interval_hours (float) - Collection interval in hours.
          Typical values: '1', '2', '4', '6', '12', '24'.  Must be positive.
        - device_ids (list[str]) - Config IDs of devices to configure.

    Returns:
        200 OK:
            - status (str) - '"ok"'.
            - devices (list[dict]) - Updated per-device state, each containing:

              - device_id (str) - Device config ID.
              - enabled (bool) - The enabled value that was persisted.
              - interval_hours (float) - The interval that was persisted.

            Example::

                {
                    "status": "ok",
                    "devices": [
                        { "device_id": "abc123", "enabled": true, "interval_hours": 4.0 }
                    ]
                }

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

    updated = []
    for device in get_current_devices():
        if device.device_config_id in device_ids:
            device.device_config_instance.update_runtime_parameter("auto_collection_enabled", enabled)
            device.device_config_instance.update_runtime_parameter("auto_collection_interval", interval_hours)
            device.device_config_instance.update_runtime_parameter("session_scenario", "auto-logs-collection")
            updated.append({
                "device_id":      device.device_config_id,
                "enabled":        enabled,
                "interval_hours": interval_hours,
            })

    return jsonify({"status": "ok", "devices": updated})


# ── device config builder helpers ─────────────────────────────────────────────
#
# Connection building now lives in backend.utils.fabric_connection, shared
# with device_watchdog.py, so that a connection (including ssh_key_string of
# any supported type, with or without a passphrase, and either gateway
# shape) which passes Test Connection here behaves identically once the
# watchdog picks up the saved config. See that module's docstring for the
# accepted field/gateway shapes.
from backend.utils.fabric_connection import build_nested_connection as _build_nested_connection


@app.post("/api/devices/test-connection")
def test_device_connection():
    """Test SSH connectivity to a device using provided credentials.

    Supports an optional ``gateways`` list for multi-hop / jump-host setups.
    Each gateway entry uses the same schema as the target device.  Hops are
    chained left-to-right: gateways[0] → gateways[1] → … → target.

    POST '/api/devices/test-connection'

    Request body (JSON):
        - ip_address (str)          - Target IP address.
        - port (int)                - SSH port (default 22).
        - user (str)                - SSH username.
        - password (str)            - SSH password.
        - ssh_key_string (str)      - Optional PEM private key as a plain string.
          RSA, Ed25519, ECDSA, and DSS keys are all auto-detected.
        - ssh_key_path (str)        - Optional path to a private key file on
          the server, as an alternative to ssh_key_string.
        - ssh_key_passphrase (str)  - Optional passphrase for an encrypted
          ssh_key_string / ssh_key_path.
        - gateways (list[dict])     - Optional ordered list of jump-host specs.
          Each entry uses the same auth fields as the target
          (ip_address, port, user, password, ssh_key_string, ssh_key_path,
          ssh_key_passphrase).

    Returns:
        200 OK:
            '{ "success": true,  "message": "Connected to …" }'
        200 OK (failure):
            '{ "success": false, "message": "<error details>" }'
        400 Bad Request:
            '{ "error": "missing required fields" }'
    """
    try:
        from fabric import Connection  # noqa: F401  (validate import)
    except ImportError:
        return jsonify({"success": False, "message": "fabric not installed on server"}), 200

    body = request.get_json(force=True)
    ip   = body.get("ip_address", "").strip()
    port = int(body.get("port", 22))
    user = body.get("user", "").strip()

    if not ip or not user:
        return _bad("missing required fields: ip_address, user")

    try:
        conn = _build_nested_connection(body)
        conn.open()
        conn.close()
        hops = body.get("gateways") or []
        via  = f" via {len(hops)} gateway(s)" if hops else ""
        return jsonify({"success": True, "message": f"Connected to {ip}:{port} as {user}{via}"})
    except Exception as exc:
        return jsonify({"success": False, "message": str(exc)})


@app.post("/api/devices/exec-command")
def exec_device_command():
    """Execute a shell command on a remote device via SSH and return its output.

    Uses Fabric for the SSH transport.  Supports multi-hop gateway chains and
    an optional custom-shell-prompt mode for interactive shells (e.g. network
    devices that don't expose a standard exec channel).

    POST '/api/devices/exec-command'

    Request body (JSON):
        - ip_address (str)           - Target IP address.
        - port (int)                 - SSH port (default 22).
        - user (str)                 - SSH username.
        - password (str)             - SSH password.
        - ssh_key_string (str)       - Optional PEM private key as a plain string.
          RSA, Ed25519, ECDSA, and DSS keys are all auto-detected.
        - ssh_key_path (str)         - Optional path to a private key file on
          the server, as an alternative to ssh_key_string.
        - ssh_key_passphrase (str)   - Optional passphrase for an encrypted
          ssh_key_string / ssh_key_path.
        - command (str)              - Shell command to run on the remote device.
        - custom_shell_prompt (str)  - Optional. When set, the command is sent
          to an interactive shell and output is captured until this prompt
          string appears in the stream.
        - gateways (list[dict])      - Optional ordered list of jump-host specs.
          Each entry uses the same auth fields as the target
          (ip_address, port, user, password, ssh_key_string, ssh_key_path,
          ssh_key_passphrase).

    Returns:
        200 OK:
            '{ "stdout": "...", "stderr": "...", "exit_code": 0 }'
        400 Bad Request:
            '{ "error": "missing required fields" }'
        200 OK (connection failure):
            '{ "stdout": "", "stderr": "<error>", "exit_code": -1 }'
    """
    body                = request.get_json(force=True)
    command             = body.get("command", "").strip()
    custom_shell_prompt = body.get("custom_shell_prompt", "").strip()

    if not body.get("ip_address", "").strip() or not body.get("user", "").strip() or not command:
        return _bad("missing required fields: ip_address, user, command")

    try:
        conn = _build_nested_connection(body)
        if custom_shell_prompt:
            # FIX: use try/finally so the connection is always closed even if
            # SSHClientInteraction raises mid-way through command execution.
            conn.open()
            try:
                client = conn.client
                interact = SSHClientInteraction(client, timeout=20, display=False)
                interact.expect(custom_shell_prompt)
                cmd_output = ""
                for single_cmd in command.split(";"):
                    interact.send(single_cmd)
                    interact.expect(custom_shell_prompt)
                    cmd_output = cmd_output + interact.current_output_clean
            finally:
                conn.close()
            return jsonify({"stdout": cmd_output, "stderr": "", "exit_code": 0})

        # ── Standard exec path ────────────────────────────────────────────────
        needs_sudo = "sudo " in command
        with conn:
            if needs_sudo:
                pwd = body.get("password", "")
                result = conn.sudo(command, password=pwd, hide=True, timeout=15)
            else:
                result = conn.run(command, hide=True, timeout=15)

        return jsonify({
            "stdout":    result.stdout,
            "stderr":    result.stderr,
            "exit_code": result.return_code,
        })

    except Exception as exc:
        return jsonify({"stdout": "", "stderr": str(exc), "exit_code": -1})


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



# ── dissectors ────────────────────────────────────────────────────────────────

@app.get("/api/settings/dissectors")
def list_dissectors():
    """Return the list of custom dissector files installed on the server.

    GET '/api/settings/dissectors'

    Returns:
        200 OK:
            JSON array of dissector objects. Each element contains:

            - name (str) - Bare filename (e.g. ``"my_proto.lua"``).
            - size_bytes (int) - File size in bytes.
            - extension (str) - File extension, e.g. ``".lua"``.

            Example::

                [
                    {"name": "my_proto.lua", "size_bytes": 1024, "extension": ".lua"}
                ]
    """
    return jsonify(dissector_registry.list_dissectors())


@app.post("/api/settings/dissectors")
def upload_dissector():
    """Upload a custom tshark dissector file (Lua script or native plugin).

    The file is saved to the server's dissectors directory and automatically
    loaded by tshark on every subsequent packet-detail request.

    POST '/api/settings/dissectors'

    Request body (multipart/form-data):
        - file (file) - The dissector file to upload.
          Accepted extensions: ``.lua``, ``.so``, ``.dll``.

    Returns:
        201 Created:
            JSON object describing the saved file:

            - name (str) - Saved filename.
            - size_bytes (int) - File size in bytes.
            - extension (str) - File extension.

            Example::

                {"name": "my_proto.lua", "size_bytes": 1024, "extension": ".lua"}

        400 Bad Request:
            ``{"error": "no file provided"}`` — request contained no file part.

            ``{"error": "filename is required"}`` — file part had an empty name.

            ``{"error": "unsupported dissector extension …"}`` — the extension is
            not in the allowed set (``.lua``, ``.so``, ``.dll``).
    """
    if "file" not in request.files:
        return _bad("no file provided")

    f = request.files["file"]
    if not f.filename:
        return _bad("filename is required")

    try:
        data = f.read()
        saved = dissector_registry.save(f.filename, data)
    except ValueError as exc:
        return _bad(str(exc))

    return jsonify({
        "name":       saved.name,
        "size_bytes": saved.stat().st_size,
        "extension":  saved.suffix.lower(),
    }), 201


@app.delete("/api/settings/dissectors/<filename>")
def delete_dissector(filename: str):
    """Remove a custom dissector file from the server.

    DELETE '/api/settings/dissectors/<filename>'

    Path parameters:
        - filename (str) - Bare filename of the dissector to remove
          (e.g. ``"my_proto.lua"``).  Path separators are stripped server-side
          to prevent directory-traversal attacks.

    Returns:
        200 OK:
            ``{"deleted": true}`` — file existed and was removed.

            ``{"deleted": false}`` — no file with that name was found
            (treated as a no-op rather than a 404 so repeated DELETE calls
            are idempotent).
    """
    deleted = dissector_registry.delete(filename)
    return jsonify({"deleted": deleted})


# ── login ─────────────────────────────────────────────────────────────────────

@app.post("/api/auth/login")
def login():
    """Verify credentials and return an auth token for the session.

    Compares the SHA-256 hash of the submitted password against the hash
    stored in 'settings.json'.  Falls back to the default password
    ('logoctopus') if no hash has been persisted yet.

    POST '/api/auth/login'

    Request body (JSON):
        - username (str) - Must match the configured admin username.
        - password (str) - Plain-text password; compared via SHA-256 hash.

    Returns:
        200 OK:
            '{ "status": "ok", "token": "<32-char hex>" }'

        401 Unauthorized:
            '{ "error": "invalid credentials" }'
    """
    body     = request.get_json(force=True)
    username = body.get("username", "").strip()
    password = body.get("password", "")

    admin_user = os.getenv("ADMIN_USER", "admin")
    if username != admin_user:
        return _bad("invalid credentials", 401)

    settings         = _load_settings()
    default_pw_hash  = hashlib.sha256(b"logoctopus").hexdigest()
    stored_hash      = settings.get("admin_password_hash", default_pw_hash)
    submitted_hash   = hashlib.sha256(password.encode()).hexdigest()

    if submitted_hash != stored_hash:
        return _bad("invalid credentials", 401)

    # Issue a simple random token stored server-side in settings.
    # For production use, replace with a proper session/JWT library.
    token = uuid.uuid4().hex
    settings.setdefault("auth_tokens", [])
    # Keep at most 10 active tokens to bound memory use.
    settings["auth_tokens"] = (settings["auth_tokens"] + [token])[-10:]
    _save_settings(settings)

    return jsonify({"status": "ok", "token": token})


@app.post("/api/auth/logout")
def logout():
    """Invalidate the current auth token.

    POST '/api/auth/logout'

    Request body (JSON):
        - token (str) - The token to revoke.

    Returns:
        200 OK: '{ "status": "ok" }'
    """
    body  = request.get_json(force=True)
    token = body.get("token", "")

    settings = _load_settings()
    tokens   = settings.get("auth_tokens", [])
    if token in tokens:
        tokens.remove(token)
        settings["auth_tokens"] = tokens
        _save_settings(settings)

    return jsonify({"status": "ok"})
