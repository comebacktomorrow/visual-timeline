import { framesPath, makeApiBackend as untypedMakeApiBackend, resolveFrameUrl, sourcesPath } from './core';

// core.ts is untyped JS semantics (@ts-nocheck): give the test a signature
type ApiFetch = (path: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
const makeApiBackend = untypedMakeApiBackend as (apiUrl: string, apiKey: string, apiFetch?: ApiFetch) => any;

const API = 'https://frames.example.com';
const FRAME = `${API}/frame/lo/site-a/source-1/1783488360000.jpg`;
const SIGNED = `${FRAME}?e=1783574760000&sig=abc123`;

const response = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

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

  test('image URLs stay the API\'s own absolute URLs, and never get a ?k= key', async () => {
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

  test('a failed request becomes the same error the direct mode throws', async () => {
    const apiFetch = async () => response({ message: 'unauthorized' }, 401);
    await expect(makeApiBackend(API, '', apiFetch).kiosks(null)).rejects.toThrow('kiosks 401');
    await expect(makeApiBackend(API, '', apiFetch).frames('a', 'b', 0, 1, 1)).rejects.toThrow('frames 401');
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
