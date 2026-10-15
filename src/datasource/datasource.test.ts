import type { DataSourceInstanceSettings } from '@grafana/data';

import { describeFailure, VisualTimelineDataSource } from './datasource';
import type { VisualTimelineOptions } from './types';

// keep Grafana's runtime out of the unit test: requests are injected
jest.mock('../shared/backendRequest', () => ({ backendRequest: jest.fn() }));

const settings = (apiUrl?: string, demo?: boolean) =>
  ({
    id: 1,
    uid: 'vt-ds',
    type: 'savvycocoa1919-visualtimeline-datasource',
    name: 'Visual Timeline API',
    access: 'proxy',
    readOnly: false,
    jsonData: { apiUrl, demo },
    meta: { id: 'savvycocoa1919-visualtimeline-datasource' },
  }) as unknown as DataSourceInstanceSettings<VisualTimelineOptions>;

const ok = (data: unknown) => jest.fn(async () => ({ status: 200, data }));
const fail = (status: number, data: unknown = {}) =>
  jest.fn(async () => {
    throw { status, data };
  });

describe('testDatasource', () => {
  test('success: /sources answers with a list through the proxy', async () => {
    const request = ok([{ id: 'a' }, { id: 'b' }]);
    const ds = new VisualTimelineDataSource(settings('https://frames.example.com/'), request);
    await expect(ds.testDatasource()).resolves.toEqual({
      status: 'success',
      message: 'Connected: the API lists 2 sources.',
    });
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ url: '/api/datasources/proxy/uid/vt-ds/api/sources', method: 'GET' })
    );
  });

  test('success with one source reads naturally', async () => {
    const ds = new VisualTimelineDataSource(settings('https://frames.example.com'), ok([{ id: 'a' }]));
    await expect(ds.testDatasource()).resolves.toMatchObject({ message: 'Connected: the API lists 1 source.' });
  });

  test('a token the API rejects is reported as such (Grafana turns the 401 into a 400)', async () => {
    const ds = new VisualTimelineDataSource(
      settings('https://frames.example.com'),
      fail(400, 'Authentication to data source failed')
    );
    const r = await ds.testDatasource();
    expect(r.status).toBe('error');
    expect(r.message).toMatch(/rejected the viewer token/);
  });

  test('any other 400 still points at the token', async () => {
    const ds = new VisualTimelineDataSource(settings('https://frames.example.com'), fail(400, { message: 'bad' }));
    const r = await ds.testDatasource();
    expect(r.message).toMatch(/\(400\).*viewer token/);
  });

  test('a 401 passed through as is is reported as a rejected token', async () => {
    const ds = new VisualTimelineDataSource(settings('https://frames.example.com'), fail(401));
    const r = await ds.testDatasource();
    expect(r.status).toBe('error');
    expect(r.message).toMatch(/rejected the viewer token \(401\)/);
  });

  test('an unreachable API is reported as such', async () => {
    const ds = new VisualTimelineDataSource(settings('https://frames.example.com'), fail(502));
    const r = await ds.testDatasource();
    expect(r.status).toBe('error');
    expect(r.message).toMatch(/could not reach https:\/\/frames\.example\.com \(502\)/);
  });

  test('a body that is not a list is not a frames API', async () => {
    const ds = new VisualTimelineDataSource(settings('https://frames.example.com'), ok({ status: 'ok' }));
    await expect(ds.testDatasource()).resolves.toMatchObject({ status: 'error' });
  });

  test('a missing API URL fails before any request', async () => {
    const request = ok([]);
    const ds = new VisualTimelineDataSource(settings(undefined), request);
    await expect(ds.testDatasource()).resolves.toMatchObject({
      status: 'error',
      message: expect.stringMatching(/API URL/),
    });
    expect(request).not.toHaveBeenCalled();
  });

  test('Demo data passes without an API URL and calls nothing', async () => {
    const request = ok([]);
    const ds = new VisualTimelineDataSource(settings(undefined, true), request);
    await expect(ds.testDatasource()).resolves.toMatchObject({
      status: 'success',
      message: expect.stringMatching(/Demo data/),
    });
    expect(request).not.toHaveBeenCalled();
  });

  test('a URL without a scheme fails before any request', async () => {
    const request = ok([]);
    const ds = new VisualTimelineDataSource(settings('frames.example.com'), request);
    await expect(ds.testDatasource()).resolves.toMatchObject({
      status: 'error',
      message: expect.stringMatching(/http/),
    });
    expect(request).not.toHaveBeenCalled();
  });
});

// what GET /sources answers in these tests
const SOURCES = [
  { id: 'cam-1', site: 'home', cadence: 60000, tags: { env: 'prod', room: 'lobby' }, history: [] },
  { id: 'cam-2', site: 'home', cadence: 60000, tags: { env: 'test' }, history: [] },
  { id: 'kiosk-a', site: 'office', cadence: 300000, tags: { env: 'prod' }, history: [] },
];
// ${site:csv} -> "home"; everything else unchanged
const interpolate = (v: string) => v.replace('${site:csv}', 'home');
const range = { from: { valueOf: () => 1_000 }, to: { valueOf: () => 3_601_000 } };
const hostsOf = (frame: any) => frame.fields.find((f: any) => f.name === 'host').values;

