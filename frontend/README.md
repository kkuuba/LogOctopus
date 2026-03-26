# LogOctopus — Frontend

React + Vite single-page application for the LogOctopus log-collection platform.
It talks to the Flask REST backend (`app.py`) via the `/api/*` endpoints.

---

## Prerequisites

| Tool | Minimum version |
|------|----------------|
| Node.js | 18 LTS |
| npm | 9 |

---

## Quick start (development)

```bash
# 1. Install dependencies
npm install

# 2. (Optional) configure the backend URL
cp .env.example .env
# Edit .env if your Flask server is NOT on http://localhost:8050

# 3. Start the Vite dev server
npm run dev
```

Open **http://localhost:5173** in your browser.

> **Proxy**: `vite.config.js` proxies all `/api/*` requests to `http://localhost:8050`
> so you do not need to configure CORS during development.

Make sure the Flask backend is running first:

```bash
# from the project root
python app.py
```

---

## Production build

```bash
npm run build        # outputs to dist/
npm run preview      # preview the production bundle locally
```

The `dist/` directory is a static bundle. You can serve it with any web server
(nginx, Caddy, etc.) or have Flask serve it directly — see the section below.

### Serving the frontend from Flask

Add this to `app.py` (after the existing imports):

```python
from flask import send_from_directory

# Serve the Vite production build
@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_spa(path):
    dist = os.path.join(os.path.dirname(__file__), "frontend", "dist")
    if path and os.path.exists(os.path.join(dist, path)):
        return send_from_directory(dist, path)
    return send_from_directory(dist, "index.html")
```

Then copy the `dist/` folder next to `app.py`:

```
your-project/
├── app.py
├── frontend/
│   └── dist/          ← npm run build output
└── backend/
    └── ...
```

---

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_API_BASE` | `""` (uses proxy) | Full base URL of the Flask backend for production builds, e.g. `https://logoctopus.example.com` |

---

## Project structure

```
frontend/
├── index.html            # HTML entry point
├── vite.config.js        # Vite + React plugin + dev-proxy config
├── package.json
├── .env.example
└── src/
    ├── main.jsx          # React DOM root
    └── LogOctopus.jsx    # Entire application (self-contained)
```

---

## API overview

The frontend expects the following REST endpoints on the backend:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/devices` | List all devices |
| POST | `/api/devices` | Add device (base64 JSON config) |
| DELETE | `/api/devices/:id` | Remove device |
| GET | `/api/snapshots` | List log snapshots (filterable) |
| GET | `/api/snapshots/:id/content` | Full log rows for a snapshot |
| POST | `/api/start-logs-collection` | Start collection on selected devices |
| POST | `/api/stop-logs-collection` | Stop collection and retrieve session URLs |

Click the **REST API** button in the app header for interactive documentation.
