import { listingPath, parseHtmlListing, parseJsonListing, parseS3Listing } from './listings';
import { compileTemplate, parsePath, startAfterName } from './template';
import { Lister, walkFrames } from './walk';

const T = (iso: string) => Date.parse(iso);

describe('path templates (#125)', () => {
  test('NASA SDO: the time, the size and the channel all in the file name', () => {
    const tpl = compileTemplate('{YYYY}/{MM}/{DD}/{YYYY}{MM}{DD}_{HH}{mm}{ss}_{variant}_{host}.jpg');
    expect(parsePath(tpl, '2026/11/10/20261110_002622_512_0171.jpg', 'UTC')).toEqual({ ts: T('2026-11-10T00:26:22Z'), host: '0171', site: '', variant: '512' });
    // the date folders must agree with the file name's date
    expect(parsePath(tpl, '2026/11/09/20261110_002622_512_0171.jpg', 'UTC')).toBeNull();
    expect(parsePath(tpl, '2026/11/10/notes.txt', 'UTC')).toBeNull();
  });

  test('USGS: the host in its folder and again in the file name, both the same', () => {
    const tpl = compileTemplate('{variant}/{host}/{host}___{YYYY}-{MM}-{DD}T{HH}-{mm}-{ss}Z.jpg');
    expect(parsePath(tpl, 'thumbnail/AK_Anchor/AK_Anchor___2026-11-10T08-15-02Z.jpg', 'UTC'))
      .toEqual({ ts: T('2026-11-10T08:15:02Z'), host: 'AK_Anchor', site: '', variant: 'thumbnail' });
    expect(parsePath(tpl, 'thumbnail/AK_Anchor/OR_Other___2026-11-10T08-15-02Z.jpg', 'UTC')).toBeNull();
  });

  test('NOAA GOES: day of year; epoch names; a time zone', () => {
    const goes = compileTemplate('{YYYY}{DDD}{HH}{mm}_GOES19-ABI-CONUS-13-{variant}.jpg'.replace('{YYYY}', '{host}/{YYYY}'));
    expect(parsePath(goes, 'band13/20263141205_GOES19-ABI-CONUS-13-416x250.jpg', 'UTC')?.ts).toBe(T('2026-11-10T12:05:00Z'));
    expect(parsePath(compileTemplate('{host}/{epoch_ms}.jpg'), 'cam/1794300000000.jpg', 'UTC')?.ts).toBe(1794300000000);
    // a folder whose names are local time
    expect(parsePath(compileTemplate('{host}/{YYYY}{MM}{DD}{HH}{mm}{ss}.jpg'), 'cam/20260101100000.jpg', 'Australia/Brisbane')?.ts).toBe(T('2026-01-01T00:00:00Z'));
  });

  test('impossible times are no frame', () => {
    const tpl = compileTemplate('{host}/{YYYY}{MM}{DD}{HH}{mm}.jpg');
    expect(parsePath(tpl, 'cam/202613010000.jpg', 'UTC')).toBeNull();
    expect(parsePath(tpl, 'cam/202604310000.jpg', 'UTC')).toBeNull();
  });

  test('templates that can\'t work say why', () => {
    expect(() => compileTemplate('{YYYY}/{x}.jpg')).toThrow('{x}');
    expect(() => compileTemplate('{YYYY}{MM}{DD}.jpg')).toThrow('{host}');
    expect(() => compileTemplate('{host}/latest.jpg')).toThrow('time');
    expect(() => compileTemplate('')).toThrow('Set a path template');
  });

  test('a file name\'s lower bound at a time, for listings that can start after it', () => {
    const tpl = compileTemplate('{variant}/{host}/{host}___{YYYY}-{MM}-{DD}T{HH}-{mm}-{ss}Z.jpg');
    const last = tpl.segments[2];
    expect(startAfterName(last, { host: 'AK', variant: 'thumbnail' }, T('2026-11-10T08:00:00Z'), 'UTC')).toBe('AK___2026-11-10T08-00-00');
    // an unbound placeholder before the time: no bound
    expect(startAfterName(compileTemplate('{host}_{YYYY}{MM}{DD}{HH}{mm}.jpg').segments[0], {}, 0, 'UTC')).toBeNull();
  });
});

