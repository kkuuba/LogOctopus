"""
Tests for LogOctopus Flask REST API (app.py)

Run with:
    pytest tests/test_app.py -v

Dependencies:
    pip install pytest pytest-mock flask
"""

import hashlib
import json
from unittest.mock import MagicMock, patch

import pytest

from backend.app import app


# ── fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture
def client():
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


def _make_device(
    device_id="dev-001",
    name="Router-A",
    connection="connected",
    log_access=True,
    collecting=False,
    config=None,
    auto_collection_enabled=False,
    auto_collection_interval=0.0
):
    """Return a mock Device with sensible defaults."""
    device = MagicMock()
    device.device_config_id         = device_id
    device.device_name              = name
    device.connection_status        = connection
    device.log_access               = log_access
    device.collection_ongoing       = collecting
    device.device_config            = config or {}
    device.auto_collection_enabled  = auto_collection_enabled
    device.auto_collection_interval = auto_collection_interval
    return device


def _make_snapshot(
    snap_id="snap-001",
    device_name="Router-A",
    log_name="syslog",
    start_time="2024-01-01 10:00:00",
    finish_time="2024-01-01 10:05:00",
    duration=300.0,
    size_bytes=42_000,
    session_id="abc123def456",
    session_scenario="test_1",
    log_type=False,
):
    """Return a mock snapshot with sensible defaults."""
    snap = MagicMock()
    snap.id                       = snap_id
    snap.device_name              = device_name
    snap.log_name                 = log_name
    snap.start_time               = start_time
    snap.finish_time              = finish_time
    snap.logs_collection_duration = duration
    snap.size_in_bytes            = size_bytes
    snap.session_id               = session_id
    snap.session_scenario         = session_scenario
    snap.log_type                 = log_type
    return snap


# ── GET /api/devices ──────────────────────────────────────────────────────────

class TestListDevices:
    def test_returns_empty_list_when_no_devices(self, client):
        with patch("backend.app.get_current_devices", return_value=[]):
            resp = client.get("/api/devices")
        assert resp.status_code == 200
        assert resp.get_json() == []

    def test_returns_serialised_device_list(self, client):
        device = _make_device()
        with patch("backend.app.get_current_devices", return_value=[device]):
            resp = client.get("/api/devices")
        data = resp.get_json()
        assert resp.status_code == 200
        assert len(data) == 1
        assert data[0]["id"]         == "dev-001"
        assert data[0]["name"]       == "Router-A"
        assert data[0]["connection"] == "connected"
        assert data[0]["logAccess"]  is True
        assert data[0]["collecting"] is False

    def test_returns_multiple_devices(self, client):
        devices = [_make_device("d1", "A"), _make_device("d2", "B")]
        with patch("backend.app.get_current_devices", return_value=devices):
            resp = client.get("/api/devices")
        assert len(resp.get_json()) == 2


# ── GET /api/devices/<device_id> ──────────────────────────────────────────────

class TestGetDevice:
    def test_returns_device_when_found(self, client):
        device = _make_device()
        with patch("backend.app.get_target_device", return_value=device):
            resp = client.get("/api/devices/dev-001")
        assert resp.status_code == 200
        assert resp.get_json()["id"] == "dev-001"

    def test_returns_404_when_not_found(self, client):
        with patch("backend.app.get_target_device", return_value=None):
            resp = client.get("/api/devices/nonexistent")
        assert resp.status_code == 404
        assert resp.get_json()["error"] == "not_found"


# ── POST /api/devices ─────────────────────────────────────────────────────────

