import type { Frame, TimeWindow } from '../types';

/* ================ frames → intervals (docs/TIMELINE-MODEL.md) ================
 * A frame is shown from its own time until the next frame replaces it, or
 * until it runs out. A frame that comes with a cadence PROMISES the next one
 * by t + cadence (kept up to t + (1 + tolerance) * cadence); a broken
 * promise is DROPPED time, the only red. A frame with no promise is shown up
 * to a hold limit, and past it there's neutral NO DATA. A pause suspends
 * promises. Pure: no DOM, no fetching. */

export type IntervalKind =
  | 'frame'     // a frame in force
  | 'pending'   // live edge: the frame's promise is due, within tolerance (frame still shown)
  | 'dropped'   // a promise broke and no frame has come since: red
  | 'nodata'    // no promise in force, or none kept past its hold limit: neutral
  | 'paused'    // a pause: promises suspended
  | 'beyond';   // past now: unknown

export interface PauseSpan {
  from: number;
  /** null: no end known yet; the first frame at or after from + resumeAfter ends it */
  to: number | null;
  /** an open pause ignores frames this soon after its start (a goodbye frame
   * that lands just after the declaration), default 0 */
  resumeAfter?: number;
  label?: string;
  color?: string;
  reason?: string;
  intended?: boolean;
}

export interface Interval {
  from: number;
  to: number;
  kind: IntervalKind;
  /** the frame shown ('frame', 'pending') */
  frame?: Frame;
  /** the pause ('paused') */
  pause?: PauseSpan;
}

/** How long a frame with no promise is shown when no frame follows it soon:
 * 'auto' (a few times the typical gap around it), 'none' (until the next
 * frame, however long) or a duration in ms. */
export type HoldLimit = 'auto' | 'none' | number;

export interface IntervalInput {
  /** frames in any order, including any before the window (the one in force
   * at its start) */
  frames: Frame[];
  /** the promise in force at a time from what the source declares (ms), or
   * null for none; a frame's own `cadence` comes first */
  promiseAt?: (t: number) => number | null;
  pauses?: PauseSpan[];
  hold?: HoldLimit;
  window: TimeWindow;
  now: number;
  /** a promise is kept by a frame up to this fraction of a cadence late */
  tolerance?: number;
}

/** Auto hold: this many times the typical gap around a frame. */
export const AUTO_HOLD_FACTOR = 3;
/** Auto hold with no gaps to go on (a lone frame). */
export const AUTO_HOLD_FALLBACK = 3600e3;
/* the gaps either side of a frame that make its typical gap */
const AUTO_HOLD_NEIGHBOURS = 4;

export interface Intervals {
  /** the window, from start to end, in order, without overlaps */
  intervals: Interval[];
  /** the frames in the window (and the one in force at its start), in time
   * order: their own times, for notches and for playing through */
  frames: Frame[];
  /** the interval in force at t (clamped to the window) */
  at(t: number): Interval | null;
}

