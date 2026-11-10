# Reading the reference worker through Infinity

Visual Timeline panels draw rows with a time, an image and a host from any
data source (README: "Frames from any data source"). To read the reference
worker (`worker/`), or any backend that speaks [its API](API.md), use the
[Infinity](https://grafana.com/grafana/plugins/yesoreyeram-infinity-datasource/)
data source. Grafana's server calls the worker with the viewer token, so the
token never reaches the dashboard JSON or the browser. The self-hosted stack
(`selfhost/`) is set up this way, and its dashboard is a working example.

## The data source

Add an **Infinity** data source:

- **Authentication:** Bearer token, with the worker's viewer token
  (`VIEWER_TOKEN`). Leave it off if the worker allows open reads.
- **Allowed hosts:** the worker's address, as Grafana's server reaches it, for
  example `https://frames.example.com`. Infinity sends the token only there.

Provisioned, that is:

```yaml
datasources:
  - name: Visual Timeline worker
    type: yesoreyeram-infinity-datasource
    uid: vt-worker
    jsonData:
      auth_method: bearerToken
      allowedHosts:
        - https://frames.example.com
    secureJsonData:
      bearerToken: ${VT_VIEWER_TOKEN}
```

The images load straight from the worker into the viewer's browser, never
through Grafana, so a worker that requires a viewer token must sign its image
URLs (`IMG_SIGN_KEY`), and the address it builds them on (the one Grafana
calls, or `PUBLIC_URL`) must be one the browsers can reach.

## The frames query

One query per panel, for every host of the selected sites. In a **Visual
Timeline** panel's Query tab, choose the Infinity data source and set:

| Setting | Value                                                                                                                                                                                      |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Type    | JSON                                                                                                                                                                                       |
| Parser  | Backend                                                                                                                                                                                    |
| Source  | URL                                                                                                                                                                                        |
| Format  | Table                                                                                                                                                                                      |
| Method  | GET                                                                                                                                                                                        |
| URL     | `https://frames.example.com/frames?site=${site:csv}&sources=${host:csv}&from=${__from}&to=${__to}&step=${__interval_ms}`                                                                   |
| Columns | `ts` as **time** (Timestamp, epoch ms); `source` as **host** (String); `site` as **site** (String); `url` as **image** (String); `url_hi` as **image_hi** (String), for the larger preview |

Without Site and Host variables, leave out `site=` and `sources=`: the worker
then answers for every source the token may read. The worker answers each
host at its own cadence or a multiple of it, and at most 800 frames per host,
whatever `${__interval_ms}` asks for ([API.md](API.md), "every source").

The same rows feed a stock **Table** panel (set the image column's cell type
to **Image**), so a table of frames needs nothing else.

## Site and Host variables

Two **Query** variables on the Infinity data source, each with the query type
**Infinity**, Type JSON, Parser Backend, Source URL, and one column:

| Variable | URL                                                   | Column                      |
| -------- | ----------------------------------------------------- | --------------------------- |
| `site`   | `https://frames.example.com/sources`                  | `site` as **site** (String) |
| `host`   | `https://frames.example.com/sources?site=${site:csv}` | `id` as **id** (String)     |

Turn on **Multi-value** and **Include All option**, with the custom all value
`All`, which the worker reads as "every one".

### Which sites a viewer can see

The Site variable is a filter, not access control. Grafana fills in variables
(and `${__user.login}`) in the browser before it sends a query, so any viewer
who can open a dashboard can send the same data source a query of their own,
for any site. A worker URL such as `/sources?user=${__user.login}` can show
each person their own sites by default, but it can't stop them asking for
others.

To keep sites apart, give each group of viewers its own credentials:

- **One Grafana organization per customer** (or group of sites), each with its
  own Infinity data source and its own worker viewer token, limited to those
  sites (`VIEWER_TOKEN`'s named consumers with `sites`:
  [API.md](API.md)). Works in every edition of Grafana.
- **Data source permissions** (Grafana Enterprise and Grafana Cloud): one
  data source per group, each queryable only by its team.

## Pauses

A host that declares a pause (a screen asleep, quiet hours) sends no frames
while it lasts. To draw that as a pause rather than as offline, add a second
query to the panel, for the worker's `/states`, which answers each host's
pauses as state rows:

| Setting | Value                                                                                                                               |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| URL     | `https://frames.example.com/states?site=${site:csv}&sources=${host:csv}&to=${__to}`                                                 |
| Columns | `time` as **time** (Timestamp, epoch ms); `site` as **site** (String); `source` as **host** (String); `state` as **state** (String) |

Then, in the panel's **Overrides**, add **Fields with name** `state` with two
properties:

- **Pauses frames:** on. While a state lasts, the host's missing frames are
  explained by it instead of drawn as offline.
- **Value mappings:** a label and colour for each state. The worker's states
  are a pause's reason (`quiet`, `screen-sleep`, `system-down`, `app-stopped`,
  `expired` for frames past retention, `paused` without a reason), with
  `:unexpected` added when nobody intended it, and an empty state where a pause
  ends. The self-hosted dashboard (`selfhost/grafana/dashboards/visual-timeline.json`)
  has a full set to copy; Grafana draws an unmapped state as its own text.

Any data source's states work the same way: rows with a time, a host and a
state field. Map a state to the colour **Transparent** to draw nothing (the
normal state). Leave **Pauses frames** off for a state that runs alongside
the frames: it's drawn as a region annotation on the host's strip, labelled
and coloured by its mapping.

## Host details

A third, optional query for the worker's `/sources` is a **host table**: rows
naming each host with what the worker knows about it. The panel then shows
each host's own time zone, location and tags in its header, and draws hosts
that sent no frames in the window, instead of leaving them out.

| Setting | Value                                                                                                                                                                                            |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| URL     | `https://frames.example.com/sources?site=${site:csv}`                                                                                                                                            |
| Columns | `id` as **host** (String); `site` as **site** (String); `timezone` as **timezone** (String); `location` as **location** (String); `tags` as **tags** (String); `cadence` as **cadence** (Number) |

Any data source can be a host table: rows with a host (`host` or `id`) and any
of `timezone`, `location`, `tags` (an object, its JSON, or `k=v, k=v`) and
`cadence` (milliseconds), with no image or state. Frame rows can carry the
same fields themselves, and labels on the image field (Loki's or
Prometheus's, say) become tags.

## What it doesn't carry

There is no ad hoc filter bar (Infinity doesn't offer one); the Site and Host
variables filter instead.

## Limits

Without a frame index, the worker lists frames from R2 for every host in the
window, within a shared budget: 50 pages of 1000 frames per request, or about
25 hosts at one frame a minute over a day. Past it, the hosts it couldn't
finish draw as offline for the rest of the window (the worker names them in a
response header, which Infinity doesn't show). Narrow the window or the
hosts, or give the worker a frame index in D1, which has no such budget:
[worker/README.md](../worker/README.md), "Optional: a frame index in D1".
