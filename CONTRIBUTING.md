# Contributing to Visual Timeline

Bug reports and feature requests are welcome as
[GitHub issues](https://github.com/comebacktomorrow/visual-timeline/issues);
pull requests too. This page is the developer guide: repository layout, running
the pieces locally, testing, and releasing. For what the panel does and how to
use it, see the [README](README.md).

## What's in the repository

Three frontends, one small HTTP contract ([docs/API.md](docs/API.md)):

- `src/` — **Grafana app plugin** bundling two nested plugins:
  - the **panel** (timeline + multiview grid modes, two-way
    shared-crosshair sync with other panels, drag-zoom drives the dashboard
    time range). Ships with built-in demo data — drop it on a dashboard and
    it works with zero infrastructure.
  - the **Visual Timeline API data source**, frontend-only, which holds the
    API URL and the viewer token. Its `plugin.json` proxy route makes
    Grafana's server add the token, so a panel set to it never handles the
    key (see "Where the viewer token lives" in `docs/API.md`).
- `web/app.html` — **standalone app** with the chrome Grafana normally
  provides: site filter, timeline/grid/both modes, fit/fill, a Grafana-style
  time-range picker, drag-zoom, and within-page cursor sync (hover the timeline, the grid
  follows). Ranges that end at now ("Last 1 hour") follow the clock, with a
  LIVE/PAUSED toggle. State lives in the URL — views are shareable links.
- `web/index.html` — **minimal embeddable viewer** (iframe-friendly;
  accepts Grafana dashboard-link params).

Backend reference implementation: `worker/` — a single-file Cloudflare
Worker over R2. Deterministic cadence-aligned keys, immutable frame
caching, per-step downsampling, per-site bearer auth for writes, and
default-private reads (viewer token + signed expiring image URLs — see
"Read auth" in `docs/API.md`). Designed to run a real fleet on the
R2/Workers free tier — but the panel binds to the API contract, not to
this backend; implement `docs/API.md` with anything.

## Standalone app and embed: URL parameters

`web/app.html` keeps its whole state in the URL, so a view is a shareable
link. `web/index.html` (the embed) takes the same parameters where they apply;
it always shows the timeline.

| Parameter                                        | App | Embed | Meaning                                                                                                              |
| ------------------------------------------------ | --- | ----- | -------------------------------------------------------------------------------------------------------------------- |
| `site` (or Grafana-style `var-site`, repeatable) | ✓   | ✓     | sites to show; comma-separated or repeated                                                                           |
| `source` (alias `kiosk`, or `var-kiosk`)         |     | ✓     | sources to show                                                                                                      |
| `from`, `to`                                     | ✓   | ✓     | the window: epoch ms or Grafana-style relative times (`now-6h`, `now`). Default: the last hour                       |
| `mode`                                           | ✓   |       | `timeline`, `grid` or `both` (default)                                                                               |
| `fit`                                            | ✓   | ✓     | `fit` (default, letterbox) or `fill` (crop)                                                                          |
| `header`                                         | ✓   | ✓     | `bar` (default), `inline` or `inline-gradient`                                                                       |
| `tags`                                           | ✓   | ✓     | tag filter, e.g. `env=prod,room=lobby`                                                                               |
| `hideEmpty`                                      | ✓   | ✓     | `1` hides sources with no frames in the window                                                                       |
| `annLanes`                                       | ✓   | ✓     | `shared` (default) or `per-source`                                                                                   |
| `tz`                                             | ✓   | ✓     | show every time in this zone: an IANA name or `utc`. Default: the browser's zone                                     |
| `thumbs`                                         | ✓   | ✓     | `source` shows a source's own times in its declared zone (see `X-Timezone` in `docs/API.md`)                         |
| `k`                                              | ✓   | ✓     | viewer key, for an API with read auth. It ends up in browser history, so prefer signed image URLs and a scoped token |
| `backend`                                        | ✓   | ✓     | `mock` uses the built-in demo data instead of an API                                                                 |

## Repository layout

| Path                                                    | What                                                                                                                                                                                                                                   |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/`                                                  | Grafana app plugin source (create-plugin scaffold; `npm run build` → `dist/`): `plugin.json` + `module.tsx` are the app                                                                                                                |
| `src/panel/`                                            | the nested panel (`savvycocoa1919-visualtimeline-panel`, an id dashboards depend on: never change it)                                                                                                                                  |
| `src/datasource/`                                       | the nested data source (`savvycocoa1919-visualtimeline-datasource`): config page, health check, proxy route                                                                                                                            |
| `src/core.ts`, `src/vt/`, `src/theme.ts`, `src/shared/` | shared code: the framework-free timeline core (`src/vt/`, typed modules with no React or Grafana imports; `src/core.ts` is its entry point and only re-exports, also built into `web/vt-core.js`), the theme mapping, the proxy client |
| `webpack.config.ts`                                     | extends the scaffold's webpack config (copies the nested plugins' logos)                                                                                                                                                               |
| `tests/`                                                | Playwright e2e specs; `tests/mock-api/` is the stand-in frames API they run against                                                                                                                                                    |
| `web/`                                                  | standalone app, embeddable viewer, fleet simulator                                                                                                                                                                                     |
| `worker/`                                               | Cloudflare Worker + R2 reference backend                                                                                                                                                                                               |
| `demo/`                                                 | zero-setup Grafana demo (`docker compose -f demo/docker-compose.yml up`)                                                                                                                                                               |
| `grafana/`                                              | provisioning for the Grafana demo                                                                                                                                                                                                      |
| `docs/API.md`                                           | the frames API contract + curl examples                                                                                                                                                                                                |
| `docs/UPSTREAM-UPDATES.md`                              | runbook for Dependabot, scaffold and security updates                                                                                                                                                                                  |
| `docs/TIME_AXIS_PROPOSAL.md`                            | design record for the Grafana-matching time axis                                                                                                                                                                                       |

## Core idea: cadence as a heartbeat

Every source declares how often it promises a frame. Timestamps snap to
that grid, storage keys become deterministic, and a _missing_ frame means
_offline_ — rendered as a hatched gap at its true width in the timeline,
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

Upload real frames with curl: see [docs/API.md](docs/API.md).

## Grafana demo

```bash
docker compose -f demo/docker-compose.yml up
# → http://localhost:3300/d/visual-timeline-demo  (anonymous admin)
```

Works from a bare clone — a build stage compiles the plugin before Grafana
starts, so the first run takes a few minutes. Port 3300 taken? Prefix with
`DEMO_PORT=3301`.

Grafana 11 with the app mounted and a provisioned dashboard: timeline,
two multiview grids (follow-crosshair vs latest-only), and a random-walk
panel to see the two-way crosshair sync. Panels run on built-in demo data.
For live frames, set each panel's **API URL** option to a backend. A backend
that needs a viewer token goes in a Visual Timeline API data source instead.
Its API URL must be reachable from the Grafana container and, for the
images, from your browser.

## Development

- `npm run build` builds the app and its nested panel and data source into
  `dist/` (`dist/plugin.json` + `module.js`, `dist/panel/`,
  `dist/datasource/`). It uses webpack with the configuration in `.config/`,
  which is managed by Grafana plugin tools, so don't edit it. The root
  `webpack.config.ts` extends it.
- `npm run server` starts the scaffold's dev Grafana on `:3000` (that's
  separate from the `:3300` demo above); `npm run dev` rebuilds on change.
  It also starts `vt-mock-api`, a stand-in frames API (`tests/mock-api/`).
  Two Visual Timeline API data sources point at it, one with the right token
  and one with a wrong token, and the "Visual Timeline — data source mode"
  dashboard uses them.
- `npm run e2e` runs the Playwright suite against the dev Grafana.
- `npm run test:ci` runs the unit tests, `npm run typecheck` and
  `npm run lint` check types and style.
- The fleet simulator (`worker/` + `sim.html`) gives you realistic data with
  no hardware.
- `cd worker && npm test` runs the reference worker's contract tests (no
  Cloudflare account needed).
- The standalone app and embeddable viewer (`web/`) load `web/vt-core.js`,
  which is built from `src/core.ts` with `npm run build:web`. Commit the
  rebuilt file when you change `src/core.ts` or anything under `src/vt/` (the `project-checks` workflow fails on drift).
- `src/core.snapshot.test.ts` snapshots the core's exports, the `VTCore`
  global and the rendered demo DOM. A change there is either a mistake or a
  deliberate change to output; for the latter, update with
  `npx jest -u src/core.snapshot.test.ts` (after `npm run build:web`) and
  review the snapshot diff in the same PR.
- `npm run bench:scrub` measures what a cursor move costs with 20 sources;
  see [perf/README.md](perf/README.md) for options and the baseline.
- Changes to any `plugin.json` (`src/`, `src/panel/`, `src/datasource/`,
  including the data source's proxy `routes`) need a restart of the Grafana
  server.

## Upstream updates

Taking in Dependabot, scaffold and security updates has its own runbook:
[docs/UPSTREAM-UPDATES.md](docs/UPSTREAM-UPDATES.md).

## Releasing

Releases are cut from tags.

1. Turn `## Unreleased` in [CHANGELOG.md](CHANGELOG.md) into a dated entry for
   the new version (`## 1.0.0 (2026-10-09)`). The release workflow takes the
   release notes from the **first** `## ` section, so it must be the version.
2. Bump `version` in `package.json`; `plugin.json`'s `%VERSION%` is filled in
   from it at build time.
3. Push a tag named `v<version>` (for example `v1.0.0`). The workflow fails if
   the tag doesn't match `package.json`.

The `Release` workflow (`.github/workflows/release.yml`) builds and packages
the app with `grafana/plugin-actions/build-plugin` and creates a **draft**
GitHub release with `savvycocoa1919-visualtimeline-app-<version>.zip` and its
`.zip.sha1`. Publish the draft to make those links public; they are what the
grafana.com submission form asks for. Signing isn't enabled yet: see
[docs/SUBMISSION.md](docs/SUBMISSION.md).
