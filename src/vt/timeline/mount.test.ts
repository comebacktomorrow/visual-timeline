import { mountTimeline } from './mount';
import { DWELL_MS } from './flipbook';
import type { Backend, Clip, Frame } from '../types';

/* A mount's teardown (M1): a refresh swaps the strip out from under a
 * resting cursor, and the old strip never gets mouseleave. Its hover
 * flipbook must not start, or play on, once the mount is destroyed. */

const T = Date.UTC(2026, 3, 1, 12, 0, 0);
const FROM = T - 10 * 60e3, TO = T;   // a past window: no live poll

describe('a timeline mount\'s teardown', () => {
  let root: HTMLElement;
  let calls: string[];
  const restore: Array<() => void> = [];

  function stub(proto: object, key: string, get: (this: HTMLElement) => number) {
    const prev = Object.getOwnPropertyDescriptor(proto, key);
    Object.defineProperty(proto, key, { configurable: true, get });
    restore.push(() => (prev ? Object.defineProperty(proto, key, prev) : delete (proto as any)[key]));
  }

  // a frame a second: every slot holds several, so every one arms the flipbook
  const frames: Frame[] = Array.from({ length: 600 }, (_, i) => ({ ts: FROM + i * 1000, url: `f${i}.jpg` }));
  const backend = (clips: Clip[] = []): Backend => ({
    kiosks: () => [{ id: 'cam', site: 'lab', cadence: 1000 }],
    frames: async (_s, _i, from, to) => { calls.push('frames'); return frames.filter((f) => f.ts >= from && f.ts <= to); },
    detail: async (_s, _i, from, to) => { calls.push('detail'); return frames.filter((f) => f.ts >= from && f.ts < to); },
    ...(clips.length ? { clips: async (_s: string, _i: string, from: number, to: number) => clips.filter((c) => c.to > from && c.from < to) } : {}),
  });

  beforeEach(() => {
    jest.useFakeTimers({ now: T + 3600e3 });
    calls = [];
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = (() => ({ font: '', measureText: () => ({ width: 30 }) })) as never;
    restore.push(() => (HTMLCanvasElement.prototype.getContext = getContext));
    stub(HTMLElement.prototype, 'clientWidth', () => 800);
    const play = jest.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    const pause = jest.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    const load = jest.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    restore.push(() => { play.mockRestore(); pause.mockRestore(); load.mockRestore(); });
    root = document.createElement('div');
    document.body.appendChild(root);
  });
  afterEach(() => {
    restore.splice(0).reverse().forEach((r) => r());
    document.body.innerHTML = '';
    jest.useRealTimers();
  });

  async function mountAndRest(b: Backend) {
    const inst = mountTimeline(root, { from: FROM, to: TO, width: 800, timeZone: 'UTC', backend: b });
    await jest.advanceTimersByTimeAsync(2000);   // build and reveal
    const strip = root.querySelector<HTMLElement>('.card .strip')!;
    strip.getBoundingClientRect = () => ({ left: 0, width: 800, top: 0, height: 60, right: 800, bottom: 60, x: 0, y: 0, toJSON: () => ({}) });
    // the cursor comes to rest in the middle of the strip
    strip.dispatchEvent(new MouseEvent('mouseenter', { clientX: 400 }));
    calls = [];
    return { inst, mag: root.querySelector<HTMLElement>('.card .mag')! };
  }

  test('destroyed during the dwell: the flipbook never starts, and no timer is left', async () => {
    const { inst, mag } = await mountAndRest(backend());
    await jest.advanceTimersByTimeAsync(DWELL_MS / 2);
    inst.destroy();
    await jest.advanceTimersByTimeAsync(DWELL_MS * 3);
    expect(calls).toEqual([]);
    expect(mag.classList.contains('flip')).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
  });

  test('destroyed while it plays: the frames stop flipping, and no timer is left', async () => {
    const { inst, mag } = await mountAndRest(backend());
    await jest.advanceTimersByTimeAsync(DWELL_MS + 10);
    expect(calls).toEqual(['detail']);
    expect(mag.classList.contains('flip')).toBe(true);
    const img = mag.querySelector('img')!;
    await jest.advanceTimersByTimeAsync(500);
    const before = img.getAttribute('src');
    inst.destroy();
    await jest.advanceTimersByTimeAsync(5000);
    expect(img.getAttribute('src')).toBe(before);
    expect(mag.classList.contains('flip')).toBe(false);
    expect(calls).toEqual(['detail']);
    expect(jest.getTimerCount()).toBe(0);
  });

  test('destroyed while the reel loads: it doesn\'t start once the load comes back', async () => {
    let release: () => void = () => {};
    const b = backend();
    const slow: Backend = { ...b, detail: (...a) => new Promise((res) => { release = () => res(b.detail!(...a)); }) };
    const { inst, mag } = await mountAndRest(slow);
    await jest.advanceTimersByTimeAsync(DWELL_MS + 10);
    inst.destroy();
    release();
    await jest.advanceTimersByTimeAsync(2000);
    expect(mag.classList.contains('flip')).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
  });

  test('destroyed while a clip loops in the magnifier: the video is stopped and let go of', async () => {
    // the whole window is a clip in two sizes: the hover plays the smaller
    const clip: Clip = { from: FROM, to: TO, url: 'c.webm', hi: 'c-hi.webm' };
    const { inst, mag } = await mountAndRest(backend([clip]));
    await jest.advanceTimersByTimeAsync(DWELL_MS + 10);
    // the hover's probe of how long the clip plays gives up in jsdom; then it plays
    await jest.advanceTimersByTimeAsync(5000);
    const v = mag.querySelector('video');
    expect(v).not.toBeNull();
    expect(v!.getAttribute('src')).toBe('c.webm');
    inst.destroy();
    expect(mag.querySelector('video')).toBeNull();
    expect(v!.hasAttribute('src')).toBe(false);
    expect(mag.classList.contains('flip-video')).toBe(false);
    v!.dispatchEvent(new Event('ended'));   // nothing loops it again
    expect(v!.hasAttribute('src')).toBe(false);
    await jest.advanceTimersByTimeAsync(5000);
    expect(jest.getTimerCount()).toBe(0);
  });

  test('without a mouse: a focused strip\'s ←/→ move the cursor a slot, and Enter opens the player there (M6)', async () => {
    const hovers: number[] = [];
    const inst = mountTimeline(root, { from: FROM, to: TO, width: 800, timeZone: 'UTC', backend: backend(), onHover: (t) => hovers.push(t) });
    await jest.advanceTimersByTimeAsync(2000);
    const strip = root.querySelector<HTMLElement>('.card .strip')!;
    strip.getBoundingClientRect = () => ({ left: 0, width: 800, top: 0, height: 60, right: 800, bottom: 60, x: 0, y: 0, toJSON: () => ({}) });
    expect(strip.tabIndex).toBe(0);
    expect(strip.getAttribute('aria-label')).toMatch(/^cam: /);
    strip.focus();
    calls = [];
    const key = (k: string) => strip.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    key('ArrowLeft');
    key('ArrowLeft');
    expect(hovers).toHaveLength(2);
    expect(hovers[1]).toBeLessThan(hovers[0]);
    key('ArrowRight');
    expect(hovers[2]).toBeGreaterThan(hovers[1]);
    // nothing plays from the keyboard: the hover flipbook is the mouse's
    await jest.advanceTimersByTimeAsync(DWELL_MS * 2);
    expect(calls).toEqual([]);
    key('Enter');
    const pop = document.querySelector<HTMLElement>('.ktl-pop.player');
    expect(pop).not.toBeNull();
    expect(document.activeElement).toBe(pop);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('.ktl-pop')).toBeNull();
    expect(document.activeElement).toBe(strip);
    inst.destroy();
  });
});
