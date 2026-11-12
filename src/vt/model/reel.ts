import type { Interval, IntervalKind } from './intervals';
import { frameIndexAt } from './playhead';
import type { Clip, Frame, TimeWindow } from '../types';

/* A slot's reel (M10): what the preview player and the hover flipbook both
 * play. One slot of a host's strip; the frames taken within it (fetched once,
 * no finer than asked for), and the one in force at its start; the stretches
 * they make (frames, dropped, no data, pauses); what's in force at a time;
 * the frames shown when there are more than a view can draw (evenly through
 * the slot); and its stops (each frame shown, and the start of each stretch
 * without one, so a gap is shown with its reason, not skipped).
 * Video clips (M10c) play over stills when the slot's video is short enough
 * to watch (PLAY_TARGET_S, sped up as much as MAX_RATE): where a clip covers
 * the slot, it's what's in force, its span one stop played as video, and
 * the stills under it are left out. Zoomed out, when it's longer than that,
 * the slot is played as a slot of frames is: its stills, sampled to what
 * fits, and where there are none under a clip, the video's own frames at
 * evenly spaced stops. Pure: no DOM, no timers. */

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
  /** names the host, for what's learned about its clips (their length) */
  key?: string;
  /** the host's frames in [from, to], as the mount has them (perhaps thinned) */
  fetch(from: number, to: number): Promise<Frame[]>;
  /** a span's frames asked for again, at most maxPoints, thinned by the
   * source (each kept frame's count says how many it stands for) */
  detail?(from: number, to: number, maxPoints?: number): Promise<Frame[]>;
  /** the host's video clips overlapping [from, to] (M10c) */
  clips?(from: number, to: number): Promise<Clip[]>;
  /** the intervals for frames (and clips) over a range, judged at `sample`
   * (the interval they were asked for at; 0: exactly) */
  intervals(frames: Frame[], range: TimeWindow, sample?: number, clips?: Clip[]): Interval[];
}

/** A clip's part within a slot: [from, to). */
export interface ClipSpan {
  clip: Clip;
  from: number;
  to: number;
}

/** Where in a clip's video a time is (s), for a video `duration` s long: its
 * fraction of the way through the clip, of the video. A clip of real time
 * and a timelapse map alike. */
export function videoTime(clip: Clip, t: number, duration: number): number {
  const f = (t - clip.from) / Math.max(1, clip.to - clip.from);
  return Math.max(0, Math.min(1, f)) * duration;
}

/** Plays a video, as a promise whatever the browser returns (an old one,
 * or a test's DOM, returns nothing). */
export function playVideo(v: HTMLMediaElement): Promise<void> {
  try { return Promise.resolve(v.play()); } catch (e) { return Promise.reject(e); }
}

/** The time a point in a clip's video stands for: videoTime's inverse. */
export function clipTime(clip: Clip, seconds: number, duration: number): number {
  const f = duration > 0 ? seconds / duration : 0;
  return clip.from + Math.max(0, Math.min(1, f)) * (clip.to - clip.from);
}

/** What's in force at a time. */
export interface ReelAt {
  frame: Frame | null;
  interval: Interval | null;
  kind: IntervalKind;
  /** a stretch without a frame: dropped, no data or a pause */
  gap: boolean;
  /** the clip's part of the slot, when a clip is in force (kind 'clip') */
  span?: ClipSpan;
}

/** A slot's video is watched when it plays in at most this long (s)... */
export const PLAY_TARGET_S = 10;
/** ...sped up at most this much (as fast as browsers play). */
export const MAX_RATE = 16;

const isGap = (k: IntervalKind) => k === 'dropped' || k === 'nodata' || k === 'paused';

export class Reel {
  /** the slot's frames, and the one in force at its start */
  frames: Frame[] = [];
  /** the stretches over the slot */
  intervals: Interval[] = [];
  /** the video clips over the slot */
  clips: Clip[] = [];
  /** seconds of video per ms of the time a clip covers (a host's clips are
   * alike: a timelapse's few, real time's a thousandth), once a clip's
   * length is known; null until then */
  ratio: number | null = null;
  /** the most items the view can tell apart (the player's ticks): video is
   * played only when every clip in the slot is one of them */
  capacity = Infinity;
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
    let clips: Clip[] = [];
    let sample: number | undefined;
    try {
      if (this.src.clips) {clips = await this.src.clips(from, to);}
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
    this.clips = clips.filter((c) => c.to > from && c.from < to).sort((a, z) => a.from - z.from);
    this.intervals = this.src.intervals(this.frames, { from, to }, sample, this.clips);
    return true;
  }

  /** the clips' parts of the slot, in order, not overlapping (where two
   * overlap, the later one from its start) */
  clipSpans(): ClipSpan[] {
    const out: ClipSpan[] = [];
    const { from, to } = this.slot;
    this.clips.forEach((c, i) => {
      const next = this.clips[i + 1];
      const a = Math.max(c.from, from), b = Math.min(c.to, to, next ? Math.max(next.from, from) : Infinity);
      if (b > a) {out.push({ clip: c, from: a, to: b });}
    });
    return out;
  }

