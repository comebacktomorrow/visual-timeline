/// <reference types="node" />
import { runInThisContext } from 'vm';
import {
  alignedStart,
  axisTicks,
  fmtShort,
  fmtTime,
  kindFormat,
  nextTick,
  pickTickStep,
  resolveTimeZone,
  tickFormat,
  tickKind,
  TICK_STEPS,
  zonedParts,
  zonedTime,
} from './core';
import type { TickKind } from './vt/time/ticks';

/* Time-axis ticks: calendar alignment (alignedStart), stepping (nextTick),
 * the tick list buildAxis renders (axisTicks) and per-tier labels
 * (tickFormat), all in a time zone passed as the last argument. Most blocks
 * pass the zone explicitly and run under two different process zones, to
 * show the result does not depend on the machine's zone. A few blocks leave
 * the zone out: that is the browser-default path, which follows the process
 * zone. */

/* jest.config.js forces TZ=UTC for the run, and a test file's
 * `process.env` is a sandboxed copy, so assigning TZ there does nothing.
 * Node only re-reads the zone when the REAL process.env.TZ is assigned; that
 * object lives in the main context, reachable through vm.runInThisContext. */
const realEnv: NodeJS.ProcessEnv = runInThisContext('process').env;

function useTimeZone(tz: string) {
  let saved: string | undefined;
  beforeAll(() => {
    saved = realEnv.TZ;
    realEnv.TZ = tz;
  });
  afterAll(() => {
    realEnv.TZ = saved;
  });
}

const at = (iso: string) => Date.parse(iso);
const MIN = 60e3;
const HOUR = 3600e3;
const DAY = 86400e3;
const iso = (ts: number) => new Date(ts).toISOString();
const isoList = (list: number[]) => list.map(iso);
/* Each label style's text in a zone. These blocks name the style by the
 * step that used to select it: HH:mm under an hour, a dated HH:mm under a
 * day, a date under a year, then the year. Which style an axis actually
 * uses depends on its range too (Grafana's rule): see 'label tiers'. */
const styleFor = (step: number): TickKind =>
  step < HOUR ? 'minute' : step < DAY ? 'hour' : step < 365 * DAY ? 'day' : 'year';
const tierFormat = (step: number, tz?: string) => kindFormat(styleFor(step), tz);
const labels = (list: number[], step: number, tz?: string) => list.map(tierFormat(step, tz));

/* every instant in [from, to] (minute resolution) whose wall clock in `tz`
 * is on the step's grid: the brute-force definition axisTicks must match */
function bruteTicks(from: number, to: number, step: number, tz: string) {
  const out: number[] = [];
  const stepMin = step / MIN;
  for (let t = Math.ceil(from / MIN) * MIN; t <= to; t += MIN) {
    const p = zonedParts(t, tz);
    if (p.second === 0 && (p.hour * 60 + p.minute) % stepMin === 0) {
      out.push(t);
    }
  }
  return out;
}

/* ---------------- browser default: the zone follows the process ---------------- */

