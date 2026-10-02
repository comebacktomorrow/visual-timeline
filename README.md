# Visual Timeline

[![CI](https://github.com/comebacktomorrow/visual-timeline/actions/workflows/ci.yml/badge.svg)](https://github.com/comebacktomorrow/visual-timeline/actions/workflows/ci.yml)
[![Version](https://img.shields.io/github/package-json/v/comebacktomorrow/visual-timeline)](https://github.com/comebacktomorrow/visual-timeline/blob/main/CHANGELOG.md)
[![License](https://img.shields.io/github/license/comebacktomorrow/visual-timeline)](https://github.com/comebacktomorrow/visual-timeline/blob/main/LICENSE)

Scrub-able visual timeline and multiview for image feeds — kiosk screens,
security cameras, website thumbnails, anything that can post a JPEG on a
heartbeat. Hover to set a global time cursor across every source; gaps show
offline periods at their true temporal width; drag to zoom.

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

## Try it with no backend

With **API URL** left empty, the panel renders built-in demo data: five
simulated sources across two sites, including an outage, a cadence change, a
declared pause and some annotations. Add the panel to a dashboard and it works
immediately, with no infrastructure and no account.

## Connect it to your own images

The panel talks to a small HTTP API (sources registry, frames by time window,
and the frame images). It isn't tied to any one backend. Set the panel's
**API URL** option to the base URL of a server that implements the contract,
and set **API key** if that server requires a viewer token.

- The API contract, with curl examples, is in
  [docs/API.md](https://github.com/comebacktomorrow/visual-timeline/blob/main/docs/API.md).
  Anything that speaks it works: kiosk screens, security cameras, website
  thumbnailers, render farms.
- A reference backend is included in
  [`worker/`](https://github.com/comebacktomorrow/visual-timeline/tree/main/worker):
  a single-file Cloudflare Worker over R2, with cadence-aligned storage,
  immutable frame caching, per-site upload tokens, and private-by-default reads
  (viewer token plus signed, expiring image URLs). The API document also covers
  how to configure its read and write auth.
- Uploaders are simple: capture, POST a JPEG on the cadence grid, and on
  failure drop the frame and move on. See "Implementing your own uploader" in
  the API document.

The panel fetches from the browser, so the API must be reachable from the
machines viewing the dashboard (the reference worker sends permissive CORS
headers).

## Panel options

| Option                                  | What it does                                                                                                                                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **API URL**                             | Base URL of the frames API. Empty uses the built-in demo data.                                                                                                                                   |
| **API key**                             | Viewer token for the API, if it requires one. See [the viewer token](#about-the-viewer-token).                                                                                                   |
| **Sites**                               | Site filter: a dashboard variable (default `${site:csv}`) or a literal site id. Keep the variable here so the panel refreshes when it changes. A dashboard without the variable shows all sites. |
| **Display mode**                        | Timeline or Multiview grid.                                                                                                                                                                      |
| **Follow shared crosshair**             | Grid mode only. Show the frame at the crosshair time from other panels; off shows the most recent frame in range.                                                                                |
| **Show annotations**                    | Timeline mode only. Draw the dashboard's annotations on the timeline (on by default).                                                                                                            |
| **Annotation lanes**                    | Timeline mode, with annotations on. A single shared lane above the axis, or one lane per source carrying its own events plus the global ones.                                                    |
| **Hide sources with no data in window** | Omit sources with no frames in the current time range instead of showing them as offline.                                                                                                        |
| **Tag filter**                          | Only show sources whose declared tags match all the given pairs, for example `env=prod, room=lobby`.                                                                                             |
| **Show cadence details**                | Show each source's capture cadence and display resolution (for tuning).                                                                                                                          |
| **Header**                              | Bar (a header row per source), Inline (hostname and details float over the image), or Inline with a gradient behind them for busy frames.                                                        |
| **Image fit**                           | Fit letterboxes the whole frame; Fill crops to cover. Never stretches.                                                                                                                           |

## About the viewer token

Grafana panel plugins have no config page and no encrypted secret storage, so
the **API key** is a per-panel option saved in the dashboard JSON, in
plaintext. Anyone who can view the dashboard can see it (their browser needs
it to fetch the images). Today's practical posture:

- Use a **dedicated, scoped, revocable viewer token** per consumer (a
  dashboard, a wallboard), never your upload token. The reference worker
  supports named viewer tokens that can be limited to specific sites, so a
  leaked dashboard costs one revocable entry.
- Enable signed image URLs on the backend so the long-lived token never
  appears in image URLs; the panel only sends the key to the API's own origin
  and never to signed or third-party image URLs.
- Treat "can view this dashboard" as "holds this token".

A keyless design, where a companion datasource plugin keeps the key in
Grafana's encrypted storage, is planned but not built. The
[API document](https://github.com/comebacktomorrow/visual-timeline/blob/main/docs/API.md)
has the details.

## Requirements

- Grafana 10.4.0 or later (`>=10.4.0`).
- For your own data: a server that implements the frames API (the included
  reference worker, or your own), reachable from viewers' browsers.

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
