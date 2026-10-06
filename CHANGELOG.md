# Changelog

## 1.0.1 (2026-10-07)

- **Demo data is a data source setting.** The Visual Timeline API data source
  has a **Demo data** switch: panels using a data source with it on draw the
  built-in demo sources, and no API is called (Save & test says so). A panel
  no longer shows demo data on its own.
- **A new panel finds its data source.** While a panel is being created or
  edited with no data source selected, it takes the only Visual Timeline data
  source, or Grafana's default among several, and the choice is saved with the
  panel. A saved panel is never re-pointed when data sources change.
- **A panel that can't show frames says why.** With no Visual Timeline data
  source at all it offers to add one (Grafana admins) or to ask an admin
  (everyone else); with one or more, it asks you to select one; with a
  deleted data source, it says it no longer exists, instead of a proxy
  error.
- **Upgrading from 1.0.0:** a panel with neither a data source nor an API URL
  showed demo data and now asks for a data source. Add a data source with
  Demo data on to get the demo back.
- Self-hosted stack: its Compose project is now `visual-timeline-selfhost`
  (was `visual-timeline`, the repository's own dev stack, so running both
  replaced one Grafana with the other). Its frames volume is
  `visual-timeline-selfhost_frames`.
- The demo and dev environments provision a "Visual Timeline (demo)" data
  source, and their dashboards use it.
- Reference worker and self-hosted image: `sharp` (an image library wrangler's
  Miniflare pins at 0.35.4) is overridden to 0.35.5 for GHSA-wq5f-xc86-pv6w,
  a high-severity issue in its bundled SVG library. The deployed worker
  doesn't use it; the self-hosted backend runs wrangler, so it ships it.

## 1.0.0 (2026-10-06)

### Highlights

- **An app with an API data source.** The plugin is now a Grafana app that
  installs the panel and a Visual Timeline API data source. The data source
  keeps the viewer token in Grafana's encrypted settings and adds it on the
  server, so the token no longer has to sit in dashboard JSON. The panel's
  API key option is removed; see "Upgrading" in the README.
- **Light and dark themes.** The panel follows Grafana's theme, including a
  live switch.
- **Time zones.** The panel follows the dashboard's time zone, and a source
  can declare its own, shown in its header and, optionally, on its
  thumbnails.
- **A time axis that matches Grafana's own** time series panel, at every
  range and width.
- **Faster on slow connections.** Thumbnails load newest first, and the
  reference worker's image URLs stay the same between refreshes, so
  browsers keep them cached.
