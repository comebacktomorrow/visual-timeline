/* The HTTP folder connection (#125): a web folder or a public bucket, listed
 * through the data source's proxy route and turned into each host's frames.
 * The listings go through Grafana's server (CORS, and the bearer token stays
 * there); the images load straight from the folder in viewers' browsers. */
import { getBackendSrv } from '@grafana/runtime';
import { lastValueFrom } from 'rxjs';

import { HostRecords, inferCadence } from '../../shared/frameRecords';
import type { Frame } from '../../vt/types';
import type { VisualTimelineOptions } from '../types';
import { Listing, ListingFormat, listingPath, parseListing } from './listings';
import { compileTemplate, FolderTemplate } from './template';
import { walkFrames } from './walk';

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
  private readonly imageBase: string;
  private readonly small?: string;
  private readonly large?: string;
  private readonly raw: string;
  private compiled: FolderTemplate | null = null;
  private cache = new Map<string, { at: number; p: Promise<Listing> }>();

  constructor(o: VisualTimelineOptions, private readonly fetchText: TextFetch) {
    this.listing = o.listing || 'html';
    this.tz = (o.timezone || '').trim() || 'UTC';
    this.imageBase = trimSlashes(o.imageUrl || o.folderUrl || '');
    this.small = (o.smallVariant || '').trim() || undefined;
    this.large = (o.largeVariant || '').trim() || undefined;
    this.raw = o.template || '';
    if (!trimSlashes(o.folderUrl || '')) {throw new Error('Set the folder URL');}
  }

  /** The compiled template; throws the template's own message when it can't work. */
  get template(): FolderTemplate {
    return (this.compiled ??= compileTemplate(this.raw));
  }

  /* one folder's listing, cached; S3 pages followed; a missing folder (a day
   * with no frames) is empty */
  private list = (folder: string, opts?: { startAfter?: string }): Promise<Listing> => {
    const key = folder + '\u0000' + (opts?.startAfter ?? '');
    const now = Date.now();
    const hit = this.cache.get(key);
    if (hit && now - hit.at < LISTING_TTL_MS) {return hit.p;}
    const p = this.fetchListing(folder, opts);
    this.cache.set(key, { at: now, p });
    p.catch(() => this.cache.delete(key));
    if (this.cache.size > 500) {this.cache.clear();}
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
    const { frames, truncated } = await walkFrames(this.template, this.list, {
      from: from - pad, to, tz: this.tz, hosts: filters.hosts ?? null, sites: filters.sites ?? null, variants,
    });
    const byHost = new Map<string, { id: string; site: string; small: Frame[]; large: Frame[] }>();
    for (const f of frames) {
      const key = f.site + '/' + f.host;
      let h = byHost.get(key);
      if (!h) { h = { id: f.host, site: f.site, small: [], large: [] }; byHost.set(key, h); }
      const fr: Frame = { ts: f.ts, url: this.imageBase + '/' + encodePath(f.path), source: f.host };
      if (!this.small || f.variant === this.small) {h.small.push(fr);}
      if (this.large && f.variant === this.large) {h.large.push(fr);}
    }
    const records: HostRecords[] = [];
    for (const h of byHost.values()) {
      if (!h.small.length) {continue;}
      const cadence = inferCadence(h.small.map((f) => f.ts));
      // the large image nearest each small one, within a cadence
      let j = 0;
      for (const f of h.small) {
        while (j + 1 < h.large.length && Math.abs(h.large[j + 1].ts - f.ts) <= Math.abs(h.large[j].ts - f.ts)) {j++;}
        const l = h.large[j];
        if (l && Math.abs(l.ts - f.ts) <= cadence) {f.hi = l.url;}
      }
      records.push({ id: h.id, site: h.site, frames: h.small, cadence });
    }
    records.sort((a, b) => a.site.localeCompare(b.site) || a.id.localeCompare(b.id));
    return { records, truncated };
  }
}
