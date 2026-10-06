import { pauseInfo } from '../model/eras';
import { ghostFor, slotClass } from '../model/slots';
import { fmtDur } from '../time/zones';
import { hiUrlFor } from '../backends/api';
import { esc, headTitle, tagChips } from '../dom/html';
import { dressGhost } from '../ui/ghost';
import { q } from '../ui/wrapper';
import { attachZoneChip, zoneChip } from '../zones/chip';
import { zoneFor } from '../zones/source';
import type { SourceDecl, SourceModel } from '../types';
import { hideSelection, setCursor, showSelection } from './cursor';
import type { Card, TimelineState } from './state';

/* Post-layout dressing, idempotent and re-runnable:
 * - align each empty slot's hatch to its strip offset so the diagonals run
 *   continuously across gap runs (per-element gradients restart at every
 *   slot edge; narrow runs otherwise read as one solid block)
 * - wide pause bands carry their label inline: a strip that is ALL
 *   "screen dark" should say so without requiring a hover
 * Needs real layout — called at build (visible mounts), again after
 * reveal with retries (panels that mount before they have a size), and by
 * the live poll after it carves new slots out of the beyond filler. */
export function dressStrip(model: SourceModel): void {
  for (const sl of model.slots) {
    if (!sl.el || sl.frame) {continue;}
    sl.el.style.backgroundPosition = (-sl.el.offsetLeft) + 'px 0';
    if (sl.paused && sl.el.offsetWidth >= 90 && !sl.el.querySelector('.band-label')) {
      const lab = document.createElement('span');
      lab.className = 'band-label';
      lab.textContent = pauseInfo(sl).label;
      sl.el.appendChild(lab);
    }
  }
}
export function dressAll(s: TimelineState, tries: number): void {
  const anySized = s.kiosks.some((k) => s.cards[k.id] && s.cards[k.id].strip.clientWidth > 0);
  if (!anySized) {
    if (tries > 0 && !s.destroyed) {setTimeout(() => dressAll(s, tries - 1), 500);}
    return;
  }
  for (const k of s.kiosks) {if (s.cards[k.id]) {dressStrip(s.cards[k.id].model);}}
}

/* One source's card: header, strip (one element per slot), magnifier,
 * crosshair and selection band, with the strip's hover, click-in preview
 * and drag-zoom handlers. Every element queried below (asserted non-null)
 * is in the card template set here. */
