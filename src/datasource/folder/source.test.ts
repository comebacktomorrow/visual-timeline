import { FolderSource } from './source';
import type { VisualTimelineOptions } from '../types';

/* FolderSource over a fake HTML listing: what it says about each host's
 * cadence (docs/TIMELINE-MODEL.md). */
const T0 = Date.UTC(2026, 0, 1, 10, 0, 0);
const MIN = 60e3;
const name = (ts: number) => new Date(ts).toISOString().slice(11, 19).replace(/:/g, '') + '.jpg';
const frames = [0, 3, 6, 9].map((m) => T0 + m * MIN);
const listing = '<html><body>' + frames.map((ts) => `<a href="${name(ts)}">${name(ts)}</a>`).join('') + '</body></html>';
const fetchText = async (path: string) => (path.startsWith('/cam-a/2026-01-01') ? { status: 200, text: listing } : { status: 404, text: '' });
const opts = (extra: Partial<VisualTimelineOptions> = {}) =>
  ({ connection: 'folder', folderUrl: 'http://frames.local', listing: 'html', template: '{host}/{YYYY}-{MM}-{DD}/{HH}{mm}{ss}.jpg', ...extra }) as VisualTimelineOptions;

describe('FolderSource cadence', () => {
  test('a folder promises nothing: its cadence is only the typical gap', async () => {
    const { records } = await new FolderSource(opts(), fetchText).hosts(T0, T0 + 10 * MIN, { hosts: ['cam-a'] });
    expect(records.map((r) => [r.id, r.cadence, r.inferred])).toEqual([['cam-a', 3 * MIN, true]]);
  });

  test('Expected every is a promise', async () => {
    const { records } = await new FolderSource(opts({ expectedEvery: '1m' }), fetchText).hosts(T0, T0 + 10 * MIN, { hosts: ['cam-a'] });
    expect(records.map((r) => [r.id, r.cadence, r.inferred])).toEqual([['cam-a', MIN, undefined]]);
  });

  test('an Expected every that does not parse is no promise', () => {
    expect(new FolderSource(opts({ expectedEvery: 'soon' }), fetchText).expected).toBe(0);
  });
});

/* NASA SDO's layout (M11): stills under browse/, a movie a day under
 * dailymov/, one data source a level up with both templates. */
describe('FolderSource video clips (M11)', () => {
  const D0 = Date.UTC(2026, 0, 1);
  const sdo = (extra: Partial<VisualTimelineOptions> = {}) => ({
    connection: 'folder', folderUrl: 'http://sdo.local/assets/img', listing: 'html',
    template: 'browse/{YYYY}/{MM}/{DD}/{YYYY}{MM}{DD}_{HH}{mm}{ss}_{variant}_{host}.jpg', smallVariant: '512', largeVariant: '2048',
    videoTemplate: 'dailymov/{YYYY}/{MM}/{DD}/{YYYY}{MM}{DD}_1024_{host}.mp4', ...extra,
  }) as VisualTimelineOptions;
  const page = (names: string[]) => ({ status: 200, text: names.map((n) => `<a href="${n}">${n}</a>`).join('') });
  const fetchSdo = async (path: string) => {
    if (path.startsWith('/browse/2026/01/01')) {return page(['20260101_100000_512_0171.jpg', '20260101_100000_2048_0171.jpg', '20260101_101500_512_0171.jpg']);}
    if (path.startsWith('/dailymov/2025/12/31')) {return page(['20251231_1024_0171.mp4']);}
    if (path.startsWith('/dailymov/2026/01/01')) {return page(['20260101_1024_0171.mp4', '20260101_1024_HMIB.mp4']);}
    return { status: 404, text: '' };
  };

  test('a movie a day: each clip spans its day, beside the stills; a host with only movies too', async () => {
    const { records } = await new FolderSource(sdo(), fetchSdo).hosts(D0 + 10 * 3600e3, D0 + 12 * 3600e3);
    const sun = records.find((r) => r.id === '0171')!;
    expect(sun.frames.map((f) => f.url)).toEqual([
      'http://sdo.local/assets/img/browse/2026/01/01/20260101_100000_512_0171.jpg',
      'http://sdo.local/assets/img/browse/2026/01/01/20260101_101500_512_0171.jpg',
    ]);
    // the day before ended before the range: not asked for
    expect(sun.clips).toEqual([{ from: D0, to: D0 + 864e5, url: 'http://sdo.local/assets/img/dailymov/2026/01/01/20260101_1024_0171.mp4' }]);
    expect(records.find((r) => r.id === 'HMIB')!.clips).toHaveLength(1);
  });

  test('a day in the folder\'s time zone; without a video template, no clips', async () => {
    const syd = await new FolderSource(sdo({ timezone: 'Australia/Sydney' }), fetchSdo).hosts(D0 - 3 * 3600e3, D0 + 12 * 3600e3);
    const clip = syd.records.find((r) => r.id === '0171')!.clips![0];
    // Sydney's 1 January, a whole day of its clock (UTC+11 in summer)
    expect([clip.from, clip.to]).toEqual([D0 - 11 * 3600e3, D0 + 13 * 3600e3]);
    const none = await new FolderSource(sdo({ videoTemplate: '' }), fetchSdo).hosts(D0 + 10 * 3600e3, D0 + 12 * 3600e3);
    expect(none.records.map((r) => [r.id, r.clips])).toEqual([['0171', undefined]]);
  });

  test('a video template that can\'t work says so, by name', () => {
    expect(() => new FolderSource(sdo({ videoTemplate: 'dailymov/{YYYY}.mp4' }), fetchSdo).videoTemplate).toThrow('The video path template needs {host}');
  });
});

