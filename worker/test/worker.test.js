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
