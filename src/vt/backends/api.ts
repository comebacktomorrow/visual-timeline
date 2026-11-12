import { labelPauses } from './reasons';
import type { ApiFetch, ApiResponse, Backend, Frame, SourceDecl } from '../types';

/** A source as the reference worker's /sources declares it: the core's
 * SourceDecl plus the worker's own hi-res cadence, which only this backend
 * uses (to find a frame's hi-res preview for workers that don't send one). */
export interface ApiSourceDecl extends SourceDecl {
  hiCadence?: number;
}

/* <img> can't send headers, so a key-protected backend's image URLs carry
 * the viewer key as ?k= — but only bare URLs on the API's own origin. A URL
 * that already has a query string brings its own authorization (the
 * reference worker's ?e=&sig= signature, or a presigned URL that an extra
 * param would break), and an image host that isn't the API, such as a
 * public bucket domain, is never handed the key. */
export function imageUrlWithKey(url: string, apiBase: string, apiKey?: string): string {
  if (!apiKey || !url) {return url;}
  const u = new URL(url, apiBase);
  if (u.search || u.origin !== new URL(apiBase).origin) {return url;}
  u.searchParams.set('k', apiKey);
  return u.href;
}

/* Request paths (with query string) for the two read endpoints, relative to
 * the API base. Shared by both transports below. */
export function sourcesPath(sites?: string[] | null): string {
  const q = new URLSearchParams();
  if (sites) {q.set('site', sites.join(','));}
  const qs = q.toString();
  return '/sources' + (qs ? '?' + qs : '');
}
export function framesPath(site: string, host: string, from: number, to: number, step: number): string {
  const q = new URLSearchParams();
  q.set('site', site);
  q.set('source', host);
  q.set('from', String(Math.round(from)));
  q.set('to', String(Math.round(to)));
  q.set('step', String(step));
  q.set('variant', 'lo');
  return '/frames?' + q.toString();
}

/* A relative image URL in a /frames response means "relative to that
 * response". Fetched through a proxy, the response's own URL is the proxy's,
 * so resolve against the API's public /frames URL instead: the <img> then
 * loads straight from the API, never through the proxy. */
export function resolveFrameUrl(url: string, apiBase: string): string {
  if (!url || !apiBase) {return url;}
  try {
    return new URL(url, apiBase.replace(/\/+$/, '') + '/frames').href;
  } catch {
    return url;
  }
}

/* What Grafana's data source proxy answers instead of the API's own 401: a
 * 400 with this text, so a 401 never looks like the Grafana session expired. */
export const PROXY_AUTH_FAILED = 'Authentication to data source failed';

/* A non-2xx answer from the API (or from Grafana's proxy in front of it).
 * The message is written for the person looking at the panel; `auth` marks
 * the token problems, so a host can add its own hint. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly call: 'sources' | 'frames', readonly auth: boolean) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiError(call: 'sources' | 'frames', r: ApiResponse, viaProxy: boolean): Promise<ApiError> {
  const st = r.status;
  if (viaProxy) {
    let proxyAuth = st === 401;
    if (st === 400) {
      try {
        const body = await r.json();
        proxyAuth = (typeof body === 'string' ? body : JSON.stringify(body ?? '')).includes(PROXY_AUTH_FAILED);
      } catch {
        // no readable body: an ordinary 400
      }
    }
    if (proxyAuth) {
      return new ApiError(
        "The data source's viewer token was rejected. Check it in the data source's settings: Save & test shows what the API says.",
        st, call, true);
    }
    if (st === 403) {
      return new ApiError(
        "The data source's viewer token isn't allowed to read these sources (403). It may be scoped to other sites.",
        st, call, true);
    }
    if (st === 502 || st === 503 || st === 504) {
      return new ApiError(
        `Grafana couldn't reach the frames API (${st}). Check the data source's API URL.`, st, call, false);
    }
  } else if (st === 401) {
    return new ApiError('The frames API needs a valid viewer token (401).', st, call, true);
  } else if (st === 403) {
    return new ApiError(
      "The viewer token isn't allowed to read these sources (403). It may be scoped to other sites.", st, call, true);
  }
  return new ApiError(
    st ? `The frames API answered ${st} to /${call}.` : `No answer from the frames API for /${call}.`, st, call, false);
}

/* What a mount shows when GET /sources fails. An ApiError's message is
 * complete; on a token problem the host's hint follows it. Anything else
 * (a network error, a timeout) means the API couldn't be reached at all. */
export function bootErrorText(e: unknown, authHint?: string): string {
  if (e instanceof ApiError) {return e.auth && authHint ? e.message + ' ' + authHint : e.message;}
  const msg = e && (e as Error).message ? (e as Error).message : String(e);
  return 'frames API unreachable — ' + msg;
}

