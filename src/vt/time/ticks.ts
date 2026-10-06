import { F_DAY, F_DAY_HM, F_SHORT, fromWall, type TimeZoneName, wallOf, type Zone, zoneOf } from './zones';

/* The steps Grafana's time series axis can pick (uPlot's default time
 * increments, from a minute up): every sub-day step divides a day, and the
 * month steps (30d = 1, 60d = 2, ... 365d = 12 months) divide a year. */
export const TICK_STEPS = [60e3, 5 * 60e3, 10 * 60e3, 15 * 60e3, 30 * 60e3,
                    3600e3, 2 * 3600e3, 3 * 3600e3, 4 * 3600e3, 6 * 3600e3,
                    8 * 3600e3, 12 * 3600e3,
                    24 * 3600e3, 2 * 86400e3, 3 * 86400e3, 4 * 86400e3,
                    5 * 86400e3, 6 * 86400e3, 7 * 86400e3, 8 * 86400e3,
                    9 * 86400e3, 10 * 86400e3, 15 * 86400e3,
                    30 * 86400e3, 60 * 86400e3, 90 * 86400e3, 120 * 86400e3,
                    180 * 86400e3, 365 * 86400e3];

/* Calendar alignment in a zone. Three tiers, by step:
 * - under a day: ticks are the instants whose WALL CLOCK sits on the step's
 *   grid (minutes or hours since local midnight). Within one offset run that
 *   is (t + offset) % step === 0; a DST change moves to the next run and
 *   re-aligns there. So 2-hourly ticks stay on even local hours across a
 *   change, hourly ticks stay on :00 across Lord Howe's 30-minute shift, a
 *   skipped hour gets no tick and a repeated hour gets both of its ticks.
 *   Steps must divide a day (every TICK_STEPS entry does).
 * - days: local midnight, stepping by calendar days from the window's first
 *   day (23 h and 25 h days stay on midnight).
 * - months: the 1st, on calendar multiples of the step: every month (30d),
 *   quarters starting Jan/Apr/Jul/Oct (90d), 1 January (365d). */
const DAY_MS = 864e5;
function monthsOf(stepMs: number): number {
  return stepMs >= 30 * DAY_MS ? Math.round(stepMs / (30 * DAY_MS)) : 0;   // 365d → 12
}
/* the first instant in (lo, hi] whose offset differs from `o` (offset(lo)
 * is o, offset(hi) is not). Offsets change on whole seconds. */
function offsetChange(lo: number, hi: number, o: number, z: Zone): number {
  let a = Math.floor(lo / 1000), b = Math.ceil(hi / 1000);
  while (b - a > 1) {
    const m = Math.floor((a + b) / 2);
    if (z.offset(m * 1000) === o) {a = m;} else {b = m;}
  }
  return b * 1000;
}
/* first instant >= ts on the sub-day wall grid */
function ceilWall(ts: number, step: number, z: Zone): number {
  let t = ts;
  for (let i = 0; i < 6; i++) {
    const o = z.offset(t);
    const c = Math.ceil((t + o) / step) * step - o;
    if (z.offset(c) === o) {return c;}
    t = offsetChange(t, c, o, z);   // the run ended before c: retry in the next one
  }
  return Math.ceil(ts / step) * step;
}
/* last instant <= ts on the sub-day wall grid */
function floorWall(ts: number, step: number, z: Zone): number {
  let t = ts;
  for (let i = 0; i < 6; i++) {
    const o = z.offset(t);
    const c = Math.floor((t + o) / step) * step - o;
    const oc = z.offset(c);
    if (oc === o) {return c;}
    t = offsetChange(c, t, oc, z) - 1;   // this run starts after c: retry in the previous one
  }
  return Math.floor(ts / step) * step;
}
function monthStart(idx: number, z: Zone): number {
  return fromWall(Date.UTC(Math.floor(idx / 12), ((idx % 12) + 12) % 12, 1), z);
}
function dayStartWall(ts: number, z: Zone): number {
  const w = wallOf(ts, z);
  return w - (((w % DAY_MS) + DAY_MS) % DAY_MS);
}
function alignIn(ts: number, stepMs: number, z: Zone): number {
  const k = monthsOf(stepMs);
  if (k) {
    const d = new Date(wallOf(ts, z));
    const idx = d.getUTCFullYear() * 12 + d.getUTCMonth();
    return monthStart(Math.floor(idx / k) * k, z);
  }
  if (stepMs >= DAY_MS) {return fromWall(dayStartWall(ts, z), z);}
  return floorWall(ts, stepMs, z);
}
function nextIn(ts: number, stepMs: number, z: Zone): number {
  const k = monthsOf(stepMs);
  let n;
  if (k) {
    const d = new Date(wallOf(ts, z));
    const idx = d.getUTCFullYear() * 12 + d.getUTCMonth();
    n = monthStart(Math.floor(idx / k) * k + k, z);
  } else if (stepMs >= DAY_MS) {
    n = fromWall(dayStartWall(ts, z) + Math.round(stepMs / DAY_MS) * DAY_MS, z);
  } else {
    n = ceilWall(ts + 1, stepMs, z);
  }
  return n > ts ? n : ts + stepMs;   // always progress, whatever a zone's history does
}

