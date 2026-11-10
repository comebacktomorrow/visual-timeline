import type { DataQuery } from '@grafana/schema';
import type { DataSourceJsonData } from '@grafana/data';

/** Settings, visible to anyone who can use the data source. */
export interface VisualTimelineOptions extends DataSourceJsonData {
  /** Demo data: queries answer with built-in demo hosts and their frames,
   * so the plugin can be tried with nothing else set up. */
  demo?: boolean;
  /** Where frames come from: the demo, or a web folder or public bucket
   * (#125). Unset: the demo when demo is on. */
  connection?: 'demo' | 'folder';
  /** HTTP folder: the folder's base URL as Grafana's server reaches it
   * (listings go through the data source's proxy route). */
  folderUrl?: string;
  /** HTTP folder: the base URL viewers' browsers load images from, when it
   * differs (an internal address for Grafana, a public one for browsers). */
  imageUrl?: string;
  /** HTTP folder: how the folder lists itself. */
  listing?: 'json' | 'html' | 's3';
  /** HTTP folder: where frames live, relative to the base (#125). */
  template?: string;
  /** HTTP folder: the time zone of the times in names (default UTC). */
  timezone?: string;
  /** HTTP folder: the {variant} values of the small images (strips, grids)
   * and the large ones (the click-in preview). Unset: every variant. */
  smallVariant?: string;
  largeVariant?: string;
}

/** Secret settings: encrypted by Grafana, never sent back to the browser.
 * The folder proxy route reads them server-side. */
export interface VisualTimelineSecureOptions {
  bearerToken?: string;
}

/** A panel query: which sources to show. Each field takes ids or dashboard
 * variables; empty means all. The answer is the source list (one row per
 * source) and the sources' frames as rows (time, host, site, image). */
export interface VisualTimelineQuery extends DataQuery {
  /** Site ids, comma-separated, or a variable such as ${site:csv}. */
  sites?: string;
  /** Host (source id) list, or a variable such as ${host:csv}. */
  hosts?: string;
  /** Tag pairs that must all match: "env=prod, room=lobby". */
  tags?: string;
  /** Also answer with each host's last frame in the time range (its image,
   * time and status), for a Table or Canvas panel. The timeline panels leave
   * it off. */
  lastFrame?: boolean;
  /** With lastFrame: a row per host (table, the default), or one row with
   * fields named by host (host: `<id>`, `<id> status`, `<id> time`, …), which
   * a Canvas element or a Stat panel binds to by name. */
  lastFrameFormat?: 'table' | 'host';
  /** An annotation query: the data source's events (Demo data's demo events)
   * as dashboard annotations. */
  kind?: 'annotations';
}

/** A dashboard variable query: the sites, or the hosts (optionally only
 * those in some sites, e.g. ${site:csv}, so Host can follow Site). */
export interface VisualTimelineVariableQuery extends DataQuery {
  type: 'sites' | 'hosts';
  sites?: string;
}
