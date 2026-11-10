import type { DataSourceInstanceSettings } from '@grafana/data';

import { VisualTimelineDataSource } from './datasource';
import type { VisualTimelineOptions } from './types';
import type { SourceDecl } from '../vt/types';

const settings = (demo?: boolean) =>
  ({
    id: 1,
    uid: 'vt-ds',
    type: 'savvycocoa1919-visualtimeline-datasource',
    name: 'Visual Timeline',
    access: 'proxy',
    readOnly: false,
    jsonData: { demo },
    meta: { id: 'savvycocoa1919-visualtimeline-datasource' },
  }) as unknown as DataSourceInstanceSettings<VisualTimelineOptions>;

describe('testDatasource', () => {
  test('Demo data passes', async () => {
    await expect(new VisualTimelineDataSource(settings(true)).testDatasource()).resolves.toMatchObject({
      status: 'success',
      message: expect.stringContaining('Demo data is on'),
    });
  });

  test('without a connection there is nothing to read, and it says how panels read frames', async () => {
    const r = await new VisualTimelineDataSource(settings(false)).testDatasource();
    expect(r.status).toBe('error');
    expect(r.message).toMatch(/Choose a connection/);
    expect(r.message).toMatch(/time, image and host/);
  });
});

// a source list for the query and variable tests: where it comes from (demo
// data now, folder listings later) doesn't change how it is filtered
const SOURCES: SourceDecl[] = [
  { id: 'cam-1', site: 'home', cadence: 60000, tags: { env: 'prod', room: 'lobby' }, history: [] },
  { id: 'cam-2', site: 'home', cadence: 60000, tags: { env: 'test' }, history: [] },
  { id: 'kiosk-a', site: 'office', cadence: 300000, tags: { env: 'prod' }, history: [] },
];
function withSources(list = SOURCES) {
  const ds = new VisualTimelineDataSource(settings(false), interpolate);
  jest.spyOn(ds, 'sources').mockImplementation(async (sites) => (sites ? list.filter((s) => sites.includes(s.site)) : list));
  return ds;
}

// ${site:csv} -> "home"; everything else unchanged
const interpolate = (v: string) => v.replace('${site:csv}', 'home');
const range = { from: { valueOf: () => 1_000 }, to: { valueOf: () => 3_601_000 } };
const hostsOf = (frame: any) => frame.fields.find((f: any) => f.name === 'host').values;

