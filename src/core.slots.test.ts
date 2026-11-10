import { buildSourceModel, ghostFor, slotClass } from './core';

/* How a source's window becomes slots (docs/TIMELINE-MODEL.md), and how
 * each slot is classified: frame, dropped ("gap": offline), no data ("gap
 * nodata"), pending ("future"), a pause, or the beyond-now spacer. */

const MIN = 60e3;
const DAY = 864e5;
const T0 = Date.UTC(2026, 6, 1); // 2026-07-01T00:00Z, a multiple of every step used here
const BUDGET = 1000; // pixel budget large enough that no era is downsampled

type Frame = { ts: number; url: string };
type Call = { from: number; to: number; step: number };

/* A frames backend over a fixed set of frame timestamps: at most one frame
 * per step-sized bucket, the one nearest each bucket tick (docs/API.md). */
function backendWith(have: number[]) {
  const calls: Call[] = [];
  return {
    calls,
    frames(_site: string, _id: string, from: number, to: number, step: number): Promise<Frame[]> {
      calls.push({ from, to, step });
      const out: Frame[] = [];
      for (let t = Math.ceil(from / step) * step; t <= to; t += step) {
        let best: number | null = null;
        for (const ts of have) {
          if (ts < from || ts > to || Math.abs(ts - t) > step / 2) {
            continue;
          }
          if (best === null || Math.abs(ts - t) < Math.abs(best - t)) {
            best = ts;
          }
        }
        if (best !== null) {
          out.push({ ts: best, url: `frame/${best}` });
        }
      }
      return Promise.resolve(out);
    },
  };
}

/* frame timestamps every `step` from `a` to `b` inclusive, skipping `except` */
function every(step: number, a: number, b: number, except: (ts: number) => boolean = () => false) {
  const out: number[] = [];
  for (let ts = a; ts <= b; ts += step) {
    if (!except(ts)) {
      out.push(ts);
    }
  }
  return out;
}

/* compact view of a slot list: [minutes after T0, class] */
const view = (slots: any[]) => slots.map((sl) => [(sl.ts - T0) / MIN, slotClass(sl).trim()]);

/* the decls and backends here are partial stand-ins; read the model loosely */
type Model = { eras: any[]; slots: any[]; drops: any[]; step: number; slotAt: (t: number) => any; lastActive: any; refresh: (f: any[], now: number) => void };
type BuildArgs = Parameters<typeof buildSourceModel>;
const build = (d: object, P: { from: number; to: number }, backend: object, budget: number, opts: BuildArgs[4] = {}): Promise<Model> =>
  buildSourceModel(d as BuildArgs[0], P, backend as BuildArgs[2], budget, opts) as unknown as Promise<Model>;

const decl = (extra: Record<string, unknown> = {}) => ({ id: 'source-1', site: 'site-a', cadence: 60e3, ...extra });

let now = 0;
beforeEach(() => {
  jest.spyOn(Date, 'now').mockImplementation(() => now);
});
afterEach(() => {
  jest.restoreAllMocks();
});


describe('slotClass', () => {
  test.each([
    [{ ts: 0, span: 1, frame: { ts: 0, url: 'u' }, future: false }, ''],
    [{ ts: 0, span: 1, frame: null, future: false }, ' gap'],
    [{ ts: 0, span: 1, frame: null, future: false, nodata: true }, ' gap nodata'],
    [{ ts: 0, span: 1, frame: null, future: true }, ' future'],
    [{ ts: 0, span: 1, frame: { ts: 0, url: 'u' }, future: true }, ''],
    [{ ts: 0, span: 1, beyond: true }, ' beyond'],
    [{ ts: 0, span: 1, paused: true }, ' paused'],
    // the core knows no reasons: a pause is its label and colour
    [{ ts: 0, span: 1, paused: true, reason: 'screen-sleep', intended: false }, ' paused'],
    [{ ts: 0, span: 1, paused: true, label: 'Down', color: '#f00' }, ' paused tinted'],
  ])('%p → %p', (sl, cls) => {
    expect(slotClass(sl)).toBe(cls);
  });
});

