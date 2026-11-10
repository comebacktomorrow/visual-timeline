import { clearPauseClasses, erasFor, pauseInfo, PAUSE_CLASSES } from './core';
import { addPauseClasses } from './vt/model/eras';
import { labelPauses, reasonDisplay } from './vt/backends/reasons';

/* These pin the CURRENT behaviour of src/core.ts as a safety net for the
 * split in #64. A test marked "NOTE: current behaviour" documents something
 * that looks wrong; change it only together with a deliberate fix. */

const MIN = 60e3;
const DAY = 864e5;
const T0 = Date.UTC(2026, 6, 1); // 2026-07-01T00:00Z, a multiple of every cadence used here
const P = { from: T0, to: T0 + 60 * MIN };

const era = (from: number, to: number, cadence: number, extra: Record<string, unknown> = {}) => ({
  from,
  to,
  cadence,
  paused: false,
  reason: undefined,
  intended: undefined,
  ...extra,
});

describe('erasFor', () => {
  test('no history: one era over the window at the declared cadence', () => {
    expect(erasFor({ cadence: 30e3 }, P)).toEqual([era(P.from, P.to, 30e3)]);
  });

  test('no history and no cadence: defaults to 60 s', () => {
    expect(erasFor({}, P)).toEqual([era(P.from, P.to, 60e3)]);
  });

  test('a cadence change mid-window splits the window into two eras', () => {
    const decl = {
      cadence: 240e3,
      history: [
        { since: T0 - DAY, variant: 'lo', cadence: 120e3 },
        { since: T0 + 30 * MIN, variant: 'lo', cadence: 240e3 },
      ],
    };
    expect(erasFor(decl, P)).toEqual([era(T0, T0 + 30 * MIN, 120e3), era(T0 + 30 * MIN, P.to, 240e3)]);
  });

  test('before the first history entry, the first entry’s cadence applies (not the current declared one)', () => {
    const decl = { cadence: 240e3, history: [{ since: T0 + 30 * MIN, variant: 'lo', cadence: 120e3 }] };
    // the leading era (before any recorded event) takes history[0].cadence
    expect(erasFor(decl, P)).toEqual([era(T0, P.to, 120e3)]);
  });

  test('history is sorted by `since` and hi-variant entries are ignored', () => {
    const decl = {
      cadence: 60e3,
      history: [
        { since: T0 + 40 * MIN, variant: 'lo', cadence: 30e3 },
        { since: T0 + 10 * MIN, variant: 'hi', cadence: 600e3 },
        { since: T0 - DAY, variant: 'lo', cadence: 60e3 },
        { since: T0 + 20 * MIN, cadence: 120e3 }, // no variant = lo
      ],
    };
    expect(erasFor(decl, P)).toEqual([
      era(T0, T0 + 20 * MIN, 60e3),
      era(T0 + 20 * MIN, T0 + 40 * MIN, 120e3),
      era(T0 + 40 * MIN, P.to, 30e3),
    ]);
  });

  test('events outside the window only set the cadence in force; nothing outside is emitted', () => {
    const decl = {
      history: [
        { since: T0 - 2 * DAY, variant: 'lo', cadence: 60e3 },
        { since: T0 - DAY, variant: 'lo', cadence: 300e3 },
        { since: P.to + MIN, variant: 'lo', cadence: 30e3 },
      ],
    };
    expect(erasFor(decl, P)).toEqual([era(P.from, P.to, 300e3)]);
  });

  test('an event exactly at the window start replaces the leading era (no zero-width era)', () => {
    const decl = { history: [{ since: P.from, variant: 'lo', cadence: 120e3 }], cadence: 30e3 };
    expect(erasFor(decl, P)).toEqual([era(P.from, P.to, 120e3)]);
  });

  test('a re-declaration of the same cadence merges into the running era', () => {
    const decl = {
      history: [
        { since: T0 - DAY, variant: 'lo', cadence: 60e3 },
        { since: T0 + 20 * MIN, variant: 'lo', cadence: 60e3 },
      ],
    };
    expect(erasFor(decl, P)).toEqual([era(P.from, P.to, 60e3)]);
  });

  test('a declared pause becomes a paused era; it keeps the cadence in force and carries reason/intent', () => {
    const decl = {
      history: [
        { since: T0 - DAY, variant: 'lo', cadence: 60e3 },
        { since: T0 + 20 * MIN, variant: 'lo', paused: true, reason: 'screen-sleep', intended: false },
      ],
    };
    expect(erasFor(decl, P)).toEqual([
      era(T0, T0 + 20 * MIN, 60e3),
      era(T0 + 20 * MIN, P.to, 60e3, { paused: true, reason: 'screen-sleep', intended: false }),
    ]);
  });

  test('a bounded pause: the next non-paused entry (resume) closes it, cadence-less resume keeps the pace', () => {
    const decl = {
      history: [
        { since: T0 - DAY, variant: 'lo', cadence: 120e3 },
        { since: T0 + 20 * MIN, variant: 'lo', paused: true, reason: 'quiet' },
        { since: T0 + 35 * MIN, variant: 'lo' },
      ],
    };
    expect(erasFor(decl, P)).toEqual([
      era(T0, T0 + 20 * MIN, 120e3),
      era(T0 + 20 * MIN, T0 + 35 * MIN, 120e3, { paused: true, reason: 'quiet' }),
      era(T0 + 35 * MIN, P.to, 120e3),
    ]);
  });

  test('two consecutive pauses merge only when reason and intent match', () => {
    const same = {
      history: [
        { since: T0 + 10 * MIN, variant: 'lo', paused: true, reason: 'quiet' },
        { since: T0 + 20 * MIN, variant: 'lo', paused: true, reason: 'quiet' },
      ],
      cadence: 60e3,
    };
    expect(erasFor(same, P)).toEqual([
      era(T0, T0 + 10 * MIN, 60e3),
      era(T0 + 10 * MIN, P.to, 60e3, { paused: true, reason: 'quiet' }),
    ]);
    const different = {
      history: [
        { since: T0 + 10 * MIN, variant: 'lo', paused: true, reason: 'quiet' },
        { since: T0 + 20 * MIN, variant: 'lo', paused: true, reason: 'system-down' },
      ],
      cadence: 60e3,
    };
    expect(erasFor(different, P)).toEqual([
      era(T0, T0 + 10 * MIN, 60e3),
      era(T0 + 10 * MIN, T0 + 20 * MIN, 60e3, { paused: true, reason: 'quiet' }),
      era(T0 + 20 * MIN, P.to, 60e3, { paused: true, reason: 'system-down' }),
    ]);
  });

  test('a pause that started before the window covers the window start', () => {
    const decl = { cadence: 60e3, history: [{ since: T0 - DAY, variant: 'lo', paused: true }] };
    expect(erasFor(decl, P)).toEqual([era(P.from, P.to, 60e3, { paused: true })]);
  });

  test('an empty window still yields one era, with the same keys as any other (#77)', () => {
    const empty = { from: T0, to: T0 };
    // toStrictEqual: reason and intended must be present (as undefined), not missing
    expect(erasFor({ cadence: 30e3 }, empty)).toStrictEqual([era(T0, T0, 30e3)]);
    expect(erasFor({ cadence: 30e3 }, P)).toStrictEqual([era(P.from, P.to, 30e3)]);
  });
});

