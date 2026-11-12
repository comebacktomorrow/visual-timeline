import { pauseInfo } from '../model/eras';
import { ghostFor, slotClass } from '../model/slots';
import { fmtDur } from '../time/zones';
import { esc, filterAttrs, headChips, headTitle } from '../dom/html';
import { dressGhost } from '../ui/ghost';
import { q } from '../ui/wrapper';
import { attachZoneChip, zoneChip } from '../zones/chip';
import { zoneFor, type ZoneTexts } from '../zones/source';
import type { Slot, SourceDecl, SourceModel } from '../types';
import { ruleBeyond } from './axis';
import { hideSelection, setCursor, showSelection } from './cursor';
import { playerContext } from '../ui/playerContext';
import { makeFlipbook } from './flipbook';
import { clipTime, playVideo, Reel, videoTime } from '../model/reel';
import { measureReel, noteClipLength } from '../ui/clipLength';
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

/* A strip's slot elements, from its model: built at mount and again by
 * the live poll after each refresh. Slots showing the same frame side by
 * side are one cell (a frame that stood for 20 minutes is 20 minutes wide),
 * and an element whose content is unchanged is reused, so its image
 * doesn't reload. Dropped time inside cells that show a frame is drawn as
 * marks at its true place. */
export function renderStrip(s: TimelineState, model: SourceModel, strip: HTMLElement, kiosk: string, tt: ZoneTexts): void {
  type Cell = { key: string; slots: Slot[] };
  const cells: Cell[] = [];
  for (const sl of model.slots) {
    const key = sl.frame ? 'f:' + sl.frame.ts + ':' + sl.frame.url
      : sl.paused ? 'p:' + sl.x0 : sl.beyond ? 'b' : sl.clip ? 'c:' + sl.clip.from + ':' + sl.clip.url
      : (sl.future ? 'u:' : sl.nodata ? 'n:' : 'g:') + sl.x0;
    const last = cells[cells.length - 1];
    // slots showing the same frame, or the same clip, are one cell
    if ((sl.frame || sl.clip) && last && last.key === key) {last.slots.push(sl);}
    else {cells.push({ key, slots: [sl] });}
  }
  const old = ((strip as StripEl).__cells ??= new Map<string, HTMLElement>());
  const next = new Map<string, HTMLElement>();
  const before = strip.querySelector('.drops');
  for (const cell of cells) {
    const sl = cell.slots[0];
    let el = old.get(cell.key);
    const fresh = !el;
    if (!el) {el = document.createElement('div');}
    old.delete(cell.key);
    next.set(cell.key, el);
    const cls = 'slot' + slotClass(sl) + (cell.slots.some((x) => !x.paused && !x.beyond && x.count > 1) ? ' multi' : '');
    if (el.className !== cls) {el.className = cls;}
    // width ∝ time span, so x↔time stays linear
    const span = cell.slots.reduce((a, x) => a + x.span, 0);
    el.style.flexGrow = String(span / 1000);
    if (sl.paused) {
      const pi = pauseInfo(sl);
      el.title = pi.label.toLowerCase();
      if (pi.color) {el.style.setProperty('--ktl-band', pi.color);}
    }
    if (sl.frame && fresh) {
      const img = document.createElement('img');
      img.alt = kiosk + ' ' + tt.time(sl.frame.ts) + tt.sfx(sl.frame.ts);
      el.appendChild(img);
      s.images.add(img, sl.frame.url, sl.frame.ts);   // newest first, across all cards
    }
    for (const x of cell.slots) {x.el = el;}
    strip.insertBefore(el, before);
  }
  for (const el of old.values()) {el.remove();}
  (strip as StripEl).__cells = next;
  // hairline cell boundaries only when cells are wide enough — below ~12px
  // they read as zebra noise rather than structure
  strip.classList.toggle('sep', s.hostWidth / Math.max(1, cells.length) >= 12);
  for (const sl of model.slots) {if (sl.future) {dressGhost(model.slots, sl);}}
  // dropped time inside cells that show a frame, at its true place
  let drops = strip.querySelector<HTMLElement>('.drops');
  if (model.drops.length && !drops) {
    drops = document.createElement('div');
    drops.className = 'drops';
    strip.appendChild(drops);
  }
  if (drops) {
    drops.textContent = '';
    for (const d of model.drops) {
      const m = document.createElement('div');
      m.className = 'drop';
      m.style.left = ((d.from - s.P.from) / s.SPAN * 100).toFixed(4) + '%';
      m.style.width = ((d.to - d.from) / s.SPAN * 100).toFixed(4) + '%';
      drops.appendChild(m);
    }
  }
  // where the host has video (M10c), when the panel asks: a thin line along
  // the strip's foot, over frames too (the preview plays the video there)
  let clipsEl = strip.querySelector<HTMLElement>('.clips');
  const inWindow = s.cfg.videoLine ? model.clips.filter((c) => c.to > s.P.from && c.from < s.P.to) : [];
  if (inWindow.length && !clipsEl) {
    clipsEl = document.createElement('div');
    clipsEl.className = 'clips';
    strip.appendChild(clipsEl);
  }
  if (clipsEl) {
    clipsEl.textContent = '';
    for (const c of inWindow) {
      const a = Math.max(c.from, s.P.from), b = Math.min(c.to, s.P.to);
      const m = document.createElement('div');
      m.className = 'cliplane';
      m.style.left = ((a - s.P.from) / s.SPAN * 100).toFixed(4) + '%';
      m.style.width = ((b - a) / s.SPAN * 100).toFixed(4) + '%';
      clipsEl.appendChild(m);
    }
  }
  const tail = model.slots[model.slots.length - 1];
  if (tail && tail.beyond) {ruleBeyond(s, tail);}
}
type StripEl = HTMLElement & { __cells?: Map<string, HTMLElement> };

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
  // the promise in force (or, with none, the typical gap) and the slot step
  const cad = s.cfg.showDetails && la
    ? '<span class="cad" title="' + esc(model.promised
        ? 'Promises a frame every ' + fmtDur(la.cadence) + '; one slot per ' + fmtDur(la.step)
        : 'Promises no cadence: frames are typically ' + fmtDur(la.cadence) + ' apart; one slot per ' + fmtDur(la.step)) + '">⏱ ' +
      (model.promised ? '' : '~') + fmtDur(la.cadence) + ' · 1/' + fmtDur(la.step) + (la.step > la.cadence ? ' ↓' : '') +
      (model.promised ? '' : ' · no promise') + '</span>'
    : '';
  card.innerHTML =
    '<div class="card-head" title="' + esc(headTitle(decl)) + '"><span class="nm"' + filterAttrs('host', kiosk, !!s.cfg.onFilter) + '>' + esc(kiosk) + '</span>' +
    '<span class="inline-brk"></span>' + zoneChip(zone.srcTZ) +
    headChips(decl, s.cfg.chips, !!s.cfg.onFilter) + '<span class="ft"></span>' +
    cad + '</div>' +
    '<div class="strip"><div class="xh"></div><div class="sel"></div><div class="mag"><img alt=""><div class="cap"></div></div></div>' +
    '<div class="card-lane"></div>';
  const strip = card.querySelector<HTMLElement>('.strip')!;
  // hairline frame boundaries only when slices are wide enough — below
  // ~12px they read as zebra noise rather than structure
  renderStrip(s, model, strip, kiosk, tt);
  dressStrip(model);   // hatch alignment + band labels (re-run post-reveal)
  // the hover flipbook: a slot of several frames plays them in the
  // magnifier once the cursor has rested on it (flipbook.ts)
  let rec: Card | null = null;
  // the slot's reel, from the same source the preview player reads
  const source = playerContext(s.backend, s.cfg, s.P, decl, model, tt, () => {});
  // the magnifier's video (a clip's part, round and round): stopped, and its
  // download let go of
  const releaseVideo = (m: HTMLElement) => {
    m.classList.remove('flip-video');
    const v = m.querySelector('video');
    if (!v) {return;}
    v.onloadedmetadata = v.ontimeupdate = v.onended = null;
    v.pause();
    v.removeAttribute('src');
    v.load();
    v.remove();
  };
  const flip = makeFlipbook({
    alive: () => !s.destroyed,
    reel: (slot) => new Reel(source, slot),
    show: (at, t, i, n) => {
      const m = rec?.mag;
      if (!m) {return;}
      const im = m.querySelector('img')!;
      if (at.frame && im.getAttribute('src') !== at.frame.url) {im.src = at.frame.url;}
      // a gap shows its reason over the last frame, dimmed, as the player
      // does; so does a stretch only video covers (zoomed out)
      m.classList.toggle('flip-gap', at.gap || at.kind === 'clip');
      const reason = at.kind === 'dropped' ? 'offline' : at.kind === 'nodata' ? 'no frame' : at.kind === 'clip' ? 'video'
        : at.kind === 'paused' ? pauseInfo({ paused: true, label: at.interval?.pause?.label }).label.toLowerCase() : '';
      const ts = at.gap || at.kind === 'clip' || !at.frame ? t : at.frame.ts;
      m.querySelector('.cap')!.textContent = tt.time(ts) + tt.sfx(ts) + (reason ? ' · ' + reason : '') + ' · ' + (i + 1) + '/' + n;
    },
    measure: (r) => measureReel(r, source.key),
    // a clip's part of the slot, the smaller version, muted, round and round
    clip: (span, rate = 1) => {
      const m = rec?.mag;
      if (!m) {return;}
      if (!span || s.destroyed) { releaseVideo(m); return; }
      let v = m.querySelector('video');
      if (!v) {
        v = document.createElement('video');
        v.muted = true;
        v.playsInline = true;
        m.insertBefore(v, m.querySelector('.cap'));
      }
      const vid = v;
      const from = () => videoTime(span.clip, span.from, vid.duration), to = () => videoTime(span.clip, span.to, vid.duration);
      const again = () => { vid.currentTime = from(); vid.playbackRate = rate; playVideo(vid).catch(() => {}); };
      vid.onloadedmetadata = () => {
        noteClipLength(span.clip.url, vid.duration);
        if (vid.videoWidth && vid.videoHeight) {m.style.aspectRatio = String(vid.videoWidth / vid.videoHeight);}
        again();
      };
      vid.ontimeupdate = () => {
        const at = clipTime(span.clip, vid.currentTime, vid.duration);
        m.querySelector('.cap')!.textContent = '▶ ' + tt.time(at) + tt.sfx(at) + ' · video';
        if (vid.currentTime >= to() - 0.05) {again();}
      };
      vid.onended = again;
      m.classList.add('flip-video');
      vid.src = span.clip.url;
    },
    playingChanged: (on) => {
      if (!rec) {return;}
      rec.mag.classList.toggle('flip', on);
      if (!on) {rec.mag.classList.remove('flip-gap');}
      // back to the slot's own frame
      if (!on && !s.destroyed) { rec.shown = null; setCursor(s, s.cursorT, null, true); }
    },
  }, !!s.backend.detail, (sl) => model.clips.some((c) => c.to > sl.x0 && c.from < sl.x0 + sl.span), !!s.cfg.videoAutoSpeed);
  // the preview is a player over this host's frames; it moves the crosshair
  const player = () => playerContext(s.backend, s.cfg, s.P, decl, model, tt, (t) => { if (!s.destroyed) {setCursor(s, t, null, false);} },
    s.cfg.onZoom ? (from, to) => { if (!s.destroyed) {s.cfg.onZoom!(Math.floor(from), Math.ceil(to));} } : undefined);
  const hoverAt = (e: MouseEvent) => {
    const r = strip.getBoundingClientRect();
    if (!r.width) {return;}   // stale wrapper mid-swap: no geometry, no cursor
    const t = s.P.from + s.SPAN * ((e.clientX - r.left) / r.width);
    setCursor(s, t, card, false);
    flip.hover(model.slotAt(s.cursorT));
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
    flip.stop();
    s.wrap.classList.remove('strip-hover');
    if (s.cfg.onHoverClear) {s.cfg.onHoverClear();}
  });
  strip.addEventListener('click', e => {
    flip.stop();
    if (s.suppressClick) { s.suppressClick = false; return; }
    const sl = model.slotAt(s.cursorT);
    const f = sl && sl.frame;
    const g = !f && sl && sl.future ? ghostFor(model.slots, sl) : null;
    if (f) {s.pv.open(decl.site, kiosk, f, e.clientX, e.clientY, f.hi ?? null, null, tt, player());}
    // a slot a video clip covers: the player, at the slot's time (M10c)
    else if (sl && !sl.paused && !sl.beyond && sl.clip) {s.pv.play(decl.site, kiosk, sl.ts, e.clientX, e.clientY, tt, player());}
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
    flip.stop();
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
  rec = {
    card, model, zone, tt, flip, player,
    // the mount's teardown: no flipbook, no video, left running
    teardown: () => { flip.stop(); releaseVideo(magEl); },
    head: card.querySelector<HTMLElement>('.ft')!,
    strip,
    cross: card.querySelector<HTMLElement>('.xh')!,
    sel: card.querySelector<HTMLElement>('.sel')!,
    mag: card.querySelector<HTMLElement>('.mag')!,
    lane: card.querySelector<HTMLElement>('.card-lane')!,
  };
  return rec;
}
