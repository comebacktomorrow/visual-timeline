import { clipTime, playVideo, videoTime, type ClipSpan } from '../model/reel';
import type { Frame } from '../types';

/* The media pieces the player, the hover flipbook's magnifier and the clip
 * probe share: a <video> made and let go of, a clip's part of a slot played
 * round and round, and frames loaded ahead. No image sends a Referer (the
 * dashboard's URL) to wherever the frames are. */

/** A muted-or-not, inline <video>; `preload` when given. */
export function makeVideo(muted: boolean, preload?: '' | 'none' | 'metadata' | 'auto'): HTMLVideoElement {
  const v = document.createElement('video');
  v.muted = muted;
  v.playsInline = true;
  if (preload !== undefined) {v.preload = preload;}
  return v;
}

/** Stops a video and lets go of its download (removing its src and loading
 * nothing). */
export function releaseVideo(v: HTMLVideoElement): void {
  if (!v.paused) {v.pause();}
  v.removeAttribute('src');
  try { v.load(); } catch { /* nothing to let go of */ }
}

export interface LoopHooks {
  /** the video's metadata is in (before it's first seeked) */
  metadata?(v: HTMLVideoElement): void;
  /** the time (epoch ms) the video is at, as it plays */
  time?(t: number): void;
}

/** Plays `span`'s part of its clip in `v` (loading the clip's url), at
 * `rate`, round and round: back to the part's start at its end, or the
 * video's. Returns the stop: the video's handlers are cleared (let go of
 * the video itself with releaseVideo). */
export function loopClipSpan(v: HTMLVideoElement, span: ClipSpan, rate: number, hooks: LoopHooks = {}): () => void {
  const from = () => videoTime(span.clip, span.from, v.duration);
  const to = () => videoTime(span.clip, span.to, v.duration);
  const again = () => { v.currentTime = from(); v.playbackRate = rate; playVideo(v).catch(() => {}); };
  v.onloadedmetadata = () => { hooks.metadata?.(v); again(); };
  v.ontimeupdate = () => {
    hooks.time?.(clipTime(span.clip, v.currentTime, v.duration));
    if (v.currentTime >= to() - 0.05) {again();}
  };
  v.onended = again;
  v.src = span.clip.url;
  return () => { v.onloadedmetadata = v.ontimeupdate = v.onended = null; };
}

/** An image loading `url` out of sight (a frame wanted soon), sending no
 * Referer. */
export function loadImage(url: string, onload?: () => void): HTMLImageElement {
  const p = new Image();
  p.referrerPolicy = 'no-referrer';
  if (onload) {p.onload = onload;}
  p.src = url;
  return p;
}

/** The next `n` frames after `t` load ahead of being shown (round to the
 * first after the last). */
export function preloadAfter(frames: Frame[], t: number, n = 3): void {
  const j = Math.max(0, frames.findIndex((f) => f.ts > t));
  for (let k = 0; k < n && frames.length; k++) {loadImage(frames[(j + k) % frames.length].url);}
}
