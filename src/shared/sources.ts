/* The source list as the data source answers a query and the panel reads it:
 * filtering (query fields, dashboard variables, ad hoc filters), the keys and
 * values offered to Grafana's ad hoc filter bar, and the data frame that
 * carries the list from the data source to the panel. Pure: no Grafana
 * runtime, so it is unit-tested directly. */
import { AdHocVariableFilter, createDataFrame, DataFrame, FieldType } from '@grafana/data';

import { matchesTags, parseTagFilter, parseVar } from '../vt/model/filters';
import type { HistoryEvent, SourceDecl } from '../vt/types';
import type { LastFrame } from './lastFrame';

/** Marks the frames a Visual Timeline data source returns: meta.custom[FRAME_MARKER]. */
export const FRAME_MARKER = 'visualTimeline';

/** What the panel needs to know about the data source that answered. */
export interface SourcesFrameMeta {
  /** The data source's uid, to fetch frames through it. */
  uid: string;
  /** Demo data: the panel draws the core's built-in demo frames. */
  demo: boolean;
}

/** Ad hoc filter keys that aren't tags. A tag with the same key is shadowed. */
export const SITE_KEY = 'site';
export const HOST_KEY = 'host';

export interface SourceFilter {
  /** Only these sites (null = all). */
  sites?: string[] | null;
  /** Only these hosts, i.e. source ids (null = all). */
  hosts?: string[] | null;
  /** "env=prod, room=lobby": every pair must match. */
  tags?: string | null;
  /** Grafana's ad hoc filters for this data source. */
  adhoc?: AdHocVariableFilter[];
}

/** A query field after variable interpolation, as a list: null means "all".
 * A variable the dashboard doesn't define stays literal ($site, ${site:csv});
 * that also means all, not a site named "${site:csv}". */
