/* Kiosk Timeline Worker — frame upload + query API over R2, static viewer assets.
 *
 * Contracts (docs/API.md). Nouns: a SITE groups image SOURCES.
 *   POST /upload                      JPEG body; X-Site, X-Source, X-Cadence (s),
 *                                     X-Variant (lo|hi), X-Timestamp? (ms, backfill),
 *                                     X-Location?, Authorization: Bearer <per-site
 *                                     token>. Timestamp snapped to the cadence grid.
 *                                     (X-Kiosk accepted as a deprecated alias.)
 *   GET  /sources?site=csv            → [{id, site, location, cadence, hiCadence}]
 *                                     (cadence ms; /kiosks is a deprecated alias)
 *   GET  /frames?site&source&from&to&step&variant
 *                                     → [{source, ts, url}], ≤1 frame per step
 *                                     bucket (source= falls back to kiosk=).
 *   GET  /frame/{variant}/{site}/{source}/{ts}.jpg
 *                                     immutable frame image (POC path; production
 *                                     serves images from an R2 custom domain and
 *                                     sets IMG_BASE so /frames URLs point there).
 *   everything else                   static viewer assets (../web).
 *
 * R2 layout: {variant}/{site}/{source}/{epoch-ms}.jpg  (epoch cadence-aligned),
 *            index.json — source registry {sites: {site: {source: {cadence,
 *            hiCadence, location, history: [{since, variant, cadence}]}}}},
 *            updated only when a declaration changes (etag-conditional, verified).
 */

const FRAME_CACHE = 'public, max-age=31536000, immutable';
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/;
const VARIANTS = new Set(['lo', 'hi']);
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const MAX_BUCKETS = 800;
const MAX_LIST_PAGES = 3;
const INDEX_KEY = 'index.json';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, x-site, x-source, x-kiosk, x-cadence, x-variant, x-timestamp, x-location, x-tags',
  'access-control-max-age': '86400',
};

/* Per-isolate memo of (site/source/variant/cadence) registrations. Only an
 * optimization: a cold isolate re-checks index.json once per source. Entries
 * expire so state the memo can't capture (a pause declared to another
 * isolate) is re-read within minutes — that recheck is what lets a resumed
 * source close its paused era in the registry. */
const REGISTERED_TTL = 5 * 60 * 1000;
const registered = new Map();
const isRegistered = (memo) => {
  const at = registered.get(memo);
  if (at && Date.now() - at < REGISTERED_TTL) {return true;}
  registered.delete(memo);
  return false;
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (request.method === 'OPTIONS') {return new Response(null, { status: 204, headers: CORS });}
      if (url.pathname === '/upload' && request.method === 'POST') {return await handleUpload(request, env);}
      if (url.pathname === '/declare' && request.method === 'POST') {return await handleDeclare(request, env);}
      const isData = url.pathname === '/sources' || url.pathname === '/kiosks' ||
                     url.pathname === '/frames' || url.pathname.startsWith('/frame/');
      if (isData && request.method === 'GET') {
        // viewer auth: when VIEWER_TOKEN is set, all data reads require it
        // (?k= for <img> URLs, Bearer for API calls). Unset = open (dev/demo).
        if (!(await viewerAuthorized(request, env, url))) {return json({ error: 'unauthorized' }, 401);}
        if (url.pathname === '/frames') {return await handleFrames(url, env, ctx);}
        if (url.pathname.startsWith('/frame/')) {return await handleFrame(url, env, ctx);}
        return await handleSources(url, env, ctx);   // /kiosks = deprecated alias
      }
      return env.ASSETS.fetch(request);
    } catch (err) {
      console.error(JSON.stringify({ msg: 'unhandled', path: url.pathname, error: String((err && err.stack) || err) }));
      return json({ error: 'internal error' }, 500);
    }
  },
};

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS, ...extra },
  });
}

/* ---------------- auth ---------------- */

async function viewerAuthorized(request, env, url) {
  if (!env.VIEWER_TOKEN) {return true;}
  const got = url.searchParams.get('k') ||
    (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!got) {return false;}
  return timingSafeEqual(env.VIEWER_TOKEN, got);
}

async function authorize(request, env, site) {
  let tokens;
  try { tokens = JSON.parse(env.UPLOAD_TOKENS || '{}'); } catch { tokens = {}; }
  const expected = tokens[site];
  const got = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!expected || !got) {return false;}
  return timingSafeEqual(expected, got);
}

/* Hash both sides first: constant-time compare without leaking length. */
async function timingSafeEqual(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  const va = new Uint8Array(ha), vb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < va.length; i++) {diff |= va[i] ^ vb[i];}
  return diff === 0;
}

