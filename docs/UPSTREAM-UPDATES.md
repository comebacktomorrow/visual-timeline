# Upstream updates: Dependabot, scaffold, security

How to take in the dependency, scaffold and security changes that arrive from
upstream (Dependabot, `@grafana/create-plugin`, new advisories) without
breaking the build or the plugin's Grafana range. Written for a person or an
agent session starting cold.

Run it after the scaffold job on the 1st of each month, or whenever the
Dependabot queue piles up. Most of the time is spent waiting on CI;
the decisions are in steps 2 and 6.

## Ground rules

- **Never edit `.config/`.** It belongs to `@grafana/create-plugin` and only
  changes through the scaffold update (step 5). `CLAUDE.md`, `AGENTS.md`,
  `GEMINI.md` and `.claude/` are also scaffold templates.
- **Keep `grafanaDependency` at `>=10.4.0`.** New scaffolds default to
  `>=13.2.0`; copying that would drop every 10.4–13.1 install for no benefit.
  The e2e matrix (10.4 up to nightly) is what decides whether the range
  still holds.
- **`@grafana/*` and `react` are webpack externals.** Grafana supplies them at
  runtime, so bumping them here only changes typings, tests and tooling, not
  what the panel runs against. That's why a React major can land safely as
  long as e2e on the oldest supported Grafana stays green.
- **Run `npm ci` on this repo with npm 11.** Dependabot writes lockfiles with
  npm 11, which prunes nested entries that npm 10 still demands. When a
  dependency carries a nested pin, npm 10 (bundled with Node 20/22) rejects
  the lockfile with `Missing: <pkg> from lock file`. That happened from July
  to 2026-09-25 with `@grafana/runtime`'s nested `typescript@5.9.3`, until the
  React 19 bump removed it. npm 10 accepts today's lockfile, but the next
  nested pin brings the failure back, so the npm 11 pins stay: `ci.yml` runs
  `npm install -g npm@11`, `cp-update.yml` passes `node-version: "24"`, and
  the demo build stage uses `node:24`.
- **Merging is the maintainer's call.** An agent session merges only the PRs
  the maintainer has named by number.
- **None of this needs a redeploy** unless `worker/`, `web/` or `src/` changed.
  Dependency and scaffold bumps change how the project builds, not what's
  serving traffic.

## 1. Survey

```bash
R=comebacktomorrow/visual-timeline
git fetch origin && git status -sb
gh pr list --repo $R --state open
gh issue list --repo $R --state open

# per-PR CI and mergeability
for n in $(gh pr list --repo $R --state open --json number --jq '.[].number'); do
  mm=$(gh pr view $n --repo $R --json mergeable,mergeStateStatus --template '{{.mergeable}}/{{.mergeStateStatus}}')
  ck=$(gh pr checks $n --repo $R 2>/dev/null | awk -F'\t' '{print $2}' | sort | uniq -c | tr '\n' ' ')
  echo "#$n [$mm] $ck"
done

# scaffold: ours vs npm latest
jq -r .version .config/.cprc.json
npm view @grafana/create-plugin version

# what upstream changed (release notes)
gh api repos/grafana/plugin-tools/releases --jq \
  '.[] | select(.tag_name | startswith("@grafana/create-plugin@")) | "\(.tag_name) \(.published_at)"' | head

# advisories: highs fail the catalog validator (step 4)
npm audit | grep -E "vulnerabilities|Severity: (high|critical)"
```

`mergeable` often reads `UNKNOWN` right after a push while GitHub computes
it. Re-query before drawing conclusions.

## 2. Triage the red PRs

Almost every red Dependabot PR fails at `npm ci` with a peer-dependency
`ERESOLVE`. Read the three lines that matter:

```bash
gh run view <run-id> --repo $R --log-failed \
  | grep -E "While resolving|Found:|peer .* from|Conflicting" | sed 's/.*Z //'
```

Then check whether **upstream's own template** has already moved, because it
is the reference for what's supported:

```bash
TAG=@grafana/create-plugin@$(npm view @grafana/create-plugin version)
gh api "repos/grafana/plugin-tools/contents/packages/create-plugin/templates/common/_package.json?ref=$TAG" \
  --jq .content | base64 -d | grep -E '"(react|@grafana/[a-z-]+|eslint[a-z-]*|typescript)"'
```

Decide:

| Situation | Action |
|---|---|
| The bump needs a companion package, and upstream's template already has it (for example, `@grafana/data` 13.2 needs React 19, and the template moved to React 19) | Do the companion bump in your own PR (step 3). It supersedes the Dependabot PR, which closes itself once yours merges. |
| Nothing upstream supports it yet (for example, eslint 10 while `eslint-plugin-react` stops at 9, or TypeScript 7 while `typescript-eslint` requires <6.1) | Ignore that major version (below). |
| The bump changes a config shape that lives in `.config/` (for example, `@grafana/eslint-config` 10 dropping the `flat.js` export that `.config/eslint.config.mjs` imports) | Ignore it. It arrives through the scaffold update's migration, not by hand. |

