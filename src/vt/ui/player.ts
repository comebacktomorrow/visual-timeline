import { pauseInfo } from '../model/eras';
import { Reel, type ReelSlot, type ReelSource } from '../model/reel';
import { FRAME_WIDTH } from './frameWidth';
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
 * plays. */

export type ScrubStyle = 'ticks' | 'thumbs';

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
}

interface Prefs { style: ScrubStyle; fps: number }
const PREFS_KEY = 'ktl-player';
const FPS = [1, 2, 4, 8, 16];
function loadPrefs(ctx: PlayerContext): Prefs {
  const base: Prefs = { style: ctx.scrubber ?? 'ticks', fps: 4 };
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    return {
      style: p.style === 'thumbs' || p.style === 'ticks' ? p.style : base.style,
      fps: FPS.includes(p.fps) ? p.fps : base.fps,
    };
  } catch { return base; }
}
function savePrefs(p: Prefs): void {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* private mode: the choice lasts this preview */ }
}

/* A slot can hold more frames than its timeline can tell apart. It shows at
 * most a frame per Frame width (the strip's own rule, FRAME_WIDTH by default),
 * evenly through the slot, whichever the style: those are its ticks, what it
 * steps and plays through, and what it fetches (no finer). As thumbnails, a
 * picture per THUMB_PX of them. Zoom shows them all. */
const THUMB_PX = 48;
/* the popup's size (size() in mountPlayer) */
const STAGE_H = 405;
const MIN_W = 400;
const MAX_W = 960;

/* icons: the scrubber's two styles, and Zoom */
const ICON_TICKS = '<svg viewBox="0 0 16 12" width="16" height="12" aria-hidden="true"><path d="M2 2v8M5 4v6M8 1v9M11 5v5M14 3v7" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>';
const ICON_THUMBS = '<svg viewBox="0 0 16 12" width="16" height="12" aria-hidden="true"><rect x="1" y="1" width="14" height="10" rx="1" stroke="currentColor" stroke-width="1.2" fill="none"/><circle cx="11" cy="4" r="1.3" fill="currentColor"/><path d="M2.5 9.5l3.5-4 2.5 2.5 1.5-1.5 3 3z" fill="currentColor"/></svg>';
const ICON_ZOOM = '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" stroke-width="1.5" fill="none"/><path d="M10 10l4.5 4.5M4.5 6.5h4M6.5 4.5v4" stroke="currentColor" stroke-width="1.5"/></svg>';

const btn = (a: string, label: string, title: string) =>
  `<button type="button" data-a="${a}" title="${title}" aria-label="${title}">${label}</button>`;

/** Builds the player into `el` (the popup) for a frame at `start`; returns
 * its teardown. `place` re-positions the popup once the image has a size. */
