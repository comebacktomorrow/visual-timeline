import { buildIntervals } from './intervals';
import { clipTime, Reel, videoTime, type ReelSource } from './reel';
import type { Frame } from '../types';

const MIN = 60e3;
const at = (m: number) => m * MIN;
const fr = (m: number, extra: Partial<Frame> = {}): Frame => ({ ts: at(m), url: `f${m}`, ...extra });

/* a minute promised; frames 0-9 and 13-19 (10 to 12 missing) */
const all = [...Array.from({ length: 10 }, (_, i) => fr(i)), ...Array.from({ length: 7 }, (_, i) => fr(13 + i))];
const source = (extra: Partial<ReelSource> = {}): ReelSource => ({
  step: 10 * MIN,
  fetch: async (from, to) => all.filter((f) => f.ts >= from && f.ts <= to),
  intervals: (frames, range, sample) => buildIntervals({ frames, window: range, now: at(999), promiseAt: () => MIN, sample }).intervals,
  ...extra,
});
const slot = { from: at(10), to: at(20), ts: at(10) };

describe('a slot\'s reel', () => {
  test('the slot\'s frames, the one in force at its start, and the gap', async () => {
    const r = new Reel(source(), slot);
    expect(await r.load(100)).toBe(true);
    expect(r.inSlot().map((f) => f.url)).toEqual(['f13', 'f14', 'f15', 'f16', 'f17', 'f18', 'f19']);
    expect(r.prior()!.url).toBe('f9');
    expect(r.gaps().map((g) => [g.kind, g.from / MIN, g.to / MIN])).toEqual([['dropped', 10, 13]]);
  });

  test('stops: each frame, and the gap\'s start; stepping and cycling through them', async () => {
    const r = new Reel(source(), slot);
    await r.load(100);
    expect(r.stops(100).map((t) => t / MIN)).toEqual([10, 13, 14, 15, 16, 17, 18, 19]);
    expect(r.at(at(11))).toMatchObject({ kind: 'dropped', gap: true });
    expect(r.step(at(10), 1, 100)! / MIN).toBe(13);
    expect(r.step(at(10), -1, 100)).toBeNull();
    expect(r.cycle(at(19), 100)! / MIN).toBe(10);
  });

  test('more frames than shown: evenly through the slot; the total counts thinned rows', async () => {
    const r = new Reel(source({ fetch: async (from, to) => all.filter((f) => f.ts >= from && f.ts <= to).map((f) => ({ ...f, count: 3 })) }), slot);
    await r.load(100);
    expect(r.shown(3).map((f) => f.url)).toEqual(['f13', 'f15', 'f17']);
    expect(r.total()).toBe(21);
  });

  test('the frame it was seeded with is shown until it loads, and not kept after', async () => {
    const r = new Reel(source(), slot, { ts: at(15) + 30e3, url: 'clicked' });
    expect(r.at(at(16)).frame!.url).toBe('clicked');
    await r.load(100);
    expect(r.frames.some((f) => f.url === 'clicked')).toBe(false);
  });

  test('asked again (detail): no finer than the points, judged at their interval', async () => {
    const asked: number[] = [];
    const r = new Reel(source({ detail: async (from, to, n) => { asked.push(n!); return all.filter((f) => f.ts >= from && f.ts < to); } }), slot);
    await r.load(40);
    expect(asked).toEqual([40]);
  });

  test('a load superseded by another says so', async () => {
    const r = new Reel(source(), slot);
    const first = r.load(100);
    const second = r.load(100);
    expect(await first).toBe(false);
    expect(await second).toBe(true);
  });
});

describe('a slot\'s reel with a video clip (M10c)', () => {
  // a clip over 12-16: it plays over the stills 13-15, and covers part of the gap
  const clip = { from: at(12), to: at(16), url: 'c.mp4' };
  const withClip = (clips = [clip]) => source({ clips: async (from, to) => clips.filter((c) => c.to > from && c.from < to) });

  test('the clip plays over the stills under it, and over the gap', async () => {
    const r = new Reel(withClip(), slot);
    await r.load(100);
    expect(r.clipSpans().map((c) => [c.from / MIN, c.to / MIN])).toEqual([[12, 16]]);
    expect(r.inSlot().map((f) => f.url)).toEqual(['f16', 'f17', 'f18', 'f19']);
    expect(r.total()).toBe(4);
    expect(r.gaps().map((g) => [g.kind, g.from / MIN, g.to / MIN])).toEqual([['dropped', 10, 12]]);
    expect(r.stops(100).map((t) => t / MIN)).toEqual([10, 12, 16, 17, 18, 19]);
    expect(r.at(at(14))).toMatchObject({ kind: 'clip', gap: false, span: { clip } });
    expect(r.at(at(17)).frame!.url).toBe('f17');
  });

  test('a slot that is all clip plays, and its one stop comes round again', async () => {
    const r = new Reel(withClip([{ from: at(9), to: at(21), url: 'all.mp4' }]), slot);
    await r.load(100);
    expect(r.stops(100).map((t) => t / MIN)).toEqual([10]);
    expect(r.playable(100)).toBe(true);
    expect(r.cycle(at(15), 100)! / MIN).toBe(10);
  });

  test('overlapping clips: the later from its start', async () => {
    const r = new Reel(withClip([{ from: at(10), to: at(18), url: 'a' }, { from: at(14), to: at(20), url: 'b' }]), slot);
    await r.load(100);
    expect(r.clipSpans().map((c) => [c.clip.url, c.from / MIN, c.to / MIN])).toEqual([['a', 10, 14], ['b', 14, 20]]);
  });

  test('a time in a clip is its fraction of the video, real time or timelapse alike', () => {
    const day = { from: 0, to: 864e5, url: 'day.mp4' };
    expect(videoTime(day, 432e5, 7)).toBeCloseTo(3.5);
    expect(clipTime(day, 3.5, 7)).toBeCloseTo(432e5);
    expect(videoTime(day, -5, 7)).toBe(0);
    expect(clipTime(day, 99, 7)).toBe(864e5);
  });
});
