import { videoTime, type ClipSpan } from '../model/reel';
import { noteClipLength } from './clipLength';
import { makeVideo, releaseVideo } from './media';
import type { Clip } from '../types';

/* The preview player's video (M10c): the <video> on the stage and a spare
 * that loads the next clip out of sight (like a stream's segments), which
 * takes the stage when the playhead reaches it. A clip is seeked to the
 * playhead once it knows its length; a larger version that won't play falls
 * back to the smaller. A video with no picture yet shows the still under
 * it, and a wait is called loading only once it's lasted a moment and is
 * outside what's buffered. */

/* a wait for video shorter than this (ms) isn't called loading: a seek or
 * a loop back within what's buffered only takes a moment */
const LOADING_AFTER_MS = 600;

/** What the video needs from the player around it. */
export interface PlayerVideoHost {
  /** the popup: its video, loading and no-picture classes */
  el: HTMLElement;
  /** the stage's status text */
  stateEl: HTMLElement;
  /** the viewer's choices, as they change */
  prefs: { muted: boolean; hd: boolean };
  /** the playhead */
  t(): number;
  /** the player is torn down */
  gone(): boolean;
  /** the stage's video has its size (its metadata is in) */
  sized(w: number, h: number): void;
}

export interface PlayerVideo {
  /** the video on the stage (the spare swaps in) */
  readonly video: HTMLVideoElement;
  /** both elements, the stage's first, to put on the stage */
  readonly elements: [HTMLVideoElement, HTMLVideoElement];
  /** the clip at the playhead in the stage's video, seeked to it (unless
   * the video is driving the playhead) */
  show(c: Clip, driving: boolean): void;
  /** the next clip to play, loading in the spare at the start of its part */
  preload(c: ClipSpan | undefined): void;
  /** the stage's video has its metadata and no seek waiting for it */
  ready(): boolean;
  /** a wait for video started (true) or ended (false) */
  waitFor(on: boolean): void;
  /** let go of both downloads, and the loading timer */
  release(): void;
}

