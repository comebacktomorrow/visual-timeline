import { AppPlugin } from '@grafana/data';

/* The app is only the package: it has no pages of its own. What it ships
 * are its nested plugins, each with its own plugin.json and module:
 *   panel/       the Visual Timeline panel (id savvycocoa1919-visualtimeline-panel,
 *                unchanged, so existing dashboards keep resolving it)
 *   datasource/  the Visual Timeline API data source, which holds the API URL
 *                and the viewer token server-side and proxies /sources and
 *                /frames through Grafana
 * Grafana only enables an app's nested plugins while the app is enabled;
 * plugin.json sets autoEnabled so they work straight after install. */
export const plugin = new AppPlugin<{}>();