class TestAddDevice:
    def _post(self, client, contents):
        return client.post(
            "/api/devices",
            data=json.dumps({"contents": contents}),
            content_type="application/json",
        )

    def test_creates_device_from_valid_config(self, client):
        mock_config = MagicMock()
        mock_config.validate_device_config.return_value = True
        mock_device = _make_device()

        with (
            patch("backend.app.DeviceConfig", return_value=mock_config),
            patch("backend.app.Device", return_value=mock_device),
        ):
            resp = self._post(client, "dmFsaWRfY29uZmln")  # base64 payload

        assert resp.status_code == 201
        assert resp.get_json()["device"]["id"] == "dev-001"

    def test_strips_data_uri_prefix(self, client):
        mock_config = MagicMock()
        mock_config.validate_device_config.return_value = True
        mock_device = _make_device()

        with (
            patch("backend.app.DeviceConfig", return_value=mock_config) as dc_cls,
            patch("backend.app.Device", return_value=mock_device),
        ):
            self._post(client, "data:application/json;base64,dmFsaWQ=")

        # DeviceConfig should have received only the base64 part
        dc_cls.assert_called_once_with("dmFsaWQ=")

    def test_returns_422_for_invalid_config(self, client):
        mock_config = MagicMock()
        mock_config.validate_device_config.return_value = False

        with patch("backend.app.DeviceConfig", return_value=mock_config):
            resp = self._post(client, "aW52YWxpZA==")

        assert resp.status_code == 422
        assert resp.get_json()["error"] == "invalid_config"
        mock_config.remove_device_config.assert_called_once()

    def test_missing_contents_defaults_to_empty_string(self, client):
        mock_config = MagicMock()
        mock_config.validate_device_config.return_value = False

        with patch("backend.app.DeviceConfig", return_value=mock_config):
            resp = client.post(
                "/api/devices",
                data=json.dumps({}),
                content_type="application/json",
            )

        assert resp.status_code == 422


# ── DELETE /api/devices/<device_id> ──────────────────────────────────────────

class TestRemoveDevice:
    def test_removes_existing_device(self, client):
        device = _make_device()
        device.device_config = {}  # no watchdog PID

        with patch("backend.app.get_target_device", return_value=device):
            resp = client.delete("/api/devices/dev-001")

        assert resp.status_code == 204
        device.remove_device_data.assert_called_once()

    def test_kills_watchdog_process_if_pid_present(self, client):
        device = _make_device()
        device.device_config = {"watchdog_process_pid": 9999}

        with (
            patch("backend.app.get_target_device", return_value=device),
            patch("backend.app.os.kill") as mock_kill,
        ):
            resp = client.delete("/api/devices/dev-001")

        assert resp.status_code == 204
        mock_kill.assert_called_once_with(9999, __import__("signal").SIGTERM)

    def test_ignores_missing_watchdog_process(self, client):
        device = _make_device()
        device.device_config = {"watchdog_process_pid": 9999}

        with (
            patch("backend.app.get_target_device", return_value=device),
            patch("backend.app.os.kill", side_effect=ProcessLookupError),
        ):
            resp = client.delete("/api/devices/dev-001")

        assert resp.status_code == 204

    def test_returns_404_when_not_found(self, client):
        with patch("backend.app.get_target_device", return_value=None):
            resp = client.delete("/api/devices/nonexistent")
        assert resp.status_code == 404
        assert resp.get_json()["error"] == "not_found"


# ── GET /api/snapshots ────────────────────────────────────────────────────────

class TestListSnapshots:
    def test_returns_all_snapshots_by_default(self, client):
        snap = _make_snapshot()
        with (
            patch("backend.app.get_current_devices", return_value=[]),
            patch(
                "backend.app.ConfigurationHelper.get_log_snapshots_list",
                return_value=[snap],
            ),
        ):
            resp = client.get("/api/snapshots")

        assert resp.status_code == 200
        data = resp.get_json()
        assert len(data) == 1
        assert data[0]["id"]        == "snap-001"
        assert data[0]["deviceName"] == "Router-A"
        assert data[0]["sizeKb"]    == 42
        assert data[0]["isChart"]   is False

    def test_uses_filtered_list_when_search_params_provided(self, client):
        snap = _make_snapshot()
        with (
            patch("backend.app.get_current_devices", return_value=[]),
            patch(
                "backend.app.ConfigurationHelper.get_filtered_log_snapshots_list",
                return_value=[snap],
            ) as mock_filtered,
        ):
            resp = client.get("/api/snapshots?search_param=Device&search_value=Router-A")

        assert resp.status_code == 200
        mock_filtered.assert_called_once()

    def test_chart_log_type_sets_is_chart_true(self, client):
        with (
            patch("backend.app.get_current_devices", return_value=[]),
            patch(
                "backend.app.ConfigurationHelper.get_log_snapshots_list",
                return_value=[],
            ) as mock_list,
        ):
            client.get("/api/snapshots?log_type=chart")

        mock_list.assert_called_once_with([], True)

    def test_returns_empty_list_when_no_snapshots(self, client):
        with (
            patch("backend.app.get_current_devices", return_value=[]),
            patch("backend.app.ConfigurationHelper.get_log_snapshots_list", return_value=[]),
        ):
            resp = client.get("/api/snapshots")
        assert resp.get_json() == []


