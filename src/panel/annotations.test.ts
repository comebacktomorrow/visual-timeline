import { FieldType, toDataFrame } from '@grafana/data';

import { extractAnnotations } from './annotations';

describe('extractAnnotations', () => {
  test('each row of each annotation frame becomes one plain annotation', () => {
    const frame = toDataFrame({ fields: [
      { name: 'time', type: FieldType.time, values: [1000, 2000] },
      { name: 'timeEnd', type: FieldType.time, values: [1500, undefined] },
      { name: 'title', type: FieldType.string, values: ['Deploy', 'Reboot'] },
      { name: 'text', type: FieldType.string, values: ['v2', ''] },
      { name: 'tags', type: FieldType.other, values: [['host:cam-a'], []] },
      { name: 'color', type: FieldType.string, values: ['red', undefined] },
    ] });
    expect(extractAnnotations([frame])).toEqual([
      { ts: 1000, timeEnd: 1500, title: 'Deploy', text: 'v2', tags: ['host:cam-a'], color: 'red' },
      { ts: 2000, timeEnd: undefined, title: 'Reboot', text: '', tags: [], color: undefined },
    ]);
  });

  test('missing fields are undefined; a frame without time is skipped', () => {
    const onlyTime = { fields: [{ name: 'time', values: [5] }] };
    const noTime = { length: 1, fields: [{ name: 'title', values: ['x'] }] };
    expect(extractAnnotations([noTime, onlyTime])).toEqual([
      { ts: 5, timeEnd: undefined, title: undefined, text: undefined, tags: undefined, color: undefined },
    ]);
  });

  test('values read through get() (older vectors) and the frame\'s own length', () => {
    const vec = (xs: unknown[]) => ({ get: (i: number) => xs[i], length: xs.length });
    const frame = { length: 1, fields: [{ name: 'time', values: vec([7, 8]) }, { name: 'title', values: vec(['a', 'b']) }] };
    expect(extractAnnotations([frame]).map((a) => [a.ts, a.title])).toEqual([[7, 'a']]);
  });

  test('no frames: none', () => {
    expect(extractAnnotations(undefined)).toEqual([]);
    expect(extractAnnotations([])).toEqual([]);
  });
});
