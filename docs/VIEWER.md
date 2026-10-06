# Standalone viewer and embed

The same timeline is available outside Grafana, as two web pages in
[`web/`](../web). The [reference Worker](../worker/README.md) serves them
from its own origin, and they call the API on that origin:

- **`app.html`, the standalone app**, has the controls Grafana normally
  provides: a site filter, timeline/grid/both modes, fit/fill, a
  Grafana-style time-range picker, drag-to-zoom, and cursor sync within the
  page (hover the timeline and the grid follows). A range that ends at now
  ("Last 1 hour") follows the clock, with a LIVE/PAUSED toggle. Its whole
  state is in the URL, so a view is a shareable link.
- **`index.html`, the embeddable viewer**, is a bare timeline for an iframe.

Both accept Grafana's dashboard-link parameters (`var-site`, `from`, `to`), so
a Grafana dashboard link can open the viewer on the dashboard's sites and time
range. That's useful where the plugin can't be installed.

With no backend at all, `web/app.html?backend=mock` renders the built-in demo
data.

## URL parameters

`index.html` takes the same parameters as `app.html` where they apply. It
always shows the timeline.

| Parameter                                        | App | Embed | Meaning                                                                                                              |
| ------------------------------------------------ | --- | ----- | -------------------------------------------------------------------------------------------------------------------- |
| `site` (or Grafana-style `var-site`, repeatable) | ✓   | ✓     | sites to show; comma-separated or repeated                                                                           |
| `source` (alias `kiosk`, or `var-kiosk`)         |     | ✓     | sources to show                                                                                                      |
| `from`, `to`                                     | ✓   | ✓     | the window: epoch ms or Grafana-style relative times (`now-6h`, `now`). Default: the last hour                       |
| `mode`                                           | ✓   |       | `timeline`, `grid` or `both` (default)                                                                               |
| `fit`                                            | ✓   | ✓     | `fit` (default, letterbox) or `fill` (crop)                                                                          |
| `header`                                         | ✓   | ✓     | `bar` (default), `inline` or `inline-gradient`                                                                       |
| `tags`                                           | ✓   | ✓     | tag filter, e.g. `env=prod,room=lobby`                                                                               |
| `hideEmpty`                                      | ✓   | ✓     | `1` hides sources with no frames in the window                                                                       |
| `annLanes`                                       | ✓   | ✓     | `shared` (default) or `per-source`                                                                                   |
| `tz`                                             | ✓   | ✓     | show every time in this zone: an IANA name or `utc`. Default: the browser's zone                                     |
| `thumbs`                                         | ✓   | ✓     | `source` shows a source's own times in its declared zone (see `X-Timezone` in [API.md](API.md))                      |
| `k`                                              | ✓   | ✓     | viewer key, for an API with read auth. It ends up in browser history, so prefer signed image URLs and a scoped token |
| `backend`                                        | ✓   | ✓     | `mock` uses the built-in demo data instead of an API                                                                 |

## The viewer token in a link

An API with read auth needs the viewer token, and these pages can only take
it from the URL (`k`). Anyone who has the link has the token, and it stays in
browser history. So:

- Give each link its own named viewer token, scoped to the sites it shows
  (see "Read auth" in [API.md](API.md)), so one leaked link costs one
  revocable entry.
- Turn on signed image URLs (`IMG_SIGN_KEY`), so the token isn't repeated in
  every image URL.
- Inside Grafana, use the panel with a Visual Timeline API data source
  instead: the token then never reaches the browser.