describe('query', () => {
  test('answers with the source list, one row per source', async () => {
    const res = await withSources().query({ targets: [{ refId: 'A' }], range, scopedVars: {} } as any);
    expect(res.data).toHaveLength(1);
    expect(hostsOf(res.data[0])).toEqual(['cam-1', 'cam-2', 'kiosk-a']);
  });

  test('applies the query fields, dashboard variables and ad hoc filters', async () => {
    const res = await withSources().query({
      targets: [{ refId: 'A', sites: '${site:csv}', tags: 'env=prod' }],
      filters: [{ key: 'room', operator: '=', value: 'lobby' }],
      range,
      scopedVars: {},
    } as any);
    expect(hostsOf(res.data[0])).toEqual(['cam-1']);
  });

  test('a variable the dashboard does not define means all, not a site named "$site"', async () => {
    const ds = new VisualTimelineDataSource(settings(false), (v) => v);
    jest.spyOn(ds, 'sources').mockResolvedValue(SOURCES);
    const res = await ds.query({ targets: [{ refId: 'A', sites: '$site', tags: '$tags' }], range, scopedVars: {} } as any);
    expect(hostsOf(res.data[0])).toHaveLength(3);
  });

  test('Demo data answers with the demo sources', async () => {
    const ds = new VisualTimelineDataSource(settings(true), interpolate);
    const res = await ds.query({ targets: [{ refId: 'A' }], range, scopedVars: {} } as any);
    expect(hostsOf(res.data[0]).length).toBeGreaterThan(0);
  });

  test('without Demo data: no sources and no rows', async () => {
    const ds = new VisualTimelineDataSource(settings(false), interpolate);
    const res = await ds.query({ targets: [{ refId: 'A' }], range, scopedVars: {} } as any);
    expect(res.data).toHaveLength(1);
    expect(res.data[0].length).toBe(0);
  });

  test('Demo data also answers with its frames as rows, at each source\'s finest cadence', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(3_601_000);
    try {
      const ds = new VisualTimelineDataSource(settings(true), interpolate);
      const res = await ds.query({ targets: [{ refId: 'A' }], range, scopedVars: {}, maxDataPoints: 1000 } as any);
      // the source list, the frames as rows, and the pauses as state rows
      expect(res.data).toHaveLength(3);
      const states = res.data[2];
      const sf = (n: string) => states.fields.find((f: any) => f.name === n);
      expect(sf('host').values).toEqual(['source-4']);
      expect(sf('state').values).toEqual(['screen-sleep:unexpected']);
      expect(sf('state').config.custom).toEqual({ pausesFrames: true });
      const rows = res.data[1];
      const col = (n: string) => rows.fields.find((f: any) => f.name === n).values;
      expect(rows.fields.map((f: any) => f.name)).toEqual(['time', 'host', 'site', 'image', 'cadence']);
      // the pace in force at each frame: source-3 slows from 120 s to 240 s halfway
      const s3c = col('cadence').filter((_: number, i: number) => col('host')[i] === 'source-3');
      expect([s3c[0], s3c[s3c.length - 1]]).toEqual([120000, 240000]);
      expect(col('image').every((u: string) => u.startsWith('data:image/svg+xml,'))).toBe(true);
      // source-3 runs at 120 s for the first half of the window, then 240 s: rows come every 120 s
      const s3 = col('time').filter((_: number, i: number) => col('host')[i] === 'source-3');
      expect(s3[1] - s3[0]).toBe(120_000);
      // source-2's outage leaves out its rows from 35% to 55% of the hour
      const s2 = col('time').filter((_: number, i: number) => col('host')[i] === 'source-2');
      expect(s2.some((t: number) => t > 1_000 + 0.36 * 3_600_000 && t < 1_000 + 0.54 * 3_600_000)).toBe(false);
    } finally {
      now.mockRestore();
    }
  });

  test('demo frames draw their clock in the dashboard\'s time zone', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(3_601_000);
    try {
      const ds = new VisualTimelineDataSource(settings(true), interpolate);
      const res = await ds.query({ targets: [{ refId: 'A' }], range, scopedVars: {}, timezone: 'Asia/Tokyo', maxDataPoints: 1000 } as any);
      const rows = res.data[1];
      const i = rows.fields.find((f: any) => f.name === 'host').values.indexOf('source-1');
      const ts = rows.fields.find((f: any) => f.name === 'time').values[i];
      const svg = decodeURIComponent(rows.fields.find((f: any) => f.name === 'image').values[i]);
      const hh = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', hour: '2-digit', hourCycle: 'h23' }).format(ts);
      expect(svg).toContain(`>${hh}:`);
    } finally {
      now.mockRestore();
    }
  });

  test('an annotation query answers with Demo data\'s events, and with none otherwise', async () => {
    const demo = new VisualTimelineDataSource(settings(true), interpolate);
    const res = await demo.query({ targets: [{ refId: 'Anno', kind: 'annotations' }], range, scopedVars: {} } as any);
    const f = res.data[0];
    expect(f.fields.map((x: any) => x.name)).toEqual(['time', 'timeEnd', 'title', 'text', 'tags', 'color']);
    expect(f.length).toBeGreaterThan(0);
    expect(f.fields.find((x: any) => x.name === 'tags').values).toContainEqual(['source:source-1']);
    const off = new VisualTimelineDataSource(settings(false), interpolate);
    expect((await off.query({ targets: [{ refId: 'Anno', kind: 'annotations' }], range, scopedVars: {} } as any)).data[0].length).toBe(0);
    expect(demo.annotations?.getDefaultQuery?.()).toEqual({ kind: 'annotations' });
  });
});

describe('the last frame in the range', () => {
  const NOW = Date.UTC(2026, 9, 1, 12);
  const win = { from: { valueOf: () => NOW - 3600e3 }, to: { valueOf: () => NOW } };
  let now: jest.SpyInstance;
  beforeEach(() => (now = jest.spyOn(Date, 'now').mockReturnValue(NOW)));
  afterEach(() => now.mockRestore());
  const field = (frame: any, name: string) => frame.fields.find((f: any) => f.name === name);
  const demo = () => new VisualTimelineDataSource(settings(true), interpolate);

  test('off: the source list has no image columns', async () => {
    const res = await demo().query({ targets: [{ refId: 'A' }], range: win, scopedVars: {} } as any);
    expect(field(res.data[0], 'image')).toBeUndefined();
  });

  test('on: each host\'s last frame, shown as an image in a table, with its time and status', async () => {
    const res = await demo().query({ targets: [{ refId: 'A', lastFrame: true }], range: win, scopedVars: {} } as any);
    const image = field(res.data[0], 'image');
    expect(image.config.custom.cellOptions).toEqual({ type: 'image' });
    expect(image.values[0]).toMatch(/^data:image\/svg\+xml,/);
    expect(field(res.data[0], 'frameTime').values[0]).toBeLessThanOrEqual(NOW);
    expect(field(res.data[0], 'frameTime').values[0]).toBeGreaterThan(NOW - 120e3);
    expect(field(res.data[0], 'status').values[0]).toBe('live');
    // the panel still reads its hosts from the same frame
    expect(hostsOf(res.data[0])).toContain('source-1');
  });

  test('per host: one row, fields named by host', async () => {
    const res = await demo().query({
      targets: [{ refId: 'A', lastFrame: true, lastFrameFormat: 'host' }], range: win, scopedVars: {},
    } as any);
    expect(res.data[0].length).toBe(1);
    expect(field(res.data[0], 'source-1').values[0]).toMatch(/^data:image\/svg\+xml,/);
    expect(field(res.data[0], 'source-1 status').values).toEqual(['live']);
  });
});

