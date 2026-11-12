import { pauseInfo } from '../model/eras';
import { clipTime, playVideo, Reel, videoTime, type ClipSpan, type ReelSlot, type ReelSource } from '../model/reel';
import { FRAME_WIDTH } from './frameWidth';
import { measureReel } from './clipLength';
import { loadImage, preloadAfter } from './media';
import { fmtRate, FPS, loadPrefs, savePrefs, SPEEDS, type ScrubStyle } from './playerPrefs';
import { makePlayerVideo } from './playerVideo';
import { makeScrubber } from './scrubber';
import type { ZoneTexts } from '../zones/source';
import type { Frame, TimeWindow } from '../types';

/* The preview player (M10): the click-in preview, with the slot's own
 * timeline under it. A slot of the strip can show one frame; the player shows
 * the rest, from the slot's reel (model/reel.ts, which the hover flipbook
 * plays too). Its scrubber spans just the current slot: a tick per frame at
 * its true time (and, as thumbnails, the frames themselves), over the
 * stretches the strip draws (dropped, no data, pauses). Hovering, clicking,
 * dragging, previous and next and Play all stay within the slot, and the
 * dashboard's crosshair stays still; stepping and playing stop on a gap too,
 * showing its reason. Only ‹‹ ›› (Shift+←/→) move to the neighbouring slot,
 * and the crosshair with it; Zoom sets the dashboard's range to the slot.
 * Only the frame under the playhead loads, and the slot's frames while it
 * plays.
 * A video clip over the slot (M10c) plays over its stills: its part of the
 * slot is a plain bar on the scrubber, hovering it seeks the video, and Play
 * plays it (round again at the slot's end), muted unless unmuted. HD plays
 * the clip's larger version when it has one. A slot holding more video than
 * plays in a few seconds (zoomed out) is played as a slot of frames is: its
 * stills, sampled, and the video's own frames where it has none; Zoom shows
 * the video. So does one holding more clips than its timeline can show:
 * video is played whole, never with clips left out. Several clips play one
 * after another, the next loading out of sight (like a stream's segments);
 * each has a tick and, as thumbnails, the still nearest its start. */

export type { ScrubStyle } from './playerPrefs';

/** A slot of the host's strip, as the player needs it. */
export type PlayerSlot = ReelSlot;

/** What the player needs from the mount that opened it: where the slot's
 * frames come from (a reel's source), and the mount around it. */
export interface PlayerContext extends ReelSource {
  /** the dashboard's window */
  window: TimeWindow;
  /** the strip's slot at a time */
  slotAt(t: number): PlayerSlot | null;
  /** the player moved to another slot: the mount moves its crosshair */
  onTime?(t: number): void;
  /** set the dashboard's time range to a span (the timeline's drag-zoom) */
  onZoom?(from: number, to: number): void;
  tt: ZoneTexts;
  /** what the title names: "site / host" */
  label?: string;
  /** the panel's default scrubber style; the viewer's last choice wins */
  scrubber?: ScrubStyle;
  /** the least width a frame gets (the panel's Frame width): the ticks' spacing */
  frameWidth?: number;
  /** video starts at the speed that fits a slot's video into ~10 s; unset, 1x */
  autoSpeed?: boolean;
}


/* A slot can hold more frames than its timeline can tell apart. It shows at
 * most a frame per Frame width (the strip's own rule, FRAME_WIDTH by default),
 * evenly through the slot, whichever the style: those are its ticks, what it
 * steps and plays through, and what it fetches (no finer). As thumbnails,
 * fewer of them (scrubber.ts). Zoom shows them all (most() in mountPlayer).
 * The scrubber is scrubber.ts; the video and its spare, playerVideo.ts; the
 * remembered choices, playerPrefs.ts. */
/* a clip's part of a slot shorter than this (s of video) isn't played */
const MIN_CLIP_S = 0.25;
/* the popup's size (size() in mountPlayer) */
const STAGE_H = 405;
const MIN_W = 400;
const MAX_W = 960;

