/* Finding a time range's frames in a folder tree or bucket (#125), given a
 * way to list one folder. Date folders the template names by time alone
 * ({YYYY}/{MM}/{DD}/) are built for the range, not listed; folders named by
 * a host, site or variant are listed and matched; the last level's files are
 * matched and timed. Folders are listed newest first, so a walk cut short
 * by its listing cap loses the oldest times (M5). Pure apart from the lister
 * passed in. */
import type { Listing } from './listings';
import { fillSegment, FolderTemplate, isTimeOnly, matchSegment, Segment, startAfterName, timeOf, TimeUnit, timeVars, unitEnd } from './template';

export interface ListOptions {
  /** names after it are enough (a hint: a lister that can't use it returns
   * the whole folder) */
  startAfter?: string;
  /** when the time the folder's name covers ends (its day, hour or month,
   * in the walk's zone); unset when its name covers no time. A folder whose
   * time has ended changes little, so a lister may keep its listing longer. */
  ends?: number;
}

/** Lists one folder ("" is the base). */
export type Lister = (folder: string, opts?: ListOptions) => Promise<Listing>;

export interface FoundFrame {
  /** relative to the base: the image's URL is the base plus this */
  path: string;
  ts: number;
  host: string;
  site: string;
  variant: string;
}

export interface WalkOptions {
  from: number;
  to: number;
  tz: string;
  /** only these hosts or sites (null: all) */
  hosts?: string[] | null;
  sites?: string[] | null;
  /** only these variants (null: all) */
  variants?: string[] | null;
  /** the most folders listed in one walk; past it the walk stops and says so */
  maxListings?: number;
}

const TIME_ORDER = ['YYYY', 'MM', 'DDD', 'DD', 'HH', 'mm', 'ss'];
/* names sort by time within a segment when its time placeholders run from
 * the largest unit to the smallest (epoch counts sort by themselves) */
function sortsByTime(seg: Segment): boolean {
  const t = seg.names.filter((n) => TIME_ORDER.includes(n) || n === 'epoch' || n === 'epoch_ms');
  if (!t.length) {return false;}
  if (t.some((n) => n === 'epoch' || n === 'epoch_ms')) {return t.length === 1;}
  const idx = t.map((n) => TIME_ORDER.indexOf(n));
  return idx.every((v, i) => i === 0 || v > idx[i - 1]);
}

/* the distinct names a date folder takes over [from, to], with the time
 * fields they bind; hourly steps are enough for any folder of days or
 * coarser, and dedupe to one name each */
function dateNames(seg: Segment, vars: Record<string, string>, from: number, to: number, tz: string): Array<{ name: string; vars: Record<string, string> }> {
  const out = new Map<string, Record<string, string>>();
  const step = to - from > 400 * 864e5 ? 864e5 : 3600e3;
  for (let t = from - step; t <= to + step; t += step) {
    const tv = timeVars(Math.min(t, to), tz);
    // agree with the time fields earlier folders fixed (the year above the month)
    if (Object.entries(tv).some(([k, v]) => vars[k] !== undefined && vars[k] !== v && !seg.names.includes(k as never))) {continue;}
    const merged = { ...vars, ...Object.fromEntries(seg.names.map((n) => [n, (tv as Record<string, string>)[n]])) };
    const name = fillSegment(seg, merged);
    if (name !== null && !out.has(name)) {out.set(name, merged);}
  }
  // newest first
  return [...out.entries()].map(([name, v]) => ({ name, vars: v })).reverse();
}

/* the finest time unit a folder's bound names cover; null when they name
 * none, or an instant (seconds, an epoch) */
function unitOfVars(vars: Record<string, string>): TimeUnit | null {
  if (vars.ss !== undefined || vars.epoch !== undefined || vars.epoch_ms !== undefined) {return null;}
  if (vars.mm !== undefined) {return 'minute';}
  if (vars.HH !== undefined) {return 'hour';}
  if (vars.DD !== undefined || vars.DDD !== undefined) {return 'day';}
  if (vars.MM !== undefined) {return 'month';}
  return vars.YYYY !== undefined ? 'year' : null;
}

/* when the time a folder's name covers starts and ends; null when it names
 * no span of time */
function folderSpan(vars: Record<string, string>, tz: string): { start: number; end: number } | null {
  const unit = unitOfVars(vars);
  const start = unit ? timeOf(vars, tz) : null;
  return unit && start != null ? { start, end: unitEnd(start, unit, tz) } : null;
}

/* partials newest first, by the time their folders name (stable: those
 * that name none keep their order, after the rest) */
function newestFirst<P extends { vars: Record<string, string> }>(partials: P[], tz: string): P[] {
  const at = new Map(partials.map((p) => [p, folderSpan(p.vars, tz)?.start ?? null]));
  return [...partials].sort((a, b) => {
    const ta = at.get(a)!, tb = at.get(b)!;
    if (ta === null || tb === null) {return (ta === null ? 1 : 0) - (tb === null ? 1 : 0);}
    return tb - ta;
  });
}

