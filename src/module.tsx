import { AppPlugin } from '@grafana/data';

/* The app is only the package: it has no pages of its own. What it ships
 * are its nested plugins, each with its own plugin.json and module:
 *   panel/       the Visual Timeline panel (id savvycocoa1919-visualtimeline-panel,
 *                unchanged, so existing dashboards keep resolving it)
 *   datasource/  the Visual Timeline data source: frames from a web folder or
 *                a public bucket (#125), or demo hosts and frames; the Site and
 *                Host variables and the ad hoc filter bar (the panel itself
 *                reads frames from any data source, #126)
 * Grafana only enables an app's nested plugins while the app is enabled;
 * plugin.json sets autoEnabled so they work straight after install. */
export const plugin = new AppPlugin<{}>();
