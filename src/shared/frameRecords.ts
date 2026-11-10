/* Frame records from any query: rows with a time, an image locator and a
 * host (#126). The panel reads them from whatever data source answered,
 * groups them into one strip per host, and hands the core a Backend that
 * answers from those rows, so the core itself doesn't change. Pure apart
 * from Grafana's field helpers, so it is unit-tested directly.
 *
 * The panel never knows about storage: an image locator is whatever string
 * the source returned (a public or signed URL, a data: URL) or Base64 image
 * data, and nothing here signs, rewrites or authenticates anything. */
import { DataFrame, Field, FieldType, getFieldDisplayName } from '@grafana/data';

import type { Backend, Frame, SourceDecl } from '../vt/types';

/** Which field plays which role. Empty means "find it by the usual names". */
export interface FieldRoles {
  time?: string;
  image?: string;
  host?: string;
  site?: string;
  preview?: string;
  cadence?: string;
}

/** One host's frames, sorted by time, one per timestamp. */
export interface HostRecords {
  id: string;
  site: string;
  frames: Frame[];
  /** From a cadence field (ms), else the median gap between frames. */
  cadence: number;
}

/* The usual names for each role, matched without regard to case. */
const NAMES = {
  time: ['time', 'timestamp', 'ts', 'datetime', 'date'],
  image: ['image', 'url', 'image_url', 'imageurl', 'src', 'frame', 'snapshot'],
  host: ['host', 'source', 'camera', 'kiosk', 'device'],
  site: ['site'],
  preview: ['image_hi', 'url_hi', 'preview', 'preview_url', 'image_large'],
  cadence: ['cadence', 'cadence_ms'],
};

/** Without a cadence field and with fewer than two frames, a host's cadence. */
export const DEFAULT_CADENCE = 60_000;

function fieldNamed(frame: DataFrame, wanted: string | undefined, defaults: string[]): Field | undefined {
  const names = wanted ? [wanted.toLowerCase()] : defaults;
  for (const n of names) {
    const f = frame.fields.find(
      (x) => x.name.toLowerCase() === n || getFieldDisplayName(x, frame).toLowerCase() === n
    );
    if (f) {return f;}
  }
  return undefined;
}

function timeField(frame: DataFrame, wanted?: string): Field | undefined {
  if (wanted) {return fieldNamed(frame, wanted, []);}
  return frame.fields.find((f) => f.type === FieldType.time) ?? fieldNamed(frame, undefined, NAMES.time);
}

function toMillis(v: unknown): number | null {
  if (typeof v === 'number') {return Number.isFinite(v) ? v : null;}
  if (typeof v === 'string' && v) {
    const n = Number(v);
    if (Number.isFinite(n)) {return n;}
    const d = Date.parse(v);
    return Number.isFinite(d) ? d : null;
  }
  if (v instanceof Date) {return v.getTime();}
  return null;
}

/* Base64 image data starts with its format's magic bytes, encoded. */
const BASE64_TYPES: Array<[string, string]> = [
  ['/9j/', 'image/jpeg'],
  ['iVBOR', 'image/png'],
  ['R0lGOD', 'image/gif'],
  ['UklGR', 'image/webp'],
  ['PHN2Z', 'image/svg+xml'],
  ['PD94b', 'image/svg+xml'],
];

/** A value as something an <img> can load: URLs and data: URLs as they are,
 * bare Base64 image data as a data: URL. */
export function imageLocator(v: unknown): string | null {
  if (typeof v !== 'string') {return null;}
  const s = v.trim();
  if (!s) {return null;}
  if (/^(https?:|data:|blob:)/i.test(s)) {return s;}
  // checked before paths: JPEG data starts "/9j/", which looks like one
  const type = BASE64_TYPES.find(([magic]) => s.startsWith(magic));
  if (type && s.length >= 16 && /^[A-Za-z0-9+/=\s]+$/.test(s.slice(0, 256))) {
    return `data:${type[1]};base64,${s.replace(/\s+/g, '')}`;
  }
  return s; // a path, a relative URL or anything else: the browser decides
}

/** A host's cadence from its frames: the median gap, in whole seconds. */
export function inferCadence(ts: number[]): number {
  if (ts.length < 2) {return DEFAULT_CADENCE;}
  const gaps: number[] = [];
  for (let i = 1; i < ts.length; i++) {
    const g = ts[i] - ts[i - 1];
    if (g > 0) {gaps.push(g);}
  }
  if (!gaps.length) {return DEFAULT_CADENCE;}
  gaps.sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  return Math.max(1000, Math.round(median / 1000) * 1000);
}