describe('listings', () => {
  test('nginx and Caddy JSON', () => {
    expect(parseJsonListing('[{"name":"cam-1","type":"directory"},{"name":"a.jpg","type":"file"}]')).toEqual({ dirs: ['cam-1'], files: ['a.jpg'] });
    expect(parseJsonListing('[{"name":"cam-1/","is_dir":true},{"name":"a.jpg","is_dir":false}]')).toEqual({ dirs: ['cam-1'], files: ['a.jpg'] });
    expect(() => parseJsonListing('<html>')).toThrow('JSON listing');
  });

  test('HTML link listings: Apache, nginx and Python, without sort links, parents or other sites', () => {
    const apache = '<tr><td><a href="?C=N;O=D">Name</a></td></tr><tr><td><a href="/assets/img/browse/2026/11/">Parent Directory</a></td></tr>' +
      '<tr><td><a href="20261110_000646_512_0171.jpg">20261110_000646_512_0171.jpg</a></td></tr><tr><td><a href="sub/">sub/</a></td></tr>';
    expect(parseHtmlListing(apache)).toEqual({ dirs: ['sub'], files: ['20261110_000646_512_0171.jpg'] });
    const nginx = '<a href="../">../</a>\n<a href="cam-1/">cam-1/</a>  10-Nov-2026 10:00 -\n<a href="https://elsewhere/x.jpg">x</a>';
    expect(parseHtmlListing(nginx)).toEqual({ dirs: ['cam-1'], files: [] });
    expect(parseHtmlListing('<li><a href="a%20b.jpg">a b.jpg</a></li><li><a href=\'./c.jpg\'>c</a></li>')).toEqual({ dirs: [], files: ['a b.jpg', 'c.jpg'] });
    // entities decode once: "&amp;lt;" is the text "&lt;", not "<"
    expect(parseHtmlListing('<a href="x&amp;lt;1.jpg">x</a><a href="a&amp;b.jpg">a</a>')).toEqual({ dirs: [], files: ['x&lt;1.jpg', 'a&b.jpg'] });
  });

  test('S3 ListObjectsV2: prefixes are folders, keys files, and a truncated page has a token', () => {
    const xml = '<?xml version="1.0"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>b</Name><Prefix>thumbnail/</Prefix>' +
      '<IsTruncated>true</IsTruncated><NextContinuationToken>tok&amp;1</NextContinuationToken>' +
      '<Contents><Key>thumbnail/x.jpg</Key><Size>1</Size></Contents>' +
      '<CommonPrefixes><Prefix>thumbnail/AK_Anchor/</Prefix></CommonPrefixes></ListBucketResult>';
    expect(parseS3Listing(xml, 'thumbnail/')).toEqual({ dirs: ['AK_Anchor'], files: ['x.jpg'], next: 'tok&1' });
    expect(() => parseS3Listing('<Error><Code>AccessDenied</Code></Error>', '')).toThrow('AccessDenied');
  });

  test('listing URLs: a folder\'s own for JSON and HTML, a ListObjectsV2 query for S3', () => {
    expect(listingPath('html', '2026/11/10')).toBe('/2026/11/10/');
    expect(listingPath('json', '')).toBe('/');
    expect(listingPath('s3', 'thumbnail/AK', { startAfter: 'AK___2026' })).toBe('/?list-type=2&delimiter=%2F&prefix=thumbnail%2FAK%2F&start-after=thumbnail%2FAK%2FAK___2026');
  });
});

/* a folder tree as a lister: folder → names (a trailing "/" is a folder) */
function treeLister(tree: Record<string, string[]>) {
  const calls: Array<{ folder: string; startAfter?: string }> = [];
  const list: Lister = async (folder, opts) => {
    calls.push({ folder, ...(opts?.startAfter ? { startAfter: opts.startAfter } : {}) });
    const names = tree[folder] ?? [];
    return { dirs: names.filter((n) => n.endsWith('/')).map((n) => n.slice(0, -1)), files: names.filter((n) => !n.endsWith('/')) };
  };
  return { list, calls };
}

