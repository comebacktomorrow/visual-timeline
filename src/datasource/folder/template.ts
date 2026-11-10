/* The path template (#125): where a folder's or bucket's frames live, relative
 * to its base URL. "{site}/{host}/{YYYY}-{MM}-{DD}/{HH}{mm}{ss}.jpg" or
 * "{YYYY}/{MM}/{DD}/{YYYY}{MM}{DD}_{HH}{mm}{ss}_{variant}_{host}.jpg".
 *
 * - time: {YYYY} {MM} {DD} {DDD} (day of year) {HH} {mm} {ss}, {epoch}
 *   (seconds) and {epoch_ms}, read in the data source's time zone;
 * - identity: {host} (required), {site} and {variant} (the image size);
 * - any placeholder anywhere, file names included; one may repeat (a host in
 *   its folder and its file name), and every occurrence must agree;
 * - literal text matches literally; a path that doesn't match is ignored.
 * Pure: no fetching here (see walk.ts). */
import { zonedParts, zonedTime } from '../../vt/time/zones';

const TIME = { YYYY: '\\d{4}', MM: '\\d{2}', DD: '\\d{2}', DDD: '\\d{3}', HH: '\\d{2}', mm: '\\d{2}', ss: '\\d{2}', epoch: '\\d{9,10}', epoch_ms: '\\d{12,13}' } as const;
const IDENTITY = ['host', 'site', 'variant'] as const;
type TimeName = keyof typeof TIME;
type Name = TimeName | (typeof IDENTITY)[number];
const isTime = (n: string): n is TimeName => n in TIME;

export interface Segment {
  raw: string;
  /** the placeholders it holds, in order */
  names: Name[];
  /** matches one path segment, capturing each placeholder by name */
  regex: RegExp;
}

export interface FolderTemplate {
  raw: string;
  segments: Segment[];
}

/** What a path says about its frame. */
export interface PathInfo {
  ts: number;
  host: string;
  site: string;
  variant: string;
}

const PLACEHOLDER = /\{([A-Za-z_]+)\}/g;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function compileSegment(raw: string, seen: Set<string>): Segment {
  const names: Name[] = [];
  let src = '';
  let last = 0;
  for (const m of raw.matchAll(PLACEHOLDER)) {
    const name = m[1];
    if (!isTime(name) && !(IDENTITY as readonly string[]).includes(name)) {
      throw new Error(`Unknown placeholder {${name}} in the path template`);
    }
    src += escape(raw.slice(last, m.index));
    // a repeat of a placeholder seen in this segment must match the same text
    if (names.includes(name as Name)) {src += `\\k<${name}>`;}
    else {
      src += `(?<${name}>${isTime(name) ? TIME[name] : '[^/]+?'})`;
      names.push(name as Name);
    }
    seen.add(name);
    last = m.index! + m[0].length;
  }
  src += escape(raw.slice(last));
  return { raw, names, regex: new RegExp('^' + src + '$') };
}

/** Compiles a template; throws with a message for the settings page when it
 * can't work (no {host}, no time, an unknown placeholder). */
export function compileTemplate(raw: string): FolderTemplate {
  const t = raw.trim().replace(/^\/+/, '');
  if (!t) {throw new Error('Set a path template, such as {host}/{YYYY}{MM}{DD}_{HH}{mm}{ss}.jpg');}
  const seen = new Set<string>();
  const segments = t.split('/').map((s) => compileSegment(s, seen));
  if (!seen.has('host')) {throw new Error('The path template needs {host}');}
  if (![...seen].some(isTime)) {throw new Error('The path template needs a time: {epoch}, {epoch_ms}, or {YYYY}{MM}{DD} with {HH}{mm}');}
  if (segments.some((s) => !s.raw)) {throw new Error('The path template has an empty folder (two slashes in a row)');}
  return { raw: t, segments };
}