/* icons: the scrubber's two styles, and Zoom */
const ICON_TICKS = '<svg viewBox="0 0 16 12" width="16" height="12" aria-hidden="true"><path d="M2 2v8M5 4v6M8 1v9M11 5v5M14 3v7" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>';
const ICON_THUMBS = '<svg viewBox="0 0 16 12" width="16" height="12" aria-hidden="true"><rect x="1" y="1" width="14" height="10" rx="1" stroke="currentColor" stroke-width="1.2" fill="none"/><circle cx="11" cy="4" r="1.3" fill="currentColor"/><path d="M2.5 9.5l3.5-4 2.5 2.5 1.5-1.5 3 3z" fill="currentColor"/></svg>';
const ICON_MUTED = '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M2 6h3l4-3v10l-4-3H2z" fill="currentColor"/><path d="M11 6l4 4M15 6l-4 4" stroke="currentColor" stroke-width="1.5"/></svg>';
const ICON_SOUND = '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M2 6h3l4-3v10l-4-3H2z" fill="currentColor"/><path d="M11 5.5c1.2 1.2 1.2 3.8 0 5M13 3.5c2.2 2.4 2.2 6.6 0 9" stroke="currentColor" stroke-width="1.3" fill="none"/></svg>';
const ICON_ZOOM = '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" stroke-width="1.5" fill="none"/><path d="M10 10l4.5 4.5M4.5 6.5h4M6.5 4.5v4" stroke="currentColor" stroke-width="1.5"/></svg>';

/* an element that takes typing: its keys are its own */
const typing = (target: EventTarget | null): boolean =>
  target instanceof Element && !!target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');

const btn = (a: string, label: string, title: string) =>
  `<button type="button" data-a="${a}" title="${title}" aria-label="${title}">${label}</button>`;

/** A player's teardown; rebind() hands it the context of the mount that
 * adopted it (a refresh remount: preview.ts), so ‹‹ ›› step that mount's
 * slots and onTime moves its crosshair. */
export type PlayerTeardown = (() => void) & { rebind(ctx: PlayerContext): void };

/** Builds the player into `el` (the popup) at `startTs`, showing `start`
 * (the frame clicked; null for a clip's slot, M10c) until the slot loads;
 * returns its teardown. `place` re-positions the popup once the image or
 * video has a size. */