/* the last tick boundary at or before `ts` for the step's tier, in the zone:
 * the sub-day wall grid, local midnight, or the 1st of a month that is a
 * calendar multiple of the step (any month, a quarter, January) */
export function alignedStart(ts: number, stepMs: number, tz?: TimeZoneName): number {
  return alignIn(ts, stepMs, zoneOf(tz));
}

/* the tick after `ts`: the next grid instant below a day, the next midnight
 * `step` days on from ts's day, or the next month/quarter/year start */
export function nextTick(ts: number, stepMs: number, tz?: TimeZoneName): number {
  return nextIn(ts, stepMs, zoneOf(tz));
}

/* every tick in [from, to]: calendar-aligned start, then nextTick steps */
export function axisTicks(from: number, to: number, stepMs: number, tz?: TimeZoneName): number[] {
  const z = zoneOf(tz);
  const out: number[] = [];
  let t = alignIn(from, stepMs, z);
  while (t < from) {t = nextIn(t, stepMs, z);}
  for (; t <= to && out.length < 10000; t = nextIn(t, stepMs, z)) {out.push(t);}
  return out;
}

/* Which label a tick gets, by Grafana's rule (formatTime in its
 * UPlotAxisBuilder.ts): it depends on the step AND the visible range, so a
 * 12 h window with hourly ticks still reads HH:mm, and dates appear only
 * once the window spans more than a day. The names are Grafana's
 * systemDateFormats.interval keys. */
export type TickKind = 'second' | 'minute' | 'hour' | 'day' | 'month' | 'year';
const YEAR_MS = 365 * DAY_MS;
export function tickKind(stepMs: number, rangeMs: number): TickKind {
  if (stepMs <= 60e3) {return 'second';}
  if (rangeMs <= DAY_MS) {return 'minute';}
  if (stepMs <= DAY_MS) {return 'hour';}
  if (rangeMs < YEAR_MS) {return 'day';}
  if (Math.round(stepMs / DAY_MS) === 365) {return 'year';}
  return stepMs <= YEAR_MS ? 'month' : 'year';
}

/* A host's own label formatter (the Grafana panel passes Grafana's, so the
 * axis honours the instance's configured date formats). */
export type AxisFormatter = (ts: number, kind: TickKind) => string;

const F_SECOND: Intl.DateTimeFormatOptions = { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' };
const pad2 = (n: number) => String(n).padStart(2, '0');

/* The built-in labels (the standalone pages, which have no Grafana): the
 * same tiers as Grafana, with dates in the browser's locale order. */
export function kindFormat(kind: TickKind, tz?: TimeZoneName): (ts: number) => string {
  const z = zoneOf(tz);
  switch (kind) {
    case 'second': { const f = z.fmt('second', F_SECOND); return ts => f.format(ts); }
    case 'minute': { const f = z.fmt('short', F_SHORT); return ts => f.format(ts); }
    case 'hour': { const f = z.fmt('dayhm', F_DAY_HM); return ts => f.format(ts); }
    case 'day': { const f = z.fmt('day', F_DAY); return ts => f.format(ts); }
    case 'month': return ts => { const d = new Date(wallOf(ts, z)); return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1); };
    default: return ts => String(new Date(wallOf(ts, z)).getUTCFullYear());
  }
}

/* The label function for an axis with this step over this visible range,
 * in the zone: the host's formatter when given, else the built-in one. */
export function tickFormat(stepMs: number, rangeMs: number, tz?: TimeZoneName, host?: AxisFormatter): (ts: number) => string {
  const kind = tickKind(stepMs, rangeMs);
  if (host) {return ts => host(ts, kind);}
  return kindFormat(kind, tz);
}

/* Grafana's x-axis spacing (calculateSpace in UPlotAxisBuilder.ts, then
 * uPlot's increment choice): format a sample label as if ticks were 40 px
 * apart, require its width plus an 18 px gap between ticks, and take the
 * smallest step that leaves that much room. `measure` returns a label's
 * rendered width in px. */
export const X_TICK_SPACING = 40;
export const X_TICK_VALUE_GAP = 18;
export function pickTickStep(
  from: number, to: number, widthPx: number, measure: (text: string) => number, tz?: TimeZoneName, host?: AxisFormatter
): number {
  const range = to - from;
  if (!(range > 0) || !(widthPx > 0)) {return TICK_STEPS[TICK_STEPS.length - 1];}
  const roughStep = range / (widthPx / X_TICK_SPACING);
  const space = measure(tickFormat(roughStep, range, tz, host)(to)) + X_TICK_VALUE_GAP;
  return TICK_STEPS.find(st => (st / range) * widthPx >= space) || TICK_STEPS[TICK_STEPS.length - 1];
}
