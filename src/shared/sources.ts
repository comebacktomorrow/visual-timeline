/* The source list as the data source answers a query and the panel reads it:
 * filtering (query fields, dashboard variables, ad hoc filters), the keys and
 * values offered to Grafana's ad hoc filter bar, and the data frame that
 * carries the list from the data source to the panel. Pure: no Grafana
 * runtime, so it is unit-tested directly. */
import { AdHocVariableFilter, createDataFrame, DataFrame, FieldConfig, FieldType, MappingType, ValueMapping } from '@grafana/data';

import { matchesTags, parseTagFilter, parseVar } from '../vt/model/filters';
import { labelPauses } from '../vt/backends/reasons';
import type { HistoryEvent, RawAnnotation, SourceDecl } from '../vt/types';
import type { ApiSourceDecl } from '../vt/backends/api';
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

/* A host's status, coloured wherever it's shown (a Table's coloured text, a
 * Canvas element's colour, a Stat panel): live green, offline red, paused
 * blue, as the timeline draws them. */
const STATUS_CONFIG: FieldConfig = {
  mappings: [{
    type: MappingType.ValueToText,
    options: {
      live: { color: 'green', index: 0 },
      offline: { color: 'red', index: 1 },
      paused: { color: 'blue', index: 2 },
    },
  }],
};
const IMAGE_CELL = { cellOptions: { type: 'image' } };

/** The sources as one data frame, one row per source. With `last` (one
 * entry per source, the query asked for the last frame) it also carries each
 * host's last frame in the range: its image, already set to show as one in
 * a Table, its time, and the host's status at the range's end. */
