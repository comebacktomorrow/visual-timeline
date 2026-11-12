import { createDataFrame, FieldType } from '@grafana/data';

import { framesPerStep, hostTableFromSeries, imageLocator, inferCadence, isVideoUrl, recordsBackend, recordsFromSeries, resolveClips, thinWithCounts } from './frameRecords';
import { recordsToFrame } from './sources';

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
    // sorted by site, then host, whatever order the frames came in
    expect(hosts.map((h) => [h.site, h.id])).toEqual([['', 'B'], ['hq', 'lobby']]);
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

describe('host metadata from any query (M4c)', () => {
  test('time zone, location and tags from fields on the frame rows; labels as tags', () => {
    const f = createDataFrame({
      fields: [
        { name: 'time', type: FieldType.time, values: [T0, T0 + MIN] },
        { name: 'image', type: FieldType.string, values: ['https://img/1.jpg', 'https://img/2.jpg'],
          labels: { host: 'lobby', site: 'hq', job: 'cams', __name__: 'x' } },
        { name: 'timezone', type: FieldType.string, values: ['', 'Australia/Sydney'] },
        { name: 'location', type: FieldType.string, values: ['level 2', 'level 2'] },
        { name: 'tags', type: FieldType.string, values: ['env=prod, room=lobby', '{"room":"foyer"}'] },
      ],
    });
    const [h] = recordsFromSeries([f])!;
    expect(h).toMatchObject({ id: 'lobby', site: 'hq', timezone: 'Australia/Sydney', location: 'level 2',
      tags: { job: 'cams', env: 'prod', room: 'foyer' } });
  });

  test('a host table names hosts and what is known about them, and its hosts are drawn without frames', async () => {
    const hostTable = createDataFrame({
      fields: [
        { name: 'id', type: FieldType.string, values: ['cam-1', 'cam-9'] },
        { name: 'site', type: FieldType.string, values: ['home', 'home'] },
        { name: 'timezone', type: FieldType.string, values: ['Asia/Tokyo', ''] },
        { name: 'cadence', type: FieldType.number, values: [300000, null] },
        { name: 'tags', type: FieldType.other, values: [{ env: 'prod' }, null] },
      ],
    });
    const known = hostTableFromSeries([hostTable]);
    expect(known).toEqual([
      { id: 'cam-1', site: 'home', cadence: 300000, timezone: 'Asia/Tokyo', tags: { env: 'prod' } },
      { id: 'cam-9', site: 'home' },
    ]);
    const rows = recordsFromSeries([table([[T0, 'cam-1', 'https://img/1.jpg', 'home']], { location: ['porch'] })])!;
    const b = recordsBackend(rows, known);
    const decls = await b.kiosks(null);
    // the table wins on what it says; the rows fill in the rest
    expect(decls[0]).toMatchObject({ id: 'cam-1', timezone: 'Asia/Tokyo', cadence: 300000, tags: { env: 'prod' } });
    // a host only the table knows of: drawn, at the default cadence
    expect(decls[1]).toMatchObject({ id: 'cam-9', site: 'home', cadence: 60_000 });
  });

  test('frames of images and state queries are not host tables', () => {
    const images = table([[T0, 'cam', 'https://img/1.jpg']], { timezone: ['UTC'] });
    const state = createDataFrame({ fields: [
      { name: 'host', type: FieldType.string, values: ['cam'] },
      { name: 'state', type: FieldType.string, values: ['down'] },
      { name: 'location', type: FieldType.string, values: ['x'] },
    ] });
    expect(hostTableFromSeries([images, state])).toEqual([]);
  });

  test('a host two lists name is drawn once, the first list winning', async () => {
    const b = recordsBackend([], [{ id: 'a', site: 's', cadence: MIN, timezone: 'UTC' }, { id: 'a', site: 's', cadence: 2 * MIN }]);
    expect(await b.kiosks(null)).toEqual([{ id: 'a', site: 's', cadence: MIN, timezone: 'UTC' }]);
  });
});