export function buildCard(s: TimelineState, decl: SourceDecl, model: SourceModel): Card {
  const kiosk = decl.id;
  const zone = zoneFor(decl, s.TZ, s.cfg.thumbTimes, s.PANEL_TT), tt = zone.tt;
  const card = document.createElement('div');
  const inline = s.cfg.headerMode === 'inline' || s.cfg.headerMode === 'inline-gradient';
  card.className = 'card' + (inline ? ' inline-head' : '') +
    (s.cfg.headerMode === 'inline-gradient' ? ' inline-grad' : '');
  const la = model.lastActive;
  const cad = s.cfg.showDetails && la
    ? '<span class="cad">⏱ ' + fmtDur(la.cadence) + ' · 1/' + fmtDur(la.step) + (la.step > la.cadence ? ' ↓' : '') + '</span>'
    : '';
  card.innerHTML =
    '<div class="card-head" title="' + esc(headTitle(decl)) + '"><span class="nm">' + esc(kiosk) + '</span>' +
    '<span class="inline-brk"></span>' + zoneChip(zone.srcTZ) +
    '<span class="st">' + esc(decl.site) + (decl.location ? ' · ' + esc(decl.location) : '') + '</span>' +
    tagChips(decl) + '<span class="ft"></span>' +
    cad + '</div>' +
    '<div class="strip"><div class="xh"></div><div class="sel"></div><div class="mag"><img alt=""><div class="cap"></div></div></div>' +
    '<div class="card-lane"></div>';
  const strip = card.querySelector<HTMLElement>('.strip')!;
  // hairline frame boundaries only when slices are wide enough — below
  // ~12px they read as zebra noise rather than structure
  if (s.hostWidth / model.slots.length >= 12) {strip.classList.add('sep');}
  const slots = model.slots;
  for (const sl of slots) {
    const el = document.createElement('div');
    el.className = 'slot' + slotClass(sl);
    if (sl.paused) {el.title = pauseInfo(sl).label.toLowerCase();}
    // width ∝ time span, so x↔time stays linear across era boundaries
    el.style.flexGrow = String(sl.span / 1000);
    if (sl.frame) {
      const img = document.createElement('img');
      img.alt = kiosk + ' ' + tt.time(sl.ts) + tt.sfx(sl.ts);
      el.appendChild(img);
      s.images.add(img, sl.frame.url, sl.ts);   // newest first, across all cards
    }
    strip.appendChild(el);
    sl.el = el;
  }
  for (const sl of slots) {if (sl.future) {dressGhost(slots, sl);}}
  dressStrip(model);   // hatch alignment + band labels (re-run post-reveal)
  const hoverAt = (e: MouseEvent) => {
    const r = strip.getBoundingClientRect();
    if (!r.width) {return;}   // stale wrapper mid-swap: no geometry, no cursor
    const t = s.P.from + s.SPAN * ((e.clientX - r.left) / r.width);
    setCursor(s, t, card, false);
  };
  strip.addEventListener('mousemove', hoverAt);
  strip.addEventListener('mouseenter', e => {
    s.wrap.classList.add('strip-hover');
    // a refresh swaps the DOM under a STATIONARY cursor: the browser fires
    // mouseenter on the new strip but no mousemove, so without this the
    // dim class lands with no card marked hovered — everything dims,
    // including the strip under the mouse
    hoverAt(e);
  });
  strip.addEventListener('mouseleave', () => {
    s.wrap.classList.remove('strip-hover');
    if (s.cfg.onHoverClear) {s.cfg.onHoverClear();}
  });
  strip.addEventListener('click', e => {
    if (s.suppressClick) { s.suppressClick = false; return; }
    const sl = model.slotAt(s.cursorT);
    const f = sl && sl.frame;
    const g = !f && sl && sl.future ? ghostFor(model.slots, sl) : null;
    if (f) {s.pv.open(decl.site, kiosk, f, e.clientX, e.clientY, hiUrlFor(f, decl, s.cfg.apiUrl, s.cfg.apiKey), null, tt);}
    else if (g) {s.pv.open(decl.site, kiosk, g, e.clientX, e.clientY, null, sl!.ts, tt);}   // g is only set from a slot
  });
  /* magnifier takes the aspect of the actual frames (portrait screens etc.) */
  const magEl = card.querySelector<HTMLElement>('.mag')!;
  const magImg = magEl.querySelector('img')!;
  magImg.addEventListener('load', () => {
    if (magImg.naturalWidth && magImg.naturalHeight)
      {magEl.style.aspectRatio = String(magImg.naturalWidth / magImg.naturalHeight);}
  });
  /* drag-select = zoom, grafana-style: band across all cards, release → onZoom */
  strip.addEventListener('mousedown', e => {
    if (e.button !== 0) {return;}
    e.preventDefault();
    const r = strip.getBoundingClientRect();
    const fracOf = (x: number) => Math.max(0, Math.min(1, (x - r.left) / r.width));
    const f0 = fracOf(e.clientX);
    let dragged = false;
    const move = (ev: MouseEvent) => {
      if (s.destroyed) {return up(ev);}
      const f1 = fracOf(ev.clientX);
      if (Math.abs(f1 - f0) * r.width > 5) {dragged = true;}
      if (dragged) {
        showSelection(s, f0, f1);
        setCursor(s, s.P.from + s.SPAN * f1, card, false);
      }
    };
    const up = (ev: MouseEvent) => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      hideSelection(s);
      if (dragged && !s.destroyed) {
        s.suppressClick = true;
        const f1 = fracOf(ev.clientX);
        const a = Math.min(f0, f1), b = Math.max(f0, f1);
        if (b > a && s.cfg.onZoom) {s.cfg.onZoom(Math.round(s.P.from + s.SPAN * a), Math.round(s.P.from + s.SPAN * b));}
      }
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
  q(s.wrap, '.cards').appendChild(card);
  attachZoneChip(zone, card);
  return {
    card, model, zone, tt,
    head: card.querySelector<HTMLElement>('.ft')!,
    strip,
    cross: card.querySelector<HTMLElement>('.xh')!,
    sel: card.querySelector<HTMLElement>('.sel')!,
    mag: card.querySelector<HTMLElement>('.mag')!,
    lane: card.querySelector<HTMLElement>('.card-lane')!,
  };
}