Ignore commands. These are PR comments; Dependabot confirms and closes the
PR or rebuilds the group itself:

```text
@dependabot ignore this major version            # single-dependency PR
@dependabot ignore <dependency> major version    # one member of a grouped PR
@dependabot show <dependency> ignore conditions  # see what's recorded
```

**Ignores live on GitHub, not in `.github/dependabot.yml`.** Record them in
the [current state](#current-state) section below, or the next session
won't know they exist.

## 3. Companion bump in your own PR

A plain `npm install` after editing `package.json` usually fails with
`ERESOLVE`, because it resolves against the old pins in the lockfile.
Regenerating the whole lockfile works, but it churns every transitive
dependency and makes the PR unreviewable. Instead, prune only the entries
for the packages being bumped:

```bash
git checkout -b deps/<name>
# edit package.json versions, then:
python3 - <<'EOF'
import json, re
p = 'package-lock.json'
d = json.load(open(p)); pk = d['packages']
# list exactly the packages being bumped
pat = re.compile(r'(^|/)node_modules/(@grafana/(data|i18n|runtime|schema|ui)|react|react-dom|scheduler|@types/react|@types/react-dom)$')
drop = [k for k in pk if k and pat.search(k)]
for k in drop: del pk[k]
json.dump(d, open(p, 'w'), indent=2); open(p, 'a').write('\n')
print(len(drop), 'entries dropped')
EOF
rm -rf node_modules && npm install --no-audit --no-fund
```

Then diff the lockfile against main and make sure only the intended closure
moved:

```bash
python3 - <<'EOF'
import json, subprocess
old = json.loads(subprocess.check_output(['git','show','main:package-lock.json']))['packages']
new = json.load(open('package-lock.json'))['packages']
for k in sorted(set(old) & set(new)):
    if k and old[k].get('version') != new[k].get('version'):
        print(k, old[k].get('version'), '->', new[k].get('version'))
print('added', sorted(set(new) - set(old)))
print('removed', sorted(set(old) - set(new)))
EOF
```

If an unrelated package moved because your pattern was too broad, copy its
entry back from `git show main:package-lock.json` and run `npm install` again.

Verify under npm 11 before pushing:

```bash
rm -rf node_modules && npm ci && npm run typecheck && npm run lint && npm run build
```

The PR description should say what it supersedes, why it's safe (externals,
the e2e range), and what the lockfile diff contains. Wait for the whole e2e
matrix, especially the **oldest** Grafana. That's the one a dependency major
can break.

## 4. Security gate

When the plugin is submitted, the catalog validator runs osv-scanner on the
**pushed** lockfile and fails on any high or critical finding. New advisories
appear between runs, so main can go red without any change on our side.

```bash
npm audit | grep -B1 -A6 "Severity: high"
npm audit fix            # never --force: it jumps @grafana majors
```

If a high sits in a dev-only chain that `audit fix` can't reach, pin it with
`overrides` in `package.json`, like the existing `js-cookie` pin. Commit
audit fixes as their own commit (they can ride on a dependency PR, since
separate PRs would conflict on the lockfile anyway).

To check it the way the catalog will, push first, then run the validator
against the GitHub source. The scaffold's `validate-plugin` skill omits the
source argument, so it skips this check. A local `file://` source also hangs
walking `node_modules`, so point it at GitHub instead:

```bash
npm run build
PID=savvycocoa1919-visualtimeline-panel; ZIP=$PID-$(date +%Y%m%d-%H%M%S).zip
rm -rf /tmp/$PID && cp -r dist /tmp/$PID && (cd /tmp && zip -qr $ZIP $PID)
docker run --platform linux/amd64 --rm -v /tmp:/archives grafana/plugin-validator-cli \
  -sourceCodeUri https://github.com/comebacktomorrow/visual-timeline /archives/$ZIP
```

The expected result is exit 0, with only the "unsigned plugin" warning and
the optional sponsorship-link note.

## 5. Scaffold update

`.github/workflows/cp-update.yml` runs on the 1st of each month. It compares
`.config/.cprc.json` against npm's `latest` tag for `@grafana/create-plugin`
and opens a "bump @grafana/create-plugin configuration" PR when they differ.

