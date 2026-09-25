# Visual Timeline — frames API

The Visual Timeline panel and web app bind to this small HTTP contract, not
to any particular backend. The Cloudflare Worker in `worker/` is the
reference implementation; anything that speaks this contract works — kiosk
screens, security cameras, website thumbnailers, render farms.

A `site` groups image `source`s. (The legacy `X-Kiosk` header, `kiosk=`
query param, and `/kiosks` endpoint remain as deprecated aliases.)

## Core ideas

- **Cadence is a heartbeat contract.** Every upload declares how often this
  source promises a frame (`X-Cadence`, seconds). Timestamps snap to that
  grid, keys become deterministic, and a *missing* frame means *offline* —
  the timeline renders gaps at their true temporal width.
- **Frames are immutable.** A frame URL never changes content, so clients
  and CDNs may cache forever.
- **Two variants.** `lo` (small, every capture — feeds timelines/tiles) and
  optional `hi` (larger, usually slower cadence — feeds the click-in
  preview, which falls back to `lo` on 404).
- **Cadence events.** Pace changes and deliberate pauses are structural
  events recorded in each source's `history`. Clients render each era on
  its own grid: sparse frames during a slow era aren't gaps, and a declared
  pause is neutral silence, not the red offline treatment. A source that
  dies unexpectedly never declares anything — its silence stays *offline*.

## Endpoints

### `POST /upload`

JPEG body. Headers:

| Header | Required | Meaning |
|---|---|---|
| `Authorization: Bearer <token>` | yes | per-site upload token |
| `X-Site` | yes | group id (`[a-z0-9][a-z0-9_-]*`) |
| `X-Source` | yes | source id (same charset) |
| `X-Cadence` | yes | promised seconds between frames (5–3600) |
| `X-Variant` | no | `lo` (default) or `hi` |
| `X-Timestamp` | no | epoch ms (backfill); default now; snapped to the cadence grid |
| `X-Location` | no | area/zone label within the site |
| `X-Tags` | no | free-form labels: `env=prod,room=lobby` (≤8 pairs; keys `[a-z0-9_-]`, values `[a-z0-9 ._-]`) |

Response: `{"ok":true,"key":"lo/<site>/<source>/<ts>.jpg","ts":<snapped ms>}`

### `POST /declare`

A source about to go deliberately silent (quiet hours, display off,
maintenance) says so **while it can still speak**. Headers:
`Authorization` (same per-site upload token), `X-Site`, `X-Source`,
`X-Event: pause`. Appends a paused entry to the source's `history`.
Idempotent (`{"ok":true,"note":"already paused"}` if already paused).

Resume needs no declaration — the next upload is the resume. The server
closes the paused era in the registry on that upload (best-effort); clients
also infer resume directly from frames appearing inside a paused era, so a
source that crashes *while paused* still renders correctly.

### `GET /sources?site=<csv>`

Registry of known sources (built from upload declarations; cadence changes
and pauses are recorded in `history`). `site` omitted/`All` = every site.

```json
[{"id":"source-1","site":"site-a","location":"lobby","tags":{"env":"prod"},
  "cadence":60000,"hiCadence":300000,
  "history":[{"since":1783488360000,"variant":"lo","cadence":60000},
             {"since":1783524213946,"variant":"lo","paused":true}]}]
```
Cadences are milliseconds. `history` entries mark eras: a `cadence` entry
starts a new pace, a `paused:true` entry starts declared silence, and the
next non-paused upload ends it.

### `GET /frames?site=&source=&from=&to=&step=&variant=`

At most one frame per `step`-sized bucket (the frame nearest each bucket
tick), `from`/`to` epoch ms, `step` ms (a multiple of the source's cadence —
clients derive it from their pixel budget, Prometheus-style).

```json
[{"source":"source-1","ts":1783488360000,"url":"https://…/frame/lo/site-a/source-1/1783488360000.jpg"}]
```

Clients load each `url` exactly as returned, with one exception: a client
holding a viewer key appends `?k=<key>` to a bare URL (no query string) on
the API's own origin, because `<img>` can't send headers. A URL with its own
query string is taken to carry its own authorization (a signature, a
presigned query), and a URL on any other origin is taken to be public, so
neither is ever handed the viewer key.

### `GET /frame/{variant}/{site}/{source}/{ts}.jpg`

