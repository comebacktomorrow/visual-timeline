import { pauseInfo } from '../model/eras';
import type { Interval } from '../model/intervals';
import { frameIndexAt, framesIn, NEAR_SLOTS, reachRange, stepFrame, type Reach } from '../model/playhead';
import type { ZoneTexts } from '../zones/source';
import type { Frame, TimeWindow } from '../types';

/* The preview player (M10): the click-in preview with its own scrubber over
 * the host's frames. A non-visual scrubber (a tick per frame at its true
 * time, over the stretches the strip draws: dropped, no data, pauses) or
 * thumbnails; the clicked slot and NEAR_SLOTS either side, or the whole
 * range; previous and next frame and slot.
 *
 * Play is for what a slot can't show: it loops the frames taken within the
 * current slot, and the dashboard's crosshair stays where it is. The
 * crosshair moves only when the playhead moves to another slot (previous
 * and next slot, the scrubber, or stepping a frame past a slot's edge).
 * Only the frame under the playhead loads, and the slot's frames while it
 * plays. */

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
  /** the host's slot duration: previous and next slot step by it */
  step: number;
  /** the host's frames in [from, to], as the mount has them (perhaps thinned) */
  fetch(from: number, to: number): Promise<Frame[]>;
  /** one slot's frames at full resolution, asking again if need be */
  detail?(from: number, to: number): Promise<Frame[]>;
  /** the intervals for frames over a range (the host's promise and pauses) */
  intervals(frames: Frame[], range: TimeWindow): Interval[];
  /** the strip's slot at a time */
  slotAt(t: number): PlayerSlot | null;
  /** the playhead moved to another slot: the mount moves its crosshair */
  onTime?(t: number): void;
  tt: ZoneTexts;
  /** what the caption names: "site / host" */
  label?: string;
  /** the panel's defaults; the viewer's last choices win */
  reach?: Reach;
  scrubber?: ScrubStyle;
}

interface Prefs { reach: Reach; style: ScrubStyle; fps: number }
const PREFS_KEY = 'ktl-player';
const FPS = [1, 2, 4, 8, 16];
function loadPrefs(ctx: PlayerContext): Prefs {
  const base: Prefs = { reach: ctx.reach ?? 'near', style: ctx.scrubber ?? 'ticks', fps: 4 };
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    return {
      reach: p.reach === 'all' || p.reach === 'near' ? p.reach : base.reach,
      style: p.style === 'thumbs' || p.style === 'ticks' ? p.style : base.style,
      fps: FPS.includes(p.fps) ? p.fps : base.fps,
    };
  } catch { return base; }
}
function savePrefs(p: Prefs): void {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* private mode: the choice lasts this preview */ }
}

const btn = (a: string, label: string, title: string) =>
  `<button type="button" data-a="${a}" title="${title}" aria-label="${title}">${label}</button>`;

/** Builds the player into `el` (the popup) for a frame at `start`; returns
 * its teardown. `place` re-positions the popup once the image has a size. */
