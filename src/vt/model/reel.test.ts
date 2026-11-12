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

describe('a slot\'s video, zoomed out (M10c)', () => {
  // the clip over 12-16 again: four minutes of the slot
  const clip = { from: at(12), to: at(16), url: 'c.mp4' };
  // no promise here, so a clip covers what would be no data
  const loaded = async (ratio: number | null, frames = all, clips = [clip]) => {
    const r = new Reel(source({
      fetch: async (from, to) => frames.filter((f) => f.ts >= from && f.ts <= to),
      clips: async (from, to) => clips.filter((c) => c.to > from && c.from < to),
      intervals: (fs, range, sample, cs) => buildIntervals({ frames: fs, window: range, now: at(999), hold: MIN, sample, clips: cs }).intervals,
    }), slot);
    await r.load(100);
    r.ratio = ratio;
    return r;
  };

  test('a few seconds of video is watched, over the stills', async () => {
    const r = await loaded(4 / (4 * MIN));   // 4 s for the 4 minutes
    expect(r.videoSeconds()).toBeCloseTo(4);
    expect(r.videoRate()).toBe(1);
    expect(r.watched()).toHaveLength(1);
    expect(r.at(at(14)).kind).toBe('clip');
  });

  test('a little more is sped up to fit; its length unknown, it plays as it is', async () => {
    expect((await loaded(20 / (4 * MIN))).videoRate()).toBeCloseTo(2);
    expect((await loaded(160 / (4 * MIN))).videoRate()).toBeCloseTo(16);
    expect((await loaded(null)).videoRate()).toBe(1);
  });

  test('more than plays in a few seconds (real time): the slot\'s stills, as any slot of frames', async () => {
    const r = await loaded(1 / 1000);   // real time: four minutes of video
    expect(r.videoRate()).toBeNull();
    expect(r.watched()).toEqual([]);
    expect(r.clipSpans()).toHaveLength(1);
    expect(r.inSlot().map((f) => f.url)).toEqual(['f13', 'f14', 'f15', 'f16', 'f17', 'f18', 'f19']);
    expect(r.at(at(14))).toMatchObject({ kind: 'frame', frame: { url: 'f14' } });
    expect(r.playable(100)).toBe(true);
    // 10-12 no data; 12-13 only the clip: a stop of its own, the video's frame
    expect(r.stops(10).map((t) => t / MIN)).toEqual([10, 12, 13, 14, 15, 16, 17, 18, 19]);
    expect(r.at(at(12.5))).toMatchObject({ kind: 'clip' });
  });

  test('sampled with no stills under it: the video\'s own frames, a share of the stops', async () => {
    const r = await loaded(1 / 1000, [fr(9)], [{ from: at(10), to: at(20), url: 'all.mp4' }]);
    expect(r.videoRate()).toBeNull();
    expect(r.stops(5).map((t) => t / MIN)).toEqual([10, 12, 14, 16, 18]);
    expect(r.at(at(15))).toMatchObject({ kind: 'clip', span: { clip: { url: 'all.mp4' } } });
    expect(r.clipAt(at(15))).toBeNull();   // not watched: seeked, not played
  });

  test('more clips than the view can show: the stills, never video with clips left out', async () => {
    const hourly = Array.from({ length: 10 }, (_, i) => ({ from: at(10 + i), to: at(11 + i), url: `h${i}.mp4` }));
    const r = await loaded(1 / (60 * 1000) / 10, all, hourly);   // a second of video a minute: 10 s in all
    r.capacity = 20;
    expect(r.videoRate()).toBe(1);
    expect(r.watched()).toHaveLength(10);
    r.capacity = 5;
    expect(r.videoRate()).toBeNull();
    expect(r.watched()).toEqual([]);
    expect(r.at(at(14))).toMatchObject({ kind: 'frame', frame: { url: 'f14' } });
  });

  test('each clip\'s picture: the still nearest its start, within it, else the one in force there', async () => {
    const r = await loaded(null, all, [{ from: at(12.5), to: at(13.5), url: 'a' }, { from: at(10.5), to: at(11), url: 'b' }]);
    const [b, a] = r.clipSpans();
    expect(r.stillFor(a)!.url).toBe('f13');
    expect(r.stillFor(b)!.url).toBe('f9');
  });
});
