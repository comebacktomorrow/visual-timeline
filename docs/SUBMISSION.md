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
- **Accepted until 2027-01-06:** the `braces` high (no fixed release,
  build-time only), in `osv-scanner.toml`, which both the validator and CI's
  advisory gate read. New advisories land in osv before `npm audit`, so
  re-run the validator right before submitting (see
  `docs/UPSTREAM-UPDATES.md`, "Security gate").

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

## 2. Cut 1.0.0

- [ ] In `CHANGELOG.md`, rename `## Unreleased` to `## 1.0.0 (<date>)`. The
      release workflow uses the **first** `## ` section as the release notes,
      and the catalog shows the changelog. Consider adding a short
      "Highlights" paragraph at the top of the 1.0.0 section: app plugin and
      data source, themes, time zones, escaping fix.
- [ ] `npm version 1.0.0 --no-git-tag-version` (updates `package.json` and
      `package-lock.json`; `plugin.json`'s `%VERSION%` is filled in at build).
- [ ] Open a PR with both, wait for green CI, merge.
- [ ] Tag the merge commit on `main`:
      `git tag v1.0.0 && git push origin v1.0.0`. The tag must match `package.json` or the workflow fails.
- [ ] Watch the **Release** workflow (`.github/workflows/release.yml`). It
      builds, runs `@grafana/plugin-validator` (0.49.5, pinned by the action)
      on `savvycocoa1919-visualtimeline-app-1.0.0.zip`, and creates a
      **draft** GitHub release with the zip and `.zip.sha1`.
  - [ ] Read the validator step's output. Expect no errors. The only
        expected warning is "unsigned plugin".
  - [ ] Optional: run the latest validator too, from a machine that can
        reach grafana.com:
        `npx -y @grafana/plugin-validator@latest -sourceCodeUri https://github.com/comebacktomorrow/visual-timeline/tree/v1.0.0 savvycocoa1919-visualtimeline-app-1.0.0.zip`
        A pre-flight run of 0.49.10 on `main` (b8e10fd) on 2026-10-06 found
        no errors and only the "unsigned plugin" warning; osv-scanner,
        broken links and React 19 compatibility all passed. (With
        `--cache .cache/npm` the React 19 check fails to start; use npm's
        default cache.)
- [ ] Edit the draft release notes if needed, then **publish** it. The zip
      and sha1 links only work once it's published.

## 3. Submit on grafana.com

Sign in as an admin of the `savvycocoa1919` org, open **My Plugins**, then
**Submit New Plugin**:

- **OS & Architecture:** Single. The plugin is frontend-only, with no
  backend binaries.
- **URL:** the published release's `.zip` asset link.
- **Source code URL:** `https://github.com/comebacktomorrow/visual-timeline/tree/v1.0.0`
- **SHA1:** the contents of the `.zip.sha1` asset.
- **Provisioning provided for test environment:** yes (see below).
- **Signature level questions:** a community plugin (free, open source,
  Apache-2.0).
- **Testing guidance:** paste and adjust:

  > Visual Timeline is an app plugin bundling a panel and a data source.
  > The app is auto-enabled.
  >
  > **No backend needed:** add a Visual Timeline panel and leave API URL and
  > Data source empty. It renders built-in demo data: five sources across
  > two sites, with an outage, a cadence change, a declared pause, two
  > sources in other time zones and some annotations. Hover to scrub, drag
  > to zoom, and switch Display mode between Timeline and Multiview grid.
  >
  > **Provisioned environment:** `docker compose up` in the repository
  > starts Grafana with the plugin, a mock frames API (`vt-mock-api`) and:
  >
  > - the dashboard "Provisioned Visual Timeline dashboard" (demo data,
  >   timeline and grid);
  > - the dashboard "Visual Timeline — data source mode": one panel reads
  >   through the data source "Visual Timeline API (mock)", whose viewer
  >   token is stored in secureJsonData and injected by the plugin.json
  >   proxy route; the other panel uses a data source with a wrong token
  >   and shows the error.
  >
  > The data source's Save & test checks the API and the token. The panel
  > follows Grafana's light/dark theme and the dashboard time zone.

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
- [ ] Cut 1.0.1 (or the next version) the same way, so the published zip is
      signed, and submit it as an update under **My Plugins**.
- [ ] Delete this file.

## Later, not blocking

- Users of the old standalone panel plugin must uninstall it before
  installing the app, because both ship the panel id. The README covers this
  under "Upgrading"; consider mentioning it in the 1.0.0 release notes.
- The scaffold-managed `.config/docker-compose-base.yaml` still names the dev
  container and mount after the panel id. It switches to the app id on the
  next create-plugin update (`docs/UPSTREAM-UPDATES.md`).
- Open issues: #81 (wrong-token message; see above) and #44 (worker
  key-list caching). #77 and #26 are closed.
