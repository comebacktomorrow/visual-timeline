import { pauseInfo } from '../model/eras';
import type { Interval } from '../model/intervals';
import { frameIndexAt } from '../model/playhead';
import type { ZoneTexts } from '../zones/source';
import type { Frame, TimeWindow } from '../types';

/* The preview player (M10): the click-in preview, with the slot's own
 * timeline under it. A slot of the strip can show one frame; the player shows
 * the rest. Its scrubber spans just the current slot: a tick per frame taken
 * within it, at its true time (or the frames themselves, as thumbnails),
 * over the stretches the strip draws (dropped, no data, pauses). Hovering,
 * clicking, dragging, previous and next and Play all stay within the slot,
 * and the dashboard's crosshair stays still; stepping and playing stop on a
 * gap too, showing its reason. Only ‹‹ ›› (Shift+←/→) move to the
 * neighbouring slot, and the crosshair with it; Zoom sets the dashboard's
 * range to the slot. Only the frame under the playhead loads, and the slot's
 * frames while it plays. */

export type ScrubStyle = 'ticks' | 'thumbs';

/** A slot of the host's strip, as the player needs it: its span, its tick,
 * and the frame the strip shows for it. */
export interface PlayerSlot {
  from: number;
  to: number;
  ts: number;
  frameTs?: number;
}