describe('ghostFor (the pending slot’s "last known" frame)', () => {
  const f = (ts: number) => ({ ts, url: `frame/${ts}` });
  const s = (ts: number, extra: Record<string, unknown>): any => ({ ts, span: MIN, step: MIN, ...extra });

  test('carries the nearest earlier frame across other pending slots', () => {
    const slots = [s(0, { frame: f(0) }), s(1, { frame: f(1) }), s(2, { future: true, frame: null }), s(3, { future: true, frame: null })];
    expect(ghostFor(slots, slots[3])).toBe(slots[1].frame);
    expect(ghostFor(slots, slots[2])).toBe(slots[1].frame);
  });
  test('a gap in between means nothing to carry', () => {
    const slots = [s(0, { frame: f(0) }), s(1, { frame: null, future: false }), s(2, { future: true, frame: null })];
    expect(ghostFor(slots, slots[2])).toBeNull();
  });
  test('a pause band in between means nothing to carry', () => {
    const slots = [s(0, { frame: f(0) }), { ts: 1, span: 5 * MIN, paused: true }, s(6, { future: true, frame: null })];
    expect(ghostFor(slots, slots[2])).toBeNull();
  });
  test('the window start means nothing to carry', () => {
    const slots = [s(0, { future: true, frame: null }), s(1, { future: true, frame: null })];
    expect(ghostFor(slots, slots[0])).toBeNull();
    expect(ghostFor(slots, slots[1])).toBeNull();
  });
});

/* the slots tile the window: in order, contiguous, start to end */
function tiles(m: Model, P: { from: number; to: number }) {
  expect(m.slots[0].x0).toBe(P.from);
  for (let i = 1; i < m.slots.length; i++) {expect(m.slots[i].x0).toBeCloseTo(m.slots[i - 1].x0 + m.slots[i - 1].span, 6);}
  const end = m.slots[m.slots.length - 1];
  expect(end.x0 + end.span).toBeCloseTo(P.to, 6);
}

