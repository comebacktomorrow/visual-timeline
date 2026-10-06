/* Contract tests for the reference worker, run against an in-memory R2 that
 * follows R2's list semantics (lexicographic keys, startAfter, cursor,
 * 1000-key pages). No Cloudflare account needed: `npm test` in worker/. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

const MIN = 60e3;
const NOW = Math.floor(Date.now() / MIN) * MIN;

function memR2(keys = []) {
  const sorted = [...keys].sort();
  const stats = { lists: 0 };
  return {
    stats,
    async list({ prefix, limit = 1000, startAfter, cursor }) {
      stats.lists++;
      let i = cursor ? Number(cursor) : sorted.findIndex((k) => k > (startAfter ?? ''));
      if (i < 0) {i = sorted.length;}
      const page = sorted.slice(i, i + limit).filter((k) => k.startsWith(prefix));
      return { objects: page.map((key) => ({ key })), truncated: i + limit < sorted.length, cursor: String(i + limit) };
    },
    async get(key) {
      return sorted.includes(key) ? { body: 'jpeg', httpEtag: '"etag"', json: async () => ({}) } : null;
    },
    async put() { return {}; },
  };
}
const frameKeys = (days, cadence = MIN, source = 'source-1') => {
  const out = [];
  for (let t = NOW - days * 864e5; t <= NOW; t += cadence) {out.push(`lo/site-a/${source}/${t}.jpg`);}
  return out;
};
globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
const call = (path, env, init) =>
  worker.fetch(new Request('https://w.example' + path, init), { ASSETS: { fetch: () => new Response('') }, ...env }, { waitUntil() {} });
const framesPath = (from, to, step, source = 'source-1') =>
  `/frames?site=site-a&source=${source}&from=${from}&to=${to}&step=${step}`;

test('/frames covers a week of 60 s frames to the present', async () => {
  const FRAMES = memR2(frameKeys(7));
  const step = 26 * MIN;
  const res = await call(framesPath(NOW - 7 * 864e5, NOW, step), { FRAMES });
  const frames = await res.json();
  assert.equal(res.headers.get('x-frames-truncated-after'), null);
  assert.ok(NOW - frames.at(-1).ts < step, 'newest frame is within one step of now');
  assert.ok(frames.length >= 7 * 864e5 / step, 'one frame per bucket');
});

test('/frames past the scan cap says where it stopped, and logs it', async () => {
  const FRAMES = memR2(frameKeys(30));
  const warns = [];
  const orig = console.warn; console.warn = (m) => warns.push(m);
  let res;
  try { res = await call(framesPath(NOW - 30 * 864e5, NOW, 108 * MIN), { FRAMES }); } finally { console.warn = orig; }
  const frames = await res.json();
  const cut = Number(res.headers.get('x-frames-truncated-after'));
  assert.ok(cut > 0, 'truncation header set');
  assert.equal(cut, NOW - 30 * 864e5 + (25000 - 1) * MIN, 'cut is the 25,000th frame');
  assert.ok(frames.every((f) => f.ts <= cut + 108 * MIN));
  assert.equal(warns.length, 1);
  assert.match(warns[0], /frames scan truncated/);
});

test('/frames exposes the truncation header to cross-origin clients', async () => {
  const res = await call(framesPath(NOW - 3600e3, NOW, MIN), { FRAMES: memR2(frameKeys(1)) });
  assert.match(res.headers.get('access-control-expose-headers') || '', /x-frames-truncated-after/);
});

test('a bodyless /upload probe separates live tokens from rejected ones', async () => {
  const env = { FRAMES: memR2(), UPLOAD_TOKENS: JSON.stringify({ 'site-a': 'tok-a' }) };
  const probe = (site, token) => call('/upload', env, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + token, 'x-site': site, 'x-source': 'probe', 'x-cadence': '60', 'x-variant': 'lo' },
  });
  assert.equal((await probe('site-a', 'tok-a')).status, 411, 'live token: authorized, then content-length required');
  assert.equal((await probe('site-a', 'wrong')).status, 401);
  assert.equal((await probe('site-b', 'tok-a')).status, 401, 'a token is only valid for its own site');
  assert.equal((await probe('-bad', 'tok-a')).status, 400, 'malformed id is a 400, not a 401');
});

test('with VIEWER_TOKEN set, reads need it and scoped consumers stay in scope', async () => {
  const env = {
    FRAMES: memR2(frameKeys(1)),
    VIEWER_TOKEN: JSON.stringify({ dash: 'v-all', wall: { token: 'v-b', sites: ['site-b'] } }),
  };
  const path = framesPath(NOW - 3600e3, NOW, MIN);
  assert.equal((await call(path, env)).status, 401);
  assert.equal((await call(path, env, { headers: { authorization: 'Bearer v-all' } })).status, 200);
  assert.equal((await call(path, env, { headers: { authorization: 'Bearer v-b' } })).status, 403);
});

test('signed image URLs authorize their own source and nothing else', async () => {
  const env = { FRAMES: memR2(frameKeys(1)), VIEWER_TOKEN: 'v-all', IMG_SIGN_KEY: 'sign-key' };
  const res = await call(framesPath(NOW - 3600e3, NOW, MIN), env, { headers: { authorization: 'Bearer v-all' } });
  const url = new URL((await res.json()).at(-1).url);
  assert.ok(url.searchParams.get('e') && url.searchParams.get('sig'), 'frame URLs are signed');
  assert.equal(url.searchParams.get('k'), null, 'the viewer key is not in the URL');
  assert.equal((await call(url.pathname + url.search, env)).status, 200, 'signature alone authorizes');
  const tampered = url.search.replace(/sig=([0-9a-f])/, (_, c) => 'sig=' + (c === '0' ? '1' : '0'));
  assert.equal((await call(url.pathname + tampered, env)).status, 401);
  const otherSource = url.pathname.replace('/source-1/', '/source-2/');
  assert.equal((await call(otherSource + url.search, env)).status, 401, 'signature is scoped to its source');
});

test('signed image URLs stay the same across refreshes within a 6-hour block', async (t) => {
  const env = { FRAMES: memR2(frameKeys(1)), VIEWER_TOKEN: 'v-all', IMG_SIGN_KEY: 'sign-key' };
  const auth = { headers: { authorization: 'Bearer v-all' } };
  const BLOCK = 6 * 3600e3;
  const urlsAt = async (now) => {
    t.mock.method(Date, 'now', () => now);
    const res = await call(framesPath(NOW - 3600e3, NOW, MIN), env, auth);
    t.mock.restoreAll();
    return (await res.json()).map((f) => f.url);
  };
  const start = Math.ceil(NOW / BLOCK) * BLOCK - BLOCK + 1;   // just after a block boundary
  const first = await urlsAt(start);
  // a refresh minutes or hours later, same block: byte-identical URLs, so the
  // browser's cache (keyed on the full URL) serves every thumbnail again
  assert.deepEqual(await urlsAt(start + 3600e3), first);
  assert.deepEqual(await urlsAt(start + BLOCK - 2), first);
  // the next block mints a new expiry
  assert.notDeepEqual(await urlsAt(start + BLOCK), first);
  // and the expiry is always at least 24 h away
  const e = Number(new URL(first[0]).searchParams.get('e'));
  assert.ok(e - start >= 24 * 3600e3 && e - start <= 30 * 3600e3);
});

/* ---------------- X-Timezone (#68) ---------------- */