/** The frame records in a query result, one entry per host, or null when no
 * frame in it has an image field. */
export function recordsFromSeries(series: DataFrame[] | undefined, roles: FieldRoles = {}): HostRecords[] | null {
  const byHost = new Map<string, { id: string; site: string; frames: Map<number, Frame>; cadence?: number }>();
  let found = false;
  for (const frame of series || []) {
    const image = fieldNamed(frame, roles.image, NAMES.image);
    const time = timeField(frame, roles.time);
    if (!image || !time || image === time) {continue;}
    found = true;
    const host = fieldNamed(frame, roles.host, NAMES.host);
    const site = fieldNamed(frame, roles.site, NAMES.site);
    const preview = fieldNamed(frame, roles.preview, NAMES.preview);
    const cadence = fieldNamed(frame, roles.cadence, NAMES.cadence);
    // a frame without a host field: one host, from a label or the query
    const fallbackHost = image.labels?.host ?? frame.name ?? frame.refId ?? 'host';
    const fallbackSite = image.labels?.site ?? '';
    for (let i = 0; i < frame.length; i++) {
      const ts = toMillis(time.values[i]);
      const url = imageLocator(image.values[i]);
      if (ts == null || !url) {continue;}
      const id = String(host ? host.values[i] ?? '' : fallbackHost);
      const siteId = String(site ? site.values[i] ?? '' : fallbackSite);
      if (!id) {continue;}
      const key = siteId + '/' + id;
      let rec = byHost.get(key);
      if (!rec) {
        rec = { id, site: siteId, frames: new Map() };
        byHost.set(key, rec);
      }
      const f: Frame = { ts, url, source: id };
      const hi = preview ? imageLocator(preview.values[i]) : null;
      if (hi) {f.hi = hi;}
      rec.frames.set(ts, f); // a repeated timestamp: the later row wins
      const c = cadence ? Number(cadence.values[i]) : NaN;
      if (Number.isFinite(c) && c > 0) {rec.cadence = c;}
    }
  }
  if (!found) {return null;}
  return [...byHost.values()].map((r) => {
    const frames = [...r.frames.values()].sort((a, b) => a.ts - b.ts);
    return { id: r.id, site: r.site, frames, cadence: r.cadence ?? inferCadence(frames.map((f) => f.ts)) };
  });
}

/** At most one frame per step, the one nearest each step's tick, from a
 * window snapped out to whole steps: what the reference worker's /frames
 * answers, so the core treats records and the API alike. */
export function framesPerStep(frames: Frame[], from: number, to: number, step: number): Frame[] {
  if (!(step > 0)) {return [];}
  const lo = Math.floor(from / step) * step;
  const hi = Math.ceil(to / step) * step;
  const start = Math.ceil(lo / step) * step;
  const best = new Map<number, Frame>();
  for (const f of frames) {
    if (f.ts < lo) {continue;}
    if (f.ts > hi) {break;}
    const idx = Math.round((f.ts - start) / step);
    const prev = best.get(idx);
    const tick = start + idx * step;
    if (!prev || Math.abs(f.ts - tick) < Math.abs(prev.ts - tick)) {best.set(idx, f);}
  }
  return [...best.values()].sort((a, b) => a.ts - b.ts);
}

/** The core's data layer over frame records. `known` adds what a source list
 * says about a host (Visual Timeline data source: history, time zone, tags,
 * location); records alone give id, site and cadence. */
export function recordsBackend(hosts: HostRecords[], known: SourceDecl[] = []): Backend {
  const decls: SourceDecl[] = hosts.map((h) => {
    const k = known.find((d) => d.id === h.id && (d.site === h.site || !h.site));
    return k ? { ...k, site: h.site || k.site } : { id: h.id, site: h.site, cadence: h.cadence };
  });
  // keyed the way the core asks: by the declared site, which a source list may fill in
  const byKey = new Map(decls.map((d, i) => [d.site + '/' + d.id, hosts[i]]));
  return {
    kiosks: (sites) => (sites ? decls.filter((d) => sites.includes(d.site)) : decls),
    frames: async (site, id, from, to, step) => framesPerStep(byKey.get(site + '/' + id)?.frames ?? [], from, to, step),
  };
}
