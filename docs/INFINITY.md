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

## What it doesn't carry yet

The panel draws what the rows say: a host's frames, and gaps where it sent
none. What the worker's `/sources` adds about a host is not read from Infinity
yet, so for now:

- a declared pause (a screen asleep, quiet hours) draws as offline, and
  frames removed by retention draw as offline rather than "no data";
- a host's own time zone, tags and location aren't shown;
- there is no ad hoc filter bar (Infinity doesn't offer one); the Site and
  Host variables filter instead.

Host state from any data source (#126, M4) brings the pauses back.

## Limits

Without a frame index, the worker lists frames from R2 for every host in the
window, within a shared budget: 50 pages of 1000 frames per request, or about
25 hosts at one frame a minute over a day. Past it, the hosts it couldn't
finish draw as offline for the rest of the window (the worker names them in a
response header, which Infinity doesn't show). Narrow the window or the
hosts, or give the worker a frame index in D1, which has no such budget:
[worker/README.md](../worker/README.md), "Optional: a frame index in D1".