describe('wide tables (#126)', () => {
  test('one time field and an image column per host: each column is a host', () => {
    const wide = createDataFrame({ fields: [
      { name: 'time', type: FieldType.time, values: [T0, T0 + MIN] },
      { name: 'lobby', type: FieldType.string, values: ['https://img/l1.jpg', 'https://img/l2.jpg'] },
      { name: 'v', type: FieldType.string, values: ['https://img/d1.jpg', null], labels: { host: 'dock', site: 'hq' } },
      { name: 'note', type: FieldType.string, values: ['fine', 'fine'] },   // not images: not a host
    ] });
    const hosts = recordsFromSeries([wide])!;
    expect(hosts.map((h) => [h.site, h.id, h.frames.map((f) => f.url)])).toEqual([
      ['', 'lobby', ['https://img/l1.jpg', 'https://img/l2.jpg']],
      ['hq', 'dock', ['https://img/d1.jpg']],
    ]);
  });

  test('not a wide table: our per-host last frame table (a time field per host), or one with a host field (rows)', () => {
    const perHost = createDataFrame({ fields: [
      { name: 'cam-1', type: FieldType.string, values: ['https://img/1.jpg'] },
      { name: 'cam-1 time', type: FieldType.time, values: [T0] },
      { name: 'cam-2', type: FieldType.string, values: ['https://img/2.jpg'] },
      { name: 'cam-2 time', type: FieldType.time, values: [T0] },
    ] });
    expect(recordsFromSeries([perHost])).toBeNull();
    const withHost = createDataFrame({ fields: [
      { name: 'time', type: FieldType.time, values: [T0] },
      { name: 'host', type: FieldType.string, values: ['a'] },
      { name: 'pic', type: FieldType.string, values: ['https://img/1.jpg'] },
    ] });
    // a host field makes it rows, its one image column found by content: host "a", not a host "pic"
    expect(recordsFromSeries([withHost])!.map((h) => h.id)).toEqual(['a']);
  });
});

describe('cadence that changes over time (eras from any query)', () => {
  test('a cadence field whose value changes gives cadence events at each change', async () => {
    const rows = [0, 2, 4, 8, 12].map((m) => T0 + m * MIN);
    const f = table(rows.map((t) => [t, 'cam', 'https://img/' + t + '.jpg'] as [number, string, string]),
      { cadence: [120000, 120000, 120000, 240000, 240000] });
    const [h] = recordsFromSeries([f])!;
    expect(h.cadence).toBe(240000);
    expect(h.history).toEqual([{ since: T0, cadence: 120000 }, { since: T0 + 8 * MIN, cadence: 240000 }]);
    const [decl] = await recordsBackend([h]).kiosks(null);
    expect(decl.history).toEqual(h.history);
  });

  test('one pace throughout: no history', () => {
    const [h] = recordsFromSeries([table([[T0, 'cam', 'https://img/1.jpg'], [T0 + MIN, 'cam', 'https://img/2.jpg']], { cadence: [60000, 60000] })])!;
    expect(h.history).toBeUndefined();
  });
});

describe('an image field found by its content', () => {
  test('a log line that is an image URL, with a host field (Loki, labels extracted)', () => {
    const logs = createDataFrame({ fields: [
      { name: 'Time', type: FieldType.time, values: [T0, T0 + MIN] },
      { name: 'Line', type: FieldType.string, values: ['https://img/1.jpg', 'https://img/2.jpg'] },
      { name: 'host', type: FieldType.string, values: ['cam', 'cam'] },
      { name: 'job', type: FieldType.string, values: ['cameras', 'cameras'] },
    ] });
    expect(recordsFromSeries([logs])!.map((h) => [h.id, h.frames.length])).toEqual([['cam', 2]]);
  });
  test('not when two fields could be the image, or without a host', () => {
    const two = createDataFrame({ fields: [
      { name: 'Time', type: FieldType.time, values: [T0] },
      { name: 'a', type: FieldType.string, values: ['https://img/1.jpg'] },
      { name: 'b', type: FieldType.string, values: ['https://img/2.jpg'] },
      { name: 'host', type: FieldType.string, values: ['cam'] },
    ] });
    expect(recordsFromSeries([two])).toBeNull();
  });
});