describe('query', () => {
  test('answers with the source list, one row per source, marked for the panel', async () => {
    const ds = new VisualTimelineDataSource(settings('https://frames.example.com'), ok(SOURCES), interpolate);
    const res = await ds.query({ targets: [{ refId: 'A' }], range, scopedVars: {} } as any);
    expect(res.data).toHaveLength(1);
    expect(hostsOf(res.data[0])).toEqual(['cam-1', 'cam-2', 'kiosk-a']);
    expect(res.data[0].meta.custom.visualTimeline).toEqual({ uid: 'vt-ds', demo: false });
  });

  test('applies the query fields, dashboard variables and ad hoc filters', async () => {
    const ds = new VisualTimelineDataSource(settings('https://frames.example.com'), ok(SOURCES), interpolate);
    const res = await ds.query({
      targets: [{ refId: 'A', sites: '${site:csv}', tags: 'env=prod' }],
      filters: [{ key: 'room', operator: '=', value: 'lobby' }],
      range,
      scopedVars: {},
    } as any);
    expect(hostsOf(res.data[0])).toEqual(['cam-1']);
  });

  test('a variable the dashboard does not define means all, not a site named "$site"', async () => {
    const ds = new VisualTimelineDataSource(settings('https://frames.example.com'), ok(SOURCES), (v) => v);
    const res = await ds.query({ targets: [{ refId: 'A', sites: '$site', tags: '$tags' }], range, scopedVars: {} } as any);
    expect(hostsOf(res.data[0])).toHaveLength(3);
  });

  test('Demo data answers with the demo sources and calls no API', async () => {
    const request = ok([]);
    const ds = new VisualTimelineDataSource(settings(undefined, true), request, interpolate);
    const res = await ds.query({ targets: [{ refId: 'A' }], range, scopedVars: {} } as any);
    expect(hostsOf(res.data[0]).length).toBeGreaterThan(0);
    expect(res.data[0].meta.custom.visualTimeline.demo).toBe(true);
    expect(request).not.toHaveBeenCalled();
  });

  test('an API failure is thrown, so Grafana shows it in the panel', async () => {
    const ds = new VisualTimelineDataSource(settings('https://frames.example.com'), fail(502), interpolate);
    await expect(ds.query({ targets: [{ refId: 'A' }], range, scopedVars: {} } as any)).rejects.toThrow();
  });
});

describe('the last frame in the range', () => {
  const NOW = Date.UTC(2026, 9, 1, 12);
  const win = { from: { valueOf: () => NOW - 3600e3 }, to: { valueOf: () => NOW } };
  // /sources answers the list; /frames answers one frame a minute up to now
  const api = jest.fn(async ({ url }: { url: string }) => {
    const u = new URL(url, 'https://grafana.example');
    if (u.pathname.endsWith('/sources')) {return { status: 200, data: SOURCES };}
    const from = Number(u.searchParams.get('from'));
    const to = Math.min(Number(u.searchParams.get('to')), NOW);
    const step = Number(u.searchParams.get('step'));
    const data = [];
    for (let ts = Math.ceil(from / step) * step; ts <= to; ts += step) {
      data.push({ ts, url: `https://img.example/${u.searchParams.get('source')}/${ts}.jpg?sig=x` });
    }
    return { status: 200, data };
  });
  let now: jest.SpyInstance;
  beforeEach(() => (now = jest.spyOn(Date, 'now').mockReturnValue(NOW)));
  afterEach(() => now.mockRestore());
  const field = (frame: any, name: string) => frame.fields.find((f: any) => f.name === name);

  test('off: no image columns and no /frames calls', async () => {
    api.mockClear();
    const ds = new VisualTimelineDataSource(settings('https://frames.example.com'), api, interpolate);
    const res = await ds.query({ targets: [{ refId: 'A' }], range: win, scopedVars: {} } as any);
    expect(field(res.data[0], 'image')).toBeUndefined();
    expect(api.mock.calls.every(([r]) => r.url.endsWith('/sources'))).toBe(true);
  });

  test('on: each host\'s last frame, shown as an image in a table, with its time and status', async () => {
    const ds = new VisualTimelineDataSource(settings('https://frames.example.com'), api, interpolate);
    const res = await ds.query({ targets: [{ refId: 'A', lastFrame: true }], range: win, scopedVars: {} } as any);
    const image = field(res.data[0], 'image');
    expect(image.config.custom.cellOptions).toEqual({ type: 'image' });
    expect(image.values[0]).toBe(`https://img.example/cam-1/${NOW}.jpg?sig=x`);
    expect(field(res.data[0], 'frameTime').values[0]).toBe(NOW);
    expect(field(res.data[0], 'status').values).toEqual(['live', 'live', 'live']);
    // the panel still reads its hosts from the same frame
    expect(hostsOf(res.data[0])).toEqual(['cam-1', 'cam-2', 'kiosk-a']);
  });

  test('per host: one row, fields named by host', async () => {
    const ds = new VisualTimelineDataSource(settings('https://frames.example.com'), api, interpolate);
    const res = await ds.query({
      targets: [{ refId: 'A', lastFrame: true, lastFrameFormat: 'host' }], range: win, scopedVars: {},
    } as any);
    expect(res.data[0].length).toBe(1);
    expect(field(res.data[0], 'kiosk-a').values).toEqual([`https://img.example/kiosk-a/${NOW}.jpg?sig=x`]);
    expect(field(res.data[0], 'kiosk-a status').values).toEqual(['live']);
  });

  test('Demo data: demo frames, drawn in the browser', async () => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    const toDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.getContext = (() => new Proxy({}, { get: () => () => ({ width: 10 }), set: () => true })) as never;
    HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,xyz';
    try {
      const ds = new VisualTimelineDataSource(settings(undefined, true), ok([]), interpolate);
      const res = await ds.query({ targets: [{ refId: 'A', lastFrame: true }], range: win, scopedVars: {} } as any);
      expect(field(res.data[0], 'image').values.filter(Boolean).length).toBeGreaterThan(0);
      expect(field(res.data[0], 'image').values.find(Boolean)).toMatch(/^data:image\//);
    } finally {
      HTMLCanvasElement.prototype.getContext = getContext;
      HTMLCanvasElement.prototype.toDataURL = toDataURL;
    }
  });
});

