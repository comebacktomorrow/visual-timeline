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

import type { Backend, Clip, Frame, HistoryEvent, SourceDecl } from '../vt/types';
import { withPauseStates, type HostStates } from './hostState';

/** Which field plays which role. Empty means "find it by the usual names". */
export interface FieldRoles {
  time?: string;
  image?: string;
  host?: string;
  site?: string;
  preview?: string;
  cadence?: string;
  /** a video clip's URL (M10c) */
  video?: string;
}

/** What a query may say about a host besides its frames (M4c). */
export interface HostMeta {
  timezone?: string;
  location?: string;
  tags?: Record<string, string>;
}

/** One host's frames, sorted by time, one per timestamp. */
export interface HostRecords extends HostMeta {
  id: string;
  site: string;
  frames: Frame[];
  /** Video clips (M10c), in time order, from a video field. */
  clips?: Clip[];
  /** From a cadence field (ms), else the median gap between frames. */
  cadence: number;
  /** No cadence field: the cadence is only the typical gap, not a promise. */
  inferred?: boolean;
  /** Where a cadence field's value changes over time: a cadence event at the
   * first frame of each new value, so the timeline draws each pace on its own
   * grid (an era) instead of a slow stretch as false gaps. */
  history?: HistoryEvent[];
}

/** The usual names for each role, matched without regard to case. */
export const ROLE_NAMES = {
  time: ['time', 'timestamp', 'ts', 'datetime', 'date'],
  image: ['image', 'url', 'image_url', 'imageurl', 'src', 'frame', 'snapshot'],
  host: ['host', 'source', 'camera', 'kiosk', 'device'],
  site: ['site'],
  preview: ['image_hi', 'url_hi', 'preview', 'preview_url', 'image_large'],
  cadence: ['cadence', 'cadence_ms'],
  count: ['frame_count'],
  video: ['video', 'video_url'],
  videoHi: ['video_hi', 'video_url_hi'],
  videoEnd: ['video_end', 'clip_end'],
  videoDuration: ['video_duration', 'video_duration_ms'],
  timezone: ['timezone', 'tz', 'time_zone'],
  location: ['location'],
  tags: ['tags'],
};

/* labels that name the row's place, not a property of the host */
const NOT_TAGS = new Set(['host', 'site', 'source', 'camera', 'kiosk', 'device', 'timezone', 'tz', 'location', '__name__']);

/** Tags from a tags field's value: an object, JSON of one, or "k=v, k=v". */
export function parseTags(v: unknown): Record<string, string> | undefined {
  let o: unknown = v;
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) {return undefined;}
    if (s.startsWith('{')) {
      try { o = JSON.parse(s); } catch { return undefined; }
    } else {
      const out: Record<string, string> = {};
      for (const part of s.split(',')) {
        const i = part.indexOf('=');
        if (i > 0) {out[part.slice(0, i).trim()] = part.slice(i + 1).trim();}
      }
      return Object.keys(out).length ? out : undefined;
    }
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) {return undefined;}
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(o as Record<string, unknown>)) {
    if (val != null && val !== '') {out[k] = String(val);}
  }
  return Object.keys(out).length ? out : undefined;
}

/* A frame's labels as metadata: time zone and location by name, the rest
 * (all but the ones that place the row) as tags. */
function labelMeta(labels: Record<string, string> | undefined): HostMeta {
  if (!labels) {return {};}
  const tags: Record<string, string> = {};
  for (const [k, v] of Object.entries(labels)) {if (!NOT_TAGS.has(k) && v) {tags[k] = v;}}
  return {
    ...(labels.timezone || labels.tz ? { timezone: labels.timezone || labels.tz } : {}),
    ...(labels.location ? { location: labels.location } : {}),
    ...(Object.keys(tags).length ? { tags } : {}),
  };
}

/* fields over labels, the later row over the earlier */
function addMeta(into: HostMeta, from: HostMeta): void {
  if (from.timezone) {into.timezone = from.timezone;}
  if (from.location) {into.location = from.location;}
  if (from.tags) {into.tags = { ...(into.tags || {}), ...from.tags };}
}