/** A segment's placeholders as they match in one name, or null. */
export function matchSegment(seg: Segment, name: string, bound: Record<string, string> = {}): Record<string, string> | null {
  const m = seg.regex.exec(name);
  if (!m) {return null;}
  const got = { ...(m.groups || {}) };
  // a placeholder bound in an earlier segment (a host's folder) must agree
  for (const [k, v] of Object.entries(got)) {
    if (bound[k] !== undefined && bound[k] !== v) {return null;}
  }
  return { ...bound, ...got };
}

/** The instant a path's time placeholders name, read in `tz`; null when they
 * don't make a valid time (a 13th month, say) or name none. */
export function timeOf(vars: Record<string, string>, tz: string): number | null {
  if (vars.epoch_ms) {return Number(vars.epoch_ms);}
  if (vars.epoch) {return Number(vars.epoch) * 1000;}
  const year = Number(vars.YYYY);
  if (!vars.YYYY || !Number.isFinite(year)) {return null;}
  let month = Number(vars.MM ?? 1), day = Number(vars.DD ?? 1);
  if (vars.DDD) {
    const d = new Date(Date.UTC(year, 0, Number(vars.DDD)));
    if (d.getUTCFullYear() !== year) {return null;}
    month = d.getUTCMonth() + 1;
    day = d.getUTCDate();
  }
  const hour = Number(vars.HH ?? 0), minute = Number(vars.mm ?? 0), second = Number(vars.ss ?? 0);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 60) {return null;}
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() !== month - 1) {return null;}   // 31 April
  return zonedTime({ year, month, day, hour, minute, second }, tz);
}

/** Everything a whole path says, or null when it doesn't match. */
export function parsePath(tpl: FolderTemplate, path: string, tz: string): PathInfo | null {
  const parts = path.replace(/^\/+/, '').split('/');
  if (parts.length !== tpl.segments.length) {return null;}
  let vars: Record<string, string> | null = {};
  for (let i = 0; i < parts.length && vars; i++) {vars = matchSegment(tpl.segments[i], parts[i], vars);}
  if (!vars) {return null;}
  const ts = timeOf(vars, tz);
  if (ts == null || !vars.host) {return null;}
  return { ts, host: vars.host, site: vars.site ?? '', variant: vars.variant ?? '' };
}

/* the time fields of an instant in `tz`, as placeholders spell them */
export function timeVars(ts: number, tz: string): Record<TimeName, string> {
  const p = zonedParts(ts, tz);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const doy = Math.round((Date.UTC(p.year, p.month - 1, p.day) - Date.UTC(p.year, 0, 0)) / 864e5);
  return {
    YYYY: pad(p.year, 4), MM: pad(p.month), DD: pad(p.day), DDD: pad(doy, 3), HH: pad(p.hour), mm: pad(p.minute), ss: pad(p.second),
    epoch: String(Math.floor(ts / 1000)), epoch_ms: String(ts),
  };
}

/** A segment with its placeholders filled in, or null when one has no value. */
export function fillSegment(seg: Segment, vars: Record<string, string>): string | null {
  let missing = false;
  const out = seg.raw.replace(PLACEHOLDER, (_m, name: string) => {
    if (vars[name] === undefined) { missing = true; return ''; }
    return vars[name];
  });
  return missing ? null : out;
}

/** Whether a segment holds only time placeholders (and literals): a date
 * folder, whose names can be built for a time range instead of listed. */
export const isTimeOnly = (seg: Segment) => seg.names.length > 0 && seg.names.every(isTime);

/** The text a file name starts with at time `from`, up to its first
 * placeholder that is neither bound nor a time: a lower bound for listings
 * that can start after a key (S3's start-after), when names sort by time.
 * Null when the name doesn't start with time or known values. */
export function startAfterName(seg: Segment, vars: Record<string, string>, from: number, tz: string): string | null {
  const t = timeVars(from, tz);
  let out = '';
  let last = 0;
  let sawTime = false;
  for (const m of seg.raw.matchAll(PLACEHOLDER)) {
    const name = m[1];
    out += seg.raw.slice(last, m.index);
    if (isTime(name)) { out += t[name]; sawTime = true; }
    else if (vars[name] !== undefined) {out += vars[name];}
    else {break;}
    last = m.index! + m[0].length;
  }
  return sawTime ? out : null;
}
