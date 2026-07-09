# Visual Timeline

Scrub-able visual timeline and multiview for image feeds — kiosk screens,
security cameras, website thumbnails, anything that can post a JPEG on a
heartbeat. Hover to set a global time cursor across every source; gaps show
offline periods at their true temporal width; drag to zoom.

Three frontends, one small HTTP contract ([docs/API.md](https://github.com/comebacktomorrow/visual-timeline/blob/main/docs/API.md)):

- `src/` — **Grafana panel** (timeline + multiview grid modes, two-way
  shared-crosshair sync with other panels, drag-zoom drives the dashboard
  time range). Ships with built-in demo data — drop it on a dashboard and
  it works with zero infrastructure.
- `web/app.html` — **standalone app** with the chrome Grafana normally
  provides: site filter, timeline/grid/both modes, fit/fill, quick ranges,
  drag-zoom, and within-page cursor sync (hover the timeline, the grid
  follows). State lives in the URL — views are shareable links.
- `web/index.html` — **minimal embeddable viewer** (iframe-friendly;
  accepts Grafana dashboard-link params).

Backend reference implementation: `worker/` — a single-file Cloudflare
Worker over R2. Deterministic cadence-aligned keys, immutable frame
caching, per-step downsampling, per-site bearer auth. Designed to run a
real fleet on the R2/Workers free tier — but the panel binds to the API
contract, not to this backend; implement `docs/API.md` with anything.

## Core idea: cadence as a heartbeat

Every source declares how often it promises a frame. Timestamps snap to
that grid, storage keys become deterministic, and a *missing* frame means
*offline* — rendered as a hatched gap at its true width in the timeline,
and an offline tile in the multiview. Uploaders drop failed frames rather
than queueing them: the gap **is** the signal.

Cadence changes and declared pauses are first-class: the timeline renders
each era on its own grid, so a source that slows for quiet hours isn't a
wall of false gaps, and a deliberate pause (`POST /declare`) shows as
neutral silence — while an unexpected crash still renders as offline.

## Annotations

The panel renders the dashboard's own annotations — from any annotation
query on any data source (the built-in store, alerts, Loki, …). Point
annotations become diamond markers, regions shade their time span, and an
annotation tagged `source:<id>` pins to that source's strip while the rest
share a lane above the axis. Hover a marker for the details. The panel is
purely a renderer here: bring events from whatever system already has
them.

## Demo in two minutes (no cloud account)

```bash
cd worker && npm install
npx wrangler dev --port 8787        # local Worker + local R2, dev tokens in .dev.vars
```

1. `http://localhost:8787/sim.html` — **Backfill last 60 min** (and
   optionally live ticking): a simulated 5-source fleet uploads
   canvas-rendered frames through the real `/upload` path, including an
   outage and a hi-res variant.
2. `http://localhost:8787/app.html` — the standalone app on that data.
3. No backend at all? `web/app.html?backend=mock` renders built-in demo data.

Upload real frames with curl: see [docs/API.md](https://github.com/comebacktomorrow/visual-timeline/blob/main/docs/API.md).

## Grafana demo

```bash
docker compose -f demo/docker-compose.yml up
# → http://localhost:3300/d/visual-timeline-demo  (anonymous admin)
```

Grafana 11 with the panel mounted and a provisioned dashboard: timeline,
two multiview grids (follow-crosshair vs latest-only), and a random-walk
panel to see the two-way crosshair sync. Panels run on built-in demo data;
set each panel's **API URL** option to a backend for live frames.

## Repository layout

| Path | What |
|---|---|
| `src/` | Grafana panel plugin source (create-plugin scaffold; `npm run build` → `dist/`) |
| `web/` | standalone app, embeddable viewer, fleet simulator |
| `worker/` | Cloudflare Worker + R2 reference backend |
| `grafana/` | provisioning for the Grafana demo |
| `docs/API.md` | the frames API contract + curl examples |

## License

Apache-2.0