export function buildIntervals(input: IntervalInput): Intervals {
  const { window: W, now } = input;
  const tol = input.tolerance ?? 0.5;
  const hold = input.hold ?? 'auto';
  const promiseAt = input.promiseAt ?? (() => null);
  const horizon = Math.max(W.from, Math.min(W.to, now));

  // frames in time order, one per instant (the later one wins)
  const byTs = new Map<number, Frame>();
  for (const f of input.frames) {if (Number.isFinite(f.ts)) {byTs.set(f.ts, f);}}
  let frames = [...byTs.values()].sort((a, b) => a.ts - b.ts);

  // pauses: an open one ends at the first frame that comes after it; a frame
  // inside a pause is not drawn (the pause explains the silence)
  const pauses = resolvePauses(input.pauses ?? [], frames, horizon);
  const inPause = (t: number) => pauses.some((p) => t >= p.from && t < (p.to as number));
  frames = frames.filter((f) => f.ts <= horizon && !inPause(f.ts));

  // from the frame in force at the window's start (the last one at or before
  // it) on; earlier ones only count towards typical gaps
  let offset = 0;
  while (offset + 1 < frames.length && frames[offset + 1].ts <= W.from) {offset++;}
  const shown = frames.slice(offset);

  const promiseOf = (f: Frame): number | null => {
    const own = f.cadence;
    if (typeof own === 'number' && own > 0) {return own;}
    const p = promiseAt(f.ts);
    return p && p > 0 ? p : null;
  };
  const holdFor = (i: number): number => {
    if (hold === 'none') {return Infinity;}
    if (typeof hold === 'number') {return hold > 0 ? hold : Infinity;}
    const gaps: number[] = [];
    for (let j = Math.max(1, i - AUTO_HOLD_NEIGHBOURS + 1); j <= Math.min(frames.length - 1, i + AUTO_HOLD_NEIGHBOURS); j++) {
      gaps.push(frames[j].ts - frames[j - 1].ts);
    }
    if (!gaps.length) {return AUTO_HOLD_FALLBACK;}
    gaps.sort((a, b) => a - b);
    return AUTO_HOLD_FACTOR * gaps[Math.floor(gaps.length / 2)];
  };

  const out: Interval[] = [];
  const push = (from: number, to: number, kind: IntervalKind, extra: Partial<Interval> = {}) => {
    const a = Math.max(from, W.from), b = Math.min(to, horizon);
    if (b <= a) {return;}
    const last = out[out.length - 1];
    // neighbouring stretches of the same frameless kind are one
    if (last && last.kind === kind && last.to === a && !extra.frame && !last.frame && !last.pause && !extra.pause) { last.to = b; return; }
    out.push({ from: a, to: b, kind, ...extra });
  };

  // What follows time t (a frame's time, or a pause's end) until `until`,
  // given the promise in force (null: none) and the hold for a frame (null
  // when there's no frame, after a pause or at the window's start)
  const follow = (f: Frame | null, t: number, until: number, promise: number | null, holdMs: number, live: boolean) => {
    if (until <= t) {return;}
    if (promise) {
      const due = t + promise, kept = t + (1 + tol) * promise;
      if (f) {
        if (live) {
          push(t, Math.min(due, until), 'frame', { frame: f });
          push(due, Math.min(kept, until), 'pending', { frame: f });
        } else {
          push(t, Math.min(kept, until), 'frame', { frame: f });
        }
      } else {
        // after a pause, or a window that starts with no frame in force:
        // nothing to show; the promise starts its count here
        push(t, Math.min(kept, until), 'nodata');
      }
      push(kept, until, 'dropped');
      return;
    }
    if (f) {
      push(t, Math.min(t + holdMs, until), 'frame', { frame: f });
      push(t + holdMs, until, 'nodata');
    } else {
      push(t, until, 'nodata');
    }
  };

  // events in time order: frames, pause starts and ends
  let cursor = W.from;
  // before the first frame in force: a declared promise with no frame within
  // the look-back has broken; otherwise there's nothing to say
  const firstTs = shown.length ? shown[0].ts : horizon;
  if (firstTs > W.from) {
    const p = promiseAt(W.from);
    let t = W.from;
    for (const pz of pauses) {
      if (pz.to! <= t || pz.from >= firstTs) {continue;}
      push(t, pz.from, p ? 'dropped' : 'nodata');
      push(pz.from, Math.min(pz.to!, firstTs), 'paused', { pause: pz });
      t = Math.min(pz.to!, firstTs);
    }
    if (t < firstTs) {
      if (t > W.from) {follow(null, t, firstTs, promiseAt(t), 0, false);}
      else {push(t, firstTs, p ? 'dropped' : 'nodata');}
    }
    cursor = firstTs;
  }

  for (let k = 0; k < shown.length; k++) {
    const f = shown[k];
    const i = offset + k;
    const next = shown[k + 1];
    const end = next ? next.ts : horizon;
    const live = !next;
    let t = f.ts;
    let cur: Frame | null = f;
    let promise = promiseOf(f);
    let holdMs = holdFor(i);
    // pauses between this frame and the next one cut it short
    for (const pz of pauses) {
      if (pz.from < t || pz.from >= end) {continue;}
      follow(cur, t, pz.from, promise, holdMs, false);
      push(pz.from, Math.min(pz.to!, end), 'paused', { pause: pz });
      t = Math.min(pz.to!, end);
      cur = null;
      promise = promiseAt(t);
      holdMs = 0;
    }
    follow(cur, t, end, promise, holdMs, live && cur !== null);
    cursor = end;
  }

  if (horizon < W.to) {out.push({ from: Math.max(cursor, horizon), to: W.to, kind: 'beyond' });}

  const inWindow = shown.filter((f) => f.ts <= W.to);
  return {
    intervals: out,
    frames: inWindow,
    at(t: number): Interval | null {
      if (!out.length) {return null;}
      const x = Math.max(out[0].from, Math.min(out[out.length - 1].to - 1e-6, t));
      let lo = 0, hi = out.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (out[mid].from <= x) {lo = mid;} else {hi = mid - 1;}
      }
      return out[lo];
    },
  };
}

/* Pauses with their ends settled and in order: an open pause ends at the
 * first frame at or after its start plus its resumeAfter, else at the
 * horizon. Overlapping pauses are kept as given, in order of start. */
function resolvePauses(pauses: PauseSpan[], frames: Frame[], horizon: number): PauseSpan[] {
  return pauses
    .map((p) => {
      if (p.to != null) {return p;}
      const after = p.from + (p.resumeAfter ?? 0);
      const resume = frames.find((f) => f.ts >= after && f.ts <= horizon);
      return { ...p, to: resume ? resume.ts : horizon };
    })
    .filter((p) => (p.to as number) > p.from)
    .sort((a, b) => a.from - b.from);
}
