import { buildSourceModel, ghostFor, missedHeartbeat, slotClass } from './core';

/* How a source's window becomes slots, and how each slot is classified:
 * frame, offline ("gap"), pending ("future"), declared pause, or the
 * beyond-now spacer. Pins CURRENT behaviour (safety net for #64). */

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

/* core.ts is untyped (@ts-nocheck); read its model loosely */
type Model = { eras: any[]; slots: any[]; slotAt: (t: number) => any; lastActive: any };
const build = (d: object, P: { from: number; to: number }, backend: object, budget: number): Promise<Model> =>
  buildSourceModel(d, P, backend, budget);

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
    [{ ts: 0, span: 1, frame: null, future: true }, ' future'],
    [{ ts: 0, span: 1, frame: { ts: 0, url: 'u' }, future: true }, ''],
    [{ ts: 0, span: 1, beyond: true }, ' beyond'],
    [{ ts: 0, span: 1, paused: true }, ' paused'],
    [{ ts: 0, span: 1, paused: true, reason: 'screen-sleep', intended: false }, ' paused r-screen-sleep unintended'],
  ])('%p → %p', (sl, cls) => {
    expect(slotClass(sl)).toBe(cls);
  });
});

describe('missedHeartbeat (live poll: pending → offline)', () => {
  const sl = { ts: T0, span: MIN, step: MIN, cadence: MIN, frame: null, future: true };
  test('stays pending up to and including one full step past its tick', () => {
    expect(missedHeartbeat(sl, T0)).toBe(false);
    expect(missedHeartbeat(sl, T0 + MIN - 1)).toBe(false);
    expect(missedHeartbeat(sl, T0 + MIN)).toBe(false);
  });
  test('turns offline once more than a full step has passed', () => {
    expect(missedHeartbeat(sl, T0 + MIN + 1)).toBe(true);
  });
  test('a slot with a frame, or one that is not pending, never misses', () => {
    expect(missedHeartbeat({ ...sl, frame: { ts: T0, url: 'u' } }, T0 + DAY)).toBeFalsy();
    expect(missedHeartbeat({ ...sl, future: false }, T0 + DAY)).toBeFalsy();
  });
});