describe('buildSourceModel: a source that promises its cadence', () => {
  const P = { from: T0, to: T0 + 10 * MIN };
  beforeEach(() => { now = T0 + DAY; });

  test('every frame present: one slot per tick, both ends inclusive, tiling the window', async () => {
    const m = await build(decl(), P, backendWith(every(MIN, P.from, P.to)), BUDGET);
    expect(view(m.slots)).toEqual(every(MIN, P.from, P.to).map((ts) => [(ts - T0) / MIN, '']));
    tiles(m, P);
  });

  test('the step coarsens to the pixel budget in whole cadences, and sampled frames keep their promise', async () => {
    const W = { from: T0, to: T0 + 360 * MIN };
    const m = await build(decl(), W, backendWith(every(MIN, W.from, W.to)), 100);
    expect(m.step).toBe(4 * MIN);
    expect(m.slots.every((sl) => sl.frame)).toBe(true);
  });

  test('a missed frame is dropped from when it was due: offline', async () => {
    const m = await build(decl(), P, backendWith(every(MIN, P.from, P.to, (ts) => ts === T0 + 4 * MIN || ts === T0 + 5 * MIN)), BUDGET);
    expect(view(m.slots).slice(3, 7)).toEqual([[3, ''], [4, 'gap'], [5, 'gap'], [6, '']]);
  });

  test('drift within the tolerance is not a gap', async () => {
    // every frame 20 s late, two of them 40 s late
    const have = every(MIN, P.from, P.to).map((ts, i) => ts + (i === 3 || i === 6 ? 40e3 : 20e3));
    const m = await build(decl(), P, { frames: () => Promise.resolve(have.map((ts) => ({ ts, url: `f/${ts}` }))) }, BUDGET);
    expect(m.slots.filter((sl) => !sl.frame && !sl.beyond)).toEqual([]);
  });

  test('a cadence change mid-window: frames in the slow era keep its promise, so they are not gaps', async () => {
    const d = decl({ history: [{ since: T0 + 4 * MIN, cadence: 3 * MIN }] });
    const have = [...every(MIN, T0, T0 + 4 * MIN), ...every(3 * MIN, T0 + 7 * MIN, T0 + 10 * MIN)];
    const m = await build(d, P, backendWith(have), BUDGET);
    expect(m.slots.some((sl) => sl.frame === null && !sl.beyond)).toBe(false);
  });

  test('a declared (bounded) pause next to an unexpected gap: neutral band vs offline slots', async () => {
    const d = decl({ history: [{ since: T0 + 2 * MIN, paused: true, label: 'Quiet', color: '#00f' }, { since: T0 + 5 * MIN }] });
    const have = every(MIN, P.from, P.to, (ts) => (ts > T0 + 1 * MIN && ts < T0 + 5 * MIN) || ts === T0 + 7 * MIN);
    const m = await build(d, P, backendWith(have), BUDGET);
    const band = m.slots.find((sl) => sl.paused);
    expect([(band.x0 - T0) / MIN, band.span / MIN, band.label]).toEqual([2, 3, 'Quiet']);
    expect(view(m.slots).filter(([, c]) => c === 'gap').map(([t]) => t)).toEqual([7]);
    tiles(m, P);
  });

  test('a goodbye frame on a pause’s start tick stays visible', async () => {
    const d = decl({ history: [{ since: T0 + 5 * MIN, paused: true }, { since: T0 + 8 * MIN }] });
    const m = await build(d, P, backendWith(every(MIN, P.from, P.to, (ts) => ts > T0 + 5 * MIN && ts < T0 + 8 * MIN)), BUDGET);
    const i = m.slots.findIndex((sl) => sl.paused);
    expect(m.slots[i - 1].frame.ts).toBe(T0 + 5 * MIN);
  });

  test('a tail pause with no frames since: one band to the window end', async () => {
    const d = decl({ history: [{ since: T0 + 6 * MIN, paused: true }] });
    const m = await build(d, P, backendWith(every(MIN, P.from, T0 + 6 * MIN)), BUDGET);
    const last = m.slots[m.slots.length - 1];
    expect([last.paused, (last.x0 - T0) / MIN, (last.x0 + last.span - T0) / MIN]).toEqual([true, 6, 10]);
  });

  test('a tail pause ends at the first frame a cadence into it, not at a goodbye straggler', async () => {
    const d = decl({ history: [{ since: T0 + 3 * MIN, paused: true }] });
    const have = [...every(MIN, T0, T0 + 3 * MIN), T0 + 3 * MIN + 20e3, ...every(MIN, T0 + 7 * MIN, P.to)];
    const m = await build(d, P, { frames: () => Promise.resolve(have.map((ts) => ({ ts, url: `f/${ts}` }))) }, BUDGET);
    const band = m.slots.find((sl) => sl.paused);
    expect([(band.x0 - T0) / MIN, (band.x0 + band.span - T0) / MIN]).toEqual([3, 7]);
  });

  test('slotAt: the slot whose span holds t; before the window the first, past it the last', async () => {
    const m = await build(decl(), P, backendWith(every(MIN, P.from, P.to)), BUDGET);
    expect(m.slotAt(T0 + 3 * MIN + 29e3).ts).toBe(T0 + 3 * MIN);
    expect(m.slotAt(T0 + 3 * MIN + 31e3).ts).toBe(T0 + 4 * MIN);
    expect(m.slotAt(T0 - DAY)).toBe(m.slots[0]);
    expect(m.slotAt(T0 + DAY)).toBe(m.slots[m.slots.length - 1]);
  });

  test('a drop shorter than a slot, between frames, is marked at its true place', async () => {
    // 10-second frames, sampled a minute per slot; 30 s missing at 4:00
    const have = every(10e3, P.from, P.to, (ts) => ts > T0 + 4 * MIN && ts < T0 + 4 * MIN + 40e3);
    const d = decl({ cadence: 10e3 });
    const m = await build(d, P, { frames: () => Promise.resolve(have.map((ts) => ({ ts, url: `f/${ts}` }))) }, 10);
    expect(m.step).toBe(MIN);
    expect(m.slots.every((sl) => sl.frame || sl.beyond)).toBe(true);
    expect(m.drops.map((x: { from: number; to: number }) => [(x.from - T0) / 1e3, (x.to - T0) / 1e3])).toEqual([[250, 280]]);
    // a slot that took several frames says so (M10 plays through them)
    expect(m.slots[2].count).toBe(6);
  });
});