/* the metadata fields of a frame, read row by row */
function metaFields(frame: DataFrame) {
  const tz = fieldNamed(frame, undefined, ROLE_NAMES.timezone);
  const loc = fieldNamed(frame, undefined, ROLE_NAMES.location);
  const tags = fieldNamed(frame, undefined, ROLE_NAMES.tags);
  return {
    any: !!(tz || loc || tags),
    row(i: number): HostMeta {
      const t = tz ? String(tz.values[i] ?? '').trim() : '';
      const l = loc ? String(loc.values[i] ?? '').trim() : '';
      const g = tags ? parseTags(tags.values[i]) : undefined;
      return { ...(t ? { timezone: t } : {}), ...(l ? { location: l } : {}), ...(g ? { tags: g } : {}) };
    },
  };
}

/** Without a cadence field and with fewer than two frames, a host's cadence. */
export const DEFAULT_CADENCE = 60_000;

export function fieldNamed(frame: DataFrame, wanted: string | undefined, defaults: string[]): Field | undefined {
  const names = wanted ? [wanted.toLowerCase()] : defaults;
  for (const n of names) {
    const f = frame.fields.find(
      (x) => x.name.toLowerCase() === n || getFieldDisplayName(x, frame).toLowerCase() === n
    );
    if (f) {return f;}
  }
  return undefined;
}

export function timeField(frame: DataFrame, wanted?: string): Field | undefined {
  if (wanted) {return fieldNamed(frame, wanted, []);}
  return frame.fields.find((f) => f.type === FieldType.time) ?? fieldNamed(frame, undefined, ROLE_NAMES.time);
}

