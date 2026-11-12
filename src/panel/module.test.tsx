import React from 'react';
import { act, render } from '@testing-library/react';
import { createTheme, FieldType, LoadingState, toDataFrame } from '@grafana/data';

import { plugin } from './module';

/* L4: a resize renders the panel at each width step; the query's series
 * must not be parsed again for it. */
const parsed = { records: 0, table: 0, states: 0 };
/* counting stand-ins, read through lazily: frameRecords and hostState
 * import each other */
function counting(path: string, counted: Record<string, keyof typeof parsed>) {
  const real = () => jest.requireActual(path);
  return new Proxy({}, {
    get: (_t, k: string) => (k in counted
      ? (...a: unknown[]) => { parsed[counted[k]]++; return real()[k](...a); }
      : real()[k]),
  });
}
jest.mock('../shared/frameRecords', () => counting('../shared/frameRecords', { recordsFromSeries: 'records', hostTableFromSeries: 'table' }));
jest.mock('../shared/hostState', () => counting('../shared/hostState', { statesFromSeries: 'states' }));
const mounts: unknown[] = [];
jest.mock('../core', () => ({
  mountTimeline: (_el: unknown, o: unknown) => { mounts.push(o); return { setExternalCursor: () => {}, destroy: () => {} }; },
  mountGrid: () => ({ setExternalCursor: () => {}, destroy: () => {} }),
}));
const theme = createTheme();
jest.mock('@grafana/ui', () => ({ usePanelContext: () => ({}), useTheme2: () => theme }));
jest.mock('@grafana/runtime', () => ({
  config: { bootData: {} },
  getDataSourceSrv: () => ({ getList: () => [] }),
  locationService: { push: () => {} },
}));

const T0 = Date.UTC(2026, 0, 1, 10);
const frame = toDataFrame({ fields: [
  { name: 'time', type: FieldType.time, values: [T0, T0 + 60e3] },
  { name: 'host', type: FieldType.string, values: ['cam-a', 'cam-a'] },
  { name: 'image', type: FieldType.string, values: ['http://x/1.jpg', 'http://x/2.jpg'] },
] });
const range = { from: { valueOf: () => T0 }, to: { valueOf: () => T0 + 3600e3 }, raw: { from: 'now-1h', to: 'now' } };

describe('the panel (L4)', () => {
  test('a new width doesn\'t parse the series again; new series do', () => {
    const Panel = plugin.panel as unknown as React.FC<any>;
    const bus = { publish: () => {}, subscribe: () => ({ unsubscribe: () => {} }) };
    const data = { state: LoadingState.Done, series: [frame], timeRange: range };
    const props = (width: number, d = data) => ({
      data: d, timeRange: range, timeZone: 'utc', width, height: 300, options: {}, eventBus: bus,
      replaceVariables: (s: string) => s, onChangeTimeRange: () => {},
    });
    const view = render(<Panel {...props(600)} />);
    const after = { ...parsed };
    expect(after.records).toBeGreaterThan(0);
    expect(mounts).toHaveLength(1);
    for (const w of [610, 620, 630]) {act(() => view.rerender(<Panel {...props(w)} />));}
    expect(parsed).toEqual(after);
    // a fresh result is parsed
    act(() => view.rerender(<Panel {...props(630, { ...data, series: [frame] })} />));
    expect(parsed.records).toBe(after.records + 1);
    view.unmount();
  });
});
