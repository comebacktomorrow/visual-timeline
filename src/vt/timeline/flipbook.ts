import { MAX_RATE, type ClipSpan, type Reel, type ReelAt, type ReelSlot } from '../model/reel';
import type { Slot, TickSlot } from '../types';
import { preloadAfter } from '../ui/media';

/* The hover flipbook (M10b): a slot that holds more than one frame plays
 * them through the magnifier once the cursor has rested on it for DWELL_MS:
 * the slot's reel (model/reel.ts), as the preview player plays it, gaps and
 * their reasons included.
 * Nothing loads while the cursor moves: scrubbing a day of strips fetches
 * no more than it did before. Moving to another slot, leaving the strip,
 * pressing, or the crosshair moving from elsewhere stops it, and the
 * magnifier goes back to the slot's own frame.
 * The mount's teardown stops it too (a refresh swaps the strip out from under
 * a resting cursor, which never gets mouseleave): the mount's destroy() stops
 * every card's flipbook, and a flipbook whose mount is gone (target.alive)
 * neither starts, after its dwell or its reel's load, nor ticks on.
 * A slot a video clip covers (M10c) plays the clip's part of it instead,
 * the smaller version, muted, round and round, sped up to be watched in a
 * few seconds. Only a clip that comes in two sizes has a smaller one: with
 * one size (a 13 MB daily movie, say), resting flips the stills, as it does
 * zoomed out, where a slot holds more video than that; one with only video
 * plays it as fast as it goes. */

/** How long the cursor rests on one slot before it plays: long enough that
 * it has to be meant. */
export const DWELL_MS = 3000;
/** Frames a second while it plays. */
export const FLIP_FPS = 4;
/** At most this many frames for a slot it plays: the source thins the rest. */
export const FLIP_MAX = 100;

export interface Flipbook {
  /** the cursor is over this slot (or none) */
  hover(slot: Slot | null): void;
  /** stop, and forget the slot */
  stop(): void;
  playing(): boolean;
}

export interface FlipTarget {
  /** the slot's reel (model/reel.ts: what the preview player plays too) */
  reel(slot: ReelSlot): Reel;
  /** show what's in force at a stop (a frame, or a gap with its reason) in
   * the magnifier; i of n stops */
  show(at: ReelAt, t: number, i: number, n: number): void;
  /** playing started (true) or stopped (false): restore the magnifier */
  playingChanged(on: boolean): void;
  /** play a clip's part of the slot in the magnifier, round and round, at
   * `rate` (null: stop it) */
  clip?(span: ClipSpan | null, rate?: number): void;
  /** learn how long the reel's clips play (clipLength.ts) */
  measure?(reel: Reel): Promise<unknown>;
  /** false once the mount is torn down: nothing more starts or plays */
  alive?(): boolean;
}

/** `anySlot`: arm on every slot that shows a frame, not only those known to
 * hold several (a backend that can fetch a slot's frames again: a thinned
 * answer may not say how many it had). */
export function makeFlipbook(
  target: FlipTarget, anySlot = false, hasClip: (sl: TickSlot) => boolean = (sl) => !!sl.clip, autoSpeed = false
): Flipbook {
  let current: TickSlot | null = null;
  let dwell: ReturnType<typeof setTimeout> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let clipOn = false;
  let seq = 0;
  const alive = () => target.alive?.() ?? true;

  function halt(): void {
    seq++;
    if (dwell) { clearTimeout(dwell); dwell = null; }
    if (timer) { clearInterval(timer); timer = null; target.playingChanged(false); }
    if (clipOn) { clipOn = false; target.clip?.(null); target.playingChanged(false); }
  }

  /* the slot's reel, at most FLIP_MAX frames, played stop by stop (gaps
   * included, with their reason), round and round */
  async function start(sl: TickSlot): Promise<void> {
    const mine = ++seq;
    if (!alive()) {return;}
    const reel = target.reel({ from: sl.x0, to: sl.x0 + sl.span, ts: sl.ts });
    // video only when every clip in the slot is among what it plays
    reel.capacity = FLIP_MAX;
    const ok = await reel.load(FLIP_MAX);
    if (!ok || mine !== seq || !current || current.x0 !== sl.x0 || !alive()) {return;}
    if (reel.clips.length) {await target.measure?.(reel);}
    if (mine !== seq || !current || current.x0 !== sl.x0 || !alive()) {return;}
    // no clip with a smaller version: none to play here, so the stills
    if (!reel.clips.some((c) => c.hi)) {reel.capacity = 0;}
    // a clip plays over stills: the one at the slot's tick (the one the
    // strip shows), else the longest part of one in the slot. Too much video
    // to watch: the stills, unless there are none
    const rate = reel.videoRate();
    const all = reel.clipSpans();
    const spans = (rate === null ? all : reel.watched()).sort((a, z) => (z.to - z.from) - (a.to - a.from));
    const span = all.find((c) => c.from <= sl.ts && sl.ts < c.to) ?? spans[0];
    // a clip with a larger version: its url is the smaller one, fit for a
    // hover; one of a single size isn't loaded for one
    if (span && span.clip.hi && target.clip && (rate !== null || !reel.inSlot().length)) {
      clipOn = true;
      target.playingChanged(true);
      // at 1x unless the panel fits video to its slot; a slot of video too
      // long to play (and no stills) as fast as it goes
      target.clip(span, rate === null ? MAX_RATE : autoSpeed ? rate : 1);
      return;
    }
    const stops = reel.stops(FLIP_MAX);
    if (stops.length < 2) {return;}
    const frames = reel.shown(FLIP_MAX);
    let i = 0;
    // the next few frames load ahead of the one shown
    const showAt = () => { target.show(reel.at(stops[i]), stops[i], i, stops.length); preloadAfter(frames, stops[i]); };
    target.playingChanged(true);
    showAt();
    timer = setInterval(() => {
      if (!alive()) { halt(); current = null; return; }
      i = (i + 1) % stops.length;
      showAt();
    }, 1000 / FLIP_FPS);
  }

  return {
    hover(slot) {
      if (!alive()) { halt(); current = null; return; }
      const sl = slot && !slot.paused && !slot.beyond && (slot.count > 1 || (anySlot && slot.frame) || hasClip(slot)) ? slot : null;
      // resting on the same slot (by its time: the live poll rebuilds slots)
      // lets the dwell run on
      if (sl === current || (sl && current && sl.x0 === current.x0 && sl.ts === current.ts)) {return;}
      halt();
      current = sl;
      if (sl) {dwell = setTimeout(() => { dwell = null; void start(sl); }, DWELL_MS);}
    },
    stop() { halt(); current = null; },
    playing: () => timer !== null || clipOn,
  };
}
