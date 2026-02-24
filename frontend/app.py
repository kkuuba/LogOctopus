from dash import Dash, dcc, Input, Output, State, ctx, ALL
from dash.exceptions import PreventUpdate
import dash_bootstrap_components as dbc
import pandas as pd
import uuid
from frontend.layout import (layout_view, 
                             generate_logs_snapshots_table, 
                             generate_all_devices_cards_list, 
                             generate_device_info_modal, 
                             generate_log_content_modal, 
                             get_all_devices_statuses)
from backend.models.device import Device
from backend.models.device_config import DeviceConfig
from backend.utils.device_config_loader import DeviceConfigLoader
from backend.utils.config_helper import ConfigurationHelper


devices = DeviceConfigLoader("data").load_all_devices()

app = Dash(__name__, external_stylesheets=[dbc.themes.BOOTSTRAP])
app.layout = layout_view


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
    if len(conn_ids) != len(devices):
        raise PreventUpdate

    return get_all_devices_statuses(devices)


@app.callback(
    Output("log-snapshots-container", "children", allow_duplicate=True),  # <- new output
    Input("start-all", "n_clicks"),
    Input("stop-all", "n_clicks"),
    State({"type": "device-select", "index": ALL}, "value"),
    prevent_initial_call=True
)
def start_stop_selected(start, stop, selected):
    """
    Start or stop logs collection on selected devices.
    """
    t = ctx.triggered_id
    selected_ids = {v[0] for v in selected if v}
    session_id = uuid.uuid1().hex[:12] 
    for device in devices:
        if t == "start-all" and device.device_config_id in selected_ids:
            device.start_logs_collection(session_id)

        elif t == "stop-all" and device.device_config_id in selected_ids:
            device.stop_logs_collection()
            device.save_log_snapshots()
    if t == "start-all":
        log_snapshots = ConfigurationHelper.get_log_snapshots_list(devices)
        return generate_logs_snapshots_table(log_snapshots)
    else:
        log_snapshots = ConfigurationHelper.get_log_snapshots_list(devices)
        return generate_logs_snapshots_table(log_snapshots)


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
    for device in devices:
        if device.device_config_id in ids_to_remove:
            device.device_config_instance.remove_device_config()
            devices.remove(device)

    return generate_all_devices_cards_list()


@app.callback(
    Output("logs-modal", "is_open"),
    Output("modal-body", "children", allow_duplicate=True),
    Input({"type": "view-log-btn", "index": ALL}, "n_clicks"),
    Input("view-selected", "n_clicks"),
    Input("close-modal", "n_clicks"),
    State({"type": "log-check", "index": ALL}, "value"),
    prevent_initial_call=True
)
def show_logs(view_clicks, view_selected, close_click, checked):
    """
    Show log content for selected or single log snapshots.
    """
    log_snapshots = ConfigurationHelper.get_log_snapshots_list(devices)
    t = ctx.triggered_id
    if t == "close-modal" or t is None:
        return False, None
    if t == "view-selected":
        selected_log_snapshots = []
        for selected_id in [i for i, v in enumerate(checked) if v]:
            selected_log_snapshots.append(log_snapshots[selected_id])
            log_content = ConfigurationHelper.get_log_content_for_selected_snapshots(selected_log_snapshots)
        if len(selected_log_snapshots) == 0:
            return False, None
    elif t["type"] == "view-log-btn" and not set(view_clicks) == {None}:
        log_content = ConfigurationHelper.get_log_content_for_selected_snapshots([log_snapshots[t["index"]]])
    else:
        return False, None

    return True, generate_log_content_modal(log_content, False)


@app.callback(
    Output("log-snapshots-container", "children", allow_duplicate=True),
    Input("filter-btn", "n_clicks"),
    State("search-param", "value"),
    State("search-value", "value"),
    prevent_initial_call=True
)
def filter_log_snapshots_list(_, search_param, search_value):
    if not search_param or not search_value:
        log_snapshots = ConfigurationHelper.get_log_snapshots_list(devices)
        return generate_logs_snapshots_table(log_snapshots)
    else:
        filtered_log_snapshots = ConfigurationHelper.get_filtered_log_snapshots_list(devices, search_param, search_value)
        return generate_logs_snapshots_table(filtered_log_snapshots)


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
    prevent_initial_call=True
)
def download_logs(_, table):
    """
    Download log content for single or selected log snashots in HTML format.
    """
    return dcc.send_data_frame(pd.DataFrame(table["props"]["data"]).to_html, "logs.html", index=False)

@app.callback(
    Output("modal-body", "children", allow_duplicate=True),
    Input('color-mode-switch', 'value'),
    State({"type": "log-check", "index": ALL}, "value"),
    prevent_initial_call=True
)
def switch_log_table_color_mode_state(color_mode, checked):
    """
    Enable of disable coloring mode for text log content table.
    """
    log_snapshots = ConfigurationHelper.get_log_snapshots_list(devices)
    selected_log_snapshots = []
    for selected_id in [i for i, v in enumerate(checked) if v]:
        selected_log_snapshots.append(log_snapshots[selected_id])
        log_content = ConfigurationHelper.get_log_content_for_selected_snapshots(selected_log_snapshots)
    if color_mode:
        return True, generate_log_content_modal(log_content, True)
    return True, generate_log_content_modal(log_content, False)

@app.callback(
    Output("devices-container", "children", allow_duplicate=True),
    Output("log-snapshots-container", "children", allow_duplicate=True),
    Input("startup-trigger", "n_intervals"),
    prevent_initial_call=True
)
def on_app_start(n):
    """
    Update device list and log snapshots table based on source files.
    """
    log_snapshots = ConfigurationHelper.get_log_snapshots_list(devices)

    return generate_all_devices_cards_list(devices), generate_logs_snapshots_table(log_snapshots)


def get_target_device_instance_to_update(device_id):
    """
    Get Device object based on provided device ID.

    Args:
        device_id (int): Target device id.

    Returns:
        (Device): Instance of target Device object.
    """
    for device in devices:
        if device.device_config_id == device_id:
            return device
    return None


if __name__ == "__main__":
    app.run(debug=True)


# TODO 
# Add doc string to main app file
# Add loading config from config files
# Add button for devices coloring
# Add new column to log snapshots view with test trigger ID
# Add some filter bar to log snapshots list
# Add button for error list in device card
# Add logs download option with format choice
# Add button on top bar for help, rest api and settings
# Investigate a way to add rest API
# Investgiate a way to create container with https based on dash app
# Add synchronization of all timestamps to UTC timezone