export function toMillis(v: unknown): number | null {
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

/** A URL that is plainly a video, not an image: by its file type, or a
 * data: URL of one. */
export function isVideoUrl(s: string): boolean {
  return /^data:video\//i.test(s) || /\.(mp4|m4v|webm|mov|ogv|mkv|m3u8)([?#]|$)/i.test(s);
}

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

/* An image column of a wide table: its first value is plainly an image
 * (an http(s), data:image or blob URL, or Base64 image data), not just any
 * string. */
function looksLikeImages(f: Field): boolean {
  if (f.type !== FieldType.string) {return false;}
  const v = f.values.find((x) => typeof x === 'string' && x.trim());
  if (typeof v !== 'string') {return false;}
  const s = v.trim();
  if (isVideoUrl(s)) {return false;}
  return /^(https?:\/\/|data:image\/|blob:)/i.test(s) || BASE64_TYPES.some(([magic]) => s.startsWith(magic));
}

/* A wide table (#126): one time field and an image column per host, as a
 * SQL pivot returns them, with no image or host field. Each column is a
 * host, named by its host label or its display name. Our "Per host" last
 * frame table has a time field per host, so it isn't one. */
function wideColumns(frame: DataFrame, roles: FieldRoles): Field[] {
  if (roles.image || fieldNamed(frame, roles.host, ROLE_NAMES.host) || fieldNamed(frame, roles.video, ROLE_NAMES.video)) {return [];}
  if (frame.fields.filter((f) => f.type === FieldType.time).length !== 1) {return [];}
  return frame.fields.filter(looksLikeImages);
}

/* With no field named for the image: the one text field whose values are
 * plainly images, in a frame that names its host (a Loki log line that is an
 * image's URL, with the host extracted from its labels). Not when several
 * fields could be the image (that's a wide table, or ambiguous). */
function imageByContent(frame: DataFrame, roles: FieldRoles): Field | undefined {
  if (roles.image || !fieldNamed(frame, roles.host, ROLE_NAMES.host)) {return undefined;}
  const video = fieldNamed(frame, roles.video, ROLE_NAMES.video);
  const candidates = frame.fields.filter((f) => f !== video && looksLikeImages(f));
  return candidates.length === 1 ? candidates[0] : undefined;
}

/** The frame records in a query result, one entry per host, or null when no
 * frame in it has an image field (or image columns, in a wide table). */
export function recordsFromSeries(series: DataFrame[] | undefined, roles: FieldRoles = {}): HostRecords[] | null {
  const byHost = new Map<string, { id: string; site: string; frames: Map<number, Frame>; clips: RawClip[]; cadence?: number; paces: Map<number, number>; meta: HostMeta }>();
  let found = false;
  const recFor = (id: string, siteId: string) => {
    const key = siteId + '/' + id;
    let rec = byHost.get(key);
    if (!rec) {
      rec = { id, site: siteId, frames: new Map(), clips: [], paces: new Map(), meta: {} };
      byHost.set(key, rec);
    }
    return rec;
  };
  for (const frame of series || []) {
    const video = fieldNamed(frame, roles.video, ROLE_NAMES.video);
    const image = fieldNamed(frame, roles.image, ROLE_NAMES.image) ?? imageByContent(frame, roles);
    const time = timeField(frame, roles.time);
    if (!image && !video && time) {
      // a wide table: a column per host
      const cols = wideColumns(frame, roles);
      if (cols.length) {found = true;}
      for (const col of cols) {
        const rec = recFor(col.labels?.host ?? getFieldDisplayName(col, frame), col.labels?.site ?? '');
        addMeta(rec.meta, labelMeta(col.labels));
        for (let i = 0; i < frame.length; i++) {
          const ts = toMillis(time.values[i]);
          const url = imageLocator(col.values[i]);
          if (ts != null && url) {rec.frames.set(ts, { ts, url, source: rec.id });}
        }
      }
      continue;
    }
    if ((!image && !video) || !time || image === time) {continue;}
    found = true;
    // a video clip's larger version, and its end (a time) or its length (ms)
    const videoHi = video ? fieldNamed(frame, undefined, ROLE_NAMES.videoHi) : undefined;
    const videoEnd = video ? fieldNamed(frame, undefined, ROLE_NAMES.videoEnd) : undefined;
    const videoLen = video ? fieldNamed(frame, undefined, ROLE_NAMES.videoDuration) : undefined;
    const host = fieldNamed(frame, roles.host, ROLE_NAMES.host);
    const site = fieldNamed(frame, roles.site, ROLE_NAMES.site);
    const preview = fieldNamed(frame, roles.preview, ROLE_NAMES.preview);
    const cadence = fieldNamed(frame, roles.cadence, ROLE_NAMES.cadence);
    // how many frames a thinned row stands for (our data source sends it)
    const counts = fieldNamed(frame, undefined, ROLE_NAMES.count);
    // a frame without a host field: one host, from a label or the query
    const labelled = (image ?? video)!;
    const fallbackHost = labelled.labels?.host ?? frame.name ?? frame.refId ?? 'host';
    const fallbackSite = labelled.labels?.site ?? '';
    const fromLabels = labelMeta(labelled.labels);
    const meta = metaFields(frame);
    for (let i = 0; i < frame.length; i++) {
      const ts = toMillis(time.values[i]);
      const url = image ? imageLocator(image.values[i]) : null;
      const vurl = video ? imageLocator(video.values[i]) : null;
      if (ts == null || (!url && !vurl)) {continue;}
      const id = String(host ? host.values[i] ?? '' : fallbackHost);
      const siteId = String(site ? site.values[i] ?? '' : fallbackSite);
      if (!id) {continue;}
      const key = siteId + '/' + id;
      let rec = byHost.get(key);
      if (!rec) {
        rec = { id, site: siteId, frames: new Map(), clips: [], paces: new Map(), meta: {} };
        addMeta(rec.meta, fromLabels);
        byHost.set(key, rec);
      }
      if (meta.any) {addMeta(rec.meta, meta.row(i));}
      if (vurl) {
        const c: RawClip = { from: ts, url: vurl };
        const hiV = videoHi ? imageLocator(videoHi.values[i]) : null;
        if (hiV) {c.hi = hiV;}
        const end = videoEnd ? toMillis(videoEnd.values[i]) : null;
        const len = videoLen ? Number(videoLen.values[i]) : NaN;
        if (end != null && end > ts) {c.to = end;}
        else if (Number.isFinite(len) && len > 0) {c.to = ts + len;}
        rec.clips.push(c);
      }
      if (!url) {continue;}
      const f: Frame = { ts, url, source: id };
      const hi = preview ? imageLocator(preview.values[i]) : null;
      if (hi) {f.hi = hi;}
      const n = counts ? Number(counts.values[i]) : NaN;
      if (Number.isFinite(n) && n > 1) {f.count = n;}
      rec.frames.set(ts, f); // a repeated timestamp: the later row wins
      const c = cadence ? Number(cadence.values[i]) : NaN;
      // a frame's cadence is the promise it makes (docs/TIMELINE-MODEL.md)
      if (Number.isFinite(c) && c > 0) { rec.cadence = c; rec.paces.set(ts, c); f.cadence = c; }
    }
  }
  if (!found) {return null;}
  // hosts in a stable order, whatever order the rows came in (two hosts' frames
  // at the same time can come either way round)
  const hosts = [...byHost.values()].sort((a, b) => a.site.localeCompare(b.site) || a.id.localeCompare(b.id));
  return hosts.map((r) => {
    const frames = [...r.frames.values()].sort((a, b) => a.ts - b.ts);
    const history = paceHistory(r.paces);
    // the pace in force at the end of the window; a host with only clips,
    // the typical gap between them
    const cadence = history ? history[history.length - 1].cadence! : r.cadence
      ?? inferCadence(frames.length ? frames.map((f) => f.ts) : r.clips.map((c) => c.from).sort((a, b) => a - b));
    const clips = r.clips.length ? resolveClips(r.clips, cadence) : null;
    return { ...r.meta, id: r.id, site: r.site, frames, cadence, ...(r.cadence ? {} : { inferred: true }), ...(history ? { history } : {}),
      ...(clips ? { clips } : {}) };
  });
}

/** A clip as a row gives it: its end only when the row says. */
export interface RawClip {
  from: number;
  to?: number;
  url: string;
  hi?: string;
}

/** Clips with their ends settled, in time order, one per start (the later
 * row wins). A clip with no end stated (a video_end or video_duration field)
 * lasts as long as its host's clips typically do (the ones that say), else
 * the typical gap between their starts, else `fallback`; never past the
 * next clip's start. */
export function resolveClips(raw: RawClip[], fallback: number): Clip[] {
  const byFrom = new Map<number, RawClip>();
  for (const c of raw) {byFrom.set(c.from, c);}
  const cs = [...byFrom.values()].sort((a, b) => a.from - b.from);
  const median = (xs: number[]) => (xs.length ? xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);
  const lengths = cs.filter((c) => c.to !== undefined).map((c) => c.to! - c.from);
  const starts: number[] = [];
  for (let i = 1; i < cs.length; i++) {starts.push(cs[i].from - cs[i - 1].from);}
  const typical = median(lengths) ?? median(starts) ?? fallback;
  return cs.map((c, i) => {
    const next = cs[i + 1]?.from ?? Infinity;
    const to = c.to !== undefined ? c.to : Math.min(next, c.from + typical);
    return { from: c.from, to, url: c.url, ...(c.hi ? { hi: c.hi } : {}) };
  });
}

/** A host table from any query (M4c): rows naming a host (a host field, or
 * id) with what's known about it (time zone, location, tags, cadence), and
 * no image or state. The reference worker's /sources read through Infinity
 * is one. Its hosts are drawn even with no frames in the window. */
export function hostTableFromSeries(series: DataFrame[] | undefined, roles: FieldRoles = {}): SourceDecl[] {
  const out = new Map<string, SourceDecl>();
  for (const frame of series || []) {
    if (fieldNamed(frame, roles.image, ROLE_NAMES.image) || fieldNamed(frame, roles.video, ROLE_NAMES.video) || fieldNamed(frame, undefined, ['state', 'status'])) {continue;}
    const host = fieldNamed(frame, roles.host, [...ROLE_NAMES.host, 'id']);
    const meta = metaFields(frame);
    const cadence = fieldNamed(frame, roles.cadence, ROLE_NAMES.cadence);
    if (!host || !(meta.any || cadence)) {continue;}
    const site = fieldNamed(frame, roles.site, ROLE_NAMES.site);
    for (let i = 0; i < frame.length; i++) {
      const id = String(host.values[i] ?? '');
      if (!id) {continue;}
      const siteId = String(site ? site.values[i] ?? '' : '');
      const c = cadence ? Number(cadence.values[i]) : NaN;
      const d: SourceDecl = { id, site: siteId, ...(Number.isFinite(c) && c > 0 ? { cadence: c } : {}) } as SourceDecl;
      addMeta(d, meta.row(i));
      out.set(siteId + '/' + id, d);
    }
  }
  return [...out.values()];
}

/* A cadence field's values by frame time, as cadence events where the value
 * changes; null while there's only one pace. */
function paceHistory(paces: Map<number, number>): HistoryEvent[] | null {
  const events: HistoryEvent[] = [];
  for (const [ts, c] of [...paces.entries()].sort((a, b) => a[0] - b[0])) {
    if (!events.length || events[events.length - 1].cadence !== c) {events.push({ since: ts, cadence: c });}
  }
  return events.length > 1 ? events : null;
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

/** framesPerStep, keeping how many frames each kept one stands for (its
 * bucket's), as `count`: a thinned answer that still says how much was there. */
export function thinWithCounts(frames: Frame[], from: number, to: number, step: number): Frame[] {
  const kept = framesPerStep(frames, from, to, step);
  if (!kept.length) {return kept;}
  const lo = Math.floor(from / step) * step;
  const start = Math.ceil(lo / step) * step;
  const counts = new Map<number, number>();
  for (const f of frames) {
    if (f.ts < lo || f.ts > Math.ceil(to / step) * step) {continue;}
    const idx = Math.round((f.ts - start) / step);
    counts.set(idx, (counts.get(idx) ?? 0) + (f.count ?? 1));
  }
  return kept.map((f) => {
    const n = counts.get(Math.round((f.ts - start) / step)) ?? 1;
    return n > 1 ? { ...f, count: n } : f;
  });
}

/** The core's data layer over frame records. `known` adds what a source list
 * says about a host (Visual Timeline data source: history, time zone, tags,
 * location); records alone give id, site and cadence. A known host with no
 * records in the window is still drawn: a host that was paused or silent the
 * whole time is information, not something to hide. */
export function recordsBackend(hosts: HostRecords[], known: SourceDecl[] = [], states: HostStates[] = []): Backend {
  const matched = new Set<SourceDecl>();
  const decls: SourceDecl[] = hosts.map((h) => {
    const k = known.find((d) => d.id === h.id && (d.site === h.site || !h.site));
    if (k) {matched.add(k);}
    const own: SourceDecl = {
      id: h.id, site: h.site, cadence: h.cadence, ...(h.inferred ? { inferred: true } : {}), ...(h.history ? { history: h.history } : {}),
      ...(h.timezone ? { timezone: h.timezone } : {}), ...(h.location ? { location: h.location } : {}), ...(h.tags ? { tags: h.tags } : {}),
    };
    // what a source list or host table says wins; the rows fill in the rest
    // a cadence the source list or host table declares is a promise
    return k ? { ...own, ...k, site: h.site || k.site, cadence: k.cadence || h.cadence, tags: k.tags || h.tags,
      inferred: !k.cadence && !!h.inferred && !k.history } : own;
  });
  // keyed the way the core asks: by the declared site, which a source list may fill in
  const byKey = new Map(decls.map((d, i) => [d.site + '/' + d.id, hosts[i]]));
  // the first word on a host wins (a source list before a host table), so a
  // host two lists name is drawn once
  for (const k of known) {
    if (matched.has(k) || decls.some((d) => d.id === k.id && d.site === k.site)) {continue;}
    decls.push({ ...k, cadence: k.cadence || DEFAULT_CADENCE, ...(k.cadence ? {} : { inferred: true }) });
  }
  // a host's states (#126): pause states take the place of its declared
  // pauses; a host only a state query knows of is drawn too
  for (const st of states) {
    const i = decls.findIndex((d) => d.id === st.id && (d.site === st.site || !st.site));
    if (i >= 0) {decls[i] = withPauseStates(decls[i], st.spans);}
    else if (st.spans.some((s) => s.pauses)) {decls.push(withPauseStates<SourceDecl>({ id: st.id, site: st.site, cadence: DEFAULT_CADENCE, inferred: true }, st.spans));}
  }
  return {
    kiosks: (sites) => (sites ? decls.filter((d) => sites.includes(d.site)) : decls),
    frames: async (site, id, from, to, step) => framesPerStep(byKey.get(site + '/' + id)?.frames ?? [], from, to, step),
    // records hold every frame: the preview player gets them all
    allFrames: async (site, id, from, to) => (byKey.get(site + '/' + id)?.frames ?? []).filter((f) => f.ts >= from && f.ts <= to),
    ...(hosts.some((h) => h.clips?.length)
      ? { clips: async (site: string, id: string, from: number, to: number) => (byKey.get(site + '/' + id)?.clips ?? []).filter((c) => c.to > from && c.from <= to) }
      : {}),
  };
}
