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
        "status": "stopped"
    }
    return device_id

def backend_start_logs(device_id):
    if devices[device_id]["status"] == "running":
        return
    devices[device_id]["status"] = "running"
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
    if devices[device_id]["status"] == "stopped":
        return
    devices[device_id]["status"] = "stopped"
    for session in reversed(log_sessions):
        if session["device_id"] == device_id and session["stop"] is None:
            stop_time = datetime.now()
            start_time = datetime.strptime(session["start"], "%Y-%m-%d %H:%M:%S")

            df = pd.DataFrame({
                "timestamp": pd.date_range(start=start_time, periods=5, freq="s"),
                "value": [1, 2, 3, 4, 5]
            })

            session["stop"] = stop_time.strftime("%Y-%m-%d %H:%M:%S")
            session["logs"] = df
            session["duration"] = int((stop_time - start_time).total_seconds())
            session["size"] = int(df.memory_usage(deep=True).sum())
            break

# -------------------
# Dash App
# -------------------
app = Dash(__name__, external_stylesheets=[dbc.themes.BOOTSTRAP])

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

app.layout = dbc.Container([
    html.H2("Remote Devices Log Dashboard", className="my-3"),

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
    dbc.Button("📊 View Selected Logs", id="view-selected", color="info", className="mb-2"),
    html.Div(id="log-snapshots-container"),

    log_modal
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
    decoded = base64.b64decode(contents.split(",")[1])
    cfg = json.loads(decoded)

    device_id = backend_create_device(cfg)

    card = html.Div(
        id={"type": "device-card", "index": device_id},
        className="card m-2 p-2",
        style={
            "width": "260px",
            "background-color": "lightgray",
            "position": "relative"
        },
        children=[

            # ✅ device selection checkbox
            dcc.Checklist(
                options=[{"label": "", "value": device_id}],
                id={"type": "device-select", "index": device_id},
                style={"position": "absolute", "top": "6px", "left": "6px"}
            ),

            html.H5(cfg.get("name", "Unnamed Device"), className="mt-4"),
            html.P("Status: stopped", id={"type": "device-status", "index": device_id}),

            dbc.Button(
                "Start Logs",
                id={"type": "start-btn", "index": device_id},
                size="sm",
                color="success",
                className="me-1"
            ),
            dbc.Button(
                "Stop Logs",
                id={"type": "stop-btn", "index": device_id},
                size="sm",
                color="danger"
            ),
        ]
    )

    return cards + [card]

# -------------------
# Device Control (Selected Only)
# -------------------
@app.callback(
    Output({"type": "device-status", "index": ALL}, "children"),
    Output({"type": "device-card", "index": ALL}, "style"),
    Input({"type": "start-btn", "index": ALL}, "n_clicks"),
    Input({"type": "stop-btn", "index": ALL}, "n_clicks"),
    Input("start-all", "n_clicks"),
    Input("stop-all", "n_clicks"),
    State({"type": "device-status", "index": ALL}, "id"),
    State({"type": "device-select", "index": ALL}, "value"),
    prevent_initial_call=True
)
def update_status(start, stop, start_all, stop_all, ids, selected):
    t = ctx.triggered_id

    selected_ids = {v[0] for v in selected if v}

    if isinstance(t, dict):
        if t["type"] == "start-btn":
            backend_start_logs(t["index"])
        elif t["type"] == "stop-btn":
            backend_stop_logs(t["index"])

    elif t == "start-all":
        for d in selected_ids:
            backend_start_logs(d)

    elif t == "stop-all":
        for d in selected_ids:
            backend_stop_logs(d)

    statuses = [
        f"Status: {devices[i['index']]['status']}"
        for i in ids
    ]
    styles = [
        {
            "background-color": (
                "lightgreen"
                if devices[i['index']]['status'] == "running"
                else "lightgray"
            )
        }
        for i in ids
    ]

    return statuses, styles

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
def remove_selected_devices(_, selected, cards):
    selected_ids = {v[0] for v in selected if v}
    if not selected_ids:
        raise PreventUpdate

    for d in selected_ids:
        devices.pop(d, None)

    cards = [
        c for c in cards
        if c["props"]["id"]["index"] not in selected_ids
    ]

    return cards

# -------------------
# Snapshot Table
# -------------------
@app.callback(
    Output("log-snapshots-container", "children"),
    Input({"type": "device-status", "index": ALL}, "children"),
)
def update_snapshots(_):
    if not log_sessions:
        return html.P("No log snapshots yet.")

    rows = []
    for i, s in enumerate(reversed(log_sessions)):
        rows.append(
            html.Tr([
                html.Td(dcc.Checklist(options=[{"label": "", "value": i}], id={"type": "log-check", "index": i})),
                html.Td(s["device_name"]),
                html.Td(s["start"]),
                html.Td(s["stop"] or "-"),
                html.Td(f"{s.get('duration', 0)} s"),
                html.Td(f"{round(s.get('size', 0)/1024, 2)} KB"),
                html.Td(dbc.Button("View Logs", id={"type": "view-log-btn", "index": i}, size="sm"))
            ])
        )

    return dbc.Table(
        [
            html.Thead(html.Tr([
                html.Th("✔"),
                html.Th("Device"),
                html.Th("Start"),
                html.Th("Stop"),
                html.Th("Duration"),
                html.Th("Size"),
                html.Th("Action")
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
def show_logs(view_clicks, view_selected, close, checked):
    t = ctx.triggered_id

    # ---- Close modal ----
    if t == "close-modal":
        return False, None

    # ---- Explicitly ignore non-user actions ----
    if t is None:
        raise PreventUpdate

    # ---- Single snapshot view ----
    if isinstance(t, dict) and t["type"] == "view-log-btn":
        # 🔒 Ignore component creation / refresh
        if view_clicks[t["index"]] is None or view_clicks[t["index"]] == 0:
            raise PreventUpdate

        s = log_sessions[len(log_sessions) - 1 - t["index"]]
        df = s["logs"].copy()
        df["device"] = s["device_name"]

    # ---- Multi snapshot view ----
    elif t == "view-selected":
        if not view_selected:
            raise PreventUpdate

        selected = [i for i, v in enumerate(checked) if v]
        if not selected:
            return True, html.P("No snapshots selected")

        dfs = []
        for i in selected:
            s = log_sessions[len(log_sessions) - 1 - i]
            d = s["logs"].copy()
            d["device"] = s["device_name"]
            dfs.append(d)

        df = pd.concat(dfs)

    else:
        raise PreventUpdate

    df = df.sort_values("timestamp")

    table = dash_table.DataTable(
        columns=[{"name": c, "id": c} for c in df.columns],
        data=df.to_dict("records"),
        page_size=15,
        style_table={"overflowX": "auto"}
    )

    return True, table

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
    df = pd.DataFrame(table.data)
    return dcc.send_data_frame(df.to_csv, "logs.csv", index=False)

# -------------------
if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=8050)

# TODO
# add new buttons for each log snapshot download in log modal view
# change logs snapshot view to add follwoing columns (duration, size)
# add remove button for each device with confirmation dialog
# add save button to view selected logs modal
# add better heading bar with logo etc