- **Token.** It pushes with the `GH_PAT_TOKEN` repo secret: a fine-grained
  PAT on this repo only, with Contents, Pull requests and Workflows set to
  read/write. The token is kept in 1Password as **Github Visual Timeline
  PAT** (Employee vault). Store it without printing it, then check its expiry
  from the response header:

  ```bash
  op read "op://Employee/Github Visual Timeline PAT/credential" \
    | gh secret set GH_PAT_TOKEN --repo comebacktomorrow/visual-timeline
  op read "op://Employee/Github Visual Timeline PAT/credential" \
    | sed 's/^/Authorization: Bearer /' \
    | curl -s -o /dev/null -D - -H @- https://api.github.com/repos/comebacktomorrow/visual-timeline \
    | grep -i github-authentication-token-expiration
  ```

  An expired token looks like `fatal: Authentication failed` in the run log.
  GitHub's default expiry for fine-grained tokens is **30 days**. Pick a
  custom expiry when regenerating.
- **Run it now** instead of waiting for the 1st: Actions → *Create Plugin
  Update* → *Run workflow*, or `gh workflow run cp-update.yml --repo $R`.
- **npm's `latest` tag can lag a GitHub release by days.** The job follows
  npm, so a release in the plugin-tools changelog may not be picked up yet.
- The scaffold PR usually touches only `.config/`. Its migrations may also
  add or remove `devDependencies`, so read its `package.json` diff before
  merging.

## 6. Merge order

Lockfile PRs have to go in one at a time. **Dependabot rebases only on a
textual conflict**, so a PR can show `MERGEABLE/CLEAN` with green checks
while sitting on a base that never saw another PR's lockfile changes. A clean
text merge of two lockfile edits doesn't prove the result installs.

1. **Your own lockfile PRs first.** Dependabot won't rebase them for you.
2. **PRs that don't touch `package.json` or the lockfile** (workflow and
   scaffold `.config/` bumps) can go in any order.
3. **Dependabot lockfile PRs, one at a time.** Before each, check whether the
   PR is missing any main commit that touched package files:

   ```bash
   n=<pr>; br=$(gh pr view $n --repo $R --json headRefName --jq .headRefName)
   base=$(gh api "repos/$R/compare/main...$br" --jq .merge_base_commit.sha)
   gh api "repos/$R/compare/${base}...main" \
     --jq '[.files[].filename] | map(select(. == "package-lock.json" or . == "package.json")) | length'
   ```

   If that prints anything but `0`, comment `@dependabot rebase`, wait for
   the **new head commit's** checks to go green, then merge. Checks that turn
   green seconds after a rebase request are the old head's; wait until the
   head SHA changes. After each merge, the remaining lockfile PRs become
   stale again, so repeat the check.

`gh pr merge <n> --squash --delete-branch` for each.

## 7. Verify main

```bash
git checkout main && git pull --ff-only
rm -rf node_modules && npm ci && npm run typecheck && npm run lint && npm run build
npm audit | grep vulnerabilities
gh run list --repo $R --branch main --event push --workflow ci.yml --limit 1
```

Main's push CI includes the full e2e matrix. Wait for it on the final merge
commit before calling the job done.

## Current state

Update this section whenever an ignore, pin or token changes.

As of **2026-09-25**:

| What | State | When to revisit |
|---|---|---|
| Scaffold | create-plugin 7.11.0 | 7.12.0 is released on GitHub but not yet npm `latest`; the next scaffold PR brings in the `@grafana/eslint-config` v10 migration |
| Ignore: `eslint` 10.x | blocked by `eslint-plugin-react`, which requires eslint ≤9.7; the upstream template is still on eslint 9 | when the template moves to eslint 10 |
| Ignore: `typescript` 7.x | blocked by `typescript-eslint`, which requires <6.1 | when `typescript-eslint` supports 7 |
| Ignore: `@grafana/eslint-config` 10.x | its exports changed; only the scaffold migration updates `.config/eslint.config.mjs` | automatic once the 7.12 scaffold PR merges |
| Pin: `overrides.js-cookie ^3.0.6` | floor under a dev-only high (GHSA-qjx8-664m-686j) reached through `@grafana/data` → `react-use` / `@react-hookz/web`, whose `^3.0.0` range still allows the vulnerable ≤3.0.5 | drop once they require ≥3.0.6 themselves |
| React | 19 (dev only), since 2026-09-25 | — |
| `GH_PAT_TOKEN` | expires **2026-10-25** | regenerate before then |
| Open advisories | 4 moderate (react-router chain), none high | they need an `@grafana` major, so leave them |

## Pitfalls seen in practice

- **zsh doesn't word-split.** `set -- $var` or `for x in $list` in scripts
  run under zsh gets one argument holding the whole string. Query one field
  at a time, or use `${=var}`.
- **`gh pr checks` rows are tab-separated.** Split with `awk -F'\t'`.
- **The scaffold template is not a spec for this plugin.** Copy its
  dependency versions, not its `grafanaDependency`.
- **A green Dependabot PR can be a month old.** It was tested against a main
  that no longer exists. Check the base (step 6) before trusting it.