describe('variables and ad hoc filters', () => {
  const ds = () => withSources();

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

/* ---------------- the HTTP folder connection (#125) ---------------- */

describe('HTTP folder', () => {
  const MIN = 60_000;
  const T0 = Date.UTC(2026, 0, 1, 10);
  const name = (ts: number, v: string) => new Date(ts).toISOString().replace(/[-:]/g, '').slice(9, 15) + '_' + v + '.svg';
  // two hosts, a frame a minute for 10 minutes in lo and hi; cam-b misses 10:04
  const files = (host: string) => Array.from({ length: 10 }, (_, k) => T0 + k * MIN)
    .filter((ts) => !(host === 'cam-b' && ts === T0 + 4 * MIN))
    .flatMap((ts) => [name(ts, 'lo'), name(ts, 'hi')]);
  const tree: Record<string, string[]> = {
    '/': ['cam-a/', 'cam-b/'],
    '/cam-a/2026-01-01/': files('cam-a'),
    '/cam-b/2026-01-01/': files('cam-b'),
  };
  const html = (names: string[]) => names.map((n) => `<a href="${n}">${n}</a>`).join('\n');
  const fetchText = jest.fn(async (path: string) => (tree[path] ? { status: 200, text: html(tree[path]) } : { status: 404, text: '' }));
  const folderSettings = (extra: Record<string, unknown> = {}) => ({
    ...settings(false),
    jsonData: { connection: 'folder', folderUrl: 'http://folder.internal/frames/', imageUrl: 'https://img.example/frames', listing: 'html',
      template: '{host}/{YYYY}-{MM}-{DD}/{HH}{mm}{ss}_{variant}.svg', smallVariant: 'lo', largeVariant: 'hi', ...extra },
  }) as any;
  const win = { from: { valueOf: () => T0 }, to: { valueOf: () => T0 + 9 * MIN } };

  test('answers with its hosts and their frames as rows, small images with the large as preview', async () => {
    const ds = new VisualTimelineDataSource(folderSettings(), (v) => v, fetchText);
    const res = await ds.query({ targets: [{ refId: 'A' }], range: win, scopedVars: {}, maxDataPoints: 1000 } as any);
    expect(res.data).toHaveLength(2);
    expect(hostsOf(res.data[0])).toEqual(['cam-a', 'cam-b']);
    const rows = res.data[1];
    const col = (n: string) => rows.fields.find((f: any) => f.name === n).values;
    expect(col('host').filter((h: string) => h === 'cam-b')).toHaveLength(9);
    expect(col('image')[0]).toBe('https://img.example/frames/cam-a/2026-01-01/100000_lo.svg');
    expect(col('image_hi')[0]).toBe('https://img.example/frames/cam-a/2026-01-01/100000_hi.svg');
    // only the day folders the range touches were listed, through the proxy route's paths
    expect([...new Set(fetchText.mock.calls.map((c) => c[0]))].sort()).toEqual(['/', '/cam-a/2026-01-01/', '/cam-b/2026-01-01/']);
  });

  test('variables and the host filter use the hosts it finds', async () => {
    const ds = new VisualTimelineDataSource(folderSettings(), (v) => v, fetchText);
    // a variable lists the hosts with frames in the dashboard's range
    expect((await ds.metricFindQuery('hosts', { range: win as any })).map((v) => v.text)).toEqual(['cam-a', 'cam-b']);
    const res = await ds.query({ targets: [{ refId: 'A', hosts: 'cam-b' }], range: win, scopedVars: {} } as any);
    expect(hostsOf(res.data[0])).toEqual(['cam-b']);
  });

  test('Save & test reads the last day and says what it found, or why not', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(T0 + 9 * MIN);
    try {
      const ok = await new VisualTimelineDataSource(folderSettings(), (v) => v, fetchText).testDatasource();
      expect(ok).toEqual({ status: 'success', message: 'Found 19 frames from 2 hosts in the last 24 hours.' });
      const none = await new VisualTimelineDataSource(folderSettings({ template: '{host}/{epoch}.jpg' }), (v) => v, fetchText).testDatasource();
      expect(none.status).toBe('error');
      expect(none.message).toMatch(/no file in the last 24 hours matched/);
      const bad = await new VisualTimelineDataSource(folderSettings({ template: '{YYYY}.jpg' }), (v) => v, fetchText).testDatasource();
      expect(bad).toEqual({ status: 'error', message: 'The path template needs {host}' });
      const down = await new VisualTimelineDataSource(folderSettings(), (v) => v, async () => ({ status: 502, text: '' })).testDatasource();
      expect(down.message).toMatch(/HTTP 502 through Grafana's proxy/);
      const unset = await new VisualTimelineDataSource(folderSettings({ folderUrl: '' }), (v) => v, fetchText).testDatasource();
      expect(unset.message).toBe('Set the folder URL');
    } finally {
      jest.restoreAllMocks();
    }
  });
});