describe('thinning that keeps counts (M10)', () => {
  test('one frame per step, the one nearest its tick, saying how many its bucket held', () => {
    const MIN = 60e3;
    // buckets of 4 minutes around ticks 0, 4 and 8: {0, 1}, {2, 3, 4, 5}, {6, 7}
    const frames = [0, 1, 2, 3, 4, 5, 6, 7].map((m) => ({ ts: m * MIN, url: `f${m}` }));
    expect(thinWithCounts(frames, 0, 7 * MIN, 4 * MIN).map((f) => [f.ts / MIN, f.count])).toEqual([[0, 2], [4, 4], [7, 2]]);
  });
  test('a row that stands for one frame says nothing', () => {
    expect(thinWithCounts([{ ts: 0, url: 'a' }], 0, 60e3, 60e3)[0].count).toBeUndefined();
  });
  test('a frame_count field is how many frames a row stands for', () => {
    const recs = recordsFromSeries([createDataFrame({ fields: [
      { name: 'time', type: FieldType.time, values: [1, 2] },
      { name: 'host', type: FieldType.string, values: ['a', 'a'] },
      { name: 'image', type: FieldType.string, values: ['http://x/1', 'http://x/2'] },
      { name: 'frame_count', type: FieldType.number, values: [4, 1] },
    ] })]);
    expect(recs![0].frames.map((f) => f.count)).toEqual([4, undefined]);
  });
});

describe('video clips (M10c)', () => {
  const H = 3600e3;
  test('a video field on frame rows: clips beside the frames, ends from video_end', () => {
    const t = createDataFrame({ fields: [
      { name: 'time', type: FieldType.time, values: [T0, T0 + MIN, T0 + 2 * MIN] },
      { name: 'host', type: FieldType.string, values: ['cam', 'cam', 'cam'] },
      { name: 'image', type: FieldType.string, values: ['https://img/1.jpg', 'https://img/2.jpg', 'https://img/3.jpg'] },
      { name: 'video', type: FieldType.string, values: ['https://vid/a.mp4', '', ''] },
      { name: 'video_hi', type: FieldType.string, values: ['https://vid/a-hi.mp4', '', ''] },
      { name: 'video_end', type: FieldType.time, values: [T0 + H, null, null] },
    ] });
    const [h] = recordsFromSeries([t])!;
    expect(h.frames).toHaveLength(3);
    expect(h.clips).toEqual([{ from: T0, to: T0 + H, url: 'https://vid/a.mp4', hi: 'https://vid/a-hi.mp4' }]);
  });

  test('rows with only a video: a host of clips, its cadence their typical gap', () => {
    const t = createDataFrame({ fields: [
      { name: 'time', type: FieldType.time, values: [T0, T0 + H, T0 + 2 * H] },
      { name: 'camera', type: FieldType.string, values: ['sun', 'sun', 'sun'] },
      { name: 'video', type: FieldType.string, values: ['https://vid/0.mp4', 'https://vid/1.mp4', 'https://vid/2.mp4'] },
    ] });
    const [h] = recordsFromSeries([t])!;
    expect(h.frames).toEqual([]);
    expect(h.cadence).toBe(H);
    expect(h.inferred).toBe(true);
    // no end stated: each lasts the typical gap, never past the next
    expect(h.clips!.map((c) => [c.from - T0, c.to - T0])).toEqual([[0, H], [H, 2 * H], [2 * H, 3 * H]]);
  });

  test('a video_duration in ms; a clip with no end lasts as long as the ones that say', () => {
    expect(resolveClips([
      { from: 0, to: 10, url: 'a' }, { from: 100, url: 'b' }, { from: 105, url: 'c' },
    ], 60).map((c) => [c.from, c.to])).toEqual([[0, 10], [100, 105], [105, 115]]);
    const t = createDataFrame({ fields: [
      { name: 'time', type: FieldType.time, values: [T0] },
      { name: 'host', type: FieldType.string, values: ['cam'] },
      { name: 'video', type: FieldType.string, values: ['https://vid/a.webm'] },
      { name: 'video_duration', type: FieldType.number, values: [90_000] },
    ] });
    expect(recordsFromSeries([t])![0].clips![0].to - T0).toBe(90_000);
  });

  test('a video URL is never taken for the image', () => {
    expect(isVideoUrl('https://x/a.mp4?sig=1')).toBe(true);
    expect(isVideoUrl('https://x/a.jpg')).toBe(false);
    const logs = createDataFrame({ fields: [
      { name: 'Time', type: FieldType.time, values: [T0] },
      { name: 'Line', type: FieldType.string, values: ['https://vid/1.mp4'] },
      { name: 'host', type: FieldType.string, values: ['cam'] },
    ] });
    expect(recordsFromSeries([logs])).toBeNull();
    // a wide table's column of videos is not a host of images
    const wide = createDataFrame({ fields: [
      { name: 'time', type: FieldType.time, values: [T0] },
      { name: 'cam', type: FieldType.string, values: ['https://vid/1.mp4'] },
    ] });
    expect(recordsFromSeries([wide])).toBeNull();
  });

  test('the backend answers a span\'s clips, those that overlap it', async () => {
    const hosts = recordsFromSeries([createDataFrame({ fields: [
      { name: 'time', type: FieldType.time, values: [T0, T0 + H] },
      { name: 'host', type: FieldType.string, values: ['cam', 'cam'] },
      { name: 'video', type: FieldType.string, values: ['https://vid/0.mp4', 'https://vid/1.mp4'] },
    ] })])!;
    const b = recordsBackend(hosts);
    expect((await b.clips!('', 'cam', T0 + H - MIN, T0 + H + MIN)).map((c) => c.url)).toEqual(['https://vid/0.mp4', 'https://vid/1.mp4']);
    expect((await b.clips!('', 'cam', T0 + 2 * H, T0 + 3 * H)).map((c) => c.url)).toEqual([]);
    expect(recordsBackend(recordsFromSeries([table([[T0, 'cam', 'https://img/1.jpg']])])!).clips).toBeUndefined();
  });

  test('a host table never takes rows with a video', () => {
    const t = createDataFrame({ fields: [
      { name: 'host', type: FieldType.string, values: ['cam'] },
      { name: 'video', type: FieldType.string, values: ['https://vid/1.mp4'] },
      { name: 'timezone', type: FieldType.string, values: ['UTC'] },
    ] });
    expect(hostTableFromSeries([t])).toEqual([]);
  });
});

