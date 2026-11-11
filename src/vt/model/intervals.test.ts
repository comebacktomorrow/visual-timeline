import { AUTO_HOLD_FALLBACK, buildIntervals, Interval, IntervalInput } from './intervals';
import type { Frame } from '../types';

const M = 60e3;
const T0 = Date.UTC(2026, 10, 10, 12, 0, 0);
const fr = (min: number, extra: Partial<Frame> = {}): Frame => ({ ts: T0 + min * M, url: `f${min}.jpg`, ...extra });
const at = (min: number) => T0 + min * M;

/* intervals as [fromMin, toMin, kind, frame url?] for readable assertions */
const brief = (ivs: Interval[]) => ivs.map((i) => [(i.from - T0) / M, (i.to - T0) / M, i.kind, ...(i.frame ? [i.frame.url] : [])]);

/* every build must tile its window: in order, contiguous, nothing empty */
function tiles(ivs: Interval[], from: number, to: number) {
  expect(ivs[0].from).toBe(from);
  expect(ivs[ivs.length - 1].to).toBe(to);
  for (let i = 0; i < ivs.length; i++) {
    expect(ivs[i].to).toBeGreaterThan(ivs[i].from);
    if (i) {expect(ivs[i].from).toBe(ivs[i - 1].to);}
  }
}

function build(over: Partial<IntervalInput> & Pick<IntervalInput, 'frames'>) {
  const input: IntervalInput = { window: { from: at(0), to: at(60) }, now: at(1000), ...over };
  const r = buildIntervals(input);
  tiles(r.intervals, input.window.from, input.window.to);
  return r;
}

describe('frames with no promise', () => {
  it('Kīlauea F1: gaps of 20 and 10 minutes draw as one continuous strip, with no gaps', () => {
    // frames at :09, :29, :39, :59 each hour
    const mins = [-21, -1, 9, 29, 39, 59, 69, 89, 99, 119, 129];
    const r = build({ frames: mins.map((m) => fr(m)), window: { from: at(0), to: at(120) } });
    expect(r.intervals.every((i) => i.kind === 'frame')).toBe(true);
    expect(brief(r.intervals).slice(0, 3)).toEqual([[0, 9, 'frame', 'f-1.jpg'], [9, 29, 'frame', 'f9.jpg'], [29, 39, 'frame', 'f29.jpg']]);
  });

  it('auto hold: a silence much longer than the typical gap ends in neutral no data, never red', () => {
    // a frame a minute, then 30 minutes of nothing
    const frames = [0, 1, 2, 3, 4, 5, 35, 36, 37].map((m) => fr(m));
    const r = build({ frames });
    expect(r.intervals.some((i) => i.kind === 'dropped')).toBe(false);
    // three times the typical gap (1 minute) after 5
    expect(brief(r.intervals).slice(5, 7)).toEqual([[5, 8, 'frame', 'f5.jpg'], [8, 35, 'nodata']]);
  });

  it('hold none: each frame until the next, however long', () => {
    const r = build({ frames: [fr(0), fr(1), fr(40)], hold: 'none' });
    expect(brief(r.intervals)).toEqual([[0, 1, 'frame', 'f0.jpg'], [1, 40, 'frame', 'f1.jpg'], [40, 60, 'frame', 'f40.jpg']]);
  });

  it('a fixed hold limit', () => {
    const r = build({ frames: [fr(0), fr(30)], hold: 5 * M });
    expect(brief(r.intervals)).toEqual([[0, 5, 'frame', 'f0.jpg'], [5, 30, 'nodata'], [30, 35, 'frame', 'f30.jpg'], [35, 60, 'nodata']]);
  });

  it('a lone frame holds for the fallback', () => {
    const r = build({ frames: [fr(0)], window: { from: at(0), to: at(120) } });
    expect(brief(r.intervals)).toEqual([[0, AUTO_HOLD_FALLBACK / M, 'frame', 'f0.jpg'], [AUTO_HOLD_FALLBACK / M, 120, 'nodata']]);
  });

  it('no frames and no promise: no data, not offline', () => {
    expect(brief(build({ frames: [] }).intervals)).toEqual([[0, 60, 'nodata']]);
  });
});

