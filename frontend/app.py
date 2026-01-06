from dash import Dash, html, dcc, Input, Output, State, ctx, ALL, dash_table
from dash.exceptions import PreventUpdate
import dash_bootstrap_components as dbc
import json, base64, uuid
from datetime import datetime
import pandas as pd

# -------------------
# Backend Simulation
# -------------------
devices = {}
log_sessions = []

def backend_create_device(device_config):
    device_id = str(uuid.uuid4())
    devices[device_id] = {
        "name": device_config.get("name", "Unnamed"),
        "config": device_config,
        "collection": "stopped",
        "connection": "unknown",
        "log_access": "unknown",
    }
    return device_id

def backend_check_device(device_id):
    devices[device_id]["connection"] = "connected"
    devices[device_id]["log_access"] = "ok"

def backend_start_logs(device_id):
    if devices[device_id]["collection"] == "running":
        return
    devices[device_id]["collection"] = "running"
    log_sessions.append({
        "device_id": device_id,
        "device_name": devices[device_id]["name"],
        "start": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "stop": None,
        "logs": pd.DataFrame(columns=["timestamp", "value"]),
        "duration": None,
        "size": None
    })

def backend_stop_logs(device_id):
    if devices[device_id]["collection"] == "stopped":
        return
    devices[device_id]["collection"] = "stopped"
    for s in reversed(log_sessions):
        if s["device_id"] == device_id and s["stop"] is None:
            stop = datetime.now()
            start = datetime.strptime(s["start"], "%Y-%m-%d %H:%M:%S")
            df = pd.DataFrame({
                "timestamp": pd.date_range(start=start, periods=5, freq="s"),
                "value": [1, 2, 3, 4, 5]
            })
            s["stop"] = stop.strftime("%Y-%m-%d %H:%M:%S")
            s["logs"] = df
            s["duration"] = int((stop - start).total_seconds())
            s["size"] = int(df.memory_usage(deep=True).sum())
            break

# -------------------
# Dash App
# -------------------
app = Dash(__name__, external_stylesheets=[dbc.themes.BOOTSTRAP])

# Logs modal
log_modal = dbc.Modal(
    [
        dbc.ModalHeader(dbc.ModalTitle("Logs")),
        dbc.ModalBody(id="modal-body"),
        dbc.ModalFooter([
            dbc.Button("⬇ Download CSV", id="download-logs", color="secondary"),
            dcc.Download(id="download-component"),
            dbc.Button("Close", id="close-modal")
        ])
    ],
    id="logs-modal",
    size="xl",
    is_open=False
)

# Device details modal
device_modal = dbc.Modal(
    [
        dbc.ModalHeader(dbc.ModalTitle("Device Details")),
        dbc.ModalBody(id="device-modal-body"),
        dbc.ModalFooter(dbc.Button("Close", id="close-device-modal"))
    ],
    id="device-modal",
    is_open=False
)

app.layout = dbc.Container([
    dcc.Store(id="collection-store", data=0),
    # html.H2("Remote Devices Log Dashboard", className="my-3"),
    dbc.Row(
        [
            # App icon from assets folder
            dbc.Col(
                html.Img(
                    src="/assets/icon.png",  # your minimalist line-art octopus icon
                    height="60px",  # zoomed
                    style={
                        "margin-right": "12px",
                        "display": "inline-block",
                        "transform": "translateY(3px)"  # vertical alignment
                    }
                ),
                width="auto",
                style={"display": "flex", "align-items": "center"}
            ),

            # App title and subtitle
            dbc.Col(
                html.Div([
                    html.H2(
                        "LogOctopus",
                        className="m-0",
                        style={"color": "#1a1a1a", "font-weight": "bold"}  # match dark lines of icon
                    ),
                    html.Small(
                        "Collect & Analyze Logs Efficiently",
                        className="text-secondary"  # muted gray
                    )
                ]),
                style={"display": "flex", "flex-direction": "column", "justify-content": "center"}
            )
        ],
        align="center",
        className="my-3",
        style={
            "background-color": "#ffffff",  # white to match icon background
            "padding": "12px 20px",
            "border-radius": "10px",
            "box-shadow": "0 2px 8px rgba(0,0,0,0.08)"  # subtle shadow
        }
    ),
    dbc.Row([
        dbc.Col(
            dcc.Upload(
                id="upload-json",
                children=dbc.Button("➕ Add New Device", color="primary"),
                multiple=False
            ),
            width="auto"
        ),
        dbc.Col(dbc.Button("▶ Start Logs (Selected)", id="start-all", color="success"), width="auto"),
        dbc.Col(dbc.Button("⏹ Stop Logs (Selected)", id="stop-all", color="danger"), width="auto"),
        dbc.Col(dbc.Button("🗑 Remove Selected", id="remove-selected", color="secondary"), width="auto"),
    ]),

    html.Hr(),
    html.Div(id="devices-container", style={"display": "flex", "flex-wrap": "wrap"}),

    html.Hr(),
    html.H4("Log Snapshots"),
    dbc.Button("📊 View Selected Logs", id="view-selected", color="primary"),
    html.Div(id="log-snapshots-container"),

    log_modal,
    device_modal
], fluid=True)

