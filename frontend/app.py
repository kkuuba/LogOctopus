from dash import Dash, html, dcc, Input, Output, State, ctx, ALL, dash_table
import dash_bootstrap_components as dbc
import json
from time import sleep
import pandas as pd
from frontend.layout import layout_view
from backend.models.device import Device
from backend.models.device_config import DeviceConfig
from backend.utils.config_loader import DeviceConfigLoader

# -------------------
# Backend Simulation
# -------------------
devices = DeviceConfigLoader("data").load_all_devices()

print(devices)

def populate_log_snapshots_list(log_snapshots):
    for device in devices:
        for log_snapshot in device.log_snapshots:
                if log_snapshot not in log_snapshots:
                    log_snapshots.append(log_snapshot)

log_snapshots = []

populate_log_snapshots_list(log_snapshots)

# -------------------
# Dash App
# -------------------
app = Dash(__name__, external_stylesheets=[dbc.themes.BOOTSTRAP])
app.layout = layout_view

# -------------------
# Upload Device
# -------------------
@app.callback(
    Output("config-alert", "is_open"),
    Output("devices-container", "children", allow_duplicate=True),
    Output("upload-json", "contents"),
    Input("upload-json", "contents"),
    State("devices-container", "children"),
    prevent_initial_call=True
)
def upload_device(contents, cards):
    cards = cards or []
    show_incorrect_config_alert = False
    config_file_content = contents.split(",", 1)[1]
    device_config = DeviceConfig(config_file_content)
    if device_config.validate_device_config():
        device_instance = Device(device_config_instance=device_config)
        devices.append(device_instance)
        cards = update_devices_layout()
    else:
        device_config.remove_device_config()
        show_incorrect_config_alert = True

    return show_incorrect_config_alert, cards, None

# -------------------
# Refresh Device Status
# -------------------
@app.callback(
    Output({"type": "status-connection", "index": ALL}, "children"),
    Output({"type": "status-access", "index": ALL}, "children"),
    Output({"type": "status-collection", "index": ALL}, "children"),
    Output("log-snapshots-container", "children", allow_duplicate=True),
    Input("device-refresh-interval", "n_intervals"),
    State({"type": "log-check", "index": ALL}, "value"),
    prevent_initial_call=True,
)
def refresh_devices(_, log_snapshots_select):
    connection_statuses = []
    access_statuses = []
    collection_statuses = []

    for device in devices:
        device.test_log_files_access()
        device.get_device_connection_status()
        connection_statuses.append(f"Connection: {'✅' if device.connection_status else '❌'}")
        access_statuses.append(f"Logs Access: {'✅' if device.log_access else '❌'}")
        collection_statuses.append(f"Logs Collection: {'🟢' if device.device_watchdog.collection_ongoing else '🟡'}")

    updated_snapshots_layout = update_log_snapshots_layout(log_snapshots_select)

    return connection_statuses, access_statuses, collection_statuses, updated_snapshots_layout

# -------------------
# Start / Stop Selected Devices
# -------------------
@app.callback(
    Output("collection-store", "data"),  # <- new output
    Input("start-all", "n_clicks"),
    Input("stop-all", "n_clicks"),
    State({"type": "device-select", "index": ALL}, "value"),
    State("collection-store", "data"),
    prevent_initial_call=True
)
def start_stop_selected(start, stop, selected, store_data):
    t = ctx.triggered_id
    selected_ids = {v[0] for v in selected if v}
    for device in devices:
        if t == "start-all" and device.device_config_id in selected_ids:
            device.start_logs_collection()

        elif t == "stop-all" and device.device_config_id in selected_ids:
            device.stop_logs_collection()
            device.save_log_snapshots()
    if t == "start-all":
        return store_data
    else:
        return store_data + 1  # increment to trigger snapshot refresh