export function makePlayerVideo(host: PlayerVideoHost): PlayerVideo {
  const { el, stateEl, prefs } = host;
  let video = makeVideo(prefs.muted, 'metadata');
  // the next clip, loading out of sight while this one plays
  let spare = makeVideo(prefs.muted, 'metadata');
  spare.classList.add('spare');
  const elements: [HTMLVideoElement, HTMLVideoElement] = [video, spare];
  /* the clip in the video element, and where to seek it once it can */
  let vidClip: Clip | null = null;
  let vidSrc = '';
  let pendingT: number | null = null;
  /* the clip loading in the spare, and where it's to start */
  let spareClip: Clip | null = null;
  let spareSrc = '';
  let spareT: number | null = null;

  /* the clip at the playhead in the video element, seeked to t (once it
   * knows its length): the larger version, when HD and the clip has one */
  const srcOf = (c: Clip) => (prefs.hd && c.hi ? c.hi : c.url);
  function show(c: Clip, driving: boolean): void {
    const t = host.t();
    const src = srcOf(c);
    if (src !== vidSrc) {
      if (src === spareSrc) {takeSpare();}
      else {
        vidClip = c;
        vidSrc = src;
        pendingT = t;
        video.src = src;
        return;
      }
    }
    if (driving) {return;}
    if (video.readyState >= 1 && video.duration > 0) {video.currentTime = videoTime(c, t, video.duration);}
    else {pendingT = t;}
  }
  /* the next clip to play, loaded in the spare, at the start of its part */
  function preload(c: ClipSpan | undefined): void {
    if (!c) {return;}
    const src = srcOf(c.clip);
    if (src === vidSrc || src === spareSrc) {return;}
    spareClip = c.clip;
    spareSrc = src;
    spareT = c.from;
    spare.preload = 'auto';
    spare.src = src;
  }
  /* the spare, loaded, takes the stage */
  function takeSpare(): void {
    video.pause();
    video.classList.add('spare');
    spare.classList.remove('spare');
    [video, spare] = [spare, video];
    vidClip = spareClip;
    vidSrc = spareSrc;
    pendingT = null;
    spareClip = null;
    spareSrc = '';
    video.muted = prefs.muted;
    picture();
    waitFor(video.readyState < 3 && video.seeking);
  }
  function wire(v: HTMLVideoElement): void {
    v.addEventListener('loadedmetadata', () => {
      if (host.gone()) {return;}
      if (v !== video) {
        // the next clip, loaded ahead: at the start of its part
        if (spareClip) {noteClipLength(spareClip.url, v.duration);}
        if (spareClip && spareT !== null && v.duration > 0) {v.currentTime = videoTime(spareClip, spareT, v.duration);}
        return;
      }
      host.sized(v.videoWidth, v.videoHeight);
      if (vidClip) {noteClipLength(vidClip.url, v.duration);}
      if (vidClip && pendingT !== null && v.duration > 0) {v.currentTime = videoTime(vidClip, pendingT, v.duration);}
      pendingT = null;
    });
    // a picture once its first frame is in, until its source changes (a
    // seek drops readyState too, but the last picture stays up)
    v.addEventListener('loadstart', () => { delete v.dataset.pic; });
    v.addEventListener('loadeddata', () => { v.dataset.pic = '1'; });
    for (const e of ['waiting', 'seeking', 'loadstart']) {v.addEventListener(e, () => { if (v === video) { picture(); waitFor(v.readyState < 3); } });}
    for (const e of ['loadeddata', 'canplay', 'playing', 'seeked']) {v.addEventListener(e, () => { if (v === video) { picture(); waitFor(v.readyState < 3 && v.seeking); } });}
    // a larger version that won't play: the smaller one
    v.addEventListener('error', () => {
      if (v !== video) { spareSrc = ''; return; }
      if (host.gone() || !vidClip || !vidClip.hi || vidSrc !== vidClip.hi) {return;}
      vidSrc = vidClip.url;
      pendingT = host.t();
      v.src = vidClip.url;
    });
  }
  wire(video);
  wire(spare);
  /* A video with no picture yet (a clip's first load) shows the still under
   * it; once it has one, it keeps showing its last picture while it seeks
   * (a still swapped in for a moment flashed, black if it hadn't loaded). */
  function picture(): void {
    el.classList.toggle('no-picture', !video.dataset.pic);
  }
  /* A wait for video (a large file, a slow server, a seek that needs more of
   * it) is called loading only once it's lasted a moment: seeks and loops
   * within what's buffered don't flicker the message. */
  let waitTimer: ReturnType<typeof setTimeout> | null = null;
  function waitFor(on: boolean): void {
    if (!on) {
      if (waitTimer) { clearTimeout(waitTimer); waitTimer = null; }
      loading(false);
      return;
    }
    if (waitTimer || el.classList.contains('loading')) {return;}
    waitTimer = setTimeout(() => {
      waitTimer = null;
      // a seek within what's downloaded is decoding, not loading (fast
      // scrubbing keeps the video seeking all the time)
      if (!host.gone() && video.readyState < 3 && !buffered(video, video.currentTime)) {loading(true);}
    }, LOADING_AFTER_MS);
  }
  // a video still on its way says so, over its last picture
  function loading(on: boolean): void {
    if (el.classList.contains('loading') === on) {return;}
    el.classList.toggle('loading', on);
    if (el.classList.contains('video')) {stateEl.textContent = on ? 'loading video…' : '';}
  }

  return {
    get video() { return video; },
    elements,
    show,
    preload,
    ready: () => video.readyState >= 1 && pendingT === null,
    waitFor,
    release() {
      // let go of the videos' downloads
      for (const v of [video, spare]) {releaseVideo(v);}
      if (waitTimer) {clearTimeout(waitTimer);}
    },
  };
}

/* whether a video has a time downloaded (with a little after it) */
function buffered(v: HTMLVideoElement, s: number): boolean {
  for (let i = 0; i < v.buffered.length; i++) {
    if (v.buffered.start(i) <= s && s < v.buffered.end(i) - 0.1) {return true;}
  }
  return false;
}