describe('walking a folder tree for a time range', () => {
  test('SDO: only the day folders the range touches are read, and frames come from file names', async () => {
    const tpl = compileTemplate('{YYYY}/{MM}/{DD}/{YYYY}{MM}{DD}_{HH}{mm}{ss}_{variant}_{host}.jpg');
    const { list, calls } = treeLister({
      '2026/11/09': ['20261109_235546_512_0171.jpg', '20261109_235610_1024_0171.jpg'],
      '2026/11/10': ['20261110_000646_512_0171.jpg', '20261110_001558_512_0171.jpg', '20261110_000700_512_0304.jpg', 'index.html'],
      '2026/11/08': ['20261108_120000_512_0171.jpg'],
    });
    const { frames, truncated } = await walkFrames(tpl, list, {
      from: T('2026-11-09T23:50:00Z'), to: T('2026-11-10T00:20:00Z'), tz: 'UTC', variants: ['512'],
    });
    expect(truncated).toBe(false);
    expect(calls.map((c) => c.folder).sort()).toEqual(['2026/11/09', '2026/11/10']);
    expect(frames.map((f) => [f.host, f.path])).toEqual([
      ['0171', '2026/11/09/20261109_235546_512_0171.jpg'],
      ['0171', '2026/11/10/20261110_000646_512_0171.jpg'],
      ['0304', '2026/11/10/20261110_000700_512_0304.jpg'],
      ['0171', '2026/11/10/20261110_001558_512_0171.jpg'],
    ]);
  });

  test('USGS: hosts listed as folders, and each host\'s files listed from the range\'s start', async () => {
    const tpl = compileTemplate('{variant}/{host}/{host}___{YYYY}-{MM}-{DD}T{HH}-{mm}-{ss}Z.jpg');
    const { list, calls } = treeLister({
      '': ['720/', 'thumbnail/'],
      thumbnail: ['AK_Anchor/', 'OR_Other/'],
      'thumbnail/AK_Anchor': ['AK_Anchor___2026-11-10T08-15-02Z.jpg', 'AK_Anchor___2026-11-10T09-14-58Z.jpg'],
      'thumbnail/OR_Other': ['OR_Other___2026-11-10T08-30-00Z.jpg'],
    });
    const { frames } = await walkFrames(tpl, list, {
      from: T('2026-11-10T08:00:00Z'), to: T('2026-11-10T10:00:00Z'), tz: 'UTC', variants: ['thumbnail'], hosts: ['AK_Anchor'],
    });
    expect(frames.map((f) => f.ts)).toEqual([T('2026-11-10T08:15:02Z'), T('2026-11-10T09:14:58Z')]);
    // the variant and host are given, so neither level is listed: only the
    // host's own folder, from the range's start
    expect(calls).toEqual([{ folder: 'thumbnail/AK_Anchor', startAfter: 'AK_Anchor___2026-11-10T08-00-00' }]);
  });

  test('without the hosts given, the host folders are listed and matched', async () => {
    const tpl = compileTemplate('{variant}/{host}/{host}___{YYYY}-{MM}-{DD}T{HH}-{mm}-{ss}Z.jpg');
    const { list, calls } = treeLister({
      thumbnail: ['AK_Anchor/', 'OR_Other/'],
      'thumbnail/AK_Anchor': ['AK_Anchor___2026-11-10T08-15-02Z.jpg'],
      'thumbnail/OR_Other': ['OR_Other___2026-11-10T08-30-00Z.jpg'],
    });
    const { frames } = await walkFrames(tpl, list, { from: T('2026-11-10T08:00:00Z'), to: T('2026-11-10T10:00:00Z'), tz: 'UTC', variants: ['thumbnail'] });
    expect(frames.map((f) => f.host)).toEqual(['AK_Anchor', 'OR_Other']);
    expect(calls[0]).toEqual({ folder: 'thumbnail' });
  });

  test('past the listing cap, the walk stops and says so', async () => {
    const tpl = compileTemplate('{host}/{epoch_ms}.jpg');
    const hosts = Array.from({ length: 5 }, (_, i) => `cam-${i}/`);
    const { list } = treeLister({ '': hosts });
    const { truncated } = await walkFrames(tpl, list, { from: 0, to: 1, tz: 'UTC', maxListings: 3 });
    expect(truncated).toBe(true);
  });
});