describe('variables and ad hoc filters', () => {
  const ds = () => new VisualTimelineDataSource(settings('https://frames.example.com'), ok(SOURCES), interpolate);

  test('a Sites variable lists every site', async () => {
    await expect(ds().metricFindQuery({ refId: 'A', type: 'sites' })).resolves.toEqual([
      { text: 'home', value: 'home' },
      { text: 'office', value: 'office' },
    ]);
  });

  test('a Hosts variable follows the Site variable', async () => {
    const values = await ds().metricFindQuery({ refId: 'A', type: 'hosts', sites: '${site:csv}' });
    expect(values.map((v) => v.text)).toEqual(['cam-1', 'cam-2']);
  });

  test('a plain-text "hosts" query works for hand-written dashboards', async () => {
    const values = await ds().metricFindQuery('hosts');
    expect(values.map((v) => v.text)).toEqual(['cam-1', 'cam-2', 'kiosk-a']);
  });

  test('ad hoc keys are site, host and the tag keys', async () => {
    const keys = await ds().getTagKeys({ filters: [] });
    expect(keys.map((k: any) => k.text)).toEqual(['site', 'host', 'env', 'room']);
  });

  test("ad hoc values honour the other filters, but not the key's own", async () => {
    const values = await ds().getTagValues({
      key: 'env',
      filters: [
        { key: 'site', operator: '=', value: 'home' },
        { key: 'env', operator: '=', value: 'prod' },
      ],
    });
    expect(values.map((v: any) => v.text)).toEqual(['prod', 'test']);
  });
});

describe('the source list is fetched once for a dashboard load', () => {
  test('queries, variables and the filter bar share one GET /sources', async () => {
    const request = ok(SOURCES);
    const ds = new VisualTimelineDataSource(settings('https://frames.example.com'), request, interpolate);
    await Promise.all([
      ds.query({ targets: [{ refId: 'A', sites: '${site:csv}' }, { refId: 'B' }], range, scopedVars: {} } as any),
      ds.metricFindQuery({ refId: 'A', type: 'sites' }),
      ds.metricFindQuery({ refId: 'A', type: 'hosts', sites: '${site:csv}' }),
      ds.getTagKeys({ filters: [] }),
    ]);
    expect(request).toHaveBeenCalledTimes(1);
  });

  test('a later refresh asks again, and a failure is not kept', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    try {
      const request = jest.fn().mockRejectedValueOnce({ status: 502, data: {} }).mockResolvedValue({ status: 200, data: SOURCES });
      const ds = new VisualTimelineDataSource(settings('https://frames.example.com'), request, interpolate);
      await expect(ds.sources()).rejects.toBeDefined();
      await expect(ds.sources()).resolves.toHaveLength(3);
      expect(request).toHaveBeenCalledTimes(2);
      now.mockReturnValue(1_000_000 + 6000);
      await ds.sources();
      expect(request).toHaveBeenCalledTimes(3);
    } finally {
      now.mockRestore();
    }
  });
});

describe('describeFailure', () => {
  test.each([403, 404, 0, 500])('%s has a message', (status) => {
    expect(describeFailure(status, 'https://x')).toMatch(/\S/);
  });
});
