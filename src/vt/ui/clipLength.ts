import type { Reel } from '../model/reel';

/* How long a host's clips play (M10c): what decides whether a slot's video
 * is watched or sampled (Reel.videoRate). A row says when a clip starts and
 * ends, not how long its video is (a day can be seven seconds of
 * timelapse), so the first clip's length is read from its metadata, and the
 * host's other clips are taken to be alike: seconds of video per ms of time,
 * remembered per host. */

/** How long a clip's metadata may take before it's given up on. */
const PROBE_MS = 4000;

/** How many clips' lengths, and hosts' ratios, are remembered: the least
 * recently used go first, so a tab left open for weeks doesn't grow. */
export const REMEMBER_MAX = 500;

/* A map that keeps its REMEMBER_MAX most recently used entries. */
class Recent<V> {
  private readonly m = new Map<string, V>();
  get(k: string): V | undefined {
    const v = this.m.get(k);
    if (v !== undefined) { this.m.delete(k); this.m.set(k, v); }
    return v;
  }
  set(k: string, v: V): void {
    this.m.delete(k);
    this.m.set(k, v);
    if (this.m.size > REMEMBER_MAX) {this.m.delete(this.m.keys().next().value!);}
  }
}

/* seconds of video by URL, and seconds per ms by host */
const lengths = new Recent<number>();
const ratios = new Recent<number>();

/** A clip's length (s), as a video element that loaded it says. */
export function noteClipLength(url: string, seconds: number): void {
  if (Number.isFinite(seconds) && seconds > 0) {lengths.set(url, seconds);}
}

/** A clip's length (s), from its metadata; null if it won't say in time. */
export function clipLength(url: string): Promise<number | null> {
  const known = lengths.get(url);
  if (known) {return Promise.resolve(known);}
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const done = (s: number | null) => {
      if (timer) { clearTimeout(timer); timer = null; } else {return;}
      v.onloadedmetadata = v.onerror = null;
      v.removeAttribute('src');
      try { v.load(); } catch { /* nothing to let go of */ }
      resolve(s);
    };
    v.onloadedmetadata = () => { noteClipLength(url, v.duration); done(lengths.get(url) ?? null); };
    v.onerror = () => done(null);
    timer = setTimeout(() => done(null), PROBE_MS);
    v.src = url;
  });
}

/** Sets a reel's ratio: the host's, else from its first clip's length.
 * True when it changed. */
export async function measureReel(reel: Reel, key?: string): Promise<boolean> {
  if (reel.ratio !== null || !reel.clips.length) {return false;}
  const known = key ? ratios.get(key) : undefined;
  if (known) { reel.ratio = known; return true; }
  const c = reel.clips[0];
  const s = await clipLength(c.url);
  if (!s || reel.ratio !== null) {return false;}
  const r = s / Math.max(1, c.to - c.from);
  if (key) {ratios.set(key, r);}
  reel.ratio = r;
  return true;
}