export function mountPlayer(el: HTMLElement, start: Frame, ctx: PlayerContext, place: () => void): () => void {
  const prefs = loadPrefs(ctx);
  el.classList.add('player');
  el.innerHTML =
    '<div class="stage"><div class="state"></div></div>' +
    '<div class="scrub" role="slider" tabindex="0" aria-label="Scrub through frames">' +
    '<div class="lanes"></div><div class="thumbs"></div><div class="slotband"></div><div class="ticks"></div><div class="head"></div></div>' +
    '<div class="bar">' +
    btn('prev-slot', '‹‹', 'Previous slot (Shift+←)') + btn('prev', '‹', 'Previous frame (←)') +
    btn('play', '▶', 'Play the frames in this slot (Space)') + btn('next', '›', 'Next frame (→)') + btn('next-slot', '››', 'Next slot (Shift+→)') +
    '<span class="cap"></span>' +
    btn('fps', '', 'Speed') +
    btn('reach', '', 'How far the scrubber reaches') + btn('style', '', 'Scrubber: ticks or thumbnails') +
    btn('close', '✕', 'Close (Esc)') +
    '</div>';
  // the image goes in with its source already set
  const img = document.createElement('img');
  img.alt = 'frame';
  img.src = start.url;
  const stateEl = el.querySelector<HTMLElement>('.stage .state')!;
  el.querySelector('.stage')!.prepend(img);
  const scrub = el.querySelector<HTMLElement>('.scrub')!;
  const lanes = el.querySelector<HTMLElement>('.lanes')!;
  const thumbs = el.querySelector<HTMLElement>('.thumbs')!;
  const ticks = el.querySelector<HTMLElement>('.ticks')!;
  const head = el.querySelector<HTMLElement>('.head')!;
  const slotband = el.querySelector<HTMLElement>('.slotband')!;
  const cap = el.querySelector<HTMLElement>('.cap')!;
  const b = (a: string) => el.querySelector<HTMLButtonElement>(`button[data-a="${a}"]`)!;

  let frames: Frame[] = [];
  let range: TimeWindow = { from: start.ts, to: start.ts + 1 };
  let ivs: Interval[] = [];
  let t = start.ts;
  let cur: PlayerSlot | null = ctx.slotAt(start.ts);
  let playing = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let hiTimer: ReturnType<typeof setTimeout> | null = null;
  let loadSeq = 0;
  let gone = false;

  const xOf = (ts: number) => ((ts - range.from) / Math.max(1, range.to - range.from)) * 100;
  const now = () => Date.now();

  function labels(): void {
    b('fps').textContent = prefs.fps + ' fps';
    b('reach').textContent = prefs.reach === 'near' ? '±' + NEAR_SLOTS + ' slots' : 'All';
    b('style').textContent = prefs.style === 'ticks' ? 'Ticks' : 'Thumbs';
    b('play').textContent = playing ? '❚❚' : '▶';
    const n = inSlot().length;
    b('play').disabled = n < 2;
    b('play').title = n < 2 ? 'One frame in this slot: nothing to play' : playing ? 'Pause (Space)' : 'Play the ' + n + ' frames in this slot (Space)';
    el.classList.toggle('thumbs', prefs.style === 'thumbs');
  }

  /* the frames taken within the current slot: what Play loops */
  function inSlot(): Frame[] {
    return cur ? frames.filter((f) => f.ts >= cur!.from && f.ts < cur!.to) : [];
  }
  function drawSlot(): void {
    slotband.style.display = cur ? '' : 'none';
    if (!cur) {return;}
    slotband.style.left = xOf(cur.from) + '%';
    slotband.style.width = Math.max(0, xOf(cur.to) - xOf(cur.from)) + '%';
  }

  /* the scrubber's stretches, ticks and (when chosen) thumbnails */
  function drawScrub(): void {
    drawSlot();
    lanes.textContent = '';
    for (const iv of ivs) {
      if (iv.kind === 'frame' || iv.kind === 'pending') {continue;}
      const d = document.createElement('div');
      d.className = 'lane ' + iv.kind;
      if (iv.kind === 'paused' && iv.pause?.color) {d.style.setProperty('--ktl-band', iv.pause.color);}
      if (iv.kind === 'paused') {d.title = pauseInfo({ paused: true, label: iv.pause?.label, color: iv.pause?.color }).label.toLowerCase();}
      d.style.left = xOf(iv.from) + '%';
      d.style.width = Math.max(0, xOf(iv.to) - xOf(iv.from)) + '%';
      lanes.appendChild(d);
    }
    ticks.textContent = '';
    for (const f of framesIn(frames, range)) {
      const k = document.createElement('div');
      k.className = 'tick';
      k.style.left = xOf(f.ts) + '%';
      ticks.appendChild(k);
    }
    thumbs.textContent = '';
    if (prefs.style === 'thumbs') {
      // one thumbnail per ~56px: the frame in force at each one's centre
      const n = Math.max(4, Math.floor((scrub.clientWidth || 560) / 56));
      for (let i = 0; i < n; i++) {
        const at = range.from + ((i + 0.5) / n) * (range.to - range.from);
        const j = frameIndexAt(frames, at);
        const cell = document.createElement('div');
        cell.className = 'thumb';
        if (j >= 0) {
          const ti = document.createElement('img');
          ti.alt = '';
          ti.loading = 'lazy';
          ti.src = frames[j].url;
          cell.appendChild(ti);
        }
        thumbs.appendChild(cell);
      }
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
    stateEl.textContent = kind === 'dropped' ? 'offline' : kind === 'nodata' ? 'no frame' : kind === 'paused' ? pauseInfo({ paused: true, label: iv?.pause?.label }).label.toLowerCase() : '';
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
    const slotFrames = inSlot();
    const i = f ? slotFrames.indexOf(f) : -1;
    cap.textContent = (ctx.label ? ctx.label + ' — ' : '') + ctx.tt.time(t) + ctx.tt.sfx(t) +
      (f && f.ts !== t ? ' · frame ' + ctx.tt.time(f.ts) + ctx.tt.sfx(f.ts) : '') +
      (slotFrames.length > 1 && i >= 0 ? ' · ' + (i + 1) + '/' + slotFrames.length + ' in slot' : '');
  }

  /* the current slot's frames at full resolution, once per slot: merged in,
   * and Play and the caption know them */
  const detailed = new Set<number>();
  async function ensureDetail(sl: PlayerSlot | null): Promise<void> {
    if (!ctx.detail || !sl || detailed.has(sl.from)) {return;}
    detailed.add(sl.from);
    let got: Frame[] = [];
    try { got = await ctx.detail(sl.from, sl.to); } catch { return; }
    if (gone || !got.length) {return;}
    const byTs = new Map(frames.map((f) => [f.ts, f]));
    for (const f of got) {byTs.set(f.ts, f);}
    frames = [...byTs.values()].sort((x, y) => x.ts - y.ts);
    ivs = ctx.intervals(frames, range);
    drawScrub();
    labels();
    show();
  }

  /* move the playhead; the crosshair follows only to another slot */
  function seek(to: number, publish = true): void {
    t = Math.max(range.from, Math.min(range.to, to));
    const sl = ctx.slotAt(t);
    const moved = !cur || !sl || sl.from !== cur.from;
    cur = sl;
    if (moved) { drawSlot(); labels(); void ensureDetail(sl); }
    show();
    if (publish && moved && sl && ctx.onTime) {ctx.onTime(sl.ts);}
  }

  /* load the range around a time (its frames and intervals), then show */
  async function load(around: number, keepT = true): Promise<void> {
    const seq = ++loadSeq;
    range = reachRange(prefs.reach, around, ctx.step, ctx.window, now());
    let got: Frame[] = [];
    try { got = await ctx.fetch(range.from - 1, range.to); } catch (e) { console.warn('[visual-timeline] player fetch failed:', e); }
    if (gone || seq !== loadSeq) {return;}
    frames = got.slice().sort((x, y) => x.ts - y.ts);
    ivs = ctx.intervals(frames, range);
    drawScrub();
    seek(keepT ? around : range.from, false);
    labels();   // Play knows the slot's frames now
    void ensureDetail(cur);
  }

  function stop(): void {
    playing = false;
    if (timer) { clearInterval(timer); timer = null; }
    labels();
  }
  /* the next frame within the slot, round and round: the crosshair stays */
  function tick(): void {
    const fs = inSlot();
    if (fs.length < 2) { stop(); return; }
    const i = fs.findIndex((f) => f.ts > t);
    const f = fs[i < 0 ? 0 : i];
    t = f.ts;
    show();
    // the next few load ahead
    const j = fs.indexOf(f);
    for (let k = 1; k <= 3; k++) { const p = new Image(); p.src = fs[(j + k) % fs.length].url; }
  }
  function play(): void {
    if (playing || inSlot().length < 2) {return;}
    playing = true;
    labels();
    timer = setInterval(tick, 1000 / prefs.fps);
  }

  const act = (a: string): void => {
    switch (a) {
      case 'play': if (playing) {stop();} else {play();} break;
      case 'prev': case 'next': {
        stop();
        const f = stepFrame(frames, t, a === 'next' ? 1 : -1, range);
        if (f) {seek(f.ts);}
        break;
      }
      case 'prev-slot': case 'next-slot': {
        stop();
        // the neighbouring slot, at the frame the strip shows for it
        const edge = cur ? (a === 'next-slot' ? cur.to : cur.from - 1) : t + (a === 'next-slot' ? 1 : -1) * ctx.step;
        const sl = ctx.slotAt(edge);
        if (!sl || (cur && sl.from === cur.from)) {break;}
        const to = sl.frameTs !== undefined && sl.frameTs >= sl.from && sl.frameTs < sl.to ? sl.frameTs : sl.ts;
        if (to < range.from || to > range.to) {
          void load(to).then(() => { cur = null; seek(to); });
        } else {seek(to);}
        break;
      }
      case 'fps': prefs.fps = FPS[(FPS.indexOf(prefs.fps) + 1) % FPS.length]; savePrefs(prefs); if (playing) { stop(); play(); } labels(); break;
      case 'reach': prefs.reach = prefs.reach === 'near' ? 'all' : 'near'; savePrefs(prefs); labels(); void load(t); break;
      case 'style': prefs.style = prefs.style === 'ticks' ? 'thumbs' : 'ticks'; savePrefs(prefs); labels(); drawScrub(); show(); break;
    }
  };
  el.querySelector('.bar')!.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest('button')?.dataset.a;
    if (a && a !== 'close') {act(a);}
  });

  // the scrubber: press and drag
  const tAt = (clientX: number) => {
    const r = scrub.getBoundingClientRect();
    return range.from + Math.max(0, Math.min(1, (clientX - r.left) / Math.max(1, r.width))) * (range.to - range.from);
  };
  scrub.addEventListener('pointerdown', (e) => {
    stop();
    scrub.setPointerCapture?.(e.pointerId);
    seek(tAt(e.clientX));
    const move = (ev: PointerEvent) => seek(tAt(ev.clientX));
    const up = () => { scrub.removeEventListener('pointermove', move); scrub.removeEventListener('pointerup', up); };
    scrub.addEventListener('pointermove', move);
    scrub.addEventListener('pointerup', up);
  });

  const keyH = (e: KeyboardEvent) => {
    const k = e.key;
    if (k === ' ') { e.preventDefault(); act('play'); }
    else if (k === 'ArrowLeft') { e.preventDefault(); act(e.shiftKey ? 'prev-slot' : 'prev'); }
    else if (k === 'ArrowRight') { e.preventDefault(); act(e.shiftKey ? 'next-slot' : 'next'); }
  };
  document.addEventListener('keydown', keyH);

  img.onload = place;
  img.onerror = () => { if (img.dataset.hiOf) { img.src = img.dataset.hiOf; delete img.dataset.hiOf; } };
  if (img.complete) {place();}
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
