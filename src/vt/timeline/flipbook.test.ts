import { DWELL_MS, FLIP_FPS, makeFlipbook } from './flipbook';
import { Reel, type ReelAt } from '../model/reel';
import { buildIntervals } from '../model/intervals';
import type { Frame, TickSlot } from '../types';

const slot = (x0: number, count: number): TickSlot => ({ ts: x0 + 30, x0, span: 60, frame: { ts: x0, url: `f${x0}` }, cadence: 10, step: 60, future: false, count });
const frames: Frame[] = [0, 10, 20, 30, 40, 50, 60, 70].map((ts) => ({ ts, url: `f${ts}` }));

describe('the hover flipbook', () => {
  let shown: string[];
  let states: boolean[];
  let fetched: number;
  // a reel over the frames above: the same model the preview player plays
  const source = {
    step: 60,
    fetch: async (from: number, to: number) => frames.filter((f) => f.ts >= from && f.ts < to),
    intervals: (fs: Frame[], range: { from: number; to: number }) => buildIntervals({ frames: fs, window: range, now: 1e9, hold: 'none' }).intervals,
  };
  const target = () => ({
    reel: (slot: { from: number; to: number; ts: number }) => { fetched++; return new Reel(source, slot); },
    show: (at: ReelAt) => shown.push(at.frame!.url),
    playingChanged: (on: boolean) => states.push(on),
  });
  beforeEach(() => { jest.useFakeTimers(); shown = []; states = []; fetched = 0; });
  afterEach(() => jest.useRealTimers());
  const settle = async () => { for (let i = 0; i < 6; i++) {await Promise.resolve();} };

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

  test('it plays a gap too, as the player does: it shows the gap\'s stop', async () => {
    const gappy = { ...source, fetch: async (from: number, to: number) => frames.filter((f) => f.ts >= from && f.ts < to && f.ts !== 20 && f.ts !== 30),
      intervals: (fs: Frame[], range: { from: number; to: number }) => buildIntervals({ frames: fs, window: range, now: 1e9, promiseAt: () => 10 }).intervals };
    const seen: string[] = [];
    const fb = makeFlipbook({ reel: (slot) => new Reel(gappy, slot), show: (at) => seen.push(at.gap ? at.kind : at.frame!.url), playingChanged: () => {} });
    fb.hover(slot(0, 6));
    jest.advanceTimersByTime(DWELL_MS);
    await settle();
    jest.advanceTimersByTime((1000 / FLIP_FPS) * 4);
    expect(seen).toEqual(['f0', 'f10', 'dropped', 'f40', 'f50']);
  });

  test('a slot a clip covers plays the clip\'s part of it, not its stills; stopping stops it', async () => {
    const spans: Array<[string, number, number] | null> = [];
    const clipSource = { ...source, clips: async () => [{ from: 15, to: 45, url: 'c.webm' }] };
    const fb = makeFlipbook({
      ...target(),
      reel: (sl) => new Reel(clipSource, sl),
      clip: (sp) => spans.push(sp && [sp.clip.url, sp.from, sp.to]),
    }, false, () => true);
    // one frame in the slot, but video over it: it arms
    fb.hover(slot(0, 1));
    jest.advanceTimersByTime(DWELL_MS);
    await settle();
    expect(spans).toEqual([['c.webm', 15, 45]]);
    expect(shown).toEqual([]);
    expect(fb.playing()).toBe(true);
    fb.stop();
    expect(spans).toEqual([['c.webm', 15, 45], null]);
    expect(states).toEqual([true, false]);
  });
});