  /** how much video the slot holds (s), once a clip's length is known */
  videoSeconds(): number | null {
    if (this.ratio === null) {return null;}
    return this.clipSpans().reduce((a, c) => a + (c.to - c.from) * this.ratio!, 0);
  }

  /** how fast the slot's video plays to be watched in PLAY_TARGET_S: 1, or
   * faster, up to MAX_RATE; null when it's longer than that, or holds more
   * clips than the view can show (zoomed out: the slot is sampled, as
   * frames are; leaving clips out would break the video's flow). Its length
   * unknown yet, 1. */
  videoRate(): number | null {
    if (this.clipSpans().length > this.capacity) {return null;}
    const v = this.videoSeconds();
    if (v === null || v <= PLAY_TARGET_S) {return 1;}
    return v <= PLAY_TARGET_S * MAX_RATE ? v / PLAY_TARGET_S : null;
  }

  /** the clips' parts that play over the stills: all, while the slot's
   * video is short enough to watch; none when it's sampled */
  watched(): ClipSpan[] {
    return this.videoRate() === null ? [] : this.clipSpans();
  }

  /** the picture for a clip's part (the still nearest its start, within
   * it, else the one in force there): our thumbnails are the stills */
  stillFor(c: ClipSpan): Frame | null {
    const inside = this.frames.find((f) => f.ts >= c.from && f.ts < c.to);
    if (inside) {return inside;}
    const j = frameIndexAt(this.frames, c.from);
    return j >= 0 ? this.frames[j] : null;
  }

  /** the watched clip's part of the slot in force at t, if any */
  clipAt(t: number): ClipSpan | null {
    return this.watched().find((c) => c.from <= t && t < c.to) ?? null;
  }

  /** what plays: more than one stop, or a clip */
  playable(n: number): boolean {
    return this.stops(n).length > 1 || this.watched().length > 0;
  }

  /** the frames taken within the slot, but for those a clip plays over */
  inSlot(): Frame[] {
    const spans = this.watched();
    return this.frames.filter((f) => f.ts >= this.slot.from && f.ts < this.slot.to && !spans.some((c) => c.from <= f.ts && f.ts < c.to));
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

  /** the stretches without a frame, within the slot (but where a clip plays
   * over them) */
  gaps(): Interval[] {
    const spans = this.watched();
    const out: Interval[] = [];
    for (const iv of this.intervals) {
      if (!isGap(iv.kind) || iv.to <= this.slot.from || iv.from >= this.slot.to) {continue;}
      // what the clips leave of it
      let pieces: Array<[number, number]> = [[iv.from, iv.to]];
      for (const c of spans) {
        pieces = pieces.flatMap(([a, b]): Array<[number, number]> => (c.to <= a || c.from >= b ? [[a, b]]
          : [...(c.from > a ? [[a, c.from] as [number, number]] : []), ...(c.to < b ? [[c.to, b] as [number, number]] : [])]));
      }
      for (const [a, b] of pieces) {out.push({ ...iv, from: a, to: b });}
    }
    return out;
  }

  /** the stops: each of the n frames shown, the start of each gap, and the
   * start of each watched clip's part; sampled, a share of n through each
   * stretch only a clip covers (the video's own frames) */
  stops(n: number): number[] {
    const out = new Set(this.shown(n).map((f) => f.ts));
    for (const g of this.gaps()) {out.add(Math.max(g.from, this.slot.from));}
    for (const c of this.watched()) {out.add(c.from);}
    if (this.videoRate() === null) {
      const { from, to } = this.slot;
      for (const iv of this.intervals) {
        if (iv.kind !== 'clip' || iv.to <= from || iv.from >= to) {continue;}
        const a = Math.max(iv.from, from), b = Math.min(iv.to, to);
        const k = Math.max(1, Math.round((n * (b - a)) / (to - from)));
        for (let i = 0; i < k; i++) {out.add(a + ((b - a) * i) / k);}
      }
    }
    return [...out].sort((a, z) => a - z);
  }

  /** what's in force at t */
  at(t: number): ReelAt {
    const j = frameIndexAt(this.frames, t);
    const frame = j >= 0 ? this.frames[j] : null;
    const span = this.clipAt(t);
    if (span) {return { frame, interval: null, kind: 'clip', gap: false, span };}
    const interval = this.intervals.find((x) => x.from <= t && t < x.to) || null;
    // sampled, where only a clip covers it: the video's frame there
    if (interval?.kind === 'clip') {
      const c = this.clipSpans().find((x) => x.from <= t && t < x.to);
      if (c) {return { frame, interval, kind: 'clip', gap: false, span: c };}
    }
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

  /** the next stop from t, round and round (null with fewer than two,
   * unless the one is a clip: it plays again) */
  cycle(t: number, n: number): number | null {
    const st = this.stops(n);
    if (st.length < 2) {return st.length && this.watched().length ? st[0] : null;}
    const i = st.findIndex((x) => x > t);
    return st[i < 0 ? 0 : i];
  }
}
