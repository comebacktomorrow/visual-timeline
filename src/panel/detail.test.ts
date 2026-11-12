import { FieldType, toDataFrame } from '@grafana/data';
import { of } from 'rxjs';

import { makeDetail } from './detail';

/* the panel's queries, run again for one span against each one's own data
 * source, as Grafana's data source service hands them out */
const calls: Array<{ uid: string; from: number; to: number; targets: string[]; vars: unknown }> = [];
const parents: unknown[] = [];
const limits: unknown[] = [];
const T0 = Date.UTC(2026, 0, 1, 10);
const MIN = 60e3;
jest.mock('@grafana/runtime', () => ({
  getDataSourceSrv: () => ({
    get: async (ref: { uid: string } | undefined) => ({
      query: (req: any) => {
        parents.push([req.scopedVars.__vt_window_from?.value, req.scopedVars.__vt_window_to?.value]);
        limits.push([req.maxDataPoints, req.intervalMs, req.scopedVars.__interval_ms?.value]);
        calls.push({ uid: ref?.uid ?? '', from: req.range.from.valueOf(), to: req.range.to.valueOf(), targets: req.targets.map((t: any) => t.refId), vars: req.scopedVars.__from });
        // every host's rows for the span, as a SQL query or our folder answers
        const ts = [0, 1, 2, 3, 4].map((m) => T0 + m * MIN).filter((t) => t >= req.range.from.valueOf() && t <= req.range.to.valueOf());
        const rows = ts.flatMap((t) => [{ t, host: 'cam-a' }, { t, host: 'cam-b' }]);
        const frame = toDataFrame({ refId: req.targets[0].refId, fields: [
          { name: 'time', type: FieldType.time, values: rows.map((x) => x.t) },
          { name: 'host', type: FieldType.string, values: rows.map((x) => x.host) },
          { name: 'image', type: FieldType.string, values: rows.map((x) => `http://x/${x.host}/${x.t}.jpg`) },
        ] });
        // one answers as an Observable, the other as a Promise
        return ref?.uid === 'a' ? of({ data: [frame] }) : Promise.resolve({ data: [frame] });
      },
    }),
  }),
}));

describe('a slot\'s frames, by running the panel\'s queries again', () => {
  beforeEach(() => { calls.length = 0; });
  const request = {
    requestId: 'Q1', scopedVars: {}, range: { from: { valueOf: () => T0 }, to: { valueOf: () => T0 + 60 * MIN } }, targets: [
      { refId: 'A', datasource: { uid: 'a', type: 'x' } },
      { refId: 'B', datasource: { uid: 'b', type: 'y' } },
      { refId: 'C', datasource: { uid: 'a', type: 'x' }, hide: true },
    ],
  } as any;

  test('each data source is asked for just the span, with ${__from} naming it', async () => {
    const detail = makeDetail(() => request, () => ({}));
    const frames = await detail('', 'cam-a', T0 + MIN, T0 + 3 * MIN);
    expect(frames.map((f) => (f.ts - T0) / MIN)).toEqual([1, 2, 3]);
    expect(calls.map((c) => c.vars)).toEqual([{ text: String(T0 + MIN), value: T0 + MIN }, { text: String(T0 + MIN), value: T0 + MIN }]);
    expect(calls).toEqual([
      { uid: 'a', from: T0 + MIN, to: T0 + 3 * MIN, targets: ['A'], vars: { text: String(T0 + MIN), value: T0 + MIN } },
      { uid: 'b', from: T0 + MIN, to: T0 + 3 * MIN, targets: ['B'], vars: { text: String(T0 + MIN), value: T0 + MIN } },
    ]);
  });

  test('the dashboard\'s range rides along, for a source whose answer depends on it (our demo)', async () => {
    parents.length = 0;
    await makeDetail(() => request, () => ({}))('', 'cam-a', T0 + 5 * MIN, T0 + 6 * MIN);
    expect(parents).toEqual([[T0, T0 + 60 * MIN], [T0, T0 + 60 * MIN]]);
  });

  test('a limit asks for that many points, as Grafana would ask a panel that wide', async () => {
    limits.length = 0;
    await makeDetail(() => request, () => ({}))('', 'cam-a', T0, T0 + 10 * MIN, 20);
    // 10 minutes in 20 points: 30 s apart, as max data points and $__interval_ms
    expect(limits).toEqual([[20, 30e3, 30e3], [20, 30e3, 30e3]]);
  });

  test('a span asked twice is asked once', async () => {
    const detail = makeDetail(() => request, () => ({}));
    await detail('', 'cam-a', T0, T0 + MIN);
    await detail('', 'cam-a', T0, T0 + MIN);
    expect(calls).toHaveLength(2);
  });

  test('another host\'s strip at the same span reuses the answer, and picks its own host out of it (M4)', async () => {
    const detail = makeDetail(() => request, () => ({}));
    const a = await detail('', 'cam-a', T0 + MIN, T0 + 2 * MIN);
    const b = await detail('', 'cam-b', T0 + MIN, T0 + 2 * MIN);
    expect(calls).toHaveLength(2);   // one per data source, once
    expect(a.map((f) => f.url)).toEqual([`http://x/cam-a/${T0 + MIN}.jpg`, `http://x/cam-a/${T0 + 2 * MIN}.jpg`]);
    expect(b.map((f) => f.url)).toEqual([`http://x/cam-b/${T0 + MIN}.jpg`, `http://x/cam-b/${T0 + 2 * MIN}.jpg`]);
    // asked at once, before the answer: still once
    calls.length = 0;
    const both = await Promise.all([detail('', 'cam-a', T0, T0 + 4 * MIN), detail('', 'cam-b', T0, T0 + 4 * MIN)]);
    expect(calls).toHaveLength(2);
    expect(both.map((f) => f.length)).toEqual([5, 5]);
    // another span, another limit or a new request asks again
    calls.length = 0;
    await detail('', 'cam-b', T0, T0 + 4 * MIN, 100);
    await makeDetail(() => ({ ...request, requestId: 'Q2' }), () => ({}))('', 'cam-b', T0, T0 + 4 * MIN);
    expect(calls).toHaveLength(4);
  });

  test('a host the answer lacks: nothing, without asking again', async () => {
    const detail = makeDetail(() => request, () => ({}));
    expect(await detail('', 'cam-z', T0, T0 + MIN)).toEqual([]);
    expect(await detail('', 'cam-a', T0, T0 + MIN)).toHaveLength(2);
    expect(calls).toHaveLength(2);
  });

  test('no request yet: nothing', async () => {
    expect(await makeDetail(() => undefined, () => ({}))('', 'cam-a', T0, T0 + MIN)).toEqual([]);
  });
});
