# Visual Timeline

[![CI](https://github.com/comebacktomorrow/visual-timeline/actions/workflows/ci.yml/badge.svg)](https://github.com/comebacktomorrow/visual-timeline/actions/workflows/ci.yml)
[![Version](https://img.shields.io/github/package-json/v/comebacktomorrow/visual-timeline)](https://github.com/comebacktomorrow/visual-timeline/blob/main/CHANGELOG.md)
[![License](https://img.shields.io/github/license/comebacktomorrow/visual-timeline)](https://github.com/comebacktomorrow/visual-timeline/blob/main/LICENSE)

Scrub-able visual timeline and multiview for image feeds — kiosk screens,
security cameras, website thumbnails, anything that can post a JPEG on a
heartbeat. Hover to set a global time cursor across every source; gaps show
offline periods at their true temporal width; drag to zoom.

The plugin is a Grafana app that installs two plugins:

- the **Visual Timeline panel**, which draws the timeline and the multiview
  grid;
- the **Visual Timeline API data source**, which keeps your API's URL and
  viewer token in Grafana's server-side settings. It is optional, and only
  needed for an API whose reads need a token.

The app is enabled on install and has no pages of its own.

![Visual Timeline panels on a Grafana dashboard: a timeline and multiview grids](https://raw.githubusercontent.com/comebacktomorrow/visual-timeline/main/src/img/screenshot-dashboard.png)

## What it shows

Every image source declares how often it promises a frame (its _cadence_).
The panel treats that promise as a heartbeat, so the _absence_ of a frame
carries meaning:

- **Offline gaps at their true width.** A missing frame is drawn as a hatched
  gap on the timeline, as wide as the outage really was, and as an offline
  tile in the multiview. Sources drop failed frames rather than queueing them:
  the gap **is** the signal.
- **Eras.** When a source changes its cadence (slowing down for quiet hours,
  say), the timeline renders each era on its own grid, so a slow stretch isn't
  a wall of false gaps.
- **Declared pauses.** A source that goes quiet on purpose says so before it
  stops, and the pause shows as neutral silence. A source that crashes without
  saying anything still renders as offline.
- **The pending slot.** When a frame's expected time has passed but it hasn't
  arrived yet, the slot shows the last known frame as a pulsing ghost rather
  than a fault. A missed heartbeat still turns red on schedule.

Two display modes:

- **Timeline** — one strip per source along a shared time axis. Hover to scrub;
  drag to zoom, which sets the dashboard's time range.
- **Multiview grid** — one tile per source, showing the frame at the shared
  crosshair time (or just the latest frame in range).

The crosshair is shared both ways with the other panels on the dashboard:
hover a graph and the timeline and grid follow, hover the timeline and the
graphs follow.

The panel also draws the dashboard's own annotations on the timeline, from any
annotation query on any data source. Point annotations are diamond markers and
regions shade their span. An annotation tagged `source:<id>` pins to that
source's strip; the rest share a lane above the axis.

The panel follows Grafana's light and dark themes, including a live switch,
and scrubbing stays smooth with many sources.

### How a time range is drawn

The timeline doesn't fetch every frame in the range. Each source gets about
one slot per 7 pixels of panel width (about 190 on a full-width panel), and
the API returns one frame per slot.

- **The step is a whole number of uploads.** A source that uploads every
  minute shows one frame per minute at short ranges, and one in every N
  minutes at longer ones: 2 minutes over 6 hours, about 54 minutes over 7
  days. Turn on **Show cadence details** to see it, for example `⏱ 1m ·
  1/2m ↓`. Each era of a source gets its own step.
- **Each slot shows the frame nearest its time.** A slot with no frame is
  drawn as offline. When frames are thinned out, an outage shorter than one
  step can be hidden by a frame on either side of it, so zoom in to see
  short outages.
- **A slot shows a slice.** Each slot shows a vertical slice from the middle
  of its frame. Hover for the whole frame in the magnifier; click for the
  high-resolution frame, when the source uploads one.
- **Images load newest first.** Across all the sources in a panel, the
  thumbnails load from the live edge backwards, a few at a time, so on a
  slow connection the most recent frames appear first. Browsers keep the
  frames cached, so a dashboard refresh doesn't download them again.
- **The time axis matches Grafana's own time series panel:** the same tick
  spacing, steps and label formats.

Times follow the dashboard's time zone. A source can also say where it is,
with the `X-Timezone` upload header (an IANA name such as
`Australia/Sydney`). Its header then shows its city and how far its clock is
from the dashboard's, for example `Sydney · +3h`, and the **Thumbnail times**
option can show its frame times in its own local time.

## Try it with no backend

With **API URL** left empty, the panel renders built-in demo data: five
simulated sources across two sites, including an outage, a cadence change, a
declared pause, two sources in other time zones and some annotations. Add the
panel to a dashboard and it works immediately, with no infrastructure and no
account.

To see it on a ready-made dashboard instead, clone the
[repository](https://github.com/comebacktomorrow/visual-timeline) and run:

```bash
docker compose -f demo/docker-compose.yml up
# → http://localhost:3300/d/visual-timeline-demo  (anonymous admin)
```

The first run builds the plugin, so it takes a few minutes. The dashboard has
a timeline, two multiview grids and a time series panel to show the shared
crosshair, all on the built-in demo data. Port 3300 taken? Prefix the command
with `DEMO_PORT=3301`.

## Connect it to your own images

The panel talks to a small HTTP API (sources registry, frames by time window,
and the frame images). It isn't tied to any one backend. There are two ways to
connect it:

- **Through a Visual Timeline API data source (recommended, and the only
  way that keeps a viewer token secret).** In Grafana, go to
  **Connections → Data sources → Add new data source**, pick **Visual
  Timeline API**, enter the API URL and the viewer token, and click **Save &
  test**. Then pick that data source in the panel's **Data source** option.
  The token is stored encrypted, and Grafana's server adds it to the panel's
  API calls (`/sources`, `/frames`), so it never reaches the dashboard JSON
  or the viewer's browser.
- **Directly, for an API with open reads.** Set the panel's **API URL**
  option to the API's base URL. The browser then calls the API itself.

Either way, the panel needs a server that implements the API:

- The API contract, with curl examples, is in
  [docs/API.md](https://github.com/comebacktomorrow/visual-timeline/blob/main/docs/API.md).
  Anything that speaks it works: kiosk screens, security cameras, website
  thumbnailers, render farms.
- A reference backend is included in
  [`worker/`](https://github.com/comebacktomorrow/visual-timeline/tree/main/worker):
  a single-file Cloudflare Worker over R2, with cadence-aligned storage,
  immutable frame caching, per-site upload tokens, and private-by-default reads
  (viewer token plus signed, expiring image URLs). Its README covers running it
  locally with a simulated fleet, and deploying it to Cloudflare. To run it on
  your own hardware instead, see [Self-hosting](#self-hosting).
- Uploaders are simple: capture, POST a JPEG on the cadence grid, and on
  failure drop the frame and move on. See "Implementing your own uploader" in
  the API document.

Either way, the frame images load straight from the API into the viewer's
browser, never through Grafana, because an `<img>` tag can't carry a token.
So:

- With a data source, the API must be reachable from the Grafana server
  (for the API calls). The image URLs it returns must be reachable from the
  viewers' browsers. An API that requires a viewer token for reads must
  **sign its image URLs**, so each URL authorizes itself. The reference
  worker does this when `IMG_SIGN_KEY` is set. It builds image URLs from the
  address it was called on, so give the data source an API URL that browsers
  can reach as well.
- With the API URL option, the browser makes every call, so the API must be
  reachable from the viewers' machines and must allow cross-origin requests.
  The reference worker sends permissive CORS headers.

## Panel options

| Option                                  | What it does                                                                                                                                                                                               |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Data source**                         | A Visual Timeline API data source. API calls go through Grafana, which adds the viewer token. While one is set, the API URL option below is hidden and ignored.                                              |
| **API URL**                             | Base URL of the frames API, for an API with open reads. An API that needs a viewer token connects through a data source. With neither, the panel shows the built-in demo data.                                                                            |
| **Sites**                               | Site filter: a dashboard variable (default `${site:csv}`) or a literal site id. Keep the variable here so the panel refreshes when it changes. A dashboard without the variable shows all sites.           |
| **Display mode**                        | Timeline or Multiview grid.                                                                                                                                                                                |
| **Follow shared crosshair**             | Grid mode only. Show the frame at the crosshair time from other panels; off shows the most recent frame in range.                                                                                          |
| **Show annotations**                    | Timeline mode only. Draw the dashboard's annotations on the timeline (on by default).                                                                                                                      |
| **Annotation lanes**                    | Timeline mode, with annotations on. A single shared lane above the axis, or one lane per source carrying its own events plus the global ones.                                                              |
| **Hide sources with no data in window** | Omit sources with no frames in the current time range instead of showing them as offline.                                                                                                                  |
| **Tag filter**                          | Only show sources whose declared tags match all the given pairs, for example `env=prod, room=lobby`.                                                                                                       |
| **Show cadence details**                | Show each source's capture cadence and display resolution (for tuning).                                                                                                                                    |
| **Header**                              | Bar (a header row per source), Inline (hostname and details float over the image), or Inline with a gradient behind them for busy frames.                                                                  |
| **Thumbnail times**                     | Dashboard time, or Source local time: a source that declares a time zone shows its frame times in that zone, marked with the offset, e.g. `07:31:00 (+3h)`. The axis and crosshair stay in dashboard time. |
| **Image fit**                           | Fit letterboxes the whole frame; Fill crops to cover. Never stretches.                                                                                                                                     |

## About the viewer token

Keep the viewer token in a **Visual Timeline API data source**. The token is
stored encrypted in Grafana and is sent only by Grafana's server, as an
`Authorization: Bearer` header on the panel's calls to `/sources` and
`/frames`. The browser never receives it, and the dashboard JSON stores only
the data source's uid. Grafana's login is what controls who can view. For the
images to load, the API must sign its image URLs (see above).

The panel itself never holds a token. Its **API URL** option is only for an
API with open reads.

The
[API document](https://github.com/comebacktomorrow/visual-timeline/blob/main/docs/API.md)
has the details.

## Self-hosting

The whole stack also runs on your own hardware, from one Docker Compose file:
the reference backend (the same worker code, on workerd, Cloudflare's
open-source Workers runtime, with frames on a Docker volume) and a Grafana with
the plugin and a ready data source. Frames stay on your network, with no cloud
account. A small script uploads IP camera snapshots, so it suits a home lab
watching its cameras, kiosks or dashboards. See
[selfhost/README.md](https://github.com/comebacktomorrow/visual-timeline/blob/main/selfhost/README.md).

## Without Grafana: the standalone viewer

The reference worker also serves the timeline as two plain web pages: a
standalone app (`app.html`) with its own site filter, time-range picker and
timeline/grid modes, and an embeddable timeline (`index.html`) for an iframe.
Their state lives in the URL, and they accept Grafana's dashboard-link
parameters, so a dashboard link can open the viewer on the same sites and time
range. That's useful where the plugin can't be installed. The URL parameters
are in
[docs/VIEWER.md](https://github.com/comebacktomorrow/visual-timeline/blob/main/docs/VIEWER.md).

## Requirements

- Grafana 10.4.0 or later (`>=10.4.0`).
- The app must stay enabled. It is enabled on install. Grafana treats an
  app's panel and data source as disabled while the app is disabled.
- For your own data: a server that implements the frames API (the included
  reference worker, or your own). See
  [Connect it to your own images](#connect-it-to-your-own-images) for what
  needs to reach it.

## Upgrading from the panel-only plugin

Earlier versions were a standalone panel plugin with the same panel id,
`savvycocoa1919-visualtimeline-panel`. The app ships that panel under the same
id, so existing dashboards keep working without changes. Uninstall the old
panel plugin when you install the app, so that only one copy of the panel id
is installed.

The panel's **API key** option has been removed: it saved the viewer token in
plain text in the dashboard JSON. A panel that used it now shows "The frames
API needs a valid viewer token (401)" with a pointer to the data source.
To move it over:

1. Add a **Visual Timeline API** data source with the API URL and the viewer
   token (**Connections → Data sources**), and check it with **Save & test**.
2. In each panel that used the key, pick that data source in the **Data
   source** option and save the dashboard.
3. Revoke the old token at the API: it has been readable by everyone who
   could view or export those dashboards.

## Contributing

Bug reports and feature requests are welcome as
[GitHub issues](https://github.com/comebacktomorrow/visual-timeline/issues),
and so are pull requests. Repository layout, local development, testing and
the release process are in
[CONTRIBUTING.md](https://github.com/comebacktomorrow/visual-timeline/blob/main/CONTRIBUTING.md).
See the
[changelog](https://github.com/comebacktomorrow/visual-timeline/blob/main/CHANGELOG.md)
for what has changed between versions.

## License

Apache-2.0. See
[LICENSE](https://github.com/comebacktomorrow/visual-timeline/blob/main/LICENSE).
