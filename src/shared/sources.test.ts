import type { ApiSourceDecl } from '../vt/backends/api';
import { hostTableFromSeries } from './frameRecords';
import type { SourceDecl } from '../vt/types';
import {
  applySourceFilter,
  interpolatedList,
  lastFramesByHost,
  matchesAdhoc,
  sourcesToFrame,
  tagKeys,
  tagValues,
} from './sources';

const SOURCES: ApiSourceDecl[] = [
  { id: 'cam-1', site: 'home', cadence: 60000, tags: { env: 'prod', room: 'lobby' }, timezone: 'Australia/Brisbane', history: [] },
  { id: 'cam-2', site: 'home', cadence: 60000, tags: { env: 'test' }, hiCadence: 300000, history: [{ since: 5, cadence: 60000 }] },
  { id: 'kiosk-a', site: 'office', cadence: 300000, location: 'foyer', history: [] },
];
const ids = (list: SourceDecl[]) => list.map((s) => s.id);

describe('interpolatedList', () => {
  test('a resolved list, or null for all', () => {
    expect(interpolatedList('home, office')).toEqual(['home', 'office']);
    expect(interpolatedList('{home,office}')).toEqual(['home', 'office']);
    expect(interpolatedList('')).toBeNull();
    expect(interpolatedList('All')).toBeNull();
  });
  test('a variable the dashboard does not define means all', () => {
    expect(interpolatedList('${site:csv}')).toBeNull();
    expect(interpolatedList('$site')).toBeNull();
  });
});

describe('applySourceFilter', () => {
  test('sites, hosts and tags all apply', () => {
    expect(ids(applySourceFilter(SOURCES, { sites: ['home'] }))).toEqual(['cam-1', 'cam-2']);
    expect(ids(applySourceFilter(SOURCES, { hosts: ['kiosk-a'] }))).toEqual(['kiosk-a']);
    expect(ids(applySourceFilter(SOURCES, { tags: 'env=prod' }))).toEqual(['cam-1']);
    expect(ids(applySourceFilter(SOURCES, {}))).toEqual(['cam-1', 'cam-2', 'kiosk-a']);
  });
  test('ad hoc filters on site, host and tags', () => {
    expect(ids(applySourceFilter(SOURCES, { adhoc: [{ key: 'site', operator: '!=', value: 'home' }] }))).toEqual(['kiosk-a']);
    expect(ids(applySourceFilter(SOURCES, { adhoc: [{ key: 'host', operator: '=~', value: 'cam-.*' }] }))).toEqual(['cam-1', 'cam-2']);
    expect(ids(applySourceFilter(SOURCES, { adhoc: [{ key: 'env', operator: '=', value: 'prod' }] }))).toEqual(['cam-1']);
  });
});

describe('matchesAdhoc', () => {
  const cam1 = SOURCES[0];
  test.each([
    ['=', 'prod', undefined, true],
    ['=', 'pro', undefined, false],
    ['!=', 'test', undefined, true],
    ['=~', 'pr.d', undefined, true],
    ['=~', 'pr', undefined, false], // whole-value match, as Prometheus and Loki
    ['!~', 'te.*', undefined, true],
    ['=|', 'x', ['test', 'prod'], true],
    ['!=|', 'x', ['test', 'prod'], false],
    ['<', 'anything', undefined, true], // unsupported operators pass everything
  ])('env %s %s %p -> %p', (operator, value, values, expected) => {
    expect(matchesAdhoc(cam1, { key: 'env', operator, value, values })).toBe(expected);
  });
  test('an invalid pattern matches nothing with =~ and excludes nothing with !~', () => {
    expect(matchesAdhoc(cam1, { key: 'env', operator: '=~', value: '(' })).toBe(false);
    expect(matchesAdhoc(cam1, { key: 'env', operator: '!~', value: '(' })).toBe(true);
  });
  test('a missing tag reads as empty', () => {
    expect(matchesAdhoc(SOURCES[2], { key: 'env', operator: '=', value: '' })).toBe(true);
  });
});

describe('tagKeys and tagValues', () => {
  test('keys: site and host first, then the tag keys, sorted', () => {
    expect(tagKeys(SOURCES)).toEqual(['site', 'host', 'env', 'room']);
  });
  test('values: sorted, without blanks', () => {
    expect(tagValues(SOURCES, 'env')).toEqual(['prod', 'test']);
    expect(tagValues(SOURCES, 'site')).toEqual(['home', 'office']);
    expect(tagValues(SOURCES, 'host')).toEqual(['cam-1', 'cam-2', 'kiosk-a']);
  });
});

describe('the last frames, per host', () => {
  const last = [
    { frame: { ts: 100, url: 'https://img/1.jpg' }, status: 'live' as const },
    { frame: { ts: 50, url: 'https://img/2.jpg' }, status: 'paused' as const, reason: 'quiet' },
    null, // its lookup failed
  ];
  const byName = (frame: any) => Object.fromEntries(frame.fields.map((f: any) => [f.name, f]));

  test('one row, with fields named by host for a Canvas element to bind to', () => {
    const frame = lastFramesByHost(SOURCES, last, 'A');
    expect(frame.length).toBe(1);
    const f = byName(frame);
    expect(f['cam-1'].values).toEqual(['https://img/1.jpg']);
    expect(f['cam-1'].config.custom.cellOptions).toEqual({ type: 'image' });
    expect(f['cam-1 status'].values).toEqual(['live']);
    expect(f['cam-1 time'].values).toEqual([100]);
    expect(f['cam-2 pause reason'].values).toEqual(['quiet']);
    expect(f['kiosk-a'].values).toEqual([null]);
    // status colours come with the data
    expect(f['cam-2 status'].config.mappings[0].options.paused.color).toBe('blue');
  });

  test('not a host table (no host field): Visual Timeline panels draw no hosts from it', () => {
    expect(hostTableFromSeries([lastFramesByHost(SOURCES, last, 'A')])).toEqual([]);
  });

  test('a host id two sites share is named site/id', () => {
    const twins: SourceDecl[] = [SOURCES[0], { ...SOURCES[0], site: 'office' }];
    const names = lastFramesByHost(twins, [null, null], 'A').fields.map((f) => f.name);
    expect(names).toContain('home/cam-1');
    expect(names).toContain('office/cam-1 status');
  });
});

describe('the source list frame', () => {
  // no marker: the panel reads it as it reads anyone's host table (#126)
  test('is a host table: every host with its time zone, location, tags and cadence', () => {
    const decls = hostTableFromSeries([sourcesToFrame(SOURCES, 'A')]);
    expect(decls).toEqual([
      { id: 'cam-1', site: 'home', cadence: 60000, timezone: 'Australia/Brisbane', tags: { env: 'prod', room: 'lobby' } },
      { id: 'cam-2', site: 'home', cadence: 60000, tags: { env: 'test' } },
      { id: 'kiosk-a', site: 'office', cadence: 300000, location: 'foyer' },
    ]);
  });
  test('several queries\' lists merge without duplicates', () => {
    const decls = hostTableFromSeries([sourcesToFrame(SOURCES.slice(0, 2), 'A'), sourcesToFrame(SOURCES.slice(1), 'B')]);
    expect(ids(decls)).toEqual(['cam-1', 'cam-2', 'kiosk-a']);
  });
  test('carries no marker for the panel', () => {
    expect(sourcesToFrame(SOURCES, 'A').meta?.custom).toBeUndefined();
  });
});