/* runs fn over items, at most `limit` at a time, keeping their order */
async function pool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}
const CONCURRENCY = 6;

/* the combinations of given values for a segment whose placeholders are all
 * host, site or variant with values asked for; null when one isn't */
function knownValues(seg: Segment, o: WalkOptions): Array<Record<string, string>> | null {
  const given: Record<string, string[] | null | undefined> = { host: o.hosts, site: o.sites, variant: o.variants };
  if (!seg.names.every((n) => given[n]?.length)) {return null;}
  let out: Array<Record<string, string>> = [{}];
  for (const n of seg.names) {out = out.flatMap((v) => given[n]!.map((x) => ({ ...v, [n]: x })));}
  return out;
}

const passes = (v: Record<string, string>, o: WalkOptions) =>
  (!o.hosts || v.host === undefined || o.hosts.includes(v.host)) &&
  (!o.sites || v.site === undefined || o.sites.includes(v.site)) &&
  (!o.variants || v.variant === undefined || o.variants.includes(v.variant));

/** The frames in [from, to], with whether the walk stopped at its listing cap
 * before finishing (then some folders weren't read). */
export async function walkFrames(tpl: FolderTemplate, list: Lister, o: WalkOptions): Promise<{ frames: FoundFrame[]; truncated: boolean }> {
  const max = o.maxListings ?? 200;
  let listings = 0;
  let truncated = false;
  const listOnce: Lister = async (folder, opts) => {
    if (listings >= max) { truncated = true; return { dirs: [], files: [] }; }
    listings++;
    return list(folder, opts);
  };

  let partials: Array<{ folder: string; vars: Record<string, string> }> = [{ folder: '', vars: {} }];
  const dirs = tpl.segments.slice(0, -1);
  const last = tpl.segments[tpl.segments.length - 1];
  const join = (folder: string, name: string) => (folder ? folder + '/' : '') + name;

  for (const seg of dirs) {
    const next: typeof partials = [];
    if (!seg.names.length) {
      for (const p of partials) {next.push({ folder: join(p.folder, seg.raw), vars: p.vars });}
    } else if (isTimeOnly(seg)) {
      for (const p of partials) {
        for (const d of dateNames(seg, p.vars, o.from, o.to, o.tz)) {next.push({ folder: join(p.folder, d.name), vars: d.vars });}
      }
    } else if (knownValues(seg, o)) {
      // every placeholder's values are given (the variants wanted, the hosts
      // asked for): build the folder names instead of listing the parent,
      // which for a bucket of hundreds of hosts is most of the work
      for (const p of partials) {
        for (const vars of knownValues(seg, o)!) {
          const merged = matchSegment(seg, fillSegment(seg, { ...p.vars, ...vars }) ?? '', p.vars);
          if (merged) {next.push({ folder: join(p.folder, fillSegment(seg, merged)!), vars: merged });}
        }
      }
    } else {
      const listed = await pool(newestFirst(partials, o.tz), CONCURRENCY, async (p) => {
        const span = folderSpan(p.vars, o.tz);
        return { p, l: await listOnce(p.folder, span ? { ends: span.end } : undefined) };
      });
      for (const { p, l } of listed) {
        for (const name of l.dirs) {
          const vars = matchSegment(seg, name, p.vars);
          if (vars && passes(vars, o)) {next.push({ folder: join(p.folder, name), vars });}
        }
      }
    }
    partials = next;
  }

  const frames: FoundFrame[] = [];
  const startAfterOk = sortsByTime(last);
  await pool(newestFirst(partials, o.tz), CONCURRENCY, async (p) => {
    const span = folderSpan(p.vars, o.tz);
    // a folder that starts inside the range needs all its names: no bound,
    // so its listing is the same whatever the range's start
    const startAfter = startAfterOk && !(span && span.start >= o.from) ? startAfterName(last, p.vars, o.from, o.tz) ?? undefined : undefined;
    const opts: ListOptions = { ...(startAfter ? { startAfter } : {}), ...(span ? { ends: span.end } : {}) };
    const l = await listOnce(p.folder, Object.keys(opts).length ? opts : undefined);
    for (const name of l.files) {
      const vars = matchSegment(last, name, p.vars);
      if (!vars || !vars.host || !passes(vars, o)) {continue;}
      const ts = timeOf(vars, o.tz);
      if (ts == null || ts < o.from || ts > o.to) {continue;}
      frames.push({ path: join(p.folder, name), ts, host: vars.host, site: vars.site ?? '', variant: vars.variant ?? '' });
    }
  });
  frames.sort((a, b) => a.ts - b.ts);
  return { frames, truncated };
}
