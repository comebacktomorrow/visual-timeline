import { createDataFrame, FieldType } from '@grafana/data';

import { framesPerStep, imageLocator, inferCadence, recordsBackend, recordsFromSeries } from './frameRecords';

const MIN = 60_000;
const T0 = Date.UTC(2026, 10, 10, 10);

/* rows of time / host / image, as any table-shaped source would return them */
function table(rows: Array<[number, string, string, string?]>, extra: Record<string, unknown[]> = {}, refId = 'A') {
  return createDataFrame({
    refId,
    fields: [
      { name: 'time', type: FieldType.time, values: rows.map((r) => r[0]) },
      { name: 'host', type: FieldType.string, values: rows.map((r) => r[1]) },
      { name: 'image', type: FieldType.string, values: rows.map((r) => r[2]) },
      ...(rows.some((r) => r[3]) ? [{ name: 'site', type: FieldType.string, values: rows.map((r) => r[3] ?? '') }] : []),
      ...Object.entries(extra).map(([name, values]) => ({ name, type: FieldType.string, values })),
    ],
  });
}

describe('recordsFromSeries', () => {
  test('rows become one host each, sorted by time, with the usual field names', () => {
    const hosts = recordsFromSeries([
      table([
        [T0 + 2 * MIN, 'cam-1', 'https://img/1c.jpg', 'home'],
        [T0, 'cam-1', 'https://img/1a.jpg', 'home'],
        [T0 + MIN, 'cam-2', 'https://img/2b.jpg', 'office'],
        [T0 + MIN, 'cam-1', 'https://img/1b.jpg', 'home'],
      ]),
    ])!;
    expect(hosts.map((h) => [h.site, h.id, h.frames.map((f) => f.url)])).toEqual([
      ['home', 'cam-1', ['https://img/1a.jpg', 'https://img/1b.jpg', 'https://img/1c.jpg']],
      ['office', 'cam-2', ['https://img/2b.jpg']],
    ]);
    expect(hosts[0].cadence).toBe(MIN);
  });

  test('null when no frame in the result has an image field', () => {
    const metrics = createDataFrame({
      fields: [
        { name: 'time', type: FieldType.time, values: [T0] },
        { name: 'value', type: FieldType.number, values: [1] },
      ],
    });
    expect(recordsFromSeries([metrics])).toBeNull();
    expect(recordsFromSeries(undefined)).toBeNull();
  });

  test('field roles name the fields when they differ from the usual names', () => {
    const f = createDataFrame({
      fields: [
        { name: 'captured', type: FieldType.number, values: [T0] },
        { name: 'camera_name', type: FieldType.string, values: ['dock'] },
        { name: 'jpeg', type: FieldType.string, values: ['https://img/x.jpg'] },
        { name: 'big', type: FieldType.string, values: ['https://img/x-large.jpg'] },
      ],
    });
    const hosts = recordsFromSeries([f], { time: 'captured', host: 'camera_name', image: 'jpeg', preview: 'big' })!;
    expect(hosts[0]).toMatchObject({ id: 'dock', site: '' });
    expect(hosts[0].frames[0]).toMatchObject({ ts: T0, url: 'https://img/x.jpg', hi: 'https://img/x-large.jpg' });
  });

  test('without a host field: the image field\'s host label, else the query', () => {
    const labelled = createDataFrame({
      refId: 'A',
      fields: [
        { name: 'time', type: FieldType.time, values: [T0] },
        { name: 'url', type: FieldType.string, values: ['https://img/a.jpg'], labels: { host: 'lobby', site: 'hq' } },
      ],
    });
    const bare = createDataFrame({
      refId: 'B',
      fields: [
        { name: 'time', type: FieldType.time, values: [T0] },
        { name: 'url', type: FieldType.string, values: ['https://img/b.jpg'] },
      ],
    });
    const hosts = recordsFromSeries([labelled, bare])!;
    expect(hosts.map((h) => [h.site, h.id])).toEqual([['hq', 'lobby'], ['', 'B']]);
  });

  test('times as epoch numbers or date strings, rows without a time or image skipped', () => {
    const f = createDataFrame({
      fields: [
        { name: 'ts', type: FieldType.string, values: ['2026-11-10T10:00:00Z', String(T0 + MIN), '', 'nope'] },
        { name: 'host', type: FieldType.string, values: ['a', 'a', 'a', 'a'] },
        { name: 'image', type: FieldType.string, values: ['https://img/1.jpg', 'https://img/2.jpg', 'https://img/3.jpg', ''] },
      ],
    });
    expect(recordsFromSeries([f])![0].frames.map((x) => x.ts)).toEqual([T0, T0 + MIN]);
  });

  test('a cadence field wins over inference', () => {
    const hosts = recordsFromSeries([table([[T0, 'a', 'https://img/1.jpg'], [T0 + MIN, 'a', 'https://img/2.jpg']], { cadence: [300000, 300000] })])!;
    expect(hosts[0].cadence).toBe(300000);
  });
});

