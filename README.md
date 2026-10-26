# PulseOrbit — 3D Internet Speed Tester

A static, build-free internet speed test with a Three.js "network planet" hero, a live speedometer, light/dark themes and real measurements of **download, upload, ping and jitter**. It runs on GitHub Pages with no backend.

**Live demo:** https://aliyangilani.github.io/pulseorbit-internet-speed-tester/

> Nothing is simulated. Every number comes from real transfers to a public test server. If a measurement fails, the interface says "Unavailable" and why.

## Features

- Download / upload (Mbps), ping and jitter (ms), with live progress and stage indicators
- Animated speedometer (non-linear 0–1000 Mbps scale), live readout, completion animation
- Original Three.js scene: globe, network nodes, curved data arcs with moving particles, orbital fibre rings, dust; reacts to mouse, speeds up and changes colour per test stage, shock-wave when finished
- Light and dark themes: toggle in the header, saved in `localStorage`, follows the OS on the first visit, no flash on load
- Start, cancel and retest; failed/timed-out stages handled; double-starts prevented
- Last 10 results in `localStorage` with a small chart, clear-history button
- Copy results, Web Share API with clipboard fallback
- Responsive (mobile → desktop), keyboard accessible, visible focus, `prefers-reduced-motion` support
- WebGL fallback: a CSS-only orbit graphic is shown if WebGL or Three.js is unavailable; the speed test still works

## Technologies