describe('a clip with no end, on a host with frames (M10c)', () => {
  test('lasts a frame\'s time: a frame a minute, a minute of video each (an assumption)', () => {
    const rows = Array.from({ length: 20 }, (_, i) => T0 + i * MIN);
    const t = createDataFrame({ fields: [
      { name: 'time', type: FieldType.time, values: rows },
      { name: 'host', type: FieldType.string, values: rows.map(() => 'cam') },
      { name: 'image', type: FieldType.string, values: rows.map((_, i) => `https://img/${i}.jpg`) },
      // a clip on every tenth frame only
      { name: 'video', type: FieldType.string, values: rows.map((_, i) => (i % 10 ? '' : `https://vid/${i}.mp4`)) },
    ] });
    expect(recordsFromSeries([t])![0].clips!.map((c) => [(c.from - T0) / MIN, (c.to - T0) / MIN])).toEqual([[0, 1], [10, 11]]);
    // lengths the rows state still win
    expect(resolveClips([{ from: 0, to: 5, url: 'a' }, { from: 100, url: 'b' }], 60, 30).map((c) => c.to)).toEqual([5, 105]);
  });
});

describe('clip rows our data source writes (M11)', () => {
  test('read back as the host\'s clips, beside its frames', () => {
    const frame = recordsToFrame([
      { ts: T0, host: 'sun', site: '', url: 'https://img/1.jpg' },
      { ts: T0 - 3600e3, host: 'sun', site: '', url: null, video: 'https://vid/day.mp4', videoHi: 'https://vid/day-hi.mp4', videoEnd: T0 + 864e5 },
    ], 'A');
    const [h] = recordsFromSeries([frame])!;
    expect(h.frames.map((f) => f.url)).toEqual(['https://img/1.jpg']);
    expect(h.clips).toEqual([{ from: T0 - 3600e3, to: T0 + 864e5, url: 'https://vid/day.mp4', hi: 'https://vid/day-hi.mp4' }]);
  });
});
