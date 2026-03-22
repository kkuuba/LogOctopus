from dash import Dash, dcc, Input, Output, State, ctx, ALL
from dash.exceptions import PreventUpdate
import dash_bootstrap_components as dbc
import pandas as pd
import os
import time
import signal
from flask import request, jsonify
from urllib.parse import parse_qs
import uuid
from frontend.layout import (layout_view, 
                             generate_logs_snapshots_table, 
                             generate_all_devices_cards_list, 
                             generate_device_info_modal, 
                             generate_log_content_modal, 
                             get_all_devices_statuses,
                             generate_chart_content_modal,
                             create_session_info_content_modal,
                             export_charts_div_to_html)
from backend.models.device import Device
from backend.models.device_config import DeviceConfig
from backend.utils.device_config_loader import DeviceConfigLoader
from backend.utils.config_helper import ConfigurationHelper


HOST = os.getenv("HOST")
PORT = int(os.getenv("PORT"))


app = Dash(__name__, external_stylesheets=[dbc.themes.BOOTSTRAP])
app.layout = layout_view
server = app.server


def get_current_devices():
    return DeviceConfigLoader("data").load_all_devices()


@app.callback(
    Output("config-alert", "is_open"),
    Output("devices-container", "children", allow_duplicate=True),
    Input("upload-json", "contents"),
    State("devices-container", "children"),
    prevent_initial_call=True
)
def upload_device(contents, cards):
    """
    Upload new device based on provided config file.
    """
    cards = cards or []
    devices = get_current_devices()
    show_incorrect_config_alert = False
    config_file_content = contents.split(",", 1)[1]
    device_config = DeviceConfig(config_file_content)
    if device_config.validate_device_config():
        device_instance = Device(device_config_instance=device_config)
        devices.append(device_instance)
        cards = generate_all_devices_cards_list(devices)
    else:
        device_config.remove_device_config()
        show_incorrect_config_alert = True

    return show_incorrect_config_alert, cards


@app.callback(
    Output({"type": "status-connection", "index": ALL}, "children"),
    Output({"type": "status-access", "index": ALL}, "children"),
    Output({"type": "status-collection", "index": ALL}, "children"),
    Input("device-refresh-interval", "n_intervals"),
    State({"type": "status-connection", "index": ALL}, "id"),
    prevent_initial_call=True,
)
def refresh_devices(_, conn_ids):
    """
    Refresh all device statuses (connection, log access, logs collection state).
    """
    if len(conn_ids) != len(get_current_devices()):
        raise PreventUpdate

    return get_all_devices_statuses(get_current_devices())


@app.callback(
    Output("log-snapshots-container", "children", allow_duplicate=True),  # <- new output
    Output("session-modal", "is_open"),
    Output("session-modal-body", "children"),
    Input("start-all", "n_clicks"),
    Input("stop-all", "n_clicks"),
    State({"type": "device-select", "index": ALL}, "value"),
    State('log-type-chart', 'value'),
    prevent_initial_call=True
)
def start_stop_selected(start, stop, selected, log_type_chart):
    """
    Start or stop logs collection on selected devices.
    """
    t = ctx.triggered_id
    selected_ids = {v[0] for v in selected if v}
    session_id = uuid.uuid1().hex[:12]
    for device in get_current_devices():
        if t == "start-all" and device.device_config_id in selected_ids:
            device.start_logs_collection(session_id)

        elif t == "stop-all" and device.device_config_id in selected_ids:
            session_id = device.device_config["current_session_id"]
            device.stop_logs_collection()
            device.wait_for_log_collection_teardown()
    if t == "start-all":
        log_snapshots = ConfigurationHelper.get_log_snapshots_list(get_current_devices(), log_type_chart)
        return generate_logs_snapshots_table(log_snapshots), False, None
    else:
        log_snapshots = ConfigurationHelper.get_log_snapshots_list(get_current_devices(), log_type_chart)
        return (generate_logs_snapshots_table(log_snapshots), 
                True, 
                create_session_info_content_modal(
                    text_logs_url=f"http://{HOST}:{PORT}/?search_param=Session%20ID&search_value={session_id}&log_type=text",
                    chart_logs_url=f"http://{HOST}:{PORT}/?search_param=Session%20ID&search_value={session_id}&log_type=chart"
                    ))


@app.callback(
    Output("devices-container", "children", allow_duplicate=True),
    Input("remove-selected", "n_clicks"),
    State({"type": "device-select", "index": ALL}, "value"),
    prevent_initial_call=True
)
def remove_selected(_, selected):
    """
    Remove all selected devices.
    """
    ids_to_remove = {v[0] for v in selected if v}
    devices = get_current_devices()
    for device in devices:
        if device.device_config_id in ids_to_remove:
            os.kill(device.device_config["watchdog_process_pid"], signal.SIGTERM)
            device.remove_device_data()
            devices.remove(device)

    return generate_all_devices_cards_list(devices)


