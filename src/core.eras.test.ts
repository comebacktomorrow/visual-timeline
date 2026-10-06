import { clearPauseClasses, erasFor, pauseInfo, PAUSE_CLASSES } from './core';

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
    const eras = erasFor({ cadence: 60e3, history }, { from: cutoff - 600e3, to: cutoff + 600e3 });
    expect(eras.map((e) => [e.from, e.to, e.paused, e.reason])).toEqual([
      [cutoff - 600e3, cutoff, true, 'expired'],
      [cutoff, cutoff + 600e3, false, undefined],
    ]);
    expect(pauseInfo(eras[0]).label).toBe('NO DATA');
  });
});

describe('pauseInfo', () => {
  test.each([
    [undefined, true, 'PAUSED', ['paused']],
    ['quiet', true, 'QUIET HOURS', ['paused', 'r-quiet']],
    ['screen-sleep', true, 'SCREEN ASLEEP', ['paused', 'r-screen-sleep']],
    ['screen-sleep', false, 'SCREEN DARK (UNEXPECTED)', ['paused', 'r-screen-sleep', 'unintended']],
    ['system-down', true, 'SYSTEM DOWN (PLANNED)', ['paused', 'r-system-down']],
    ['app-stopped', true, 'APP STOPPED', ['paused', 'r-app-stopped']],
    ['app-stopped', false, 'APP STOPPED', ['paused', 'r-app-stopped', 'unintended']],
    [undefined, false, 'PAUSED', ['paused', 'unintended']],
    ['expired', true, 'NO DATA', ['paused', 'r-expired']],
  ])('reason %p, intended %p → %p', (reason, intended, label, classes) => {
    expect(pauseInfo({ paused: true, reason, intended })).toEqual({ label, classes });
  });

  test('only intended === false is unintended (undefined intent is not)', () => {
    expect(pauseInfo({ reason: 'quiet' }).classes).not.toContain('unintended');
    expect(pauseInfo({ reason: 'quiet', intended: null }).classes).not.toContain('unintended');
  });

  test('a missing slot reads as a plain pause', () => {
    expect(pauseInfo(null)).toEqual({ label: 'PAUSED', classes: ['paused'] });
    expect(pauseInfo(undefined)).toEqual({ label: 'PAUSED', classes: ['paused'] });
  });

  test('every class for a known reason is one the cursor knows how to clear', () => {
    for (const reason of [undefined, 'quiet', 'screen-sleep', 'system-down', 'app-stopped', 'expired']) {
      for (const intended of [true, false]) {
        for (const c of pauseInfo({ reason, intended }).classes) {
          expect(PAUSE_CLASSES).toContain(c);
        }
      }
    }
  });

  test('an unknown reason labels as PAUSED but still adds an r-<reason> class', () => {
    // PAUSE_CLASSES cannot list it; clearPauseClasses (below) clears it anyway
    const info = pauseInfo({ reason: 'maintenance' });
    expect(info).toEqual({ label: 'PAUSED', classes: ['paused', 'r-maintenance'] });
    expect(PAUSE_CLASSES).not.toContain('r-maintenance');
  });
});

describe('clearPauseClasses', () => {
  test('clears an unknown reason’s r-<reason> class too (#65 regression)', () => {
    // setCursor and the grid used to clear only PAUSE_CLASSES, so
    // "r-maintenance" stuck to the magnifier/header after the cursor left
    // the band
    const el = document.createElement('div');
    el.className = 'mag gap';
    el.classList.add(...pauseInfo({ reason: 'maintenance', intended: false }).classes);
    expect(el.className).toBe('mag gap paused r-maintenance unintended');
    clearPauseClasses(el);
    expect(el.className).toBe('mag gap');
  });

  test('clears every known pause class and leaves the rest alone', () => {
    const el = document.createElement('div');
    el.className = 'ft stale ' + PAUSE_CLASSES.join(' ');
    clearPauseClasses(el);
    expect(el.className).toBe('ft stale');
  });
});
