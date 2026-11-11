import { DWELL_MS, FLIP_FPS, makeFlipbook } from './flipbook';
import type { Frame, TickSlot } from '../types';

const slot = (x0: number, count: number): TickSlot => ({ ts: x0 + 30, x0, span: 60, frame: { ts: x0, url: `f${x0}` }, cadence: 10, step: 60, future: false, count });
const frames: Frame[] = [0, 10, 20, 30, 40, 50, 60, 70].map((ts) => ({ ts, url: `f${ts}` }));

describe('the hover flipbook', () => {
  let shown: string[];
  let states: boolean[];
  let fetched: number;
  const target = () => ({
    frames: async (from: number, to: number) => { fetched++; return frames.filter((f) => f.ts >= from && f.ts < to); },
    show: (f: Frame) => shown.push(f.url),
    playingChanged: (on: boolean) => states.push(on),
  });
  beforeEach(() => { jest.useFakeTimers(); shown = []; states = []; fetched = 0; });
  afterEach(() => jest.useRealTimers());
  const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

  test('nothing loads until the cursor has rested on the slot for the whole dwell', async () => {
    const fb = makeFlipbook(target());
    fb.hover(slot(0, 6));
    jest.advanceTimersByTime(DWELL_MS - 1);
    await settle();
    expect(fetched).toBe(0);
    jest.advanceTimersByTime(1);
    await settle();
    expect(fetched).toBe(1);
    expect(states).toEqual([true]);
    expect(shown).toEqual(['f0']);
    jest.advanceTimersByTime(1000 / FLIP_FPS * 2);
    expect(shown).toEqual(['f0', 'f10', 'f20']);
    expect(fb.playing()).toBe(true);
  });

  test('scrubbing across slots never loads', async () => {
    const fb = makeFlipbook(target());
    for (let i = 0; i < 20; i++) { fb.hover(slot(i * 60, 6)); jest.advanceTimersByTime(DWELL_MS / 2); }
    await settle();
    expect(fetched).toBe(0);
  });

  test('moving within the slot keeps the dwell; another slot, or stop, ends it and restores the magnifier', async () => {
    const fb = makeFlipbook(target());
    fb.hover(slot(0, 6));
    jest.advanceTimersByTime(DWELL_MS / 2);
    fb.hover(slot(0, 6));   // the same slot (rebuilt by a poll)
    jest.advanceTimersByTime(DWELL_MS / 2);
    await settle();
    expect(fb.playing()).toBe(true);
    fb.hover(slot(60, 6));
    expect(fb.playing()).toBe(false);
    expect(states).toEqual([true, false]);
    fb.stop();
    jest.advanceTimersByTime(DWELL_MS * 2);
    await settle();
    expect(fetched).toBe(1);
  });

  test('a slot of one frame never plays', async () => {
    const fb = makeFlipbook(target());
    fb.hover(slot(0, 1));
    jest.advanceTimersByTime(DWELL_MS * 2);
    await settle();
    expect(fetched).toBe(0);
  });
});