describe('promised frames', () => {
  const minute = () => M;

  it('a kept promise: frames until the next, with drift inside the tolerance', () => {
    const r = build({ frames: [fr(0), fr(1.4), fr(2.5), fr(3.5)], promiseAt: minute, window: { from: at(0), to: at(4) } });
    expect(r.intervals.map((i) => i.kind)).toEqual(['frame', 'frame', 'frame', 'frame']);
  });

  it('a broken promise: dropped from when the frame was due until the next frame', () => {
    const r = build({ frames: [fr(0), fr(1), fr(5), fr(6)], promiseAt: minute, window: { from: at(0), to: at(7) } });
    expect(brief(r.intervals)).toEqual([
      [0, 1, 'frame', 'f0.jpg'], [1, 2, 'frame', 'f1.jpg'], [2, 5, 'dropped'], [5, 6, 'frame', 'f5.jpg'], [6, 7, 'frame', 'f6.jpg'],
    ]);
  });

  it("a frame's own cadence is its promise, ahead of the source's", () => {
    // the source promises a minute; this frame promises 10
    const r = build({ frames: [fr(0, { cadence: 10 * M }), fr(8)], promiseAt: minute, window: { from: at(0), to: at(9) } });
    expect(r.intervals.some((i) => i.kind === 'dropped')).toBe(false);
  });

  it('a pace that changes frame by frame needs no eras', () => {
    const frames = [fr(0, { cadence: M }), fr(1, { cadence: 10 * M }), fr(11, { cadence: 10 * M }), fr(21, { cadence: M }), fr(22)];
    const r = build({ frames, window: { from: at(0), to: at(22) } });
    expect(r.intervals.every((i) => i.kind === 'frame')).toBe(true);
  });

  it('asked at a coarser interval ($__interval): a frame a step apart keeps a finer promise', () => {
    // a minute promised, rows two minutes apart (asked for at 90 s): kept
    const rows = [0, 2, 4, 6].map((m) => fr(m));
    const r = build({ frames: rows, promiseAt: minute, sample: 90e3, window: { from: at(0), to: at(7) } });
    expect(r.intervals.some((i) => i.kind === 'dropped')).toBe(false);
    // a real outage still breaks it: 6 to 14
    const out = build({ frames: [...rows, fr(14)], promiseAt: minute, sample: 90e3, window: { from: at(0), to: at(15) } });
    expect(brief(out.intervals).filter((i) => i[2] === 'dropped')).toEqual([[8, 14, 'dropped']]);
  });

  it('without the interval, the same rows are dropped every other minute', () => {
    const r = build({ frames: [0, 2, 4, 6].map((m) => fr(m)), promiseAt: minute, window: { from: at(0), to: at(7) } });
    expect(r.intervals.filter((i) => i.kind === 'dropped')).toHaveLength(3);
  });

  it('a first frame within its promise of the window\'s start is no broken promise', () => {
    const r = build({ frames: [fr(0.5), fr(1.5)], promiseAt: minute, window: { from: at(0), to: at(2) } });
    expect(brief(r.intervals)[0]).toEqual([0, 0.5, 'nodata']);
  });

  it('a promised source silent all window: dropped from the start', () => {
    expect(brief(build({ frames: [], promiseAt: minute }).intervals)).toEqual([[0, 60, 'dropped']]);
  });
});

describe('the live edge', () => {
  const minute = () => M;
  const win = { from: at(0), to: at(10) };

  it('promised: shown until due, then pending for a cadence', () => {
    const r = build({ frames: [fr(8)], promiseAt: minute, window: win, now: at(9.2) });
    expect(brief(r.intervals)).toEqual([[0, 8, 'dropped'], [8, 9, 'frame', 'f8.jpg'], [9, 9.2, 'pending', 'f8.jpg'], [9.2, 10, 'beyond']]);
  });

  it('promised and overdue: dropped up to now', () => {
    const r = build({ frames: [fr(5)], promiseAt: minute, window: win, now: at(9) });
    expect(brief(r.intervals).slice(1)).toEqual([[5, 6, 'frame', 'f5.jpg'], [6, 7, 'pending', 'f5.jpg'], [7, 9, 'dropped'], [9, 10, 'beyond']]);
  });

  it('no promise: the last frame holds up to now, never overdue', () => {
    const r = build({ frames: [fr(1), fr(2), fr(3)], window: win, now: at(6) });
    expect(brief(r.intervals).slice(-2)).toEqual([[3, 6, 'frame', 'f3.jpg'], [6, 10, 'beyond']]);
  });
});