/* M5: a date folder whose time has ended is listed again only after an
 * hour; the current day's after a minute, as before. */
describe('FolderSource listing cache', () => {
  const NOW = Date.UTC(2026, 0, 2, 12, 0, 0);
  afterEach(() => jest.restoreAllMocks());

  const counting = () => {
    const asked: string[] = [];
    const fetch = async (path: string) => {
      asked.push(path);
      return path.startsWith('/cam-a/') ? { status: 200, text: listing } : { status: 404, text: '' };
    };
    return { asked, fetch };
  };
  const at = (ts: number) => jest.spyOn(Date, 'now').mockReturnValue(ts);
  const count = (asked: string[], day: string) => asked.filter((p) => p === `/cam-a/${day}/`).length;

  test('yesterday is reused for an hour, today for a minute', async () => {
    const { asked, fetch } = counting();
    const src = new FolderSource(opts(), fetch);
    const from = Date.UTC(2026, 0, 1, 6), to = NOW;
    at(NOW);
    await src.hosts(from, to, { hosts: ['cam-a'] });
    expect([count(asked, '2026-01-01'), count(asked, '2026-01-02')]).toEqual([1, 1]);
    at(NOW + 2 * MIN);
    await src.hosts(from, to, { hosts: ['cam-a'] });
    expect([count(asked, '2026-01-01'), count(asked, '2026-01-02')]).toEqual([1, 2]);
    at(NOW + 61 * MIN);
    await src.hosts(from, to, { hosts: ['cam-a'] });
    expect([count(asked, '2026-01-01'), count(asked, '2026-01-02')]).toEqual([2, 3]);
  });

  test('a folder whose time ended moments ago is still reused for only a minute, for uploads on their way', async () => {
    const { asked, fetch } = counting();
    const src = new FolderSource(opts(), fetch);
    const midnight = Date.UTC(2026, 0, 2);
    at(midnight + 5 * MIN);
    await src.hosts(midnight - 3600e3, midnight + 5 * MIN, { hosts: ['cam-a'] });
    at(midnight + 7 * MIN);
    await src.hosts(midnight - 3600e3, midnight + 5 * MIN, { hosts: ['cam-a'] });
    expect(count(asked, '2026-01-01')).toBe(2);
  });

  test('an S3 day folder inside the range is one listing, whatever the range\'s start', async () => {
    const asked: string[] = [];
    const s3 = new FolderSource(opts({ listing: 's3' }), async (path: string) => {
      asked.push(path);
      return { status: 200, text: '<ListBucketResult></ListBucketResult>' };
    });
    at(NOW);
    await s3.hosts(Date.UTC(2025, 11, 30, 6), NOW, { hosts: ['cam-a'] });
    at(NOW + 2 * MIN);
    // a relative range: its start has moved on
    await s3.hosts(Date.UTC(2025, 11, 30, 6, 2), NOW + 2 * MIN, { hosts: ['cam-a'] });
    const of = (day: string) => asked.filter((p) => p.includes(encodeURIComponent(`cam-a/${day}/`))).length;
    expect([of('2025-12-31'), of('2026-01-01')]).toEqual([1, 1]);
  });
});