export function interpolatedList(value: string | undefined): string[] | null {
  if (!value || /\$[{a-zA-Z_]/.test(value)) {return null;}
  return parseVar(value);
}

/** A source's value for an ad hoc filter key. */
export function filterValue(source: SourceDecl, key: string): string {
  if (key === SITE_KEY) {return source.site;}
  if (key === HOST_KEY) {return source.id;}
  const v = source.tags ? source.tags[key] : undefined;
  return v == null ? '' : String(v);
}

/* Regex operators match the whole value, as Prometheus and Loki do. An
 * invalid pattern matches nothing (=~) and excludes nothing (!~). */
function wholeMatch(pattern: string, value: string): boolean | null {
  try {
    return new RegExp('^(?:' + pattern + ')$').test(value);
  } catch {
    return null;
  }
}

/** Whether a source passes one ad hoc filter. Operators this data source
 * doesn't support (< and >) pass everything. */
export function matchesAdhoc(source: SourceDecl, f: AdHocVariableFilter): boolean {
  const v = filterValue(source, f.key);
  switch (f.operator) {
    case '=':
      return v === f.value;
    case '!=':
      return v !== f.value;
    case '=~':
      return wholeMatch(f.value, v) === true;
    case '!~':
      return wholeMatch(f.value, v) !== true;
    case '=|':
      return (f.values || [f.value]).includes(v);
    case '!=|':
      return !(f.values || [f.value]).includes(v);
    default:
      return true;
  }
}

/** The sources that pass every part of the filter. */
export function applySourceFilter(sources: SourceDecl[], filter: SourceFilter): SourceDecl[] {
  const tags = parseTagFilter(filter.tags);
  return sources.filter(
    (s) =>
      (!filter.sites || filter.sites.includes(s.site)) &&
      (!filter.hosts || filter.hosts.includes(s.id)) &&
      matchesTags(s.tags, tags) &&
      (filter.adhoc || []).every((f) => matchesAdhoc(s, f))
  );
}

/** Keys for the ad hoc filter bar: site, host, then every tag key. */
export function tagKeys(sources: SourceDecl[]): string[] {
  const keys = new Set<string>();
  for (const s of sources) {
    for (const k of Object.keys(s.tags || {})) {
      if (k !== SITE_KEY && k !== HOST_KEY) {keys.add(k);}
    }
  }
  return [SITE_KEY, HOST_KEY, ...[...keys].sort()];
}

/** The values a key takes across these sources, sorted, without blanks. */
export function tagValues(sources: SourceDecl[], key: string): string[] {
  const values = new Set<string>();
  for (const s of sources) {
    const v = filterValue(s, key);
    if (v) {values.add(v);}
  }
  return [...values].sort();
}

/** The sources as one data frame, one row per source. With `last` (one
 * entry per source, the query asked for the last frame) it also carries each
 * host's last frame in the range: its image, already set to show as one in
 * a Table, its time, and the host's status at the range's end. */
export function sourcesToFrame(
  sources: SourceDecl[], refId: string, meta: SourcesFrameMeta, last?: Array<LastFrame | null>
): DataFrame {
  const lastFields = last
    ? [
        {
          name: 'image', type: FieldType.string, values: last.map((l) => l?.frame?.url ?? null),
          config: { displayName: 'Last frame', custom: { cellOptions: { type: 'image' } } },
        },
        {
          name: 'status', type: FieldType.string, values: last.map((l) => l?.status ?? null),
          config: { displayName: 'Status' },
        },
        {
          name: 'frameTime', type: FieldType.time, values: last.map((l) => l?.frame?.ts ?? null),
          config: { displayName: 'Frame time' },
        },
        {
          name: 'pauseReason', type: FieldType.string, values: last.map((l) => l?.reason ?? null),
          config: { displayName: 'Pause reason' },
        },
      ]
    : [];
  return createDataFrame({
    refId,
    meta: { custom: { [FRAME_MARKER]: meta } },
    fields: [
      { name: 'host', type: FieldType.string, values: sources.map((s) => s.id) },
      // with the last frame, a table reads host, image, status, time first
      ...lastFields,
      { name: 'site', type: FieldType.string, values: sources.map((s) => s.site) },
      { name: 'location', type: FieldType.string, values: sources.map((s) => s.location ?? '') },
      { name: 'timezone', type: FieldType.string, values: sources.map((s) => s.timezone ?? '') },
      { name: 'cadence', type: FieldType.number, values: sources.map((s) => s.cadence), config: { unit: 'ms' } },
      { name: 'hiCadence', type: FieldType.number, values: sources.map((s) => s.hiCadence ?? null), config: { unit: 'ms' } },
      { name: 'tags', type: FieldType.other, values: sources.map((s) => s.tags ?? {}) },
      // the panel's input, not something to read in a table. Grafana 12.0
      // and 12.1's Table hide a field on custom.hidden; later ones on
      // hideFrom.viz, ignoring hidden
      { name: 'history', type: FieldType.other, values: sources.map((s) => s.history ?? []), config: { custom: { hidden: true, hideFrom: { viz: true, legend: true, tooltip: true } } } },
    ],
  });
}

/** The sources and their data source, from a panel's query result: every
 * Visual Timeline frame, merged (a panel may have several queries), or null
 * when the result holds none. */
export function sourcesFromFrames(series: DataFrame[] | undefined): { sources: SourceDecl[]; meta: SourcesFrameMeta } | null {
  const ours = (series || []).filter((f) => f.meta?.custom?.[FRAME_MARKER]);
  if (!ours.length) {return null;}
  const seen = new Set<string>();
  const sources: SourceDecl[] = [];
  for (const frame of ours) {
    const col = (name: string) => frame.fields.find((f) => f.name === name)?.values;
    const host = col('host') || [];
    for (let i = 0; i < host.length; i++) {
      const at = (name: string) => col(name)?.[i];
      const id = String(host[i]);
      const site = String(at('site'));
      if (seen.has(site + '/' + id)) {continue;}
      seen.add(site + '/' + id);
      const s: SourceDecl = { id, site, cadence: Number(at('cadence')) };
      if (at('location')) {s.location = String(at('location'));}
      if (at('timezone')) {s.timezone = String(at('timezone'));}
      if (at('hiCadence') != null) {s.hiCadence = Number(at('hiCadence'));}
      const tags = at('tags') as Record<string, string> | undefined;
      if (tags && Object.keys(tags).length) {s.tags = tags;}
      s.history = (at('history') as HistoryEvent[] | undefined) || [];
      sources.push(s);
    }
  }
  return { sources, meta: ours[0].meta!.custom![FRAME_MARKER] as SourcesFrameMeta };
}
