// @ts-nocheck
/* Visual Timeline core — framework-free DOM implementation shared by the
 * Grafana panel entry (module.ts). Deliberately plain JS semantics: the
 * timeline/grid render and update imperatively for scrub-speed, with React
 * only at the panel boundary. */

import { fmtDur, fmtTime, resolveTimeZone } from './vt/time/zones';
import { axisTicks, TICK_STEPS, tickFormat } from './vt/time/ticks';
import { clearPauseClasses, pauseInfo } from './vt/model/eras';
import { buildSourceModel, ghostFor, missedHeartbeat, slotClass } from './vt/model/slots';
import { matchesTags, parseTagFilter, parseVar } from './vt/model/filters';
import { zoneFor, zoneTexts } from './vt/zones/source';
import { hiUrlFor, makeApiBackend } from './vt/backends/api';
import { esc, headTitle, tagChips } from './vt/dom/html';
import { injectStyles } from './vt/dom/styles';
import { makeBackend } from './vt/backends/demo';
import { attachZoneChip, dressZoneChip, zoneChip } from './vt/zones/chip';
import { annTip, normAnnotations } from './vt/ui/annotations';
import { measureTickWidth, TICK_LABEL_GAP } from './vt/time/measure';
import { makePreview } from './vt/ui/preview';

export { fmtShort, fmtTime, resolveTimeZone, zonedParts, zonedTime } from './vt/time/zones';
export { alignedStart, axisTicks, nextTick, TICK_STEPS, tickFormat } from './vt/time/ticks';
export { clearPauseClasses, erasFor, PAUSE_CLASSES, pauseInfo } from './vt/model/eras';
export { buildSourceModel, ghostFor, missedHeartbeat, slotClass } from './vt/model/slots';
export { matchesTags, parseTagFilter } from './vt/model/filters';
export { fmtOffset, sourceTimeZone, zoneHeadText, zoneLabel, zoneOffsetText } from './vt/zones/source';
export { framesPath, hiUrlFor, imageUrlWithKey, makeApiBackend, resolveFrameUrl, sourcesPath } from './vt/backends/api';
export { esc, headTitle, tagChips } from './vt/dom/html';
export { KTL_VAR_DEFAULTS } from './vt/dom/styles';

/* ======================= timeline core ======================= */

/* keep a strip slot's ghost <img> in step with its state: present only
 * while the slot is pending and has something to carry */
function dressGhost(slots, sl) {
  if (!sl.el) {return;}
  const g = sl.future && !sl.frame ? ghostFor(slots, sl) : null;
  let img = sl.el.querySelector('img.ghost');
  if (!g) { if (img) {img.remove();} return; }
  if (!img) { img = document.createElement('img'); img.className = 'ghost'; img.alt = ''; sl.el.appendChild(img); }
  if (img.src !== g.url) {img.src = g.url;}
}

/* Double-buffered remounts. A dashboard refresh tears the panel down and
 * rebuilds it; wiping the root first paints a blank frame (visible flash
 * every refresh tick). Instead each mount builds into its own HIDDEN
 * wrapper and swaps it in once its images have decoded — the previous
 * wrapper stays painted until then. destroy() only marks its wrapper
 * stale; the successor removes it (timeout fallback for true unmounts). */
function makeWrapper(root) {
  const wrap = document.createElement('div');
  wrap.className = 'ktl';
  // absolute stacking + visibility (NOT display:none): the wrapper must
  // have real layout while hidden — axis ticks, crosshair and magnifier
  // positions are measured from clientWidth during build
  root.style.position = 'relative';
  root.classList.add('ktl-root');   // carries the palette defaults (CSS)
  wrap.style.position = 'absolute';
  wrap.style.inset = '0';
  wrap.style.visibility = 'hidden';
  root.appendChild(wrap);
  return wrap;
}
async function revealWrapper(root, wrap) {
  const imgs = [...wrap.querySelectorAll('img')];
  await Promise.race([
    Promise.allSettled(imgs.map(i => (i.decode ? i.decode().catch(() => {}) : Promise.resolve()))),
    new Promise(res => setTimeout(res, 900)),
  ]);
  if (!wrap.isConnected) {return;}
  for (const el of [...root.children]) {if (el !== wrap) {el.remove();}}
  wrap.style.visibility = '';
}
function retireWrapper(wrap) {
  wrap.dataset.stale = '1';
  setTimeout(() => wrap.remove(), 1500);
}

/* cfg: { site, from, to, width, timeZone, thumbTimes, onHover(t), onHoverClear() }
 * timeZone: an IANA name, 'utc', or undefined/'browser' (the viewer's own
 * zone, the default). It sets every time the mount shows as text — axis,
 * cursor, captions, tooltips, the demo frames' clock — and where the axis
 * ticks fall. Data stays UTC epoch ms either way.
 * thumbTimes: 'panel' (default) or 'source'. With 'source', a source that
 * declares a zone (decl.timezone) shows ITS times — magnifier and preview
 * captions, last-seen/expected text, image alt text, grid timestamps — in
 * that zone, each marked with its offset from the panel's: 07:31:00 (+3h).
 * The axis, cursor label and annotation tooltips stay in the panel zone.
 * Either way a zoned source's header names its zone: "Sydney · +3h". */
