import type { DataQuery } from '@grafana/schema';
import type { DataSourceJsonData } from '@grafana/data';

/** Non-secret settings: visible to anyone who can use the data source. */
export interface VisualTimelineOptions extends DataSourceJsonData {
  /** Frames API base URL, e.g. https://frames.example.com. Grafana's server
   * proxies to it; the browser loads the image URLs it returns directly. */
  apiUrl?: string;
  /** Demo data: queries answer with built-in demo sources and panels draw
   * built-in demo frames, so the plugin can be tried without an API. The API
   * URL and token are then ignored. */
  demo?: boolean;
}

/** Secret settings: encrypted by Grafana, never sent back to the browser.
 * The proxy route in plugin.json reads it server-side. */
export interface VisualTimelineSecureOptions {
  viewerToken?: string;
}

/** A panel query: which sources to show. Each field takes ids or dashboard
 * variables; empty means all. The answer is the source list (one row per
 * source); the panel fetches each source's frames itself. */
export interface VisualTimelineQuery extends DataQuery {
  /** Site ids, comma-separated, or a variable such as ${site:csv}. */
  sites?: string;
  /** Host (source id) list, or a variable such as ${host:csv}. */
  hosts?: string;
  /** Tag pairs that must all match: "env=prod, room=lobby". */
  tags?: string;
  /** Also answer with each host's last frame in the time range (its image,
   * time and status), for a Table or Canvas panel. Costs a /frames call or
   * two per host, so the timeline panels leave it off. */
  lastFrame?: boolean;
  /** With lastFrame: a row per host (table, the default), or one row with
   * fields named by host (host: `<id>`, `<id> status`, `<id> time`, …), which
   * a Canvas element or a Stat panel binds to by name. */
  lastFrameFormat?: 'table' | 'host';
}

/** A dashboard variable query: the sites, or the hosts (optionally only
 * those in some sites, e.g. ${site:csv}, so Host can follow Site). */
export interface VisualTimelineVariableQuery extends DataQuery {
  type: 'sites' | 'hosts';
  sites?: string;
}
