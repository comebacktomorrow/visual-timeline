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

### `GET /frame/{variant}/{site}/{source}/{ts}.jpg`

The frame image. Served with `Cache-Control: public, max-age=31536000,
immutable` + ETag. Missing frame → 404 (that's a gap, render it as one).

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
