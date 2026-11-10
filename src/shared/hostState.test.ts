import { createDataFrame, createTheme, FieldType, MappingType, ValueMapping } from '@grafana/data';

import { recordsBackend } from './frameRecords';
import { stateAnnotations, statesFromSeries, withPauseStates } from './hostState';

const theme = createTheme();
const MIN = 60_000;
const T0 = Date.UTC(2026, 10, 10, 10);

const mappings: ValueMapping[] = [
  { type: MappingType.ValueToText, options: {
    'screen-sleep': { text: 'Screen asleep', color: 'blue', index: 0 },
    up: { color: 'transparent', index: 1 },
    down: { text: 'Down', color: 'red', index: 2 },
  } },
];
function stateFrame(rows: Array<[number, string, string | null]>, extra: { mappings?: ValueMapping[]; end?: Array<number | null>; refId?: string } = {}) {
  return createDataFrame({
    refId: extra.refId ?? 'S',
    fields: [
      { name: 'time', type: FieldType.time, values: rows.map((r) => r[0]) },
      { name: 'host', type: FieldType.string, values: rows.map((r) => r[1]) },
      { name: 'state', type: FieldType.string, values: rows.map((r) => r[2]), config: { mappings: extra.mappings ?? mappings } },
      ...(extra.end ? [{ name: 'end', type: FieldType.time, values: extra.end }] : []),
    ],
  });
}

describe('statesFromSeries', () => {
  test('rows become spans per host, labelled and coloured by the value mappings', () => {
    const hosts = statesFromSeries([stateFrame([
      [T0, 'cam-1', 'screen-sleep'],
      [T0 + 10 * MIN, 'cam-1', 'up'],
      [T0 + 5 * MIN, 'cam-2', 'down'],
    ])], theme)!;
    const cam1 = hosts.find((h) => h.id === 'cam-1')!;
    expect(cam1.spans).toEqual([{ from: T0, to: T0 + 10 * MIN, label: 'Screen asleep', color: theme.visualization.getColorByName('blue') }]);
    const cam2 = hosts.find((h) => h.id === 'cam-2')!;
    // the last state stays open
    expect(cam2.spans).toEqual([{ from: T0 + 5 * MIN, label: 'Down', color: theme.visualization.getColorByName('red') }]);
  });

  test('an unmapped value shows as itself with no colour; an empty one ends the span', () => {
    const [h] = statesFromSeries([stateFrame([[T0, 'cam', 'maintenance'], [T0 + MIN, 'cam', ''], [T0 + 2 * MIN, 'cam', null]], { mappings: [] })], theme)!;
    expect(h.spans).toEqual([{ from: T0, to: T0 + MIN, label: 'maintenance' }]);
  });

  test('a repeated state is one span; a new state ends the last one', () => {
    const [h] = statesFromSeries([stateFrame([
      [T0, 'cam', 'down'], [T0 + MIN, 'cam', 'down'], [T0 + 2 * MIN, 'cam', 'screen-sleep'], [T0 + 3 * MIN, 'cam', 'up'],
    ])], theme)!;
    expect(h.spans.map((s) => [s.label, s.from, s.to])).toEqual([['Down', T0, T0 + 2 * MIN], ['Screen asleep', T0 + 2 * MIN, T0 + 3 * MIN]]);
  });

  test('an end-time field closes a span on its own row', () => {
    const [h] = statesFromSeries([stateFrame([[T0, 'cam', 'down'], [T0 + 30 * MIN, 'cam', 'down']], { end: [T0 + 5 * MIN, null] })], theme)!;
    expect(h.spans.map((s) => [s.from, s.to])).toEqual([[T0, T0 + 5 * MIN], [T0 + 30 * MIN, undefined]]);
  });

  test('numeric states, as from Prometheus: 1 mapped transparent is normal, 0 a red Down', () => {
    const f = createDataFrame({ refId: 'up', fields: [
      { name: 'time', type: FieldType.time, values: [T0, T0 + MIN, T0 + 2 * MIN] },
      { name: 'state', type: FieldType.number, values: [1, 0, 1], labels: { host: 'kiosk-7' }, config: { mappings: [
        { type: MappingType.ValueToText, options: { '1': { color: 'transparent', index: 0 }, '0': { text: 'Down', color: 'red', index: 1 } } },
      ] } },
    ] });
    const [h] = statesFromSeries([f], theme)!;
    expect(h.id).toBe('kiosk-7');
    expect(h.spans).toEqual([{ from: T0 + MIN, to: T0 + 2 * MIN, label: 'Down', color: theme.visualization.getColorByName('red') }]);
  });

  test('frames of images, and results without a state field, are not state', () => {
    const images = createDataFrame({ fields: [
      { name: 'time', type: FieldType.time, values: [T0] },
      { name: 'host', type: FieldType.string, values: ['cam'] },
      { name: 'image', type: FieldType.string, values: ['https://img/1.jpg'] },
      { name: 'status', type: FieldType.string, values: ['live'] },
    ] });
    expect(statesFromSeries([images], theme)).toBeNull();
    expect(statesFromSeries(undefined, theme)).toBeNull();
  });

  test('roles name the fields when they differ from the usual names', () => {
    const f = createDataFrame({ fields: [
      { name: 'at', type: FieldType.number, values: [T0] },
      { name: 'device', type: FieldType.string, values: ['lobby'] },
      { name: 'mode', type: FieldType.string, values: ['night'] },
    ] });
    const [h] = statesFromSeries([f], theme, { time: 'at', state: 'mode' })!;
    expect(h).toMatchObject({ id: 'lobby', spans: [{ from: T0, label: 'night' }] });
  });
});