# -------------------
# Remove Selected Devices
# -------------------
@app.callback(
    Output("devices-container", "children", allow_duplicate=True),
    Input("remove-selected", "n_clicks"),
    State({"type": "device-select", "index": ALL}, "value"),
    State("devices-container", "children"),
    prevent_initial_call=True
)
def remove_selected(_, selected, cards):
    ids_to_remove = {v[0] for v in selected if v}
    for device in devices:
        if device.device_config_id in ids_to_remove:
            devices.remove(device)

    cards = [c for c in cards if c["props"]["id"]["index"] not in ids_to_remove]

    return cards

# -------------------
# Log Snapshots Table
# -------------------
@app.callback(
    Output("log-snapshots-container", "children", allow_duplicate=True),
    Input("collection-store", "data"),  # <- changed
    prevent_initial_call=True
)
def update_snapshots(_):

    populate_log_snapshots_list(log_snapshots)

    return update_log_snapshots_layout()

# -------------------
# Logs Modal
# -------------------
@app.callback(
    Output("logs-modal", "is_open"),
    Output("modal-body", "children"),
    Input({"type": "view-log-btn", "index": ALL}, "n_clicks"),
    Input("view-selected", "n_clicks"),
    Input("close-modal", "n_clicks"),
    State({"type": "log-check", "index": ALL}, "value"),
    prevent_initial_call=True
)
def show_logs(view_clicks, view_selected, close_click, checked):
    t = ctx.triggered_id

    if t == "close-modal" or t is None:
        return False, None

    log_content = None
    if t == "view-selected":
        selected_ids = [i for i, v in enumerate(checked) if v]
        log_content = pd.DataFrame(columns=["time", "content", "device"])
        for selected_id in selected_ids:
            selected_log_content = log_snapshots[selected_id].collected_data
            selected_log_content.insert(1, "device", log_snapshots[selected_id].device_name)
            selected_log_content.insert(2, "log_name", log_snapshots[selected_id].log_name)
            if log_content.empty:
                log_content = selected_log_content
            elif not selected_log_content.empty:
                log_content = pd.concat([log_content, selected_log_content], ignore_index=True)
        log_content = log_content.sort_values(by="time", ascending=True)
    elif t["type"] == "view-log-btn" and not set(view_clicks) == {None}:
        log_content = log_snapshots[t["index"]].collected_data
    else:
        return False, None
    
    if log_content.empty:
        return True, html.P("No logs available")

    log_table = dash_table.DataTable( 
        columns=[{"name": i, "id": i} for i in log_content.columns],
        data=log_content.to_dict("records"),
        page_action="none", 
        style_table={ "height": "calc(100vh - 120px)", "overflowY": "auto", "overflowX": "auto", "width": "100%", }, 
        # Default style for all columns (small) 
        style_cell={ 
            "textAlign": "left", 
            "whiteSpace": "normal", 
            "overflow": "hidden", 
            "textOverflow": "ellipsis", 
            "minWidth": "50px", 
            "width": "50px", 
            "maxWidth": "100px" }, 
            # Make the last column extremely wide 
            style_cell_conditional=[ 
                { 
                    "if": {"column_id": log_content.columns[-1]}, # last column
                    "minWidth": "1000px", 
                    "width": "1200px", 
                    "maxWidth": "2000px", } ], 
            style_data={"userSelect": "text"}
            )

    return True, log_table

# -------------------
# Device Details Modal
# -------------------
@app.callback(
    Output("device-modal", "is_open"),
    Output("device-modal-body", "children"),
    Input({"type": "device-info-btn", "index": ALL}, "n_clicks"),
    Input("close-device-modal", "n_clicks"),
    prevent_initial_call=True
)
def device_details(info_clicks, close_click):
    t = ctx.triggered_id

    # Close modal
    if t == "close-device-modal" or t is None:
        return False, None

    # Only respond if a device info button was clicked
    if isinstance(t, dict) and t.get("type") == "device-info-btn" and info_clicks[0]:
        target_device = get_target_device_instance_to_update(t["index"])
        if target_device:
            body = html.Div([
                html.P(f"Name: {target_device.device_name}"),
                html.P(f"Connection: {target_device.connection_status}"),
                html.P(f"Logs Access: {target_device.log_access}"),
                html.P(f"Logs Collection: {target_device.device_watchdog.collection_ongoing}"),
                html.Hr(),
                html.Pre(json.dumps(target_device.device_config, indent=2))
            ])
            return True, body
        return False, None
    return False, None