/* an R2 that keeps what is put: index.json round-trips with etags, so an
 * upload's registration can be read back through /sources */
function storeR2() {
  const objs = new Map();
  let n = 0;
  const obj = (key) => {
    const o = objs.get(key);
    return o && { body: o.body, etag: o.etag, httpEtag: `"${o.etag}"`, text: async () => o.body, json: async () => JSON.parse(o.body) };
  };
  return {
    objs,
    async get(key) { return obj(key) || null; },
    async put(key, body, opts = {}) {
      const cur = objs.get(key);
      const want = opts.onlyIf && opts.onlyIf.etagMatches;
      if (want && (!cur || cur.etag !== want)) {return null;}
      objs.set(key, { body: typeof body === 'string' ? body : '<jpeg>', etag: 'e' + ++n });
      return {};
    },
    async list() { return { objects: [], truncated: false }; },
  };
}
const tzEnv = () => ({ FRAMES: storeR2(), UPLOAD_TOKENS: JSON.stringify({ 'site-a': 'tok-a' }) });
let tzSeq = 0;
function upload(env, extra = {}) {
  // a fresh source per call: the worker memoizes registrations per isolate
  const source = extra.source || `tz-src-${++tzSeq}`;
  const headers = {
    authorization: 'Bearer tok-a', 'x-site': 'site-a', 'x-source': source, 'x-cadence': '60',
    'content-type': 'image/jpeg', 'content-length': '4', ...extra.headers,
  };
  return { source, res: call('/upload', env, { method: 'POST', headers, body: 'jpeg' }) };
}
const sourceOf = async (env, id) => (await (await call('/sources', env)).json()).find((s) => s.id === id);

