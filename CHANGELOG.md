# Changelog

## 0.9.16

- Repository CI is green: the scaffold's lint config is now satisfied
  (mechanical brace style via eslint --fix, one comma-expression split)
  and build artifacts (web/vt-core.js, wrangler scratch) are excluded
  from linting. No behavior change.

## 0.9.15

- injectStyles refreshes the shared style tag when a newer module version
  executes in a long-lived page — previously the first-injected CSS won
  forever, so a plugin update could render with the previous version's
  styles until a hard reload.

## 0.9.14

- The future looks EMPTY, not black: the beyond-now region renders as
  the card's own surface, ruled only by hairlines continuing the axis
  ticks — black is its own signal in a screenshot timeline (a dark
  screen), so the unknown future no longer borrows it. Hovering there
  shows no magnifier at all: nothing to preview, only the crosshair and
  time pill. The one rendered thing in the future remains the pulsing
  live-edge slot. Ruling re-renders as the poll carves the spacer.

## 0.9.13

- Time axis ticks now behave like Grafana's own panels. Increments span
  the full range uPlot uses (minutes through years, not capped at 1 day)
  and snap to local calendar boundaries — midnight, the top of the hour,
  the 1st of the month — instead of raw epoch-multiple offsets, so grids
  no longer drift off local `:00`/midnight in non-UTC timezones.
- Tick spacing is sized from the actual rendered label width (canvas
  `measureText`, same idea as Grafana's `calculateSpace`) instead of a
  flat 90px guess, and each zoom tier gets its own label format
  (minute/hour/day/year) instead of one whole-axis binary switch. A
  30-day view went from 4 ticks to a Grafana-matching 15.
- Axis text and tick marks now match Grafana's native dark-theme styling
  exactly: 12px Inter, `rgb(204,204,220)` labels, `rgba(240,250,255,.09)`
  grid/tick color — pulled straight from `@grafana/data`'s theme source
  rather than eyeballed.

## 0.9.12

- The future is now rendered as unknown, not predicted: every era is
  clamped to now, so pause bands (SYSTEM DOWN, SCREEN DARK, ...) stop at
  the present instead of shading the rest of the window, and only ONE
  pending slot exists — the tick whose frame is in flight — pulsing
  gently as an in-limbo indicator. Everything past now is a single inert
  spacer: no shading, no labels, hover shows a plain dash.
- The live edge still slides between dashboard refreshes: the poll
  carves newly-elapsed ticks out of the spacer (or grows a tail pause
  band into it) as time actually passes.
- Cursor guard against zero-width stale wrappers mid-swap, and the
  live-edge rest cursor resolves to the latest frame rather than the
  spacer boundary.

## 0.9.11

- The live edge no longer flashes "offline — last seen" while the newest
  frame is in flight: a slot keeps its future grace until one full step
  past its tick (the same boundary the poll uses to age misses into real
  gaps), and the cursor says "expected — HH:MM" for a just-passed tick
  vs "upcoming — HH:MM" for one ahead of now.

## 0.9.10

- Sandwiched pause bands no longer corrupt into offline-red: uploads
  snap to the NEAREST cadence point, so the goodbye frame sent just
  before a declare could carry a key up to half a cadence after the
  pause began — a phantom "resume" that split the era into a sliver of
  pause plus a frameless "active" run of red gaps. Bounded pause eras
  (a later history event closes them) now trust the registry and never
  probe; only the unbounded tail era infers resume from frames, and it
  ignores the first cadence where the straggler lands.
- A window that is entirely declared-pause renders its band instead of
  vanishing: hideEmpty now treats declared pause as data.

## 0.9.9

- Hatch continuity done right: the fixed-attachment trick from 0.9.7
  doesn't paint inside Grafana's transformed panels (Chrome), reading as
  a solid block. Empty slots now get their hatch background-position
  aligned to their strip offset post-layout instead — continuous
  diagonals everywhere, including Grafana.
- Wide pause bands carry their label inline (SCREEN DARK (UNEXPECTED),
  SYSTEM DOWN (PLANNED), ...) in the reason's color — a strip that is
  all pause explains itself without a hover.
- The neutral paused hatch got a visible stripe contrast.

## 0.9.8

- A hung backend (e.g. a dead dev worker still holding its port) left the
  panel blank forever: the registry fetch never resolved, so boot never
  finished and nothing said why. API requests now carry a 15s timeout,
  and a failed/timed-out registry fetch renders "frames API unreachable"
  in the panel instead of silence.

## 0.9.7

Four fixes from live fleet use:

- A refresh that swapped the DOM under a stationary cursor dimmed every
  card, including the hovered one — the browser fires `mouseenter` on the
  new strip but no `mousemove`, so the dim class landed with no card
  marked hovered. Enter now positions the cursor too.
- The click-in hi-res preview no longer closes on every dashboard
  refresh: it's leased across the double-buffered remounts (the successor
  mount adopts it; a real unmount closes it after a grace).
