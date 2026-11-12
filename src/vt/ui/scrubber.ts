import { pauseInfo } from '../model/eras';
import type { Reel } from '../model/reel';
import type { ScrubStyle } from './playerPrefs';
import type { Frame } from '../types';

/* The preview player's scrubber (player.ts): the current slot's own
 * timeline. It draws the slot's stretches (dropped, no data, pauses, a
 * clip's part), a tick per frame shown and, as thumbnails, pictures of
 * them; it follows the mouse (a press and drag holds on to it), and, when
 * focused, steps with ←/→ and goes to the slot's ends with Home/End. It's a
 * slider: its value is the playhead, read out as the time shown. */

/* As thumbnails, a picture per THUMB_PX of the frames shown. */
const THUMB_PX = 48;

/* an attribute, written only when it changes (the scrubber's, per frame) */
const setAttr = (el: Element, name: string, value: string): void => {
  if (el.getAttribute(name) !== value) {el.setAttribute(name, value);}
};

/** What the scrubber needs from the player around it. */
export interface ScrubberHost {
  /** the slot the player is in */
  reel(): Reel;
  /** how many of the slot's frames it shows */
  most(): number;
  style(): ScrubStyle;
  /** the mouse, Home or End: pause, and the playhead to t */
  seekTo(t: number): void;
  /** ←/→: the previous or next stop */
  step(dir: 1 | -1): void;
}

export interface Scrubber {
  /** the slot's timeline, drawn again */
  draw(): void;
  /** its width (px; 560 before layout) */
  width(): number;
  /** where a time is along it (%) */
  xOf(ts: number): number;
  /** the playhead drawn at t */
  head(t: number): void;
  /** the slider's value: the playhead (epoch ms within the slot), and the
   * time shown as its text */
  value(t: number, text: string): void;
}

export function makeScrubber(scrub: HTMLElement, host: ScrubberHost): Scrubber {
  const lanes = scrub.querySelector<HTMLElement>('.lanes')!;
  const thumbs = scrub.querySelector<HTMLElement>('.thumbs')!;
  const ticks = scrub.querySelector<HTMLElement>('.ticks')!;
  const headEl = scrub.querySelector<HTMLElement>('.head')!;
  const width = () => scrub.clientWidth || 560;
  const slot = () => host.reel().slot;
  const span = () => Math.max(1, slot().to - slot().from);
  const xOf = (ts: number) => ((ts - slot().from) / span()) * 100;

  /* the slot's timeline: its stretches, a tick per frame shown, and (as
   * thumbnails) pictures of them, each running to the next one drawn or to
   * the stretch without a frame after it */
  function draw(): void {
    const reel = host.reel();
    const most = host.most();
    reel.capacity = most;
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
    // a clip's part: a plain bar, the video's own timeline
    for (const c of reel.clipSpans()) {
      const d = document.createElement('div');
      d.className = 'lane clip';
      d.title = 'video';
      d.style.left = Math.max(0, xOf(c.from)) + '%';
      d.style.width = Math.max(0, Math.min(100, xOf(c.to)) - Math.max(0, xOf(c.from))) + '%';
      lanes.appendChild(d);
    }
    ticks.textContent = '';
    for (const f of reel.shown(most)) {
      const k = document.createElement('div');
      k.className = 'tick';
      k.style.left = xOf(f.ts) + '%';
      ticks.appendChild(k);
    }
    // a watched clip is an item too: a tick where it starts
    const watched = reel.watched();
    for (const c of watched) {
      const k = document.createElement('div');
      k.className = 'tick clip-start';
      k.style.left = xOf(c.from) + '%';
      ticks.appendChild(k);
    }
    thumbs.textContent = '';
    if (host.style() !== 'thumbs') {return;}
    const fs = reel.shown(Math.max(4, Math.floor(width() / THUMB_PX)));
    // where a picture stops: a gap or a clip
    const gaps = [...reel.gaps(), ...reel.watched()].sort((a, z) => a.from - z.from);
    const cell = (f: Frame, from: number, to: number, prior = false, clip = false) => {
      const c = document.createElement('div');
      c.className = 'thumb' + (prior ? ' prior' : '') + (clip ? ' clip' : '');
      c.style.left = xOf(from) + '%';
      c.style.width = Math.max(0, xOf(to) - xOf(from)) + '%';
      const ti = document.createElement('img');
      ti.alt = '';
      ti.referrerPolicy = 'no-referrer';
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
    // each watched clip: the still nearest its start, across its part
    for (const c of watched) {
      const f = reel.stillFor(c);
      if (f) {cell(f, c.from, c.to, false, true);}
    }
  }

  // the scrubber follows the mouse, as the strip does (pausing playback);
  // a press and drag holds on to it
  const tAt = (clientX: number) => {
    const r = scrub.getBoundingClientRect();
    return slot().from + Math.max(0, Math.min(1, (clientX - r.left) / Math.max(1, r.width))) * span();
  };
  scrub.addEventListener('pointermove', (e) => host.seekTo(tAt(e.clientX)));
  scrub.addEventListener('pointerdown', (e) => {
    scrub.setPointerCapture?.(e.pointerId);
    host.seekTo(tAt(e.clientX));
  });

  // its own keys, when it has focus: a step, or the slot's ends
  scrub.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) {return;}
    const stops = host.reel().stops(host.most());
    switch (e.key) {
      case 'ArrowLeft': case 'ArrowDown': host.step(-1); break;
      case 'ArrowRight': case 'ArrowUp': host.step(1); break;
      case 'Home': host.seekTo(stops.length ? stops[0] : slot().from); break;
      case 'End': host.seekTo(stops.length ? stops[stops.length - 1] : slot().to - 1); break;
      default: return;
    }
    e.preventDefault();   // handled: the player's document keys leave it
  });

  return {
    draw,
    width,
    xOf,
    head(t) { headEl.style.left = xOf(t) + '%'; },
    value(t, text) {
      setAttr(scrub, 'aria-valuemin', String(Math.round(slot().from)));
      setAttr(scrub, 'aria-valuemax', String(Math.round(slot().to - 1)));
      setAttr(scrub, 'aria-valuenow', String(Math.round(t)));
      setAttr(scrub, 'aria-valuetext', text);
    },
  };
}
