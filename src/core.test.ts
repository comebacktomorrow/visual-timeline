import { esc, headTitle, imageUrlWithKey, mountGrid, mountTimeline, tagChips } from './core';

const API = 'https://frames.example.com';
const FRAME = `${API}/frame/lo/site-a/source-1/1783488360000.jpg`;

describe('imageUrlWithKey', () => {
  test('a bare image URL on the API origin carries the viewer key', () => {
    expect(imageUrlWithKey(FRAME, API, 'viewer-tok')).toBe(`${FRAME}?k=viewer-tok`);
  });

  test('a signed image URL is left alone, so the key stays out of it', () => {
    const signed = `${FRAME}?e=1783574760000&sig=abc123`;
    expect(imageUrlWithKey(signed, API, 'viewer-tok')).toBe(signed);
  });

  test('an image on another origin is never handed the key', () => {
    const publicBucket = 'https://img.example.net/lo/site-a/source-1/1783488360000.jpg';
    expect(imageUrlWithKey(publicBucket, API, 'viewer-tok')).toBe(publicBucket);
  });

  test('a presigned URL on another origin keeps its query intact', () => {
    const presigned = 'https://bucket.example.org/f.jpg?X-Amz-Signature=deadbeef';
    expect(imageUrlWithKey(presigned, API, 'viewer-tok')).toBe(presigned);
  });

  test('without a key nothing changes', () => {
    expect(imageUrlWithKey(FRAME, API, '')).toBe(FRAME);
  });

  test('an API base with a path prefix matches on origin', () => {
    expect(imageUrlWithKey(FRAME, `${API}/visual-timeline`, 'viewer-tok')).toBe(`${FRAME}?k=viewer-tok`);
  });

  test('the key is URL-encoded', () => {
    expect(imageUrlWithKey(FRAME, API, 'a b/c+d')).toBe(`${FRAME}?k=a+b%2Fc%2Bd`);
  });
});

describe('registry fields render as text, never markup', () => {
  const IMG = '<img src=x onerror=alert(1)>';
  const BREAK = '"><script>alert(2)</script>';
  const decl = {
    id: IMG + BREAK,
    site: BREAK + IMG,
    location: IMG + "'" + BREAK,
    cadence: 60e3,
    tags: { [IMG]: BREAK, 'k"><b>': "<i onmouseover='x'>v</i>" },
  };
  const TO = Date.now() - 3600e3; // a past window: no live polling
  const cfgFor = () => ({ apiUrl: 'https://frames.example.com', from: TO - 600e3, to: TO, width: 600 });
  const realFetch = globalThis.fetch;
  let root: HTMLElement;

  beforeEach(() => {
    // jsdom has no canvas; the axis only needs text metrics
    HTMLCanvasElement.prototype.getContext = (() => ({ font: '', measureText: () => ({ width: 30 }) })) as never;
    globalThis.fetch = jest.fn(async (u) => ({
      ok: true,
      json: async () => (String(u).includes('/sources') ? [decl] : []),
    })) as unknown as typeof fetch;
    root = document.createElement('div');
    document.body.appendChild(root);
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    document.body.innerHTML = '';
  });

  async function until(sel: string) {
    for (let i = 0; i < 100 && !root.querySelector(sel); i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    const el = root.querySelector(sel);
    expect(el).not.toBeNull();
    return el as HTMLElement;
  }
  // nothing the registry sent may have become an element or an attribute
  function expectNoInjection(host: HTMLElement) {
    expect(host.querySelector('script, b, i')).toBeNull();
    expect(host.querySelectorAll('[onerror], [onmouseover]')).toHaveLength(0);
    for (const img of host.querySelectorAll('img')) {
      expect(img.getAttribute('src')).not.toBe('x');
    }
  }

  test('esc covers text and attribute context', () => {
    expect(esc(`<a href="x" t='y'>&`)).toBe('&#60;a href=&#34;x&#34; t=&#39;y&#39;&#62;&#38;');
    expect(esc(5)).toBe('5');
  });

  test('tagChips and headTitle keep the literal strings', () => {
    const host = document.createElement('div');
    host.innerHTML = tagChips(decl);
    expectNoInjection(host);
    expect(host.querySelectorAll('.st')).toHaveLength(2);
    expect(host.querySelector('.st')!.textContent).toBe(`${IMG}:${BREAK}`);
    const h = document.createElement('div');
    h.innerHTML = `<span title="${esc(headTitle(decl))}"></span>`;
    expect(h.querySelector('span')!.getAttribute('title')).toBe(headTitle(decl));
    expect(h.querySelector('span')!.attributes).toHaveLength(1);
  });

  test('timeline card', async () => {
    mountTimeline(root, cfgFor());
    const head = await until('.card-head');
    expectNoInjection(root);
    expect(head.querySelector('.nm')!.textContent).toBe(decl.id);
    expect(head.querySelector('.st')!.textContent).toBe(`${decl.site} · ${decl.location}`);
    expect(head.getAttribute('title')).toBe(headTitle(decl));
    expect(head.querySelectorAll('.tags .st')).toHaveLength(2);
    expect(head.querySelector('.tags .st')!.textContent).toBe(`${IMG}:${BREAK}`);
  });

  test('grid tile', async () => {
    mountGrid(root, cfgFor());
    const head = await until('.t-head');
    expectNoInjection(root);
    expect(head.querySelector('.nm')!.textContent).toBe(decl.id);
    expect(head.querySelector('.st')!.textContent).toBe(`${decl.site} · ${decl.location}`);
    expect(head.getAttribute('title')).toBe(headTitle(decl));
    expect(root.querySelector('.t-img img')!.getAttribute('alt')).toBe(decl.id);
    expect(head.querySelectorAll('.tags .st')).toHaveLength(2);
  });
});