- Hatch patterns (offline, paused, reasons) are painted with fixed
  attachment so the diagonals run continuously across adjacent slots —
  per-slot gradients restarted at every slot edge, and narrow-slot runs
  showed only the first stripe color (a solid block).
- Slots ahead of *now* are `future`, not offline: plain dark instead of
  red hatch, "upcoming" instead of "offline — last seen", and they age
  into real gaps only a full step past their tick with no frame.

## 0.9.4 – 0.9.6

- **Pause reasons + intent**: `POST /declare` accepts `X-Reason`
  (`quiet | screen-sleep | app-stopped | system-down`) and `X-Intended`
  (0/1); both ride the history event. Re-declaring with a different
  reason while paused splits the band. Planned reasons render as
  distinct cool-hue hatches with their own labels (SCREEN ASLEEP /
  SYSTEM DOWN (PLANNED) / APP STOPPED / QUIET HOURS); `intended=false`
  gets the amber triage hatch and SCREEN DARK (UNEXPECTED). Undeclared
  silence stays offline-red: red means nobody said goodbye.

## 0.9.3

- A resume frame landing exactly on a paused era's end boundary produced
  a zero-width active era and a degenerate `/frames?from==to` call that
  killed the whole panel. The resume probe now only accepts frames
  strictly inside the era, degenerate spans are skipped, and the
  reference worker answers zero-width windows with `[]` instead of 400.
- Boot resilience: one source's backend error no longer blacks out the
  panel — the source is skipped with a console warning and retried on
  the next refresh.

## 0.9.2

- Multiview tiles run the inline-header gradient vertically (top fade)
  — the horizontal fade only makes sense on wide timeline strips.

## 0.9.1

- Inline header redesigned per feedback: no scrim block. The hostname
  gets its own solid chip bubble, the meta chips keep theirs, all
  floating free over the image. A third `Header` choice — Inline ·
  gradient — backs them with a full-height left-to-right fade for busy
  frames. Web: `?header=inline` or `?header=inline-gradient`.

## 0.9.0

- **Inline header mode**: a `Header` option (Bar / Inline overlay). Inline
  renders each source's header as a two-line scrim badge over the top-left
  of the strip or tile — hostname first, details second — instead of
  spending a row of card height. The badge clamps to two lines, lets all
  pointer events through, and sits under the magnifier and crosshair.
  Web app/embed: `?header=inline`.

## 0.8.4

- `site:<id>` annotation tag scopes an event to every source at that site
  (points and regions). Scoped annotations whose target isn't on the panel
  are dropped rather than shown as global — their context is absent.
- Click a marker to PIN its tooltip: text becomes selectable and http(s)
  URLs in annotation text render as real links (opens in a new tab).
  Click elsewhere or press Escape to release.
- Demo dashboards ship their annotation layer with `hide: false`, so
  Grafana's native per-layer toggle appears in the dashboard controls.
- Demo data: a site-scoped `site:site-b` event and a URL in the deploy
  annotation exercise both features.

## 0.8.3

- Cluster markers show a count badge (×N) instead of only growing
  slightly; the tooltip still lists every member chronologically.
- Demo data now exercises the full annotation matrix: global point,
  source-pinned point, global region, a color-coded source-scoped region
  explaining source-2's outage, and an alert burst tight enough to
  cluster.

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
