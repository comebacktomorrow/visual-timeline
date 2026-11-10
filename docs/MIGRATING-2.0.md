# Moving 1.x dashboards to 2.0

Visual Timeline 2.0 panels read frames from any data source: rows with a time,
an image and a host. The Visual Timeline data source's **API mode** (an API
URL and a viewer token, read through a proxy route) is gone; the data source
now offers Demo data, with folder and bucket listings to follow (#125).

Dashboards whose panels query a 1.x **Visual Timeline API** data source
(an API URL set, Demo data off) need moving. Dashboards on Demo data keep
working as they are.

## Reading the reference worker

1. Install the
   [Infinity](https://grafana.com/grafana/plugins/yesoreyeram-infinity-datasource/)
   data source and add one for the worker, with the same viewer token the
   1.x data source held: [INFINITY.md](INFINITY.md), "The data source".
2. In each Visual Timeline panel, switch the query to the Infinity data
   source with the frames query from INFINITY.md, "The frames query".
3. Replace the Site and Host variables with the Infinity ones from
   INFINITY.md, "Site and Host variables". Keep their names (`site`, `host`)
   and the panels' queries pick them up.
4. Remove the ad hoc filter bar's variable: Infinity doesn't offer one.
5. A Table or Canvas panel that used **Last frame** reads the same frames
   query. It returns every frame, so add Grafana's **Group by**
   transformation (group by host; time and image calculated as Last) to keep
   each host's latest.
6. Once nothing uses it, delete the old Visual Timeline API data source.

The worker itself needs no change beyond deploying a version with the
every-source `/frames` (2.0's): uploaders, tokens, signing and the standalone
viewer stay as they were. On 1.x workers, `/frames` without `source=` is a 400.

## Pauses and host details

Declared pauses come back through a second Infinity query, for the worker's
`/states`, with a field override (INFINITY.md, "Pauses"), and each host's
time zone, location and tags through a third, for `/sources` (INFINITY.md,
"Host details"). The ad hoc filter bar doesn't carry over: Infinity doesn't
offer one.

## The self-hosted stack

`selfhost/` provisions Infinity and a Visual Timeline worker data source
itself, removes the 1.x data source, and replaces the starter dashboard.
Pull, then `docker compose -f selfhost/docker-compose.yml up -d --build`.
Frames are kept. A copy of the old dashboard saved under another name stays
on the removed data source; move its panels as above.
