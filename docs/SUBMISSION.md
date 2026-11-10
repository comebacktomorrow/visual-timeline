# Submitting to the Grafana plugin catalog

The steps to get Visual Timeline 2.0 into the catalog, written for whoever
(person or agent session) picks this up. Tick items off in the PR that
completes them, and delete this file once the plugin is published and signed.
Submitting is the maintainer's call: an agent prepares, the maintainer
submits.

**State as of 2026-11-11:** 2.0's code and docs are merged (#130 to #151).
Grafana's review declined 1.2.3 because using it meant running this
project's backend or building one to its API; 2.0 removes that: the panel
reads frames from any data source, and the Visual Timeline data source reads
web folders and public buckets, with no API of its own. Private buckets are
planned for 2.1 (a small Go backend in the data source), so 2.0 is still
frontend-only.

## Facts to keep straight

- **Plugin ids are permanent** once published. The app id is the catalog
  entry. The panel id is what every dashboard stores: never change it.
- **The grafana.com org is `savvycocoa1919`** (the id prefix). Publishing and
  signing must happen from that org; you need to be an admin of it.
- **Every `plugin.json` change needs a Grafana server restart** wherever it's
  deployed. 2.0 changes the data source's `plugin.json` (the `folder` route
  replaces the API route).
- **grafana.com is blocked in Claude Code cloud containers.** The validator's
  network checks (org lookup, link checks, the Angular-pattern list) fail
  there. Use the release workflow's validator run (below) or a local machine.
- **Accepted:** moderate advisories in the react-router chain under
  `@grafana/ui` (fixing them needs an `@grafana` major), and two dev-tooling
  Dependabot alerts dismissed as "tolerable risk, dev tooling only". CI's
  advisory gate is high/critical only, matching the catalog validator.
- **The latest validator ignores `osv-scanner.toml`,** so nothing can be
  accepted for the catalog. New advisories land in osv before `npm audit`,
  so re-run the latest validator right before submitting (see
  `docs/UPSTREAM-UPDATES.md`, "Security gate").
