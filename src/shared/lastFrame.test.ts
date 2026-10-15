import type { Frame, SourceDecl } from '../vt/types';
import { lastFrameIn } from './lastFrame';

const MIN = 60e3;
const DAY = 864e5;
const T0 = Date.UTC(2026, 9, 1);

/* A frames API that answers as the reference worker does: the window snapped
 * out to whole steps, at most 800 buckets, and in each bucket the frame
 * nearest its tick. Records every call. */
function fakeApi(stamps: number[]) {
  const calls: Array<{ from: number; to: number; step: number }> = [];
  return {
    calls,
    async frames(_site: string, _id: string, from: number, to: number, step: number): Promise<Frame[]> {
      calls.push({ from, to, step });
      from = Math.floor(from / step) * step;
      to = Math.ceil(to / step) * step;
      if ((to - from) / step > 800) {throw new Error('too many buckets');}
      const start = Math.ceil(from / step) * step;
      const best = new Map<number, number>();
      for (const ts of stamps) {
        if (ts < from || ts > to) {continue;}
        const idx = Math.round((ts - start) / step);
        const prev = best.get(idx);
        if (prev == null || Math.abs(ts - (start + idx * step)) < Math.abs(prev - (start + idx * step))) {best.set(idx, ts);}
      }
      return [...best.values()].sort((a, b) => a - b).map((ts) => ({ ts, url: `frame/${ts}` }));
    },
  };
}

const decl = (history: SourceDecl['history'] = []): SourceDecl =>
  ({ id: 'cam-1', site: 'home', cadence: MIN, history }) as SourceDecl;
const every = (from: number, to: number, step = MIN) => {
  const out = [];
  for (let t = from; t <= to; t += step) {out.push(t);}
  return out;
};

describe('lastFrameIn', () => {
  test('a live host: its newest frame, in one call', async () => {
    const api = fakeApi(every(T0, T0 + DAY));
    const r = await lastFrameIn(decl(), T0, T0 + DAY - 20e3, api);
    expect(r).toEqual({ frame: { ts: T0 + DAY - MIN, url: `frame/${T0 + DAY - MIN}` }, status: 'live' });
    expect(api.calls).toHaveLength(1);
  });

  test('a past range: the frame at its end, never one after it', async () => {
    const api = fakeApi(every(T0, T0 + DAY));
    const end = T0 + 6 * 3600e3 + 30e3; // mid-tick: the API's snapped window holds the next frame too
    const r = await lastFrameIn(decl(), T0, end, api);
    expect(r.frame!.ts).toBe(T0 + 6 * 3600e3);
    expect(r.status).toBe('live');
  });

  test('a host that went silent: its exact last frame, found coarsely then exactly, and offline', async () => {
    // a week at one minute, silent for the last two days; the last frame sits off a coarse tick
    const lastTs = T0 + 5 * DAY - 7 * MIN;
    const api = fakeApi(every(T0, lastTs));
    const r = await lastFrameIn(decl(), T0, T0 + 7 * DAY, api);
    expect(r.frame!.ts).toBe(lastTs);
    expect(r.status).toBe('offline');
    expect(api.calls.every((c) => (c.to - c.from) / c.step <= 800)).toBe(true);
  });

  test('a declared pause: paused, with its reason, showing the frame before it', async () => {
    const pausedAt = T0 + 10 * 3600e3;
    const api = fakeApi(every(T0, pausedAt));
    const r = await lastFrameIn(decl([{ since: pausedAt, paused: true, reason: 'screen-sleep' }]), T0, T0 + DAY, api);
    expect(r).toMatchObject({ status: 'paused', reason: 'screen-sleep' });
    expect(r.frame!.ts).toBe(pausedAt);
  });

  test('a goodbye frame taken as the host pauses does not end the pause', async () => {
    const pausedAt = T0 + 10 * 3600e3 + 20e3;
    const api = fakeApi([...every(T0, T0 + 10 * 3600e3), pausedAt + 40e3]);
    const r = await lastFrameIn(decl([{ since: pausedAt, paused: true, reason: 'screen-sleep' }]), T0, T0 + DAY, api);
    expect(r.status).toBe('paused');
    expect(r.frame!.ts).toBe(pausedAt + 40e3);
  });

  test('a frame after a pause ends it', async () => {
    const pausedAt = T0 + 10 * 3600e3;
    const api = fakeApi([...every(T0, pausedAt), ...every(T0 + 20 * 3600e3, T0 + DAY)]);
    const r = await lastFrameIn(decl([{ since: pausedAt, paused: true, reason: 'quiet' }]), T0, T0 + DAY, api);
    expect(r.status).toBe('live');
    expect(r.reason).toBeUndefined();
  });

  test('no frame in the range: no frame, offline', async () => {
    const api = fakeApi(every(T0 - DAY, T0 - MIN));
    await expect(lastFrameIn(decl(), T0, T0 + DAY, api)).resolves.toEqual({ frame: null, status: 'offline' });
  });
});
