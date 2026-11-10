/* Kiosk Timeline Worker — frame upload + query API over R2, static viewer assets.
 *
 * Contracts (docs/API.md). Nouns: a SITE groups image SOURCES.
 *   POST /upload                      JPEG body; X-Site, X-Source, X-Cadence (s),
 *                                     X-Variant (lo|hi), X-Timestamp? (ms, backfill),
 *                                     X-Location?, X-Timezone? (IANA name),
 *                                     Authorization: Bearer <per-site token>.
 *                                     Timestamp snapped to the cadence grid.
 *                                     (X-Kiosk accepted as a deprecated alias.)
 *   GET  /sources?site=csv            → [{id, site, location, timezone, cadence, hiCadence}]
 *                                     (cadence ms; /kiosks is a deprecated alias)
 *   GET  /frames?site&source&from&to&step&variant
 *                                     → [{site, source, ts, url}], ≤1 frame per
 *                                     step bucket (source= falls back to kiosk=);
 *                                     X-Frames-Truncated-After: <ts> when the
 *                                     window holds more than one scan covers.
 *                                     Without source: every source of the sites
 *                                     (site= csv, omitted = all), each at its own
 *                                     cadence or coarser, one row per frame, for
 *                                     a table-shaped data source such as Infinity.
 *   GET  /states?site=csv&sources=csv&to=
 *                                     → [{time, site, source, state}]: each
 *                                     source's declared pauses as state rows
 *                                     (the reason, ":unexpected" when nobody
 *                                     intended it; "" when it ends), for a
 *                                     state query (Infinity).
 *   GET  /frame/{variant}/{site}/{source}/{ts}.jpg
 *                                     immutable frame image (POC path; production
 *                                     serves images from an R2 custom domain and
 *                                     sets IMG_BASE so /frames URLs point there).
 *   everything else                   static viewer assets (../web).
 *
 * Retention (optional): RETENTION_DAYS (and RETENTION_DAYS_HI for the hi
 * variant) deletes older frames, pruned after uploads; /sources then starts
 * each source's history with a "no data" pause ending at the cutoff.
 *
 * Frame index (optional, #44): with a D1 database bound as DB, /upload also
 * records each frame in a D1 table, and /frames reads that instead of
 * listing R2: no scan cap, and key lists are cached in 6-hour chunks that
 * every zoom level and viewer share. POST /reindex (a site's upload token)
 * fills the table from what R2 already holds. Without DB, /frames lists R2.
 *
 * Image delivery: /frames hands out image URLs on this worker (/frame/…,
 * signed when IMG_SIGN_KEY is set), on IMG_BASE (a public bucket domain), or,
 * with IMG_DELIVERY=presigned and an R2 API token, as R2 presigned links
 * that browsers load straight from R2 without a worker request (#129).
 * Rows carry url_hi, the hi-res frame nearest each one, when the source
 * uploads a hi variant.
 *
 * R2 layout: {variant}/{site}/{source}/{epoch-ms}.jpg  (epoch cadence-aligned),
 *            index.json — source registry {sites: {site: {source: {cadence,
 *            hiCadence, location, timezone, history: [{since, variant, cadence}]}}}},
 *            updated only when a declaration changes (etag-conditional, verified).
 */

import { presignUrl, rfc3986 } from './presign.js';

const FRAME_CACHE = 'public, max-age=31536000, immutable';
// signed image URLs change only when their expiry block does (handleFrames)
const SIG_BLOCK_MS = 6 * 3600 * 1000;
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/;
const VARIANTS = new Set(['lo', 'hi']);
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const MAX_BUCKETS = 800;
/* /frames must see every key in the window to pick each bucket's frame, so
 * the scan cap bounds how many frames one request can cover: 25 pages of
 * 1000 is about 17 days at a 60 s cadence. Past it the response says where
 * it stopped (X-Frames-Truncated-After) instead of dropping the newest
 * frames silently. */
const MAX_LIST_PAGES = 25;
/* An all-sources /frames shares one scan budget across its sources: R2 calls
 * count toward the per-request subrequest limit (1000 to Cloudflare services
 * on the free plan), and walking keys costs CPU time (10 ms on the free plan). */
const MAX_LIST_PAGES_ALL = 50;
const SCAN_CONCURRENCY = 6;
/* The frame index answers in fixed, epoch-aligned chunks, cached with the
 * Cache API: a chunk's key list doesn't depend on step, so every zoom level
 * and every viewer shares it. A chunk is "live" (cached briefly) until a
 * while after it ends, so late frames on its last ticks still show. */