export function mountPlayer(
  el: HTMLElement, start: Frame | null, ctx: PlayerContext, place: () => void, close: () => void = () => {}, startTs = start?.ts ?? 0
): PlayerTeardown {
  const prefs = loadPrefs(ctx.scrubber);
  el.classList.add('player');
  // the static on top (what this is, Zoom, close); the playback below (the
  // frame's time, the transport, how the timeline draws and its speed)
  el.innerHTML =
    '<div class="top">' +
    (ctx.onZoom ? btn('zoom', ICON_ZOOM, 'Zoom the dashboard to this slot') : '<span></span>') +
    '<span class="title"></span>' +
    btn('close', '✕', 'Close (Esc)') +
    '</div>' +
    // what the stage says (loading video…, offline, a pause) is read out
    '<div class="stage"><div class="state" aria-live="polite"></div>' +
    (ctx.onZoom ? '<button type="button" class="zoom-video" data-a="zoom-video">▶ Zoom in for the video</button>' : '<span class="zoom-video">▶ Video at a closer zoom</span>') +
    '</div>' +
    '<div class="scrub" role="slider" tabindex="0" aria-label="The frames in this slot">' +
    '<div class="lanes"></div><div class="thumbs"></div><div class="ticks"></div><div class="head"></div></div>' +
    '<div class="bar">' +
    '<span class="time"></span>' +
    '<span class="transport">' +
    btn('prev-slot', '‹‹', 'Previous slot (Shift+←)') + btn('prev', '‹', 'Previous frame in this slot (←)') +
    btn('play', '▶', 'Play the frames in this slot (Space)') + btn('next', '›', 'Next frame in this slot (→)') +
    btn('next-slot', '››', 'Next slot (Shift+→)') +
    '</span>' +
    '<span class="opts">' +
    btn('mute', '', 'Sound') + btn('hd', 'HD', 'Video quality') +
    btn('style-ticks', ICON_TICKS, 'Scrubber: a tick per frame') + btn('style-thumbs', ICON_THUMBS, 'Scrubber: the frames as pictures') +
    btn('fps', '', 'Speed') +
    '</span>' +
    '</div>';
  // the image goes in with its source already set
  const img = document.createElement('img');
  img.alt = 'frame';
  img.referrerPolicy = 'no-referrer';
  if (start) {img.src = start.url;}
  const stateEl = el.querySelector<HTMLElement>('.stage .state')!;
  // a clip plays here, over the image (M10c), the next one loading in a spare
  const media = makePlayerVideo({
    el, stateEl, prefs,
    t: () => t,
    gone: () => gone,
    sized: (w, h) => { size(w, h); place(); },
  });
  el.querySelector('.stage')!.prepend(img, ...media.elements);
  const titleEl = el.querySelector<HTMLElement>('.title')!;
  const timeEl = el.querySelector<HTMLElement>('.time')!;
  const b = (a: string) => el.querySelector<HTMLButtonElement>(`button[data-a="${a}"]`)!;

  /* the slot the player is in, as a reel; the playhead */
  const firstSlot: PlayerSlot = ctx.slotAt(startTs) ?? { from: startTs - ctx.step / 2, to: startTs + ctx.step / 2, ts: startTs };
  let reel = new Reel(ctx, firstSlot, start ?? undefined);
  let t = startTs;
  let playing = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /* the video is playing, and moves the playhead (not the other way round) */
  let driving = false;
  let raf = 0;
  /* a play waiting for the video's metadata: one at a time, so toggling
   * Play before it arrives doesn't stack starts (and rAF loops) */
  let pendingGo: { v: HTMLVideoElement; h: () => void; timer: ReturnType<typeof setTimeout> | null } | null = null;
  function cancelGo(): void {
    if (!pendingGo) {return;}
    pendingGo.v.removeEventListener('loadedmetadata', pendingGo.h);
    if (pendingGo.timer) {clearTimeout(pendingGo.timer);}
    pendingGo = null;
  }
  /* the video's speed the viewer chose, for this slot; null: what fits it */
  let speed: number | null = null;
  /* the slot's video plays: the speed button sets how fast */
  const videoMode = () => reel.watched().length > 0;
  const rateNow = () => speed ?? (ctx.autoSpeed ? reel.videoRate() ?? 1 : 1);
  let hiTimer: ReturnType<typeof setTimeout> | null = null;
  let gone = false;

  /* the slot's own timeline: it follows the mouse (pausing playback), and
   * steps with its own keys */
  const scrubber = makeScrubber(el.querySelector<HTMLElement>('.scrub')!, {
    reel: () => reel,
    most: () => most(),
    style: () => prefs.style,
    seekTo: (to) => { if (playing) {stop();} seek(to); },
    step: (dir) => act(dir > 0 ? 'next' : 'prev'),
  });
  /* how many of the slot's frames it shows: the same in either style */
  const tickPx = () => (ctx.frameWidth && ctx.frameWidth > 0 ? ctx.frameWidth : FRAME_WIDTH);
  const most = () => Math.max(4, Math.floor(scrubber.width() / tickPx()));
  const slot = () => reel.slot;

  function labels(): void {
    // with video, the speed is a multiple of real time, fitting the slot's
    // video into a few seconds until the viewer picks another
    if (videoMode()) {
      b('fps').textContent = fmtRate(rateNow());
      b('fps').title = 'Video speed' + (speed === null && ctx.autoSpeed ? ' (fits this slot\'s video into about ten seconds)' : '') + ': click for faster, round from ¼×';
    } else {
      b('fps').textContent = prefs.fps + ' fps';
      b('fps').title = 'Speed';
    }
    b('fps').setAttribute('aria-label', b('fps').title);
    b('style-ticks').setAttribute('aria-pressed', String(prefs.style === 'ticks'));
    b('style-thumbs').setAttribute('aria-pressed', String(prefs.style === 'thumbs'));
    b('play').textContent = playing ? '❚❚' : '▶';
    const n = reel.stops(most()).length;
    const can = reel.playable(most());
    b('play').disabled = !can;
    b('play').title = !can ? 'One frame in this slot: nothing to play' : playing ? 'Pause (Space)' : 'Play this slot (Space)';
    b('prev').disabled = b('next').disabled = n < 2;
    el.classList.toggle('thumbs', prefs.style === 'thumbs');
    reel.capacity = most();
    // the video's own controls, while the slot has a clip
    const clips = reel.clipSpans();
    // ticks or pictures: nothing to choose between without stills
    el.classList.toggle('no-stills', !reel.frames.length);
    // video it can't show at this scale (too long, or too many clips): say so
    el.classList.toggle('video-far', clips.length > 0 && reel.videoRate() === null);
    el.classList.toggle('has-clip', clips.length > 0);
    el.classList.toggle('has-hi', clips.some((c) => !!c.clip.hi));
    b('mute').innerHTML = prefs.muted ? ICON_MUTED : ICON_SOUND;
    b('mute').title = prefs.muted ? 'Unmute the video' : 'Mute the video';
    b('mute').setAttribute('aria-label', b('mute').title);
    b('hd').setAttribute('aria-pressed', String(prefs.hd));
    b('hd').title = prefs.hd ? 'Playing the larger video: switch to the smaller' : 'Playing the smaller video: switch to the larger';
  }

  /* what the playhead shows: the frame in force at t, and the stretch it's in */
  function show(): void {
    scrubber.head(t);
    const at = reel.at(t);
    if (at.span) {
      el.classList.add('video');
      el.classList.remove('off');
      stateEl.textContent = el.classList.contains('loading') ? 'loading video…' : '';
      // the still in force, shown while the video loads or seeks
      if (at.frame && img.getAttribute('src') !== at.frame.url && img.dataset.hiOf !== at.frame.url) {
        img.src = at.frame.url;
        delete img.dataset.hiOf;
      }
      media.show(at.span.clip, driving);
      caption(null);
      return;
    }
    if (el.classList.contains('video')) {
      el.classList.remove('video');
      media.waitFor(false);
      stopVideo();
    }
    const f = at.frame;
    el.classList.toggle('off', at.gap);
    stateEl.textContent = at.kind === 'dropped' ? 'offline' : at.kind === 'nodata' ? 'no frame'
      : at.kind === 'paused' ? pauseInfo({ paused: true, label: at.interval?.pause?.label }).label.toLowerCase() : '';
    if (f && img.getAttribute('src') !== f.url && img.dataset.hiOf !== f.url) {
      img.src = f.url;
      delete img.dataset.hiOf;
    }
    caption(at.gap ? null : f);
    // the large image once the playhead settles
    if (hiTimer) {clearTimeout(hiTimer);}
    if (f && f.hi && !playing) {
      const hi = f.hi, lo = f.url;
      hiTimer = setTimeout(() => {
        loadImage(hi, () => { if (!gone && reel.at(t).frame === f) { img.src = hi; img.dataset.hiOf = lo; } });
      }, 300);
    }
  }


  /* the title (and how many of the slot's frames are shown, when not all),
   * and the time of what's shown: the frame's own, or a gap's start */
  function caption(f: Frame | null): void {
    const shown = reel.shown(most()).length;
    const total = reel.total();
    titleEl.textContent = (ctx.label ?? '') + (total > shown ? ' (showing ' + shown + ' of ' + total + ')' : '');
    titleEl.title = titleEl.textContent;
    const at = f ? f.ts : t;
    timeEl.textContent = ctx.tt.time(at) + ctx.tt.sfx(at);
    // the scrubber's value: the playhead within the slot, read out as the
    // time shown
    scrubber.value(t, timeEl.textContent);
    // more frames than shown, or more video than plays here: Zoom shows them
    const sampled = reel.clips.length > 0 && reel.videoRate() === null;
    const zoom = el.querySelector<HTMLButtonElement>('button[data-a="zoom"]');
    if (zoom) {
      zoom.classList.toggle('hint', total > shown || sampled);
      const tip = sampled ? 'More video in this slot than plays here: zoom the dashboard to the slot to watch it'
        : total > shown ? total + ' frames in this slot, ' + shown + ' shown: zoom the dashboard to the slot to see them all' : 'Zoom the dashboard to this slot';
      zoom.title = tip;
      zoom.setAttribute('aria-label', tip);
    }
  }

  /* the playhead, within the slot: the crosshair doesn't move */
  function seek(to: number): void {
    t = Math.max(slot().from, Math.min(slot().to - 1, to));
    show();
  }

  /* the slot's frames, no finer than it shows (for it and the slot before),
   * then the playhead at `at` */
  async function load(at: number): Promise<void> {
    const r = reel;
    const ok = await r.load(2 * most());
    if (gone || !ok || r !== reel) {return;}
    scrubber.draw();
    labels();
    seek(at);
    // how long the host's clips play decides whether the slot's video is
    // watched or sampled: learned once per host
    if (await measureReel(r, ctx.key)) {
      if (gone || r !== reel) {return;}
      scrubber.draw();
      labels();
      show();
    }
  }

  function stopVideo(): void {
    driving = false;
    cancelGo();
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    if (!media.video.paused) {media.video.pause();}
  }
  function stop(): void {
    playing = false;
    if (timer) { clearTimeout(timer); timer = null; }
    stopVideo();
    labels();
  }
  /* playing: a clip at the playhead plays to the end of its part; anything
   * else is shown for a frame's time; then on to the next stop */
  function run(): void {
    if (!playing || gone) {return;}
    const span = reel.clipAt(t);
    // a part too short to watch (a slot's sliver of a timelapse) is shown
    // for a frame's time, as a still
    const d = media.video.duration;
    if (span && !(d > 0 && videoTime(span.clip, span.to, d) - videoTime(span.clip, span.from, d) < MIN_CLIP_S)) { playSpan(span); return; }
    timer = setTimeout(() => { timer = null; advance(); }, 1000 / prefs.fps);
  }
  /* the next stop in the slot (a frame, a gap with its reason, or a clip),
   * round and round */
  function advance(): void {
    const next = reel.cycle(t, most());
    if (next === null) { stop(); return; }
    seek(next);
    // the next few frames load ahead
    preloadAfter(reel.shown(most()), t);
    run();
  }
  /* the video plays its part of the slot, and the playhead follows it */
  function playSpan(span: ClipSpan): void {
    driving = true;
    const follow = () => {
      raf = 0;
      if (!playing || gone || !driving) {return;}
      const video = media.video;
      const d = video.duration;
      if (d > 0) {
        t = Math.max(span.from, clipTime(span.clip, video.currentTime, d));
        scrubber.head(t);
        caption(null);
      }
      if (video.ended || t >= span.to - 1) { stopVideo(); advance(); return; }
      raf = requestAnimationFrame(follow);
    };
    const go = () => {
      pendingGo = null;
      if (!playing || gone || !driving) {return;}
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      const v = media.video;
      v.muted = prefs.muted;
      // sped up to be watched in a few seconds, or as the viewer chose
      v.playbackRate = rateNow();
      // sound needs a press: refused, it plays muted
      playVideo(v).catch(() => { v.muted = true; return playVideo(v); }).catch(() => stop());
      // the next clip in the slot (round again: the first), loading meanwhile
      const ws = reel.watched();
      media.preload(ws.find((c) => c.from >= span.to - 1 && c.clip !== span.clip) ?? ws.find((c) => c.clip !== span.clip));
      raf = requestAnimationFrame(follow);
    };
    cancelGo();
    if (media.ready()) { go(); return; }
    const v = media.video;
    const h = () => {
      v.removeEventListener('loadedmetadata', h);
      if (pendingGo) {pendingGo.timer = setTimeout(go, 0);}
    };
    pendingGo = { v, h, timer: null };
    v.addEventListener('loadedmetadata', h);
  }
  function play(): void {
    if (playing || !reel.playable(most())) {return;}
    playing = true;
    labels();
    run();
  }

  /* the neighbouring slot: the frame the strip shows for it, and the
   * dashboard's crosshair moves to it */
  function toSlot(dir: 1 | -1): void {
    const next = ctx.slotAt(dir > 0 ? slot().to : slot().from - 1);
    if (!next || next.from === slot().from) {return;}
    reel = new Reel(ctx, next);
    // a speed fitted to the slot is fitted to the next one; one the viewer
    // chose stays
    if (ctx.autoSpeed) {speed = null;}
    const at = next.frameTs !== undefined && next.frameTs >= next.from && next.frameTs < next.to ? next.frameTs : next.ts;
    scrubber.draw();
    labels();
    seek(at);
    ctx.onTime?.(next.ts);
    void load(at);
  }

  const act = (a: string): void => {
    switch (a) {
      case 'play': if (playing) {stop();} else {play();} break;
      case 'prev': case 'next': {
        stop();
        const to = reel.step(t, a === 'next' ? 1 : -1, most());
        if (to !== null) {seek(to);}
        break;
      }
      case 'prev-slot': stop(); toSlot(-1); break;
      case 'next-slot': stop(); toSlot(1); break;
      case 'mute':
        prefs.muted = !prefs.muted; savePrefs(prefs);
        media.video.muted = prefs.muted;
        labels();
        break;
      case 'hd': {
        prefs.hd = !prefs.hd; savePrefs(prefs);
        const was = playing;
        stop();
        show();
        if (was) {play();}
        labels();
        break;
      }
      case 'fps':
        if (videoMode()) {
          // the next speed up, round to real time
          speed = SPEEDS.find((x) => x > rateNow() + 0.01) ?? SPEEDS[0];
          if (driving) {media.video.playbackRate = speed;}
          labels();
          break;
        }
        prefs.fps = FPS[(FPS.indexOf(prefs.fps) + 1) % FPS.length]; savePrefs(prefs); if (playing) { stop(); play(); } labels(); break;
      // the same frames either way: only how they're drawn changes
      case 'style-ticks': case 'style-thumbs': {
        const style: ScrubStyle = a === 'style-ticks' ? 'ticks' : 'thumbs';
        if (style === prefs.style) {break;}
        prefs.style = style; savePrefs(prefs); labels(); scrubber.draw(); show();
        break;
      }
      // the bubble over video this scale can't show does what Zoom does
      case 'zoom': case 'zoom-video': stop(); ctx.onZoom?.(slot().from, slot().to); close(); break;
    }
  };
  el.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest('button')?.dataset.a;
    if (a && a !== 'close') {act(a);}
  });

  // Space and ←/→ anywhere, but not while typing (a search field, say), nor
  // with a modifier but Shift, nor a key something else already took; Space
  // on a button presses the button
  const keyH = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey || typing(e.target)) {return;}
    const k = e.key;
    if (k === ' ') {
      if (e.target instanceof Element && e.target.closest('button, a[href], [role="button"], summary')) {return;}
      e.preventDefault(); act('play');
    }
    else if (k === 'ArrowLeft') { e.preventDefault(); act(e.shiftKey ? 'prev-slot' : 'prev'); }
    else if (k === 'ArrowRight') { e.preventDefault(); act(e.shiftKey ? 'next-slot' : 'next'); }
  };
  document.addEventListener('keydown', keyH);

  /* The popup takes the camera's shape, from its first frame: the image area
   * a fixed height (STAGE_H, or 55% of the window), as wide as the frame
   * needs, between what the controls need and MAX_W (or 92% of the window);
   * a frame too wide for that gets a shorter area, one narrower than the
   * controls a taller one. Then it stays that size, whatever it shows. */
  let sized = false;
  const stage = el.querySelector<HTMLElement>('.stage')!;
  function size(nw: number, nh: number): void {
    if (sized || !nw || !nh) {return;}
    sized = true;
    const aspect = nw / nh;
    const pad = 12 + 2;   // the popup's padding and border
    const maxW = Math.min(MAX_W, window.innerWidth * 0.92) - pad;
    let h = Math.min(STAGE_H, window.innerHeight * 0.55);
    let w = h * aspect;
    if (w > maxW) { w = maxW; h = w / aspect; }
    if (w < MIN_W) { h = Math.min(MIN_W / aspect, STAGE_H * 1.5, window.innerHeight * 0.7); w = h * aspect; }
    el.style.width = Math.round(Math.max(MIN_W, w) + pad) + 'px';
    stage.style.height = Math.round(h) + 'px';
    scrubber.draw();   // as many as the new width holds
    show();
  }
  img.onload = () => { size(img.naturalWidth, img.naturalHeight); place(); };
  img.onerror = () => { if (img.dataset.hiOf) { img.src = img.dataset.hiOf; delete img.dataset.hiOf; } };
  if (start && img.complete) { size(img.naturalWidth, img.naturalHeight); place(); }
  labels();
  caption(start);
  void load(startTs);

  // the slot on screen stays as it is (no fetch again); what comes next is
  // the new mount's
  const rebind = (next: PlayerContext): void => {
    if (gone) {return;}
    ctx = next;
    scrubber.draw();
    labels();
  };
  return Object.assign(() => {
    gone = true;
    stop();
    media.release();
    if (hiTimer) {clearTimeout(hiTimer);}
    document.removeEventListener('keydown', keyH);
  }, { rebind });
}
