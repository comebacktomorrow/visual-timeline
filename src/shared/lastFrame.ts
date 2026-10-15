/* The last frame a host took in a time range, and what state the host was in
 * at the range's end: what a Table or Canvas panel shows when a query asks
 * for the last frame. "Last in the range", not "latest": with the range
 * ending now it is the live frame, and with a past range it is the frame at
 * that range's end, as Grafana's Stat panel reads "Last". Pure apart from the
 * frames call, so it is unit-tested with a fake API. */
import { erasFor } from '../vt/model/eras';
import type { Backend, Frame, SourceDecl } from '../vt/types';

/* The most buckets one coarse search asks for (the reference worker allows
 * 800), as the timeline's resume probe. */
const PROBE_BUCKETS = 400;

export type HostStatus = 'live' | 'offline' | 'paused';

export interface LastFrame {
  frame: Frame | null;
  status: HostStatus;
  /** The declared pause's reason, when status is paused. */
  reason?: string;
}

/** The newest frame at or before `end` and not before `from`. */
function newest(frames: Frame[], from: number, end: number): Frame | null {
  let best: Frame | null = null;
  for (const f of frames) {
    // the API snaps its window out to whole steps, so frames past end come back
    if (f.ts < from || f.ts > end) {continue;}
    if (!best || f.ts > best.ts) {best = f;}
  }
  return best;
}

export async function lastFrameIn(
  decl: SourceDecl, from: number, end: number, backend: Pick<Backend, 'frames'>
): Promise<LastFrame> {
  const eras = erasFor(decl, { from, to: end });
  const era = eras[eras.length - 1];
  // the pace in force at the end (a pause keeps the pace it interrupted)
  const cadence = era.cadence;

  // the common case: the host is live and its last frame is a tick or two old
  let frame = newest(await backend.frames(decl.site, decl.id, Math.max(from, end - 3 * cadence), end, cadence), from, end);
  if (!frame && end - from > 3 * cadence) {
    // otherwise the newest step that has a frame, coarsely, then the exact
    // frame within it (the API returns the frame nearest each step's tick)
    const step = cadence * Math.max(1, Math.ceil((end - from) / cadence / PROBE_BUCKETS));
    frame = newest(await backend.frames(decl.site, decl.id, from, end, step), from, end);
    if (frame && step > cadence) {
      const near = frame;
      const fine = await backend.frames(decl.site, decl.id, near.ts, Math.min(end, near.ts + step), cadence);
      frame = newest(fine, near.ts, end) || near;
    }
  }

  // a declared pause holds until a frame arrives a tick or more into it: a
  // host's goodbye frame, taken as it pauses, doesn't end it (as the
  // timeline's resume probe, slots.ts)
  if (era.paused && !(frame && frame.ts >= era.from + cadence)) {
    return { frame, status: 'paused', reason: era.reason };
  }
  // offline once a full tick past the next one is missing, as the timeline
  // turns a pending slot into a gap
  return { frame, status: frame && end - frame.ts <= 2 * cadence ? 'live' : 'offline' };
}
