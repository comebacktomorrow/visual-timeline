import type { ApiFetch, ApiResponse, Backend, Frame, SourceDecl } from '../types';

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
export function framesPath(site: string, kiosk: string, from: number, to: number, step: number): string {
  const q = new URLSearchParams();
  q.set('site', site);
  q.set('source', kiosk);
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
  return {
    async kiosks(sites) {
      const r = await get(sourcesPath(sites));
      if (!r.ok) {throw await apiError('sources', r, !!apiFetch);}
      return r.json() as Promise<SourceDecl[]>;   // the API's contract; not validated
    },
    async frames(site, kiosk, from, to, step) {
      const r = await get(framesPath(site, kiosk, from, to, step));
      if (!r.ok) {throw await apiError('frames', r, !!apiFetch);}
      const frames = (await r.json()) as Frame[];   // the API's contract; not validated
      for (const f of frames) {
        f.url = apiFetch ? resolveFrameUrl(f.url, base) : imageUrlWithKey(f.url, base, key);
      }
      return frames;
    },
  };
}


/* Nearest hi-variant URL for the click-in preview (API mode only); the
 * preview falls back to the lo frame if the hi key 404s. The lo frame's
 * query string is reused verbatim: it carries whatever authorization the
 * backend chose (a source-scoped signature covers hi too, and an appended
 * viewer key is the same key) — this is the only image URL built
 * client-side, so it can't mint its own signature. */
/* The hi-res frame nearest a lo frame. The contract fixes the image path
 * (/frame/{variant}/{site}/{source}/{ts}.jpg) and one signature covers both
 * variants, so the hi URL reuses the lo frame's own base and query: that
 * also works behind a data source, where the panel has no apiUrl. Falls back
 * to apiUrl (+ ?k= key) for a frame URL without a /frame/ path. Site and id
 * are path segments, so they're encoded (#66). */
export function hiUrlFor(
  frame: Frame | null, decl: Pick<SourceDecl, 'site' | 'id' | 'hiCadence'>, apiUrl?: string, apiKey?: string
): string | null {
  if (!decl.hiCadence || !frame) {return null;}
  const url = frame.url || '';
  const qAt = url.indexOf('?');
  const path = qAt >= 0 ? url.slice(0, qAt) : url;
  const at = path.lastIndexOf('/frame/');
  const base = at >= 0 ? path.slice(0, at) : apiUrl ? apiUrl.replace(/\/+$/, '') : null;
  if (base === null) {return null;}
  const q = qAt >= 0 ? url.slice(qAt) : apiKey ? '?k=' + encodeURIComponent(apiKey) : '';
  const hiTs = Math.round(frame.ts / decl.hiCadence) * decl.hiCadence;
  return base + '/frame/hi/' + encodeURIComponent(decl.site) + '/' + encodeURIComponent(decl.id) + '/' + hiTs + '.jpg' + q;
}