# -------------------
# Upload Device
# -------------------
@app.callback(
    Output("devices-container", "children", allow_duplicate=True),
    Input("upload-json", "contents"),
    State("devices-container", "children"),
    prevent_initial_call=True
)
def upload_device(contents, cards):
    cards = cards or []

    # Decode uploaded JSON
    cfg = json.loads(base64.b64decode(contents.split(",")[1]))
    device_id = backend_create_device(cfg)

    # Automatically check device to populate initial status
    backend_check_device(device_id)

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

            dbc.Button(
                "↻",
                id={"type": "refresh-device", "index": device_id},
                size="sm",
                color="secondary",
                style={"position": "absolute", "top": "4px", "right": "4px", "padding": "2px 6px"}
            ),

            html.H5(cfg.get("name", "Unnamed"), className="mt-4"),

            # Pre-populate status
            html.Small(f"Connection: {devices[device_id]['connection']}", id={"type": "status-connection", "index": device_id}),
            html.Br(),
            html.Small(f"Logs Access: {devices[device_id]['log_access']}", id={"type": "status-access", "index": device_id}),
            html.Br(),
            html.Small(f"Logs Collection: {devices[device_id]['collection']}", id={"type": "status-collection", "index": device_id}),
            html.Hr(),

            dbc.Button(
                "ℹ Device Details",
                id={"type": "device-info-btn", "index": device_id},
                size="sm",
                color="info"
            )
        ]
    )

    return cards + [card]

# -------------------
# Refresh Device Status
# -------------------
@app.callback(
    Output({"type": "status-connection", "index": ALL}, "children"),
    Output({"type": "status-access", "index": ALL}, "children"),
    Output({"type": "status-collection", "index": ALL}, "children"),
    Input({"type": "refresh-device", "index": ALL}, "n_clicks"),
    State({"type": "status-connection", "index": ALL}, "id"),
    prevent_initial_call=True
)
def refresh_device(_, ids):
    t = ctx.triggered_id
    if not isinstance(t, dict):
        raise PreventUpdate

    backend_check_device(t["index"])

    return (
        [f"Connection: {devices[i['index']]['connection']}" for i in ids],
        [f"Logs Access: {devices[i['index']]['log_access']}" for i in ids],
        [f"Logs Collection: {devices[i['index']]['collection']}" for i in ids],
    )

# -------------------
# Start / Stop Selected Devices
# -------------------
@app.callback(
    Output({"type": "device-card", "index": ALL}, "style"),
    Output("collection-store", "data"),  # <- new output
    Input("start-all", "n_clicks"),
    Input("stop-all", "n_clicks"),
    State({"type": "device-select", "index": ALL}, "value"),
    State({"type": "device-card", "index": ALL}, "id"),
    State("collection-store", "data"),
    prevent_initial_call=True
)
def start_stop_selected(start, stop, selected, ids, store_data):
    t = ctx.triggered_id
    selected_ids = {v[0] for v in selected if v}

    if t == "start-all":
        for d in selected_ids:
            backend_start_logs(d)
    elif t == "stop-all":
        for d in selected_ids:
            backend_stop_logs(d)

    # Update styles
    styles = []
    for i in ids:
        col = devices[i["index"]]["collection"]
        styles.append({
            "width": "260px",
            "position": "relative",
            "backgroundColor": "lightgreen" if col == "running" else "lightgray"
        })

    return styles, store_data + 1  # increment to trigger snapshot refresh

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
    ids = {v[0] for v in selected if v}
    if not ids:
        raise PreventUpdate

    for d in ids:
        devices.pop(d, None)

    return [c for c in cards if c["props"]["id"]["index"] not in ids]