describe('the live right edge', () => {
  const NOW = T0 + 10 * MIN + 10e3;
  const P = { from: T0, to: T0 + 15 * MIN };
  beforeEach(() => { now = NOW; });

  test('the frame due just now is pending, and carries the last frame as its ghost', async () => {
    now = T0 + 10 * MIN + 10e3;
    const m = await build(decl(), P, backendWith(every(MIN, P.from, T0 + 9 * MIN)), BUDGET);
    const pending = m.slots.filter((sl) => sl.future);
    expect(pending.map((sl) => (sl.ts - T0) / MIN)).toEqual([10]);
    expect(ghostFor(m.slots, pending[0])!.ts).toBe(T0 + 9 * MIN);
  });

  test('still pending most of a cadence after it was due', async () => {
    now = T0 + 10 * MIN + 50e3;
    const m = await build(decl(), P, backendWith(every(MIN, P.from, T0 + 9 * MIN)), BUDGET);
    expect(m.slots.find((sl) => sl.ts === T0 + 10 * MIN && !sl.beyond).future).toBe(true);
  });

  test('overdue a full cadence after it was due: dropped, offline', async () => {
    now = T0 + 11 * MIN + 10e3;
    const m = await build(decl(), P, backendWith(every(MIN, P.from, T0 + 9 * MIN)), BUDGET);
    const edge = m.slots.find((sl) => sl.ts === T0 + 11 * MIN && !sl.beyond);
    expect([edge.frame, edge.future, edge.nodata]).toEqual([null, false, undefined]);
  });

  test('nothing past now: one spacer covers the rest, and the poll slides it along', async () => {
    const m = await build(decl(), P, backendWith(every(MIN, P.from, T0 + 10 * MIN)), BUDGET);
    const tail = m.slots[m.slots.length - 1];
    expect([tail.beyond, tail.x0, tail.x0 + tail.span]).toEqual([true, NOW, P.to]);
    tiles(m, P);
    m.refresh([{ ts: T0 + 11 * MIN, url: 'f/11' }], T0 + 11 * MIN + 5e3);
    expect(m.slots.find((sl) => sl.ts === T0 + 11 * MIN).frame.url).toBe('f/11');
    expect(m.slots[m.slots.length - 1].x0).toBe(T0 + 11 * MIN + 5e3);
    tiles(m, P);
  });
});

describe('a source with no promise (its cadence only inferred)', () => {
  const P = { from: T0, to: T0 + 120 * MIN };
  beforeEach(() => { now = T0 + DAY; });
  const kilauea = [-21, -1, 9, 29, 39, 59, 69, 89, 99, 119].map((m) => T0 + m * MIN);
  const frames = (ts: number[]) => ({ frames: () => Promise.resolve(ts.map((t) => ({ ts: t, url: `f/${t}` }))) });

  test('Kīlauea F1: gaps of 20 and 10 minutes are one continuous strip, never a gap', async () => {
    const m = await build(decl({ cadence: 10 * MIN, inferred: true }), P, frames(kilauea), BUDGET);
    expect(m.slots.every((sl) => sl.frame)).toBe(true);
  });

  test('a long silence runs out into neutral no data, never offline', async () => {
    const have = [...every(MIN, T0, T0 + 5 * MIN), ...every(MIN, T0 + 60 * MIN, T0 + 120 * MIN)];
    const m = await build(decl({ inferred: true }), P, frames(have), BUDGET);
    const cls = view(m.slots).map(([, c]) => c);
    expect(cls).not.toContain('gap');
    expect(cls).toContain('gap nodata');
  });

  test("hold 'none': the last frame until the next, however long", async () => {
    const m = await build(decl({ inferred: true }), P, frames([T0, T0 + 100 * MIN]), BUDGET, { hold: 'none' });
    expect(m.slots.every((sl) => sl.frame)).toBe(true);
  });

  test('a fixed hold limit', async () => {
    const m = await build(decl({ inferred: true }), P, frames([T0, T0 + 100 * MIN]), BUDGET, { hold: 10 * MIN });
    expect(m.slots.find((sl) => sl.ts === T0 + 9 * MIN).frame).not.toBeNull();
    expect(m.slots.find((sl) => sl.ts === T0 + 11 * MIN).nodata).toBe(true);
  });
});

describe("the panel's Expected cadence", () => {
  const P = { from: T0, to: T0 + 30 * MIN };
  beforeEach(() => { now = T0 + DAY; });
  const have = every(MIN, P.from, P.to, (ts) => ts > T0 + 10 * MIN && ts < T0 + 20 * MIN);

  test('a source that promises nothing is never red without it', async () => {
    const m = await build(decl({ inferred: true }), P, backendWith(have), BUDGET);
    expect(view(m.slots).map(([, c]) => c)).not.toContain('gap');
  });

  test('with it, every host promises it: a missing frame is offline', async () => {
    const m = await build(decl({ inferred: true }), P, backendWith(have), BUDGET, { expected: MIN });
    expect(view(m.slots).filter(([, c]) => c === 'gap').map(([t]) => t)).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19]);
  });

  test("it wins over the source's own pace", async () => {
    // the source says 10 minutes; the panel expects one a minute
    const m = await build(decl({ cadence: 10 * MIN }), P, backendWith(have), BUDGET, { expected: MIN });
    expect(view(m.slots).filter(([, c]) => c === 'gap')).not.toHaveLength(0);
  });
});