/* ---------------- upload ---------------- */

async function handleUpload(request, env) {
  const site = (request.headers.get('x-site') || '').toLowerCase();
  const source = (request.headers.get('x-source') || request.headers.get('x-kiosk') || '').toLowerCase();
  const cadenceS = Number(request.headers.get('x-cadence'));
  const variant = (request.headers.get('x-variant') || 'lo').toLowerCase();
  const location = (request.headers.get('x-location') || '').toLowerCase().trim().slice(0, 64);
  const tags = parseTags(request.headers.get('x-tags'));

  if (!ID_RE.test(site) || !ID_RE.test(source)) {return json({ error: 'bad site/source' }, 400);}
  if (location && !/^[a-z0-9 _.-]+$/.test(location)) {return json({ error: 'bad location' }, 400);}
  if (!Number.isInteger(cadenceS) || cadenceS < 5 || cadenceS > 3600) {return json({ error: 'bad cadence' }, 400);}
  if (!VARIANTS.has(variant)) {return json({ error: 'bad variant' }, 400);}
  if (!(await authorize(request, env, site))) {return json({ error: 'unauthorized' }, 401);}

  const len = Number(request.headers.get('content-length') || 0);
  if (!len) {return json({ error: 'content-length required' }, 411);}
  if (len > MAX_UPLOAD_BYTES) {return json({ error: 'too large' }, 413);}

  const cadence = cadenceS * 1000;
  const now = Date.now();
  let ts = Number(request.headers.get('x-timestamp') || now);
  if (!Number.isFinite(ts) || ts < now - 7 * 864e5 || ts > now + 2 * cadence) {
    return json({ error: 'bad timestamp' }, 400);
  }
  ts = Math.round(ts / cadence) * cadence;   // snap to the cadence grid → deterministic keys

  const key = `${variant}/${site}/${source}/${ts}.jpg`;
  const body = await request.arrayBuffer();  // bounded by MAX_UPLOAD_BYTES
  await env.FRAMES.put(key, body, {
    httpMetadata: { contentType: 'image/jpeg', cacheControl: FRAME_CACHE },
  });
  await ensureRegistered(env, site, source, variant, cadence, ts, location, tags);
  return json({ ok: true, key, ts });
}

/* Free-form source tags: "env=prod,room=lobby" → {env: 'prod', room: 'lobby'}.
 * Keys [a-z0-9_-]{1,32}, values [a-z0-9 ._-]{1,64}, at most 8 pairs. */
function parseTags(raw) {
  if (!raw) {return null;}
  const tags = {};
  for (const part of String(raw).split(',').slice(0, 8)) {
    const i = part.indexOf('=');
    if (i <= 0) {continue;}
    const k = part.slice(0, i).trim().toLowerCase();
    const v = part.slice(i + 1).trim().toLowerCase();
    if (/^[a-z0-9_-]{1,32}$/.test(k) && /^[a-z0-9 ._-]{1,64}$/.test(v)) {tags[k] = v;}
  }
  return Object.keys(tags).length ? tags : null;
}

/* Register the source's declared cadence in index.json. Writes only when the
 * declaration changed; concurrent writers resolved by verify-after-write. */
async function ensureRegistered(env, site, source, variant, cadence, ts, location, tags) {
  const memo = `${site}/${source}/${variant}/${cadence}/${location || ''}/${JSON.stringify(tags || {})}`;
  if (isRegistered(memo)) {return;}
  const field = variant === 'hi' ? 'hiCadence' : 'cadence';

  for (let attempt = 0; attempt < 4; attempt++) {
    const cur = await env.FRAMES.get(INDEX_KEY);
    const index = cur ? await cur.json() : { sites: {} };
    const sources = (index.sites[site] ||= {});
    const entry = (sources[source] ||= { history: [] });
    const lastEvt = entry.history[entry.history.length - 1];
    const wasPaused = !!(lastEvt && lastEvt.paused);
    const cadChanged = entry[field] !== cadence;
    const locChanged = !!location && entry.location !== location;
    const tagsChanged = !!tags && JSON.stringify(entry.tags || null) !== JSON.stringify(tags);
    if (!cadChanged && !locChanged && !tagsChanged && !wasPaused) { registered.set(memo, Date.now()); return; }

    if (cadChanged || wasPaused) {
      entry[field] = cadence;
      entry.history.push({ since: ts, variant, cadence });   // resume and/or pace change
    }
    if (locChanged) {entry.location = location;}
    if (tagsChanged) {entry.tags = tags;}
    const opts = cur ? { onlyIf: { etagMatches: cur.etag } } : {};
    const put = await env.FRAMES.put(INDEX_KEY, JSON.stringify(index), opts);
    if (!put) {continue;}   // etag raced — reread and retry

    // creation race has no etag guard: verify our entry actually survived
    const check = await env.FRAMES.get(INDEX_KEY);
    const seen = check && (await check.json()).sites?.[site]?.[source];
    if (seen && seen[field] === cadence && (!location || seen.location === location) &&
        (!tags || JSON.stringify(seen.tags || null) === JSON.stringify(tags))) {
      registered.set(memo, Date.now());
      return;
    }
  }
  console.warn(JSON.stringify({ msg: 'index registration retries exhausted', site, source, variant }));
}

