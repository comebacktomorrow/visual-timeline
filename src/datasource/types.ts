import type { DataQuery } from '@grafana/schema';
import type { DataSourceJsonData } from '@grafana/data';

/** Non-secret settings: visible to anyone who can use the data source. */
export interface VisualTimelineOptions extends DataSourceJsonData {
  /** Frames API base URL, e.g. https://frames.example.com. Grafana's server
   * proxies to it; the browser loads the image URLs it returns directly. */
  apiUrl?: string;
}

/** Secret settings: encrypted by Grafana, never sent back to the browser.
 * The proxy route in plugin.json reads it server-side. */
export interface VisualTimelineSecureOptions {
  viewerToken?: string;
}

/** The panel talks to the API through the proxy; there are no queries. */
export type VisualTimelineQuery = DataQuery;
