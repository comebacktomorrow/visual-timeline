# Reference backend: Cloudflare Worker + R2

A single-file [Cloudflare Worker](https://developers.cloudflare.com/workers/)
that implements the frames API in [docs/API.md](../docs/API.md) on top of an R2
bucket. The Grafana panel binds to that API contract, not to this Worker, so
any server that speaks it will do. This one is here so you can run a real
fleet without writing a backend, and it fits the Workers/R2 free tier.

What it does:

- **Cadence-aligned storage.** Uploads snap to the source's cadence grid, so
  storage keys are deterministic and a missing key means a missing frame.
- **Immutable frame caching.** A frame never changes once written, so images
  are served with a one-year immutable cache header.
- **Per-step downsampling.** `/frames` returns at most one frame per step,
  however many the window holds.
- **Per-site upload tokens.** Each site has its own write token.
- **Private reads by default.** A viewer token guards the API, and signed,
  expiring image URLs let images load without that token appearing in them.
- **The standalone viewer.** It also serves `web/` (the standalone app,
  embeddable viewer and fleet simulator) from the same origin; see
  [docs/VIEWER.md](../docs/VIEWER.md).

To run it on your own hardware for good rather than on Cloudflare, use the
Docker Compose stack in [selfhost/](../selfhost/README.md), which runs this
same code.

## Run it locally (no Cloudflare account)

```bash
cd worker && npm install
npx wrangler dev --port 8787        # local Worker + local R2, dev tokens in .dev.vars
```

Then open:

1. `http://localhost:8787/sim.html` and click **Backfill last 60 min** (and,
   optionally, start live ticking). A simulated 5-source fleet uploads
   canvas-rendered frames through the real `/upload` path, including an
   outage and a hi-res variant.
2. `http://localhost:8787/app.html`: the standalone app on that data.

`.dev.vars` holds throwaway upload tokens for `site-a` and `site-b`, and
leaves reads open (no viewer token). To upload real frames with curl, see
"Try it with curl" in [docs/API.md](../docs/API.md).

To read it from a local Grafana, use the Infinity data source with the URL
`http://localhost:8787` (no token: reads are open locally), as in
[docs/INFINITY.md](../docs/INFINITY.md); the Visual Timeline panel draws the
frame rows it returns. If Grafana runs in
Docker, use `http://host.docker.internal:8787` instead and start the Worker
with `--var PUBLIC_URL:http://localhost:8787`, so the image URLs it returns
are ones your browser can reach.

## Tests

```bash
cd worker && npm test
```

These are contract tests for the API, run against the Worker in Node with an
in-memory bucket. They don't need a Cloudflare account.

## Deploy to Cloudflare

1. Create the bucket, and set its name in `wrangler.jsonc` if you use a
   different one:

   ```bash
   npx wrangler r2 bucket create visual-timeline-frames
   ```

2. Set the secrets. `wrangler secret put` prompts for each value, so nothing
   lands in your shell history:

   ```bash
   npx wrangler secret put UPLOAD_TOKENS   # {"site-a": "<token>", ...}: the whole map, every time
   npx wrangler secret put VIEWER_TOKEN    # a token, or a map of named consumers
   npx wrangler secret put IMG_SIGN_KEY    # any long random string
   ```

   `UPLOAD_TOKENS` is one secret holding every site's token, and writing it
   replaces the whole map, so keep your own record of what is deployed.
   Without `VIEWER_TOKEN`, anyone who knows the URL can read the frames.
   "Write auth" and "Read auth" in [docs/API.md](../docs/API.md) cover all
   three, plus the optional `IMG_BASE` and `PUBLIC_URL`.

   To delete old frames, also set `RETENTION_DAYS` (for example 90), as a
   plain variable in `wrangler.jsonc` (`"vars": { "RETENTION_DAYS": "90" }`)
   or in the Cloudflare dashboard. See "Retention" in
   [docs/API.md](../docs/API.md).

3. Deploy:

   ```bash
   npx wrangler deploy
   ```

   Wrangler prints the Worker's URL. In Grafana, read it through an Infinity
   data source with a viewer token from `VIEWER_TOKEN`
   ([docs/INFINITY.md](../docs/INFINITY.md)). The standalone viewer is at
   `<that URL>/app.html`.

`npx wrangler rollback` returns to the previous version if a deploy goes
wrong.

### Optional: a frame index in D1

Without one, `/frames` finds frames by listing R2, which costs a Class A
operation per 1000 frames on every uncached request and caps how much one
request can cover. With a D1 database bound as `DB`, uploads also record each
frame in a table, and `/frames` reads that instead, in 6-hour chunks that are
cached and shared by every zoom level and viewer. The table creates itself.

1. Create the database:

   ```bash
   npx wrangler d1 create visual-timeline-index
   ```

2. Add the binding it prints to `wrangler.jsonc`:

   ```jsonc
   "d1_databases": [
     { "binding": "DB", "database_name": "visual-timeline-index", "database_id": "<the id it printed>" }
   ]
   ```

3. Deploy (`npx wrangler deploy`). New frames are indexed from then on.

4. Index the frames already in R2, once per site, with that site's upload
   token. Each call works through about 5,000 frames and says where to carry
   on:

   ```bash
   BASE=https://<your worker>; SITE=site-a; TOKEN=<site-a's upload token>
   CURSOR=
   while :; do
     R=$(curl -s -X POST "$BASE/reindex" --url-query "cursor=$CURSOR" \
       -H "Authorization: Bearer $TOKEN" -H "X-Site: $SITE")
     echo "$R"
     [ "$(echo "$R" | jq -r .done)" = true ] && break
     CURSOR=$(echo "$R" | jq -r '.cursor // empty')
     [ -n "$CURSOR" ] || break   # an error: the response says why
   done
   ```

   Until a site is indexed, its older frames don't show: the worker reads the
   index alone once `DB` is bound.

On the free plan, D1 allows 100,000 rows written and 5 million read a day.
Each upload writes one row, and retention deletes one per frame it removes,
so that's about 50,000 uploads a day (35 hosts at one frame a minute) with
retention on. Reads are the frames in each chunk a request misses in the
cache: a live 6-hour chunk is read again every 15 seconds while someone
watches it.

## Uploading frames

An uploader captures a JPEG on its cadence and POSTs it to `/upload` with
its site, source, cadence and per-site token. If an upload fails, it drops
the frame and moves on: the gap is the signal. "Implementing your own
uploader" in [docs/API.md](../docs/API.md) has the details.
