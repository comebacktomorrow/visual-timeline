/* Contract tests for the reference worker, run against an in-memory R2 that
 * follows R2's list semantics (lexicographic keys, startAfter, cursor,
 * 1000-key pages). No Cloudflare account needed: `npm test` in worker/. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { DatabaseSync } from 'node:sqlite';
import { presignUrl } from '../src/presign.js';

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
/* Reads without VIEWER_TOKEN are refused unless OPEN_READS is set; these
 * tests mostly read an open worker, so it's on unless a test says otherwise. */
const call = (path, env, init) =>
  worker.fetch(new Request('https://w.example' + path, init), { ASSETS: { fetch: () => new Response('') }, OPEN_READS: '1', ...env }, { waitUntil() {} });
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

test('inherited object keys are not tokens or sources', async () => {
  const env = { FRAMES: storeR2(), UPLOAD_TOKENS: JSON.stringify({ 'site-a': 'tok-a' }) };
  const post = (site, token, source = 'cam') => call('/upload', env, {
    method: 'POST', body: 'jpeg',
    headers: { authorization: 'Bearer ' + token, 'x-site': site, 'x-source': source, 'x-cadence': '60', 'content-type': 'image/jpeg', 'content-length': '4' },
  });
  // tokens.constructor is the Object function; its string form is public
  assert.equal((await post('constructor', String(Object))).status, 401);
  assert.equal((await post('constructor', 'function Object() { [native code] }')).status, 401);
  assert.equal(Object.hasOwn(Object, 'cam'), false, 'nothing written onto Object');
  // a real site may still have a source named like an inherited key
  assert.equal((await post('site-a', 'tok-a', 'constructor')).status, 200);
  assert.ok((await (await call('/sources', env)).json()).some((s) => s.id === 'constructor'));
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

test('a VIEWER_TOKEN entry whose sites are missing, empty, a string or misspelled grants nothing', async () => {
  const entries = {
    'w1-empty': { token: 't-empty', sites: [] },
    'w1-string': { token: 't-string', sites: 'site-a' },
    'w1-misspelled': { token: 't-misspelled', site: ['site-a'] },
    'w1-missing': { token: 't-missing' },
    'w1-bad-id': { token: 't-bad-id', sites: ['site-a', 'Not A Site!'] },
    'w1-not-string': { token: 't-not-string', sites: [42] },
    'w1-no-token': { sites: ['site-a'] },
    'w1-blank': '',
  };
  const env = {
    FRAMES: memR2(frameKeys(1)),
    VIEWER_TOKEN: JSON.stringify({ ...entries, 'w1-all': 't-all', 'w1-scoped': { token: 't-scoped', sites: ['SITE-A'] } }),
  };
  const path = framesPath(NOW - 3600e3, NOW, MIN);
  const warns = [];
  const orig = console.warn; console.warn = (m) => warns.push(m);
  try {
    for (const name of Object.keys(entries)) {
      const token = entries[name] && entries[name].token;
      if (token) {assert.equal((await call(path, env, { headers: { authorization: 'Bearer ' + token } })).status, 401, name);}
    }
    // the deliberate forms still work: a string is every site, sites scope (case-insensitively)
    assert.equal((await call(path, env, { headers: { authorization: 'Bearer t-all' } })).status, 200);
    assert.equal((await call(path, env, { headers: { authorization: 'Bearer t-scoped' } })).status, 200);
    assert.equal((await call(path.replace('site=site-a', 'site=site-b'), env, { headers: { authorization: 'Bearer t-scoped' } })).status, 403);
  } finally { console.warn = orig; }
  // each refused entry is logged by name, once, and never with its token
  for (const name of Object.keys(entries)) {
    assert.equal(warns.filter((w) => JSON.parse(w).consumer === name).length, 1, name);
  }
  assert.ok(warns.every((w) => !/"t-/.test(w) && !w.includes("'t-")), 'no token in the log');
});

test('without VIEWER_TOKEN, reads are refused unless OPEN_READS opens them', async () => {
  const FRAMES = indexedR2(keysFor('site-a', 'cam-1', MIN, 1), { 'site-a': { 'cam-1': { cadence: MIN } } });
  const paths = ['/sources', '/states', framesPath(NOW - 3600e3, NOW, MIN, 'cam-1'), `/frame/lo/site-a/cam-1/${NOW}.jpg`];
  const warns = [];
  const orig = console.warn; console.warn = (m) => warns.push(m);
  try {
    for (const OPEN_READS of [undefined, '', '0', 'false', 'no']) {
      for (const p of paths) {assert.equal((await call(p, { FRAMES, OPEN_READS })).status, 401, `${p} OPEN_READS=${OPEN_READS}`);}
    }
  } finally { console.warn = orig; }
  for (const OPEN_READS of ['1', 'true', 'YES']) {
    for (const p of paths) {assert.equal((await call(p, { FRAMES, OPEN_READS })).status, 200, `${p} OPEN_READS=${OPEN_READS}`);}
  }
  // a token, once set, is required whatever OPEN_READS says
  assert.equal((await call('/sources', { FRAMES, OPEN_READS: '1', VIEWER_TOKEN: 'v' })).status, 401);
  // writes never depended on it
  const up = await call('/upload', { FRAMES: storeR2(), OPEN_READS: undefined, UPLOAD_TOKENS: JSON.stringify({ 'site-a': 'tok' }) }, {
    method: 'POST', body: 'jpeg',
    headers: { authorization: 'Bearer tok', 'x-site': 'site-a', 'x-source': 'cam', 'x-cadence': '60', 'content-length': '4' },
  });
  assert.equal(up.status, 200);
});

test('?k= carries the viewer token on /frame/ image URLs only, never on API calls', async () => {
  const FRAMES = indexedR2(keysFor('site-a', 'cam-1', MIN, 1), { 'site-a': { 'cam-1': { cadence: MIN } } });
  const env = { FRAMES, VIEWER_TOKEN: 'v-all' };
  const img = `/frame/lo/site-a/cam-1/${NOW}.jpg`;
  assert.equal((await call(img + '?k=v-all', env)).status, 200, 'an <img> URL may carry the key');
  assert.equal((await call(img + '?k=wrong', env)).status, 401);
  for (const api of ['/sources', '/kiosks', '/states', framesPath(NOW - 3600e3, NOW, MIN, 'cam-1'), `/frames?from=${NOW - 3600e3}&to=${NOW}&step=${MIN}`]) {
    const sep = api.includes('?') ? '&' : '?';
    assert.equal((await call(api + sep + 'k=v-all', env)).status, 401, api + ' refuses ?k=');
    assert.equal((await call(api, env, { headers: { authorization: 'Bearer v-all' } })).status, 200, api + ' takes Bearer');
  }
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

test('PUBLIC_URL sets the origin of signed image URLs, whatever address the API was called on', async () => {
  const env = { FRAMES: memR2(frameKeys(1)), VIEWER_TOKEN: 'v-all', IMG_SIGN_KEY: 'sign-key', PUBLIC_URL: 'http://nas.lan:8787/' };
  const res = await call(framesPath(NOW - 3600e3, NOW, MIN), env, { headers: { authorization: 'Bearer v-all' } });
  const url = new URL((await res.json()).at(-1).url);
  assert.equal(url.origin, 'http://nas.lan:8787');
  assert.ok(url.pathname.startsWith('/frame/lo/site-a/'), 'one slash between origin and path');
  assert.ok(url.searchParams.get('sig'), 'still signed');
  assert.equal((await call(url.pathname + url.search, env)).status, 200, 'and the signature still verifies');
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
    // R2's list order (lexicographic) and paging, and its batch delete
    async list({ prefix = '', limit = 1000 } = {}) {
      const keys = [...objs.keys()].filter((k) => k.startsWith(prefix)).sort();
      return { objects: keys.slice(0, limit).map((key) => ({ key })), truncated: keys.length > limit };
    },
    async delete(keys) { for (const k of [].concat(keys)) {objs.delete(k);} },
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

/* ---------------- retention ---------------- */

const DAY = 864e5;
/* fetch with a ctx that keeps waitUntil work, so a test can await the prune
 * that an upload schedules */
async function callAndSettle(path, env, init) {
  const pending = [];
  const res = await worker.fetch(new Request('https://w.example' + path, init),
    { ASSETS: { fetch: () => new Response('') }, OPEN_READS: '1', ...env }, { waitUntil: (p) => pending.push(p) });
  await Promise.all(pending);
  return res;
}
const putFrames = (env, variant, site, source, times) => {
  for (const t of times) {env.FRAMES.objs.set(`${variant}/${site}/${source}/${t}.jpg`, { body: '<jpeg>', etag: 'f' });}
};
const framesOf = (env, variant, site, source) =>
  [...env.FRAMES.objs.keys()].filter((k) => k.startsWith(`${variant}/${site}/${source}/`)).length;
const uploadTo = (env, site, source) => callAndSettle('/upload', env, {
  method: 'POST',
  headers: { authorization: 'Bearer tok', 'x-site': site, 'x-source': source, 'x-cadence': '60',
    'content-type': 'image/jpeg', 'content-length': '4' },
  body: 'jpeg',
});

test('retention: an upload prunes frames older than RETENTION_DAYS, and RETENTION_DAYS_HI for hi', async () => {
  const env = { FRAMES: storeR2(), UPLOAD_TOKENS: JSON.stringify({ 'ret-a': 'tok' }), RETENTION_DAYS: '30', RETENTION_DAYS_HI: '7' };
  const now = Date.now();
  putFrames(env, 'lo', 'ret-a', 'cam', [now - 40 * DAY, now - 31 * DAY, now - 29 * DAY, now - DAY]);
  putFrames(env, 'hi', 'ret-a', 'cam', [now - 29 * DAY, now - 8 * DAY, now - 6 * DAY]);
  assert.equal((await uploadTo(env, 'ret-a', 'cam')).status, 200);
  assert.equal(framesOf(env, 'lo', 'ret-a', 'cam'), 3, 'two lo frames past 30 days gone; two kept plus the upload');
  assert.equal(framesOf(env, 'hi', 'ret-a', 'cam'), 1, 'hi keeps only its 7 days');
});

test('retention: an upload also prunes the silent sources of its site, at most once an hour', async () => {
  const env = { FRAMES: storeR2(), UPLOAD_TOKENS: JSON.stringify({ 'ret-b': 'tok' }), RETENTION_DAYS: '1' };
  const now = Date.now();
  assert.equal((await uploadTo(env, 'ret-b', 'live')).status, 200);   // registers ret-b/live
  env.FRAMES.objs.set('index.json', { body: JSON.stringify({ sites: { 'ret-b': {
    live: { cadence: 60000, history: [] }, silent: { cadence: 60000, history: [] } } } }), etag: 'x' });
  putFrames(env, 'lo', 'ret-b', 'silent', [now - 3 * DAY, now - 2 * DAY]);
  // the first upload already swept ret-b this hour, so this one does not
  await uploadTo(env, 'ret-b', 'live');
  assert.equal(framesOf(env, 'lo', 'ret-b', 'silent'), 2, 'no second sweep within the hour');
  // a source not yet swept this hour triggers the sweep, which reaches the silent one
  await uploadTo(env, 'ret-b', 'other');
  assert.equal(framesOf(env, 'lo', 'ret-b', 'silent'), 0, 'the silent source aged out');
});

test('retention: /sources leads each history with a "no data" pause up to the cutoff', async (t) => {
  const NOWX = 1_800_000_000_000;
  t.mock.method(Date, 'now', () => NOWX);
  const index = { sites: { 'ret-c': { cam: { cadence: 60000, history: [
    { since: NOWX - 60 * DAY, variant: 'lo', cadence: 60000 },
    { since: NOWX - 40 * DAY, variant: 'lo', cadence: 300000 },          // in force at the cutoff
    { since: NOWX - 35 * DAY, variant: 'hi', cadence: 600000 },
    { since: NOWX - 2 * DAY, variant: 'lo', paused: true, reason: 'quiet' },
  ] } } } };
  const env = { FRAMES: storeR2() };
  env.FRAMES.objs.set('index.json', { body: JSON.stringify(index), etag: 'i' });
  const read = async (e) => (await (await call('/sources?site=ret-c', e)).json())[0].history;

  assert.deepEqual(await read(env), index.sites['ret-c'].cam.history, 'without retention: unchanged');

  const cutoff = NOWX - 30 * DAY;
  assert.deepEqual(await read({ ...env, RETENTION_DAYS: '30' }), [
    { since: 0, variant: 'lo', paused: true, reason: 'expired', intended: true },
    { since: cutoff, variant: 'lo', cadence: 300000 },
    { since: cutoff, variant: 'hi', cadence: 600000 },
    { since: NOWX - 2 * DAY, variant: 'lo', paused: true, reason: 'quiet' },
  ]);
  t.mock.restoreAll();
});

test('retention: the "no data" pause is closed at the cutoff even when no event is in force there', async (t) => {
  const NOWX = 1_800_000_000_000;
  t.mock.method(Date, 'now', () => NOWX);
  const cutoff = NOWX - 30 * DAY;
  const env = { FRAMES: storeR2(), RETENTION_DAYS: '30' };
  const read = async (meta) => {
    env.FRAMES.objs.set('index.json', { body: JSON.stringify({ sites: { 'ret-e': { cam: meta } } }), etag: 'i' });
    return (await (await call('/sources?site=ret-e', env)).json())[0].history;
  };
  const NODATA = { since: 0, variant: 'lo', paused: true, reason: 'expired', intended: true };
  // registered before history was recorded: the registered pace resumes at the cutoff
  assert.deepEqual(await read({ cadence: 300000, history: [] }),
    [NODATA, { since: cutoff, variant: 'lo', cadence: 300000 }]);
  // first event after the cutoff (registered late, or backfilled): its pace, as viewers assume before it
  const late = { since: NOWX - DAY, variant: 'lo', cadence: 120000 };
  assert.deepEqual(await read({ cadence: 60000, history: [late] }),
    [NODATA, { since: cutoff, variant: 'lo', cadence: 120000 }, late]);
  // only hi events: the lo pace still closes the pause
  const hi = { since: NOWX - DAY, variant: 'hi', cadence: 600000 };
  assert.deepEqual(await read({ cadence: 60000, history: [hi] }),
    [NODATA, { since: cutoff, variant: 'lo', cadence: 60000 }, hi]);
  t.mock.restoreAll();
});

test('retention: unset or invalid RETENTION_DAYS keeps everything', async () => {
  for (const RETENTION_DAYS of [undefined, '', '0', '-5', 'thirty']) {
    const env = { FRAMES: storeR2(), UPLOAD_TOKENS: JSON.stringify({ 'ret-d': 'tok' }), RETENTION_DAYS };
    putFrames(env, 'lo', 'ret-d', 'cam', [Date.now() - 400 * DAY]);
    await uploadTo(env, 'ret-d', 'cam');
    assert.equal(framesOf(env, 'lo', 'ret-d', 'cam'), 2, `RETENTION_DAYS=${RETENTION_DAYS}`);
  }
});

/* ---------------- /frames for every source (#126 M2) ---------------- */

/* memR2's frames plus an index.json, as the worker keeps them */
function indexedR2(keys, sites) {
  const r2 = memR2(keys);
  const body = JSON.stringify({ sites });
  const get = r2.get;
  r2.get = async (key) => (key === 'index.json' ? { text: async () => body, json: async () => JSON.parse(body) } : get(key));
  return r2;
}
const keysFor = (site, source, cadence, hours) => {
  const out = [];
  for (let t = NOW - hours * 3600e3; t <= NOW; t += cadence) {out.push(`lo/${site}/${source}/${t}.jpg`);}
  return out;
};
const allPath = (q) => `/frames?${q}`;

test('/frames without source answers every source as rows of site, source, ts and url', async () => {
  const FRAMES = indexedR2(
    [...keysFor('site-a', 'cam-1', MIN, 1), ...keysFor('site-a', 'cam-2', 5 * MIN, 1), ...keysFor('site-b', 'lobby', MIN, 1)],
    { 'site-a': { 'cam-1': { cadence: MIN }, 'cam-2': { cadence: 5 * MIN } }, 'site-b': { lobby: { cadence: MIN } } }
  );
  const res = await call(allPath(`from=${NOW - 3600e3}&to=${NOW}&step=${MIN}`), { FRAMES });
  assert.equal(res.status, 200);
  const rows = await res.json();
  assert.deepEqual(Object.keys(rows[0]), ['site', 'source', 'ts', 'url']);
  const count = (site, source) => rows.filter((r) => r.site === site && r.source === source).length;
  assert.equal(count('site-a', 'cam-1'), 61, 'every minute of the hour');
  // a 5-minute source answers at its own cadence, not at the 60 s asked for
  assert.equal(count('site-a', 'cam-2'), 13);
  assert.equal(count('site-b', 'lobby'), 61);
  assert.ok(rows.every((r) => r.url === `https://w.example/frame/lo/${r.site}/${r.source}/${r.ts}.jpg`));
});

test('/frames without source: site= narrows, and a site-scoped viewer sees only its sites', async () => {
  const FRAMES = indexedR2(
    [...keysFor('site-a', 'cam-1', MIN, 1), ...keysFor('site-b', 'lobby', MIN, 1)],
    { 'site-a': { 'cam-1': { cadence: MIN } }, 'site-b': { lobby: { cadence: MIN } } }
  );
  const q = `from=${NOW - 3600e3}&to=${NOW}&step=${MIN}`;
  const sitesOf = async (path, env, init) => [...new Set((await (await call(path, env, init)).json()).map((r) => r.site))];
  assert.deepEqual(await sitesOf(allPath(`site=site-b&${q}`), { FRAMES }), ['site-b']);
  assert.deepEqual(await sitesOf(allPath(`site=All&${q}`), { FRAMES }), ['site-a', 'site-b']);
  // sources= keeps only those ids, as a Host variable would ask
  const rows = await (await call(allPath(`sources=lobby&${q}`), { FRAMES })).json();
  assert.deepEqual([...new Set(rows.map((r) => r.source))], ['lobby']);
  assert.equal((await call(allPath(`sources=All&${q}`), { FRAMES })).status, 200);
  const VIEWER_TOKEN = JSON.stringify({ wall: { token: 'w', sites: ['site-a'] } });
  const scoped = { FRAMES, VIEWER_TOKEN };
  const w = { headers: { authorization: 'Bearer w' } };
  assert.deepEqual(await sitesOf(allPath(q), scoped, w), ['site-a']);
  assert.deepEqual(await (await call(allPath(`site=site-b&${q}`), scoped, w)).json(), []);
  assert.equal((await call(allPath(q), scoped)).status, 401);
});

test('/frames without source coarsens a long window to at most 800 frames per source', async () => {
  const FRAMES = indexedR2(keysFor('site-a', 'cam-1', MIN, 24), { 'site-a': { 'cam-1': { cadence: MIN } } });
  const rows = await (await call(allPath(`from=${NOW - 24 * 3600e3}&to=${NOW}&step=1000`), { FRAMES })).json();
  assert.ok(rows.length <= 801 && rows.length > 700, `${rows.length} rows`);
  // every 2 minutes, a whole multiple of the cadence; the newest frame is the
  // last bucket's nearest whatever the minute, so the last gap may be shorter
  const gaps = new Set(rows.slice(1, -1).map((r, i) => r.ts - rows[i].ts));
  assert.deepEqual([...gaps], [2 * MIN]);
});

test('/frames without source shares one scan budget and names the sources it could not finish', async () => {
  // 6 sources × 2 days of minutes = 6 × 2,881 frames: 18 pages, within the
  // 50-page budget; 20 sources need 60 pages, past it
  const sites = { 'site-a': {} };
  const keys = [];
  for (let i = 0; i < 20; i++) {
    const id = `cam-${String(i).padStart(2, '0')}`;
    sites['site-a'][id] = { cadence: MIN };
    keys.push(...keysFor('site-a', id, MIN, 48));
  }
  const FRAMES = indexedR2(keys, sites);
  const warns = [];
  const orig = console.warn; console.warn = (m) => warns.push(m);
  let res;
  try { res = await call(allPath(`from=${NOW - 48 * 3600e3}&to=${NOW}&step=${MIN}`), { FRAMES }); } finally { console.warn = orig; }
  assert.equal(res.status, 200);
  assert.ok(FRAMES.stats.lists <= 50, `${FRAMES.stats.lists} lists`);
  const named = (res.headers.get('x-frames-truncated-sources') || '').split(',').filter(Boolean);
  assert.ok(named.length > 0 && named.every((n) => /^site-a\/cam-\d\d@\d+$/.test(n)), named.join(','));
  assert.equal(Number(res.headers.get('x-frames-truncated-after')), Math.min(...named.map((n) => Number(n.split('@')[1]))));
  assert.ok(warns.some((w) => w.includes('frames scan truncated (all sources)')));
});

test('/frames without source: bad ranges and steps are 400s, and an empty registry is no rows', async () => {
  const FRAMES = indexedR2([], {});
  assert.equal((await call(allPath(`from=${NOW}&to=${NOW - 1}&step=${MIN}`), { FRAMES })).status, 400);
  assert.equal((await call(allPath(`from=${NOW - MIN}&to=${NOW}&step=10`), { FRAMES })).status, 400);
  assert.equal((await call(allPath(`site=Bad!&from=${NOW - MIN}&to=${NOW}&step=${MIN}`), { FRAMES })).status, 400);
  assert.deepEqual(await (await call(allPath(`from=${NOW - MIN}&to=${NOW}&step=${MIN}`), { FRAMES })).json(), []);
});

test('/frames for one source also carries its site', async () => {
  const FRAMES = memR2(frameKeys(1));
  const rows = await (await call(framesPath(NOW - 3600e3, NOW, MIN), { FRAMES })).json();
  assert.equal(rows[0].site, 'site-a');
});

/* ---------------- frame index in D1 (#44) ---------------- */

/* D1's API over node:sqlite, so the SQL itself is exercised; counts queries */
function d1() {
  const db = new DatabaseSync(':memory:');
  const stats = { queries: 0 };
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    async run() { stats.queries++; db.prepare(sql).run(...args); return { success: true }; },
    async all() { stats.queries++; return { results: db.prepare(sql).all(...args) }; },
  });
  return {
    stats,
    count: (where = '1') => db.prepare(`SELECT COUNT(*) AS n FROM frames WHERE ${where}`).get().n,
    prepare: (sql) => stmt(sql),
    async batch(list) { for (const s of list) {await s.run();} return []; },
  };
}
/* a Cache API that keeps what is put, for the chunk-cache tests */
async function withCache(fn) {
  const store = new Map();
  const orig = globalThis.caches;
  globalThis.caches = { default: {
    match: async (req) => store.get(req.url)?.clone(),
    put: async (req, res) => { store.set(req.url, res); },
  } };
  try { return await fn(store); } finally { globalThis.caches = orig; }
}

test('authenticated JSON is private to clients, while the edge cache still keeps and serves /frames', async () => {
  await withCache(async (store) => {
    const FRAMES = indexedR2(keysFor('site-a', 'cam-1', MIN, 1), { 'site-a': { 'cam-1': { cadence: MIN } } });
    const env = { FRAMES, VIEWER_TOKEN: 'v', OPEN_READS: undefined };
    const auth = { headers: { authorization: 'Bearer v' } };
    const one = framesPath(NOW - 3600e3, NOW, MIN, 'cam-1');
    const all = `/frames?from=${NOW - 3600e3}&to=${NOW}&step=${MIN}`;
    for (const p of ['/sources', '/states', one, all]) {
      const res = await call(p, env, auth);
      assert.equal(res.status, 200, p);
      assert.match(res.headers.get('cache-control'), /^private, max-age=\d+$/, p);
    }
    // the edge copies are public (the Cache API won't store a private one) ...
    const edge = [...store.entries()].filter(([u]) => new URL(u).pathname === '/frames');
    assert.equal(edge.length, 2);
    assert.ok(edge.every(([, r]) => /^public, max-age=\d+$/.test(r.headers.get('cache-control'))));
    // ... and a cache hit is served from them, still private to the client
    FRAMES.list = async () => { throw new Error('a cache hit listed R2'); };
    for (const p of [one, all]) {
      const hit = await call(p, env, auth);
      assert.equal(hit.status, 200, p);
      assert.ok((await hit.json()).length > 0, p);
      assert.match(hit.headers.get('cache-control'), /^private, /, p);
    }
    // and the cache sits behind the auth check
    assert.equal((await call(one, env)).status, 401);
    // images keep their immutable public caching
    const img = await call(`/frame/lo/site-a/cam-1/${NOW}.jpg?k=v`, env);
    assert.equal(img.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  });
});

test('with a frame index, /upload records the frame and /frames reads it without listing R2', async () => {
  const DB = d1();
  const env = { FRAMES: storeR2(), DB, UPLOAD_TOKENS: JSON.stringify({ 'idx-a': 'tok' }) };
  const res = await uploadTo(env, 'idx-a', 'cam');
  assert.equal(res.status, 200);
  const { ts } = await res.json();
  assert.equal(DB.count(`site = 'idx-a' AND source = 'cam' AND variant = 'lo' AND ts = ${ts}`), 1);
  env.FRAMES.list = async () => { throw new Error('/frames listed R2'); };
  const frames = await (await call(`/frames?site=idx-a&source=cam&from=${ts - 3600e3}&to=${ts + MIN}&step=${MIN}`, env)).json();
  assert.deepEqual(frames.map((f) => f.ts), [ts]);
});

test('with a frame index, a month of frames needs no scan cap', async () => {
  const keys = frameKeys(30);
  const DB = d1();
  // the table appears on first use; fill it through the worker's own path
  const env = { FRAMES: memR2(keys), DB, UPLOAD_TOKENS: JSON.stringify({ 'site-a': 'tok' }) };
  for (let cursor = ''; ;) {
    const r = await (await call(`/reindex${cursor ? '?cursor=' + encodeURIComponent(cursor) : ''}`, env,
      { method: 'POST', headers: { authorization: 'Bearer tok', 'x-site': 'site-a' } })).json();
    if (r.done) {break;}
    cursor = r.cursor;
  }
  const res = await call(framesPath(NOW - 30 * 864e5, NOW, 108 * MIN), env);
  assert.equal(res.headers.get('x-frames-truncated-after'), null);
  const frames = await res.json();
  assert.ok(NOW - frames.at(-1).ts < 108 * MIN, 'reaches the present, past where the R2 scan stopped');
});

test('/reindex fills the index from R2, a call at a time, and needs the site\'s upload token', async () => {
  const keys = [...frameKeys(5), ...frameKeys(1, 5 * MIN).map((k) => k.replace(/^lo\//, 'hi/'))];
  const DB = d1();
  const env = { FRAMES: memR2(keys), DB, UPLOAD_TOKENS: JSON.stringify({ 'site-a': 'tok' }) };
  const post = (q = '', token = 'tok') => call(`/reindex${q}`, env, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'x-site': 'site-a' } });
  assert.equal((await post('', 'wrong')).status, 401);
  let calls = 0;
  for (let q = ''; ;) {
    const r = await (await post(q)).json();
    calls++;
    if (r.done) {break;}
    q = '?cursor=' + encodeURIComponent(r.cursor);
  }
  assert.ok(calls > 1, 'more than one call for 5 days of minutes');
  assert.equal(DB.count("variant = 'lo'"), frameKeys(5).length);
  assert.equal(DB.count("variant = 'hi'"), frameKeys(1, 5 * MIN).length);
  // again: nothing doubles
  for (let q = ''; ;) { const r = await (await post(q)).json(); if (r.done) {break;} q = '?cursor=' + encodeURIComponent(r.cursor); }
  assert.equal(DB.count(), keys.length);
  assert.equal((await call('/reindex', { FRAMES: memR2([]), UPLOAD_TOKENS: env.UPLOAD_TOKENS },
    { method: 'POST', headers: { authorization: 'Bearer tok', 'x-site': 'site-a' } })).status, 400);
});

test('the index is read in cached chunks that every step and viewer share', async () => {
  await withCache(async () => {
    const keys = frameKeys(2);
    const DB = d1();
    const env = { FRAMES: memR2(keys), DB, UPLOAD_TOKENS: JSON.stringify({ 'site-a': 'tok' }) };
    for (let q = ''; ;) {
      const r = await (await call(`/reindex${q}`, env, { method: 'POST', headers: { authorization: 'Bearer tok', 'x-site': 'site-a' } })).json();
      if (r.done) {break;}
      q = '?cursor=' + encodeURIComponent(r.cursor);
    }
    const before = DB.stats.queries;
    await call(framesPath(NOW - 864e5, NOW, 5 * MIN), env);
    const first = DB.stats.queries - before;
    assert.ok(first >= 4 && first <= 6, `a day is 4 or 5 six-hour chunks (${first} queries)`);
    // another zoom of the same day: every chunk comes from the cache
    await call(framesPath(NOW - 864e5, NOW, 15 * MIN), env);
    assert.equal(DB.stats.queries - before, first);
  });
});

test('with a frame index, /frames for every source finishes them all', async () => {
  const sites = { 'site-a': {} };
  const keys = [];
  const DB = d1();
  for (let i = 0; i < 20; i++) {
    const id = `cam-${String(i).padStart(2, '0')}`;
    sites['site-a'][id] = { cadence: MIN };
    keys.push(...keysFor('site-a', id, MIN, 48));
  }
  const env = { FRAMES: indexedR2(keys, sites), DB, UPLOAD_TOKENS: JSON.stringify({ 'site-a': 'tok' }) };
  for (let q = ''; ;) {
    const r = await (await call(`/reindex${q}`, env, { method: 'POST', headers: { authorization: 'Bearer tok', 'x-site': 'site-a' } })).json();
    if (r.done) {break;}
    q = '?cursor=' + encodeURIComponent(r.cursor);
  }
  const res = await call(`/frames?from=${NOW - 48 * 3600e3}&to=${NOW}&step=${MIN}`, env);
  assert.equal(res.headers.get('x-frames-truncated-sources'), null);
  const rows = await res.json();
  assert.equal(new Set(rows.map((r) => r.source)).size, 20);
});

test('retention removes pruned frames from the index too', async () => {
  const DB = d1();
  const env = { FRAMES: storeR2(), DB, UPLOAD_TOKENS: JSON.stringify({ 'idx-r': 'tok' }), RETENTION_DAYS: '30' };
  const now = Date.now();
  putFrames(env, 'lo', 'idx-r', 'cam', [now - 40 * DAY, now - 31 * DAY, now - DAY]);
  await callAndSettle('/reindex', env, { method: 'POST', headers: { authorization: 'Bearer tok', 'x-site': 'idx-r' } });
  assert.equal(DB.count("site = 'idx-r'"), 3);
  assert.equal((await uploadTo(env, 'idx-r', 'cam')).status, 200);
  assert.equal(DB.count("site = 'idx-r'"), 2, 'the two old frames gone from the index; the recent one and the upload kept');
});

/* ---------------- presigned R2 links and url_hi (#129) ---------------- */

test('presignUrl reproduces AWS\'s own presigned URL example', async () => {
  // "Authenticating Requests: Using Query Parameters (AWS Signature Version 4)", example GET Object
  const url = await presignUrl(
    { id: 'AKIAIOSFODNN7EXAMPLE', secret: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1' },
    'examplebucket.s3.amazonaws.com', '/test.txt', Date.UTC(2013, 4, 24), 86400);
  assert.equal(new URL(url).searchParams.get('X-Amz-Signature'), 'aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404');
});

const presignEnv = (extra = {}) => ({
  IMG_DELIVERY: 'presigned', R2_ACCESS_KEY_ID: 'akid', R2_SECRET_ACCESS_KEY: 'secret',
  R2_S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com/', R2_BUCKET: 'frames-bucket', ...extra,
});

test('with IMG_DELIVERY=presigned, /frames hands out R2 links that stay the same within a 6-hour block', async () => {
  const FRAMES = indexedR2(keysFor('site-a', 'cam-1', MIN, 1), { 'site-a': { 'cam-1': { cadence: MIN, hiCadence: 5 * MIN } } });
  const env = { FRAMES, ...presignEnv() };
  const path = `/frames?site=site-a&source=cam-1&from=${NOW - 3600e3}&to=${NOW}&step=${MIN}`;
  const a = await (await call(path, env)).json();
  const b = await (await call(path, env)).json();
  assert.deepEqual(a, b);
  const u = new URL(a[0].url);
  assert.equal(u.host, 'acct.r2.cloudflarestorage.com');
  assert.equal(u.pathname, `/frames-bucket/lo/site-a/cam-1/${a[0].ts}.jpg`);
  assert.equal(u.searchParams.get('X-Amz-Expires'), String(30 * 3600));
  assert.match(u.searchParams.get('X-Amz-Credential'), /^akid\/\d{8}\/auto\/s3\/aws4_request$/);
  // signed as of the block's start, so the URL holds for the whole block
  const block = Math.floor(Date.now() / (6 * 3600e3)) * 6 * 3600e3;
  assert.equal(u.searchParams.get('X-Amz-Date'), new Date(block).toISOString().replace(/[-:]|\.\d{3}/g, ''));
  // the hi frame's link is signed for its own key
  const hi = new URL(a[0].url_hi);
  assert.equal(hi.pathname, `/frames-bucket/hi/site-a/cam-1/${Math.round(a[0].ts / (5 * MIN)) * 5 * MIN}.jpg`);
  assert.notEqual(hi.searchParams.get('X-Amz-Signature'), u.searchParams.get('X-Amz-Signature'));
});

test('presigned links in the all-sources /frames, and only for sources with a hi variant get url_hi', async () => {
  const FRAMES = indexedR2([...keysFor('site-a', 'cam-1', MIN, 1), ...keysFor('site-a', 'cam-2', MIN, 1)],
    { 'site-a': { 'cam-1': { cadence: MIN, hiCadence: 5 * MIN }, 'cam-2': { cadence: MIN } } });
  const rows = await (await call(`/frames?from=${NOW - 3600e3}&to=${NOW}&step=${MIN}`, { FRAMES, ...presignEnv() })).json();
  assert.ok(rows.every((r) => r.url.startsWith('https://acct.r2.cloudflarestorage.com/frames-bucket/lo/')));
  assert.ok(rows.filter((r) => r.source === 'cam-1').every((r) => r.url_hi));
  assert.ok(rows.filter((r) => r.source === 'cam-2').every((r) => !('url_hi' in r)));
});

test('worker-served URLs also carry url_hi, under the same signature as the frame', async () => {
  const FRAMES = indexedR2(keysFor('site-a', 'cam-1', MIN, 1), { 'site-a': { 'cam-1': { cadence: MIN, hiCadence: 5 * MIN } } });
  const rows = await (await call(`/frames?site=site-a&source=cam-1&from=${NOW - 3600e3}&to=${NOW}&step=${MIN}`, { FRAMES, IMG_SIGN_KEY: 'k' })).json();
  const lo = new URL(rows[0].url), hi = new URL(rows[0].url_hi);
  assert.equal(hi.pathname, `/frame/hi/site-a/cam-1/${Math.round(rows[0].ts / (5 * MIN)) * 5 * MIN}.jpg`);
  assert.equal(hi.search, lo.search);
});

test('presigned delivery falls back to worker URLs, and says so, without its settings; IMG_BASE wins over it', async () => {
  const FRAMES = indexedR2(keysFor('site-a', 'cam-1', MIN, 1), { 'site-a': { 'cam-1': { cadence: MIN } } });
  const path = `/frames?site=site-a&source=cam-1&from=${NOW - 3600e3}&to=${NOW}&step=${MIN}`;
  const errs = [];
  const orig = console.error; console.error = (m) => errs.push(m);
  let rows;
  try { rows = await (await call(path, { FRAMES, ...presignEnv({ R2_SECRET_ACCESS_KEY: '' }) })).json(); } finally { console.error = orig; }
  assert.ok(rows[0].url.startsWith('https://w.example/frame/lo/'));
  assert.ok(errs.some((e) => e.includes('IMG_DELIVERY=presigned needs')), 'says what is missing (once per isolate)');
  const pub = await (await call(path, { FRAMES, ...presignEnv({ IMG_BASE: 'https://img.example' }) })).json();
  assert.ok(pub[0].url.startsWith('https://img.example/frame/lo/'));
});

/* ---------------- /states (#126, M4) ---------------- */

test('/states answers each source\'s pauses as state rows, and the end of each as an empty one', async () => {
  const FRAMES = indexedR2([], {
    'site-a': {
      'cam-1': { cadence: MIN, history: [
        { since: 1000, variant: 'lo', cadence: MIN },
        { since: 2000, variant: 'lo', paused: true, reason: 'screen-sleep', intended: false },
        { since: 3000, variant: 'lo', cadence: MIN },
        { since: 4000, variant: 'lo', paused: true },
        { since: 4500, variant: 'hi', cadence: 5 * MIN },
      ] },
      'cam-2': { cadence: MIN, history: [{ since: 1500, variant: 'lo', paused: true, reason: 'quiet' }] },
    },
    'site-b': { lobby: { cadence: MIN, history: [{ since: 1000, variant: 'lo', paused: true, reason: 'system-down' }] } },
  });
  const get = async (q, env = {}) => (await call(`/states${q}`, { FRAMES, ...env })).json();
  assert.deepEqual(await get('?site=site-a'), [
    { time: 2000, site: 'site-a', source: 'cam-1', state: 'screen-sleep:unexpected' },
    { time: 3000, site: 'site-a', source: 'cam-1', state: '' },
    { time: 4000, site: 'site-a', source: 'cam-1', state: 'paused' },
    { time: 1500, site: 'site-a', source: 'cam-2', state: 'quiet' },
  ]);
  assert.deepEqual((await get('?sources=lobby')).map((r) => r.state), ['system-down']);
  assert.deepEqual((await get('?site=site-a&sources=cam-1&to=2500')).map((r) => r.time), [2000]);
  // a site-scoped viewer sees only its sites
  const VIEWER_TOKEN = JSON.stringify({ wall: { token: 'w', sites: ['site-b'] } });
  const w = { headers: { authorization: 'Bearer w' } };
  assert.deepEqual((await (await call('/states', { FRAMES, VIEWER_TOKEN }, w)).json()).map((r) => r.site), ['site-b']);
  assert.equal((await call('/states', { FRAMES, VIEWER_TOKEN })).status, 401);
});
