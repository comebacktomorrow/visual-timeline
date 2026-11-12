/* The HTTP folder connection (#125): a web folder or a public bucket, listed
 * through the data source's proxy route and turned into each host's frames.
 * The listings go through Grafana's server (CORS, and the bearer token stays
 * there); the images load straight from the folder in viewers' browsers. */
import { rangeUtil } from '@grafana/data';
import { getBackendSrv } from '@grafana/runtime';
import { lastValueFrom } from 'rxjs';

import { HostRecords, inferCadence, RawClip, resolveClips } from '../../shared/frameRecords';
import type { Frame } from '../../vt/types';
import type { VisualTimelineOptions } from '../types';
import { Listing, ListingFormat, listingPath, parseListing } from './listings';
import { compileTemplate, finestUnit, FolderTemplate, UNIT_MS, unitEnd } from './template';
import { ListOptions, walkFrames } from './walk';

/** routes[].path in datasource/plugin.json: the folder's base URL. */
export const FOLDER_ROUTE = 'folder';

/** Fetches a path below the folder's base as text; never throws for an
 * HTTP status, which it returns. Injected so tests need no Grafana. */
export type TextFetch = (path: string, accept?: string) => Promise<{ status: number; text: string }>;

/** A TextFetch through data source `uid`'s proxy route. */
export function proxyTextFetch(uid: string): TextFetch {
  return async (path, accept) => {
    try {
      const r = await lastValueFrom(getBackendSrv().fetch<string>({
        url: `/api/datasources/proxy/uid/${encodeURIComponent(uid)}/${FOLDER_ROUTE}${path}`,
        method: 'GET',
        responseType: 'text',
        headers: accept ? { Accept: accept } : undefined,
        showErrorAlert: false,
        showSuccessAlert: false,
      }));
      return { status: r.status, text: typeof r.data === 'string' ? r.data : JSON.stringify(r.data) };
    } catch (err: unknown) {
      const e = (err || {}) as { status?: unknown; data?: unknown };
      return { status: typeof e.status === 'number' ? e.status : 0, text: typeof e.data === 'string' ? e.data : '' };
    }
  };
}

/** A listing is reused this long: a dashboard load asks for the same folders
 * from every panel, variable and refresh. */
export const LISTING_TTL_MS = 60_000;
/** A date folder whose day, hour or month ended at least PAST_GRACE_MS ago
 * gets no new frames, so its listing is reused this long (M5): a long range
 * re-lists only its recent folders on each refresh. The grace lets uploads
 * that were on their way when the folder's time ended land first. */
export const PAST_LISTING_TTL_MS = 3600_000;
export const PAST_GRACE_MS = 15 * 60_000;
/** The most listings kept; past it the oldest kept is dropped. */
const MAX_CACHED = 500;
const MAX_S3_PAGES = 20;

const trimSlashes = (s: string) => {
  let out = s.trim();
  while (out.endsWith('/')) {out = out.slice(0, -1);}
  return out;
};
const encodePath = (p: string) => p.split('/').map(encodeURIComponent).join('/');

export class FolderSource {
  readonly listing: ListingFormat;
  readonly tz: string;
  /** the promise each host makes (ms), from Expected every; 0: none */
  readonly expected: number;
  private readonly imageBase: string;
  private readonly small?: string;
  private readonly large?: string;
  private readonly raw: string;
  private compiled: FolderTemplate | null = null;
  private readonly videoRaw: string;
  private compiledVideo: FolderTemplate | null = null;
  private cache = new Map<string, { at: number; ttl: number; p: Promise<Listing> }>();

  constructor(o: VisualTimelineOptions, private readonly fetchText: TextFetch) {
    this.listing = o.listing || 'html';
    this.tz = (o.timezone || '').trim() || 'UTC';
    let expected = 0;
    try { expected = o.expectedEvery ? rangeUtil.intervalToMs(o.expectedEvery.trim()) : 0; } catch { expected = 0; }
    this.expected = expected > 0 ? expected : 0;
    this.imageBase = trimSlashes(o.imageUrl || o.folderUrl || '');
    this.small = (o.smallVariant || '').trim() || undefined;
    this.large = (o.largeVariant || '').trim() || undefined;
    this.raw = o.template || '';
    this.videoRaw = (o.videoTemplate || '').trim();
    if (!trimSlashes(o.folderUrl || '')) {throw new Error('Set the folder URL');}
  }

  /** The compiled template; throws the template's own message when it can't work. */
  get template(): FolderTemplate {
    return (this.compiled ??= compileTemplate(this.raw));
  }

  /** The compiled video template (M11), or null when none is set. */
  get videoTemplate(): FolderTemplate | null {
    if (!this.videoRaw) {return null;}
    return (this.compiledVideo ??= compileTemplate(this.videoRaw, 'video path template'));
  }

  /* one folder's listing, cached (longer once its time has passed); S3
   * pages followed; a missing folder (a day with no frames) is empty */
  private list = (folder: string, opts?: ListOptions): Promise<Listing> => {
    // only an S3 listing starts after a key; HTML and JSON listings are the
    // same whatever the range, so one answer serves them all
    const startAfter = this.listing === 's3' ? opts?.startAfter : undefined;
    const key = folder + '\u0000' + (startAfter ?? '');
    const now = Date.now();
    const hit = this.cache.get(key);
    if (hit && now - hit.at < hit.ttl) {return hit.p;}
    const past = opts?.ends !== undefined && opts.ends + PAST_GRACE_MS <= now;
    const p = this.fetchListing(folder, startAfter ? { startAfter } : undefined);
    const entry = { at: now, ttl: past ? PAST_LISTING_TTL_MS : LISTING_TTL_MS, p };
    // newest last, so the oldest kept is the first dropped
    this.cache.delete(key);
    this.cache.set(key, entry);
    p.catch(() => { if (this.cache.get(key) === entry) {this.cache.delete(key);} });
    while (this.cache.size > MAX_CACHED) {this.cache.delete(this.cache.keys().next().value!);}
    return p;
  };