@app.callback(
    Output("logs-modal", "is_open"),
    Output("modal-body", "children", allow_duplicate=True),
    Input({"type": "view-log-btn", "index": ALL}, "n_clicks"),
    Input("view-selected", "n_clicks"),
    Input("close-modal", "n_clicks"),
    State({"type": "log-check", "index": ALL}, "value"),
    State('log-type-chart', 'value'),
    State("url", "search"),
    prevent_initial_call=True
)
def show_logs(view_clicks, view_selected, close_click, checked, log_type_chart, search):
    """
    Show log content for selected or single log snapshots.
    """
    log_snapshots = get_current_logs_snapshots_list(search, log_type_chart)
    t = ctx.triggered_id
    if t == "close-modal" or t is None:
        return False, None
    if t == "view-selected":
        selected_log_snapshots = []
        for selected_id in [i for i, v in enumerate(checked) if v]:
            selected_log_snapshots.append(log_snapshots[selected_id])
            log_content = ConfigurationHelper.get_log_content_for_selected_snapshots(selected_log_snapshots)
        if log_type_chart:
            return True, generate_chart_content_modal(selected_log_snapshots)
        if len(selected_log_snapshots) == 0:
            return False, None
    elif t["type"] == "view-log-btn" and not set(view_clicks) == {None}:
        log_content = ConfigurationHelper.get_log_content_for_selected_snapshots([log_snapshots[t["index"]]])
        if log_type_chart:
            return True, generate_chart_content_modal([log_snapshots[t["index"]]])
    else:
        return False, None

    return True, generate_log_content_modal(log_content, False)


@app.callback(
    Output("log-snapshots-container", "children", allow_duplicate=True),
    Input('log-type-chart', 'value'),
    State("url", "search"),
    prevent_initial_call=True
)
def switch_log_type_for_snapshots_list(log_type_chart, search):
    log_snapshots = get_current_logs_snapshots_list(search, log_type_chart)
    return generate_logs_snapshots_table(log_snapshots)


@app.callback(
    Output("url", "search"),
    Input("filter-btn", "n_clicks"),
    State("search-param", "value"),
    State("search-value", "value"),
    State("log-type-chart", "value"),
    prevent_initial_call=True
)
def update_url(_, search_param, search_value, log_type_chart):
    """
    Update URL based on filter value provided on search fields.
    """
    log_type = "chart" if log_type_chart else "text"
    return f"?search_param={search_param}&search_value={search_value}&log_type={log_type}"

@app.callback(
    Output("log-snapshots-container", "children"),
    Output("log-type-chart", "value"),
    Input("url", "search")
)
def load_filtered_snapshots_based_on_url(search):
    """
    Update log snapshots list view based on filter values in provided URL.
    """
    params = parse_qs(search.lstrip("?"))
    log_type_chart = True if params.get("log_type", [None])[0] == "chart" else False
    log_snapshots = get_current_logs_snapshots_list(search, log_type_chart)

    return generate_logs_snapshots_table(log_snapshots), log_type_chart

@app.callback(
    Output("device-modal", "is_open"),
    Output("device-modal-body", "children"),
    Input({"type": "device-info-btn", "index": ALL}, "n_clicks"),
    Input("close-device-modal", "n_clicks"),
    prevent_initial_call=True
)
def device_details(info_clicks, _):
    """
    Open modal with device paramters info.
    """
    t = ctx.triggered_id
    if t == "close-device-modal" or t is None:
        return False, None
    if isinstance(t, dict) and t.get("type") == "device-info-btn" and not set(info_clicks) == {None}:
        target_device = get_target_device_instance_to_update(t["index"])
        if target_device:
            return True, generate_device_info_modal(target_device)
        return False, None
    return False, None

@app.callback(
    Output("download-component", "data"),
    Input("download-logs", "n_clicks"),
    State("modal-body", "children"),
    State('log-type-chart', 'value'),
    prevent_initial_call=True
)
def download_logs(_, modal_body_data, log_type_chart):
    """
    Download log content for single or selected log snashots in HTML format.
    """
    if log_type_chart:
        export_charts_div_to_html(modal_body_data, "data/charts.html")
        return dcc.send_file("data/charts.html", "charts.html")
    return dcc.send_data_frame(pd.DataFrame(modal_body_data["props"]["data"]).to_html, "logs.html", index=False)