# ── GET /api/snapshots/<snapshot_id>/content ─────────────────────────────────

class TestGetSnapshotContent:
    def test_returns_content_rows_for_valid_snapshot(self, client):
        snap = _make_snapshot()
        mock_df = MagicMock()
        mock_df.to_dict.return_value = [{"timestamp": "t", "log_name": "syslog", "content": "msg"}]

        with (
            patch("backend.app.get_current_devices", return_value=[]),
            patch("backend.app.ConfigurationHelper.get_log_snapshots_list", return_value=[snap]),
            patch(
                "backend.app.ConfigurationHelper.get_log_content_for_selected_snapshots",
                return_value=mock_df,
            ),
        ):
            resp = client.get("/api/snapshots/snap-001/content")

        assert resp.status_code == 200
        data = resp.get_json()
        assert "rows" in data
        assert data["rows"][0]["log_name"] == "syslog"

    def test_returns_404_for_unknown_snapshot(self, client):
        with (
            patch("backend.app.get_current_devices", return_value=[]),
            patch("backend.app.ConfigurationHelper.get_log_snapshots_list", return_value=[]),
        ):
            resp = client.get("/api/snapshots/does-not-exist/content")
        assert resp.status_code == 404
        assert resp.get_json()["error"] == "not_found"


# ── POST /api/start-logs-collection ──────────────────────────────────────────

class TestStartLogsCollection:
    def _post(self, client, body):
        return client.post(
            "/api/start-logs-collection",
            data=json.dumps(body),
            content_type="application/json",
        )

    def test_starts_collection_on_matching_devices(self, client):
        device = _make_device(name="Router-A")
        with patch("backend.app.get_current_devices", return_value=[device]):
            resp = self._post(client, {"selected_devices": ["Router-A"], "session_scenario": "test_1"})

        assert resp.status_code == 200
        data = resp.get_json()
        assert data["status"] == "logs collection started"
        assert len(data["session_id"]) == 12
        device.start_logs_collection.assert_called_once_with(data["session_id"], "test_1")

    def test_skips_devices_not_in_selection(self, client):
        device = _make_device(name="Router-A")
        with patch("backend.app.get_current_devices", return_value=[device]):
            resp = self._post(client, {"selected_devices": ["Router-B"], "session_scenario": "test_1"})

        assert resp.status_code == 200
        device.start_logs_collection.assert_not_called()

    def test_returns_400_when_selected_devices_is_not_list(self, client):
        resp = self._post(client, {"selected_devices": "Router-A", "session_scenario": "test_1"})
        assert resp.status_code == 400
        assert "selected_devices" in resp.get_json()["error"]

    def test_defaults_to_empty_list_when_key_missing(self, client):
        with patch("backend.app.get_current_devices", return_value=[]):
            resp = self._post(client, {})
        assert resp.status_code == 200


# ── POST /api/stop-logs-collection ───────────────────────────────────────────

class TestStopLogsCollection:
    def _post(self, client, body):
        return client.post(
            "/api/stop-logs-collection",
            data=json.dumps(body),
            content_type="application/json",
        )

    def test_stops_collection_and_returns_urls(self, client):
        device = _make_device(name="Router-A")
        body   = {"selected_devices": ["Router-A"], "session_id": "abc123def456"}

        with patch("backend.app.get_current_devices", return_value=[device]):
            resp = self._post(client, body)

        assert resp.status_code == 200
        data = resp.get_json()
        assert data["status"]     == "logs collection stopped"
        assert data["session_id"] == "abc123def456"
        assert "abc123def456"     in data["text_logs_url"]
        assert "abc123def456"     in data["chart_logs_url"]
        assert "log_type=text"    in data["text_logs_url"]
        assert "log_type=chart"   in data["chart_logs_url"]
        device.stop_logs_collection.assert_called_once()
        device.wait_for_log_collection_teardown.assert_called_once_with(timeout=60)

    def test_returns_400_when_selected_devices_not_list(self, client):
        resp = self._post(client, {"selected_devices": "Router-A", "session_id": "x"})
        assert resp.status_code == 400

    def test_returns_400_when_session_id_not_string(self, client):
        resp = self._post(client, {"selected_devices": [], "session_id": 12345})
        assert resp.status_code == 400
        assert "session_id" in resp.get_json()["error"]

    def test_skips_devices_not_in_selection(self, client):
        device = _make_device(name="Router-A")
        with patch("backend.app.get_current_devices", return_value=[device]):
            self._post(client, {"selected_devices": ["Router-B"], "session_id": "s"})
        device.stop_logs_collection.assert_not_called()