/* Cadence-event declaration: a source about to go deliberately silent says
 * so WHILE IT CAN STILL SPEAK — POST /declare with X-Event: pause. Resume
 * needs no declaration: the next frame is the resume, inferred client-side.
 * A source that dies unexpectedly never declares, so its silence renders as
 * offline — the heartbeat semantics survive. */
// pause REASONS: the pause is the cadence MECHANIC; the reason says what in
// the world caused it, and `intended` whether anyone asked for it. The
// timeline renders each differently — and unintended dark gets the amber
// triage treatment instead of the neutral hatch.
const PAUSE_REASONS = new Set(['quiet', 'screen-sleep', 'app-stopped', 'system-down']);

async function handleDeclare(request, env) {
  const site = (request.headers.get('x-site') || '').toLowerCase();
  const source = (request.headers.get('x-source') || request.headers.get('x-kiosk') || '').toLowerCase();
  const event = (request.headers.get('x-event') || '').toLowerCase();
  const reasonRaw = (request.headers.get('x-reason') || '').toLowerCase();
  const intendedRaw = (request.headers.get('x-intended') || '').trim();
  if (!ID_RE.test(site) || !ID_RE.test(source)) {return json({ error: 'bad site/source' }, 400);}
  if (event !== 'pause') {return json({ error: 'unknown event' }, 400);}
  const reason = PAUSE_REASONS.has(reasonRaw) ? reasonRaw : undefined;
  const intended = intendedRaw === '1' ? true : intendedRaw === '0' ? false : undefined;
  if (!(await authorize(request, env, site))) {return json({ error: 'unauthorized' }, 401);}

  for (let attempt = 0; attempt < 4; attempt++) {
    const cur = await env.FRAMES.get(INDEX_KEY);
    const index = cur ? await cur.json() : { sites: {} };
    const entry = index.sites?.[site]?.[source];
    if (!entry) {return json({ error: 'unknown source' }, 404);}
    const last = entry.history[entry.history.length - 1];
    // same pause re-declared = no-op; a DIFFERENT reason/intent while paused
    // pushes a new event so the band splits (quiet hours -> box shut down)
    if (last && last.paused && last.reason === reason && last.intended === intended)
      {return json({ ok: true, note: 'already paused' });}
    const evt = { since: Date.now(), variant: 'lo', paused: true };
    if (reason !== undefined) {evt.reason = reason;}
    if (intended !== undefined) {evt.intended = intended;}
    entry.history.push(evt);
    const put = await env.FRAMES.put(INDEX_KEY, JSON.stringify(index), { onlyIf: { etagMatches: cur.etag } });
    if (put) {
      // drop this isolate's memos so the next upload re-checks wasPaused
      for (const memo of registered.keys()) {
        if (memo.startsWith(`${site}/${source}/`)) {registered.delete(memo);}
      }
      return json({ ok: true });
    }
  }
  return json({ error: 'conflict' }, 409);
}

/* ---------------- sources ---------------- */

