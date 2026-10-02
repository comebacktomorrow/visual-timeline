/* ======================= time zones =======================
 * All data is UTC epoch ms; only DISPLAY (text) and AXIS ALIGNMENT depend
 * on a zone. A zone is named by a string: an IANA name ('America/New_York'),
 * 'UTC', or undefined / '' / 'browser' for the viewer's own zone (the
 * default, and how the panel always rendered). Every time→text and calendar
 * helper below takes the zone as its LAST argument, so one mount can format
 * one value in its own zone and the next in another (per-source zones, #68).
 *
 * resolveTimeZone() turns a config value into a concrete zone id; a mount
 * does it once (cfg.timeZone) and passes the result down. The helpers also
 * accept unresolved values. Formatters are Intl.DateTimeFormat instances
 * cached per zone and format: building one costs far more than using it,
 * and scrubbing formats a caption on every pointer move. */

/* a zone name as config and callers pass it, resolved or not */
export type TimeZoneName = string | null | undefined;

const LOCAL_TZ = 'local';   // the engine's zone, when Intl cannot name it
const zoneOk = new Map<string, boolean>();
export function isZone(name: string): boolean {
  let ok = zoneOk.get(name);
  if (ok === undefined) {
    try { new Intl.DateTimeFormat('en-US', { timeZone: name }); ok = true; } catch (e) { ok = false; }
    zoneOk.set(name, ok);
  }
  return ok;
}
/* read per call, not cached: a host whose zone changes (an OS setting, a
 * test switching TZ) picks it up on the next mount */
function systemZone(): string {
  let z: string | null = null;
  try { z = new Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { z = null; }
  return z && isZone(z) ? z : LOCAL_TZ;
}
/* zone names already warned about, shared with sourceTimeZone: one warning
 * per name per page */
export const zoneWarned = new Set<string>();
export function resolveTimeZone(tz?: TimeZoneName): string {
  const s = tz == null ? '' : String(tz).trim();
  if (!s || /^(browser|default|local)$/i.test(s)) {return systemZone();}
  if (/^utc$/i.test(s)) {return 'UTC';}
  if (isZone(s)) {return s;}
  if (!zoneWarned.has(s)) {
    zoneWarned.add(s);
    console.warn('[visual-timeline] unknown time zone "' + s + '"; using the browser\'s');
  }
  return systemZone();
}

/* A resolved zone: its offset at an instant and its cached formatters */
export interface Zone {
  id: string;
  offset: (ts: number) => number;
  fmt(key: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat;
}

/* A zone's offset (wall clock minus UTC, ms) at an instant, plus its cached
 * formatters. Offsets come from formatToParts, which resolves to the second,
 * so an offset is constant within each whole second. */
const zones = new Map<string, Zone>();
export function zoneOf(tz?: TimeZoneName): Zone {
  const id = resolveTimeZone(tz);
  let z = zones.get(id);
  if (!z) {
    const tzOpt: Intl.DateTimeFormatOptions = id === LOCAL_TZ ? {} : { timeZone: id };
    const fmts = new Map<string, Intl.DateTimeFormat>();
    let offset: (ts: number) => number;
    if (id === 'UTC') {offset = () => 0;}
    else if (id === LOCAL_TZ) {offset = (ts) => -new Date(ts).getTimezoneOffset() * 60e3;}
    else {
      const pf = new Intl.DateTimeFormat('en-US', Object.assign<Intl.DateTimeFormatOptions, Intl.DateTimeFormatOptions>({
        hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
        hour: 'numeric', minute: 'numeric', second: 'numeric',
      }, tzOpt));
      offset = (ts) => {
        const p: Record<string, string> = {};
        for (const x of pf.formatToParts(ts)) {p[x.type] = x.value;}
        const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
        return wall - Math.floor(ts / 1000) * 1000;
      };
    }
    z = {
      id, offset,
      // en-AU, 24 h: the panel's one display format (locale/12 h are not options)
      fmt(key, opts) {
        let f = fmts.get(key);
        if (!f) { f = new Intl.DateTimeFormat('en-AU', Object.assign({}, opts, tzOpt)); fmts.set(key, f); }
        return f;
      },
    };
    zones.set(id, z);
  }
  return z;
}

/* wall clock ↔ instant. A "wall" value is the zone's clock reading encoded
 * as if it were UTC ms (Date.UTC of the fields), so calendar arithmetic on
 * it has no DST. Going back, a wall time can be NONEXISTENT (skipped by a
 * spring-forward) or AMBIGUOUS (repeated by a fall-back): like Date's own
 * local-time constructor, a skipped time moves forward by the gap (02:30 →
 * 03:30) and a repeated one resolves to the EARLIER instant. */
export const wallOf = (ts: number, z: Zone): number => ts + z.offset(ts);
export function fromWall(w: number, z: Zone): number {
  // the offsets in force a day either side: at most one change lies between
  const before = z.offset(w - 864e5), after = z.offset(w + 864e5);
  const a = w - before;
  if (before === after) {return a;}
  const b = w - after;
  const aOk = z.offset(a) === before, bOk = z.offset(b) === after;
  if (aOk && bOk) {return Math.min(a, b);}   // repeated: the earlier one
  if (bOk) {return b;}
  return a;   // valid only before the change, or skipped (then a lands the gap's length later)
}

/* wall-clock fields in a zone, as zonedParts returns them (month and day
 * 1-based); zonedTime takes them with the time fields optional */
export interface WallFields {
  year: number;
  month: number;
  day: number;
  hour?: number;
  minute?: number;
  second?: number;
  ms?: number;
}

/* the zone's wall-clock fields at an instant (month and day 1-based) */
export function zonedParts(ts: number, tz?: TimeZoneName): Required<WallFields> {
  const d = new Date(wallOf(ts, zoneOf(tz)));
  return {
    year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(),
    hour: d.getUTCHours(), minute: d.getUTCMinutes(), second: d.getUTCSeconds(), ms: d.getUTCMilliseconds(),
  };
}
/* the instant a wall-clock reading in the zone names (fields as zonedParts
 * returns them; time fields default to 0) */
export function zonedTime(f: WallFields, tz?: TimeZoneName): number {
  return fromWall(Date.UTC(f.year, f.month - 1, f.day, f.hour || 0, f.minute || 0, f.second || 0, f.ms || 0), zoneOf(tz));
}

// toLocaleTimeString's defaults, spelled out: same text as before, now cacheable
const F_TIME: Intl.DateTimeFormatOptions = { hour12: false, hour: 'numeric', minute: 'numeric', second: 'numeric' };
export const F_SHORT: Intl.DateTimeFormatOptions = { hour12: false, hour: '2-digit', minute: '2-digit' };
export const F_DAY_HM: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false };
export const F_DAY: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit' };
/* HH:mm:ss and HH:mm in the zone (en-AU, 24 h) */
export const fmtTime = (ts: number, tz?: TimeZoneName): string => zoneOf(tz).fmt('time', F_TIME).format(ts);
export const fmtShort = (ts: number, tz?: TimeZoneName): string => zoneOf(tz).fmt('short', F_SHORT).format(ts);
export const fmtDur = (ms: number): string => ms % 3600e3 === 0 ? (ms / 3600e3) + 'h' : ms % 60e3 === 0 ? (ms / 60e3) + 'm' : (ms / 1e3) + 's';