# -------------------
# Download Logs
# -------------------
@app.callback(
    Output("download-component", "data"),
    Input("download-logs", "n_clicks"),
    State("modal-body", "children"),
    prevent_initial_call=True
)
def download_logs(_, table):
    return dcc.send_data_frame(pd.DataFrame(table["props"]["data"]).to_html, "logs.html", index=False)

@app.callback(
    Output("devices-container", "children", allow_duplicate=True),
    Input("startup-trigger", "n_intervals"),
    prevent_initial_call=True
)
def on_app_start(n):
    return update_devices_layout()

def get_target_device_instance_to_update(device_id):
    for device in devices:
        if device.device_config_id == device_id:
            return device
    return None
                    

def update_log_snapshots_layout(log_snapshots_select):
    log_snapshots_list = []
    i = 0
    selected_ids = [i for i, v in enumerate(log_snapshots_select) if v]
    print(selected_ids)
    for log_snapshot in log_snapshots:
        log_snapshot_checked = [i] if i in selected_ids else []
        print(log_snapshot_checked)
        log_snapshots_list.append(html.Tr([
            html.Td(dcc.Checklist(options=[{"label": "", "value": i}], value=log_snapshot_checked, id={"type": "log-check", "index": i})),
            html.Td(log_snapshot.device_name),
            html.Td(log_snapshot.log_name),
            html.Td(log_snapshot.creation_time),
            html.Td(f"{log_snapshot.logs_collection_duration} s"),
            html.Td(f"{int(log_snapshot.size_in_bytes)/1000} kB"),
            html.Td(dbc.Button("View Logs", id={"type": "view-log-btn", "index": i}, size="sm"))
        ]))
        i = i + 1

    if not log_snapshots_list:
        return html.P("No log snapshots yet.")

    return dbc.Table(
        [
            html.Thead(html.Tr([
                html.Th("✔"),
                html.Th("Device"),
                html.Th("Log name"),
                html.Th("Created"),
                html.Th("Duration"),
                html.Th("Size"),
                html.Th("Action")
            ])),
            html.Tbody(log_snapshots_list)
        ],
        bordered=True,
        hover=True
    )

def update_devices_layout():
    cards_list = []
    for device_instance in devices: 
        device_id = device_instance.device_config_id
        card = html.Div(
            id={"type": "device-card", "index": device_id},
            className="card m-2 p-2",
            style={"width": "260px", "backgroundColor": "lightgray", "position": "relative"},
            children=[
                dcc.Checklist(
                    options=[{"label": "", "value": device_id}],
                    id={"type": "device-select", "index": device_id},
                    style={"position": "absolute", "top": "6px", "left": "6px"}
                ),
                html.H5(device_instance.device_name, className="mt-4"),

                # Pre-populate status
                html.Small(f"Connection: {'✅' if device_instance.connection_status else '❌'}", id={"type": "status-connection", "index": device_id}),
                html.Br(),
                html.Small(f"Logs Access: {'✅' if device_instance.log_access else '❌'}", id={"type": "status-access", "index": device_id}),
                html.Br(),
                html.Small(f"Logs Collection: {'🟢' if device_instance.device_watchdog.collection_ongoing else '🟡'}", id={"type": "status-collection", "index": device_id}),
                html.Hr(),

                dbc.Button(
                    "ℹ Device Details",
                    id={"type": "device-info-btn", "index": device_id},
                    size="sm",
                    color="info"
                )
            ]
        )
        cards_list.append(card)

    return cards_list

# -------------------
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
