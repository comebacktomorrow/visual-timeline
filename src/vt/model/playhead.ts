import type { Frame } from '../types';

/* The preview player's arithmetic (M10). Pure. */

/** The index of the frame in force at t: the last one at or before it, or -1. */
export function frameIndexAt(frames: Frame[], t: number): number {
  let lo = 0, hi = frames.length - 1, out = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].ts <= t) { out = mid; lo = mid + 1; } else {hi = mid - 1;}
  }
  return out;
}