describe('browser default, process zone UTC (the jest default)', () => {
  test('the zone is really UTC', () => {
    expect(new Date(at('2026-01-15T12:00:00Z')).getTimezoneOffset()).toBe(0);
    expect(resolveTimeZone(undefined)).toBe('UTC');
  });

  test('alignedStart snaps down to the step’s calendar unit', () => {
    const ts = at('2026-07-15T13:47:31.250Z');
    expect(iso(alignedStart(ts, 60e3))).toBe('2026-07-15T13:47:00.000Z');
    expect(iso(alignedStart(ts, 5 * 60e3))).toBe('2026-07-15T13:45:00.000Z');
    expect(iso(alignedStart(ts, 15 * 60e3))).toBe('2026-07-15T13:45:00.000Z');
    expect(iso(alignedStart(ts, 30 * 60e3))).toBe('2026-07-15T13:30:00.000Z');
    expect(iso(alignedStart(ts, HOUR))).toBe('2026-07-15T13:00:00.000Z');
    expect(iso(alignedStart(ts, 3 * HOUR))).toBe('2026-07-15T12:00:00.000Z');
    expect(iso(alignedStart(ts, 6 * HOUR))).toBe('2026-07-15T12:00:00.000Z');
    expect(iso(alignedStart(ts, 12 * HOUR))).toBe('2026-07-15T12:00:00.000Z');
    expect(iso(alignedStart(ts, DAY))).toBe('2026-07-15T00:00:00.000Z');
    expect(iso(alignedStart(ts, 7 * DAY))).toBe('2026-07-15T00:00:00.000Z');
    expect(iso(alignedStart(ts, 30 * DAY))).toBe('2026-07-01T00:00:00.000Z');
    // calendar quarter and year (#65): July is a quarter start; the year starts 1 January
    expect(iso(alignedStart(ts, 90 * DAY))).toBe('2026-07-01T00:00:00.000Z');
    expect(iso(alignedStart(at('2026-05-15T00:00:00Z'), 90 * DAY))).toBe('2026-04-01T00:00:00.000Z');
    expect(iso(alignedStart(ts, 365 * DAY))).toBe('2026-01-01T00:00:00.000Z');
  });

  test('for every tick step, alignedStart is at or before the timestamp and nextTick is after it', () => {
    const ts = at('2026-02-28T23:59:59.999Z');
    for (const step of TICK_STEPS) {
      const a = alignedStart(ts, step);
      expect(typeof a).toBe('number');
      expect(a).toBeLessThanOrEqual(ts);
      expect(nextTick(a, step)).toBeGreaterThan(a);
    }
  });

  test('nextTick: the next grid instant below a day, calendar days, then months', () => {
    expect(iso(nextTick(at('2026-01-31T00:00:00Z'), 15 * 60e3))).toBe('2026-01-31T00:15:00.000Z');
    // from between grid points: the next one, not ts + step
    expect(iso(nextTick(at('2026-01-31T00:07:00Z'), 15 * 60e3))).toBe('2026-01-31T00:15:00.000Z');
    expect(iso(nextTick(at('2026-01-31T00:00:00Z'), 2 * DAY))).toBe('2026-02-02T00:00:00.000Z');
    expect(iso(nextTick(at('2026-01-01T00:00:00Z'), 30 * DAY))).toBe('2026-02-01T00:00:00.000Z');
    expect(iso(nextTick(at('2026-01-31T00:00:00Z'), 30 * DAY))).toBe('2026-02-01T00:00:00.000Z');
    expect(iso(nextTick(at('2026-01-01T00:00:00Z'), 90 * DAY))).toBe('2026-04-01T00:00:00.000Z');
    expect(iso(nextTick(at('2026-02-01T00:00:00Z'), 90 * DAY))).toBe('2026-04-01T00:00:00.000Z');
    expect(iso(nextTick(at('2026-01-01T00:00:00Z'), 365 * DAY))).toBe('2027-01-01T00:00:00.000Z');
    expect(iso(nextTick(at('2026-03-01T00:00:00Z'), 365 * DAY))).toBe('2027-01-01T00:00:00.000Z');
  });

  test('axisTicks: first tick at or after `from`, last at or before `to`, both ends inclusive', () => {
    const list = axisTicks(at('2026-07-15T13:47:00Z'), at('2026-07-15T14:15:00Z'), 5 * 60e3);
    expect(labels(list, 5 * 60e3)).toEqual(['13:50', '13:55', '14:00', '14:05', '14:10', '14:15']);
    expect(axisTicks(at('2026-07-15T14:00:00Z'), at('2026-07-15T14:00:00Z'), HOUR)).toEqual([
      at('2026-07-15T14:00:00Z'),
    ]);
    expect(axisTicks(at('2026-07-15T14:01:00Z'), at('2026-07-15T14:59:00Z'), HOUR)).toEqual([]);
  });

  test('month-scale steps land on the 1st of each month across 28/30/31-day months', () => {
    const list = axisTicks(at('2026-01-15T00:00:00Z'), at('2026-05-20T00:00:00Z'), 30 * DAY);
    expect(isoList(list)).toEqual([
      '2026-02-01T00:00:00.000Z',
      '2026-03-01T00:00:00.000Z',
      '2026-04-01T00:00:00.000Z',
      '2026-05-01T00:00:00.000Z',
    ]);
    expect(labels(list, 30 * DAY)).toEqual(['01/02', '01/03', '01/04', '01/05']);
  });

  test('90-day steps are calendar quarters (Jan/Apr/Jul/Oct), whatever month the window starts in', () => {
    // #65: used to count from the window's first month (May, Aug, Nov)
    const list = axisTicks(at('2026-02-15T00:00:00Z'), at('2026-12-31T00:00:00Z'), 90 * DAY);
    expect(isoList(list)).toEqual(['2026-04-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z']);
    expect(labels(list, 90 * DAY)).toEqual(['01/04', '01/07', '01/10']);
  });

  test('year steps sit on 1 January, whatever month the window starts in', () => {
    // #65: used to sit on the 1st of the window's first month (1 March here)
    const list = axisTicks(at('2026-03-15T00:00:00Z'), at('2028-12-31T00:00:00Z'), 365 * DAY);
    expect(isoList(list)).toEqual(['2027-01-01T00:00:00.000Z', '2028-01-01T00:00:00.000Z']);
    expect(labels(list, 365 * DAY)).toEqual(['2027', '2028']);
  });

  test('tickFormat picks one label format per zoom tier', () => {
    const ts = at('2026-07-05T09:07:00Z');
    expect(tierFormat(60e3)(ts)).toBe('09:07');
    expect(tierFormat(30 * 60e3)(ts)).toBe('09:07');
    expect(tierFormat(HOUR)(ts)).toBe('05/07, 09:07');
    expect(tierFormat(12 * HOUR)(ts)).toBe('05/07, 09:07');
    expect(tierFormat(DAY)(ts)).toBe('05/07');
    expect(tierFormat(90 * DAY)(ts)).toBe('05/07');
    expect(tierFormat(365 * DAY)(ts)).toBe('2026');
  });

  test('midnight reads 00:00, never 24:00', () => {
    const midnight = at('2026-07-05T00:00:00Z');
    expect(tierFormat(60e3)(midnight)).toBe('00:00');
    expect(tierFormat(HOUR)(midnight)).toBe('05/07, 00:00');
    expect(fmtTime(midnight)).toBe('00:00:00');
  });
});

