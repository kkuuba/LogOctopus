# LogOctopus — Live Demo

A fully static build of the real `LogOctopus.jsx` frontend, wired up to an
in-browser mock API instead of the Flask backend. No server, database, or
SSH access required — it's just fake data living in a JS array.

**How it works:** `src/mock/mockApi.js` monkey-patches `window.fetch` so any
request to a `/api/...` path is intercepted and answered from
`src/mock/fixtures.js` (fake devices, log snapshots, packet captures, system
stats, etc). Everything else (Monaco's CDN scripts, Plotly's CDN script)
passes straight through untouched. `src/LogOctopus.jsx` is an **unmodified
copy** of the production component — if you update the real app, just
re-copy the file over this one and the demo stays in sync.

Demo admin login: **admin / demo123** (hardcoded in `mockApi.js`, not a real
credential).

## Local development

```bash
npm install
npm run dev
```

## Production build

```bash
npm install
npm run build     # outputs to dist/
npm run preview   # sanity-check the build locally
```

## Deploying to GitHub Pages

1. Move/keep this folder at `demo/` in your repo root (the included workflow
   assumes that path).
2. In the repo Settings → Pages, set **Source** to "GitHub Actions".
3. Edit `.github/workflows/deploy-demo.yml` and replace `REPO_NAME` in the
   `VITE_BASE_PATH` env var with your actual repository name (needed because
   project pages are served from `https://<user>.github.io/<repo>/`, not the
   domain root).
4. Push to `main`. The workflow builds and deploys automatically. Your demo
   will be live at `https://<user>.github.io/<repo>/`.

If you'd rather host it as a user/org page (`<user>.github.io` root repo) or
on another static host (Netlify, Vercel, Cloudflare Pages), set
`VITE_BASE_PATH=/` (the default) and just run `npm run build`.

## Keeping the demo data fresh

All fake data lives in `src/mock/fixtures.js` — devices, log snapshots, and
generated log/chart/packet rows. Edit that file to change what visitors see;
no need to touch `mockApi.js` unless you're adding a new endpoint the real
backend doesn't have yet.

## Limitations (by design)

- pcap file download returns a friendly "not available in demo" 404.
- SSH test-connection / exec-command return simulated success/output —
  nothing actually connects anywhere.
- Data resets on every page reload (in-memory only).