describe('imageLocator', () => {
  test('URLs and data: URLs pass through untouched, signed links included', () => {
    const signed = 'https://w.example/frame/lo/a/b/1.jpg?e=1&sig=abc';
    expect(imageLocator(signed)).toBe(signed);
    expect(imageLocator('data:image/svg+xml,<svg/>')).toBe('data:image/svg+xml,<svg/>');
    expect(imageLocator('/public/img/x.png')).toBe('/public/img/x.png');
  });
  test('bare Base64 image data becomes a data: URL of the right type', () => {
    expect(imageLocator('/9j/4AAQSkZJRgABAQ==')).toBe('data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==');
    expect(imageLocator('iVBORw0KGgoAAAANSUhEUgAAAAE=')).toBe('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAE=');
  });
  test('empty or non-string values are no image', () => {
    expect(imageLocator('')).toBeNull();
    expect(imageLocator(42)).toBeNull();
    expect(imageLocator(null)).toBeNull();
  });
});

describe('inferCadence', () => {
  test('the median gap in whole seconds, robust to an outage', () => {
    const ts = [0, 60, 120, 180, 900, 960, 1020].map((s) => T0 + s * 1000);
    expect(inferCadence(ts)).toBe(MIN);
    // jittered gaps of 61.4, 58.8 and 59.7 s
    expect(inferCadence([T0, T0 + 61_400, T0 + 120_200, T0 + 179_900])).toBe(MIN);
  });
  test('the default with fewer than two frames', () => {
    expect(inferCadence([T0])).toBe(60_000);
  });
});

describe('framesPerStep', () => {
  const frames = [0, 50, 70, 130, 175, 250].map((s) => ({ ts: T0 + s * 1000, url: `u${s}` }));
  test('one frame per step, the one nearest each tick, as the worker picks', () => {
    // ticks every 60 s; 50 s and 70 s tie for the 60 s tick, and the first wins (as in the worker)
    // and nothing past the window's snapped end (250 s > 240 s), as the worker lists no further
    expect(framesPerStep(frames, T0, T0 + 240_000, MIN).map((f) => f.url)).toEqual(['u0', 'u50', 'u130', 'u175']);
  });
  test('the window is snapped out to whole steps, like the API\'s', () => {
    expect(framesPerStep(frames, T0 + 100_000, T0 + 140_000, MIN).map((f) => f.url)).toEqual(['u70', 'u130', 'u175']);
  });
  test('a bad step returns nothing', () => {
    expect(framesPerStep(frames, T0, T0 + MIN, 0)).toEqual([]);
  });
});

describe('recordsBackend', () => {
  const hosts = recordsFromSeries([
    table([
      [T0, 'cam-1', 'https://img/1.jpg', 'home'],
      [T0 + MIN, 'cam-1', 'https://img/2.jpg', 'home'],
      [T0, 'kiosk', 'https://img/k.jpg', 'office'],
    ]),
  ])!;

  test('kiosks are the hosts, optionally limited to some sites', async () => {
    const b = recordsBackend(hosts);
    expect((await b.kiosks(null)).map((d) => d.id)).toEqual(['cam-1', 'kiosk']);
    expect((await b.kiosks(['office'])).map((d) => d.id)).toEqual(['kiosk']);
  });

  test('frames for a host come from its records, one per step', async () => {
    const b = recordsBackend(hosts);
    expect((await b.frames('home', 'cam-1', T0, T0 + MIN, MIN)).map((f) => f.url)).toEqual(['https://img/1.jpg', 'https://img/2.jpg']);
    expect(await b.frames('home', 'nobody', T0, T0 + MIN, MIN)).toEqual([]);
  });

  test('a known host with no records in the window is still drawn', async () => {
    const known = [{ id: 'paused-all-day', site: 'home', cadence: MIN, history: [{ since: T0 - MIN, paused: true }] }];
    const b = recordsBackend(hosts, known);
    expect((await b.kiosks(null)).map((d) => d.id)).toEqual(['cam-1', 'kiosk', 'paused-all-day']);
    expect(await b.frames('home', 'paused-all-day', T0, T0 + MIN, MIN)).toEqual([]);
  });

  test('a known source list adds history, time zone and tags, and fills a missing site', async () => {
    const siteless = recordsFromSeries([table([[T0, 'cam-1', 'https://img/1.jpg']])])!;
    const known = [{ id: 'cam-1', site: 'home', cadence: MIN, timezone: 'Australia/Brisbane', tags: { env: 'prod' }, history: [{ since: T0 - MIN, paused: true }] }];
    const b = recordsBackend(siteless, known);
    const [decl] = await b.kiosks(null);
    expect(decl).toMatchObject({ id: 'cam-1', site: 'home', timezone: 'Australia/Brisbane', tags: { env: 'prod' } });
    expect(decl.history).toHaveLength(1);
    expect((await b.frames('home', 'cam-1', T0, T0, MIN)).map((f) => f.url)).toEqual(['https://img/1.jpg']);
  });
});
