# Changelog

## 0.7.0

- Cadence events: sources can change pace (a new `X-Cadence` on upload) or
  declare a pause (`POST /declare`) — the timeline renders each era on its
  own grid, so slow eras aren't false gaps and declared pauses show as
  neutral silence instead of the red offline treatment. Undeclared silence
  still renders offline (the heartbeat contract survives crashes, including
  a crash while paused). Resume is inferred from frames; the worker also
  closes the paused era in the registry on the next upload.
- Slot widths are time-proportional across era boundaries — the x-axis
  stays linear through pace changes and pauses.

## 0.6.0

- One shared UI core (`src/core.ts`) behind the Grafana panel, the
  standalone app, and the embed page (`web/vt-core.js` build).
- Frame-boundary hairlines when slices are wide enough to earn them.

## 0.5.0 (first public cut)

Everything to date, extracted from the original kiosk-fleet project:

- Timeline mode: hover-to-scrub tapestry strips (one per source), global
  time cursor, floating magnifier, offline gaps rendered at their true
  temporal width, drag-select zoom, per-source cadence with pixel-budget
  downsampling, double-buffered flash-free refresh, cursor continuity
  across refreshes.
- Multiview grid mode: one tile per source showing latest-in-range or
  following the shared crosshair; offline tiles hatched with last-seen.
- Two-way Grafana shared-crosshair sync (DataHoverEvent).
- Click-in preview at the cursor, hi-res variant with lo fallback.
- Built-in demo data; `API URL` option binds to any backend speaking the
  frames API (docs/API.md). Reference backend: Cloudflare Worker + R2.