export function mountPlayer(el: HTMLElement, start: Frame, ctx: PlayerContext, place: () => void, close: () => void = () => {}): () => void {
  const prefs = loadPrefs(ctx);
  el.classList.add('player');
  // the static on top (what this is, Zoom, close); the playback below (the
  // frame's time, the transport, how the timeline draws and its speed)
  el.innerHTML =
    '<div class="top">' +
    (ctx.onZoom ? btn('zoom', ICON_ZOOM, 'Zoom the dashboard to this slot') : '<span></span>') +
    '<span class="title"></span>' +
    btn('close', '✕', 'Close (Esc)') +
    '</div>' +
    '<div class="stage"><div class="state"></div></div>' +
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
    btn('style-ticks', ICON_TICKS, 'Scrubber: a tick per frame') + btn('style-thumbs', ICON_THUMBS, 'Scrubber: the frames as pictures') +
    btn('fps', '', 'Speed') +
    '</span>' +
    '</div>';
  // the image goes in with its source already set
  const img = document.createElement('img');
  img.alt = 'frame';
  img.src = start.url;
  el.querySelector('.stage')!.prepend(img);
  const stateEl = el.querySelector<HTMLElement>('.stage .state')!;
  const scrub = el.querySelector<HTMLElement>('.scrub')!;
  const lanes = el.querySelector<HTMLElement>('.lanes')!;
  const thumbs = el.querySelector<HTMLElement>('.thumbs')!;
  const ticks = el.querySelector<HTMLElement>('.ticks')!;
  const head = el.querySelector<HTMLElement>('.head')!;
  const titleEl = el.querySelector<HTMLElement>('.title')!;
  const timeEl = el.querySelector<HTMLElement>('.time')!;
  const b = (a: string) => el.querySelector<HTMLButtonElement>(`button[data-a="${a}"]`)!;

  /* the slot the player is in, as a reel; the playhead */
  const firstSlot: PlayerSlot = ctx.slotAt(start.ts) ?? { from: start.ts - ctx.step / 2, to: start.ts + ctx.step / 2, ts: start.ts };
  let reel = new Reel(ctx, firstSlot, start);
  let t = start.ts;
  let playing = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let hiTimer: ReturnType<typeof setTimeout> | null = null;
  let gone = false;

  const width = () => scrub.clientWidth || 560;
  /* how many of the slot's frames it shows: the same in either style */
  const tickPx = ctx.frameWidth && ctx.frameWidth > 0 ? ctx.frameWidth : FRAME_WIDTH;
  const most = () => Math.max(4, Math.floor(width() / tickPx));
  const slot = () => reel.slot;
  const span = () => Math.max(1, slot().to - slot().from);
  const xOf = (ts: number) => ((ts - slot().from) / span()) * 100;

  function labels(): void {
    b('fps').textContent = prefs.fps + ' fps';
    b('style-ticks').setAttribute('aria-pressed', String(prefs.style === 'ticks'));
    b('style-thumbs').setAttribute('aria-pressed', String(prefs.style === 'thumbs'));
    b('play').textContent = playing ? '❚❚' : '▶';
    const n = reel.stops(most()).length;
    b('play').disabled = n < 2;
    b('play').title = n < 2 ? 'One frame in this slot: nothing to play' : playing ? 'Pause (Space)' : 'Play this slot (Space)';
    b('prev').disabled = b('next').disabled = n < 2;
    el.classList.toggle('thumbs', prefs.style === 'thumbs');
  }

  /* the slot's timeline: its stretches, a tick per frame shown, and (as
   * thumbnails) pictures of them, each running to the next one drawn or to
   * the stretch without a frame after it */
  function drawScrub(): void {
    lanes.textContent = '';
    for (const iv of reel.gaps()) {
      const d = document.createElement('div');
      d.className = 'lane ' + iv.kind;
      if (iv.kind === 'paused') {
        if (iv.pause?.color) {d.style.setProperty('--ktl-band', iv.pause.color);}
        d.title = pauseInfo({ paused: true, label: iv.pause?.label, color: iv.pause?.color }).label.toLowerCase();
      }
      d.style.left = Math.max(0, xOf(iv.from)) + '%';
      d.style.width = Math.max(0, Math.min(100, xOf(iv.to)) - Math.max(0, xOf(iv.from))) + '%';
      lanes.appendChild(d);
    }
    ticks.textContent = '';
    for (const f of reel.shown(most())) {
      const k = document.createElement('div');
      k.className = 'tick';
      k.style.left = xOf(f.ts) + '%';
      ticks.appendChild(k);
    }
    thumbs.textContent = '';
    if (prefs.style !== 'thumbs') {return;}
    const fs = reel.shown(Math.max(4, Math.floor(width() / THUMB_PX)));
    const gaps = reel.gaps();
    const cell = (f: Frame, from: number, to: number, prior = false) => {
      const c = document.createElement('div');
      c.className = 'thumb' + (prior ? ' prior' : '');
      c.style.left = xOf(from) + '%';
      c.style.width = Math.max(0, xOf(to) - xOf(from)) + '%';
      const ti = document.createElement('img');
      ti.alt = '';
      ti.src = f.url;
      c.appendChild(ti);
      thumbs.appendChild(c);
    };
    // before the slot's first frame, the one still in force from before it, dimmed
    const prior = reel.prior();
    const firstTs = fs.length ? fs[0].ts : slot().to;
    const firstGap = gaps.find((g) => g.from <= slot().from);
    if (prior && firstTs > slot().from && !firstGap) {cell(prior, slot().from, firstTs, true);}
    fs.forEach((f, i) => {
      const next = i + 1 < fs.length ? fs[i + 1].ts : slot().to;
      const gap = gaps.find((g) => g.from >= f.ts && g.from < next);
      cell(f, f.ts, gap ? gap.from : next);
    });
  }

  /* what the playhead shows: the frame in force at t, and the stretch it's in */
  function show(): void {
    head.style.left = xOf(t) + '%';
    const at = reel.at(t);
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
        const pre = new Image();
        pre.onload = () => { if (!gone && reel.at(t).frame === f) { img.src = hi; img.dataset.hiOf = lo; } };
        pre.src = hi;
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
    // more frames than shown: Zoom shows them all
    const zoom = el.querySelector<HTMLButtonElement>('button[data-a="zoom"]');
    if (zoom) {
      zoom.classList.toggle('hint', total > shown);
      const tip = total > shown ? total + ' frames in this slot, ' + shown + ' shown: zoom the dashboard to the slot to see them all' : 'Zoom the dashboard to this slot';
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
    drawScrub();
    labels();
    seek(at);
  }

  function stop(): void {
    playing = false;
    if (timer) { clearInterval(timer); timer = null; }
    labels();
  }
  /* the next stop in the slot (a frame, or a gap with its reason), round and round */
  function tick(): void {
    const next = reel.cycle(t, most());
    if (next === null) { stop(); return; }
    seek(next);
    // the next few frames load ahead
    const fs = reel.shown(most());
    const j = fs.findIndex((f) => f.ts > t);
    for (let k = 0; k < 3 && fs.length; k++) { const p = new Image(); p.src = fs[((j < 0 ? 0 : j) + k) % fs.length].url; }
  }
  function play(): void {
    if (playing || reel.stops(most()).length < 2) {return;}
    playing = true;
    labels();
    timer = setInterval(tick, 1000 / prefs.fps);
  }

  /* the neighbouring slot: the frame the strip shows for it, and the
   * dashboard's crosshair moves to it */
  function toSlot(dir: 1 | -1): void {
    const next = ctx.slotAt(dir > 0 ? slot().to : slot().from - 1);
    if (!next || next.from === slot().from) {return;}
    reel = new Reel(ctx, next);
    const at = next.frameTs !== undefined && next.frameTs >= next.from && next.frameTs < next.to ? next.frameTs : next.ts;
    drawScrub();
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
      case 'fps': prefs.fps = FPS[(FPS.indexOf(prefs.fps) + 1) % FPS.length]; savePrefs(prefs); if (playing) { stop(); play(); } labels(); break;
      // the same frames either way: only how they're drawn changes
      case 'style-ticks': case 'style-thumbs': {
        const style: ScrubStyle = a === 'style-ticks' ? 'ticks' : 'thumbs';
        if (style === prefs.style) {break;}
        prefs.style = style; savePrefs(prefs); labels(); drawScrub(); show();
        break;
      }
      case 'zoom': stop(); ctx.onZoom?.(slot().from, slot().to); close(); break;
    }
  };
  el.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest('button')?.dataset.a;
    if (a && a !== 'close') {act(a);}
  });

  // the scrubber follows the mouse, as the strip does (pausing playback);
  // a press and drag holds on to it
  const tAt = (clientX: number) => {
    const r = scrub.getBoundingClientRect();
    return slot().from + Math.max(0, Math.min(1, (clientX - r.left) / Math.max(1, r.width))) * span();
  };
  scrub.addEventListener('pointermove', (e) => {
    if (playing) {stop();}
    seek(tAt(e.clientX));
  });
  scrub.addEventListener('pointerdown', (e) => {
    if (playing) {stop();}
    scrub.setPointerCapture?.(e.pointerId);
    seek(tAt(e.clientX));
  });

  const keyH = (e: KeyboardEvent) => {
    const k = e.key;
    if (k === ' ') { e.preventDefault(); act('play'); }
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
  function size(): void {
    if (sized || !img.naturalWidth || !img.naturalHeight) {return;}
    sized = true;
    const aspect = img.naturalWidth / img.naturalHeight;
    const pad = 12 + 2;   // the popup's padding and border
    const maxW = Math.min(MAX_W, window.innerWidth * 0.92) - pad;
    let h = Math.min(STAGE_H, window.innerHeight * 0.55);
    let w = h * aspect;
    if (w > maxW) { w = maxW; h = w / aspect; }
    if (w < MIN_W) { h = Math.min(MIN_W / aspect, STAGE_H * 1.5, window.innerHeight * 0.7); w = h * aspect; }
    el.style.width = Math.round(Math.max(MIN_W, w) + pad) + 'px';
    stage.style.height = Math.round(h) + 'px';
    drawScrub();   // as many as the new width holds
    show();
  }
  img.onload = () => { size(); place(); };
  img.onerror = () => { if (img.dataset.hiOf) { img.src = img.dataset.hiOf; delete img.dataset.hiOf; } };
  if (img.complete) { size(); place(); }
  labels();
  caption(start);
  void load(start.ts);

  return () => {
    gone = true;
    stop();
    if (hiTimer) {clearTimeout(hiTimer);}
    document.removeEventListener('keydown', keyH);
  };
}
