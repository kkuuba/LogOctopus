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
    devices[device_id]["status"] = "running"
    log_sessions.append({
        "device_id": device_id,
        "device_name": devices[device_id]["name"],
        "start": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "stop": None,
        "logs": pd.DataFrame(columns=["timestamp", "value"])
    })

def backend_stop_logs(device_id):
    devices[device_id]["status"] = "stopped"
    for session in reversed(log_sessions):
        if session["device_id"] == device_id and session["stop"] is None:
            session["stop"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            session["logs"] = pd.DataFrame({
                "timestamp": pd.date_range(start=session["start"], periods=5, freq="S"),
                "value": [1, 2, 3, 4, 5]
            })
            break

def backend_start_all():
    for device_id in devices:
        backend_start_logs(device_id)

def backend_stop_all():
    for device_id in devices:
        backend_stop_logs(device_id)

# -------------------
# Dash App
# -------------------
app = Dash(__name__, external_stylesheets=[dbc.themes.BOOTSTRAP])

log_modal = dbc.Modal(
    [
        dbc.ModalHeader(dbc.ModalTitle("Logs")),
        dbc.ModalBody(id="modal-body"),
        dbc.ModalFooter(dbc.Button("Close", id="close-modal"))
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
        dbc.Col(dbc.Button("▶ Start Logs for All", id="start-all", color="success"), width="auto"),
        dbc.Col(dbc.Button("⏹ Stop Logs for All", id="stop-all", color="danger"), width="auto"),
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
    Output("devices-container", "children"),
    Input("upload-json", "contents"),
    State("devices-container", "children"),
    prevent_initial_call=True
)
def upload_device(contents, cards):
    decoded = base64.b64decode(contents.split(",")[1])
    cfg = json.loads(decoded)

    device_id = backend_create_device(cfg)

    card = html.Div(
        id={"type": "device-card", "index": device_id},
        className="card",
        style={"background-color": "lightgray"},
        children=[
            html.H4(cfg.get("name", "Unnamed Device")),
            html.P("Status: stopped", id={"type": "device-status", "index": device_id}),
            html.Button("Start Logs", id={"type": "start-btn", "index": device_id}, className="card-button"),
            html.Button("Stop Logs", id={"type": "stop-btn", "index": device_id}, className="card-button"),
        ]
    )
    return (cards or []) + [card]

# -------------------
# Device Control
# -------------------
@app.callback(
    Output({"type": "device-status", "index": ALL}, "children"),
    Output({"type": "device-card", "index": ALL}, "style"),
    Input({"type": "start-btn", "index": ALL}, "n_clicks"),
    Input({"type": "stop-btn", "index": ALL}, "n_clicks"),
    Input("start-all", "n_clicks"),
    Input("stop-all", "n_clicks"),
    State({"type": "device-status", "index": ALL}, "id"),
    prevent_initial_call=True
)
def update_status(start, stop, start_all, stop_all, ids):
    t = ctx.triggered_id
    if not t:
        raise PreventUpdate

    if isinstance(t, dict):
        if t["type"] == "start-btn":
            backend_start_logs(t["index"])
        elif t["type"] == "stop-btn":
            backend_stop_logs(t["index"])
    elif t == "start-all":
        backend_start_all()
    elif t == "stop-all":
        backend_stop_all()

    statuses = [f"Status: {devices[i['index']]['status']}" for i in ids]
    styles = [{"background-color": "lightgreen" if devices[i['index']]['status']=="running" else "lightgray"} for i in ids]
    return statuses, styles

# -------------------
# Snapshot Table (with checkboxes)
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
                html.Td(dcc.Checklist(
                    options=[{"label": "", "value": i}],
                    id={"type": "log-check", "index": i}
                )),
                html.Td(s["device_name"]),
                html.Td(s["start"]),
                html.Td(s["stop"] or "-"),
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
                html.Th("Action")
            ])),
            html.Tbody(rows)
        ],
        bordered=True, hover=True
    )

# -------------------
# Modal Logic (single + combined)
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

    if t is None:
        raise PreventUpdate

    if t == "close-modal":
        return False, None

    # 🔒 Ignore component-creation events
    if isinstance(t, dict) and t["type"] == "view-log-btn":
        if view_clicks[t["index"]] is None or view_clicks[t["index"]] == 0:
            raise PreventUpdate

    dfs = []

    # Single snapshot
    if isinstance(t, dict) and t["type"] == "view-log-btn":
        idx = t["index"]
        session = log_sessions[len(log_sessions)-1-idx]
        df = session["logs"].copy()
        df["device"] = session["device_name"]
        dfs = [df]

    # Multiple snapshots
    elif t == "view-selected":
        selected = [i for i, v in enumerate(checked) if v]
        if not selected:
            return True, html.P("No snapshots selected")

        for i in selected:
            s = log_sessions[len(log_sessions)-1-i]
            df = s["logs"].copy()
            df["device"] = s["device_name"]
            dfs.append(df)

    if not dfs:
        raise PreventUpdate

    df_all = pd.concat(dfs).sort_values("timestamp")

    table = dash_table.DataTable(
        columns=[{"name": c, "id": c} for c in df_all.columns],
        data=df_all.to_dict("records"),
        page_size=15,
        style_table={"overflowX": "auto"}
    )

    return True, table

# -------------------
if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=8050)

# TODO
# add new buttons for each log snapshot download in log modal view
# change logs snapshot view to add follwoing columns (duration, size)
# add remove button for each device with confirmation dialog
# add save button to view selected logs modal
# add better heading bar with logo etc