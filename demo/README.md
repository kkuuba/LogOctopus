# LogOctopus — live demo

A static build of the **real, unmodified** LogOctopus frontend running against an
in-browser fake backend. No server, no database, no devices: deploy `dist/` anywhere.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # → dist/ (relative base: works from any URL or sub-path)
npm test           # mock-backend regression tests
```

Admin sign-in: `admin` / `admin`.

## Updating the demo when the frontend changes

`src/LogOctopus.jsx` is a **verbatim copy** of the app's frontend — never edit it here.

```bash
npm run sync -- ../path/to/LogOctopus.jsx   # copy it over + check the mock still covers it
npm test
```

`sync` (also available alone as `npm run check:api`) lists every `/api/...` path the
frontend uses and fails if the mock has no handler for one. Fix it by adding an
`on("METHOD", "/api/…", handler)` route in `src/mock/mockApi.js`.

## How it works

| File | Role |
| --- | --- |
| `src/main.jsx` | Installs the mock **before** rendering, then mounts banner + app + tour. |
| `src/mock/mockApi.js` | Route table replacing `fetch("/api/*")`. State lives in memory and is mirrored to `sessionStorage` (survives reloads, resets when the tab closes; the banner's *Reset demo* restores it). |
| `src/mock/fixtures.js` | Devices (real config schema), device groups, 9 historical sessions, dissectors. Two devices start mid-collection. |
| `src/mock/generators.js` | Deterministic log text, chart series and packet captures derived from the snapshot id — so shared links (`?open_snaps=…&line=N`) reproduce exactly. Also builds a **real downloadable `.pcap`** and per-packet detail trees. |
| `src/mock/events.js` | Tells the tour panel what the visitor actually did. |
| `src/demo/*` | Info banner (in normal flow, so it never covers the app's sticky header) and the guided tour. |

Behaviours worth knowing: starting a collection on an offline device (Firewall-Edge) is
refused; stopping one saves one snapshot per configured log (plus a capture when
configured), with the app's progress overlay; the Config Builder's *Test connection* and
*Run command* are simulated; "Add Device" accepts any valid config.

## Deploying to GitHub Pages

```yaml
# .github/workflows/demo.yml
name: Deploy demo
on: { push: { branches: [main] } }
permissions: { contents: read, pages: write, id-token: write }
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: { name: github-pages, url: "${{ steps.d.outputs.page_url }}" }
    defaults: { run: { working-directory: demo } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm, cache-dependency-path: demo/package-lock.json }
      - run: npm ci && npm test && npm run build
      - uses: actions/upload-pages-artifact@v3
        with: { path: demo/dist }
      - id: d
        uses: actions/deploy-pages@v4
```

External resources loaded at runtime by the app itself: Google Fonts, Monaco (jsDelivr) and Plotly (cdn.plot.ly).