HTML5, CSS3 (custom properties), vanilla JavaScript (ES modules), [Three.js r160](https://threejs.org/) (MIT, loaded from a CDN with a local-file fallback), Fetch / XHR / Performance / AbortController / localStorage APIs.

## Project structure

```
internet-speed-tester/
├── index.html
├── css/style.css            # design tokens (light + dark), layout, components
├── js/
│   ├── app.js               # UI wiring, history, copy/share
│   ├── config.js            # ← endpoints, durations, GitHub URL
│   ├── speed-test.js        # measurement engine
│   ├── gauge.js             # speedometer
│   ├── theme.js             # light/dark manager
│   └── 3d-scene.js          # Three.js scene
├── assets/
│   └── favicon.svg
├── README.md  LICENSE  .gitignore  .nojekyll
```

All paths are relative, so the site works at the root or under a repository subpath such as `https://you.github.io/internet-speed-tester/`.

## How measurements work

| Metric | Method |
| --- | --- |
| Throughput | `bytes × 8 ÷ seconds ÷ 1,000,000` (decimal Mbps), timed with `performance.now()` |
| Ping | 20 requests for 0 bytes (+1 discarded warm-up). Uses Resource Timing `requestStart→responseStart` when exposed, otherwise fetch wall-clock. Reported as the **median**. |
| Jitter | Mean absolute difference of consecutive ping samples: `Σ|rttᵢ − rttᵢ₋₁| ÷ (n−1)` |
| Download | 4 parallel streaming fetches for ~8 s, cache-busted, bytes counted as they arrive; the first 1.5 s (TCP ramp-up) is excluded |
| Upload | 3 parallel XHR POSTs (4 MB incompressible payload) for ~7 s; bytes counted from upload progress events; first 1.5 s excluded |

Tests run for a fixed time rather than a fixed size, so small files cannot skew results. Browser measurements are **estimates**: they depend on the server, distance, Wi-Fi quality, other devices, VPNs and browser behaviour.

## Prerequisites

- [VS Code](https://code.visualstudio.com/) and a modern browser
- Either the **Live Server** VS Code extension, or Node.js (for `npx serve`), or Python 3
- [Git](https://git-scm.com/) and a GitHub account (for publishing)

## Run locally in VS Code

ES modules do not load from `file://`, so use a local web server:

1. **File → Open Folder…** and choose `internet-speed-tester`.
2. Install the **Live Server** extension (Ritwick Dey), then right-click `index.html` → **Open with Live Server**.

Or from the VS Code terminal (pick one):

```bash
npx serve .
python -m http.server 8080
```

Then open the printed address (for example `http://localhost:3000` or `http://localhost:8080`).

## Configuring endpoints

Edit `js/config.js`:

```js
endpoints: {
  provider: 'Cloudflare Speed Test (speed.cloudflare.com)',
  download: 'https://speed.cloudflare.com/__down',  // GET  ?bytes=N
  upload:   'https://speed.cloudflare.com/__up',    // POST body discarded
  ping:     'https://speed.cloudflare.com/__down',  // GET  ?bytes=0
}
```

Default: Cloudflare's public speed-test endpoints (also used by speed.cloudflare.com). They allow cross-origin requests, so they work from GitHub Pages. They are **not an official, guaranteed API** and may change; if they stop working the app shows "Unavailable" rather than fake numbers.

Using your own server? Requirements:

- **Download**: `GET <url>?bytes=N` returns N bytes (or change the code to your URL scheme), `Cache-Control: no-store`, `Access-Control-Allow-Origin: *` (or your Pages origin).
- **Upload**: accepts `POST` with a `text/plain` body and replies `2xx`, with `Access-Control-Allow-Origin` set. Set `upload: null` to disable the upload test; it will display as unavailable.
- **Ping**: a tiny, fast `GET` with CORS headers. Add `Timing-Allow-Origin: *` for the most accurate timings.

Also tune `ping`, `download`, `upload` durations and stream counts in the same file, and set `repoUrl` to your GitHub repository.

> **Static hosting limitation:** GitHub Pages serves static files only. It cannot receive uploads, so an upload test always needs an external endpoint (Cloudflare by default, or your own server/worker/VPS).

## Known limitations

- Results are estimates for the path to one test server.
- Multi-gigabit connections may be limited by the browser/CPU or the server.
- Upload bytes are counted from progress events and can slightly overstate very slow links (send buffers).
- A test can transfer hundreds of MB on fast connections — mind metered plans.
- Ad blockers or corporate networks may block `speed.cloudflare.com`.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Blank page / "ES modules… file://" banner | Serve over HTTP (see above), do not double-click `index.html`. |
| "Failed to fetch" for every stage | Offline, blocked by an extension/firewall, or the endpoint changed. Check DevTools → Network and `js/config.js`. |
| Upload unavailable | Endpoint missing or blocking CORS/POST. Configure another (see above). |
| 3D scene missing | WebGL disabled/unsupported; the CSS fallback is shown and the test still works. |
| Links 404 on GitHub Pages | Keep all paths relative (no leading `/`); make sure `index.html` is in the published folder root. |
| Theme not saved | Browser blocks `localStorage` (private mode); the theme still works for the visit. |
| Old version after deploy | Hard refresh (Ctrl+Shift+R); Pages can cache for a few minutes. |

## Git & GitHub Pages deployment

1. Create an empty repository on GitHub named `internet-speed-tester` (no README/licence – the project has them).
2. In the project folder:

```bash
git init
git add .
git commit -m "Initial commit: PulseOrbit speed tester"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/internet-speed-tester.git
git push -u origin main
```

3. On GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main`, folder `/ (root)` → Save**.
4. After a minute, the site is live at `https://YOUR-USERNAME.github.io/internet-speed-tester/`.
5. Update `repoUrl` in `js/config.js` and the three GitHub links in `index.html` (`href="https://github.com/YOUR-USERNAME/..."`), commit and push again.

`.nojekyll` is included so GitHub Pages serves the files as-is.

## Third-party services & licences

- Three.js — MIT (vendored; licence in `assets/vendor/three.LICENSE`). A CDN fallback (`unpkg.com`) is configured in `js/config.js` only if the local file is missing.
- Cloudflare speed-test endpoints — external service, used for test traffic only. No keys or secrets are used anywhere.
- PulseOrbit — MIT (see `LICENSE`).