describe('retention (an API that deletes old frames)', () => {
  test('the "expired" pause the API leads with becomes a NO DATA era up to the cutoff', () => {
    const cutoff = 1_000_000;
    const history = [
      { since: 0, variant: 'lo', paused: true, reason: 'expired', intended: true },
      { since: cutoff, variant: 'lo', cadence: 60e3 },
    ];
    // the API backend labels the API's reasons (labelPauses) before the core sees them
    const eras = erasFor(labelPauses({ cadence: 60e3, history }), { from: cutoff - 600e3, to: cutoff + 600e3 });
    expect(eras.map((e) => [e.from, e.to, e.paused, e.reason])).toEqual([
      [cutoff - 600e3, cutoff, true, 'expired'],
      [cutoff, cutoff + 600e3, false, undefined],
    ]);
    expect(pauseInfo(eras[0]).label).toBe('NO DATA');
  });
});

describe('pauseInfo', () => {
  // the core knows no reasons: a pause is its label and colour
  test('a pause with a label and colour is tinted that colour', () => {
    expect(pauseInfo({ paused: true, label: 'Maintenance', color: '#B877D9' })).toEqual({ label: 'Maintenance', classes: ['paused', 'tinted'], color: '#B877D9' });
  });
  test('without a colour it takes the neutral hatch; without a label it is PAUSED', () => {
    expect(pauseInfo({ paused: true, label: 'QUIET HOURS' })).toEqual({ label: 'QUIET HOURS', classes: ['paused'] });
    expect(pauseInfo({ paused: true })).toEqual({ label: 'PAUSED', classes: ['paused'] });
    expect(pauseInfo(null)).toEqual({ label: 'PAUSED', classes: ['paused'] });
  });
});

describe('reasonDisplay (the reference worker\'s reasons, at the edge)', () => {
  test.each([
    [undefined, true, 'PAUSED', undefined],
    ['quiet', true, 'QUIET HOURS', undefined],
    ['screen-sleep', true, 'SCREEN ASLEEP', '#5794F2'],
    ['screen-sleep', false, 'SCREEN DARK (UNEXPECTED)', '#FF9830'],
    ['system-down', true, 'SYSTEM DOWN (PLANNED)', '#B877D9'],
    ['app-stopped', true, 'APP STOPPED', '#2BA08C'],
    ['app-stopped', false, 'APP STOPPED', '#FF9830'],
    [undefined, false, 'PAUSED', '#FF9830'],
    ['expired', true, 'NO DATA', undefined],
    ['maintenance', undefined, 'PAUSED', undefined],
  ])('reason %p, intended %p → %p in %p', (reason, intended, label, color) => {
    expect(reasonDisplay(reason, intended)).toEqual(color ? { label, color } : { label });
  });

  test('labelPauses labels a history\'s declared pauses and leaves the rest', () => {
    const decl = { history: [{ since: 0, cadence: 60000 }, { since: 1, paused: true, reason: 'quiet' }, { since: 2, paused: true, label: 'Own' }] };
    expect(labelPauses(decl).history).toEqual([
      { since: 0, cadence: 60000 },
      { since: 1, paused: true, reason: 'quiet', label: 'QUIET HOURS' },
      { since: 2, paused: true, label: 'Own' },
    ]);
  });
});

describe('clearPauseClasses', () => {
  test('clears the pause classes and colour, and leaves the rest alone', () => {
    const el = document.createElement('div');
    el.className = 'mag gap';
    addPauseClasses(el, { label: 'x', color: '#f00' });
    expect(el.className).toBe('mag gap paused tinted');
    expect(el.style.getPropertyValue('--ktl-band')).toBe('#f00');
    clearPauseClasses(el);
    expect(el.className).toBe('mag gap');
    expect(el.style.getPropertyValue('--ktl-band')).toBe('');
    expect(PAUSE_CLASSES).toEqual(['paused', 'tinted']);
  });
});
