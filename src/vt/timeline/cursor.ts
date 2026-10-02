import { clearPauseClasses, pauseInfo } from '../model/eras';
import { ghostFor } from '../model/slots';
import { fmtTime } from '../time/zones';
import { q } from '../ui/wrapper';
import { dressZoneChip } from '../zones/chip';
import type { Frame, TimeWindow } from '../types';
import type { TimelineState } from './state';

/* The timeline's cursor: where it rests at mount, the drag-zoom selection
 * band, and setCursor, which moves the crosshair, the magnifier and the
 * header status of every card (the scrub path: it never rebuilds slots). */

/* A user-pinned cursor (they hovered/scrubbed) survives remounts at the
 * same ABSOLUTE time, clamped into the new window; an untouched cursor
 * keeps following the live edge. Persisted on the root, which outlives
 * the wrapper swaps. */
export function restoreCursor(root: HTMLElement, P: TimeWindow): number {
  const saved = Number(root.dataset.ktlCursor);
  if (root.dataset.ktlPinned === '1' && Number.isFinite(saved)) {
    return Math.max(P.from, Math.min(P.to, saved));
  }
  return Math.min(P.to, Date.now());
}

/* selection band shown on every card during drag-zoom (fractions of window) */
export function showSelection(s: TimelineState, fa: number, fb: number): void {
  const a = Math.min(fa, fb), b = Math.max(fa, fb);
  for (const k of s.kiosks) {
    const c = s.cards[k.id];
    if (!c) {continue;}
    const w = c.strip.clientWidth;
    c.sel.style.display = 'block';
    c.sel.style.left = (a * w) + 'px';
    c.sel.style.width = ((b - a) * w) + 'px';
  }
}
export function hideSelection(s: TimelineState): void {
  for (const k of s.kiosks) {if (s.cards[k.id]) {s.cards[k.id].sel.style.display = 'none';}}
}

/* external=true → came from the event bus; don't re-publish (no loop).
 * The magnifier's img and .cap (asserted non-null) are in buildCard's
 * template. */
export function setCursor(s: TimelineState, t: number, hoveredCard: HTMLElement | null, external: boolean): void {
  s.cursorT = Math.max(s.P.from, Math.min(s.P.to, t));
  s.root.dataset.ktlCursor = String(s.cursorT);
  if (!external) {s.root.dataset.ktlPinned = '1';}
  if (s.cfg.onCursor) {s.cfg.onCursor(s.cursorT);}        // host chrome hook (standalone app)
  const frac = (s.cursorT - s.P.from) / s.SPAN;

  const axis = q(s.wrap, '.axis'), ac = q(s.wrap, '.acur');
  const acW = ac.offsetWidth || 50;
  ac.textContent = fmtTime(s.cursorT, s.TZ);
  ac.style.left = Math.max(acW / 2, Math.min(axis.clientWidth - acW / 2, frac * axis.clientWidth)) + 'px';

  for (const k of s.kiosks) {
    const c = s.cards[k.id];
    if (!c) {continue;}
    // external cursor moves (event bus) must not strip local hover state —
    // other panels re-emit hover events and would un-dim us mid-hover
    if (!external) {c.card.classList.toggle('hovered', hoveredCard === c.card);}
    const w = c.strip.clientWidth, x = frac * w;
    c.cross.style.left = x + 'px';
    const slot = c.model.slotAt(s.cursorT);
    const tt = c.tt;
    // the zone chip's offset at the cursor: changes only across a DST edge
    if (c.zone.el) {dressZoneChip(c.zone, s.cursorT);}
    const magW = c.mag.offsetWidth || c.strip.clientHeight * 16 / 9;
    c.mag.style.left = Math.max(0, Math.min(w - magW, x - magW / 2)) + 'px';
    c.mag.classList.remove('ghost');
    if (slot && slot.frame) {
      c.mag.classList.remove('gap', 'future', 'off'); clearPauseClasses(c.mag);
      c.mag.querySelector('img')!.src = slot.frame.url;
      c.mag.querySelector('.cap')!.textContent = tt.time(slot.frame.ts) + tt.sfx(slot.frame.ts);
      c.head.textContent = '';                 // healthy: time lives on the magnifier
      c.head.classList.remove('stale'); clearPauseClasses(c.head);
    } else if (slot && slot.paused) {
      // declared silence — neutral (or amber when unintended), not offline-red
      const pi = pauseInfo(slot);
      c.mag.classList.remove('gap', 'future', 'off'); clearPauseClasses(c.mag);
      c.mag.classList.add(...pi.classes);
      c.mag.querySelector('.cap')!.textContent = pi.label.toLowerCase();
      c.head.textContent = pi.label.toLowerCase();
      c.head.classList.remove('stale'); clearPauseClasses(c.head);
      c.head.classList.add(...pi.classes);
    } else if (slot && slot.beyond) {
      // ahead of now: unknown — nothing to preview, only the crosshair
      c.mag.classList.remove('gap', 'future'); clearPauseClasses(c.mag);
      c.mag.classList.add('off');
      c.head.textContent = '';
      c.head.classList.remove('stale'); clearPauseClasses(c.head);
    } else if (slot && slot.future) {
      // not offline, not stale: either the tick is ahead of now, or it
      // just passed and its frame is still in flight (one-step grace)
      const inFlight = slot.ts <= Date.now();
      const g = ghostFor(c.model.slots, slot);
      c.mag.classList.remove('gap', 'off'); clearPauseClasses(c.mag);
      c.mag.classList.add('future');
      if (g) { c.mag.classList.add('ghost'); c.mag.querySelector('img')!.src = g.url; }
      c.mag.querySelector('.cap')!.textContent = (inFlight ? 'expected — ' : 'upcoming — ') + tt.short(slot.ts) +
        (g ? ' · last frame ' + tt.time(g.ts) : '') + tt.sfx(slot.ts);
      c.head.textContent = inFlight ? 'expected' : 'upcoming';
      c.head.classList.remove('stale'); clearPauseClasses(c.head);
    } else {
      c.mag.classList.add('gap');
      c.mag.classList.remove('future', 'off'); clearPauseClasses(c.mag);
      const i = slot ? c.model.slots.indexOf(slot) : c.model.slots.length - 1;
      let last: Frame | null | undefined = null;
      for (let j = i; j >= 0; j--) {if (c.model.slots[j].frame) { last = c.model.slots[j].frame; break; }}
      const msg = last ? 'offline — last seen ' + tt.time(last.ts) + tt.sfx(last.ts) : 'no data in window';
      c.mag.querySelector('.cap')!.textContent = msg;
      c.head.textContent = msg;
      c.head.classList.add('stale');
      clearPauseClasses(c.head);
    }
  }
  if (!external && s.cfg.onHover) {s.cfg.onHover(s.cursorT);}
}
