# Visual Timeline

Scrub-able visual timeline and multiview panel for image feeds — kiosk
screens, security cameras, website thumbnails, anything that can post a
JPEG on a heartbeat cadence.

- **Timeline mode**: every source is a strip of time-proportional frame
  slices. Hover to set a global time cursor across all sources (with a
  floating magnifier); offline periods render as hatched gaps at their
  true temporal width; drag to zoom the dashboard time range.
- **Multiview grid mode**: one tile per source showing the most recent
  frame — or, with *Follow shared crosshair*, the frame at the moment
  you're hovering on any other panel.
- **Two-way shared-crosshair sync** with other Grafana panels: hover a
  metrics chart and watch what every screen showed at that instant.
- **Click** any frame for a larger preview (hi-res variant when the
  backend provides one).

Works out of the box with **built-in demo data** — add the panel to a
dashboard and explore. To show real frames, point the panel's **API URL**
option at any backend implementing the small frames API (heartbeat-cadence
JPEG uploads over HTTP; see the repository's `docs/API.md`). A reference
backend — a single-file Cloudflare Worker over R2, free-tier friendly —
ships in the repository along with a standalone web app and a fleet
simulator.

## Options

| Option | Meaning |
|---|---|
| API URL | frames API base URL; empty = demo data |
| Sites | site filter expression (e.g. `${site:csv}`) — keep the variable here so Grafana refreshes the panel on change |
| Display mode | Timeline or Multiview grid |
| Follow shared crosshair | grid only: track the crosshair time vs always-latest |
| Image fit | Fit letterboxes; Fill crops. Never stretches |
| Show cadence details | per-source capture cadence + display resolution |