describe('browser default, process zone America/New_York', () => {
  useTimeZone('America/New_York');

  test('the zone is really New York, and an omitted zone resolves to it', () => {
    expect(new Date(at('2026-01-15T12:00:00Z')).getTimezoneOffset()).toBe(300);
    expect(new Date(at('2026-07-15T12:00:00Z')).getTimezoneOffset()).toBe(240);
    for (const tz of [undefined, '', 'browser', 'default']) {
      expect(resolveTimeZone(tz)).toBe('America/New_York');
    }
  });

  test('hourly ticks across both 2026 changes: the skipped 02:00 has none, the repeated 01:00 has two', () => {
    const spring = axisTicks(at('2026-03-08T00:00:00-05:00'), at('2026-03-08T05:00:00-04:00'), HOUR);
    expect(labels(spring, HOUR)).toEqual(['08/03, 00:00', '08/03, 01:00', '08/03, 03:00', '08/03, 04:00', '08/03, 05:00']);
    const fall = axisTicks(at('2026-11-01T00:00:00-04:00'), at('2026-11-01T03:00:00-05:00'), HOUR);
    expect(fall).toEqual([
      at('2026-11-01T00:00:00-04:00'),
      at('2026-11-01T01:00:00-04:00'),
      at('2026-11-01T01:00:00-05:00'),
      at('2026-11-01T02:00:00-05:00'),
      at('2026-11-01T03:00:00-05:00'),
    ]);
  });

  test('2-hourly ticks stay on even local hours after spring-forward (#65 regression)', () => {
    // used to drift to 03:00, 05:00, 07:00: sub-day steps advanced by raw ms
    const list = axisTicks(at('2026-03-07T23:00:00-05:00'), at('2026-03-08T08:00:00-04:00'), 2 * HOUR);
    expect(labels(list, 2 * HOUR)).toEqual(['08/03, 00:00', '08/03, 04:00', '08/03, 06:00', '08/03, 08:00']);
  });

  test('labels are the same text the old toLocale* calls produced', () => {
    const samples = [
      at('2026-01-05T00:00:00Z'),
      at('2026-03-08T06:59:59Z'),
      at('2026-03-08T07:00:00Z'),
      at('2026-07-15T13:47:31.250Z'),
      at('2026-11-01T05:30:00Z'),
      at('2026-11-01T06:30:00Z'),
      at('2026-12-31T23:59:59Z'),
    ];
    for (const ts of samples) {
      const d = new Date(ts);
      expect(fmtTime(ts)).toBe(d.toLocaleTimeString('en-AU', { hour12: false }));
      expect(fmtShort(ts)).toBe(d.toLocaleTimeString('en-AU', { hour12: false, hour: '2-digit', minute: '2-digit' }));
      expect(tierFormat(HOUR)(ts)).toBe(
        d.toLocaleString('en-AU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
      );
      expect(tierFormat(DAY)(ts)).toBe(d.toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit' }));
      expect(tierFormat(365 * DAY)(ts)).toBe(String(d.getFullYear()));
    }
  });
});

describe('browser default, process zone Australia/Lord_Howe', () => {
  useTimeZone('Australia/Lord_Howe');

  test('hourly ticks stay on :00 across the 30-minute spring-forward (#65 regression)', () => {
    // used to drift to 02:30, 03:30, 04:30 after the half-hour shift
    const list = axisTicks(at('2026-10-04T00:00:00+10:30'), at('2026-10-04T04:30:00+11:00'), HOUR);
    expect(labels(list, HOUR)).toEqual(['04/10, 00:00', '04/10, 01:00', '04/10, 03:00', '04/10, 04:00']);
  });
});

/* ---------------- explicit zones: independent of the process zone ---------------- */

describe.each(['UTC', 'Asia/Tokyo'])('explicit zones (process zone %s)', (processZone) => {
  useTimeZone(processZone);

  describe('UTC', () => {
    test("'utc' in any case resolves to UTC", () => {
      expect(resolveTimeZone('utc')).toBe('UTC');
      expect(resolveTimeZone('UTC')).toBe('UTC');
    });

    test('ticks and labels are UTC', () => {
      const list = axisTicks(at('2026-07-15T13:47:00Z'), at('2026-07-15T18:00:00Z'), HOUR, 'utc');
      expect(isoList(list)).toEqual([
        '2026-07-15T14:00:00.000Z',
        '2026-07-15T15:00:00.000Z',
        '2026-07-15T16:00:00.000Z',
        '2026-07-15T17:00:00.000Z',
        '2026-07-15T18:00:00.000Z',
      ]);
      expect(labels(list, HOUR, 'utc')).toEqual(['15/07, 14:00', '15/07, 15:00', '15/07, 16:00', '15/07, 17:00', '15/07, 18:00']);
      expect(fmtTime(at('2026-07-15T13:47:31Z'), 'utc')).toBe('13:47:31');
      expect(fmtShort(at('2026-07-15T00:05:00Z'), 'utc')).toBe('00:05');
    });

    test('year and quarter ticks are on 1 January and Jan/Apr/Jul/Oct', () => {
      expect(isoList(axisTicks(at('2025-08-20T00:00:00Z'), at('2027-02-01T00:00:00Z'), 365 * DAY, 'UTC'))).toEqual([
        '2026-01-01T00:00:00.000Z',
        '2027-01-01T00:00:00.000Z',
      ]);
      expect(isoList(axisTicks(at('2025-11-20T00:00:00Z'), at('2026-08-01T00:00:00Z'), 90 * DAY, 'UTC'))).toEqual([
        '2026-01-01T00:00:00.000Z',
        '2026-04-01T00:00:00.000Z',
        '2026-07-01T00:00:00.000Z',
      ]);
    });
  });

  describe('America/New_York (DST: 2026-03-08 02:00 → 03:00, 2026-11-01 02:00 → 01:00)', () => {
    const NY = 'America/New_York';

    test('alignedStart snaps to the zone’s boundaries, not UTC or process ones', () => {
      const ts = at('2026-07-15T13:47:00-04:00');
      expect(alignedStart(ts, HOUR, NY)).toBe(at('2026-07-15T13:00:00-04:00'));
      expect(alignedStart(ts, 6 * HOUR, NY)).toBe(at('2026-07-15T12:00:00-04:00'));
      expect(alignedStart(ts, DAY, NY)).toBe(at('2026-07-15T00:00:00-04:00'));
      expect(alignedStart(ts, 30 * DAY, NY)).toBe(at('2026-07-01T00:00:00-04:00'));
      expect(alignedStart(ts, 90 * DAY, NY)).toBe(at('2026-07-01T00:00:00-04:00'));
      expect(alignedStart(ts, 365 * DAY, NY)).toBe(at('2026-01-01T00:00:00-05:00'));
    });

    test('hourly ticks across spring-forward skip the missing 02:00', () => {
      const list = axisTicks(at('2026-03-08T00:00:00-05:00'), at('2026-03-08T05:00:00-04:00'), HOUR, NY);
      expect(list).toEqual([
        at('2026-03-08T00:00:00-05:00'),
        at('2026-03-08T01:00:00-05:00'),
        at('2026-03-08T03:00:00-04:00'),
        at('2026-03-08T04:00:00-04:00'),
        at('2026-03-08T05:00:00-04:00'),
      ]);
      expect(labels(list, HOUR, NY)).toEqual(['08/03, 00:00', '08/03, 01:00', '08/03, 03:00', '08/03, 04:00', '08/03, 05:00']);
    });

    test('hourly ticks across fall-back repeat 01:00', () => {
      const list = axisTicks(at('2026-11-01T00:00:00-04:00'), at('2026-11-01T03:00:00-05:00'), HOUR, NY);
      expect(list).toEqual([
        at('2026-11-01T00:00:00-04:00'),
        at('2026-11-01T01:00:00-04:00'),
        at('2026-11-01T01:00:00-05:00'),
        at('2026-11-01T02:00:00-05:00'),
        at('2026-11-01T03:00:00-05:00'),
      ]);
      expect(labels(list, HOUR, NY)).toEqual(['01/11, 00:00', '01/11, 01:00', '01/11, 01:00', '01/11, 02:00', '01/11, 03:00']);
    });

    test('2-hourly ticks stay on even local hours across spring-forward (#65 regression)', () => {
      const list = axisTicks(at('2026-03-07T23:00:00-05:00'), at('2026-03-08T08:00:00-04:00'), 2 * HOUR, NY);
      expect(list).toEqual([
        at('2026-03-08T00:00:00-05:00'),
        at('2026-03-08T04:00:00-04:00'), // 02:00 does not exist; 00:00 → 04:00 is 3 real hours
        at('2026-03-08T06:00:00-04:00'),
        at('2026-03-08T08:00:00-04:00'),
      ]);
      expect(labels(list, 2 * HOUR, NY)).toEqual(['08/03, 00:00', '08/03, 04:00', '08/03, 06:00', '08/03, 08:00']);
    });

    test('2-hourly ticks stay on even local hours across fall-back (#65 regression)', () => {
      const list = axisTicks(at('2026-10-31T23:00:00-04:00'), at('2026-11-01T06:00:00-05:00'), 2 * HOUR, NY);
      expect(list).toEqual([
        at('2026-11-01T00:00:00-04:00'),
        at('2026-11-01T02:00:00-05:00'), // 3 real hours: 01:00 happened twice
        at('2026-11-01T04:00:00-05:00'),
        at('2026-11-01T06:00:00-05:00'),
      ]);
      expect(labels(list, 2 * HOUR, NY)).toEqual(['01/11, 00:00', '01/11, 02:00', '01/11, 04:00', '01/11, 06:00']);
    });

    test('30-minute ticks run on through the repeated hour, both times', () => {
      const list = axisTicks(at('2026-11-01T00:45:00-04:00'), at('2026-11-01T02:00:00-05:00'), 30 * MIN, NY);
      expect(labels(list, 30 * MIN, NY)).toEqual(['01:00', '01:30', '01:00', '01:30', '02:00']);
      expect(list.slice(1).map((t, i) => t - list[i])).toEqual([30 * MIN, 30 * MIN, 30 * MIN, 30 * MIN]);
    });

    test('daily ticks stay on local midnight across both changes (23 h and 25 h days)', () => {
      const spring = axisTicks(at('2026-03-06T12:00:00-05:00'), at('2026-03-10T12:00:00-04:00'), DAY, NY);
      expect(spring).toEqual([
        at('2026-03-07T00:00:00-05:00'),
        at('2026-03-08T00:00:00-05:00'),
        at('2026-03-09T00:00:00-04:00'),
        at('2026-03-10T00:00:00-04:00'),
      ]);
      expect(spring[2] - spring[1]).toBe(23 * HOUR);
      expect(labels(spring, DAY, NY)).toEqual(['07/03', '08/03', '09/03', '10/03']);

      const fall = axisTicks(at('2026-10-31T12:00:00-04:00'), at('2026-11-02T12:00:00-05:00'), DAY, NY);
      expect(fall).toEqual([at('2026-11-01T00:00:00-04:00'), at('2026-11-02T00:00:00-05:00')]);
      expect(fall[1] - fall[0]).toBe(25 * HOUR);
      expect(labels(fall, DAY, NY)).toEqual(['01/11', '02/11']);
    });

    test('month, quarter and year ticks sit on local midnight of the 1st across DST', () => {
      expect(axisTicks(at('2026-02-15T00:00:00-05:00'), at('2026-04-15T00:00:00-04:00'), 30 * DAY, NY)).toEqual([
        at('2026-03-01T00:00:00-05:00'),
        at('2026-04-01T00:00:00-04:00'),
      ]);
      expect(axisTicks(at('2026-02-15T00:00:00-05:00'), at('2026-12-31T00:00:00-05:00'), 90 * DAY, NY)).toEqual([
        at('2026-04-01T00:00:00-04:00'),
        at('2026-07-01T00:00:00-04:00'),
        at('2026-10-01T00:00:00-04:00'),
      ]);
      const years = axisTicks(at('2026-03-15T00:00:00-04:00'), at('2028-12-31T00:00:00-05:00'), 365 * DAY, NY);
      expect(years).toEqual([at('2027-01-01T00:00:00-05:00'), at('2028-01-01T00:00:00-05:00')]);
      // 05:00 UTC on 1 January: still "2027" in New York, whatever the process zone says
      expect(labels(years, 365 * DAY, NY)).toEqual(['2027', '2028']);
      expect(tierFormat(365 * DAY, NY)(at('2027-01-01T03:00:00Z'))).toBe('2026');
    });

    test('alignedStart inside the spring-forward gap is the last real grid instant before it', () => {
      // 2-hour grid at 03:30 EDT: 02:00 never happened that day, so the
      // last instant at or before 03:30 whose clock read an even hour is 00:00
      expect(alignedStart(at('2026-03-08T03:30:00-04:00'), 2 * HOUR, NY)).toBe(at('2026-03-08T00:00:00-05:00'));
      expect(alignedStart(at('2026-03-08T03:30:00-04:00'), HOUR, NY)).toBe(at('2026-03-08T03:00:00-04:00'));
    });

    test('alignedStart in the repeated fall-back hour picks the 01:00 of the same run', () => {
      // 01:30 EST (the second 01:30): the last 01:00 at or before it is 01:00 EST
      const ts = at('2026-11-01T01:30:00-05:00');
      expect(alignedStart(ts, HOUR, NY)).toBe(at('2026-11-01T01:00:00-05:00'));
      expect(alignedStart(at('2026-11-01T01:30:00-04:00'), HOUR, NY)).toBe(at('2026-11-01T01:00:00-04:00'));
      expect(axisTicks(ts, at('2026-11-01T03:00:00-05:00'), HOUR, NY)).toEqual([
        at('2026-11-01T02:00:00-05:00'),
        at('2026-11-01T03:00:00-05:00'),
      ]);
    });

    test('every sub-day step matches the brute-force wall-clock grid over both change days', () => {
      const days = [
        [at('2026-03-07T22:00:00-05:00'), at('2026-03-08T06:00:00-04:00')],
        [at('2026-10-31T22:00:00-04:00'), at('2026-11-01T06:00:00-05:00')],
      ];
      for (const [from, to] of days) {
        for (const step of TICK_STEPS.filter((s) => s < DAY && s >= 5 * MIN)) {
          expect([step, axisTicks(from, to, step, NY)]).toEqual([step, bruteTicks(from, to, step, NY)]);
        }
      }
    });

    test('labels per tier are New York time', () => {
      const ts = at('2026-07-05T01:07:09Z'); // 4 July, 21:07:09 EDT
      expect(fmtTime(ts, NY)).toBe('21:07:09');
      expect(fmtShort(ts, NY)).toBe('21:07');
      expect(tierFormat(MIN, NY)(ts)).toBe('21:07');
      expect(tierFormat(HOUR, NY)(ts)).toBe('04/07, 21:07');
      expect(tierFormat(DAY, NY)(ts)).toBe('04/07');
      expect(tierFormat(30 * DAY, NY)(ts)).toBe('04/07');
      expect(tierFormat(365 * DAY, NY)(ts)).toBe('2026');
    });
  });

  describe('Europe/London (DST: 2026-03-29 01:00 → 02:00, 2026-10-25 02:00 → 01:00)', () => {
    const LON = 'Europe/London';

    test('15-minute ticks across spring-forward', () => {
      const list = axisTicks(at('2026-03-29T00:30:00Z'), at('2026-03-29T02:30:00+01:00'), 15 * MIN, LON);
      expect(labels(list, 15 * MIN, LON)).toEqual(['00:30', '00:45', '02:00', '02:15', '02:30']);
      expect(list[2] - list[1]).toBe(15 * MIN);
    });

    test('hourly ticks across fall-back repeat 01:00', () => {
      const list = axisTicks(at('2026-10-25T00:00:00+01:00'), at('2026-10-25T02:00:00Z'), HOUR, LON);
      expect(isoList(list)).toEqual([
        '2026-10-24T23:00:00.000Z',
        '2026-10-25T00:00:00.000Z',
        '2026-10-25T01:00:00.000Z',
        '2026-10-25T02:00:00.000Z',
      ]);
      expect(labels(list, HOUR, LON)).toEqual(['25/10, 00:00', '25/10, 01:00', '25/10, 01:00', '25/10, 02:00']);
    });

    test('daily ticks across fall-back stay on local midnight', () => {
      const list = axisTicks(at('2026-10-24T12:00:00+01:00'), at('2026-10-26T12:00:00Z'), DAY, LON);
      expect(list).toEqual([at('2026-10-25T00:00:00+01:00'), at('2026-10-26T00:00:00Z')]);
      expect(list[1] - list[0]).toBe(25 * HOUR);
    });
  });

  describe('Asia/Kolkata (UTC+05:30, no DST)', () => {
    const IN = 'Asia/Kolkata';

    test('hourly ticks land on local :00, i.e. UTC :30', () => {
      const list = axisTicks(at('2026-07-01T00:10:00Z'), at('2026-07-01T03:00:00Z'), HOUR, IN);
      expect(isoList(list)).toEqual(['2026-07-01T00:30:00.000Z', '2026-07-01T01:30:00.000Z', '2026-07-01T02:30:00.000Z']);
      expect(labels(list, HOUR, IN)).toEqual(['01/07, 06:00', '01/07, 07:00', '01/07, 08:00']);
    });

    test('daily ticks land on local midnight (18:30 UTC the day before)', () => {
      const list = axisTicks(at('2026-07-01T00:00:00Z'), at('2026-07-03T00:00:00Z'), DAY, IN);
      expect(isoList(list)).toEqual(['2026-07-01T18:30:00.000Z', '2026-07-02T18:30:00.000Z']);
      expect(labels(list, DAY, IN)).toEqual(['02/07', '03/07']);
    });

    test('year ticks land on local 1 January (18:30 UTC on 31 December)', () => {
      const list = axisTicks(at('2026-06-01T00:00:00Z'), at('2027-06-01T00:00:00Z'), 365 * DAY, IN);
      expect(isoList(list)).toEqual(['2026-12-31T18:30:00.000Z']);
      expect(labels(list, 365 * DAY, IN)).toEqual(['2027']);
    });

    test('labels per tier are Kolkata time', () => {
      const ts = at('2026-12-31T20:15:42Z'); // 1 January 2027, 01:45:42 IST
      expect(fmtTime(ts, IN)).toBe('01:45:42');
      expect(fmtShort(ts, IN)).toBe('01:45');
      expect(tierFormat(5 * MIN, IN)(ts)).toBe('01:45');
      expect(tierFormat(3 * HOUR, IN)(ts)).toBe('01/01, 01:45');
      expect(tierFormat(7 * DAY, IN)(ts)).toBe('01/01');
      expect(tierFormat(365 * DAY, IN)(ts)).toBe('2027');
    });
  });

  describe('Asia/Kathmandu (UTC+05:45, no DST)', () => {
    test('30-minute ticks land on local :00/:30, i.e. UTC :15/:45', () => {
      const list = axisTicks(at('2026-07-01T00:00:00Z'), at('2026-07-01T01:30:00Z'), 30 * MIN, 'Asia/Kathmandu');
      expect(isoList(list)).toEqual(['2026-07-01T00:15:00.000Z', '2026-07-01T00:45:00.000Z', '2026-07-01T01:15:00.000Z']);
      expect(labels(list, 30 * MIN, 'Asia/Kathmandu')).toEqual(['06:00', '06:30', '07:00']);
    });
  });

  describe('Australia/Adelaide (UTC+09:30/+10:30; DST: 2026-10-04 02:00 → 03:00)', () => {
    const ADL = 'Australia/Adelaide';

    test('hourly ticks stay on local :00 across spring-forward', () => {
      const list = axisTicks(at('2026-10-04T00:00:00+09:30'), at('2026-10-04T05:00:00+10:30'), HOUR, ADL);
      expect(labels(list, HOUR, ADL)).toEqual(['04/10, 00:00', '04/10, 01:00', '04/10, 03:00', '04/10, 04:00', '04/10, 05:00']);
    });

    test('daily ticks stay on local midnight across spring-forward (a 23 h day)', () => {
      const list = axisTicks(at('2026-10-03T12:00:00+09:30'), at('2026-10-05T12:00:00+10:30'), DAY, ADL);
      expect(list).toEqual([at('2026-10-04T00:00:00+09:30'), at('2026-10-05T00:00:00+10:30')]);
      expect(list[1] - list[0]).toBe(23 * HOUR);
    });
  });

  describe('Australia/Lord_Howe (UTC+10:30/+11; 30-minute shifts: 2026-04-05 02:00 → 01:30, 2026-10-04 02:00 → 02:30)', () => {
    const LH = 'Australia/Lord_Howe';

    test('hourly ticks stay on :00 across the half-hour spring-forward (#65 regression)', () => {
      // used to drift to 02:30, 03:30, 04:30
      const list = axisTicks(at('2026-10-04T00:00:00+10:30'), at('2026-10-04T04:30:00+11:00'), HOUR, LH);
      expect(list).toEqual([
        at('2026-10-04T00:00:00+10:30'),
        at('2026-10-04T01:00:00+10:30'),
        at('2026-10-04T03:00:00+11:00'), // 02:00 → 02:30 skipped 02:00
        at('2026-10-04T04:00:00+11:00'),
      ]);
      expect(labels(list, HOUR, LH)).toEqual(['04/10, 00:00', '04/10, 01:00', '04/10, 03:00', '04/10, 04:00']);
    });

    test('hourly ticks stay on :00 across the half-hour fall-back', () => {
      const list = axisTicks(at('2026-04-05T00:00:00+11:00'), at('2026-04-05T03:00:00+10:30'), HOUR, LH);
      expect(list).toEqual([
        at('2026-04-05T00:00:00+11:00'),
        at('2026-04-05T01:00:00+11:00'),
        at('2026-04-05T02:00:00+10:30'), // 1.5 real hours: 01:30–02:00 happened twice
        at('2026-04-05T03:00:00+10:30'),
      ]);
      expect(labels(list, HOUR, LH)).toEqual(['05/04, 00:00', '05/04, 01:00', '05/04, 02:00', '05/04, 03:00']);
    });

    test('30-minute ticks show the repeated 01:30 twice', () => {
      const list = axisTicks(at('2026-04-05T01:00:00+11:00'), at('2026-04-05T02:00:00+10:30'), 30 * MIN, LH);
      expect(labels(list, 30 * MIN, LH)).toEqual(['01:00', '01:30', '01:30', '02:00']);
    });

    test('every sub-day step matches the brute-force wall-clock grid over both change days', () => {
      const days = [
        [at('2026-04-04T22:00:00+11:00'), at('2026-04-05T06:00:00+10:30')],
        [at('2026-10-03T22:00:00+10:30'), at('2026-10-04T06:00:00+11:00')],
      ];
      for (const [from, to] of days) {
        for (const step of TICK_STEPS.filter((s) => s < DAY && s >= 5 * MIN)) {
          expect([step, axisTicks(from, to, step, LH)]).toEqual([step, bruteTicks(from, to, step, LH)]);
        }
      }
    });
  });
});

/* ---------------- wall clock ↔ instant, zone resolution, caching ---------------- */

describe('zonedParts / zonedTime', () => {
  const NY = 'America/New_York';

  test('round trip on an ordinary day', () => {
    const ts = at('2026-07-15T13:47:31.250-04:00');
    const p = zonedParts(ts, NY);
    expect(p).toEqual({ year: 2026, month: 7, day: 15, hour: 13, minute: 47, second: 31, ms: 250 });
    expect(zonedTime(p, NY)).toBe(ts);
  });

  test('a skipped wall time moves forward by the gap, as Date does', () => {
    expect(zonedTime({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, NY)).toBe(at('2026-03-08T03:30:00-04:00'));
    expect(zonedTime({ year: 2026, month: 10, day: 4, hour: 2, minute: 15 }, 'Australia/Lord_Howe')).toBe(
      at('2026-10-04T02:45:00+11:00')
    );
  });

  test('a repeated wall time resolves to the earlier instant, as Date does', () => {
    expect(zonedTime({ year: 2026, month: 11, day: 1, hour: 1, minute: 30 }, NY)).toBe(at('2026-11-01T01:30:00-04:00'));
  });

  test('the instants either side of a change keep their own offsets', () => {
    expect(zonedTime({ year: 2026, month: 3, day: 8, hour: 1, minute: 59 }, NY)).toBe(at('2026-03-08T01:59:00-05:00'));
    expect(zonedTime({ year: 2026, month: 3, day: 8, hour: 3 }, NY)).toBe(at('2026-03-08T03:00:00-04:00'));
    expect(zonedTime({ year: 2026, month: 11, day: 1, hour: 2 }, NY)).toBe(at('2026-11-01T02:00:00-05:00'));
  });
});

describe('resolveTimeZone', () => {
  test('IANA names pass through; utc is UTC', () => {
    expect(resolveTimeZone('Asia/Kolkata')).toBe('Asia/Kolkata');
    expect(resolveTimeZone(' Europe/London ')).toBe('Europe/London');
    expect(resolveTimeZone('utc')).toBe('UTC');
  });

  test('an unknown zone warns once and falls back to the browser’s', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(resolveTimeZone('Mars/Olympus_Mons')).toBe(resolveTimeZone(undefined));
    expect(resolveTimeZone('Mars/Olympus_Mons')).toBe(resolveTimeZone(undefined));
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe('formatter caching', () => {
  test('formatting and tick generation build no Intl.DateTimeFormat once a zone is warm', () => {
    const ts = at('2026-11-01T05:30:00Z');
    const warm = () => {
      for (const tz of ['UTC', 'Asia/Kolkata', 'America/New_York']) {
        fmtTime(ts, tz);
        fmtShort(ts, tz);
        for (const step of [MIN, HOUR, DAY, 365 * DAY]) {
          tierFormat(step, tz)(ts);
          axisTicks(ts - 6 * HOUR, ts + 6 * HOUR, step, tz);
        }
      }
    };
    warm();
    const spy = jest.spyOn(Intl, 'DateTimeFormat');
    for (let i = 0; i < 50; i++) {
      warm();
    }
    expect(spy).not.toHaveBeenCalled();
    // the spy does see construction: a zone not used before builds its own
    expect(fmtTime(ts, 'Pacific/Chatham')).toBe('19:15:00');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("label tiers and spacing follow Grafana's time series axis", () => {
  test('tickKind: the label depends on the step and the visible range (formatTime)', () => {
    expect(tickKind(MIN, 30 * MIN)).toBe('second');
    expect(tickKind(5 * MIN, HOUR)).toBe('minute');
    // a day or less on screen: HH:mm even with hourly ticks (the 12 h case)
    expect(tickKind(HOUR, 12 * HOUR)).toBe('minute');
    expect(tickKind(2 * HOUR, DAY)).toBe('minute');
    // more than a day: dates appear
    expect(tickKind(6 * HOUR, 2 * DAY)).toBe('hour');
    expect(tickKind(DAY, 7 * DAY)).toBe('hour');
    expect(tickKind(2 * DAY, 30 * DAY)).toBe('day');
    expect(tickKind(30 * DAY, 400 * DAY)).toBe('month');
    expect(tickKind(365 * DAY, 5 * 365 * DAY)).toBe('year');
  });

  test('tickFormat hands the tier to a host formatter (the panel passes Grafana\'s)', () => {
    const host = (ts: number, kind: TickKind) => `${kind}@${ts}`;
    expect(tickFormat(HOUR, 12 * HOUR, undefined, host)(5)).toBe('minute@5');
    expect(tickFormat(HOUR, 3 * DAY, undefined, host)(5)).toBe('hour@5');
  });

  test('built-in labels per tier', () => {
    const ts = at('2026-07-05T09:07:30Z');
    expect(tickFormat(MIN, 15 * MIN, 'UTC')(ts)).toBe('09:07:30');
    expect(tickFormat(HOUR, 12 * HOUR, 'UTC')(ts)).toBe('09:07');
    expect(tickFormat(6 * HOUR, 3 * DAY, 'UTC')(ts)).toBe('05/07, 09:07');
    expect(tickFormat(2 * DAY, 30 * DAY, 'UTC')(ts)).toBe('05/07');
    expect(tickFormat(30 * DAY, 400 * DAY, 'UTC')(ts)).toBe('2026-07');
    expect(tickFormat(365 * DAY, 5 * 365 * DAY, 'UTC')(ts)).toBe('2026');
  });

  // a fixed-width font: 7 px per character, so 'HH:mm' is 35 px
  const measure = (text: string) => text.length * 7;
  const now = at('2026-10-06T00:42:00Z');

  test('pickTickStep: smallest step that leaves label width + 18 px (calculateSpace)', () => {
    // these are the steps Grafana's own panel picked side by side at 1350 px
    expect(pickTickStep(now - 6 * HOUR, now, 1350, measure, 'UTC')).toBe(15 * MIN);
    expect(pickTickStep(now - 12 * HOUR, now, 1350, measure, 'UTC')).toBe(30 * MIN);
    // and at about 430 px
    expect(pickTickStep(now - 6 * HOUR, now, 430, measure, 'UTC')).toBe(HOUR);
    expect(pickTickStep(now - 12 * HOUR, now, 430, measure, 'UTC')).toBe(2 * HOUR);
  });

  test('pickTickStep never leaves less than a label and its gap between ticks', () => {
    for (const span of [5 * MIN, HOUR, 6 * HOUR, 12 * HOUR, DAY, 2 * DAY, 7 * DAY, 30 * DAY, 90 * DAY, 400 * DAY]) {
      for (const w of [240, 430, 800, 1350, 2400]) {
        const step = pickTickStep(now - span, now, w, measure, 'UTC');
        if (step === TICK_STEPS[TICK_STEPS.length - 1]) {continue;}
        const label = tickFormat(step, span, 'UTC')(now);
        expect((step / span) * w).toBeGreaterThanOrEqual(measure(label) + 18 - 1e-9);
      }
    }
  });
});
