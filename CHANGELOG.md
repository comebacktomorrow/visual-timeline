# Changelog

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
