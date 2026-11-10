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