- **Security fix:** text from the API (source ids, sites, locations, tags)
  is now escaped before display instead of being inserted as HTML (#59).
- **Self-hosting (experimental).** The backend and a ready Grafana run on
  your own hardware from one Docker Compose file, with an uploader for IP
  camera snapshots. See `selfhost/README.md`.
- **Retention.** The reference worker can delete frames past a number of
  days, and the panel shows that time as **No data**.

### All changes

- Self-hosted stack (`selfhost/`, experimental): Docker Compose for the reference backend
  (the same worker code, on workerd through wrangler's local mode, with frames
  on a volume) and Grafana 12 with the app, a provisioned data source and a
  starter dashboard. A camera uploader service reads `selfhost/cameras.json`
  and posts each camera's snapshot URL once a minute, shrunk to 640 px, each
  camera on its own schedule; failed frames are dropped. The same
  `snapshot-uploader.sh` runs outside Docker, for a camera file or a single
  camera.
- Retention. The reference worker deletes frames older than
  `RETENTION_DAYS` (and, optionally, hi-res frames older than
  `RETENTION_DAYS_HI`), pruning after uploads, so it needs no scheduler and
  works the same on Cloudflare and self-hosted. `/sources` then starts each
  history with a pause (reason `expired`) ending at the cutoff, and the panel
  draws that span as **No data**, flat rather than hatched, instead of as
  offline. The self-hosted stack keeps 30 days by default.
- Reference worker: new optional `PUBLIC_URL`, the address browsers use.
  Image URLs are built on it, still signed, for a worker that Grafana reaches
  on an address browsers can't (a Docker network, say). Unset, nothing
  changes.

- Strip images load newest first. A timeline holds one image per slot,
  hundreds per source, and the browser used to fetch them all at once in
  page order, oldest first, so on a slow connection the live edge arrived
  last. They now load newest to oldest across every source, 4 at a time,
  so each card fills in from the right. The magnifier, the click-in
  preview and the live poll's new frames don't queue.
- Reference worker: signed image URLs no longer change on every refresh.
  The signature's expiry was "now + 24 h", so each `/frames` response
  minted new URLs and browsers re-downloaded every thumbnail on each
  dashboard refresh, despite the year-long immutable cache header. The
  expiry is now rounded up to a 6-hour boundary (valid 24-30 h), so the
  URLs stay the same within each 6-hour block.
- The time axis matches Grafana's own time series panel at every range and
  width. It used to fall apart at some ranges: at 12 hours it showed
  "06/10, 05:00" on every hourly tick where Grafana shows "05:00" every half
  hour, and on narrow panels the labels overlapped.
  - **Same rules as Grafana:** tick spacing is the measured label width plus
    18 px (Grafana's `calculateSpace`), and the step list adds uPlot's 4 h,
    8 h and 2/4/6-month steps. Dates appear only once the range is longer
    than a day, and 1-minute steps show seconds (Grafana's `formatTime`).
  - **Grafana's formats:** inside Grafana the labels use Grafana's own date
    formats (`systemDateFormats`), so an instance's configured formats
    apply. The standalone pages keep their locale's date order.
  - **Overlap fixed:** labels were measured at 10 px but drawn at 12 px.
    They are now measured as rendered.
  - **No half-hidden labels:** a label that would be cut off at either end
    of the axis, or that sits under the cursor tag, now hides its text and
    keeps its tick mark. Scrubbing still costs one layout per move.
- **Removed: the panel's API key option.** It stored the viewer token in
  plain text in the dashboard JSON. An API that needs a token now connects
  only through a Visual Timeline API data source; the API URL option stays
  for APIs with open reads. A panel that still carries an old key never
  sends it and says what to do instead. See "Upgrading" in the README, and
  revoke any token that was saved in a dashboard.
- Token errors in the panel say what went wrong (#81). A rejected data
  source token (which Grafana's proxy reports as a 400) used to read as
  "frames API unreachable — kiosks 400"; it now says the data source's token
  was rejected and where to check it. A 401 or 403 from an API reached
  directly, a proxy that can't reach the API, and other statuses each get
  their own message. "frames API unreachable" is kept for network errors
  and timeouts.
- Internal: build-time dependency advisories. `source-map-js` is pinned to
  1.2.2 (CVE-2026-93749). `braces` 3.0.3 (CVE-2026-93687) has no fixed
  release and is reached only by the scaffold's build-time lint plugin, so
  it is accepted until 2027-01-06 in `osv-scanner.toml`, which the catalog
  validator and the project checks' advisory gate both read.
- The magnifier caption of a portrait source, e.g. `16:35:00 (+5h45m)`, no
  longer wraps and clips in its narrow magnifier: it overflows it on one
  line, centred, and stays inside the strip at either end. Landscape
  sources look as before.
- Offline stretches that start while a live timeline is open now hatch in
  continuous diagonals like the ones drawn at load, instead of restarting
  the stripes at every slot (#77).
- An unknown time zone name used both as the panel zone and as a source's
  declared zone now logs both console warnings, once each (#77).
- A source's slots are all judged pending or offline against one "now"
  taken when the timeline is built, including the start slot of a short
  era next to a pause (#77).
- Internal: the timeline core moved from one untyped `src/core.ts` into
  typed modules under `src/vt/` (#64); `src/core.ts` now only re-exports,
  and no `@ts-nocheck` is left. Rendering is unchanged, checked by new
  snapshot tests of the exports, the `VTCore` global and the rendered demo
  DOM. `npm run bench:scrub` measures scrubbing cost (see `perf/README.md`).
- Scrubbing is faster with many sources: moving the cursor used to force
  two layouts per source (each card's widths were read after the previous
  card's styles were written). All widths are now read first, so a move
  costs one layout. With 20 sources a hover move dropped from 4.2 ms to
  under 1 ms, and from 28 ms to 5.5 ms at 4x CPU throttling
  (`npm run bench:scrub`, #64). The drag-zoom selection band gets the same
  change.
- Era boundaries (#65): where one era ends and the next begins, the later
  era owns the boundary tick, so it is no longer drawn twice, and an empty
  tick no longer shows as an offline gap right before a pause band. A
  boundary tick holding a frame the later era won't show (off its grid, or
  a goodbye frame at a pause's start) is kept. An active era too short to
  contain a tick gets one slot at its start, spanning it, showing the frame
  it sent even when that frame snapped just outside it.
- Per-source time zones (#68). A source can declare its zone with the new
  optional `X-Timezone: <IANA name>` header on `/upload`. The reference
  worker validates it (an invalid name is a `400` with a clear message),
  stores it with the source like `X-Location`, and returns it as `timezone`
  in `/sources`. Sources without one behave exactly as before.
- The timeline card and grid tile header of a source with a declared zone
  shows its city and its offset from the dashboard zone, e.g.
  `Sydney · +3h` or `Kathmandu · +5h45m` (just the city when the clocks
  agree). The offset is taken at the cursor, so it follows DST changes.
- New panel option **Thumbnail times**: Dashboard time (default, as
  before) or Source local time. With Source local time a zoned source's
  thumbnail timestamps, magnifier and preview captions and "last
  seen"/"expected" messages use its own zone, marked with the offset
  (`07:31:00 (+3h)`). The axis, crosshair and annotation tooltips stay in
  the dashboard zone. Core: `cfg.thumbTimes` (`'panel'`/`'source'`);
  standalone app and embed: `?thumbs=source`.
- Demo data: source-3 is in Australia/Sydney and source-5 in Asia/Kathmandu,
  and their frames show their own local clock, as a real screen would. The
  simulator (`web/sim.html`) uploads them the same way.
- Inline headers clip at exactly two lines: a chip that wraps to a third
  line no longer shows as a sliver. A narrow header now ellipsizes the site
  chip instead of cutting it off.
- Click-in preview: the hi-res frame now loads behind a Visual Timeline API
  data source too. Its URL is derived from the lo frame's own URL (same base
  and signature, per the `/frame/{variant}/…` contract) instead of the
  panel's API URL, which data source mode doesn't have. Site and source id
  are URL-encoded as path segments (#66).
- The panel follows the dashboard's time zone (#68, groundwork). It used to
  show browser time even on a dashboard set to UTC or to a named zone. The
  axis, cursor label, magnifier and preview captions, annotation tooltips,
  grid tile timestamps, "last seen"/"expected" messages and the demo
  frames' clock now use the dashboard zone, and the panel re-renders when
  that zone changes. "Default" resolves to the user's or org's preference.
  On a browser-time dashboard the text is the same as before.
- Core: `mountTimeline`/`mountGrid` take `cfg.timeZone` (an IANA name,
  `utc`, or undefined/`browser` for the browser's zone, the default).
  `resolveTimeZone`, `zonedParts`, `zonedTime`, `fmtTime` and `fmtShort`
  are exported, and every formatter and calendar helper takes the zone as
  its last argument. `alignedStart`, `nextTick` and `axisTicks` return
  epoch ms instead of a `Date`. Formatters are cached per zone.
- Standalone app and embed: optional `?tz=<IANA name>` or `?tz=utc`. The
  default is still the browser's zone. In the app the cursor time, window
  label, range button and time picker use the same zone.
- Fix axis ticks drifting after a DST change (#65). Hour-scale ticks
  stepped by raw milliseconds, so after a change 2-hourly ticks in New
  York landed on odd hours and hourly ticks in Lord Howe moved to :30.
  Ticks now stay on the zone's wall-clock grid: a skipped hour gets no
  tick and a repeated hour gets both. Day ticks also reset to midnight at
  each step, so a DST change at midnight (Santiago) no longer leaves every
  later tick on 01:00.
- Fix year ticks sitting on the 1st of the window's first month instead
  of 1 January, and quarter ticks counting from that month instead of
  Jan/Apr/Jul/Oct (#65).
- Fix a pause reason the panel does not know (say `maintenance`) leaving
  its `r-<reason>` class on the magnifier, card header or tile after the
  cursor left the band (#65).
- Fix the tag filter: `env=prod, =x` added a blank key that hid every
  source, and `env=` matched a source with an empty tags object but not
  one with no tags at all (#65).
- Fix a remount showing offline red where the running panel showed
  pending, at exactly one step past a tick (#65).
- The viewer token no longer has to sit in dashboard JSON (#62). The
  plugin is now an **app**, `savvycocoa1919-visualtimeline-app`, that
  bundles the panel and a new **Visual Timeline API data source** as nested
  plugins. It is one catalog entry and one install, and it is enabled on
  install (`autoEnabled`).
  - The panel keeps its id, `savvycocoa1919-visualtimeline-panel`, so
    existing dashboards keep working. If the standalone panel plugin is
    installed, uninstall it.
  - The data source (frontend-only, no backend) stores the API URL in
    `jsonData` and the viewer token, encrypted, in `secureJsonData`. A
    proxy route in its `plugin.json` makes Grafana's server add
    `Authorization: Bearer <token>`. **Save & test** checks `/sources`
    through that route and names the failure: rejected token, wrong URL
    or unreachable API.
  - The panel has a new **Data source** option. When it is set, `/sources`
    and `/frames` go through that data source's proxy, so the token never
    reaches the browser or the dashboard. Frame images still load straight
    from the API, so an API with read auth must sign its image URLs (the
    reference worker's `IMG_SIGN_KEY`).
  - The **API URL** and **API key** options stay for open APIs and existing
    dashboards. They are hidden while a data source is selected, and **API
    key** is deprecated.
  - `core.ts` gets an injectable fetch for this, so it stays
    framework-free.
  - Changing any `plugin.json` needs a Grafana restart; this one adds the
    app and the data source.
  - e2e runs against a mock frames API that answers only with the provisioned
    token, so CI checks that the token is injected server-side on every
    Grafana version in the matrix.
- Fix HTML injection (#59): source id, site, location and tags from the
  registry API were spliced unescaped into the card and grid-tile headers
  (including the `title` and `alt` attributes), so a hostile or malformed
  declaration could inject markup. They are now escaped. The standalone
  app's site chips are built from DOM nodes for the same reason.
- Docs: README is now written for Grafana catalog readers: what the panel
  shows, the built-in demo data, connecting a backend, the panel options and
  a note on the viewer token. All its links and images are absolute URLs, as
  the plugin validator requires (it flagged the relative link to
  `docs/UPSTREAM-UPDATES.md`). Repository layout, dev setup, testing and the
  upstream-update pointer moved to the new `CONTRIBUTING.md`.
- Unit tests for the timeline's pure logic, as a safety net for splitting
  `src/core.ts`: era construction from source history, pause labels, how
  slots become frames, offline gaps, pending slots (with the one-step
  grace and the "last known" ghost) or pause bands, axis tick alignment
  and labels across DST changes and in half-hour zones, and tag
  filtering. The tests pin current behaviour, including a few quirks
  marked `NOTE: current behaviour`. To make this testable, `core.ts`
  exports these functions, and three small pieces move out of
  closures unchanged: `slotClass` (a slot's state class), `missedHeartbeat`
  (pending → offline in the live poll) and `axisTicks` (the tick list the
  axis draws). No behaviour changes.
- The panel follows Grafana's light and dark themes (#61). Its palette
  used to be hard-coded dark, so on a light dashboard it showed as a dark
  block. Surfaces, text, borders and the live/offline/accent colours now
  come from the active theme and update when the theme is switched. On a
  light theme the offline hatching, pause bands and their reason colours,
  the pending-slot pulse and the inline header's gradient are derived
  from the light theme's own colours. The annotation tooltip and the
  click-in preview follow the panel that opened them. On a dark theme the
  panel looks as before. The standalone app and the embed keep their
  dark palette. A page that hosts the core can restyle it by setting
  the `--ktl-*` custom properties on the element it mounts into.

## 0.9.23 (2026-10-01)

- Standalone app: the time picker's "Recently used" list is built from
  DOM nodes instead of `innerHTML`. Its entries come from `localStorage`,
  so markup stored there could have run as script when the picker opened.
  Today's code only ever stores validated time expressions, so this was
  hardening against a tampered store rather than a reachable injection.
  Found by CodeQL (`js/xss-through-dom`).

## 0.9.22 (2026-09-25)

- The pending slot (its tick has passed, the frame is still in flight)
  carries the last frame as a "last known" ghost instead of a blank
  pulsing block. At the live edge that block read like a fault. The ghost
  keeps the same pulse, which stops it passing for a real frame. The
  magnifier, the click-in preview and a crosshair-following grid tile
  show it blurred as well, captioned "expected HH:MM · last frame HH:MM".
  A following tile used to turn red-hatched instead. When the frame
  arrives it replaces the ghost in place. After a gap or a pause there's
  nothing to carry, so that pending slot stays a plain skeleton. A missed
  heartbeat still turns red on schedule. The latest-only grid is
  unchanged. Under `prefers-reduced-motion` the pulses become a static
  dim.

## 0.9.21 (2026-09-25)

- Standalone app: ranges that end at now actually follow now. The app
  resolved `now-5m` once, at page load, so a "Last 5 minutes" tab still
  showed the same five minutes an hour later. Only its right-most slot
  kept updating, and a source that stopped after the page loaded never
  went red. The app now re-evaluates the range and re-mounts on a timer:
  every 30 s for short ranges, up to every 10 minutes for long ones. It
  waits while someone is scrubbing a strip, has the range picker open, or
  the tab is hidden. A pointer parked on a wallboard doesn't count as
  scrubbing, so it can't freeze the view.
- The LIVE badge is now a button. Click it to pause (the window stays
  put, and the badge reads PAUSED), and click again to jump back to now.
  It only appears on ranges that end at now. Before, it was a label that
  lit up for any window ending near page-load time, and it stayed lit
  however stale that window got. App chrome only: the Grafana panel
  moves with the dashboard's own refresh and is unchanged.

## 0.9.20 (2026-09-25)

### Fixes
- The viewer key stays out of image URLs that don't need it. Since 0.9.18
  the reference worker signs its image URLs so the long-lived key can be
  left out of them, but the client kept appending `?k=` to every frame
  URL, signed or not, and the click-in preview copied it along. Now only a
  bare image URL on the API's own origin gets `?k=`. Signed URLs are used
  as returned, and an image host that isn't the API (a public bucket
  domain) is never handed the key. This applies to the panel, the
  standalone app and the embed. The rule is written down under
  `GET /frames` in docs/API.md.
- Reference worker: long windows keep their newest frames. `/frames`
  scanned at most 3,000 frames per request, listing forward from `from`,
  so a window holding more (a week at a 60 s cadence) came back without
  its newest part, which the clients drew as offline. The scan now covers
  up to 25,000 frames. If a window holds even more, the response says
  where it stopped with an `X-Frames-Truncated-After` header, and the
  worker logs a warning, instead of dropping frames silently.

### Dependencies
- `@grafana/*` 13.2.2 with React 19, as dev dependencies (#40). Grafana
  supplies React to the panel at runtime. `grafanaDependency` stays
  `>=10.4.0`, and e2e passes on every Grafana from 10.4 to nightly.
- Scaffold (`@grafana/create-plugin`) 7.8.0 → 7.11.0 (#29, #42).
- Cleared the high-severity advisories that fail the plugin validator's
  osv-scanner: fast-uri, ip-address, js-yaml, nanoid, postcss and
  js-cookie (the last through an `overrides` pin) in August;
  browserslist and js-yaml again in September (#40).
- Routine Dependabot bumps: webpack-cli 7, @types/node 26, @emotion/css,
  glob 13, @grafana/plugin-e2e, Playwright 1.63, jest and Testing
  Library, typescript-eslint and eslint-plugin-jsdoc (#19, #20, #21,
  #23, #24, #34, #37, #41).

### CI
- Installs run on npm 11, so Dependabot-built lockfiles install (#27,
  #28).
- The monthly scaffold-update workflow runs on Node 24 and opens its PR
  (it needs the `GH_PAT_TOKEN` secret).
- GitHub Action bumps (#15, #16, #17, #18, #22, #30, #36, #38).
- First unit tests: `src/core.test.ts` pins the image-URL key rule, and
  `npm run test:ci` runs it.

### Demo and docs
- The fleet simulator and the local dev tokens use the built-in demo's
  names (`site-a`/`site-b`, `source-1` to `source-5`), so the curl
  examples in docs/API.md work against a fresh `wrangler dev`. The
  `site-a` upload used to get a 401.
- `docker compose -f demo/docker-compose.yml up` works from a bare clone:
  a build stage compiles the panel before Grafana starts. `DEMO_PORT`
  overrides the host port.
- New catalog screenshot from the current build.
- README badges and a Contributing section. Changelog entries are dated.
- `docs/API.md` covers write auth: adding a site to the reference worker.
- New runbook for upstream updates: `docs/UPSTREAM-UPDATES.md`.

## 0.9.19 (2026-08-21)

- Standalone app: Grafana-style time-range picker. The topbar clock now
  sits beside a range dropdown — absolute From/To inputs (accepting
  now-expressions, epoch ms, or local `YYYY-MM-DD HH:mm`, with native
  date pickers), quick ranges up to 30 days plus Today so far and
  Yesterday, recently-used ranges, and window-shift/zoom-out buttons.
  Quick picks write relative URLs (`?from=now-6h`) so a shared
  "last hour" link re-evaluates on open instead of freezing; the old
  inline quick-range buttons moved into the picker. App chrome only —
  the Grafana panel and shared core are unchanged.

## 0.9.18 (2026-07-12)

- Signed image URLs (reference worker): setting `IMG_SIGN_KEY` makes
  `/frames` mint a source-scoped expiring HMAC (`?e=&sig=`) on every
  image URL, and `/frame/*` accepts it as authorization — the long-lived
  viewer token no longer rides in image URLs (browser history, dashboard
  JSON, request logs). The client reuses the lo URL's query string when
  it builds the hi-variant preview URL, so one signature covers both
  variants. Viewer token keeps working as a fallback; `IMG_BASE` remains
  the explicit public-content opt-out. See docs/API.md "Read auth".

## 0.9.17 (2026-07-12)

- A dashboard WITHOUT a `site` variable rendered an axis and zero cards:
  the default `${site:csv}` expression stayed literal and filtered out
  every source. Unresolved variable expressions now mean "all sites" —
  the panel works out of the box on a fresh dashboard.
- e2e tests are real and green: page-level locators (plugin-e2e's panel
  locator test-id doesn't exist in every Grafana version's edit pane)
  asserting demo-data rendering in both modes.

## 0.9.16 (2026-07-12)

- Repository CI is green: the scaffold's lint config is now satisfied
  (mechanical brace style via eslint --fix, one comma-expression split)
  and build artifacts (web/vt-core.js, wrangler scratch) are excluded
  from linting. No behavior change.

## 0.9.15 (2026-07-11)

- injectStyles refreshes the shared style tag when a newer module version
  executes in a long-lived page — previously the first-injected CSS won
  forever, so a plugin update could render with the previous version's
  styles until a hard reload.

## 0.9.14 (2026-07-11)

- The future looks EMPTY, not black: the beyond-now region renders as
  the card's own surface, ruled only by hairlines continuing the axis
  ticks — black is its own signal in a screenshot timeline (a dark
  screen), so the unknown future no longer borrows it. Hovering there
  shows no magnifier at all: nothing to preview, only the crosshair and
  time pill. The one rendered thing in the future remains the pulsing
  live-edge slot. Ruling re-renders as the poll carves the spacer.

## 0.9.13 (2026-07-11)

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

## 0.9.12 (2026-07-11)

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

## 0.9.11 (2026-07-11)

- The live edge no longer flashes "offline — last seen" while the newest
  frame is in flight: a slot keeps its future grace until one full step
  past its tick (the same boundary the poll uses to age misses into real
  gaps), and the cursor says "expected — HH:MM" for a just-passed tick
  vs "upcoming — HH:MM" for one ahead of now.

## 0.9.10 (2026-07-11)

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

## 0.9.9 (2026-07-11)

- Hatch continuity done right: the fixed-attachment trick from 0.9.7
  doesn't paint inside Grafana's transformed panels (Chrome), reading as
  a solid block. Empty slots now get their hatch background-position
  aligned to their strip offset post-layout instead — continuous
  diagonals everywhere, including Grafana.
- Wide pause bands carry their label inline (SCREEN DARK (UNEXPECTED),
  SYSTEM DOWN (PLANNED), ...) in the reason's color — a strip that is
  all pause explains itself without a hover.
- The neutral paused hatch got a visible stripe contrast.

## 0.9.8 (2026-07-11)

- A hung backend (e.g. a dead dev worker still holding its port) left the
  panel blank forever: the registry fetch never resolved, so boot never
  finished and nothing said why. API requests now carry a 15s timeout,
  and a failed/timed-out registry fetch renders "frames API unreachable"
  in the panel instead of silence.

## 0.9.7 (2026-07-11)

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

## 0.9.4 – 0.9.6 (2026-07-11)

- **Pause reasons + intent**: `POST /declare` accepts `X-Reason`
  (`quiet | screen-sleep | app-stopped | system-down`) and `X-Intended`
  (0/1); both ride the history event. Re-declaring with a different
  reason while paused splits the band. Planned reasons render as
  distinct cool-hue hatches with their own labels (SCREEN ASLEEP /
  SYSTEM DOWN (PLANNED) / APP STOPPED / QUIET HOURS); `intended=false`
  gets the amber triage hatch and SCREEN DARK (UNEXPECTED). Undeclared
  silence stays offline-red: red means nobody said goodbye.

## 0.9.3 (2026-07-09)

- A resume frame landing exactly on a paused era's end boundary produced
  a zero-width active era and a degenerate `/frames?from==to` call that
  killed the whole panel. The resume probe now only accepts frames
  strictly inside the era, degenerate spans are skipped, and the
  reference worker answers zero-width windows with `[]` instead of 400.
- Boot resilience: one source's backend error no longer blacks out the
  panel — the source is skipped with a console warning and retried on
  the next refresh.

## 0.9.2 (2026-07-09)

- Multiview tiles run the inline-header gradient vertically (top fade)
  — the horizontal fade only makes sense on wide timeline strips.

## 0.9.1 (2026-07-09)

- Inline header redesigned per feedback: no scrim block. The hostname
  gets its own solid chip bubble, the meta chips keep theirs, all
  floating free over the image. A third `Header` choice — Inline ·
  gradient — backs them with a full-height left-to-right fade for busy
  frames. Web: `?header=inline` or `?header=inline-gradient`.

## 0.9.0 (2026-07-09)

- **Inline header mode**: a `Header` option (Bar / Inline overlay). Inline
  renders each source's header as a two-line scrim badge over the top-left
  of the strip or tile — hostname first, details second — instead of
  spending a row of card height. The badge clamps to two lines, lets all
  pointer events through, and sits under the magnifier and crosshair.
  Web app/embed: `?header=inline`.

## 0.8.4 (2026-07-09)

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

## 0.8.3 (2026-07-09)

- Cluster markers show a count badge (×N) instead of only growing
  slightly; the tooltip still lists every member chronologically.
- Demo data now exercises the full annotation matrix: global point,
  source-pinned point, global region, a color-coded source-scoped region
  explaining source-2's outage, and an alert burst tight enough to
  cluster.

## 0.8.2 (2026-07-09)

- Frame delineation now tints the frame instead of exposing the strip
  background. The old 1px `border-left` could never be covered by the
  frame image (overflow clips to the padding box), so every separator
  rendered as a hard near-black line over the `#111` background no matter
  the color set. It's now an `::after` overlay above the image: a whisper
  of shade (black 5%) plus a light inner edge (white 12%) — the seam
  shades light frames and highlights dark ones.

## 0.8.1 (2026-07-09)

- **Annotation lanes** option: `Shared` (one lane above the axis, the
  default) or `Per source` — every source gets its own lane under its
  strip carrying its events plus the globals, which reads better when
  many stacked timelines each have their own story. Web app/embed:
  `?annLanes=per-source`.
- Header chips (timeline cards and multiview tiles) never wrap or
  half-clip: a chip either fits whole on its single line or drops out of
  view; the head tooltip always carries the full set.

## 0.8.0 (2026-07-09)

- Annotations: the panel renders the dashboard's annotations (any
  annotation query, any data source). Points are diamond markers —
  `source:<id>`-tagged ones on that source's strip, the rest on a shared
  lane above the axis; regions shade their span; markers cluster when
  dense; hover for details. Toggle with the **Show annotations** option.
- `skipDataQuery` is now off so annotation data reaches the panel; the
  panel declares annotation support via `setDataSupport`.

## 0.7.0 (2026-07-09)

- Cadence events: sources can change pace (a new `X-Cadence` on upload) or
  declare a pause (`POST /declare`) — the timeline renders each era on its
  own grid, so slow eras aren't false gaps and declared pauses show as
  neutral silence instead of the red offline treatment. Undeclared silence
  still renders offline (the heartbeat contract survives crashes, including
  a crash while paused). Resume is inferred from frames; the worker also
  closes the paused era in the registry on the next upload.
- Slot widths are time-proportional across era boundaries — the x-axis
  stays linear through pace changes and pauses.

## 0.6.0 (2026-07-09)

- One shared UI core (`src/core.ts`) behind the Grafana panel, the
  standalone app, and the embed page (`web/vt-core.js` build).
- Frame-boundary hairlines when slices are wide enough to earn them.

## 0.5.0 (first public cut) (2026-07-09)

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
