import type { ApiFetch, Backend, Frame, SourceDecl } from '../types';

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
      if (!r.ok) {throw new Error('kiosks ' + r.status);}
      return r.json() as Promise<SourceDecl[]>;   // the API's contract; not validated
    },
    async frames(site, kiosk, from, to, step) {
      const r = await get(framesPath(site, kiosk, from, to, step));
      if (!r.ok) {throw new Error('frames ' + r.status);}
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
