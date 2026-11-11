import type { Frame, TimeWindow } from '../types';

/* The preview player's arithmetic (M10): which stretch of time its scrubber
 * covers, and how its playhead moves through a host's frames. Pure. */

/** How far the scrubber reaches: the clicked slot and this many slots either
 * side ('near'), or the dashboard's whole range ('all'). */
export type Reach = 'near' | 'all';
export const NEAR_SLOTS = 10;

/** The scrubber's range for a playhead at `t` with slots `step` long,
 * clamped to the window and to now. */
export function reachRange(reach: Reach, t: number, step: number, P: TimeWindow, now: number): TimeWindow {
  const end = Math.max(P.from + 1, Math.min(P.to, now));
  if (reach === 'all' || !(step > 0)) {return { from: P.from, to: end };}
  const half = (NEAR_SLOTS + 0.5) * step;
  let from = t - half, to = t + half;
  // keep its full width where the window allows: slide rather than shrink
  if (from < P.from) { to += P.from - from; from = P.from; }
  if (to > end) { from -= to - end; to = end; }
  return { from: Math.max(P.from, from), to: Math.max(Math.max(P.from, from) + 1, to) };
}

/** The index of the frame in force at t: the last one at or before it, or -1. */
export function frameIndexAt(frames: Frame[], t: number): number {
  let lo = 0, hi = frames.length - 1, out = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].ts <= t) { out = mid; lo = mid + 1; } else {hi = mid - 1;}
  }
  return out;
}

/** The frame `dir` frames on from the one in force at t, within [from, to]:
 * null at either end. */
export function stepFrame(frames: Frame[], t: number, dir: 1 | -1, range: TimeWindow): Frame | null {
  const i = frameIndexAt(frames, t);
  // before the first frame, the next one is the first
  const j = i < 0 ? (dir > 0 ? 0 : -1) : i + dir;
  const f = frames[j];
  return f && f.ts >= range.from && f.ts <= range.to ? f : null;
}

/** The frames that fall within a range, in order. */
export function framesIn(frames: Frame[], range: TimeWindow): Frame[] {
  return frames.filter((f) => f.ts >= range.from && f.ts <= range.to);
}