  private async fetchListing(folder: string, opts?: { startAfter?: string }): Promise<Listing> {
    const out: Listing = { dirs: [], files: [] };
    let token: string | undefined;
    for (let page = 0; page < (this.listing === 's3' ? MAX_S3_PAGES : 1); page++) {
      const path = listingPath(this.listing, folder, { startAfter: opts?.startAfter, token });
      const r = await this.fetchText(path, this.listing === 'json' ? 'application/json' : undefined);
      if (r.status === 404) {return out;}
      if (r.status < 200 || r.status >= 300) {
        throw new Error(`Listing ${folder || 'the folder'} failed: ${r.status ? 'HTTP ' + r.status : 'no answer'} through Grafana's proxy`);
      }
      const l = parseListing(this.listing, r.text, folder);
      out.dirs.push(...l.dirs);
      out.files.push(...l.files);
      if (!l.next) {break;}
      token = l.next;
    }
    return out;
  }

  /** Each host's frames in [from, to] (small images, with the large one
   * nearest each as its preview), and whether the walk was cut short. */
  async hosts(from: number, to: number, filters: { hosts?: string[] | null; sites?: string[] | null } = {}): Promise<{ records: HostRecords[]; truncated: boolean }> {
    const variants = this.small || this.large ? [...new Set([this.small, this.large].filter((v): v is string => !!v))] : null;
    // a frame can sit up to half a cadence before the window and still be its first
    const pad = 3600e3;
    const walked = await walkFrames(this.template, this.list, {
      from: from - pad, to, tz: this.tz, hosts: filters.hosts ?? null, sites: filters.sites ?? null, variants,
    });
    const frames = walked.frames;
    let truncated = walked.truncated;
    type Host = { id: string; site: string; small: Frame[]; large: Frame[]; clips: RawClip[]; clipsHi: Map<number, string> };
    const byHost = new Map<string, Host>();
    const hostOf = (site: string, id: string): Host => {
      const key = site + '/' + id;
      let h = byHost.get(key);
      if (!h) { h = { id, site, small: [], large: [], clips: [], clipsHi: new Map() }; byHost.set(key, h); }
      return h;
    };
    // video clips (M11): each spans its template's finest time unit (a day's
    // movie, an hour's recording); walked from far enough back that one
    // that began before the range is found
    const vt = this.videoTemplate;
    if (vt) {
      const unit = finestUnit(vt);
      const clips = await walkFrames(vt, this.list, {
        from: from - (unit ? UNIT_MS[unit] : pad), to, tz: this.tz, hosts: filters.hosts ?? null, sites: filters.sites ?? null, variants,
      });
      truncated = truncated || clips.truncated;
      for (const c of clips.frames) {
        const h = hostOf(c.site, c.host);
        const url = this.imageBase + '/' + encodePath(c.path);
        // the large variant of a clip is its larger version
        if (this.large && c.variant === this.large && this.small !== this.large) { h.clipsHi.set(c.ts, url); continue; }
        if (this.small && c.variant && c.variant !== this.small) {continue;}
        h.clips.push({ from: c.ts, url, ...(unit ? { to: unitEnd(c.ts, unit, this.tz) } : {}) });
      }
    }
    for (const f of frames) {
      const h = hostOf(f.site, f.host);
      const fr: Frame = { ts: f.ts, url: this.imageBase + '/' + encodePath(f.path), source: f.host };
      if (!this.small || f.variant === this.small) {h.small.push(fr);}
      if (this.large && f.variant === this.large) {h.large.push(fr);}
    }
    const records: HostRecords[] = [];
    for (const h of byHost.values()) {
      if (!h.small.length && !h.clips.length) {continue;}
      const cadence = inferCadence(h.small.length ? h.small.map((f) => f.ts) : h.clips.map((c) => c.from).sort((a, b) => a - b));
      for (const c of h.clips) {
        const hi = h.clipsHi.get(c.from);
        if (hi) {c.hi = hi;}
      }
      // a clip with no unit to span lasts a frame's time (an assumption)
      const clips = h.clips.length ? { clips: resolveClips(h.clips, cadence, h.small.length > 1 ? (this.expected || cadence) : undefined) } : {};
      // the large image nearest each small one, within a cadence
      let j = 0;
      for (const f of h.small) {
        while (j + 1 < h.large.length && Math.abs(h.large[j + 1].ts - f.ts) <= Math.abs(h.large[j].ts - f.ts)) {j++;}
        const l = h.large[j];
        if (l && Math.abs(l.ts - f.ts) <= cadence) {f.hi = l.url;}
      }
      // a folder promises its Expected every, else nothing: its cadence is
      // then only the typical gap
      records.push(this.expected
        ? { id: h.id, site: h.site, frames: h.small, cadence: this.expected, ...clips }
        : { id: h.id, site: h.site, frames: h.small, cadence, inferred: true, ...clips });
    }
    records.sort((a, b) => a.site.localeCompare(b.site) || a.id.localeCompare(b.id));
    return { records, truncated };
  }
}
