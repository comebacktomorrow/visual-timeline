import type { Interval, IntervalKind } from './intervals';
import { frameIndexAt } from './playhead';
import type { Frame, TimeWindow } from '../types';

/* A slot's reel (M10): what the preview player and the hover flipbook both
 * play. One slot of a host's strip; the frames taken within it (fetched once,
 * no finer than asked for), and the one in force at its start; the stretches
 * they make (frames, dropped, no data, pauses); what's in force at a time;
 * the frames shown when there are more than a view can draw (evenly through
 * the slot); and its stops (each frame shown, and the start of each stretch
 * without one, so a gap is shown with its reason, not skipped). Pure: no
 * DOM, no timers. */

/** A slot of the strip: its span, its tick, and the frame the strip shows. */
export interface ReelSlot {
  from: number;
  to: number;
  ts: number;
  frameTs?: number;
}

/** Where a reel's frames come from. */
export interface ReelSource {
  /** the host's slot duration */
  step: number;
  /** the host's frames in [from, to], as the mount has them (perhaps thinned) */
  fetch(from: number, to: number): Promise<Frame[]>;
  /** a span's frames asked for again, at most maxPoints, thinned by the
   * source (each kept frame's count says how many it stands for) */
  detail?(from: number, to: number, maxPoints?: number): Promise<Frame[]>;
  /** the intervals for frames over a range, judged at `sample` (the interval
   * they were asked for at; 0: exactly) */
  intervals(frames: Frame[], range: TimeWindow, sample?: number): Interval[];
}

/** What's in force at a time. */
export interface ReelAt {
  frame: Frame | null;
  interval: Interval | null;
  kind: IntervalKind;
  /** a stretch without a frame: dropped, no data or a pause */
  gap: boolean;
}

const isGap = (k: IntervalKind) => k === 'dropped' || k === 'nodata' || k === 'paused';

export class Reel {
  /** the slot's frames, and the one in force at its start */
  frames: Frame[] = [];
  /** the stretches over the slot */
  intervals: Interval[] = [];
  private seq = 0;

  /** `seed`: a frame to show until the reel loads (the one clicked); it's
   * not kept once the slot's own frames arrive */
  constructor(private readonly src: ReelSource, readonly slot: ReelSlot, seed?: Frame) {
    if (seed) {this.frames = [seed];}
  }

  /** Fetches the slot: at most `points` frames over it and the slot before
   * (for the frame in force at its start), judged at the interval they were
   * asked for at. False when another load started meanwhile. */
  async load(points: number): Promise<boolean> {
    const seq = ++this.seq;
    const { from, to } = this.slot;
    let got: Frame[] = [];
    let sample: number | undefined;
    try {
      if (this.src.detail) {
        const n = Math.max(2, Math.floor(points));
        const all = await this.src.detail(from - this.src.step, to, n);
        sample = Math.ceil((to - from + this.src.step) / n);
        got = [...all.filter((f) => f.ts < from).slice(-1), ...all.filter((f) => f.ts >= from)];
      } else {
        const before = (await this.src.fetch(from - this.src.step * 2, from)).filter((f) => f.ts < from);
        got = [...before.slice(-1), ...(await this.src.fetch(from, to))];
      }
    } catch (e) {
      console.warn('[visual-timeline] fetching a slot\'s frames failed:', e);
    }
    if (seq !== this.seq) {return false;}
    const byTs = new Map<number, Frame>();
    for (const f of got) {byTs.set(f.ts, f);}
    // nothing came back: keep the frame it was seeded with
    if (!byTs.size) {for (const f of this.frames) {byTs.set(f.ts, f);}}
    this.frames = [...byTs.values()].sort((a, z) => a.ts - z.ts);
    this.intervals = this.src.intervals(this.frames, { from, to }, sample);
    return true;
  }

  /** the frames taken within the slot */
  inSlot(): Frame[] {
    return this.frames.filter((f) => f.ts >= this.slot.from && f.ts < this.slot.to);
  }

  /** the frame in force before the slot's first (from before it) */
  prior(): Frame | null {
    return this.frames.filter((f) => f.ts < this.slot.from).pop() ?? null;
  }

  /** how many frames the slot holds: more than it has when the source thinned
   * them (each kept frame's count) */
  total(): number {
    return this.inSlot().reduce((a, f) => a + (f.count && f.count > 1 ? f.count : 1), 0);
  }

  /** the slot's frames, at most n of them, evenly through it */
  shown(n: number): Frame[] {
    const fs = this.inSlot();
    if (fs.length <= n) {return fs;}
    const out: Frame[] = [];
    for (let i = 0; i < n; i++) {out.push(fs[Math.floor((i * fs.length) / n)]);}
    return out;
  }

  /** the stretches without a frame, within the slot */
  gaps(): Interval[] {
    return this.intervals.filter((iv) => isGap(iv.kind) && iv.to > this.slot.from && iv.from < this.slot.to);
  }

  /** the stops: each of the n frames shown, and the start of each gap */
  stops(n: number): number[] {
    const out = new Set(this.shown(n).map((f) => f.ts));
    for (const g of this.gaps()) {out.add(Math.max(g.from, this.slot.from));}
    return [...out].sort((a, z) => a - z);
  }

  /** what's in force at t */
  at(t: number): ReelAt {
    const j = frameIndexAt(this.frames, t);
    const frame = j >= 0 ? this.frames[j] : null;
    const interval = this.intervals.find((x) => x.from <= t && t < x.to) || null;
    const kind: IntervalKind = interval ? interval.kind : frame ? 'frame' : 'nodata';
    return { frame, interval, kind, gap: isGap(kind) };
  }

  /** the stop `dir` on from t (null at either end) */
  step(t: number, dir: 1 | -1, n: number): number | null {
    const st = this.stops(n);
    const i = st.findIndex((x) => x > t);
    const cur = i < 0 ? st.length - 1 : i - 1;
    return st[dir > 0 ? cur + 1 : cur - 1] ?? null;
  }

  /** the next stop from t, round and round (null with fewer than two) */
  cycle(t: number, n: number): number | null {
    const st = this.stops(n);
    if (st.length < 2) {return null;}
    const i = st.findIndex((x) => x > t);
    return st[i < 0 ? 0 : i];
  }
}
