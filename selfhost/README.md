# Self-hosting Visual Timeline

Everything on your own hardware, in one Docker Compose file: the frames
backend and a Grafana with the plugin and a ready data source. Frames never
leave your network, and there are no request quotas or cloud accounts.

- **Backend** (`http://localhost:8787`): the reference worker from
  [`worker/`](../worker), unchanged, running on workerd (Cloudflare's
  open-source Workers runtime) through wrangler's local mode. It stores frames
  on a Docker volume and also serves the standalone viewer at `/app.html`.
- **Grafana** (`http://localhost:3000`): with the Visual Timeline app, a
  **Visual Timeline API** data source pointing at the backend, and a starter
  dashboard. Already run Grafana? See [Use your own Grafana](#use-your-own-grafana).

You need Docker with Compose v2, and a clone of this repository.

## Start it

```bash
cp selfhost/.env.example selfhost/.env
# edit selfhost/.env: replace every value (openssl rand -hex 24 makes a token)
docker compose -f selfhost/docker-compose.yml up -d
```

The first run builds the backend image and the plugin, so it takes a few
minutes. Then open Grafana (`admin` / `admin` on first login, and it asks you
to change the password) and the **Visual Timeline** dashboard. It's empty until
something uploads frames.

Ports taken? Set `VT_PORT` and `GRAFANA_PORT` when you run compose, and keep
`PUBLIC_URL` in `.env` on the same port as `VT_PORT`.

## Send it frames

A source is anything that can POST a JPEG on a schedule (a camera, a kiosk
screen, a web page screenshot) to `/upload` with its site's upload token. The
site is the key in `UPLOAD_TOKENS` (`home` in the example).

**Cameras.** List them in `selfhost/cameras.json` and the stack's uploader
service posts a snapshot from each one a minute, shrunk to 640 px wide:

```bash
cp selfhost/cameras.example.json selfhost/cameras.json
# edit selfhost/cameras.json: one entry per camera
# then uncomment COMPOSE_PROFILES=cameras in selfhost/.env, and:
docker compose -f selfhost/docker-compose.yml up -d
```

Each camera has a `site` (a key in `UPLOAD_TOKENS`, which is where its upload
token comes from), an `id`, and its snapshot `url`. Optionally:

- `auth`: `user:password` for the camera, sent as digest auth, or as basic
  auth with `"auth_type": "basic"`;
- `timezone`: an IANA name such as `Australia/Brisbane`, if the camera burns a
  clock into the image;
- `cadence` (seconds, default 60) and `width` (pixels, default 640).

`auth_type`, `cadence` and `width` can also be set once at the top of the
file for every camera. [`snapshot-uploader.sh`](snapshot-uploader.sh) lists
the snapshot URLs of common cameras and of Frigate. `cameras.json` holds
camera passwords, so it is gitignored. After editing it, run
`docker compose -f selfhost/docker-compose.yml restart uploader`, and
`docker compose -f selfhost/docker-compose.yml logs uploader` shows what
each camera is doing.

Each camera runs on its own schedule, so a slow or dead one never delays the
others. A failed snapshot or upload is dropped rather than retried: the gap on
the timeline is how you see a camera was down.

The script also runs outside Docker (it needs `curl`, `ffmpeg` and `jq`),
anywhere that can reach both the cameras and the backend:

```bash
UPLOAD_TOKENS='{"home": "<the home upload token>"}' \
VT_URL=http://localhost:8787 sh selfhost/snapshot-uploader.sh selfhost/cameras.json
```

For a single camera it takes environment variables instead of a file; see
the top of the script.

**Anything else.** One frame with curl:

```bash
curl -X POST http://localhost:8787/upload \
  -H "Authorization: Bearer <the home upload token>" \
  -H "X-Site: home" -H "X-Source: test" -H "X-Cadence: 60" \
  -H "Content-Type: image/jpeg" --data-binary @frame.jpg
```

The full upload contract, including time zones, hi-res variants and declared
pauses, is in [docs/API.md](../docs/API.md).

## View it from other machines

Image URLs are built on `PUBLIC_URL`, so it must be the address your browser
uses to reach the backend. For other machines on your network, set it to the
host's name or address (`PUBLIC_URL=http://nas.lan:8787`), then
`docker compose -f selfhost/docker-compose.yml up -d` again.

This stack is meant for a trusted network. To reach it from the internet, put
it behind a reverse proxy with TLS (and use the proxy's address as
`PUBLIC_URL`) rather than exposing the ports.

## Use your own Grafana

Start only the backend:

```bash
docker compose -f selfhost/docker-compose.yml up -d backend
```

Then, in your Grafana:

1. Install the plugin from the Grafana catalog, or unzip a
   [release](https://github.com/comebacktomorrow/visual-timeline/releases)
   into Grafana's plugins folder. Until the catalog signs it, allow
   `savvycocoa1919-visualtimeline-app`, `savvycocoa1919-visualtimeline-panel`
   and `savvycocoa1919-visualtimeline-datasource` in
   `allow_loading_unsigned_plugins`, then restart Grafana.
2. Add a **Visual Timeline API** data source with the backend's address as the
   API URL (one your Grafana server can reach) and `VIEWER_TOKEN` as the
   viewer token, and click **Save & test**. The images load from
   `PUBLIC_URL`, so that must be reachable from the browsers viewing the
   dashboards.
3. Add a **Visual Timeline** panel and pick that data source.

## Storage

Frames are kept until you delete them: there is no automatic pruning yet. A
640 px camera frame is typically 30–80 KB, so one camera at one frame a minute
uses roughly 40–120 MB a day. Plan the disk accordingly.

- Frames live in the `visual-timeline_frames` Docker volume, in workerd's
  local storage format (not a folder of JPEGs). Back up the volume to back up
  the frames.
- `docker compose -f selfhost/docker-compose.yml down -v` deletes **all**
  frames and Grafana's data. Without `-v`, both are kept.

## Update

```bash
git pull
docker compose -f selfhost/docker-compose.yml up -d --build
```

## How it works, and its limits

The backend is the same code that runs on Cloudflare: wrangler's local mode
runs it on workerd with Miniflare's local R2 storage. That makes this stack a
good fit for a home lab or a small site, but wrangler's local mode is built as
a development server, not a hardened production host. For a public or larger
deployment, deploy the same worker to Cloudflare (see
[worker/README.md](../worker/README.md)).