export function mountTimeline(root, cfg) {
  injectStyles();
  const P = { site: parseVar(cfg.site), source: parseVar(cfg.source), from: cfg.from, to: cfg.to };
  const TZ = resolveTimeZone(cfg.timeZone);
  const SPAN = Math.max(1, P.to - P.from);
  const LIVE = P.to > Date.now() - 2 * 60 * 1000;
  const MIN_SLICE_PX = 7;
  const hostWidth = cfg.width || root.clientWidth || 800;   // plugin passes width; web mounts measure
  const pxBudget = Math.max(10, Math.floor((hostWidth - 20) / MIN_SLICE_PX));
  const backend = cfg.apiUrl || cfg.apiFetch ? makeApiBackend(cfg.apiUrl, cfg.apiKey, cfg.apiFetch) : makeBackend(P, SPAN, TZ);

  const wrap = makeWrapper(root);
  wrap.classList.toggle('fill', cfg.fit === 'fill');
  wrap.innerHTML =
    '<div class="cards"></div>' +
    '<div class="ann-lane" style="display:none"></div>' +
    '<div class="axis"><div class="base"></div><div class="acur"></div></div>';
  const q = sel => wrap.querySelector(sel);

  /* A user-pinned cursor (they hovered/scrubbed) survives remounts at the
   * same ABSOLUTE time, clamped into the new window; an untouched cursor
   * keeps following the live edge. Persisted on the root, which outlives
   * the wrapper swaps. */
  function restoreCursor() {
    const saved = Number(root.dataset.ktlCursor);
    if (root.dataset.ktlPinned === '1' && Number.isFinite(saved)) {
      return Math.max(P.from, Math.min(P.to, saved));
    }
    return Math.min(P.to, Date.now());
  }
  let kiosks = [], cards = {}, cursorT = restoreCursor(), destroyed = false, pollTimer = null;
  const axisTickList = [];   // filled by buildAxis; consumed by ruleBeyond
  let suppressClick = false;
  const pv = makePreview(root, TZ);
  const PANEL_TT = zoneTexts(TZ, TZ, false);

  /* selection band shown on every card during drag-zoom (fractions of window) */
  function showSelection(fa, fb) {
    const a = Math.min(fa, fb), b = Math.max(fa, fb);
    for (const k of kiosks) {
      const c = cards[k.id];
      if (!c) {continue;}
      const w = c.strip.clientWidth;
      c.sel.style.display = 'block';
      c.sel.style.left = (a * w) + 'px';
      c.sel.style.width = ((b - a) * w) + 'px';
    }
  }
  function hideSelection() {
    for (const k of kiosks) {if (cards[k.id]) {cards[k.id].sel.style.display = 'none';}}
  }


  /* Post-layout dressing, idempotent and re-runnable:
   * - align each empty slot's hatch to its strip offset so the diagonals run
   *   continuously across gap runs (per-element gradients restart at every
   *   slot edge; narrow runs otherwise read as one solid block)
   * - wide pause bands carry their label inline: a strip that is ALL
   *   "screen dark" should say so without requiring a hover
   * Needs real layout — called at build (visible mounts) and again after
   * reveal with retries (panels that mount before they have a size). */
  function dressStrip(model) {
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
  function dressAll(tries) {
    const anySized = kiosks.some((k) => cards[k.id] && cards[k.id].strip.clientWidth > 0);
    if (!anySized) {
      if (tries > 0 && !destroyed) {setTimeout(() => dressAll(tries - 1), 500);}
      return;
    }
    for (const k of kiosks) {if (cards[k.id]) {dressStrip(cards[k.id].model);}}
  }

  function buildCard(decl, model) {
    const kiosk = decl.id;
    const zone = zoneFor(decl, TZ, cfg.thumbTimes, PANEL_TT), tt = zone.tt;
    const card = document.createElement('div');
    const inline = cfg.headerMode === 'inline' || cfg.headerMode === 'inline-gradient';
    card.className = 'card' + (inline ? ' inline-head' : '') +
      (cfg.headerMode === 'inline-gradient' ? ' inline-grad' : '');
    const la = model.lastActive;
    const cad = cfg.showDetails && la
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
    const strip = card.querySelector('.strip');
    // hairline frame boundaries only when slices are wide enough — below
    // ~12px they read as zebra noise rather than structure
    if (hostWidth / model.slots.length >= 12) {strip.classList.add('sep');}
    const slots = model.slots;
    for (const sl of slots) {
      const el = document.createElement('div');
      el.className = 'slot' + slotClass(sl);
      if (sl.paused) {el.title = pauseInfo(sl).label.toLowerCase();}
      // width ∝ time span, so x↔time stays linear across era boundaries
      el.style.flexGrow = String(sl.span / 1000);
      if (sl.frame) {
        const img = document.createElement('img');
        img.src = sl.frame.url; img.alt = kiosk + ' ' + tt.time(sl.ts) + tt.sfx(sl.ts);
        el.appendChild(img);
      }
      strip.appendChild(el);
      sl.el = el;
    }
    for (const sl of slots) {if (sl.future) {dressGhost(slots, sl);}}
    dressStrip(model);   // hatch alignment + band labels (re-run post-reveal)
    const hoverAt = e => {
      const r = strip.getBoundingClientRect();
      if (!r.width) {return;}   // stale wrapper mid-swap: no geometry, no cursor
      const t = P.from + SPAN * ((e.clientX - r.left) / r.width);
      setCursor(t, card, false);
    };
    strip.addEventListener('mousemove', hoverAt);
    strip.addEventListener('mouseenter', e => {
      wrap.classList.add('strip-hover');
      // a refresh swaps the DOM under a STATIONARY cursor: the browser fires
      // mouseenter on the new strip but no mousemove, so without this the
      // dim class lands with no card marked hovered — everything dims,
      // including the strip under the mouse
      hoverAt(e);
    });
    strip.addEventListener('mouseleave', () => {
      wrap.classList.remove('strip-hover');
      if (cfg.onHoverClear) {cfg.onHoverClear();}
    });
    strip.addEventListener('click', e => {
      if (suppressClick) { suppressClick = false; return; }
      const sl = model.slotAt(cursorT);
      const f = sl && sl.frame;
      const g = !f && sl && sl.future ? ghostFor(model.slots, sl) : null;
      if (f) {pv.open(decl.site, kiosk, f, e.clientX, e.clientY, hiUrlFor(f, decl, cfg.apiUrl, cfg.apiKey), null, tt);}
      else if (g) {pv.open(decl.site, kiosk, g, e.clientX, e.clientY, null, sl.ts, tt);}
    });
    /* magnifier takes the aspect of the actual frames (portrait screens etc.) */
    const magEl = card.querySelector('.mag');
    const magImg = magEl.querySelector('img');
    magImg.addEventListener('load', () => {
      if (magImg.naturalWidth && magImg.naturalHeight)
        {magEl.style.aspectRatio = String(magImg.naturalWidth / magImg.naturalHeight);}
    });
    /* drag-select = zoom, grafana-style: band across all cards, release → onZoom */
    strip.addEventListener('mousedown', e => {
      if (e.button !== 0) {return;}
      e.preventDefault();
      const r = strip.getBoundingClientRect();
      const fracOf = x => Math.max(0, Math.min(1, (x - r.left) / r.width));
      const f0 = fracOf(e.clientX);
      let dragged = false;
      const move = ev => {
        if (destroyed) {return up(ev);}
        const f1 = fracOf(ev.clientX);
        if (Math.abs(f1 - f0) * r.width > 5) {dragged = true;}
        if (dragged) {
          showSelection(f0, f1);
          setCursor(P.from + SPAN * f1, card, false);
        }
      };
      const up = ev => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        hideSelection();
        if (dragged && !destroyed) {
          suppressClick = true;
          const f1 = fracOf(ev.clientX);
          const a = Math.min(f0, f1), b = Math.max(f0, f1);
          if (b > a && cfg.onZoom) {cfg.onZoom(Math.round(P.from + SPAN * a), Math.round(P.from + SPAN * b));}
        }
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
    q('.cards').appendChild(card);
    attachZoneChip(zone, card);
    return {
      card, model, zone, tt,
      head: card.querySelector('.ft'),
      strip,
      cross: card.querySelector('.xh'),
      sel: card.querySelector('.sel'),
      mag: card.querySelector('.mag'),
      lane: card.querySelector('.card-lane'),
    };
  }

  function buildAxis() {
    const axis = q('.axis');
    const w = axis.clientWidth;

    // pass 1: rough step from a flat guess, just to pick a representative
    // label to measure (mirrors Grafana's calculateSpace bootstrap)
    const roughMaxTicks = Math.max(3, Math.floor(w / 90));
    const roughStep = TICK_STEPS.find(s => SPAN / s <= roughMaxTicks) || TICK_STEPS[TICK_STEPS.length - 1];
    const sampleWidth = measureTickWidth(tickFormat(roughStep, TZ)(P.to));

    // pass 2: real step, sized to the label width that will actually render
    const maxTicks = Math.max(3, Math.floor(w / (sampleWidth + TICK_LABEL_GAP)));
    const tickStep = TICK_STEPS.find(s => SPAN / s <= maxTicks) || TICK_STEPS[TICK_STEPS.length - 1];
    const fmt = tickFormat(tickStep, TZ);

    axis.querySelectorAll('.tick').forEach(t => t.remove());
    axisTickList.length = 0;
    for (const ts of axisTicks(P.from, P.to, tickStep, TZ)) {
      axisTickList.push(ts);
      const el = document.createElement('div');
      el.className = 'tick';
      el.style.left = ((ts - P.from) / SPAN * w) + 'px';
      el.textContent = fmt(ts);
      axis.appendChild(el);
    }
  }

  /* The beyond-now spacer looks EMPTY, not black — the card's own surface,
   * ruled only by hairlines continuing the axis ticks (black is a signal in
   * a screenshot timeline; the future is the absence of signal). Re-run
   * whenever the spacer's geometry changes (poll carving/band growth). */
  function ruleBeyond(sl) {
    if (!sl || !sl.beyond || !sl.el) {return;}
    sl.el.querySelectorAll('.bt').forEach(t => t.remove());
    for (const ts of axisTickList) {
      if (ts <= sl.ts || ts > sl.ts + sl.span) {continue;}
      const t = document.createElement('div');
      t.className = 'bt';
      t.style.left = (((ts - sl.ts) / sl.span) * 100).toFixed(3) + '%';
      sl.el.appendChild(t);
    }
  }
  function ruleAllBeyond() {
    for (const k of kiosks) {
      const c = cards[k.id];
      if (!c) {continue;}
      const last = c.model.slots[c.model.slots.length - 1];
      if (last && last.beyond) {ruleBeyond(last);}
    }
  }

  /* Annotations: per-source markers ride that source's strip; the rest
   * share one lane above the axis. Regions shade their span; markers
   * cluster when closer than ~10px. Positions are %-based so they survive
   * flexbox resizes without a re-render. */
  function renderAnnotations(anns) {
    const tip = annTip();
    const fracOf = (t) => (Math.max(P.from, Math.min(P.to, t)) - P.from) / SPAN;
    const pct = (f) => (f * 100).toFixed(3) + '%';

    function addRegion(host, a) {
      const el = document.createElement('div');
      el.className = 'ann-region';
      el.style.left = pct(fracOf(a.ts));
      el.style.width = pct(fracOf(a.timeEnd) - fracOf(a.ts));
      if (a.color) { el.style.background = a.color + '22'; el.style.borderColor = a.color + '88'; }
      host.appendChild(el);
    }
    function addMarkers(host, items) {
      // cluster markers closer than ~10px so dense event bursts stay legible
      const groups = [];
      for (const a of items) {
        const g = groups[groups.length - 1];
        if (g && (fracOf(a.ts) - fracOf(g[0].ts)) * hostWidth < 10) {g.push(a);}
        else {groups.push([a]);}
      }
      for (const g of groups) {
        const el = document.createElement('div');
        el.className = 'ann' + (g.length > 1 ? ' multi' : '');
        el.style.left = pct(fracOf(g[0].ts));
        if (g[0].color) {el.style.background = g[0].color;}
        el.title = '';   // suppress native tooltip; ours carries the detail
        if (g.length > 1) {
          const n = document.createElement('span');
          n.className = 'n';
          n.textContent = String(g.length);
          el.appendChild(n);
        }
        el.addEventListener('mouseenter', () => {
          const r = el.getBoundingClientRect();
          tip.show(g, r.left + r.width / 2, r.top, el, TZ);
        });
        el.addEventListener('mouseleave', () => tip.hide());
        el.addEventListener('click', (e) => {
          // pin: selectable text + clickable links; don't open the frame
          // preview underneath, and don't let the document unpin us
          e.stopPropagation();
          const r = el.getBoundingClientRect();
          tip.pin(g, r.left + r.width / 2, r.top, el, TZ);
        });
        host.appendChild(el);
      }
    }

    // scoping: source:<id> pins to one card, site:<id> to every card at
    // that site, neither = global. A scoped annotation whose target isn't
    // on this panel is DROPPED, not shown global — its context is absent.
    const appliesTo = (a, k) =>
      (!a.source || a.source === k.id) && (!a.siteScope || a.siteScope === k.site);
    const isGlobal = (a) => !a.source && !a.siteScope;

    if (cfg.annotationLanes === 'per-source') {
      // one lane per card: its own scoped events plus every global, so each
      // timeline reads in context — stacked windows never share one bar
      for (const k of kiosks) {
        const c = cards[k.id];
        const items = anns.filter((a) => appliesTo(a, k));
        if (!items.length) {continue;}
        c.card.classList.add('has-lane');
        for (const a of items) {if (a.timeEnd) { addRegion(c.strip, a); addRegion(c.lane, a); }}
        addMarkers(c.lane, items);
      }
      return;
    }

    const laneItems = [], perCard = {};
    for (const a of anns) {
      if (isGlobal(a)) {laneItems.push(a);}
      else {for (const k of kiosks) {if (appliesTo(a, k)) {(perCard[k.id] ||= []).push(a);}}}
      if (a.timeEnd) {
        // regions shade the strips they scope to; globals also shade the lane
        const hosts = isGlobal(a)
          ? kiosks.map((k) => cards[k.id].strip).concat([q('.ann-lane')])
          : kiosks.filter((k) => appliesTo(a, k)).map((k) => cards[k.id].strip);
        for (const h of hosts) {addRegion(h, a);}
      }
    }
    for (const [id, items] of Object.entries(perCard)) {addMarkers(cards[id].strip, items);}
    if (laneItems.length) {addMarkers(q('.ann-lane'), laneItems);}
    if (laneItems.length || anns.some((a) => a.timeEnd && isGlobal(a))) {q('.ann-lane').style.display = '';}
  }

  /* external=true → came from the event bus; don't re-publish (no loop) */
  function setCursor(t, hoveredCard, external) {
    cursorT = Math.max(P.from, Math.min(P.to, t));
    root.dataset.ktlCursor = String(cursorT);
    if (!external) {root.dataset.ktlPinned = '1';}
    if (cfg.onCursor) {cfg.onCursor(cursorT);}        // host chrome hook (standalone app)
    const frac = (cursorT - P.from) / SPAN;

    const axis = q('.axis'), ac = q('.acur');
    const acW = ac.offsetWidth || 50;
    ac.textContent = fmtTime(cursorT, TZ);
    ac.style.left = Math.max(acW / 2, Math.min(axis.clientWidth - acW / 2, frac * axis.clientWidth)) + 'px';

    for (const k of kiosks) {
      const c = cards[k.id];
      if (!c) {continue;}
      // external cursor moves (event bus) must not strip local hover state —
      // other panels re-emit hover events and would un-dim us mid-hover
      if (!external) {c.card.classList.toggle('hovered', hoveredCard === c.card);}
      const w = c.strip.clientWidth, x = frac * w;
      c.cross.style.left = x + 'px';
      const slot = c.model.slotAt(cursorT);
      const tt = c.tt;
      // the zone chip's offset at the cursor: changes only across a DST edge
      if (c.zone.el) {dressZoneChip(c.zone, cursorT);}
      const magW = c.mag.offsetWidth || c.strip.clientHeight * 16 / 9;
      c.mag.style.left = Math.max(0, Math.min(w - magW, x - magW / 2)) + 'px';
      c.mag.classList.remove('ghost');
      if (slot && slot.frame) {
        c.mag.classList.remove('gap', 'future', 'off'); clearPauseClasses(c.mag);
        c.mag.querySelector('img').src = slot.frame.url;
        c.mag.querySelector('.cap').textContent = tt.time(slot.frame.ts) + tt.sfx(slot.frame.ts);
        c.head.textContent = '';                 // healthy: time lives on the magnifier
        c.head.classList.remove('stale'); clearPauseClasses(c.head);
      } else if (slot && slot.paused) {
        // declared silence — neutral (or amber when unintended), not offline-red
        const pi = pauseInfo(slot);
        c.mag.classList.remove('gap', 'future', 'off'); clearPauseClasses(c.mag);
        c.mag.classList.add(...pi.classes);
        c.mag.querySelector('.cap').textContent = pi.label.toLowerCase();
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
        if (g) { c.mag.classList.add('ghost'); c.mag.querySelector('img').src = g.url; }
        c.mag.querySelector('.cap').textContent = (inFlight ? 'expected — ' : 'upcoming — ') + tt.short(slot.ts) +
          (g ? ' · last frame ' + tt.time(g.ts) : '') + tt.sfx(slot.ts);
        c.head.textContent = inFlight ? 'expected' : 'upcoming';
        c.head.classList.remove('stale'); clearPauseClasses(c.head);
      } else {
        c.mag.classList.add('gap');
        c.mag.classList.remove('future', 'off'); clearPauseClasses(c.mag);
        const i = slot ? c.model.slots.indexOf(slot) : c.model.slots.length - 1;
        let last = null;
        for (let j = i; j >= 0; j--) {if (c.model.slots[j].frame) { last = c.model.slots[j].frame; break; }}
        const msg = last ? 'offline — last seen ' + tt.time(last.ts) + tt.sfx(last.ts) : 'no data in window';
        c.mag.querySelector('.cap').textContent = msg;
        c.head.textContent = msg;
        c.head.classList.add('stale');
        clearPauseClasses(c.head);
      }
    }
    if (!external && cfg.onHover) {cfg.onHover(cursorT);}
  }

  (async function boot() {
    try {
      kiosks = (await backend.kiosks(P.site))
        .filter((k) => !P.source || P.source.includes(k.id))
        .filter((k) => matchesTags(k.tags, parseTagFilter(cfg.tagFilter)));
    } catch (e) {
      // registry unreachable (or hung past the fetch timeout): SAY so —
      // an eternally blank panel points the blame at the wrong layer
      console.warn('[visual-timeline] sources fetch failed:', e);
      if (destroyed) {return;}
      const err = document.createElement('div');
      err.className = 'boot-err';
      err.textContent = 'frames API unreachable — ' + (e && e.message ? e.message : e);
      q('.cards').appendChild(err);
      await revealWrapper(root, wrap);
      return;
    }
    for (const k of kiosks) {
      if (destroyed) {return;}
      let model;
      try {
        model = await buildSourceModel(k, P, backend, pxBudget);
      } catch (e) {
        // one source's backend hiccup must not black out the whole panel;
        // the next refresh retries it
        console.warn('[visual-timeline] model build failed for ' + k.id + ':', e);
        continue;
      }
      if (destroyed) {return;}
      // declared pause IS data — a source that is all SCREEN DARK for the
      // window must render its band, not vanish as if it never reported
      if (cfg.hideEmpty && !model.slots.some((sl) => sl.frame || sl.paused)) {continue;}
      cards[k.id] = buildCard(k, model);
    }
    kiosks = kiosks.filter((k) => cards[k.id]);
    buildAxis();
    ruleAllBeyond();
    // host-provided annotations (Grafana: the dashboard's own annotation
    // queries, whatever data source they run on) win; the mock seam only
    // fills demo mode so the feature is visible without a backend
    const rawAnns = (cfg.annotations && cfg.annotations.length)
      ? cfg.annotations
      : (backend.annotations ? backend.annotations() : []);
    if (cfg.showAnnotations !== false) {renderAnnotations(normAnnotations(rawAnns, P));}
    setCursor(cursorT, null, true);   // rest position; don't publish
    await revealWrapper(root, wrap);  // swap in only once images decoded
    dressAll(20);                     // hatch alignment + labels once layout is real

    if (LIVE) {
      const steps = kiosks.map(k => cards[k.id].model.lastActive && cards[k.id].model.lastActive.step).filter(Boolean);
      const minStep = steps.length ? Math.min.apply(null, steps) : 60e3;
      pollTimer = setInterval(async () => {
        for (const k of kiosks) {
          const c = cards[k.id];
          // advance the live edge: newly-elapsed ticks are carved out of the
          // beyond filler (active tail), or a tail pause band GROWS into it —
          // the strip keeps sliding between dashboard refreshes without ever
          // shading time that hasn't happened
          const mSlots = c.model.slots;
          const filler = mSlots.length && mSlots[mSlots.length - 1].beyond ? mSlots[mSlots.length - 1] : null;
          if (filler) {
            const nowP = Date.now();
            const prev = mSlots.length > 1 ? mSlots[mSlots.length - 2] : null;
            if (prev && prev.paused) {
              const grow = Math.min(nowP, filler.ts + filler.span) - filler.ts;
              if (grow > 0) {
                prev.span += grow;
                filler.ts += grow; filler.span -= grow;
                if (prev.el) {prev.el.style.flexGrow = String(prev.span / 1000);}
                if (filler.span <= 0) { if (filler.el) {filler.el.remove();} mSlots.pop(); }
                else { if (filler.el) {filler.el.style.flexGrow = String(filler.span / 1000);} ruleBeyond(filler); }
              }
            } else if (prev && prev.step) {
              let nextTs = prev.ts + prev.step;
              while (mSlots[mSlots.length - 1] && mSlots[mSlots.length - 1].beyond && nextTs <= nowP) {
                const f = mSlots[mSlots.length - 1];
                const sl = { ts: nextTs, span: prev.step, frame: null, cadence: prev.cadence, step: prev.step, future: true };
                const el = document.createElement('div');
                el.className = 'slot future';
                el.style.flexGrow = String(sl.span / 1000);
                if (f.el && f.el.parentNode) {f.el.parentNode.insertBefore(el, f.el);}
                sl.el = el;
                mSlots.splice(mSlots.length - 1, 0, sl);
                f.span -= sl.span; f.ts += sl.span;
                if (f.span <= 0) { if (f.el) {f.el.remove();} mSlots.pop(); }
                else { if (f.el) {f.el.style.flexGrow = String(f.span / 1000);} ruleBeyond(f); }
                nextTs += prev.step;
              }
            }
          }
          const la = c.model.lastActive;
          if (!la) {continue;}                    // tail era is a declared pause
          let lastTs = P.from;
          for (let i = c.model.slots.length - 1; i >= 0; i--) {
            if (c.model.slots[i].frame) { lastTs = c.model.slots[i].ts; break; }
          }
          const fresh = await backend.frames(k.site, k.id, lastTs + 1, Date.now(), la.step);
          if (destroyed) {return;}
          for (const f of fresh) {
            const slot = c.model.slotAt(f.ts);
            if (!slot || slot.paused || slot.beyond) {continue;}
            // newer frames REPLACE the bucket representative (frames past
            // the window end clamp into the last bucket) so the right edge
            // keeps sliding between dashboard refreshes — grid parity
            if (slot.frame && f.ts <= slot.frame.ts) {continue;}
            slot.frame = f;
            slot.future = false;
            slot.el.classList.remove('gap', 'future');
            // the real frame replaces the ghost in place: a snap, no fade
            let img = slot.el.querySelector('img');
            if (!img) { img = document.createElement('img'); slot.el.appendChild(img); }
            img.classList.remove('ghost');
            img.src = f.url; img.alt = k.id + ' ' + c.tt.time(f.ts) + c.tt.sfx(f.ts);
          }
          // future slots age into the present; one still empty a full step
          // past its tick has now genuinely missed its heartbeat
          const overdue = Date.now();
          for (const sl of c.model.slots) {
            if (missedHeartbeat(sl, overdue)) {
              sl.future = false;
              if (sl.el) { sl.el.classList.remove('future'); sl.el.classList.add('gap'); }
            }
          }
          // one pass covers every path above: newly carved pending slots
          // pick up a ghost, a missed heartbeat drops it
          for (const sl of c.model.slots) {dressGhost(c.model.slots, sl);}
        }
      }, Math.min(minStep, 10000));
    }
  })();

  return {
    setExternalCursor(t) { if (!destroyed) {setCursor(t, null, true);} },
    isHovering() { return wrap.classList.contains('strip-hover'); },
    destroy() {
      destroyed = true;
      if (pollTimer) {clearInterval(pollTimer);}
      pv.retire();   // an open preview survives refresh remounts (adopted by the successor)
      annTip().close();   // a hovered or pinned tip at teardown would strand
      retireWrapper(wrap);
    },
  };
}

/* ======================= multiview grid mode =======================
 * One tile per kiosk, no timeline. Shows the most recent frame in the
 * window; with follow-crosshair on, shows the frame at the shared
 * crosshair time while another panel is hovered, reverting on clear. */
export function mountGrid(root, cfg) {
  injectStyles();
  const P = { site: parseVar(cfg.site), source: parseVar(cfg.source), from: cfg.from, to: cfg.to };
  const TZ = resolveTimeZone(cfg.timeZone);   // as mountTimeline
  const SPAN = Math.max(1, P.to - P.from);
  const LIVE = P.to > Date.now() - 2 * 60 * 1000;
  const backend = cfg.apiUrl || cfg.apiFetch ? makeApiBackend(cfg.apiUrl, cfg.apiKey, cfg.apiFetch) : makeBackend(P, SPAN, TZ);
  const budget = 120;   // temporal buckets for crosshair-follow resolution

  const wrap = makeWrapper(root);
  wrap.classList.toggle('fill', cfg.fit === 'fill');
  wrap.innerHTML = '<div class="grid"></div>';
  const q = sel => wrap.querySelector(sel);

  let kiosks = [], tiles = {}, destroyed = false, pollTimer = null, shownT = null;
  const pv = makePreview(root, TZ);
  const PANEL_TT = zoneTexts(TZ, TZ, false);

  function buildTile(decl, model) {
    const el = document.createElement('div');
    const zone = zoneFor(decl, TZ, cfg.thumbTimes, PANEL_TT);
    const inline = cfg.headerMode === 'inline' || cfg.headerMode === 'inline-gradient';
    el.className = 'tile' + (inline ? ' inline-head' : '') +
      (cfg.headerMode === 'inline-gradient' ? ' inline-grad' : '');
    el.innerHTML =
      '<div class="t-head" title="' + esc(headTitle(decl)) + '"><span class="nm">' + esc(decl.id) + '</span>' +
      '<span class="inline-brk"></span>' + zoneChip(zone.srcTZ) +
      '<span class="st">' + esc(decl.site) + (decl.location ? ' · ' + esc(decl.location) : '') + '</span>' +
      tagChips(decl) + '</div>' +
      '<div class="t-img"><img alt="' + esc(decl.id) + '"><span class="t-ts"></span><div class="t-off"></div></div>';
    attachZoneChip(zone, el);
    const rec = {
      decl, model, el, shown: null, zone, tt: zone.tt,
      img: el.querySelector('img'),
      ts: el.querySelector('.t-ts'),
      off: el.querySelector('.t-off'),
    };
    el.addEventListener('click', e => {
      if (rec.shown && rec.shownExpected) {pv.open(decl.site, decl.id, rec.shown, e.clientX, e.clientY, null, rec.shownExpected, rec.tt);}
      else if (rec.shown) {pv.open(decl.site, decl.id, rec.shown, e.clientX, e.clientY, hiUrlFor(rec.shown, decl, cfg.apiUrl, cfg.apiKey), null, rec.tt);}
    });
    q('.grid').appendChild(el);
    return rec;
  }

  function lastFrame(rec) {
    for (let i = rec.model.slots.length - 1; i >= 0; i--) {
      if (rec.model.slots[i].frame) {return rec.model.slots[i].frame;}
    }
    return null;
  }

  /* t = null → most recent in window; otherwise frame at crosshair time */
  function setShown(t) {
    shownT = t;
    if (cfg.onShown) {cfg.onShown(t);}                // host chrome hook (standalone app)
    // zone chips: offset at the crosshair, else at the window's live edge
    const zoneAt = t == null ? Math.min(P.to, Date.now()) : t;
    for (const k of kiosks) {
      const rec = tiles[k.id];
      if (!rec) {continue;}
      if (rec.zone.el) {dressZoneChip(rec.zone, zoneAt);}
      const tt = rec.tt;
      let frame = null, offMsg = null, pausedMsg = null, pausedSlot = null, expectedTs = null;
      const la = rec.model.lastActive;
      if (t == null) {
        const tail = rec.model.slots.length ? rec.model.slots[rec.model.slots.length - 1] : null;
        const tailPaused = tail && tail.paused;
        frame = lastFrame(rec);
        if (tailPaused) {
          pausedSlot = tail;
          pausedMsg = pauseInfo(tail).label + (frame ? ' — last frame ' + tt.time(frame.ts) + tt.sfx(frame.ts) : '');
        }
        else if (!frame) {offMsg = 'no data in window';}
        else if (LIVE && la && Date.now() - frame.ts > 2 * la.step)
          {offMsg = 'OFFLINE — last seen ' + tt.time(frame.ts) + tt.sfx(frame.ts);}
      } else {
        const slot = rec.model.slotAt(t);
        if (slot && slot.paused) {
          pausedSlot = slot;
          pausedMsg = pauseInfo(slot).label;
        } else {
          frame = slot && slot.frame;
          if (!frame) {
            if (slot && slot.beyond) {
              offMsg = '—';   // ahead of now: unknown, not a failure
            } else if (slot && slot.future) {
              // just-passed tick, frame in flight: show the last frame as a
              // ghost when there is one (never the red offline tile)
              frame = ghostFor(rec.model.slots, slot);
              if (frame) {expectedTs = slot.ts;}
              else {offMsg = 'EXPECTED — ' + tt.short(slot.ts) + tt.sfx(slot.ts);}
            } else {
              const i = slot ? rec.model.slots.indexOf(slot) : rec.model.slots.length - 1;
              let last = null;
              for (let j = i; j >= 0; j--) {if (rec.model.slots[j].frame) { last = rec.model.slots[j].frame; break; }}
              offMsg = last ? 'OFFLINE — last seen ' + tt.time(last.ts) + tt.sfx(last.ts) : 'no data';
            }
          }
        }
      }
      rec.el.classList.toggle('offline', !!offMsg);
      clearPauseClasses(rec.el);
      if (pausedMsg && !offMsg) {rec.el.classList.add(...pauseInfo(pausedSlot).classes);}
      rec.off.textContent = offMsg || pausedMsg || '';
      rec.el.classList.toggle('ghost', !!expectedTs);
      rec.shown = frame;
      rec.shownExpected = expectedTs;
      if (frame && !offMsg && !pausedMsg) {
        rec.img.src = frame.url;
        rec.ts.textContent = (expectedTs
          ? 'expected ' + tt.short(expectedTs) + ' · last ' + tt.time(frame.ts)
          : tt.time(frame.ts)) + tt.sfx(frame.ts);
      }
    }
  }

  (async function boot() {
    try {
      kiosks = (await backend.kiosks(P.site))
        .filter((k) => !P.source || P.source.includes(k.id))
        .filter((k) => matchesTags(k.tags, parseTagFilter(cfg.tagFilter)));
    } catch (e) {
      console.warn('[visual-timeline] sources fetch failed:', e);
      if (destroyed) {return;}
      const err = document.createElement('div');
      err.className = 'boot-err';
      err.textContent = 'frames API unreachable — ' + (e && e.message ? e.message : e);
      q('.grid').appendChild(err);
      await revealWrapper(root, wrap);
      return;
    }
    for (const k of kiosks) {
      if (destroyed) {return;}
      let model;
      try {
        model = await buildSourceModel(k, P, backend, budget);
      } catch (e) {
        console.warn('[visual-timeline] model build failed for ' + k.id + ':', e);
        continue;
      }
      if (destroyed) {return;}
      // declared pause IS data — a source that is all SCREEN DARK for the
      // window must render its band, not vanish as if it never reported
      if (cfg.hideEmpty && !model.slots.some((sl) => sl.frame || sl.paused)) {continue;}
      tiles[k.id] = buildTile(k, model);
    }
    kiosks = kiosks.filter((k) => tiles[k.id]);
    setShown(null);
    await revealWrapper(root, wrap);

    if (LIVE) {
      pollTimer = setInterval(async () => {
        for (const k of kiosks) {
          const rec = tiles[k.id];
          const la = rec.model.lastActive;
          if (!la) {continue;}                   // tail era is a declared pause
          const last = lastFrame(rec);
          const fresh = await backend.frames(k.site, k.id, (last ? last.ts : P.from) + 1, Date.now(), la.step);
          if (destroyed) {return;}
          for (const f of fresh) {
            const slot = rec.model.slotAt(f.ts);
            if (!slot || slot.paused || slot.beyond) {continue;}
            // newer frames replace the bucket representative so "latest" slides
            if (!slot.frame || f.ts > slot.frame.ts) {slot.frame = f;}
          }
        }
        if (shownT == null) {setShown(null);}   // keep "latest" tiles fresh
      }, 10000);
    }
  })();

  return {
    setExternalCursor(t) { if (!destroyed) {setShown(Math.max(P.from, Math.min(P.to, t)));} },
    clearExternal() { if (!destroyed) {setShown(null);} },
    destroy() {
      destroyed = true;
      if (pollTimer) {clearInterval(pollTimer);}
      pv.retire();   // an open preview survives refresh remounts (adopted by the successor)
      retireWrapper(wrap);
    },
  };
}

