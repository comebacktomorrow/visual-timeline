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

To point a local Grafana at it, give a panel the **API URL**
`http://localhost:8787`. Reads are open locally, so the panel can call the
Worker straight from your browser, with no data source.

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
   three, plus the optional `IMG_BASE`.

3. Deploy:

   ```bash
   npx wrangler deploy
   ```

   Wrangler prints the Worker's URL. Use it as the **API URL** in a Visual
   Timeline API data source in Grafana, with a viewer token from
   `VIEWER_TOKEN`. The standalone viewer is at `<that URL>/app.html`.

`npx wrangler rollback` returns to the previous version if a deploy goes
wrong.

## Uploading frames

An uploader captures a JPEG on its cadence and POSTs it to `/upload` with
its site, source, cadence and per-site token. If an upload fails, it drops
the frame and moves on: the gap is the signal. "Implementing your own
uploader" in [docs/API.md](../docs/API.md) has the details.