- **The Grafana API compatibility check is report-only** (since 2.0's M4):
  `useFieldConfig` changed its type in Grafana 13.3.0, which the check flags
  against the 12.0 minimum. The plugin still runs on 12.0 and later: e2e
  runs on 12.0, 12.2, 12.4, 13.1, 13.3 and nightly.

## 1. Before the release

- [ ] Merge any open PRs that should be in 2.0 (check
      [open PRs](https://github.com/comebacktomorrow/visual-timeline/pulls)).
      Dependabot #117 waits for sign-plugin 4's Node 24.5 requirement.
- [ ] **Screenshots.** The catalog shows `info.screenshots` from
      `src/plugin.json`: a dark and a light dashboard shot from 1.x's demo.
      Optionally replace or add shots of 2.0: the demo stack's Rivers and
      The Sun dashboards (`docker compose -f demo/docker-compose.yml up`,
      then `/d/vt-rivers` and `/d/vt-sun`) show it on real data, credits
      included. Save as PNGs in `src/img/`, compress
      (`pngquant --quality=80-95`, under webpack's 244 KB warning), and list
      them in `info.screenshots`. Reviewers check both themes.
- [ ] Run `docker compose up` from a clean clone and open each provisioned
      dashboard (the list is in the testing guidance below).

## 2. Cut the release

The release PR (version 2.0.0 in `package.json` and `package-lock.json`, and
the `## 2.0.0` CHANGELOG section with its Highlights) is merged before
tagging. For a later version, substitute its number.

- [ ] Tag the merge commit on `main`:
      `git tag v2.0.0 && git push origin v2.0.0`. The tag must match
      `package.json` or the workflow fails.
- [ ] Watch the **Release** workflow (`.github/workflows/release.yml`). It
      builds, runs `@grafana/plugin-validator` (pinned by the action) on
      `savvycocoa1919-visualtimeline-app-2.0.0.zip`, attests the zip's build
      provenance, and creates a **draft** GitHub release with the zip and
      `.zip.sha1`.
  - [ ] Read the validator step's output. Expect no errors; the only
        expected warning is "unsigned plugin".
  - [ ] Run the latest validator too, from a machine that can reach
        grafana.com:
        `npx -y @grafana/plugin-validator@latest -sourceCodeUri https://github.com/comebacktomorrow/visual-timeline/tree/v2.0.0 savvycocoa1919-visualtimeline-app-2.0.0.zip`
        Expect no errors and the warnings "unsigned plugin" and
        "osv-scanner.toml is ignored". (With `--cache .cache/npm` the React
        19 check fails to start; use npm's default cache.)
- [ ] Check the attestation:
      `gh release download v2.0.0 --pattern '*.zip' && gh attestation verify savvycocoa1919-visualtimeline-app-2.0.0.zip --repo comebacktomorrow/visual-timeline`.
- [ ] **Replace the draft's release notes**, then **publish** it. The build
      action writes its own boilerplate, not the changelog: paste the
      version's CHANGELOG section instead, e.g.
      `git show v2.0.0:CHANGELOG.md | awk '/^## / {s++} s == 1' | sed 1d`.
      The zip and sha1 links only work once it's published.

## 3. Submit on grafana.com

Sign in as an admin of the `savvycocoa1919` org, open **My Plugins**, then
**Submit New Plugin** (or the declined submission's update, if the form
offers one):

- **OS & Architecture:** Single. The plugin is frontend-only, with no
  backend binaries.
- **URL:** the published release's `.zip` asset link.
- **Source code URL:** `https://github.com/comebacktomorrow/visual-timeline/tree/v2.0.0`
- **SHA1:** the contents of the `.zip.sha1` asset.
- **Provisioning provided for test environment:** yes (see below).
- **Signature level questions:** a community plugin (free, open source,
  Apache-2.0).
- **Testing guidance** (a draft for the maintainer to review; it follows the
  form's "steps to install, configure, and use", and leads with the
  provisioned environment, as
  [Help us test your plugin](https://grafana.com/developers/plugin-tools/publish-a-plugin/provide-test-environment)
  asks):

  ```text
  Visual Timeline is an app plugin with two nested plugins: a panel (savvycocoa1919-visualtimeline-panel) and a data source (savvycocoa1919-visualtimeline-datasource). Frontend only, no backend binary. Requires Grafana 12.0 or later.

  Since the 1.x review: the panel now reads frames (rows of time, image URL and host) from any data source, and the data source reads timestamped images from a web folder or a public S3 bucket. Neither needs a backend or API of this project's.

  1. QUICK START: PROVISIONED TEST ENVIRONMENT
     git clone https://github.com/comebacktomorrow/visual-timeline
     cd visual-timeline && git checkout v2.0.0
     docker compose up
     The first run compiles the plugin inside a Node container (a few minutes); no other commands or configuration are needed. Grafana then runs at http://localhost:3000 with anonymous admin access, alongside an nginx folder of test images, PostgreSQL and Loki, each holding the same test frames.

     Provisioned data sources:
     - Visual Timeline (demo): Demo data.
     - Visual Timeline (folder, HTML) and (folder, JSON): the HTTP folder connection on the nginx folder, one per listing format.
     - PostgreSQL (frames), Loki (frames), TestData DB: stock data sources holding frames.

     Provisioned dashboards:
     - Provisioned Visual Timeline dashboard: a timeline and a multiview grid on demo data.
     - Visual Timeline — any data source: timelines and grids from TestData CSV rows, including host states that pause frames, an irregular feed, header chips and a wide table.
     - Visual Timeline — HTTP folder: the same frames through each listing format.
     - Visual Timeline — existing data sources (PostgreSQL) and Visual Timeline — Loki: frames from stock data sources.
     - Visual Timeline — filters: Site and Host variables and an ad hoc filter bar.
     - Visual Timeline — last frame table: a stock Table and a stock Canvas fed by the data source's Last frame option.
     - Visual Timeline — empty states: a panel with no data source, and one whose data source was deleted.

  2. INSTALL ON ANOTHER GRAFANA
     Install the release zip. While the plugin is unsigned, allow all three ids in allow_loading_unsigned_plugins: savvycocoa1919-visualtimeline-app, savvycocoa1919-visualtimeline-panel, savvycocoa1919-visualtimeline-datasource. The app enables itself and has no pages of its own.

  3. CONFIGURE
     - Connections > Data sources > Add new data source > Visual Timeline.
     - Demo data: choose Demo data as the Connection and click Save & test. Expected: "Demo data is on: queries return built-in demo hosts and frames." On the data source's Dashboards tab, import the "Visual Timeline" starter dashboard.
     - HTTP folder: choose HTTP folder, set the folder URL, listing format and path template (docs/FOLDERS.md), and click Save & test, which reports the frames and hosts found in the last 24 hours. A public example: folder URL https://sdo.gsfc.nasa.gov/assets/img/browse, listing HTML links, template {YYYY}/{MM}/{DD}/{YYYY}{MM}{DD}_{HH}{mm}{ss}_{variant}_{host}.jpg, small images 512, large 2048 (NASA's Sun images).
     - Any other data source: add a Visual Timeline panel and query a data source whose rows have a time, an image URL and a host (docs/DATA-SOURCES.md).

  4. USE
     - Timeline: hover a strip to scrub its frames (the crosshair is shared across panels), drag across a strip to zoom the dashboard's time range, click a frame for a larger preview. Gaps show missing frames at their true width; host states draw as bands or annotations, labelled and coloured by their value mappings.
     - Multiview grids: "follows crosshair" shows each host's frame at the hovered time; "latest only" shows the newest frames.
     - Filtering: the Site and Host dropdowns, the Filters bar, or a click on a host, site or tag chip in a panel header (also reachable with Tab and Enter).
     - Panel options: Display mode, Frame fields (which fields are the time, image, host and so on), Hold last frame, Gaps mean, Header chips and Chip click, Thumbnail times, Image fit.

  docs/DATA-SOURCES.md, docs/FOLDERS.md and docs/INFINITY.md in the repository have the recipes. The repository's demo/ stack also has two dashboards on live public data (USGS river cameras, NASA's Sun); they need internet access and aren't part of the provisioned test environment.
  ```

## 4. After approval

Grafana reviews the plugin and assigns a signature level. Signing doesn't
work before that: `npm run sign` fails with "Field is required: rootUrls".

- [ ] Create an Access Policy token with `plugins:write` under the
      `savvycocoa1919` org (grafana.com → Administration → Access
      Policies).
- [ ] Add it as the repository secret `GRAFANA_ACCESS_POLICY_TOKEN`. `ci.yml`
      then signs on every run. Not before approval: until the plugin has a
      signature level, `npm run sign` fails and the secret would turn CI's
      main job red.
- [ ] In `.github/workflows/release.yml`, add
      `policy_token: ${{ secrets.GRAFANA_ACCESS_POLICY_TOKEN }}` under the
      build step's `with:`, next to `attestation: true` (the comment there
      marks the spot).
- [ ] Cut the next version the same way, so the published zip is
      signed, and submit it as an update under **My Plugins**.
- [ ] Delete this file.

## Later, not blocking

- **2.1: private buckets** (#125): a small Go backend in the data source that
  lists with signed requests and returns signed image links, stamped to the
  hour so they stay cacheable. It makes the plugin a backend plugin: Go and
  mage builds, per-platform binaries, and **OS & Architecture** changes when
  it's submitted.
- Loading folder images through Grafana's proxy (#128, deferred).
- The scaffold-managed `.config/docker-compose-base.yaml` still names the dev
  container and mount after the panel id. It switches to the app id on the
  next create-plugin update (`docs/UPSTREAM-UPDATES.md`).
- Open issues: #44 (worker key-list caching), #112 (1.1/1.2 follow-ups).