test('X-Timezone is stored with the source and returned by /sources', async () => {
  const env = tzEnv();
  const { source, res } = upload(env, { headers: { 'x-timezone': 'Australia/Sydney' } });
  assert.equal((await res).status, 200);
  assert.equal((await sourceOf(env, source)).timezone, 'Australia/Sydney');
});

test('X-Timezone matches case-insensitively and keeps the canonical spelling; UTC spellings are UTC', async () => {
  const env = tzEnv();
  const a = upload(env, { headers: { 'x-timezone': 'america/new_york' } });
  assert.equal((await a.res).status, 200);
  assert.equal((await sourceOf(env, a.source)).timezone, 'America/New_York');
  for (const utc of ['UTC', 'utc', 'Etc/UTC']) {
    const u = upload(env, { headers: { 'x-timezone': utc } });
    assert.equal((await u.res).status, 200, utc);
    assert.equal((await sourceOf(env, u.source)).timezone, 'UTC', utc);
  }
  // a current IANA name that a runtime's list may spell the old way (Calcutta)
  const k = upload(env, { headers: { 'x-timezone': 'Asia/Kolkata' } });
  assert.equal((await k.res).status, 200);
  assert.equal((await sourceOf(env, k.source)).timezone, 'Asia/Kolkata');
});

test('an invalid X-Timezone is a 400 that says what is expected, and registers nothing', async () => {
  const env = tzEnv();
  for (const bad of ['Mars/Olympus_Mons', 'EST', '+05:00', 'Sydney', 'x'.repeat(65), 'Europe/<b>']) {
    const { source, res } = upload(env, { headers: { 'x-timezone': bad } });
    const r = await res;
    assert.equal(r.status, 400, bad);
    assert.match((await r.json()).error, /X-Timezone must be an IANA time zone name/);
    assert.equal(await sourceOf(env, source), undefined, 'nothing registered for ' + bad);
  }
});

test('without X-Timezone a source has no timezone field, and a later upload without it keeps one', async () => {
  const env = tzEnv();
  const plain = upload(env);
  assert.equal((await plain.res).status, 200);
  const s = await sourceOf(env, plain.source);
  assert.ok(s, 'registered');
  assert.equal('timezone' in s, false);

  const zoned = upload(env, { headers: { 'x-timezone': 'Asia/Kathmandu' } });
  assert.equal((await zoned.res).status, 200);
  const again = upload(env, { source: zoned.source, headers: { 'x-cadence': '120' } });
  assert.equal((await again.res).status, 200);
  const z = await sourceOf(env, zoned.source);
  assert.equal(z.cadence, 120000);
  assert.equal(z.timezone, 'Asia/Kathmandu');
});

test('X-Timezone is an allowed CORS request header', async () => {
  const res = await call('/upload', tzEnv(), { method: 'OPTIONS' });
  assert.match(res.headers.get('access-control-allow-headers'), /x-timezone/);
});