@app.callback(
    Output("modal-body", "children", allow_duplicate=True),
    Input('color-mode-switch', 'value'),
    State({"type": "log-check", "index": ALL}, "value"),
    State('log-type-chart', 'value'),
    State("url", "search"),
    prevent_initial_call=True
)
def switch_log_table_color_mode_state(color_mode, checked, log_type_chart, search):
    """
    Enable of disable coloring mode for text log content table.
    """
    log_snapshots = get_current_logs_snapshots_list(search, log_type_chart)
    selected_log_snapshots = []
    for selected_id in [i for i, v in enumerate(checked) if v]:
        selected_log_snapshots.append(log_snapshots[selected_id])
        log_content = ConfigurationHelper.get_log_content_for_selected_snapshots(selected_log_snapshots)
    if log_type_chart:
        return True, generate_chart_content_modal(selected_log_snapshots)
    if color_mode:
        return True, generate_log_content_modal(log_content, True)
    return True, generate_log_content_modal(log_content, False)

@app.callback(
    Output("devices-container", "children", allow_duplicate=True),
    Output("log-snapshots-container", "children", allow_duplicate=True),
    Input("startup-trigger", "n_intervals"),
    State('log-type-chart', 'value'),
    State("url", "search"),
    prevent_initial_call=True
)
def on_app_start(n, log_type_chart, url_search):
    """
    Update device list and log snapshots table based on source files.
    """
    log_snapshots = get_current_logs_snapshots_list(url_search, log_type_chart)
    return generate_all_devices_cards_list(get_current_devices()), generate_logs_snapshots_table(log_snapshots)

@app.callback(
    Output("api-modal", "is_open"),
    Input("open-api-modal", "n_clicks"),
    Input("close-api-modal", "n_clicks"),
    State("api-modal", "is_open"),
)
def open_rest_api_info_modal(open_click, close_click, is_open):
    """
    Open modal with info about REST API endpoints.
    """
    if open_click or close_click:
        return not is_open
    return is_open

def get_target_device_instance_to_update(device_id):
    """
    Get Device object based on provided device ID.

    Args:
        device_id (int): Target device id.

    Returns:
        (Device): Instance of target Device object.
    """
    for device in get_current_devices():
        if device.device_config_id == device_id:
            return device
    return None

def get_current_logs_snapshots_list(search, log_type_chart):
    """
    Get current list of log snapshots based on URL search query and active log type.

    Args:
        search (str): Current active URL search query.
        log_type_chart (bool): Current active log type.

    Returns:
        (list): List of current log snapshots based on provided paramters.
    """
    params = parse_qs(search.lstrip("?"))
    search_param = params.get("search_param", [None])[0]
    search_value = params.get("search_value", [None])[0]
    if not search_param or not search_value:
        return ConfigurationHelper.get_log_snapshots_list(get_current_devices(), log_type_chart)
    else:
        return ConfigurationHelper.get_filtered_log_snapshots_list(get_current_devices(), search_param, search_value, log_type_chart)

@server.route("/api/start-logs-collection", methods=["POST"])
def start_logs_collection():
    """
    Start logs collection REST API endpoint action.
    """
    request_data = request.get_json()
    selected_devices = request_data.get("selected_devices", [])

    if not isinstance(selected_devices, list):
        return jsonify({"error": "selected_devices must be a list"}), 400

    session_id = uuid.uuid1().hex[:12] 

    for device in get_current_devices():
        if device.device_name in selected_devices:
            device.start_logs_collection(session_id)

    return jsonify({
        "status": "logs collection started",
        "session_id": session_id
    })


@server.route("/api/stop-logs-collection", methods=["POST"])
def stop_logs_collection():
    """
    Stop logs collection and save collected data REST API endpoint action.
    """
    request_data = request.get_json()
    selected_devices = request_data.get("selected_devices", [])
    session_id = request_data.get("session_id", "")

    if not isinstance(selected_devices, list):
        return jsonify({"error": "selected_devices must be a list"}), 400

    if not isinstance(session_id, str):
        return jsonify({"error": "session_id must be a string"}), 400

    for device in get_current_devices():
        if device.device_name in selected_devices:
            device.stop_logs_collection()
            device.wait_for_log_collection_teardown()

    return jsonify({
        "status": "logs collection stopped",
        "text_logs_url": f"http://{HOST}:{PORT}/?search_param=Session%20ID&search_value={session_id}&log_type=text",
        "chart_logs_url": f"http://{HOST}:{PORT}/?search_param=Session%20ID&search_value={session_id}&log_type=chart"
    })


if __name__ == "__main__":
    app.run(debug=False)


# TODO 
# Add settings modal which will be open via button on home page #
    # info about CPU usage
    # info about ram usage
    # info about available storage
    # contionus monitoring switch
    # log rotation settings

# Investgiate a way to create container with https based on dash app
# Create some solution for testing app via github container
# Add backend tests for each module
# Add frontend tests