const CHUNK_MS = 6 * 3600 * 1000;
const CHUNK_LIVE_FOR = 10 * 60 * 1000;
const INDEX_KEY = 'index.json';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, x-site, x-source, x-kiosk, x-cadence, x-variant, x-timestamp, x-location, x-timezone, x-tags',
  'access-control-expose-headers': 'x-frames-truncated-after, x-frames-truncated-sources',
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
      if (url.pathname === '/upload' && request.method === 'POST') {return await handleUpload(request, env, ctx);}
      if (url.pathname === '/declare' && request.method === 'POST') {return await handleDeclare(request, env);}
      if (url.pathname === '/reindex' && request.method === 'POST') {return await handleReindex(request, env, url);}
      const isData = url.pathname === '/sources' || url.pathname === '/kiosks' || url.pathname === '/states' ||
                     url.pathname === '/frames' || url.pathname.startsWith('/frame/');
      if (isData && request.method === 'GET') {
        // viewer auth: when VIEWER_TOKEN is set, all data reads require it
        // (?k= for <img> URLs, Bearer for API calls). Unset = open (dev/demo).
        const viewer = await viewerFor(request, env, url);
        if (!viewer) {return json({ error: 'unauthorized' }, 401);}
        if (url.pathname === '/frames') {return await handleFrames(url, env, ctx, viewer);}
        if (url.pathname === '/states') {return await handleStates(url, env, ctx, viewer);}
        if (url.pathname.startsWith('/frame/')) {return await handleFrame(url, env, ctx, viewer);}
        return await handleSources(url, env, ctx, viewer);   // /kiosks = deprecated alias
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

/* Resolve the requesting viewer. Returns {sites} when authorized — sites
 * null = every site, an array = only those — or null when not.
 *
 * VIEWER_TOKEN is either a single token string (one shared key) or a JSON
 * map of named consumers, so a leaked dashboard costs one revocable entry:
 *   {"grafana-cloud": "tok...",
 *    "lobby-wall": {"token": "tok...", "sites": ["site-a"]}}
 */
async function viewerFor(request, env, url) {
  // a signed image URL is its own authorization: scoped to one source,
  // expiring, and mintable only by this worker — so the long-lived viewer
  // token never has to ride in <img> URLs (browser history, dashboard
  // JSON, request logs)
  if (env.IMG_SIGN_KEY && url.pathname.startsWith('/frame/')) {
    const e = Number(url.searchParams.get('e'));
    const sig = url.searchParams.get('sig') || '';
    const m = url.pathname.match(/^\/frame\/(?:lo|hi)\/([a-z0-9_-]+)\/([a-z0-9_-]+)\//);
    if (m && sig && Number.isFinite(e) && Date.now() < e &&
        (await timingSafeEqual(await signScope(env, m[1], m[2], e), sig))) {
      return { sites: [m[1]] };   // the signature already binds the site
    }
  }
  if (!env.VIEWER_TOKEN) {return { sites: null };}
  const got = url.searchParams.get('k') ||
    (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!got) {return null;}
  const raw = env.VIEWER_TOKEN.trim();
  if (!raw.startsWith('{')) {
    return (await timingSafeEqual(raw, got)) ? { sites: null } : null;
  }
  let map;
  try { map = JSON.parse(raw); } catch { return null; }
  for (const entry of Object.values(map)) {
    const token = typeof entry === 'string' ? entry : entry && entry.token;
    if (token && (await timingSafeEqual(token, got))) {
      const sites = entry && typeof entry === 'object' && Array.isArray(entry.sites) && entry.sites.length
        ? entry.sites.map((s) => String(s).toLowerCase())
        : null;
      return { sites };
    }
  }
  return null;
}

/* Source-scoped image-URL signature: HMAC(site/source|expiry). One
 * signature covers every frame (lo AND hi) of that source until expiry,
 * so /frames mints exactly one per response and the client can reuse the
 * query string when it constructs hi-variant URLs itself. */
let signKey = null;
async function signScope(env, site, source, exp) {
  if (!signKey) {
    signKey = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(env.IMG_SIGN_KEY),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  }
  const mac = await crypto.subtle.sign(
    'HMAC', signKey, new TextEncoder().encode(`${site}/${source}|${exp}`));
  let hex = '';
  for (const b of new Uint8Array(mac)) {hex += b.toString(16).padStart(2, '0');}
  return hex;
}

/* ---------------- R2 presigned links (optional, #129) ---------------- */

/* IMG_DELIVERY=presigned hands out SigV4 query-signed GET links to R2's S3
 * endpoint, so each image view is one R2 read and no worker request. Needs
 * an R2 API token with read access to the bucket (R2_ACCESS_KEY_ID,
 * R2_SECRET_ACCESS_KEY), the account's S3 endpoint (R2_S3_ENDPOINT,
 * https://<account>.r2.cloudflarestorage.com) and the bucket's name
 * (R2_BUCKET). A link is signed as of the start of its 6-hour block and
 * lasts 30 hours, so every response within a block hands out the same URL
 * (browsers cache by URL) and each stays valid for at least a day. */
const PRESIGN_SECONDS = 30 * 3600;
/* signed URLs are kept per block, so a refresh signs only frames it hasn't seen */
const presigned = new Map();
const PRESIGNED_MAX = 50000;
let presignWarned = false;
function presignConfig(env) {
  if ((env.IMG_DELIVERY || '').toLowerCase() !== 'presigned' || env.IMG_BASE) {return null;}
  const { R2_ACCESS_KEY_ID: id, R2_SECRET_ACCESS_KEY: secret, R2_S3_ENDPOINT: endpoint, R2_BUCKET: bucket } = env;
  if (!id || !secret || !endpoint || !bucket) {
    if (!presignWarned) {
      presignWarned = true;
      console.error(JSON.stringify({ msg: 'IMG_DELIVERY=presigned needs R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_S3_ENDPOINT and R2_BUCKET; serving images from the worker' }));
    }
    return null;
  }
  let base = endpoint;
  while (base.endsWith('/')) {base = base.slice(0, -1);}   // a loop, not a regex: see imageBase
  return { id, secret, endpoint: base, bucket, region: 'auto' };
}

/* An R2 object's presigned link, path-style on the S3 endpoint. */
async function presignedFrameUrl(cfg, key) {
  const at = Math.floor(Date.now() / SIG_BLOCK_MS) * SIG_BLOCK_MS;
  const memo = `${at}|${cfg.bucket}|${key}`;
  const hit = presigned.get(memo);
  if (hit) {return hit;}
  const u = new URL(cfg.endpoint);
  const path = '/' + [cfg.bucket, ...key.split('/')].map(rfc3986).join('/');
  const url = await presignUrl(cfg, u.host, path, at, PRESIGN_SECONDS);
  if (presigned.size >= PRESIGNED_MAX) {presigned.clear();}
  presigned.set(memo, url);
  return url;
}

/* A key's value only if the object itself has it. Parsed JSON inherits from
 * Object.prototype, and ID_RE admits "constructor": tokens["constructor"] is
 * the Object function, whose string form is public. */
function own(obj, key) {
  return obj && typeof obj === 'object' && Object.hasOwn(obj, key) ? obj[key] : undefined;
}

async function authorize(request, env, site) {
  let tokens;
  try { tokens = JSON.parse(env.UPLOAD_TOKENS || '{}'); } catch { tokens = {}; }
  const expected = own(tokens, site);
  const got = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (typeof expected !== 'string' || !expected || !got) {return false;}
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

async function handleUpload(request, env, ctx) {
  const site = (request.headers.get('x-site') || '').toLowerCase();
  const source = (request.headers.get('x-source') || request.headers.get('x-kiosk') || '').toLowerCase();
  const cadenceS = Number(request.headers.get('x-cadence'));
  const variant = (request.headers.get('x-variant') || 'lo').toLowerCase();
  const location = (request.headers.get('x-location') || '').toLowerCase().trim().slice(0, 64);
  const tags = parseTags(request.headers.get('x-tags'));
  const tzRaw = (request.headers.get('x-timezone') || '').trim();
  const timezone = tzRaw ? canonicalZone(tzRaw) : '';

  if (!ID_RE.test(site) || !ID_RE.test(source)) {return json({ error: 'bad site/source' }, 400);}
  if (location && !/^[a-z0-9 _.-]+$/.test(location)) {return json({ error: 'bad location' }, 400);}
  if (tzRaw && !timezone) {
    return json({ error: 'bad timezone: X-Timezone must be an IANA time zone name such as Europe/London or UTC' }, 400);
  }
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
  if (env.DB) {
    // a frame the index missed is invisible until POST /reindex finds it, so
    // say so loudly; the upload itself succeeded
    try {
      await indexFrames(env, [[site, source, variant, ts]]);
    } catch (err) {
      console.error(JSON.stringify({ msg: 'frame index write failed', site, source, variant, ts, error: String(err) }));
    }
  }
  await ensureRegistered(env, site, source, variant, cadence, ts, location, tags, timezone);
  if (retentionMs(env, 'lo') || retentionMs(env, 'hi')) {ctx.waitUntil(pruneSite(env, site, source));}
  return json({ ok: true, key, ts });
}

/* ---------------- retention ---------------- */

/* RETENTION_DAYS keeps that many days of frames; RETENTION_DAYS_HI, if set,
 * overrides it for the hi variant (hi-res frames are the big ones). Unset or
 * not a positive number = keep everything. */
function retentionMs(env, variant) {
  const raw = variant === 'hi' && env.RETENTION_DAYS_HI !== undefined ? env.RETENTION_DAYS_HI : env.RETENTION_DAYS;
  const days = Number(raw);
  return Number.isFinite(days) && days > 0 ? days * 864e5 : 0;
}

/* Pruning runs after uploads (ctx.waitUntil), so it needs no scheduler and
 * works the same on Cloudflare and self-hosted. Each source is pruned at most
 * once an hour per isolate; the uploading source triggers a sweep of its
 * whole site, so a source that stopped uploading still ages out. Keys end in
 * a fixed-width epoch, so a prefix listing is oldest first: delete from the
 * front and stop at the first frame inside the window. A long backlog (the
 * first prune after enabling retention) is worked off a few thousand frames
 * per source per run. */
const PRUNE_EVERY = 3600 * 1000;
const PRUNE_PAGES = 5;
const PRUNE_SOURCES = 20;
const pruned = new Map();

async function pruneSite(env, site, uploader) {
  try {
    const now = Date.now();
    if (now - (pruned.get(`${site}/${uploader}`) || 0) < PRUNE_EVERY) {return;}
    const cur = await env.FRAMES.get(INDEX_KEY);
    const sources = cur ? Object.keys(own((await cur.json()).sites, site) || {}) : [];
    if (!sources.includes(uploader)) {sources.push(uploader);}
    const due = sources.filter((src) => now - (pruned.get(`${site}/${src}`) || 0) >= PRUNE_EVERY)
      .slice(0, PRUNE_SOURCES);
    for (const src of due) {
      pruned.set(`${site}/${src}`, now);
      for (const variant of VARIANTS) {await pruneSource(env, variant, site, src, now);}
    }
  } catch (err) {
    console.warn(JSON.stringify({ msg: 'retention prune failed', site, error: String(err) }));
  }
}

async function pruneSource(env, variant, site, source, now) {
  const keep = retentionMs(env, variant);
  if (!keep) {return 0;}
  const cutoff = now - keep;
  const prefix = `${variant}/${site}/${source}/`;
  let deleted = 0;
  for (let page = 0; page < PRUNE_PAGES; page++) {
    const listed = await env.FRAMES.list({ prefix, limit: 1000 });
    const old = listed.objects.map((o) => o.key)
      .filter((k) => Number(k.slice(prefix.length, -'.jpg'.length)) < cutoff);
    if (old.length) {await env.FRAMES.delete(old); deleted += old.length;}
    if (old.length < listed.objects.length || !listed.truncated) {break;}
  }
  if (env.DB && deleted) {
    await ensureSchema(env);
    await env.DB.prepare('DELETE FROM frames WHERE site = ?1 AND source = ?2 AND variant = ?3 AND ts < ?4')
      .bind(site, source, variant, cutoff).run();
  }
  if (deleted) {console.log(JSON.stringify({ msg: 'retention pruned', variant, site, source, deleted }));}
  return deleted;
}

/* What /sources reports under retention: the source's history from the
 * cutoff on, led by a pause with reason "expired" that ends at the cutoff,
 * so viewers draw the deleted past as "no data" rather than as offline. The
 * event in force at the cutoff is restated at the cutoff; older ones go.
 * The pause must ALWAYS be closed by a lo event at the cutoff: viewers draw
 * a closed pause whole, but an open (last) one only until the first frame,
 * so a history that is empty or starts after the cutoff would otherwise
 * blank real frames. With no lo event in force there, the source's leading
 * pace is restated (the first lo event's cadence, else the registered one,
 * as the viewers' own era logic does). */
function retainedHistory(history, cutoff, cadence) {
  const out = [{ since: 0, variant: 'lo', paused: true, reason: 'expired', intended: true }];
  const inForce = new Map();
  const later = [];
  const sorted = [...(history || [])].sort((a, b) => a.since - b.since);
  for (const h of sorted) {
    if (h.since <= cutoff) {inForce.set(h.variant || 'lo', h);} else {later.push(h);}
  }
  if (!inForce.has('lo')) {
    const firstLo = sorted.find((h) => (h.variant || 'lo') === 'lo');
    inForce.set('lo', { variant: 'lo', cadence: (firstLo && firstLo.cadence) || cadence || 60000 });
  }
  for (const h of inForce.values()) {out.push({ ...h, since: cutoff });}
  return out.concat(later);
}

/* X-Timezone: where the source is, so viewers can label its clock. An IANA
 * name from the runtime's list (matched case-insensitively, stored in the
 * list's spelling), or UTC. A name the list doesn't carry but Intl still
 * resolves is kept as sent when it has the Area/Location shape: runtimes
 * list older canonical names (Asia/Calcutta, not Asia/Kolkata) and newer
 * tzdata renames must not be refused. Offsets ("+05:00") and abbreviations
 * ("EST") are not zones. Returns '' when invalid. */
let zoneList = null;
function canonicalZone(raw) {
  if (raw.length > 64) {return '';}
  if (/^(?:etc\/)?(?:utc|uct|zulu|universal)$/i.test(raw)) {return 'UTC';}
  if (!zoneList) {
    zoneList = new Map();
    const names = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
    for (const n of names) {zoneList.set(n.toLowerCase(), n);}
  }
  const listed = zoneList.get(raw.toLowerCase());
  if (listed) {return listed;}
  if (!/^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+)+$/.test(raw)) {return '';}
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: raw });
    return raw;
  } catch {
    return '';
  }
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
async function ensureRegistered(env, site, source, variant, cadence, ts, location, tags, timezone) {
  const memo = `${site}/${source}/${variant}/${cadence}/${location || ''}/${timezone || ''}/${JSON.stringify(tags || {})}`;
  if (isRegistered(memo)) {return;}
  const field = variant === 'hi' ? 'hiCadence' : 'cadence';

  for (let attempt = 0; attempt < 4; attempt++) {
    const cur = await env.FRAMES.get(INDEX_KEY);
    const index = cur ? await cur.json() : { sites: {} };
    const sources = own(index.sites, site) || (index.sites[site] = {});
    const entry = own(sources, source) || (sources[source] = { history: [] });
    const lastEvt = entry.history[entry.history.length - 1];
    const wasPaused = !!(lastEvt && lastEvt.paused);
    const cadChanged = entry[field] !== cadence;
    const locChanged = !!location && entry.location !== location;
    const tzChanged = !!timezone && entry.timezone !== timezone;
    const tagsChanged = !!tags && JSON.stringify(entry.tags || null) !== JSON.stringify(tags);
    if (!cadChanged && !locChanged && !tzChanged && !tagsChanged && !wasPaused) { registered.set(memo, Date.now()); return; }

    if (cadChanged || wasPaused) {
      entry[field] = cadence;
      entry.history.push({ since: ts, variant, cadence });   // resume and/or pace change
    }
    if (locChanged) {entry.location = location;}
    if (tzChanged) {entry.timezone = timezone;}
    if (tagsChanged) {entry.tags = tags;}
    const opts = cur ? { onlyIf: { etagMatches: cur.etag } } : {};
    const put = await env.FRAMES.put(INDEX_KEY, JSON.stringify(index), opts);
    if (!put) {continue;}   // etag raced — reread and retry

    // creation race has no etag guard: verify our entry actually survived
    const check = await env.FRAMES.get(INDEX_KEY);
    const seen = check && own(own((await check.json()).sites, site), source);
    if (seen && seen[field] === cadence && (!location || seen.location === location) &&
        (!timezone || seen.timezone === timezone) &&
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
    const entry = own(own(index.sites, site), source);
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

/* index.json through a 15 s edge cache, shared by /sources and the
 * all-sources /frames: a dashboard load asks for both, many times over. */
async function readIndex(url, env, ctx) {
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
  return res.json();
}

async function handleSources(url, env, ctx, viewer) {
  const index = await readIndex(url, env, ctx);
  const filter = parseCsv(url.searchParams.get('site'));
  const keep = retentionMs(env, 'lo');
  const cutoff = keep ? Date.now() - keep : 0;
  const out = [];
  for (const [site, sources] of Object.entries(index.sites || {})) {
    // the shared cached index is post-filtered per request: a site-scoped
    // viewer simply doesn't see out-of-scope sites
    if (viewer.sites && !viewer.sites.includes(site)) {continue;}
    if (filter && !filter.includes(site)) {continue;}
    for (const [id, meta] of Object.entries(sources)) {
      const history = keep ? retainedHistory(meta.history, cutoff, meta.cadence) : meta.history;
      out.push({ id, site, location: meta.location, timezone: meta.timezone, tags: meta.tags, cadence: meta.cadence, hiCadence: meta.hiCadence, history });
    }
  }
  out.sort((a, b) => a.site.localeCompare(b.site) || a.id.localeCompare(b.id));
  return json(out, 200, { 'cache-control': 'public, max-age=15' });
}

/* GET /states: each source's declared pauses as rows of time, site,
 * source and state, the shape a state query reads (#126, M4). A pause's row
 * holds its reason ("paused" without one), with ":unexpected" when the
 * source said nobody intended it; the event that ends it (a resume or a new
 * pace) is a row with an empty state. Under retention, the "expired" pause
 * leads each history, as /sources reports it. to= leaves out later events. */
async function handleStates(url, env, ctx, viewer) {
  const wanted = parseCsv(url.searchParams.get('site'));
  const only = parseCsv(url.searchParams.get('sources'));
  if (![wanted, only].every((l) => !l || l.every((x) => ID_RE.test(x)))) {return json({ error: 'bad params' }, 400);}
  const to = url.searchParams.has('to') ? Number(url.searchParams.get('to')) : Infinity;
  if (Number.isNaN(to)) {return json({ error: 'bad range' }, 400);}
  const index = await readIndex(url, env, ctx);
  const keep = retentionMs(env, 'lo');
  const cutoff = keep ? Date.now() - keep : 0;
  const rows = [];
  for (const [site, sources] of Object.entries(index.sites || {}).sort(([a], [b]) => a.localeCompare(b))) {
    if ((viewer.sites && !viewer.sites.includes(site)) || (wanted && !wanted.includes(site))) {continue;}
    for (const [source, meta] of Object.entries(sources).sort(([a], [b]) => a.localeCompare(b))) {
      if (only && !only.includes(source)) {continue;}
      const history = (keep ? retainedHistory(meta.history, cutoff, meta.cadence) : meta.history || [])
        .filter((h) => (h.variant || 'lo') === 'lo' && h.since <= to)
        .sort((a, b) => a.since - b.since);
      let paused = false;
      for (const h of history) {
        if (h.paused) {
          rows.push({ time: h.since, site, source, state: (h.reason || 'paused') + (h.intended === false ? ':unexpected' : '') });
          paused = true;
        } else if (paused) {
          rows.push({ time: h.since, site, source, state: '' });
          paused = false;
        }
      }
    }
  }
  return json(rows, 200, { 'cache-control': 'public, max-age=15' });
}

/* ---------------- frame index (D1, optional) ---------------- */

/* The table is created on first use in each isolate, so binding a fresh D1
 * database is all the setup it needs. One row per frame; the key orders rows
 * as /frames reads them (a source's frames by time). */
const schemaReady = new WeakMap();   // per database binding
function ensureSchema(env) {
  let ready = schemaReady.get(env.DB);
  if (!ready) {
    ready = env.DB.prepare(
      'CREATE TABLE IF NOT EXISTS frames (site TEXT NOT NULL, source TEXT NOT NULL, variant TEXT NOT NULL, ' +
      'ts INTEGER NOT NULL, PRIMARY KEY (site, source, variant, ts)) WITHOUT ROWID'
    ).run().catch((err) => { schemaReady.delete(env.DB); throw err; });
    schemaReady.set(env.DB, ready);
  }
  return ready;
}

/* Rows of [site, source, variant, ts], 25 to a statement: D1 binds at most
 * 100 parameters per query. A frame already indexed is left as it is. */
async function indexFrames(env, rows) {
  if (!rows.length) {return;}
  await ensureSchema(env);
  const stmts = [];
  for (let i = 0; i < rows.length; i += 25) {
    const part = rows.slice(i, i + 25);
    stmts.push(env.DB.prepare(
      'INSERT OR IGNORE INTO frames (site, source, variant, ts) VALUES ' + part.map(() => '(?, ?, ?, ?)').join(', ')
    ).bind(...part.flat()));
  }
  await env.DB.batch(stmts);
}

/* One source's indexed frame times in [from, to], sorted, read chunk by
 * chunk through the Cache API. */
async function indexedTimes(env, ctx, origin, variant, site, source, from, to) {
  await ensureSchema(env);
  const cache = caches.default;
  const now = Date.now();
  const out = [];
  for (let c = Math.floor(from / CHUNK_MS) * CHUNK_MS; c <= to; c += CHUNK_MS) {
    const key = new Request(`${origin}/frames-index/${variant}/${site}/${source}/${c}`);
    let res = await cache.match(key);
    if (!res) {
      const { results } = await env.DB.prepare(
        'SELECT ts FROM frames WHERE site = ?1 AND source = ?2 AND variant = ?3 AND ts >= ?4 AND ts < ?5 ORDER BY ts'
      ).bind(site, source, variant, c, c + CHUNK_MS).all();
      const live = c + CHUNK_MS > now - CHUNK_LIVE_FOR;
      res = new Response(JSON.stringify(results.map((r) => r.ts)), {
        headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${live ? 15 : 3600}` },
      });
      ctx.waitUntil(cache.put(key, res.clone()));
    }
    for (const ts of await res.json()) {
      if (ts >= from && ts <= to) {out.push(ts);}
    }
  }
  return out;
}

/* POST /reindex, with a site's upload token: fill the frame index from the
 * frames R2 already holds for that site (for a database bound to an existing
 * bucket, or to repair a missed write). Works through up to REINDEX_PAGES
 * pages of 1000 keys a call and answers where to carry on: call again with
 * ?cursor=<cursor> until done is true. Indexing a frame twice is harmless. */
const REINDEX_PAGES = 5;
async function handleReindex(request, env, url) {
  const site = (request.headers.get('x-site') || '').toLowerCase();
  if (!ID_RE.test(site)) {return json({ error: 'bad site' }, 400);}
  if (!(await authorize(request, env, site))) {return json({ error: 'unauthorized' }, 401);}
  if (!env.DB) {return json({ error: 'no frame index: bind a D1 database as DB' }, 400);}
  // the cursor is "<variant>:<R2 cursor>", so one walk covers lo then hi
  const [startVariant, startCursor] = (url.searchParams.get('cursor') || 'lo:').split(/:(.*)/s);
  const variants = [...VARIANTS];
  let v = Math.max(0, variants.indexOf(startVariant));
  let cursor = startCursor || undefined;
  let indexed = 0;
  for (let page = 0; page < REINDEX_PAGES && v < variants.length; page++) {
    const prefix = `${variants[v]}/${site}/`;
    const listing = await env.FRAMES.list({ prefix, limit: 1000, ...(cursor ? { cursor } : {}) });
    const rows = [];
    for (const obj of listing.objects) {
      const m = obj.key.slice(prefix.length).match(/^([a-z0-9][a-z0-9_-]{0,62})\/(\d{13})\.jpg$/);
      if (m) {rows.push([site, m[1], variants[v], Number(m[2])]);}
    }
    await indexFrames(env, rows);
    indexed += rows.length;
    if (listing.truncated) {cursor = listing.cursor;}
    else { v++; cursor = undefined; }
  }
  const done = v >= variants.length;
  return json({ ok: true, site, indexed, done, ...(done ? {} : { cursor: `${variants[v]}:${cursor || ''}` }) });
}

/* ---------------- frames ---------------- */

/* One source's frames in [from, to], at most one per step bucket (the one
 * nearest each bucket tick), in one bounded LIST over its prefix. Keys are
 * 13-digit epochs, so lexicographic order == numeric order and startAfter
 * can seek to `from`. `budget.pages` is shared by every scan of a request;
 * a scan that runs out says where it stopped: nothing after truncatedAfter
 * was examined, so clients must not read that span as offline. */
async function scanSource(env, prefix, from, to, step, budget) {
  const pick = bucketPicker(from, step);
  let cursor, done = false, listedUntil = from;
  while (!done && budget.pages > 0) {
    budget.pages--;
    const listing = await env.FRAMES.list({
      prefix,
      limit: 1000,
      ...(cursor ? { cursor } : { startAfter: `${prefix}${from - 1}` }),
    });
    for (const obj of listing.objects) {
      const ts = Number(obj.key.slice(prefix.length, -4));
      if (!Number.isFinite(ts)) {continue;}
      if (ts > to) { done = true; break; }
      listedUntil = ts;
      pick.add(ts);
    }
    if (!listing.truncated) {done = true;}
    else {cursor = listing.cursor;}
  }
  return { ts: pick.result(), truncatedAfter: done ? null : listedUntil };
}

/* At most one frame per step bucket: the one nearest each bucket tick, the
 * first on a tie. Fed in time order. */
function bucketPicker(from, step) {
  const bucketStart = Math.ceil(from / step) * step;
  const best = new Map();   // bucket idx → {ts, dist to bucket tick}
  return {
    add(ts) {
      const idx = Math.round((ts - bucketStart) / step);
      const dist = Math.abs(ts - (bucketStart + idx * step));
      const cur = best.get(idx);
      if (!cur || dist < cur.dist) {best.set(idx, { ts, dist });}
    },
    result: () => [...best.values()].map((v) => v.ts).sort((a, b) => a - b),
  };
}

/* A source's frames, one per step bucket: from the frame index when there
 * is one (never truncated), else an R2 scan within the budget. */
async function framesOf(env, ctx, origin, variant, site, source, from, to, step, budget) {
  if (!env.DB) {return scanSource(env, `${variant}/${site}/${source}/`, from, to, step, budget);}
  const pick = bucketPicker(from, step);
  for (const ts of await indexedTimes(env, ctx, origin, variant, site, source, from, to)) {pick.add(ts);}
  return { ts: pick.result(), truncatedAfter: null };
}

/* The query string that authorizes a source's image URLs, or ''.
 * Default-private: when IMG_SIGN_KEY is set, worker-served image URLs carry a
 * source-scoped expiring signature instead of needing the viewer token
 * appended. IMG_BASE (public bucket domain) is the explicit public opt-out —
 * R2 can't verify signatures, so those URLs stay bare. */
async function imageAuth(env, site, source) {
  if (!env.IMG_SIGN_KEY || env.IMG_BASE) {return '';}
  // validity must comfortably outlive this JSON response's cache life
  // (≤1h) plus an open viewing session; a leak exposes one source for
  // about a day. The expiry is rounded UP to a 6-hour boundary, so every
  // response in that block mints the SAME URLs: the browser's cache keys
  // on the full URL, and an expiry of "now + 24h" made every refresh
  // re-download every thumbnail despite the immutable cache header.
  // Valid for 24-30 h from minting.
  const exp = Math.ceil(Date.now() / SIG_BLOCK_MS) * SIG_BLOCK_MS + 24 * 3600 * 1000;
  return `?e=${exp}&sig=${await signScope(env, site, source, exp)}`;
}

/* Where image URLs point. PUBLIC_URL is the address browsers use, for a
 * worker that is also called on one they can't reach (a self-hosted backend
 * that Grafana's data source calls as http://backend:8787, say): image URLs
 * are built on it, and still signed. */
function imageBase(env, url) {
  let publicUrl = env.PUBLIC_URL || '';
  while (publicUrl.endsWith('/')) {publicUrl = publicUrl.slice(0, -1);}   // a loop, not /\/+$/: CodeQL flags that regex as polynomial
  return env.IMG_BASE || publicUrl || url.origin;
}

/* Makes a source's image URLs for one response: presigned R2 links, or
 * URLs on this worker or IMG_BASE (with the source's signature, if any). */
async function imageUrls(env, url, site, source) {
  const cfg = presignConfig(env);
  if (cfg) {return (variant, ts) => presignedFrameUrl(cfg, `${variant}/${site}/${source}/${ts}.jpg`);}
  const base = imageBase(env, url);
  const auth = await imageAuth(env, site, source);   // one signature covers both variants
  return async (variant, ts) => `${base}/frame/${variant}/${site}/${source}/${ts}.jpg${auth}`;
}

/* The rows for a source's frames. A lo row carries url_hi, the hi frame
 * nearest it on the source's hi cadence, when it uploads a hi variant: that
 * frame isn't guaranteed to exist (an upload can fail), so viewers fall back
 * to the lo image when it doesn't load. */
async function frameRows(env, url, variant, site, source, times, hiCadence) {
  if (!times.length) {return [];}
  const make = await imageUrls(env, url, site, source);
  const rows = [];
  for (const ts of times) {
    const row = { site, source, ts, url: await make(variant, ts) };
    if (variant === 'lo' && hiCadence >= 1000) {row.url_hi = await make('hi', Math.round(ts / hiCadence) * hiCadence);}
    rows.push(row);
  }
  return rows;
}

async function handleFrames(url, env, ctx, viewer) {
  const source = (url.searchParams.get('source') || url.searchParams.get('kiosk') || '').toLowerCase();
  if (!source) {return handleFramesAll(url, env, ctx, viewer);}
  const site = (url.searchParams.get('site') || '').toLowerCase();
  const variant = (url.searchParams.get('variant') || 'lo').toLowerCase();
  let from = Number(url.searchParams.get('from'));
  let to = Number(url.searchParams.get('to'));
  const step = Number(url.searchParams.get('step'));

  if (!ID_RE.test(site) || !ID_RE.test(source) || !VARIANTS.has(variant)) {return json({ error: 'bad params' }, 400);}
  if (viewer.sites && !viewer.sites.includes(site)) {return json({ error: 'forbidden' }, 403);}
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

  const { ts, truncatedAfter } = await framesOf(env, ctx, url.origin, variant, site, source, from, to, step, { pages: MAX_LIST_PAGES });
  if (truncatedAfter !== null) {
    console.warn(JSON.stringify({ msg: 'frames scan truncated', site, source, variant, from, to, step, truncatedAfter }));
  }
  const meta = own(own((await readIndex(url, env, ctx)).sites, site), source);
  const frames = await frameRows(env, url, variant, site, source, ts, Number(meta && meta.hiCadence));

  const live = to > Date.now() - step;
  const res = json(frames, 200, {
    'cache-control': `public, max-age=${live ? 15 : 3600}`,
    ...(truncatedAfter !== null ? { 'x-frames-truncated-after': String(truncatedAfter) } : {}),
  });
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

/* /frames without source=: every source of the sites asked for (all the
 * viewer may read when site= is omitted), as one table of rows — what a
 * table-shaped Grafana data source such as Infinity reads, one query for a
 * whole dashboard. sources= (csv, omitted or All = every one) keeps only
 * those source ids, for a Host variable. `step` is the finest spacing wanted (Grafana's
 * ${__interval_ms}); each source answers at its own cadence or a multiple of
 * it, and no more than MAX_BUCKETS frames. Sources without frames of this
 * variant are left out. All scans share one budget; a source the budget
 * didn't cover is named in X-Frames-Truncated-Sources (site/source@ts: nothing
 * after ts examined), and X-Frames-Truncated-After carries the earliest ts. */
async function handleFramesAll(url, env, ctx, viewer) {
  const variant = (url.searchParams.get('variant') || 'lo').toLowerCase();
  const from = Number(url.searchParams.get('from'));
  const to = Number(url.searchParams.get('to'));
  const step = Number(url.searchParams.get('step'));
  const wanted = parseCsv(url.searchParams.get('site'));
  const only = parseCsv(url.searchParams.get('sources'));
  if (!VARIANTS.has(variant) || ![wanted, only].every((l) => !l || l.every((s) => ID_RE.test(s)))) {return json({ error: 'bad params' }, 400);}
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {return json({ error: 'bad range' }, 400);}
  if (to === from) {return json([]);}
  if (!Number.isFinite(step) || step < 1000) {return json({ error: 'bad step' }, 400);}

  const index = await readIndex(url, env, ctx);
  const sites = Object.keys(index.sites || {})
    .filter((s) => (!viewer.sites || viewer.sites.includes(s)) && (!wanted || wanted.includes(s)))
    .sort();
  const field = variant === 'hi' ? 'hiCadence' : 'cadence';
  const jobs = [];
  for (const site of sites) {
    for (const [source, meta] of Object.entries(own(index.sites, site) || {}).sort(([a], [b]) => a.localeCompare(b))) {
      const cadence = Number(meta && meta[field]);
      if (!(cadence >= 1000) || (only && !only.includes(source))) {continue;}
      // the step wanted, rounded up to the source's cadence, and coarser
      // still if the window would need more than MAX_BUCKETS of them
      const per = Math.max(step, (to - from) / MAX_BUCKETS);
      const s = Math.ceil(per / cadence) * cadence;
      jobs.push({ site, source, step: s, from: Math.floor(from / s) * s, to: Math.ceil(to / s) * s, hiCadence: Number(meta.hiCadence) });
    }
  }

  // the answer depends only on which sites it covers, not on who asked
  const grid = Math.floor(step);
  const canonical = new URL('/frames', url.origin);
  for (const [k, v] of [['site', sites.join(',')], ['sources', only ? [...only].sort().join(',') : ''], ['variant', variant], ['from', Math.floor(from / grid) * grid], ['to', Math.ceil(to / grid) * grid], ['step', grid]]) {
    canonical.searchParams.set(k, v);
  }
  canonical.searchParams.set('all', '1');
  const cache = caches.default;
  const cacheKey = new Request(canonical);
  const hit = await cache.match(cacheKey);
  if (hit) {return hit;}

  const budget = { pages: MAX_LIST_PAGES_ALL };
  const results = new Array(jobs.length);
  let next = 0;
  const drain = async () => {
    while (next < jobs.length) {
      const i = next++;
      const j = jobs[i];
      const scan = await framesOf(env, ctx, url.origin, variant, j.site, j.source, j.from, j.to, j.step, budget);
      results[i] = { ...scan, rows: await frameRows(env, url, variant, j.site, j.source, scan.ts, j.hiCadence) };
    }
  };
  await Promise.all(Array.from({ length: Math.min(SCAN_CONCURRENCY, jobs.length) }, drain));

  const truncated = jobs
    .map((j, i) => ({ key: `${j.site}/${j.source}`, after: results[i].truncatedAfter }))
    .filter((t) => t.after !== null);
  if (truncated.length) {
    console.warn(JSON.stringify({ msg: 'frames scan truncated (all sources)', variant, from, to, step, sources: truncated.length }));
  }
  const live = to > Date.now() - step;
  const res = json(results.flatMap((r) => r.rows), 200, {
    'cache-control': `public, max-age=${live ? 15 : 3600}`,
    ...(truncated.length ? {
      'x-frames-truncated-after': String(Math.min(...truncated.map((t) => t.after))),
      'x-frames-truncated-sources': truncated.map((t) => `${t.key}@${t.after}`).join(','),
    } : {}),
  });
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

/* ---------------- frame image (POC path; prod = R2 custom domain) ---------------- */

async function handleFrame(url, env, ctx, viewer) {
  const m = url.pathname.match(/^\/frame\/(lo|hi)\/([a-z0-9_-]+)\/([a-z0-9_-]+)\/(\d{10,14})\.jpg$/);
  if (!m) {return json({ error: 'not found' }, 404);}
  if (viewer.sites && !viewer.sites.includes(m[2])) {return json({ error: 'forbidden' }, 403);}

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