/** What the player needs from the mount that opened it. */
export interface PlayerContext {
  /** the dashboard's window */
  window: TimeWindow;
  /** the host's slot duration */
  step: number;
  /** the host's frames in [from, to], as the mount has them (perhaps thinned) */
  fetch(from: number, to: number): Promise<Frame[]>;
  /** one slot's frames at full resolution, asking again if need be */
  detail?(from: number, to: number): Promise<Frame[]>;
  /** the intervals for frames over a range (the host's promise and pauses) */
  intervals(frames: Frame[], range: TimeWindow): Interval[];
  /** the strip's slot at a time */
  slotAt(t: number): PlayerSlot | null;
  /** the player moved to another slot: the mount moves its crosshair */
  onTime?(t: number): void;
  /** set the dashboard's time range to a span (the timeline's drag-zoom) */
  onZoom?(from: number, to: number): void;
  tt: ZoneTexts;
  /** what the caption names: "site / host" */
  label?: string;
  /** the panel's default scrubber style; the viewer's last choice wins */
  scrubber?: ScrubStyle;
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

/* A slot can hold more frames than its timeline can tell apart: it draws at
 * most a tick per TICK_PX and a thumbnail per THUMB_PX, evenly through the
 * slot, and steps and plays through those. Zoom shows them all. */
const TICK_PX = 2;
const THUMB_PX = 48;
/* the popup's size (size() in mountPlayer) */
const STAGE_H = 405;
const MIN_W = 400;
const MAX_W = 960;

const btn = (a: string, label: string, title: string) =>
  `<button type="button" data-a="${a}" title="${title}" aria-label="${title}">${label}</button>`;

/** Builds the player into `el` (the popup) for a frame at `start`; returns
 * its teardown. `place` re-positions the popup once the image has a size. */
export function mountPlayer(el: HTMLElement, start: Frame, ctx: PlayerContext, place: () => void, close: () => void = () => {}): () => void {
  const prefs = loadPrefs(ctx);
  el.classList.add('player');
  el.innerHTML =
    '<div class="stage"><div class="state"></div></div>' +
    '<div class="scrub" role="slider" tabindex="0" aria-label="The frames in this slot">' +
    '<div class="lanes"></div><div class="thumbs"></div><div class="ticks"></div><div class="head"></div></div>' +
    '<div class="cap"></div>' +
    '<div class="bar">' +
    btn('prev-slot', '‹‹', 'Previous slot (Shift+←)') + btn('prev', '‹', 'Previous frame in this slot (←)') +
    btn('play', '▶', 'Play the frames in this slot (Space)') + btn('next', '›', 'Next frame in this slot (→)') +
    btn('next-slot', '››', 'Next slot (Shift+→)') +
    '<span class="spacer"></span>' +
    btn('fps', '', 'Speed') + btn('style', '', 'Scrubber: ticks or thumbnails') +
    (ctx.onZoom ? btn('zoom', 'Zoom', 'Zoom the dashboard to this slot') : '') +
    btn('close', '✕', 'Close (Esc)') +
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
  const cap = el.querySelector<HTMLElement>('.cap')!;
  const b = (a: string) => el.querySelector<HTMLButtonElement>(`button[data-a="${a}"]`)!;

  /* the slot the player is in, and the frames taken within it (plus the one
   * in force at its start, for what shows before its first) */
  let slot: PlayerSlot = ctx.slotAt(start.ts) ?? { from: start.ts - ctx.step / 2, to: start.ts + ctx.step / 2, ts: start.ts };
  let frames: Frame[] = [start];
  let ivs: Interval[] = [];
  let t = start.ts;
  let playing = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let hiTimer: ReturnType<typeof setTimeout> | null = null;
  let loadSeq = 0;
  let gone = false;

  const span = () => Math.max(1, slot.to - slot.from);
  const xOf = (ts: number) => ((ts - slot.from) / span()) * 100;
  const inSlot = () => frames.filter((f) => f.ts >= slot.from && f.ts < slot.to);
  /* the slot's frames the timeline draws: all of them, or evenly through
   * the slot when there are more than it can tell apart */
  const most = () => Math.max(4, Math.floor((scrub.clientWidth || 560) / (prefs.style === 'thumbs' ? THUMB_PX : TICK_PX)));
  const shown = (): Frame[] => {
    const fs = inSlot();
    const n = most();
    if (fs.length <= n) {return fs;}
    const out: Frame[] = [];
    for (let i = 0; i < n; i++) {out.push(fs[Math.floor((i * fs.length) / n)]);}
    return out;
  };
  /* the slot's stops, in time order: each frame, and the start of each
   * stretch without one (dropped, no data, a pause), so stepping and playing
   * show a gap with its reason instead of skipping it */
  const stops = (): number[] => {
    const out = new Set(shown().map((f) => f.ts));
    for (const iv of ivs) {
      if (iv.kind === 'dropped' || iv.kind === 'nodata' || iv.kind === 'paused') {
        const from = Math.max(iv.from, slot.from);
        if (from < slot.to) {out.add(from);}
      }
    }
    return [...out].sort((a, z) => a - z);
  };

  function labels(): void {
    b('fps').textContent = prefs.fps + ' fps';
    b('style').textContent = prefs.style === 'ticks' ? 'Ticks' : 'Thumbs';
    b('play').textContent = playing ? '❚❚' : '▶';
    const n = stops().length;
    b('play').disabled = n < 2;
    b('play').title = n < 2 ? 'One frame in this slot: nothing to play' : playing ? 'Pause (Space)' : 'Play this slot (Space)';
    b('prev').disabled = b('next').disabled = n < 2;
    el.classList.toggle('thumbs', prefs.style === 'thumbs');
  }

  /* the slot's timeline: its stretches, a tick per frame, or the frames
   * themselves, each as wide as it stands */
  function drawScrub(): void {
    lanes.textContent = '';
    for (const iv of ivs) {
      if (iv.kind === 'frame' || iv.kind === 'pending' || iv.kind === 'beyond') {continue;}
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
    const fs = shown();
    ticks.textContent = '';
    for (const f of fs) {
      const k = document.createElement('div');
      k.className = 'tick';
      k.style.left = xOf(f.ts) + '%';
      ticks.appendChild(k);
    }
    thumbs.textContent = '';
    if (prefs.style === 'thumbs') {
      // before the slot's first frame, the one still in force from before it, dimmed
      const prior = frames.filter((f) => f.ts < slot.from).pop();
      const firstTs = fs.length ? fs[0].ts : slot.to;
      if (prior && firstTs > slot.from) {
        const cell = document.createElement('div');
        cell.className = 'thumb prior';
        cell.style.left = '0%';
        cell.style.width = xOf(firstTs) + '%';
        const ti = document.createElement('img');
        ti.alt = '';
        ti.src = prior.url;
        cell.appendChild(ti);
        thumbs.appendChild(cell);
      }
      fs.forEach((f, i) => {
        // up to the next thumbnail drawn, or the first stretch without a
        // frame before it (a broken promise, a hold that ends, a pause), so
        // those show and nothing else does
        const next = i + 1 < fs.length ? fs[i + 1].ts : slot.to;
        const gap = ivs.find((iv) => (iv.kind === 'dropped' || iv.kind === 'nodata' || iv.kind === 'paused') && iv.from >= f.ts && iv.from < next);
        const end = gap ? gap.from : next;
        const cell = document.createElement('div');
        cell.className = 'thumb';
        cell.style.left = xOf(f.ts) + '%';
        cell.style.width = Math.max(0, xOf(end) - xOf(f.ts)) + '%';
        const ti = document.createElement('img');
        ti.alt = '';
        ti.src = f.url;
        cell.appendChild(ti);
        thumbs.appendChild(cell);
      });
    }
  }

  /* what the playhead shows: the frame in force at t, and the stretch it's in */
  function show(): void {
    head.style.left = xOf(t) + '%';
    const j = frameIndexAt(frames, t);
    const f = j >= 0 ? frames[j] : null;
    const iv = ivs.find((x) => x.from <= t && t < x.to) || null;
    const kind = iv ? iv.kind : f ? 'frame' : 'nodata';
    el.classList.toggle('off', kind === 'dropped' || kind === 'nodata' || kind === 'paused');
    stateEl.textContent = kind === 'dropped' ? 'offline' : kind === 'nodata' ? 'no frame'
      : kind === 'paused' ? pauseInfo({ paused: true, label: iv?.pause?.label }).label.toLowerCase() : '';
    if (f && img.getAttribute('src') !== f.url && img.dataset.hiOf !== f.url) {
      img.src = f.url;
      delete img.dataset.hiOf;
    }
    caption(f);
    // the large image once the playhead settles
    if (hiTimer) {clearTimeout(hiTimer);}
    if (f && f.hi && !playing) {
      const hi = f.hi, lo = f.url;
      hiTimer = setTimeout(() => {
        const pre = new Image();
        pre.onload = () => { if (!gone && frames[frameIndexAt(frames, t)] === f) { img.src = hi; img.dataset.hiOf = lo; } };
        pre.src = hi;
      }, 300);
    }
  }

  function caption(f: Frame | null): void {
    const fs = shown();
    // the frame's place among all the slot's frames, drawn or not
    const every = inSlot();
    const all = every.length;
    const i = f ? every.indexOf(f) : -1;
    // "frame 22 of 89 in this slot"; between frames, the one shown and its place
    const place = all > 1 && i >= 0 ? (i + 1) + ' of ' + all + ' in this slot' : '';
    cap.textContent = (ctx.label ? ctx.label + ' — ' : '') + ctx.tt.time(t) + ctx.tt.sfx(t) +
      (f && f.ts !== t
        ? ' · frame ' + ctx.tt.time(f.ts) + ctx.tt.sfx(f.ts) + (place ? ' (' + place + ')' : '')
        : place ? ' · frame ' + place : '');
    // more frames than drawn: Zoom shows them all
    const zoom = el.querySelector<HTMLButtonElement>('button[data-a="zoom"]');
    if (zoom) {
      zoom.classList.toggle('hint', all > fs.length);
      zoom.title = all > fs.length ? all + ' frames in this slot, ' + fs.length + ' drawn: zoom the dashboard to the slot to see them all' : 'Zoom the dashboard to this slot';
    }
  }

  /* the playhead, within the slot: the crosshair doesn't move */
  function seek(to: number): void {
    t = Math.max(slot.from, Math.min(slot.to - 1, to));
    show();
  }

  /* the slot's frames (at full resolution where the backend can fetch them
   * again) and its stretches, then the playhead at `at` */
  async function load(at: number): Promise<void> {
    const seq = ++loadSeq;
    const range = { from: slot.from, to: slot.to };
    let got: Frame[] = [];
    try {
      // with the frame in force at the slot's start: at the same resolution as
      // the slot's (a thinned one from before would read as a broken promise)
      if (ctx.detail) {
        const all = await ctx.detail(range.from - ctx.step, range.to);
        got = [...all.filter((f) => f.ts < range.from).slice(-1), ...all.filter((f) => f.ts >= range.from)];
      } else {
        const before = (await ctx.fetch(range.from - ctx.step * 2, range.from)).filter((f) => f.ts < range.from);
        got = [...before.slice(-1), ...(await ctx.fetch(range.from, range.to))];
      }
    } catch (e) { console.warn('[visual-timeline] player fetch failed:', e); }
    if (gone || seq !== loadSeq) {return;}
    const byTs = new Map<number, Frame>();
    for (const f of got) {byTs.set(f.ts, f);}
    if (start.ts >= range.from && start.ts < range.to && !byTs.has(start.ts)) {byTs.set(start.ts, start);}
    frames = [...byTs.values()].sort((x, y) => x.ts - y.ts);
    ivs = ctx.intervals(frames, range);
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
    const st = stops();
    if (st.length < 2) { stop(); return; }
    const i = st.findIndex((x) => x > t);
    seek(st[i < 0 ? 0 : i]);
    // the next few frames load ahead
    const fs = shown();
    const j = fs.findIndex((f) => f.ts > t);
    for (let k = 0; k < 3 && fs.length; k++) { const p = new Image(); p.src = fs[((j < 0 ? 0 : j) + k) % fs.length].url; }
  }
  function play(): void {
    if (playing || stops().length < 2) {return;}
    playing = true;
    labels();
    timer = setInterval(tick, 1000 / prefs.fps);
  }

  /* the neighbouring slot: the frame the strip shows for it, and the
   * dashboard's crosshair moves to it */
  function toSlot(dir: 1 | -1): void {
    const next = ctx.slotAt(dir > 0 ? slot.to : slot.from - 1);
    if (!next || next.from === slot.from) {return;}
    slot = next;
    const at = next.frameTs !== undefined && next.frameTs >= next.from && next.frameTs < next.to ? next.frameTs : next.ts;
    frames = frames.filter((f) => f.ts < next.from).slice(-1);
    ivs = [];
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
        const st = stops();
        const i = st.findIndex((x) => x > t);
        const cur = i < 0 ? st.length - 1 : i - 1;
        const to = st[a === 'next' ? cur + 1 : cur - 1];
        if (to !== undefined) {seek(to);}
        break;
      }
      case 'prev-slot': stop(); toSlot(-1); break;
      case 'next-slot': stop(); toSlot(1); break;
      case 'fps': prefs.fps = FPS[(FPS.indexOf(prefs.fps) + 1) % FPS.length]; savePrefs(prefs); if (playing) { stop(); play(); } labels(); break;
      case 'style': prefs.style = prefs.style === 'ticks' ? 'thumbs' : 'ticks'; savePrefs(prefs); labels(); drawScrub(); show(); break;
      case 'zoom': stop(); ctx.onZoom?.(slot.from, slot.to); close(); break;
    }
  };
  el.querySelector('.bar')!.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest('button')?.dataset.a;
    if (a && a !== 'close') {act(a);}
  });

  // the scrubber follows the mouse, as the strip does (pausing playback);
  // a press and drag holds on to it
  const tAt = (clientX: number) => {
    const r = scrub.getBoundingClientRect();
    return slot.from + Math.max(0, Math.min(1, (clientX - r.left) / Math.max(1, r.width))) * span();
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
   * a frame too wide for that gets a shorter area. Then it stays that size,
   * whatever it shows. */
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
    // a frame narrower than the controls (a portrait screen): taller, to
    // fill more of the width they need
    if (w < MIN_W) { h = Math.min(MIN_W / aspect, STAGE_H * 1.5, window.innerHeight * 0.7); w = h * aspect; }
    el.style.width = Math.round(Math.max(MIN_W, w) + pad) + 'px';
    stage.style.height = Math.round(h) + 'px';
    drawScrub();   // as many thumbnails as the new width holds
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