describe('withPauseStates', () => {
  test('pause spans replace declared pauses; cadence events stay', () => {
    const decl = { id: 'cam', site: 's', cadence: MIN, history: [
      { since: T0 - 60 * MIN, cadence: MIN },
      { since: T0 - 30 * MIN, paused: true, reason: 'quiet' },
      { since: T0 - 20 * MIN, cadence: 2 * MIN },
    ] };
    const out = withPauseStates(decl, [
      { from: T0, to: T0 + 5 * MIN, label: 'Screen asleep', color: '#00f', pauses: true },
      { from: T0 + 10 * MIN, label: 'Maintenance' },   // not a pause: left to the state lane
      { from: T0 + 20 * MIN, label: 'Down', pauses: true },
    ]);
    expect(out.history).toEqual([
      { since: T0 - 60 * MIN, cadence: MIN },
      { since: T0 - 20 * MIN, cadence: 2 * MIN },
      { since: T0, paused: true, label: 'Screen asleep', color: '#00f' },
      { since: T0 + 5 * MIN },
      { since: T0 + 20 * MIN, paused: true, label: 'Down' },
    ]);
  });

  test('a declaration without pause spans is returned as it was', () => {
    const decl = { id: 'cam', history: [{ since: T0, paused: true, reason: 'quiet' }] };
    expect(withPauseStates(decl, [{ from: T0, label: 'x' }])).toBe(decl);
  });
});

describe('a state field set to pause frames', () => {
  test('marks its spans as pauses, and a host only a state query knows of is still drawn', async () => {
    const f = stateFrame([[T0, 'cam-9', 'down']]);
    f.fields[2].config.custom = { pausesFrames: true };
    const states = statesFromSeries([f], theme)!;
    expect(states[0].spans[0].pauses).toBe(true);
    const b = recordsBackend([], [], states);
    const [decl] = await b.kiosks(null);
    expect(decl).toMatchObject({ id: 'cam-9', history: [{ since: T0, paused: true, label: 'Down' }] });
  });
});

describe('stateAnnotations', () => {
  const hosts = [{ id: 'cam', site: 'home', spans: [
    { from: T0, to: T0 + 5 * MIN, label: 'Cleaning', color: 'rgb(87, 148, 242)' },
    { from: T0 + 10 * MIN, label: 'Night' },                       // still open
    { from: T0 + 20 * MIN, to: T0 + 25 * MIN, label: 'Asleep', pauses: true },   // drawn as a pause instead
    { from: T0 - 60 * MIN, to: T0 - 30 * MIN, label: 'Old' },      // before the window
  ] }];
  test('states that run alongside frames become region annotations pinned to their host', () => {
    expect(stateAnnotations(hosts, T0 - 5 * MIN, T0 + 60 * MIN)).toEqual([
      { ts: T0, timeEnd: T0 + 5 * MIN, title: 'Cleaning', text: '', tags: ['host:cam', 'site:home', 'state'], color: '#5794f2' },
      { ts: T0 + 10 * MIN, timeEnd: T0 + 60 * MIN, title: 'Night', text: '', tags: ['host:cam', 'site:home', 'state'] },
    ]);
  });
});