describe('the window', () => {
  it('the frame in force at its start is shown from it', () => {
    const r = build({ frames: [fr(-30), fr(-5), fr(10)], hold: 'none' });
    expect(brief(r.intervals)[0]).toEqual([0, 10, 'frame', 'f-5.jpg']);
    expect(r.frames.map((f) => f.url)).toEqual(['f-5.jpg', 'f10.jpg']);
  });

  it('at() finds the interval in force, clamped to the window', () => {
    const r = build({ frames: [fr(0), fr(30)], hold: 'none' });
    expect(r.at(at(29))!.frame!.url).toBe('f0.jpg');
    expect(r.at(at(30))!.frame!.url).toBe('f30.jpg');
    expect(r.at(at(-10))!.frame!.url).toBe('f0.jpg');
    expect(r.at(at(99))!.frame!.url).toBe('f30.jpg');
  });
});

describe('pauses', () => {
  const minute = () => M;

  it('a pause cuts the frame short; after it, nothing until a frame is due, then the promise breaks', () => {
    const r = build({
      frames: [fr(0), fr(1), fr(20)], promiseAt: minute, window: { from: at(0), to: at(21) },
      pauses: [{ from: at(2), to: at(10), label: 'Quiet hours' }],
    });
    expect(brief(r.intervals)).toEqual([
      [0, 1, 'frame', 'f0.jpg'], [1, 2, 'frame', 'f1.jpg'], [2, 10, 'paused'], [10, 11, 'nodata'], [11, 20, 'dropped'], [20, 21, 'frame', 'f20.jpg'],
    ]);
    expect(r.intervals[2].pause!.label).toBe('Quiet hours');
  });

  it('a frame inside a pause is not drawn', () => {
    const r = build({ frames: [fr(0), fr(5), fr(20)], hold: 'none', window: { from: at(0), to: at(21) }, pauses: [{ from: at(2), to: at(10) }] });
    expect(r.intervals.some((i) => i.frame?.url === 'f5.jpg')).toBe(false);
  });

  it('an open pause ends at the first frame after its resume grace', () => {
    const r = build({
      frames: [fr(0), fr(1), fr(2.2), fr(15), fr(16)], promiseAt: minute, window: { from: at(0), to: at(17) },
      pauses: [{ from: at(2), to: null, resumeAfter: M }],
    });
    // 2.2 is the goodbye straggler, inside the grace: the pause runs to 15
    expect(brief(r.intervals).slice(1, 4)).toEqual([[1, 2, 'frame', 'f1.jpg'], [2, 15, 'paused'], [15, 16, 'frame', 'f15.jpg']]);
  });

  it('an open pause with no frame after it runs to now', () => {
    const r = build({ frames: [fr(0)], promiseAt: minute, window: { from: at(0), to: at(10) }, now: at(8), pauses: [{ from: at(1), to: null }] });
    expect(brief(r.intervals)).toEqual([[0, 1, 'frame', 'f0.jpg'], [1, 8, 'paused'], [8, 10, 'beyond']]);
  });
});

describe('video clips (M10c)', () => {
  const clip = (a: number, b: number) => ({ from: at(a), to: at(b), url: `c${a}.mp4` });
  it('a clip covers what would be no data; frames still win', () => {
    // no promise; a fixed hold, so where no data starts is plain
    const r = build({ frames: [fr(0), fr(1), fr(40)], hold: 5 * M, clips: [clip(10, 30), clip(30, 50)] });
    expect(brief(r.intervals)).toEqual([
      [0, 1, 'frame', 'f0.jpg'], [1, 6, 'frame', 'f1.jpg'], [6, 10, 'nodata'],
      [10, 30, 'clip'], [30, 40, 'clip'], [40, 45, 'frame', 'f40.jpg'], [45, 50, 'clip'], [50, 60, 'nodata'],
    ]);
    expect(r.intervals[3].clip!.url).toBe('c10.mp4');
  });
  it('a broken promise is still dropped: a promise is about frames', () => {
    const r = build({ frames: [fr(0)], promiseAt: () => M, clips: [clip(0, 60)] });
    expect(brief(r.intervals).map((x) => x[2])).toEqual(['frame', 'pending', 'dropped']);
  });
});