# -------------------
# Log Snapshots Table
# -------------------
@app.callback(
    Output("log-snapshots-container", "children"),
    Input("collection-store", "data"),  # <- changed
)
def update_snapshots(_):
    if not log_sessions:
        return html.P("No log snapshots yet.")

    rows = []
    for i, s in enumerate(reversed(log_sessions)):
        rows.append(html.Tr([
            html.Td(dcc.Checklist(options=[{"label": "", "value": i}], id={"type": "log-check", "index": i})),
            html.Td(s["device_name"]),
            html.Td(s["start"]),
            html.Td(s["stop"] or "-"),
            html.Td(f"{s.get('duration', 0)} s"),
            html.Td(f"{round(s.get('size', 0)/1024, 2)} KB"),
            html.Td(dbc.Button("View Logs", id={"type": "view-log-btn", "index": i}, size="sm"))
        ]))

    return dbc.Table(
        [
            html.Thead(html.Tr([
                html.Th("✔"), html.Th("Device"), html.Th("Start"),
                html.Th("Stop"), html.Th("Duration"),
                html.Th("Size"), html.Th("Action")
            ])),
            html.Tbody(rows)
        ],
        bordered=True,
        hover=True
    )

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

    # Close modal explicitly
    if t == "close-modal" or t is None:
        return False, None

    # If individual view-log button clicked
    if isinstance(t, dict) and "index" in t:
        idx = t["index"]
        # Check n_clicks of that specific button
        if view_clicks[idx] is None or view_clicks[idx] == 0:
            raise PreventUpdate
        s = log_sessions[len(log_sessions) - 1 - idx]
        if s["logs"].empty:
            return True, html.P("No logs available for this snapshot")
        df = s["logs"].copy()
        df["device"] = s["device_name"]

    # If "View Selected" clicked
    elif t == "view-selected":
        if not view_selected or view_selected == 0:
            raise PreventUpdate
        selected = [i for i, v in enumerate(checked) if v]
        if not selected:
            return False, None  # nothing selected → do not open modal
        dfs = []
        for i in selected:
            s = log_sessions[len(log_sessions) - 1 - i]
            if not s["logs"].empty:
                dfs.append(s["logs"].assign(device=s["device_name"]))
        if not dfs:
            return False, None
        df = pd.concat(dfs, ignore_index=True)

    else:
        raise PreventUpdate

    # Create table only if df has data
    if df.empty:
        return True, html.P("No logs available")
    table = dash_table.DataTable(
        columns=[{"name": c, "id": c} for c in df.columns],
        data=df.to_dict("records"),
        page_size=15,
        style_table={"overflowX": "auto"}
    )

    return True, table

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
    if isinstance(t, dict) and t.get("type") == "device-info-btn":
        idx = t["index"]

        # Find the index of this button in the ALL input list
        try:
            idx_pos = next(i for i, btn in enumerate(ctx.inputs_list[0]) if btn["id"]["index"] == idx)
        except StopIteration:
            raise PreventUpdate

        # Make sure n_clicks > 0
        if info_clicks[idx_pos] is None or info_clicks[idx_pos] == 0:
            raise PreventUpdate

        # Safety: device exists
        if idx not in devices:
            raise PreventUpdate

        # Build modal content
        d = devices[idx]
        body = html.Div([
            html.P(f"Name: {d['name']}"),
            html.P(f"Connection: {d['connection']}"),
            html.P(f"Logs Access: {d['log_access']}"),
            html.P(f"Logs Collection: {d['collection']}"),
            html.Hr(),
            html.Pre(json.dumps(d["config"], indent=2))
        ])
        return True, body

    # Anything else → do nothing
    raise PreventUpdate
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
    if not isinstance(table, dash_table.DataTable):
        raise PreventUpdate
    return dcc.send_data_frame(pd.DataFrame(table.data).to_csv, "logs.csv", index=False)

# -------------------
if __name__ == "__main__":
    app.run(debug=True)
