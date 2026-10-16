# Submitting to the Grafana plugin catalog

The remaining steps to get Visual Timeline 1.0 into the catalog, written for
whoever (person or agent session) picks this up. Tick items off in the PR that
completes them, and delete this file once the plugin is published and signed.

**State as of 2026-10-02:** all code work for submission is merged (#58–#64,
#65, #66, #68). The plugin is an app, `savvycocoa1919-visualtimeline-app`,
with the panel (`savvycocoa1919-visualtimeline-panel`, unchanged) and the
Visual Timeline API data source nested inside. CI is green on `main`.

**Checked on a local machine, 2026-10-06** (the parts a cloud container
can't run):

- **Plugin validator (latest), with network:** clean apart from the expected
  "unsigned plugin" warning, once the two osv-scanner highs were handled
  (#80).
- **`docker compose up` (the reviewers' provisioned environment)** on
  Grafana 13.0.2: the app and both nested plugins load; the data source
  dashboard reads through the proxy; Save & test reports "Connected: the API
  lists 1 source"; the token shows only as "configured" and is absent from
  the dashboard JSON; the panel follows the light theme.
- **`docker compose -f demo/docker-compose.yml up`:** builds from a clean
  tree and renders the demo dashboard.
- **Found:** the wrong-token panel's message is unhelpful (#81). Worth
  fixing before submission, since the testing guidance points reviewers at
  that panel.

## Facts to keep straight

- **Plugin ids are permanent** once published. The app id is the catalog
  entry. The panel id is what every dashboard stores: never change it.
- **The grafana.com org is `savvycocoa1919`** (the id prefix). Publishing and
  signing must happen from that org; you need to be an admin of it.
- **Every `plugin.json` change needs a Grafana server restart** wherever it's
  deployed.
- **grafana.com is blocked in Claude Code cloud containers.** The validator's
  network checks (org lookup, link checks, the Angular-pattern list) fail
  there. Use the release workflow's validator run (below) or a local machine.
- **Accepted:** 4 moderate advisories in the react-router chain under
  `@grafana/ui` (fixing them needs an `@grafana` major). CI's advisory gate is
  high/critical only, matching the catalog validator.
- **No high or critical advisories** in the lockfile since 1.2.1
  (create-plugin 7.13.0 dropped `braces`). The latest validator ignores
  `osv-scanner.toml`, so nothing can be accepted for the catalog. New
  advisories land in osv before `npm audit`, so re-run the latest validator
  right before submitting (see `docs/UPSTREAM-UPDATES.md`, "Security
  gate").

## 1. Before the release

- [x] Merge any open PRs that should be in 1.0 (check
      [open PRs](https://github.com/comebacktomorrow/visual-timeline/pulls)).
      #77 (small quirks) is optional for 1.0.
- [x] **Screenshots, taken in a real Grafana** (`npm run server`, which
      needs Docker, then http://localhost:3000). The catalog shows
      `info.screenshots` from `src/plugin.json`; there is a dark and a light
      dashboard shot (the light one taken 2026-10-06 from `a934719`).
  - [x] Add a light-theme dashboard shot. Reviewers check both themes.
  - [ ] Optionally add the data source config page and the grid with source
        time zones.
  - [x] Save them as PNGs in `src/img/` and list them in
        `src/plugin.json` `info.screenshots`.
  - [x] Compress them (`pngquant --quality=80-95`): light 219 KB, dark
        225 KB, both under webpack's 244 KB warning.
- [x] Optional: a sponsor link (`info.links` entry named `sponsor`). The
      validator suggests one; it isn't required. Decided against
      (2026-10-06).
- [x] Branch protection: if it requires a check called `compatibilitycheck`,
      switch it to the three per-plugin checks
      (`compatibilitycheck (./src/module.tsx)`,
      `(./src/panel/module.ts)`, `(./src/datasource/module.ts)`).
      Checked 2026-10-06: `main` has no branch protection, only a no-delete
      ruleset with no required checks, so there is nothing to change.

## 2. Cut the release

> 1.0.0 was tagged and built (2026-10-06) but never published or submitted,
> and 1.0.1 was never released. 1.1.0 (the data source owns the data; filter
> by site, host and tag; Grafana 12+) was tagged and its release drafted on
> 2026-10-15 but not published. 1.1.0 and 1.2.0 (1.1.0 plus each host's last
> frame for Table, Canvas and Stat panels) were both published on GitHub on
> 2026-10-15, but the latest validator fails 1.2.0 on the `braces` advisory.
> 1.2.1 (1.2.0 on create-plugin 7.13.0, which drops it) passes it, but its
> `docker compose up` needed a built `dist/`, so reviewers couldn't run the
> provisioned environment from a clone. 1.2.2 fixes that and is the release
> to submit. The steps below use it; for a later version substitute its
> number.

- [ ] In `CHANGELOG.md`, rename `## Unreleased` to `## 1.2.2 (<date>)`. The
      release workflow uses the **first** `## ` section as the release notes,
      and the catalog shows the changelog. Keep its short "Highlights" list at
      the top.
- [ ] `npm version 1.2.2 --no-git-tag-version` (updates `package.json` and
      `package-lock.json`; `plugin.json`'s `%VERSION%` is filled in at build).
- [ ] Open a PR with both, wait for green CI, merge.
- [ ] Tag the merge commit on `main`:
      `git tag v1.2.2 && git push origin v1.2.2`. The tag must match `package.json` or the workflow fails.
- [ ] Watch the **Release** workflow (`.github/workflows/release.yml`). It
      builds, runs `@grafana/plugin-validator` (0.49.5, pinned by the action)
      on `savvycocoa1919-visualtimeline-app-1.2.2.zip`, and creates a
      **draft** GitHub release with the zip and `.zip.sha1`.
  - [ ] Read the validator step's output. Expect no errors. The only
        expected warning is "unsigned plugin". This validator (0.49.13,
        pinned by the action) still honours `osv-scanner.toml`; the latest
        doesn't, so also run the latest (next step) before submitting.
  - [ ] Run the latest validator too, from a machine that can reach
        grafana.com:
        `npx -y @grafana/plugin-validator@latest -sourceCodeUri https://github.com/comebacktomorrow/visual-timeline/tree/v1.2.2 savvycocoa1919-visualtimeline-app-1.2.2.zip`
        Expect no errors and the warnings "unsigned plugin" and
        "osv-scanner.toml is ignored". 0.49.16, run on the create-plugin
        7.13.0 branch on 2026-10-16, gave exactly that. (With
        `--cache .cache/npm` the React 19 check fails to start; use npm's
        default cache.)
- [ ] **Replace the draft's release notes**, then **publish** it. The build
      action writes its own boilerplate (submission instructions, a stray
      `false`, GitHub's list of every PR), not the changelog: paste the
      version's CHANGELOG section instead, e.g.
      `git show v1.2.2:CHANGELOG.md | awk '/^## / {s++} s == 1' | sed 1d`.
      The zip and sha1 links only work once it's published.

## 3. Submit on grafana.com

Sign in as an admin of the `savvycocoa1919` org, open **My Plugins**, then
**Submit New Plugin**:

- **OS & Architecture:** Single. The plugin is frontend-only, with no
  backend binaries.
- **URL:** the published release's `.zip` asset link.
- **Source code URL:** `https://github.com/comebacktomorrow/visual-timeline/tree/v1.2.2`
- **SHA1:** the contents of the `.zip.sha1` asset.
- **Provisioning provided for test environment:** yes (see below).
- **Signature level questions:** a community plugin (free, open source,
  Apache-2.0).
- **Testing guidance:** paste as is (it follows the form's "steps to
  install, configure, and use", and leads with the provisioned environment,
  as [Help us test your plugin](https://grafana.com/developers/plugin-tools/publish-a-plugin/provide-test-environment)
  asks):

  ```text
  Visual Timeline is an app plugin with two nested plugins: a panel (savvycocoa1919-visualtimeline-panel) and a data source (savvycocoa1919-visualtimeline-datasource). Frontend only, no backend binary. Requires Grafana 12.0 or later.

  1. QUICK START: PROVISIONED TEST ENVIRONMENT
     git clone https://github.com/comebacktomorrow/visual-timeline
     cd visual-timeline && git checkout v1.2.2
     docker compose up
     The first run compiles the plugin inside a Node container (a few minutes); no other commands or configuration are needed. Grafana then runs at http://localhost:3000 with anonymous admin access, alongside a mock frames API.

     Provisioned data sources:
     - Visual Timeline (demo): Demo data on, no API.
     - Visual Timeline API (mock): API URL http://vt-mock-api; viewer token stored in secureJsonData and added server-side by the plugin.json proxy route.
     - Visual Timeline API (mock, wrong token): the same API with a token it rejects.

     Provisioned dashboards:
     - Provisioned Visual Timeline dashboard: a timeline and a multiview grid on demo data.
     - Visual Timeline — filters: Site and Host variables and an ad hoc filter bar.
     - Visual Timeline — data source mode: one panel reads through the mock API data source; the other uses the wrong-token one and shows the error in Grafana's panel error indicator.
     - Visual Timeline — last frame table: a stock Table and a stock Canvas fed by the data source's Last frame query option.
     - Visual Timeline — empty states: a panel with no Visual Timeline data source, and one whose data source was deleted.

  2. INSTALL ON ANOTHER GRAFANA
     Install the release zip. While the plugin is unsigned, allow all three ids in allow_loading_unsigned_plugins: savvycocoa1919-visualtimeline-app, savvycocoa1919-visualtimeline-panel, savvycocoa1919-visualtimeline-datasource. The app enables itself and has no pages of its own.

  3. CONFIGURE
     - Connections > Data sources > Add new data source > Visual Timeline API.
     - To test without a backend, turn on Demo data and click Save & test. Expected: "Demo data is on: queries return built-in demo sources. No API is called."
     - For a real API, turn Demo data off and enter the API URL (and a viewer token if the API requires one). Save & test checks both. Inside the provisioned environment the mock is at http://vt-mock-api.
     - On the data source's Dashboards tab, import the "Visual Timeline" starter dashboard.

  4. USE (on the starter dashboard, Demo data)
     - Timeline: hover a strip to scrub its frames (the crosshair is shared across panels), drag across a strip to zoom the dashboard's time range, click a frame for a larger preview. Demo data includes an outage on source-2 (red hatched gap), a declared pause on source-4 (SCREEN DARK (UNEXPECTED)), hosts in other time zones (chips on source-3 and source-5) and annotations.
     - Multiview grids: "follows crosshair" shows each host's frame at the hovered time; "latest only" shows the newest frames.
     - Last frame per host: a stock Table with each host's last frame, status (live/offline/paused, coloured) and time. Pick a past time range and it shows the frames at the end of that range.
     - Filtering: the Site and Host dropdowns, the Filters bar (keys site, host and tag keys such as env), or a click on a host, site or tag chip in a panel header (also reachable with Tab and Enter).
     - Query tab (edit a panel): Sites, Hosts and Tags fields (dashboard variables such as ${site:csv} work); the Last frame switch and its Per host format, for Table, Canvas and Stat panels.
     - Panel options: Display mode (Timeline or Multiview grid), Header, Thumbnail times (dashboard or host local time), Image fit, Hide hosts with no data, Show annotations.

  The frames API is documented in docs/API.md. worker/ in the repository is a reference implementation.
  ```

## 4. After approval

Grafana reviews the plugin and assigns a signature level. Signing doesn't
work before that: `npm run sign` fails with "Field is required: rootUrls".

- [ ] Create an Access Policy token with `plugins:write` under the
      `savvycocoa1919` org (grafana.com → Administration → Access
      Policies).
- [ ] Add it as the repository secret `GRAFANA_ACCESS_POLICY_TOKEN`. `ci.yml`
      then signs on every run.
- [ ] In `.github/workflows/release.yml`, enable signing by uncommenting the
      `with:` block and setting
      `policy_token: ${{ secrets.GRAFANA_ACCESS_POLICY_TOKEN }}`.
- [ ] Cut the next version the same way, so the published zip is
      signed, and submit it as an update under **My Plugins**.
- [ ] Delete this file.

## Later, not blocking

- The scaffold-managed `.config/docker-compose-base.yaml` still names the dev
  container and mount after the panel id. It switches to the app id on the
  next create-plugin update (`docs/UPSTREAM-UPDATES.md`).
- Open issues: #81 (wrong-token message; see above) and #44 (worker
  key-list caching). #77 and #26 are closed.