# ── POST /api/settings/auto-collection ───────────────────────────────────────

class TestSetAutoCollection:
    def _post(self, client, body):
        return client.post(
            "/api/settings/auto-collection",
            data=json.dumps(body),
            content_type="application/json",
        )

    def test_updates_runtime_parameters_on_matching_devices(self, client):
        device = _make_device("dev-001")
        body   = {"enabled": True, "interval_hours": 6, "device_ids": ["dev-001"]}

        with patch("backend.app.get_current_devices", return_value=[device]):
            resp = self._post(client, body)

        assert resp.status_code == 200
        assert resp.get_json() == {"status": "ok", "auto_collection_active": True}
        device.device_config_instance.update_runtime_parameter.assert_any_call(
            "auto_collection_enabled", True
        )
        device.device_config_instance.update_runtime_parameter.assert_any_call(
            "auto_collection_interval", 6
        )

    def test_returns_400_when_device_ids_not_list(self, client):
        resp = self._post(client, {"enabled": True, "interval_hours": 1, "device_ids": "dev-001"})
        assert resp.status_code == 400
        assert "device_ids" in resp.get_json()["error"]

    def test_returns_400_for_non_positive_interval(self, client):
        resp = self._post(client, {"enabled": True, "interval_hours": 0, "device_ids": []})
        assert resp.status_code == 400
        assert "interval_hours" in resp.get_json()["error"]

    def test_reflects_enabled_false_in_response(self, client):
        with patch("backend.app.get_current_devices", return_value=[]):
            resp = self._post(client, {"enabled": False, "interval_hours": 1, "device_ids": []})
        assert resp.get_json()["auto_collection_active"] is False


# ── POST /api/settings/change-password ───────────────────────────────────────

class TestChangePassword:
    def _post(self, client, body):
        return client.post(
            "/api/settings/change-password",
            data=json.dumps(body),
            content_type="application/json",
        )

    def test_stores_sha256_hash_of_new_password(self, client, tmp_path, monkeypatch):
        monkeypatch.setattr("backend.app.SETTINGS_FILE", tmp_path / "settings.json")

        resp = self._post(client, {"new_password": "securepass"})

        assert resp.status_code == 200
        assert resp.get_json() == {"status": "ok"}

        stored = json.loads((tmp_path / "settings.json").read_text())
        expected_hash = hashlib.sha256(b"securepass").hexdigest()
        assert stored["admin_password_hash"] == expected_hash

    def test_preserves_existing_settings_keys(self, client, tmp_path, monkeypatch):
        settings_path = tmp_path / "settings.json"
        settings_path.write_text(json.dumps({"other_key": "other_value"}))
        monkeypatch.setattr("backend.app.SETTINGS_FILE", settings_path)

        self._post(client, {"new_password": "securepass"})

        stored = json.loads(settings_path.read_text())
        assert stored["other_key"] == "other_value"

    def test_returns_400_for_short_password(self, client):
        resp = self._post(client, {"new_password": "abc"})
        assert resp.status_code == 400
        assert "6 characters" in resp.get_json()["error"]

    def test_returns_400_for_empty_password(self, client):
        resp = self._post(client, {"new_password": ""})
        assert resp.status_code == 400

    def test_returns_400_when_password_key_missing(self, client):
        resp = self._post(client, {})
        assert resp.status_code == 400


# ── helper unit tests ─────────────────────────────────────────────────────────

class TestLoadSaveSettings:
    def test_load_settings_returns_empty_dict_when_file_missing(self, tmp_path, monkeypatch):
        monkeypatch.setattr("backend.app.SETTINGS_FILE", tmp_path / "nonexistent.json")
        from backend.app import _load_settings
        assert _load_settings() == {}

    def test_load_settings_returns_empty_dict_on_malformed_json(self, tmp_path, monkeypatch):
        p = tmp_path / "settings.json"
        p.write_text("not json {{}")
        monkeypatch.setattr("backend.app.SETTINGS_FILE", p)
        from backend.app import _load_settings
        assert _load_settings() == {}

    def test_save_and_load_roundtrip(self, tmp_path, monkeypatch):
        monkeypatch.setattr("backend.app.SETTINGS_FILE", tmp_path / "settings.json")
        from backend.app import _load_settings, _save_settings
        _save_settings({"key": "value"})
        assert _load_settings() == {"key": "value"}
