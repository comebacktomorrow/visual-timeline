/// <reference types="node" />
import { runInThisContext } from 'vm';
import { alignedStart, axisTicks, nextTick, tickFormat, TICK_STEPS } from './core';

/* Time-axis ticks: calendar alignment (alignedStart), stepping (nextTick),
 * the tick list buildAxis renders (axisTicks) and per-tier labels
 * (tickFormat). All of it runs in the process's local time zone, so each
 * block below pins one zone. Pins CURRENT behaviour (safety net for #64). */

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
const HOUR = 3600e3;
const DAY = 86400e3;
const iso = (ts: number) => new Date(ts).toISOString();
const isoList = (list: number[]) => list.map(iso);
const labels = (list: number[], step: number) => list.map(tickFormat(step));

describe('UTC (the jest default)', () => {
  test('the zone is really UTC', () => {
    expect(new Date(at('2026-01-15T12:00:00Z')).getTimezoneOffset()).toBe(0);
    expect(new Date(at('2026-07-15T12:00:00Z')).getTimezoneOffset()).toBe(0);
  });

  test('alignedStart snaps down to the step’s calendar unit', () => {
    const ts = at('2026-07-15T13:47:31.250Z');
    expect(iso(+alignedStart(ts, 60e3))).toBe('2026-07-15T13:47:00.000Z');
    expect(iso(+alignedStart(ts, 5 * 60e3))).toBe('2026-07-15T13:45:00.000Z');
    expect(iso(+alignedStart(ts, 15 * 60e3))).toBe('2026-07-15T13:45:00.000Z');
    expect(iso(+alignedStart(ts, 30 * 60e3))).toBe('2026-07-15T13:30:00.000Z');
    expect(iso(+alignedStart(ts, HOUR))).toBe('2026-07-15T13:00:00.000Z');
    expect(iso(+alignedStart(ts, 3 * HOUR))).toBe('2026-07-15T12:00:00.000Z');
    expect(iso(+alignedStart(ts, 6 * HOUR))).toBe('2026-07-15T12:00:00.000Z');
    expect(iso(+alignedStart(ts, 12 * HOUR))).toBe('2026-07-15T12:00:00.000Z');
    expect(iso(+alignedStart(ts, DAY))).toBe('2026-07-15T00:00:00.000Z');
    expect(iso(+alignedStart(ts, 7 * DAY))).toBe('2026-07-15T00:00:00.000Z');
    expect(iso(+alignedStart(ts, 30 * DAY))).toBe('2026-07-01T00:00:00.000Z');
    expect(iso(+alignedStart(ts, 365 * DAY))).toBe('2026-07-01T00:00:00.000Z');
  });

  test('for every tick step, alignedStart is at or before the timestamp and returns a fresh Date', () => {
    const ts = at('2026-02-28T23:59:59.999Z');
    for (const step of TICK_STEPS) {
      const d = alignedStart(ts, step);
      expect(d).toBeInstanceOf(Date);
      expect(+d).toBeLessThanOrEqual(ts);
    }
  });

  test('nextTick advances in place: raw ms below a day, calendar days, then months', () => {
    const d = new Date(at('2026-01-31T00:00:00Z'));
    expect(nextTick(d, 15 * 60e3)).toBe(d);
    expect(iso(+d)).toBe('2026-01-31T00:15:00.000Z');
    expect(iso(+nextTick(new Date(at('2026-01-31T00:00:00Z')), 2 * DAY))).toBe('2026-02-02T00:00:00.000Z');
    expect(iso(+nextTick(new Date(at('2026-01-01T00:00:00Z')), 30 * DAY))).toBe('2026-02-01T00:00:00.000Z');
    expect(iso(+nextTick(new Date(at('2026-01-01T00:00:00Z')), 90 * DAY))).toBe('2026-04-01T00:00:00.000Z');
    expect(iso(+nextTick(new Date(at('2026-01-01T00:00:00Z')), 365 * DAY))).toBe('2027-01-01T00:00:00.000Z');
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

  test('90-day steps count quarters from the window’s first month, not calendar quarters', () => {
    const list = axisTicks(at('2026-02-15T00:00:00Z'), at('2026-12-31T00:00:00Z'), 90 * DAY);
    expect(isoList(list)).toEqual(['2026-05-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z']);
  });

  test('year steps start from the window’s first month', () => {
    // NOTE: current behaviour; looks wrong because a year tick is labelled
    // with just the year ("2027") but sits on 1 March, the month the window
    // starts in, instead of 1 January. alignedStart snaps month+ steps to the
    // 1st of the month only.
    const list = axisTicks(at('2026-03-15T00:00:00Z'), at('2028-12-31T00:00:00Z'), 365 * DAY);
    expect(isoList(list)).toEqual(['2027-03-01T00:00:00.000Z', '2028-03-01T00:00:00.000Z']);
    expect(labels(list, 365 * DAY)).toEqual(['2027', '2028']);
  });

  test('tickFormat picks one label format per zoom tier', () => {
    const ts = at('2026-07-05T09:07:00Z');
    expect(tickFormat(60e3)(ts)).toBe('09:07');
    expect(tickFormat(30 * 60e3)(ts)).toBe('09:07');
    expect(tickFormat(HOUR)(ts)).toBe('05/07, 09:07');
    expect(tickFormat(12 * HOUR)(ts)).toBe('05/07, 09:07');
    expect(tickFormat(DAY)(ts)).toBe('05/07');
    expect(tickFormat(90 * DAY)(ts)).toBe('05/07');
    expect(tickFormat(365 * DAY)(ts)).toBe('2026');
  });

  test('midnight reads 00:00, never 24:00', () => {
    const midnight = at('2026-07-05T00:00:00Z');
    expect(tickFormat(60e3)(midnight)).toBe('00:00');
    expect(tickFormat(HOUR)(midnight)).toBe('05/07, 00:00');
  });
});

describe('America/New_York (DST: 2026-03-08 02:00 → 03:00, 2026-11-01 02:00 → 01:00)', () => {
  useTimeZone('America/New_York');

  test('the zone is really New York', () => {
    expect(new Date(at('2026-01-15T12:00:00Z')).getTimezoneOffset()).toBe(300);
    expect(new Date(at('2026-07-15T12:00:00Z')).getTimezoneOffset()).toBe(240);
  });

  test('alignedStart snaps to LOCAL boundaries, not UTC ones', () => {
    const ts = at('2026-07-15T13:47:00-04:00');
    expect(+alignedStart(ts, HOUR)).toBe(at('2026-07-15T13:00:00-04:00'));
    expect(+alignedStart(ts, 6 * HOUR)).toBe(at('2026-07-15T12:00:00-04:00'));
    expect(+alignedStart(ts, DAY)).toBe(at('2026-07-15T00:00:00-04:00'));
    expect(+alignedStart(ts, 30 * DAY)).toBe(at('2026-07-01T00:00:00-04:00'));
  });

  test('hourly ticks across spring-forward skip the missing 02:00', () => {
    const list = axisTicks(at('2026-03-08T00:00:00-05:00'), at('2026-03-08T05:00:00-04:00'), HOUR);
    expect(list).toEqual([
      at('2026-03-08T00:00:00-05:00'),
      at('2026-03-08T01:00:00-05:00'),
      at('2026-03-08T03:00:00-04:00'),
      at('2026-03-08T04:00:00-04:00'),
      at('2026-03-08T05:00:00-04:00'),
    ]);
    expect(labels(list, HOUR)).toEqual([
      '08/03, 00:00',
      '08/03, 01:00',
      '08/03, 03:00',
      '08/03, 04:00',
      '08/03, 05:00',
    ]);
  });

  test('hourly ticks across fall-back repeat 01:00', () => {
    const list = axisTicks(at('2026-11-01T00:00:00-04:00'), at('2026-11-01T03:00:00-05:00'), HOUR);
    expect(list).toEqual([
      at('2026-11-01T00:00:00-04:00'),
      at('2026-11-01T01:00:00-04:00'),
      at('2026-11-01T01:00:00-05:00'),
      at('2026-11-01T02:00:00-05:00'),
      at('2026-11-01T03:00:00-05:00'),
    ]);
    expect(labels(list, HOUR)).toEqual([
      '01/11, 00:00',
      '01/11, 01:00',
      '01/11, 01:00',
      '01/11, 02:00',
      '01/11, 03:00',
    ]);
  });

  test('daily ticks stay on local midnight across both changes (23 h and 25 h days)', () => {
    const spring = axisTicks(at('2026-03-06T12:00:00-05:00'), at('2026-03-10T12:00:00-04:00'), DAY);
    expect(spring).toEqual([
      at('2026-03-07T00:00:00-05:00'),
      at('2026-03-08T00:00:00-05:00'),
      at('2026-03-09T00:00:00-04:00'),
      at('2026-03-10T00:00:00-04:00'),
    ]);
    expect(spring[2] - spring[1]).toBe(23 * HOUR);
    expect(labels(spring, DAY)).toEqual(['07/03', '08/03', '09/03', '10/03']);

    const fall = axisTicks(at('2026-10-31T12:00:00-04:00'), at('2026-11-02T12:00:00-05:00'), DAY);
    expect(fall).toEqual([at('2026-11-01T00:00:00-04:00'), at('2026-11-02T00:00:00-05:00')]);
    expect(fall[1] - fall[0]).toBe(25 * HOUR);
    expect(labels(fall, DAY)).toEqual(['01/11', '02/11']);
  });

  test('month ticks stay on local midnight of the 1st across DST', () => {
    const list = axisTicks(at('2026-02-15T00:00:00-05:00'), at('2026-04-15T00:00:00-04:00'), 30 * DAY);
    expect(list).toEqual([at('2026-03-01T00:00:00-05:00'), at('2026-04-01T00:00:00-04:00')]);
  });

  test('multi-hour ticks drift off the local grid after spring-forward', () => {
    // NOTE: current behaviour; looks wrong because nextTick advances sub-day
    // steps by raw milliseconds, so 2-hourly ticks aligned to even local hours
    // land on ODD local hours (03:00, 05:00…) after the change. The time-axis
    // proposal (docs/TIME_AXIS_PROPOSAL.md, problem 3) meant to fix exactly
    // this drift for hour-scale views.
    const list = axisTicks(at('2026-03-07T23:00:00-05:00'), at('2026-03-08T08:00:00-04:00'), 2 * HOUR);
    expect(labels(list, 2 * HOUR)).toEqual(['08/03, 00:00', '08/03, 03:00', '08/03, 05:00', '08/03, 07:00']);
  });

  test('multi-hour ticks drift off the local grid after fall-back', () => {
    // NOTE: current behaviour; same raw-ms stepping as above.
    const list = axisTicks(at('2026-10-31T23:00:00-04:00'), at('2026-11-01T06:00:00-05:00'), 2 * HOUR);
    expect(labels(list, 2 * HOUR)).toEqual(['01/11, 00:00', '01/11, 01:00', '01/11, 03:00', '01/11, 05:00']);
  });

  test('alignedStart inside the spring-forward gap resolves forward', () => {
    // 2-hour grid at 03:30 EDT: floor(3 / 2) * 2 = 02:00, which does not exist
    // that day; Date resolves it to 03:00 EDT
    expect(+alignedStart(at('2026-03-08T03:30:00-04:00'), 2 * HOUR)).toBe(at('2026-03-08T03:00:00-04:00'));
  });

  test('alignedStart in the repeated fall-back hour picks the earlier 01:00', () => {
    // 01:30 EST (the second 01:30): local 01:00 is ambiguous and Date picks
    // the EDT one, 1.5 h earlier — still at or before, and axisTicks steps
    // past it
    const ts = at('2026-11-01T01:30:00-05:00');
    expect(+alignedStart(ts, HOUR)).toBe(at('2026-11-01T01:00:00-04:00'));
    expect(axisTicks(ts, at('2026-11-01T03:00:00-05:00'), HOUR)).toEqual([
      at('2026-11-01T02:00:00-05:00'),
      at('2026-11-01T03:00:00-05:00'),
    ]);
  });
});

describe('Europe/London (DST: 2026-03-29 01:00 → 02:00, 2026-10-25 02:00 → 01:00)', () => {
  useTimeZone('Europe/London');

  test('the zone is really London', () => {
    expect(new Date(at('2026-01-15T12:00:00Z')).getTimezoneOffset()).toBe(0);
    expect(new Date(at('2026-07-15T12:00:00Z')).getTimezoneOffset()).toBe(-60);
  });

  test('15-minute ticks across spring-forward', () => {
    const list = axisTicks(at('2026-03-29T00:30:00Z'), at('2026-03-29T02:30:00+01:00'), 15 * 60e3);
    expect(labels(list, 15 * 60e3)).toEqual(['00:30', '00:45', '02:00', '02:15', '02:30']);
    expect(list[2] - list[1]).toBe(15 * 60e3);
  });

  test('daily ticks across fall-back stay on local midnight', () => {
    const list = axisTicks(at('2026-10-24T12:00:00+01:00'), at('2026-10-26T12:00:00Z'), DAY);
    expect(list).toEqual([at('2026-10-25T00:00:00+01:00'), at('2026-10-26T00:00:00Z')]);
    expect(list[1] - list[0]).toBe(25 * HOUR);
  });
});

describe('Asia/Kolkata (UTC+05:30, no DST)', () => {
  useTimeZone('Asia/Kolkata');

  test('the zone is really Kolkata', () => {
    expect(new Date(at('2026-07-15T12:00:00Z')).getTimezoneOffset()).toBe(-330);
  });

  test('hourly ticks land on local :00, i.e. UTC :30', () => {
    const list = axisTicks(at('2026-07-01T00:10:00Z'), at('2026-07-01T03:00:00Z'), HOUR);
    expect(isoList(list)).toEqual(['2026-07-01T00:30:00.000Z', '2026-07-01T01:30:00.000Z', '2026-07-01T02:30:00.000Z']);
    expect(labels(list, HOUR)).toEqual(['01/07, 06:00', '01/07, 07:00', '01/07, 08:00']);
  });

  test('daily ticks land on local midnight (18:30 UTC the day before)', () => {
    const list = axisTicks(at('2026-07-01T00:00:00Z'), at('2026-07-03T00:00:00Z'), DAY);
    expect(isoList(list)).toEqual(['2026-07-01T18:30:00.000Z', '2026-07-02T18:30:00.000Z']);
    expect(labels(list, DAY)).toEqual(['02/07', '03/07']);
  });
});

describe('Asia/Kathmandu (UTC+05:45, no DST)', () => {
  useTimeZone('Asia/Kathmandu');

  test('30-minute ticks land on local :00/:30, i.e. UTC :15/:45', () => {
    const list = axisTicks(at('2026-07-01T00:00:00Z'), at('2026-07-01T01:30:00Z'), 30 * 60e3);
    expect(isoList(list)).toEqual(['2026-07-01T00:15:00.000Z', '2026-07-01T00:45:00.000Z', '2026-07-01T01:15:00.000Z']);
    expect(labels(list, 30 * 60e3)).toEqual(['06:00', '06:30', '07:00']);
  });
});

describe('Australia/Adelaide (UTC+09:30/+10:30; DST: 2026-10-04 02:00 → 03:00)', () => {
  useTimeZone('Australia/Adelaide');

  test('the zone is really Adelaide', () => {
    expect(new Date(at('2026-07-15T12:00:00Z')).getTimezoneOffset()).toBe(-570);
    expect(new Date(at('2026-12-15T12:00:00Z')).getTimezoneOffset()).toBe(-630);
  });

  test('hourly ticks stay on local :00 across spring-forward', () => {
    const list = axisTicks(at('2026-10-04T00:00:00+09:30'), at('2026-10-04T05:00:00+10:30'), HOUR);
    expect(list).toEqual([
      at('2026-10-04T00:00:00+09:30'),
      at('2026-10-04T01:00:00+09:30'),
      at('2026-10-04T03:00:00+10:30'),
      at('2026-10-04T04:00:00+10:30'),
      at('2026-10-04T05:00:00+10:30'),
    ]);
    expect(labels(list, HOUR)).toEqual([
      '04/10, 00:00',
      '04/10, 01:00',
      '04/10, 03:00',
      '04/10, 04:00',
      '04/10, 05:00',
    ]);
  });

  test('daily ticks stay on local midnight across spring-forward (a 23 h day)', () => {
    const list = axisTicks(at('2026-10-03T12:00:00+09:30'), at('2026-10-05T12:00:00+10:30'), DAY);
    expect(list).toEqual([at('2026-10-04T00:00:00+09:30'), at('2026-10-05T00:00:00+10:30')]);
    expect(list[1] - list[0]).toBe(23 * HOUR);
  });
});

describe('Australia/Lord_Howe (UTC+10:30/+11; a 30-minute DST shift on 2026-10-04 02:00 → 02:30)', () => {
  useTimeZone('Australia/Lord_Howe');

  test('hourly ticks drift to :30 after a half-hour DST shift', () => {
    // NOTE: current behaviour; looks wrong for the same raw-ms stepping reason
    // as the New York multi-hour drift: even 1-hour ticks leave local :00.
    const list = axisTicks(at('2026-10-04T00:00:00+10:30'), at('2026-10-04T04:30:00+11:00'), HOUR);
    expect(labels(list, HOUR)).toEqual([
      '04/10, 00:00',
      '04/10, 01:00',
      '04/10, 02:30',
      '04/10, 03:30',
      '04/10, 04:30',
    ]);
  });
});