export function sourcesToFrame(
  sources: ApiSourceDecl[], refId: string, meta: SourcesFrameMeta, last?: Array<LastFrame | null>
): DataFrame {
  const lastFields = last
    ? [
        {
          name: 'image', type: FieldType.string, values: last.map((l) => l?.frame?.url ?? null),
          config: { displayName: 'Last frame', custom: IMAGE_CELL },
        },
        {
          name: 'status', type: FieldType.string, values: last.map((l) => l?.status ?? null),
          config: { ...STATUS_CONFIG, displayName: 'Status' },
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

/** Each host's last frame as one row with fields named by host: `<id>` (the
 * image), `<id> status`, `<id> time` and `<id> pause reason`. A Canvas
 * element binds to a field by name and shows its value, so each element can
 * take its host's image, status (with colour) and time with no
 * transformation. A host id that more than one site uses is named
 * `<site>/<id>`. Not marked as a source list: Visual Timeline panels don't
 * read it. */
export function lastFramesByHost(sources: SourceDecl[], last: Array<LastFrame | null>, refId: string): DataFrame {
  const count = new Map<string, number>();
  for (const s of sources) {count.set(s.id, (count.get(s.id) || 0) + 1);}
  const fields = sources.flatMap((s, i) => {
    const name = (count.get(s.id) || 0) > 1 ? s.site + '/' + s.id : s.id;
    const l = last[i];
    return [
      { name, type: FieldType.string, values: [l?.frame?.url ?? null], config: { custom: IMAGE_CELL } },
      { name: name + ' status', type: FieldType.string, values: [l?.status ?? null], config: STATUS_CONFIG },
      { name: name + ' time', type: FieldType.time, values: [l?.frame?.ts ?? null] },
      { name: name + ' pause reason', type: FieldType.string, values: [l?.reason ?? null] },
    ];
  });
  return createDataFrame({ refId, fields });
}

/** Frame records as rows the panel reads like any source's (#126): one row
 * per frame, with its time, host, site and image locator. */
export function recordsToFrame(rows: Array<{ ts: number; host: string; site: string; url: string }>, refId: string): DataFrame {
  return createDataFrame({
    refId,
    name: 'frames',
    fields: [
      { name: 'time', type: FieldType.time, values: rows.map((r) => r.ts) },
      { name: 'host', type: FieldType.string, values: rows.map((r) => r.host) },
      { name: 'site', type: FieldType.string, values: rows.map((r) => r.site) },
      { name: 'image', type: FieldType.string, values: rows.map((r) => r.url) },
    ],
  });
}

/* How our own pause states look: value mappings like any state query's
 * (#126, M4), in the colours the core used for these reasons before. A
 * dashboard can override them like any mapping. */
export const PAUSE_STATE_MAPPINGS: ValueMapping[] = [
  {
    type: MappingType.ValueToText,
    options: {
      paused: { text: 'PAUSED', index: 0 },
      quiet: { text: 'QUIET HOURS', index: 1 },
      'screen-sleep': { text: 'SCREEN ASLEEP', color: 'blue', index: 2 },
      'screen-sleep:unexpected': { text: 'SCREEN DARK (UNEXPECTED)', color: 'orange', index: 3 },
      'system-down': { text: 'SYSTEM DOWN (PLANNED)', color: 'purple', index: 4 },
      'app-stopped': { text: 'APP STOPPED', color: '#2ba08c', index: 5 },
      expired: { text: 'NO DATA', index: 6 },
    },
  },
  // any other reason nobody asked for: amber, as before
  { type: MappingType.RegexToText, options: { pattern: '^(.*):unexpected$', result: { text: '$1 (UNEXPECTED)', color: 'orange', index: 7 } } },
];

/** Each source's declared pauses as a state query's answer (#126, M4): a
 * row when a pause starts (its reason, ":unexpected" when nobody intended
 * it) and an empty one when it ends. The state field is set to pause frames,
 * so the panel draws these as it drew declared pauses. */
export function pauseStatesToFrame(sources: SourceDecl[], refId: string): DataFrame {
  const rows: Array<{ ts: number; host: string; site: string; state: string }> = [];
  for (const s of sources) {
    let paused = false;
    for (const h of [...(s.history || [])].filter((e) => (e.variant || 'lo') === 'lo').sort((a, b) => a.since - b.since)) {
      if (h.paused) {
        rows.push({ ts: h.since, host: s.id, site: s.site, state: (h.reason || 'paused') + (h.intended === false ? ':unexpected' : '') });
        paused = true;
      } else if (paused) {
        rows.push({ ts: h.since, host: s.id, site: s.site, state: '' });
        paused = false;
      }
    }
  }
  return createDataFrame({
    refId,
    name: 'states',
    fields: [
      { name: 'time', type: FieldType.time, values: rows.map((r) => r.ts) },
      { name: 'host', type: FieldType.string, values: rows.map((r) => r.host) },
      { name: 'site', type: FieldType.string, values: rows.map((r) => r.site) },
      { name: 'state', type: FieldType.string, values: rows.map((r) => r.state),
        config: { mappings: PAUSE_STATE_MAPPINGS, custom: { pausesFrames: true } } },
    ],
  });
}

/** Events as an annotation query's answer: Grafana maps time, timeEnd,
 * title, text and tags by name. */
export function annotationsToFrame(events: RawAnnotation[], refId: string): DataFrame {
  const time = (a: RawAnnotation) => Number(a.ts ?? a.time);
  const tags = (a: RawAnnotation) => (Array.isArray(a.tags) ? a.tags.map(String) : a.tags ? String(a.tags).split(',').map((t) => t.trim()) : []);
  return createDataFrame({
    refId,
    fields: [
      { name: 'time', type: FieldType.time, values: events.map(time) },
      { name: 'timeEnd', type: FieldType.time, values: events.map((a) => (a.timeEnd != null ? Number(a.timeEnd) : null)) },
      { name: 'title', type: FieldType.string, values: events.map((a) => a.title ?? '') },
      { name: 'text', type: FieldType.string, values: events.map((a) => a.text ?? '') },
      { name: 'tags', type: FieldType.other, values: events.map(tags) },
      { name: 'color', type: FieldType.string, values: events.map((a) => a.color ?? '') },
    ],
  });
}

/** The sources and their data source, from a panel's query result: every
 * Visual Timeline frame, merged (a panel may have several queries), or null
 * when the result holds none. */
export function sourcesFromFrames(series: DataFrame[] | undefined): { sources: ApiSourceDecl[]; meta: SourcesFrameMeta } | null {
  const ours = (series || []).filter((f) => f.meta?.custom?.[FRAME_MARKER]);
  if (!ours.length) {return null;}
  const seen = new Set<string>();
  const sources: ApiSourceDecl[] = [];
  for (const frame of ours) {
    const col = (name: string) => frame.fields.find((f) => f.name === name)?.values;
    const host = col('host') || [];
    for (let i = 0; i < host.length; i++) {
      const at = (name: string) => col(name)?.[i];
      const id = String(host[i]);
      const site = String(at('site'));
      if (seen.has(site + '/' + id)) {continue;}
      seen.add(site + '/' + id);
      const s: ApiSourceDecl = { id, site, cadence: Number(at('cadence')) };
      if (at('location')) {s.location = String(at('location'));}
      if (at('timezone')) {s.timezone = String(at('timezone'));}
      if (at('hiCadence') != null) {s.hiCadence = Number(at('hiCadence'));}
      const tags = at('tags') as Record<string, string> | undefined;
      if (tags && Object.keys(tags).length) {s.tags = tags;}
      s.history = (at('history') as HistoryEvent[] | undefined) || [];
      sources.push(labelPauses(s));
    }
  }
  return { sources, meta: ours[0].meta!.custom![FRAME_MARKER] as SourcesFrameMeta };
}
