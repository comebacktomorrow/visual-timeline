import type { Frame, Slot, TickSlot } from '../types';

/* The hover flipbook (M10b): a slot that holds more than one frame plays
 * them through the magnifier once the cursor has rested on it for DWELL_MS.
 * Nothing loads while the cursor moves: scrubbing a day of strips fetches
 * no more than it did before. Moving to another slot, leaving the strip,
 * pressing, or the crosshair moving from elsewhere stops it, and the
 * magnifier goes back to the slot's own frame. */

/** How long the cursor rests on one slot before it plays: long enough that
 * it has to be meant. */
export const DWELL_MS = 3000;
/** Frames a second while it plays. */
export const FLIP_FPS = 4;

export interface Flipbook {
  /** the cursor is over this slot (or none) */
  hover(slot: Slot | null): void;
  /** stop, and forget the slot */
  stop(): void;
  playing(): boolean;
}

export interface FlipTarget {
  /** the frames taken within [from, to) */
  frames(from: number, to: number): Promise<Frame[]>;
  /** show this frame in the magnifier, with its caption */
  show(f: Frame, i: number, n: number): void;
  /** playing started (true) or stopped (false): restore the magnifier */
  playingChanged(on: boolean): void;
}

/** `anySlot`: arm on every slot that shows a frame, not only those known to
 * hold several (a backend that can fetch a slot's frames again: a thinned
 * answer may not say how many it had). */
export function makeFlipbook(target: FlipTarget, anySlot = false): Flipbook {
  let current: TickSlot | null = null;
  let dwell: ReturnType<typeof setTimeout> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let seq = 0;

  function halt(): void {
    seq++;
    if (dwell) { clearTimeout(dwell); dwell = null; }
    if (timer) { clearInterval(timer); timer = null; target.playingChanged(false); }
  }

  async function start(sl: TickSlot): Promise<void> {
    const mine = ++seq;
    let frames: Frame[] = [];
    try { frames = await target.frames(sl.x0, sl.x0 + sl.span); } catch { return; }
    if (mine !== seq || !current || current.x0 !== sl.x0) {return;}
    frames = frames.filter((f) => f.ts >= sl.x0 && f.ts < sl.x0 + sl.span).sort((a, b) => a.ts - b.ts);
    if (frames.length < 2) {return;}
    // the next few load ahead of the one shown
    const preload = (i: number) => { for (let k = 1; k <= 3; k++) { const p = new Image(); p.src = frames[(i + k) % frames.length].url; } };
    let i = 0;
    target.playingChanged(true);
    target.show(frames[0], 0, frames.length);
    preload(0);
    timer = setInterval(() => {
      i = (i + 1) % frames.length;
      target.show(frames[i], i, frames.length);
      preload(i);
    }, 1000 / FLIP_FPS);
  }

  return {
    hover(slot) {
      const sl = slot && !slot.paused && !slot.beyond && (slot.count > 1 || (anySlot && slot.frame)) ? slot : null;
      // resting on the same slot (by its time: the live poll rebuilds slots)
      // lets the dwell run on
      if (sl === current || (sl && current && sl.x0 === current.x0 && sl.ts === current.ts)) {return;}
      halt();
      current = sl;
      if (sl) {dwell = setTimeout(() => { dwell = null; void start(sl); }, DWELL_MS);}
    },
    stop() { halt(); current = null; },
    playing: () => timer !== null,
  };
}
