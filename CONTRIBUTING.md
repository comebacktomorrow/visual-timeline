# Contributing to Visual Timeline

Bug reports and feature requests are welcome as
[GitHub issues](https://github.com/comebacktomorrow/visual-timeline/issues);
pull requests too. This page is the developer guide: repository layout, running
the pieces locally, testing, and releasing. For what the panel does and how to
use it, see the [README](README.md).

## What's in the repository

Three frontends, one small HTTP contract ([docs/API.md](docs/API.md)):

- `src/` — the **Grafana app plugin**, which bundles two nested plugins:
  - the **panel**, which draws the timeline and multiview grid;
  - the **Visual Timeline API data source**, frontend-only, which holds the
    API URL and the viewer token. Its `plugin.json` proxy route makes
    Grafana's server add the token, so a panel set to it never handles the
    key (see "Where the viewer token lives" in `docs/API.md`).
- `web/app.html` and `web/index.html` — the **standalone app** and
  **embeddable viewer**, the same timeline outside Grafana
  ([docs/VIEWER.md](docs/VIEWER.md)).
- `web/sim.html` — a **fleet simulator** that uploads canvas-rendered frames,
  for realistic data with no hardware.

The panel, the app and the embed all render with the same framework-free core
(`src/vt/`).

`worker/` is the reference backend: a single-file Cloudflare Worker over R2
([worker/README.md](worker/README.md) covers running and deploying it). The
panel binds to the API contract, not to this backend; implement
`docs/API.md` with anything.

For what the panel does and how users set it up, the [README](README.md) is
the source of truth: it is also the plugin's page in the Grafana catalog.

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
| `worker/`                                               | Cloudflare Worker + R2 reference backend ([worker/README.md](worker/README.md))                                                                                                                                                        |
| `demo/`                                                 | zero-setup Grafana demo (`docker compose -f demo/docker-compose.yml up`)                                                                                                                                                               |
| `grafana/`                                              | provisioning for the Grafana demo                                                                                                                                                                                                      |
| `docs/API.md`                                           | the frames API contract + curl examples                                                                                                                                                                                                |
| `docs/VIEWER.md`                                        | the standalone app and embed, and their URL parameters                                                                                                                                                                                 |
| `docs/SUBMISSION.md`                                    | the Grafana catalog submission checklist                                                                                                                                                                                               |
| `docs/UPSTREAM-UPDATES.md`                              | runbook for Dependabot, scaffold and security updates                                                                                                                                                                                  |
| `docs/TIME_AXIS_PROPOSAL.md`                            | design record for the Grafana-matching time axis                                                                                                                                                                                       |

## Development

- `npm run build` builds the app and its nested panel and data source into
  `dist/` (`dist/plugin.json` + `module.js`, `dist/panel/`,
  `dist/datasource/`). It uses webpack with the configuration in `.config/`,
  which is managed by Grafana plugin tools, so don't edit it. The root
  `webpack.config.ts` extends it.
- `npm run server` starts the scaffold's dev Grafana on `:3000` (that's
  separate from the README's Docker demo on `:3300`); `npm run dev` rebuilds on change.
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
