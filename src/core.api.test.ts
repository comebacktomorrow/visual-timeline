import { ApiError, bootErrorText, framesPath, hiUrlFor as untypedHiUrlFor, makeApiBackend as untypedMakeApiBackend, resolveFrameUrl, sourcesPath } from './core';

// the tests pass loose shapes (partial frames and decls): give them the signatures they use
type ApiFetch = (path: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
const makeApiBackend = untypedMakeApiBackend as (apiUrl: string, apiKey: string, apiFetch?: ApiFetch) => any;
const hiUrlFor = untypedHiUrlFor as (frame: { ts: number; url?: string } | null, decl: object, apiUrl?: string, apiKey?: string) => string | null;

const API = 'https://frames.example.com';
const FRAME = `${API}/frame/lo/site-a/source-1/1783488360000.jpg`;
const SIGNED = `${FRAME}?e=1783574760000&sig=abc123`;

const response = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

describe('request paths', () => {
  test('/sources without a site filter has no query string', () => {
    expect(sourcesPath(null)).toBe('/sources');
  });

  test('/sources joins the site filter', () => {
    expect(sourcesPath(['site-a', 'site-b'])).toBe('/sources?site=site-a%2Csite-b');
  });

  test('/frames carries the window, rounded, and the lo variant', () => {
    expect(framesPath('site-a', 'source-1', 1000.4, 2000.6, 60000)).toBe(
      '/frames?site=site-a&source=source-1&from=1000&to=2001&step=60000&variant=lo'
    );
  });
});

describe('resolveFrameUrl', () => {
  test('an absolute signed URL is used as is', () => {
    expect(resolveFrameUrl(SIGNED, API)).toBe(SIGNED);
  });

  test('a root-relative URL resolves against the API origin, not the page', () => {
    expect(resolveFrameUrl('/frame/lo/a/b/1.jpg?sig=x', `${API}/`)).toBe(`${API}/frame/lo/a/b/1.jpg?sig=x`);
  });

  test('a path-relative URL resolves like it would against the /frames response', () => {
    expect(resolveFrameUrl('frame/lo/a/b/1.jpg', `${API}/vt`)).toBe(`${API}/vt/frame/lo/a/b/1.jpg`);
  });

  test('without an API base the URL is left alone', () => {
    expect(resolveFrameUrl('/frame/lo/a/b/1.jpg', '')).toBe('/frame/lo/a/b/1.jpg');
  });
});

describe('makeApiBackend with an injected fetch (data source proxy mode)', () => {
  test('requests go to the injected fetch as API paths, never to the API URL', async () => {
    const globalFetch = jest.fn();
    (global as any).fetch = globalFetch;
    const apiFetch = jest.fn(async (path: string) => response(path.startsWith('/sources') ? [{ id: 'source-1' }] : []));
    const backend = makeApiBackend(API, '', apiFetch);

    await expect(backend.kiosks(['site-a'])).resolves.toEqual([{ id: 'source-1' }]);
    await backend.frames('site-a', 'source-1', 0, 60000, 60000);

    expect(apiFetch.mock.calls.map((c) => c[0])).toEqual([
      '/sources?site=site-a',
      '/frames?site=site-a&source=source-1&from=0&to=60000&step=60000&variant=lo',
    ]);
    expect(globalFetch).not.toHaveBeenCalled();
  });

  test("image URLs stay the API's own absolute URLs, and never get a ?k= key", async () => {
    const apiFetch = async () =>
      response([
        { source: 'source-1', ts: 1, url: SIGNED },
        { source: 'source-1', ts: 2, url: FRAME },
        { source: 'source-1', ts: 3, url: '/frame/lo/site-a/source-1/3.jpg?e=1&sig=f' },
      ]);
    // a key passed alongside an injected fetch must still never be used
    const frames = await makeApiBackend(API, 'leaked-key', apiFetch).frames('site-a', 'source-1', 0, 1, 1);
    expect(frames.map((f: { url: string }) => f.url)).toEqual([
      SIGNED,
      FRAME,
      `${API}/frame/lo/site-a/source-1/3.jpg?e=1&sig=f`,
    ]);
  });

  test("Grafana's 400 for an upstream 401 reads as a rejected data source token", async () => {
    const apiFetch = async () => response('Authentication to data source failed', 400);
    const err = await makeApiBackend(API, '', apiFetch).kiosks(null).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 400, call: 'sources', auth: true });
    expect((err as Error).message).toMatch(/data source's viewer token was rejected/);
    await expect(makeApiBackend(API, '', apiFetch).frames('a', 'b', 0, 1, 1)).rejects.toMatchObject({ call: 'frames', auth: true });
  });

  test('an ordinary 400, a 403 and a proxy 502 each say what they are', async () => {
    const fail = (status: number, body: unknown = { error: 'x' }) =>
      makeApiBackend(API, '', async () => response(body, status)).kiosks(null).catch((e: unknown) => e);
    expect(await fail(400)).toMatchObject({ auth: false, message: 'The frames API answered 400 to /sources.' });
    expect(await fail(403)).toMatchObject({ auth: true, message: expect.stringMatching(/isn't allowed.*\(403\)/) });
    expect(await fail(502)).toMatchObject({ auth: false, message: expect.stringMatching(/couldn't reach the frames API \(502\)/) });
    expect(await fail(0)).toMatchObject({ auth: false, message: 'No answer from the frames API for /sources.' });
  });

  test('works without a known API URL (absolute image URLs pass through)', async () => {
    const apiFetch = async () => response([{ source: 'source-1', ts: 1, url: SIGNED }]);
    const frames = await makeApiBackend('', '', apiFetch).frames('a', 'b', 0, 1, 1);
    expect(frames[0].url).toBe(SIGNED);
  });
});

describe('makeApiBackend direct mode (unchanged)', () => {
  test('fetches the API URL with the key as a Bearer header and keys bare image URLs', async () => {
    const fetchMock = jest.fn(async () => response([{ source: 'source-1', ts: 1, url: FRAME }]));
    (global as any).fetch = fetchMock;
    const frames = await makeApiBackend(`${API}/`, 'viewer-tok').frames('site-a', 'source-1', 0, 1, 1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(url).toBe(`${API}/frames?site=site-a&source=source-1&from=0&to=1&step=1&variant=lo`);
    expect(init.headers).toEqual({ authorization: 'Bearer viewer-tok' });
    expect(frames[0].url).toBe(`${FRAME}?k=viewer-tok`);
  });
});

describe('direct-mode errors', () => {
  test('a 401 asks for a valid viewer token, without reading the body', async () => {
    const json = jest.fn(async () => { throw new Error('not JSON'); });
    (global as any).fetch = jest.fn(async () => ({ ok: false, status: 401, json }));
    const err = await makeApiBackend(API, '').kiosks(null).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 401, auth: true, message: 'The frames API needs a valid viewer token (401).' });
    expect(json).not.toHaveBeenCalled();
  });

  test('a 400 is an ordinary refusal (only the proxy turns 401 into 400)', async () => {
    (global as any).fetch = jest.fn(async () => response('Authentication to data source failed', 400));
    expect(await makeApiBackend(API, '').kiosks(null).catch((e: unknown) => e)).toMatchObject({ auth: false });
  });
});

describe('bootErrorText', () => {
  test("a token error carries the host's hint; other API errors don't", () => {
    expect(bootErrorText(new ApiError('Token rejected.', 401, 'sources', true), 'Use a data source.')).toBe(
      'Token rejected. Use a data source.'
    );
    expect(bootErrorText(new ApiError('The frames API answered 500 to /sources.', 500, 'sources', false), 'Use a data source.')).toBe(
      'The frames API answered 500 to /sources.'
    );
  });

  test('a network error or timeout means the API was unreachable', () => {
    expect(bootErrorText(new TypeError('Failed to fetch'))).toBe('frames API unreachable — Failed to fetch');
  });
});

describe('hiUrlFor', () => {
  const TS = 1783488300000; // on a 5-minute boundary
  const decl = { site: 'site-a', id: 'source-1', hiCadence: 300000 };
  const HI = `${API}/frame/hi/site-a/source-1/${TS}.jpg`;

  test('no hi variant declared: no hi URL', () => {
    expect(hiUrlFor({ ts: TS, url: FRAME }, { site: 'site-a', id: 'source-1' }, API)).toBeNull();
  });

  test('reuses the lo frame’s base and signature, so it works without an apiUrl (data source mode)', () => {
    expect(hiUrlFor({ ts: TS, url: `${API}/frame/lo/site-a/source-1/${TS}.jpg?e=1&sig=abc` }, decl)).toBe(`${HI}?e=1&sig=abc`);
  });

  test('snaps to the nearest hi-cadence tick', () => {
    expect(hiUrlFor({ ts: TS + 140000, url: FRAME }, decl, API)).toBe(HI);
    expect(hiUrlFor({ ts: TS + 160000, url: FRAME }, decl, API)).toBe(`${API}/frame/hi/site-a/source-1/${TS + 300000}.jpg`);
  });

  test('keeps a base path in front of /frame/', () => {
    const lo = `${API}/vt/frame/lo/site-a/source-1/${TS}.jpg`;
    expect(hiUrlFor({ ts: TS, url: lo }, decl)).toBe(`${API}/vt/frame/hi/site-a/source-1/${TS}.jpg`);
  });

  test('an unsigned frame in direct mode carries the viewer key', () => {
    expect(hiUrlFor({ ts: TS, url: FRAME }, decl, API, 'viewer tok')).toBe(`${HI}?k=viewer%20tok`);
  });

  test('falls back to apiUrl when the frame URL has no /frame/ path', () => {
    expect(hiUrlFor({ ts: TS, url: 'blob:x' }, decl, `${API}/`)).toBe(HI);
    expect(hiUrlFor({ ts: TS, url: 'blob:x' }, decl)).toBeNull();
  });

  test('encodes site and id as path segments (#66)', () => {
    const odd = { site: 'site a/b', id: 'cam?#1', hiCadence: 300000 };
    expect(hiUrlFor({ ts: TS, url: 'blob:x' }, odd, API)).toBe(`${API}/frame/hi/site%20a%2Fb/cam%3F%231/${TS}.jpg`);
  });
});