/* API-backed data layer — same shapes as the mock. Two transports:
 *  - direct: fetch(apiUrl + path), the viewer key (if any) as a Bearer
 *    header. Used by the standalone app and the panel's API URL option
 *    (the reference Worker serves CORS).
 *  - injected: apiFetch(path) does the request — the Grafana panel passes
 *    one that goes through its data source's proxy, which adds the token
 *    server-side. It resolves to { ok, status, json() }. The key never
 *    reaches this code, so no ?k= is ever appended; apiUrl is then only the
 *    API's public base, for resolving image URLs (see resolveFrameUrl) and
 *    building the hi-variant URL, never fetched. */
export function makeApiBackend(apiUrl?: string, apiKey?: string, apiFetch?: ApiFetch): Backend {
  const base = (apiUrl || '').replace(/\/+$/, '');
  const key = apiFetch ? '' : apiKey;
  // fresh options per request: a HUNG backend (dead dev worker still holding
  // its port, half-open connection) must become a catchable timeout error,
  // not a boot that silently never finishes
  const opts = () => ({
    headers: key ? { authorization: 'Bearer ' + key } : undefined,
    signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined,
  });
  const get: ApiFetch = apiFetch ? (path) => apiFetch(path) : (path) => fetch(base + path, opts());
  const image = (u: string) => (apiFetch ? resolveFrameUrl(u, base) : imageUrlWithKey(u, base, key));
  // what /sources said about each source, for older workers' preview URLs
  const decls = new Map<string, ApiSourceDecl>();
  return {
    async kiosks(sites) {
      const r = await get(sourcesPath(sites));
      if (!r.ok) {throw await apiError('sources', r, !!apiFetch);}
      // the API's contract, not validated; its pause reasons get their labels here
      const list = ((await r.json()) as ApiSourceDecl[]).map(labelPauses);
      for (const d of list) {decls.set(d.site + '/' + d.id, d);}
      return list;
    },
    async frames(site, host, from, to, step) {
      const r = await get(framesPath(site, host, from, to, step));
      if (!r.ok) {throw await apiError('frames', r, !!apiFetch);}
      const rows = (await r.json()) as Array<Frame & { url_hi?: string }>;   // the API's contract; not validated
      const decl = decls.get(site + '/' + host);
      for (const f of rows) {
        f.url = image(f.url);
        // the preview: the worker's own url_hi (#129), else derived from the
        // lo URL as workers before it require
        if (f.url_hi) {f.hi = image(f.url_hi);}
        else if (decl) {f.hi = hiUrlFor(f, decl, base, key) ?? undefined;}
        delete f.url_hi;
      }
      return rows;
    },
  };
}


/* The hi-res frame nearest a lo frame, for workers that don't return url_hi
 * (before #129). Only the API backend uses it, when it reads frames: the
 * timeline and grid take frame.hi and know no URL conventions. The preview
 * falls back to the lo frame if the hi image doesn't load. The contract fixes the image path
 * (/frame/{variant}/{site}/{source}/{ts}.jpg) and one signature covers both
 * variants, so the hi URL reuses the lo frame's own base and query: that
 * also works behind a data source, where the panel has no apiUrl. Falls back
 * to apiUrl for a frame URL without a /frame/ path. A bare URL gets the ?k=
 * key only on the API's origin (imageUrlWithKey). Site and id
 * are path segments, so they're encoded (#66). */
export function hiUrlFor(
  frame: Frame | null, decl: Pick<ApiSourceDecl, 'site' | 'id' | 'hiCadence'>, apiUrl?: string, apiKey?: string
): string | null {
  if (frame?.hi) {return frame.hi;}   // the source gave the preview itself
  if (!decl.hiCadence || !frame) {return null;}
  const url = frame.url || '';
  const qAt = url.indexOf('?');
  const path = qAt >= 0 ? url.slice(0, qAt) : url;
  const at = path.lastIndexOf('/frame/');
  const base = at >= 0 ? path.slice(0, at) : apiUrl ? apiUrl.replace(/\/+$/, '') : null;
  if (base === null) {return null;}
  const hiTs = Math.round(frame.ts / decl.hiCadence) * decl.hiCadence;
  const hi = base + '/frame/hi/' + encodeURIComponent(decl.site) + '/' + encodeURIComponent(decl.id) + '/' + hiTs + '.jpg';
  if (qAt >= 0) {return hi + url.slice(qAt);}
  // a bare URL gets the key only on the API's own origin, as strip images do
  return apiUrl ? imageUrlWithKey(hi, apiUrl, apiKey) : hi;
}