The frame image. Served with `Cache-Control: public, max-age=31536000,
immutable` + ETag. Missing frame → 404 (that's a gap, render it as one).

## Write auth: adding a site (reference worker)

`UPLOAD_TOKENS` is **one secret holding the whole map**, `{site: token}` —
not one secret per site:

```json
{"site-a": "tok...", "site-b": "tok..."}
```

`/upload` and `/declare` look up `tokens[X-Site]`, so a token is only ever
valid for the site it is filed under. A source uploading to a site with no
entry gets `401` while holding a token that works perfectly elsewhere — the
same response as a wrong token, which makes "this site was never
provisioned" easy to misread as "this credential is broken". Adding a site
is provisioning, never a retry.

Two consequences when you add one:

- **Writing the secret replaces the whole map.** Build the new JSON from
  your own record of what is deployed and re-put it complete; a map
  assembled from memory or from stale notes silently revokes every site it
  omits. Keep that record next to the deployment — on Cloudflare a secret
  cannot be read back.
- **Site ids are `^[a-z0-9][a-z0-9_-]{0,62}$`.** Over 63 characters, or a
  leading `-`, is rejected as `400 bad site/source` rather than `401` — a
  different symptom for what looks like the same problem. If your uploader
  derives ids from display names, derive the id and check it, rather than
  assuming the slug.

### Checking which tokens are live, without writing anything

`/upload` validates the headers, then authorizes, **then** requires
`content-length`. So a bodyless POST separates "this token is accepted" from
"this token is rejected" without storing a frame:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  -H "X-Site: $SITE" -H "X-Source: authprobe" \
  -H "X-Cadence: 60" -H "X-Variant: lo" \
  -H "Authorization: Bearer $TOKEN" --data-binary '' \
  "$BASE/upload"
# 411 → token accepted for this site   401 → not accepted   400 → malformed id
```

Probe every site before and after changing the map: that is what catches an
accidental revocation while it is still one command to undo.

## Read auth (reference worker)

Writes always require the per-site upload token. Reads are governed by
three env vars, composable per deployment:

- **`VIEWER_TOKEN`** (secret) — when set, every data read (`/sources`,
  `/frames`, `/frame/*`) requires a viewer credential: `Authorization:
  Bearer` on API calls, `?k=` on image URLs (`<img>` can't send headers).
  Unset = open reads (dev/demo). Either a single token string, or a JSON
  map of **named consumers** so a leaked dashboard costs one revocable
  entry, optionally scoped to sites:

  ```json
  {"grafana-cloud": "tok...",
   "lobby-wall": {"token": "tok...", "sites": ["site-a"]}}
  ```

  A site-scoped consumer sees only its sites in `/sources` and gets 403
  for out-of-scope `/frames` and `/frame/*`.
- **`IMG_SIGN_KEY`** (secret) — when set, `/frames` appends
  `?e=<expiry-ms>&sig=<hex HMAC-SHA256(site/source|expiry)>` to each image
  URL, and `/frame/*` accepts a valid signature as authorization on its
  own. The long-lived viewer token then never appears in image URLs
  (browser history, dashboard JSON, request logs); a leaked URL exposes
  one source's frames for ≤24 h. One signature covers both variants of a
  source, so clients reuse the lo URL's query string when constructing
  hi-variant URLs. The viewer token keeps working as a fallback.
- **`IMG_BASE`** — the explicit *public* opt-out for content that
  tolerates it: image URLs point at an R2 custom domain, bypassing the
  Worker (and its request quota) entirely. R2 domains can't verify
  signatures or tokens, and frame keys are predictable — **only** use
  this when the frames may be world-readable.

Default-private posture: set `VIEWER_TOKEN` + `IMG_SIGN_KEY`, leave
`IMG_BASE` unset.

### Where the viewer token lives (and the 2.0 plan)

The panel is a **panel plugin**, so its API key is a per-panel option in
the dashboard JSON — plaintext, visible to anyone who can view the
dashboard (they receive it in the browser regardless: panels fetch
client-side). Panel plugins have no config page and no `secureJsonData`;
those are app/datasource plugin features. Practical posture today: use a
dedicated, revocable viewer token per consumer (a dashboard, a wallboard)
and treat "can view the dashboard" as "holds that token".

The keyless architecture — planned as the 2.0 shape, not built — is a
small companion **datasource plugin**: its config page stores the API URL
+ key in `secureJsonData` (encrypted server-side), `/sources` and
`/frames` proxy through Grafana's backend so the key never reaches the
browser, and the signed image URLs this API already mints are what make
that cheap — the proxied `/frames` response carries its own short-lived
image authorization, so `<img>` tags still load straight from the worker
with no key and no image bytes proxied through Grafana. Grafana's own
login becomes the viewer-facing auth flow; no second login, no static
key in any dashboard JSON. (The other conceivable flow — browser SSO à
la Cloudflare Access in front of the worker — is a poor fit for panels:
cross-origin cookies + CORS-with-credentials, and it breaks the
wildcard-CORS embed story.)

## Try it with curl

```bash
BASE=http://localhost:8787          # wrangler dev (see README quickstart)
TOKEN=dev-token                     # from worker/.dev.vars

# upload a frame (any JPEG)
curl -X POST $BASE/upload \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Site: site-a" -H "X-Source: source-1" \
  -H "X-Cadence: 60" -H "X-Location: lobby" \
  -H "Content-Type: image/jpeg" \
  --data-binary @some-frame.jpg

# backfill a historical frame (10 minutes ago)
curl -X POST $BASE/upload \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Site: site-a" -H "X-Source: source-1" -H "X-Cadence: 60" \
  -H "X-Timestamp: $(($(date +%s%3N) - 600000))" \
  --data-binary @some-frame.jpg

# a hi-res variant on a slower cadence
curl -X POST $BASE/upload \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Site: site-a" -H "X-Source: source-1" \
  -H "X-Cadence: 300" -H "X-Variant: hi" \
  --data-binary @some-frame-big.jpg

# what sources exist?
curl "$BASE/sources?site=site-a"

# change pace (quiet hours): just declare the new cadence on the next
# upload — the registry records the change and viewers re-grid that era
curl -X POST $BASE/upload \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Site: site-a" -H "X-Source: source-1" -H "X-Cadence: 600" \
  --data-binary @some-frame.jpg

# going quiet on purpose (quiet hours, display off)
curl -X POST $BASE/declare \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Site: site-a" -H "X-Source: source-1" -H "X-Event: pause"

# frames for the last hour, one per minute
NOW=$(date +%s%3N)
curl "$BASE/frames?site=site-a&source=source-1&from=$((NOW-3600000))&to=$NOW&step=60000"
```

macOS `date` lacks `%3N`; use `python3 -c 'import time; print(int(time.time()*1000))'`.

## Implementing your own uploader

Loop: capture → JPEG → POST, aligned to the cadence grid (send at epoch
multiples of the cadence). On failure: **drop the frame and log** — never
queue. A gap is the signal that the source was down; queued late frames
would erase it. See `web/sim.html` (browser canvas) for a reference
uploader; a Windows screen-capture uploader is ~40 lines of PowerShell
around `Graphics.CopyFromScreen` + `Invoke-RestMethod`.