function parseCsv(v) {
  if (!v || v === 'All' || v === '$__all') {return null;}
  const parts = v.replace(/^\{|\}$/g, '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return parts.length ? parts : null;
}

async function handleSources(url, env, ctx) {
  const cache = caches.default;
  const cacheKey = new Request(new URL('/sources-index', url.origin));
  let res = await cache.match(cacheKey);
  if (!res) {
    const cur = await env.FRAMES.get(INDEX_KEY);
    const body = cur ? await cur.text() : '{"sites":{}}';
    res = new Response(body, {
      headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=15' },
    });
    ctx.waitUntil(cache.put(cacheKey, res.clone()));
  }
  const index = await res.json();
  const filter = parseCsv(url.searchParams.get('site'));
  const out = [];
  for (const [site, sources] of Object.entries(index.sites || {})) {
    if (filter && !filter.includes(site)) {continue;}
    for (const [id, meta] of Object.entries(sources)) {
      out.push({ id, site, location: meta.location, tags: meta.tags, cadence: meta.cadence, hiCadence: meta.hiCadence, history: meta.history });
    }
  }
  out.sort((a, b) => a.site.localeCompare(b.site) || a.id.localeCompare(b.id));
  return json(out, 200, { 'cache-control': 'public, max-age=15' });
}

/* ---------------- frames ---------------- */

async function handleFrames(url, env, ctx) {
  const site = (url.searchParams.get('site') || '').toLowerCase();
  const source = (url.searchParams.get('source') || url.searchParams.get('kiosk') || '').toLowerCase();
  const variant = (url.searchParams.get('variant') || 'lo').toLowerCase();
  let from = Number(url.searchParams.get('from'));
  let to = Number(url.searchParams.get('to'));
  const step = Number(url.searchParams.get('step'));

  if (!ID_RE.test(site) || !ID_RE.test(source) || !VARIANTS.has(variant)) {return json({ error: 'bad params' }, 400);}
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {return json({ error: 'bad range' }, 400);}
  if (to === from) {return json([]);}   // zero-width window: legitimate degenerate ask, not an error
  if (!Number.isInteger(step) || step < 1000) {return json({ error: 'bad step' }, 400);}

  // snap the window to the step grid → auto-refresh jitter hits the same cache entry
  from = Math.floor(from / step) * step;
  to = Math.ceil(to / step) * step;
  if ((to - from) / step > MAX_BUCKETS) {return json({ error: 'too many buckets' }, 400);}

  const canonical = new URL('/frames', url.origin);
  for (const [k, v] of [['site', site], ['source', source], ['variant', variant], ['from', from], ['to', to], ['step', step]]) {
    canonical.searchParams.set(k, v);
  }
  const cache = caches.default;
  const cacheKey = new Request(canonical);
  const hit = await cache.match(cacheKey);
  if (hit) {return hit;}

  // One bounded LIST over the kiosk/variant prefix. Keys are 13-digit epochs,
  // so lexicographic order == numeric order and startAfter can seek to `from`.
  const prefix = `${variant}/${site}/${source}/`;
  const bucketStart = Math.ceil(from / step) * step;
  const best = new Map();   // bucket idx → {ts, dist to bucket tick}
  let cursor, done = false, pages = 0;
  while (!done && pages < MAX_LIST_PAGES) {
    const listing = await env.FRAMES.list({
      prefix,
      limit: 1000,
      ...(cursor ? { cursor } : { startAfter: `${prefix}${from - 1}` }),
    });
    pages++;
    for (const obj of listing.objects) {
      const ts = Number(obj.key.slice(prefix.length, -4));
      if (!Number.isFinite(ts)) {continue;}
      if (ts > to) { done = true; break; }
      const idx = Math.round((ts - bucketStart) / step);
      const dist = Math.abs(ts - (bucketStart + idx * step));
      const cur = best.get(idx);
      if (!cur || dist < cur.dist) {best.set(idx, { ts, dist });}
    }
    if (!listing.truncated) {done = true;}
    else {cursor = listing.cursor;}
  }

  const base = env.IMG_BASE || url.origin;
  const frames = [...best.values()]
    .map(v => v.ts)
    .sort((a, b) => a - b)
    .map(ts => ({ source, ts, url: `${base}/frame/${variant}/${site}/${source}/${ts}.jpg` }));

  const live = to > Date.now() - step;
  const res = json(frames, 200, { 'cache-control': `public, max-age=${live ? 15 : 3600}` });
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

/* ---------------- frame image (POC path; prod = R2 custom domain) ---------------- */

async function handleFrame(url, env, ctx) {
  const m = url.pathname.match(/^\/frame\/(lo|hi)\/([a-z0-9_-]+)\/([a-z0-9_-]+)\/(\d{10,14})\.jpg$/);
  if (!m) {return json({ error: 'not found' }, 404);}

  const cache = caches.default;
  const cacheKey = new Request(new URL(url.pathname, url.origin));
  const hit = await cache.match(cacheKey);
  if (hit) {return hit;}

  const obj = await env.FRAMES.get(url.pathname.slice('/frame/'.length));
  if (!obj) {
    // cache misses briefly so a gap-heavy window doesn't hammer R2
    return new Response('not found', { status: 404, headers: { 'cache-control': 'public, max-age=30', ...CORS } });
  }
  const res = new Response(obj.body, {
    headers: { 'content-type': 'image/jpeg', 'cache-control': FRAME_CACHE, etag: obj.httpEtag, ...CORS },
  });
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}
