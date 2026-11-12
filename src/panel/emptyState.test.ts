import { emptyStateText } from './emptyState';

describe('emptyStateText', () => {
  test('data that holds no frames says what a frame needs', () => {
    expect(emptyStateText(false, 1, true, true).lines[0]).toBe("No frames in this panel's query.");
  });

  test('hosts that all filter out point at the query and filters', () => {
    expect(emptyStateText(true, 1, true, true)).toEqual({
      lines: ['No hosts match.', "Check this panel's query (Sites, Hosts, Tags) and the dashboard's filters."],
    });
  });

  test('nothing returned, with a data source: try its demo data', () => {
    const t = emptyStateText(false, 2, false);
    expect(t.lines[0]).toBe("This panel's query returned nothing.");
    expect(t.lines.at(-1)).toContain('Demo data');
    expect(t.link).toBeUndefined();
  });

  test('nothing returned and no data source: an admin gets a link, anyone else is told who can add one', () => {
    const admin = emptyStateText(false, 0, true);
    expect(admin.link?.text).toBe('Add a Visual Timeline data source');
    expect(admin.lines).toHaveLength(2);
    const viewer = emptyStateText(false, 0, false);
    expect(viewer.link).toBeUndefined();
    expect(viewer.lines.at(-1)).toContain('A Grafana admin');
  });
});
