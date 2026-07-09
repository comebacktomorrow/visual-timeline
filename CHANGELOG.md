# Changelog

## 0.8.2

- Frame delineation now tints the frame instead of exposing the strip
  background. The old 1px `border-left` could never be covered by the
  frame image (overflow clips to the padding box), so every separator
  rendered as a hard near-black line over the `#111` background no matter
  the color set. It's now an `::after` overlay above the image: a whisper
  of shade (black 5%) plus a light inner edge (white 12%) — the seam
  shades light frames and highlights dark ones.

## 0.8.1

- **Annotation lanes** option: `Shared` (one lane above the axis, the
  default) or `Per source` — every source gets its own lane under its
  strip carrying its events plus the globals, which reads better when
  many stacked timelines each have their own story. Web app/embed:
  `?annLanes=per-source`.
- Header chips (timeline cards and multiview tiles) never wrap or
  half-clip: a chip either fits whole on its single line or drops out of
  view; the head tooltip always carries the full set.

## 0.8.0

- Annotations: the panel renders the dashboard's annotations (any
  annotation query, any data source). Points are diamond markers —
  `source:<id>`-tagged ones on that source's strip, the rest on a shared
  lane above the axis; regions shade their span; markers cluster when
  dense; hover for details. Toggle with the **Show annotations** option.
- `skipDataQuery` is now off so annotation data reaches the panel; the
  panel declares annotation support via `setDataSupport`.

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