describe('ghostFor (the pending slot’s "last known" frame)', () => {
  const f = (ts: number) => ({ ts, url: `frame/${ts}` });
  const s = (ts: number, extra: Record<string, unknown>): any => ({ ts, span: MIN, step: MIN, ...extra });

  test('carries the nearest earlier frame across other pending slots', () => {
    const slots = [
      s(0, { frame: f(0) }),
      s(1, { frame: f(1) }),
      s(2, { future: true, frame: null }),
      s(3, { future: true, frame: null }),
    ];
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

  test('a slot not in the list has no ghost', () => {
    const slots = [s(0, { frame: f(0) })];
    expect(ghostFor(slots, s(1, { future: true, frame: null }))).toBeNull();
  });
});

describe('buildSourceModel', () => {
  test('a closed window with every frame present: one slot per cadence tick, both ends inclusive', async () => {
    now = T0 + DAY;
    const P = { from: T0, to: T0 + 10 * MIN };
    const backend = backendWith(every(MIN, T0, T0 + 10 * MIN));
    const m = await build(decl(), P, backend, BUDGET);
    expect(backend.calls).toEqual([{ from: P.from, to: P.to, step: MIN }]);
    expect(m.slots).toHaveLength(11);
    expect(m.slots.every((sl: any) => sl.frame && !sl.future && sl.span === MIN && sl.step === MIN)).toBe(true);
    expect(m.lastActive).toBe(m.slots[10]);
    // no beyond-now spacer for a window that ended in the past
    expect(m.slots.some((sl: any) => sl.beyond)).toBe(false);
  });

  test('the step downsamples to the pixel budget in whole cadences (min 4 slots per era)', async () => {
    now = T0 + DAY;
    const P = { from: T0, to: T0 + 60 * MIN };
    const steps: number[] = [];
    for (const budget of [1000, 20, 7, 1]) {
      const backend = backendWith([]);
      const m = await build(decl(), P, backend, budget);
      steps.push(backend.calls[0].step);
      expect(m.slots[0].cadence).toBe(MIN);
    }
    // 60 raw slots: share 1000 → 1/1; 20 → 1/3; 7 → 1/9; 1 → clamped to 4 → 1/15
    expect(steps).toEqual([MIN, 3 * MIN, 9 * MIN, 15 * MIN]);
  });

  test('a cadence change mid-window: each era on its own grid, sparse frames in the slow era are not gaps', async () => {
    now = T0 + DAY;
    const P = { from: T0, to: T0 + 60 * MIN };
    const d = decl({
      cadence: 240e3,
      history: [
        { since: T0 - DAY, variant: 'lo', cadence: 120e3 },
        { since: T0 + 30 * MIN, variant: 'lo', cadence: 240e3 },
      ],
    });
    // frames at 120 s, then 240 s (uploads snap to epoch multiples of the
    // cadence, so the first slow frame is 32m); the 44m frame is missing
    const have = [
      ...every(2 * MIN, T0, T0 + 30 * MIN),
      ...every(4 * MIN, T0 + 32 * MIN, T0 + 60 * MIN, (ts) => ts === T0 + 44 * MIN),
    ];
    const backend = backendWith(have);
    const m = await build(d, P, backend, BUDGET);

    expect(backend.calls).toEqual([
      { from: T0, to: T0 + 30 * MIN, step: 120e3 },
      { from: T0 + 30 * MIN, to: P.to, step: 240e3 },
    ]);
    const slow = m.slots.filter((sl: any) => sl.step === 240e3);
    const fast = m.slots.filter((sl: any) => sl.step === 120e3);
    expect(fast.map((sl: any) => (sl.ts - T0) / MIN)).toEqual([
      0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30,
    ]);
    // the slow grid is epoch-aligned, not era-aligned: it starts at 32m
    expect(slow.map((sl: any) => (sl.ts - T0) / MIN)).toEqual([32, 36, 40, 44, 48, 52, 56, 60]);
    expect(slow.every((sl: any) => sl.cadence === 240e3 && sl.span === 240e3)).toBe(true);
    // the only offline slot is the one missing 240 s frame
    expect(view(m.slots).filter(([, c]) => c === 'gap')).toEqual([[44, 'gap']]);
    expect(m.lastActive.step).toBe(240e3);
  });

  test('era boundary on both grids: the boundary tick is a slot in BOTH eras', async () => {
    // NOTE: current behaviour; looks wrong because an era is [from, to) but
    // pushActive includes the tick AT era.to, so a boundary tick that lies on
    // both eras' grids (here 32m) is drawn twice — once at each era's step —
    // with the same frame, and the strip's total slot span exceeds the window.
    now = T0 + DAY;
    const P = { from: T0, to: T0 + 60 * MIN };
    const d = decl({
      history: [
        { since: T0 - DAY, cadence: 120e3 },
        { since: T0 + 32 * MIN, cadence: 240e3 },
      ],
    });
    const m = await build(d, P, backendWith(every(2 * MIN, T0, T0 + 60 * MIN)), BUDGET);
    const atBoundary = m.slots.filter((sl: any) => sl.ts === T0 + 32 * MIN);
    expect(atBoundary.map((sl: any) => sl.step)).toEqual([120e3, 240e3]);
    expect(atBoundary.every((sl: any) => sl.frame && sl.frame.ts === T0 + 32 * MIN)).toBe(true);
  });

  test('an active era shorter than a step with no tick inside still gets one slot, past its end', async () => {
    // NOTE: current behaviour; looks wrong because pushActive clamps the slot
    // count to at least 1 even when the era has no grid tick, so the slot's
    // tick (11m) lies after the era (10m10s–10m50s), inside the next pause.
    now = T0 + DAY;
    const P = { from: T0, to: T0 + 60 * MIN };
    const d = decl({
      history: [
        { since: T0 - DAY, paused: true },
        { since: T0 + 10 * MIN + 10e3 },
        { since: T0 + 10 * MIN + 50e3, paused: true },
      ],
    });
    const m = await build(d, P, backendWith([]), BUDGET);
    expect(m.slots.map((sl: any) => [(sl.ts - T0) / 1e3, slotClass(sl).trim()])).toEqual([
      [0, 'paused'],
      [660, 'gap'],
      [650, 'paused'],
    ]);
  });

  test('a declared (bounded) pause next to an unexpected gap: neutral band vs offline slots', async () => {
    now = T0 + DAY;
    const P = { from: T0, to: T0 + 60 * MIN };
    const d = decl({
      history: [
        { since: T0 - DAY, variant: 'lo', cadence: 60e3 },
        { since: T0 + 30 * MIN, variant: 'lo', paused: true, reason: 'quiet' },
        { since: T0 + 45 * MIN, variant: 'lo', cadence: 60e3 },
      ],
    });
    // the source went silent UNEXPECTEDLY at 20m, then declared quiet hours
    // 30m–45m, then resumed; frames 0–19m and 45–60m
    const have = [...every(MIN, T0, T0 + 19 * MIN), ...every(MIN, T0 + 45 * MIN, T0 + 60 * MIN)];
    const backend = backendWith(have);
    const m = await build(d, P, backend, BUDGET);

    // a bounded pause is taken from the registry: no probe request for it
    expect(backend.calls).toEqual([
      { from: T0, to: T0 + 30 * MIN, step: MIN },
      { from: T0 + 45 * MIN, to: P.to, step: MIN },
    ]);
    const v = view(m.slots);
    expect(v.slice(0, 20).every(([, c]) => c === '')).toBe(true);
    // 20m–29m: unexpected silence → offline. The tick AT the pause start (30m)
    // belongs to the active era (see the era-boundary NOTE above), so it is a
    // gap slot too, right before the band.
    expect(v.slice(20, 31)).toEqual([20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30].map((t) => [t, 'gap']));
    // the declared pause: ONE band slot spanning the whole bounded era
    expect(v[31]).toEqual([30, 'paused r-quiet']);
    expect(m.slots[31]).toMatchObject({ ts: T0 + 30 * MIN, span: 15 * MIN, paused: true, reason: 'quiet' });
    expect(v.slice(32).every(([, c]) => c === '')).toBe(true);
    expect(v.slice(32)[0]).toEqual([45, '']);
    expect(m.slots).toHaveLength(32 + 16);
  });

  test('a tail pause with no frames since: band to the window end, no active slots after it', async () => {
    now = T0 + DAY;
    const P = { from: T0, to: T0 + 60 * MIN };
    const d = decl({
      history: [
        { since: T0 - DAY, cadence: 60e3 },
        { since: T0 + 30 * MIN, paused: true, reason: 'screen-sleep', intended: false },
      ],
    });
    const m = await build(d, P, backendWith(every(MIN, T0, T0 + 30 * MIN)), BUDGET);
    const last = m.slots[m.slots.length - 1];
    expect(last).toMatchObject({
      ts: T0 + 30 * MIN,
      span: 30 * MIN,
      paused: true,
      reason: 'screen-sleep',
      intended: false,
    });
    expect(slotClass(last)).toBe(' paused r-screen-sleep unintended');
    expect(m.lastActive.ts).toBe(T0 + 30 * MIN);
  });

  test('a tail pause infers resume from frames, ignoring a goodbye straggler in its first cadence', async () => {
    now = T0 + DAY;
    const P = { from: T0, to: T0 + 60 * MIN };
    const d = decl({
      history: [
        { since: T0 - DAY, cadence: 60e3 },
        { since: T0 + 30 * MIN, paused: true },
      ],
    });
    // frames to 30m (the straggler snapped onto the pause start), then from 40m
    const have = [...every(MIN, T0, T0 + 30 * MIN), ...every(MIN, T0 + 40 * MIN, T0 + 60 * MIN)];
    const backend = backendWith(have);
    const m = await build(d, P, backend, BUDGET);
    // the probe at the era's own cadence
    expect(backend.calls[1]).toEqual({ from: T0 + 30 * MIN, to: P.to, step: MIN });
    const band = m.slots.find((sl: any) => sl.paused);
    expect(band).toMatchObject({ ts: T0 + 30 * MIN, span: 10 * MIN });
    const after = m.slots.slice(m.slots.indexOf(band) + 1);
    expect(after[0].ts).toBe(T0 + 40 * MIN);
    expect(after.every((sl: any) => sl.frame && !sl.paused)).toBe(true);
  });

  describe('the live right edge', () => {
    const P = { from: T0, to: T0 + 70 * MIN }; // window extends 10 minutes past now

    test('the tick that just passed is pending (one-step grace) and carries the last frame as its ghost', async () => {
      now = T0 + 60 * MIN + 20e3;
      // frames through 59m; the 60m frame is still in flight
      const m = await build(decl(), P, backendWith(every(MIN, T0, T0 + 59 * MIN)), BUDGET);
      const v = view(m.slots);
      expect(v.slice(-3)).toEqual([
        [59, ''],
        [60, 'future'],
        [60.5, 'beyond'],
      ]);
      const pending = m.slots[m.slots.length - 2];
      expect(ghostFor(m.slots, pending)).toBe(m.slots[m.slots.length - 3].frame);
      // the beyond spacer starts at the pending tick's half-step and runs to the window end
      expect(m.slots[m.slots.length - 1]).toMatchObject({ ts: T0 + 60.5 * MIN, span: 9.5 * MIN, beyond: true });
      // the live poll keeps it pending for a full step past its tick, then it is offline
      expect(missedHeartbeat(pending, T0 + 61 * MIN)).toBe(false);
      expect(missedHeartbeat(pending, T0 + 61 * MIN + 1)).toBe(true);
      expect(m.lastActive).toBe(pending);
    });

    test('no slot is drawn past now', async () => {
      now = T0 + 60 * MIN + 20e3;
      const m = await build(decl(), P, backendWith([]), BUDGET);
      const active = m.slots.filter((sl: any) => !sl.beyond);
      expect(Math.max(...active.map((sl: any) => sl.ts))).toBe(T0 + 60 * MIN);
    });

    test('a tick more than a step old with no frame is already offline at build', async () => {
      now = T0 + 60 * MIN + 20e3;
      const m = await build(decl(), P, backendWith(every(MIN, T0, T0 + 57 * MIN)), BUDGET);
      expect(view(m.slots).slice(-5)).toEqual([
        [57, ''],
        [58, 'gap'],
        [59, 'gap'],
        [60, 'future'],
        [60.5, 'beyond'],
      ]);
      // after a gap there is nothing honest to carry
      expect(ghostFor(m.slots, m.slots[m.slots.length - 2])).toBeNull();
    });

    test('grace boundary at build: a tick exactly one step old is offline', async () => {
      // NOTE: current behaviour; build marks pending while ts + step > now,
      // but the live poll (missedHeartbeat) keeps it pending while
      // ts + step >= now — the two disagree for exactly that millisecond.
      now = T0 + 61 * MIN;
      const m = await build(decl(), P, backendWith(every(MIN, T0, T0 + 59 * MIN)), BUDGET);
      const sixty = m.slots.find((sl: any) => sl.ts === T0 + 60 * MIN);
      expect(slotClass(sixty)).toBe(' gap');
      expect(missedHeartbeat({ ...sixty, future: true }, now)).toBe(false);
    });

    test('a scheduled future cadence change does not spray pending slots past now', async () => {
      now = T0 + 60 * MIN + 20e3;
      const d = decl({
        history: [
          { since: T0 - DAY, cadence: 60e3 },
          { since: T0 + 65 * MIN, cadence: 30e3 },
        ],
      });
      const m = await build(d, P, backendWith(every(MIN, T0, T0 + 60 * MIN)), BUDGET);
      expect(m.slots.filter((sl: any) => !sl.beyond && sl.ts > now)).toEqual([]);
      expect(m.slots.some((sl: any) => sl.cadence === 30e3)).toBe(false);
      // the 60m tick is inside its grace step: flagged pending, but its frame is
      // already here, so it renders as a frame
      expect(slotClass(m.slots[m.slots.length - 2])).toBe('');
      expect(m.slots[m.slots.length - 2]).toMatchObject({ ts: T0 + 60 * MIN, future: true });
      expect(m.slots[m.slots.length - 1]).toMatchObject({ beyond: true, ts: T0 + 60.5 * MIN, span: 9.5 * MIN });
    });

    test('a tail pause band stops at now; the spacer covers the rest', async () => {
      now = T0 + 60 * MIN + 20e3;
      const d = decl({
        history: [
          { since: T0 - DAY, cadence: 60e3 },
          { since: T0 + 50 * MIN, paused: true, reason: 'quiet' },
        ],
      });
      const m = await build(d, P, backendWith(every(MIN, T0, T0 + 50 * MIN)), BUDGET);
      const [band, spacer] = m.slots.slice(-2);
      expect(band).toMatchObject({ paused: true, ts: T0 + 50 * MIN, span: 10 * MIN + 20e3 });
      expect(spacer).toMatchObject({ beyond: true, ts: now, span: P.to - now });
    });
  });

  test('slotAt: ticks are centred, bands and spacer are [ts, ts + span)', async () => {
    now = T0 + 60 * MIN + 20e3;
    const P = { from: T0, to: T0 + 70 * MIN };
    const d = decl({
      history: [{ since: T0 - DAY, cadence: 60e3 }, { since: T0 + 30 * MIN, paused: true }, { since: T0 + 40 * MIN }],
    });
    const m = await build(d, P, backendWith(every(MIN, T0, T0 + 59 * MIN)), BUDGET);
    expect(m.slotAt(T0 + 10 * MIN + 29e3).ts).toBe(T0 + 10 * MIN);
    expect(m.slotAt(T0 + 10 * MIN + 30e3).ts).toBe(T0 + 11 * MIN);
    // before the window: the first slot
    expect(m.slotAt(T0 - DAY)).toBe(m.slots[0]);
    // inside the pause: the band (the 30m tick of the active era wins its own first half-step)
    expect(m.slotAt(T0 + 30 * MIN + 10e3).paused).toBeUndefined();
    expect(m.slotAt(T0 + 30 * MIN + 30e3).paused).toBe(true);
    expect(m.slotAt(T0 + 39 * MIN).paused).toBe(true);
    // the spacer's leading half-step resolves to the pending slot, past it the spacer
    expect(m.slotAt(T0 + 60.5 * MIN + 10e3).ts).toBe(T0 + 60 * MIN);
    expect(m.slotAt(T0 + 65 * MIN).beyond).toBe(true);
    // past the window: the last slot
    expect(m.slotAt(T0 + DAY)).toBe(m.slots[m.slots.length - 1]);
  });
});
