# Visual Timeline

[![CI](https://github.com/comebacktomorrow/visual-timeline/actions/workflows/ci.yml/badge.svg)](https://github.com/comebacktomorrow/visual-timeline/actions/workflows/ci.yml)
[![Version](https://img.shields.io/github/package-json/v/comebacktomorrow/visual-timeline)](https://github.com/comebacktomorrow/visual-timeline/blob/main/CHANGELOG.md)
[![License](https://img.shields.io/github/license/comebacktomorrow/visual-timeline)](https://github.com/comebacktomorrow/visual-timeline/blob/main/LICENSE)

Scrub-able visual timeline and multiview for image feeds — kiosk screens,
security cameras, website thumbnails, anything that can post a JPEG on a
heartbeat. Hover to set a global time cursor across every host; gaps show
offline periods at their true temporal width; drag to zoom.

The plugin is a Grafana app that installs two plugins:

- the **Visual Timeline panel**, which draws the timeline and the multiview
  grid;
- the **Visual Timeline API data source**, which connects to your frames API.
  It keeps the API's URL and viewer token in Grafana's server-side settings,
  answers each panel's query with the list of hosts, and supplies the
  Site and Host dashboard variables and the ad hoc filter bar. Its **Demo
  data** switch runs everything on built-in demo data instead.

The app is enabled on install and has no pages of its own.

![Visual Timeline panels on a Grafana dashboard: a timeline and multiview grids](https://raw.githubusercontent.com/comebacktomorrow/visual-timeline/main/src/img/screenshot-dashboard.png)

## What it shows

Every host declares how often it promises a frame (its _cadence_).
The panel treats that promise as a heartbeat, so the _absence_ of a frame
carries meaning:

- **Offline gaps at their true width.** A missing frame is drawn as a hatched
  gap on the timeline, as wide as the outage really was, and as an offline
  tile in the multiview. Hosts drop failed frames rather than queueing them:
  the gap **is** the signal.
- **Eras.** When a host changes its cadence (slowing down for quiet hours,
  say), the timeline renders each era on its own grid, so a slow stretch isn't
  a wall of false gaps.
- **Declared pauses.** A host that goes quiet on purpose says so before it
  stops, and the pause shows as neutral silence. A host that crashes without
  saying anything still renders as offline.
- **The pending slot.** When a frame's expected time has passed but it hasn't
  arrived yet, the slot shows the last known frame as a pulsing ghost rather
  than a fault. A missed heartbeat still turns red on schedule.

Two display modes:

- **Timeline** — one strip per host along a shared time axis. Hover to scrub;
  drag to zoom, which sets the dashboard's time range.
- **Multiview grid** — one tile per host, showing the frame at the shared
  crosshair time (or just the latest frame in range).

The crosshair is shared both ways with the other panels on the dashboard:
hover a graph and the timeline and grid follow, hover the timeline and the
graphs follow.

The panel also draws the dashboard's own annotations on the timeline, from any
annotation query on any data source. Point annotations are diamond markers and
regions shade their span. An annotation tagged `host:<id>` pins to that
host's strip; the rest share a lane above the axis.

The panel follows Grafana's light and dark themes, including a live switch,
and scrubbing stays smooth with many hosts.

### How a time range is drawn

The timeline doesn't fetch every frame in the range. Each host gets about
one slot per 7 pixels of panel width (about 190 on a full-width panel), and
the API returns one frame per slot.

- **The step is a whole number of uploads.** A host that uploads every
  minute shows one frame per minute at short ranges, and one in every N
  minutes at longer ones: 2 minutes over 6 hours, about 54 minutes over 7
  days. Turn on **Show cadence details** to see it, for example `⏱ 1m ·
1/2m ↓`. Each era of a host gets its own step.
- **Each slot shows the frame nearest its time.** A slot with no frame is
  drawn as offline. When frames are thinned out, an outage shorter than one
  step can be hidden by a frame on either side of it, so zoom in to see
  short outages.
- **A slot shows a slice.** Each slot shows a vertical slice from the middle
  of its frame. Hover for the whole frame in the magnifier; click for the
  high-resolution frame, when the host uploads one.
- **Images load newest first.** Across all the hosts in a panel, the
  thumbnails load from the live edge backwards, a few at a time, so on a
  slow connection the most recent frames appear first. Browsers keep the
  frames cached, so a dashboard refresh doesn't download them again.
- **The time axis matches Grafana's own time series panel:** the same tick
  spacing, steps and label formats.

Times follow the dashboard's time zone. A host can also say where it is,
with the `X-Timezone` upload header (an IANA name such as
`Australia/Sydney`). Its header then shows its city and how far its clock is
from the dashboard's, for example `Sydney · +3h`, and the **Thumbnail times**
option can show its frame times in its own local time.

## Try it with no backend

1. Add a **Visual Timeline API** data source (**Connections → Data sources →
   Add new data source**), turn on its **Demo data** switch and click **Save &
   test**.
2. On the data source's **Dashboards** tab, import the **Visual Timeline**
   dashboard: a timeline and two multiview grids, with Site and Host
   dropdowns and a filter bar.

The demo has five simulated hosts across two sites, including an outage, a
cadence change, a declared pause, two hosts in other time zones and some
annotations. No infrastructure and no account. To build your own dashboard
instead, add a **Visual Timeline** panel and choose the data source in its
**Query** tab. Turn **Demo data** off and set the API URL when you're ready for
your own frames.

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

## Filter by site, host and tag

Every host has an id, a site and optional `key=value` tags, and
panels can be filtered by any of them, the way Grafana filters Prometheus or
Loki data by label:

- **In a panel's Query tab:** **Sites**, **Hosts** and **Tags** fields. Each
  takes ids (`home, office`) or dashboard variables (`${site:csv}`); empty
  means all.
- **With dashboard variables:** add a **Query** variable on a Visual Timeline
  data source and choose **Sites** or **Hosts**. A Hosts variable can list
  only the hosts in some sites, for example `${site:csv}`, so Host follows
  Site. Use the variables in the panels' Query fields.
- **With the filter bar:** add an **Ad hoc filters** variable on the data
  source. Its keys are `site`, `host` and every tag key, each with a list of
  values, and the operators are `=`, `!=`, `=~` and `!~` (regular expressions
  match the whole value). Grafana also offers `<` and `>`, which this data
  source ignores.
- **By clicking:** click a host, site or tag in a host's header to add it to
  the dashboard's filter bar.

The **Visual Timeline** dashboard on the data source's Dashboards tab has the
Site and Host variables and the filter bar ready.

## Connect it to your own images

The panel reads a small HTTP API (the source registry, frames by time window,
and the frame images) through a Visual Timeline API data source. It isn't tied
to any one backend. In Grafana, go to **Connections → Data sources → Add new
data source**, pick **Visual Timeline API**, enter the API URL and, if the API
needs one, the viewer token, and click **Save & test**. Then choose that data
source in each panel's **Query** tab. The token is stored encrypted, and
Grafana's server adds it to the data source's API calls (`/sources`,
`/frames`), so it never reaches the dashboard JSON or the viewer's browser.

The data source needs a server that implements the API:

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
  your own hardware instead, see [Self-hosting](#self-hosting-experimental).
- Uploaders are simple: capture, POST a JPEG on the cadence grid, and on
  failure drop the frame and move on. See "Implementing your own uploader" in
  the API document.

The frame images load straight from the API into the viewer's browser, never
through Grafana, because an `<img>` tag can't carry a token. So the API must be
reachable from the Grafana server (for the API calls), and the image URLs it
returns must be reachable from the viewers' browsers. An API that requires a
viewer token for reads must **sign its image URLs**, so each URL authorizes
itself. The reference worker does this when `IMG_SIGN_KEY` is set. It builds
image URLs from the address it was called on (or from `PUBLIC_URL`), so give
the data source an API URL that browsers can reach as well.

## Panel options

Which hosts a panel shows is set in its Query tab (see
[Filter by site, host and tag](#filter-by-site-host-and-tag)). These options
set how it draws them.

| Option                      | What it does                                                                                                                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Display mode**            | Timeline or Multiview grid.                                                                                                                                                                            |
| **Follow shared crosshair** | Grid mode only. Show the frame at the crosshair time from other panels; off shows the most recent frame in range.                                                                                      |
| **Show annotations**        | Timeline mode only. Draw the dashboard's annotations on the timeline (on by default).                                                                                                                  |
| **Annotation lanes**        | Timeline mode, with annotations on. A single shared lane above the axis, or one lane per host carrying its own events plus the global ones.                                                            |
| **Hide hosts with no data** | Omit hosts with no frames in the current time range instead of showing them as offline.                                                                                                                |
| **Show cadence details**    | Show each host's capture cadence and display resolution (for tuning).                                                                                                                                  |
| **Header**                  | Bar (a header row per host), Inline (the header floats over the image), or Inline with a gradient behind them for busy frames.                                                                         |
| **Thumbnail times**         | Dashboard time, or Host local time: a host that declares a time zone shows its frame times in that zone, marked with the offset, e.g. `07:31:00 (+3h)`. The axis and crosshair stay in dashboard time. |
| **Image fit**               | Fit letterboxes the whole frame; Fill crops to cover. Never stretches.                                                                                                                                 |

## About the viewer token

Keep the viewer token in a **Visual Timeline API data source**. The token is
stored encrypted in Grafana and is sent only by Grafana's server, as an
`Authorization: Bearer` header on the data source's calls to `/sources` and
`/frames`. The browser never receives it, and the dashboard JSON stores only
the data source's uid. Grafana's login is what controls who can view. For the
images to load, the API must sign its image URLs (see above).

Panels never hold a token: they reach the API only through the data source.

The
[API document](https://github.com/comebacktomorrow/visual-timeline/blob/main/docs/API.md)
has the details.

## Self-hosting (experimental)

The whole stack also runs on your own hardware, from one Docker Compose file:
the reference backend (the same worker code, on workerd, Cloudflare's
open-source Workers runtime, with frames on a Docker volume) and a Grafana with
the plugin and a ready data source. Frames stay on your network, with no cloud
account. A small script uploads IP camera snapshots, so it suits a home lab
watching its cameras, kiosks or dashboards. It is experimental: it works,
but it may change between releases. See
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

- Grafana 12.0.0 or later (`>=12.0.0`).
- The app must stay enabled. It is enabled on install. Grafana treats an
  app's panel and data source as disabled while the app is disabled.
- For your own data: a server that implements the frames API (the included
  reference worker, or your own). See
  [Connect it to your own images](#connect-it-to-your-own-images) for what
  needs to reach it.

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
