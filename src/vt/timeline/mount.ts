// @ts-nocheck
import { fmtDur, resolveTimeZone } from '../time/zones';
import { pauseInfo } from '../model/eras';
import { buildSourceModel, ghostFor, missedHeartbeat, slotClass } from '../model/slots';
import { matchesTags, parseTagFilter, parseVar } from '../model/filters';
import { zoneFor, zoneTexts } from '../zones/source';
import { hiUrlFor, makeApiBackend } from '../backends/api';
import { esc, headTitle, tagChips } from '../dom/html';
import { injectStyles } from '../dom/styles';
import { makeBackend } from '../backends/demo';
import { attachZoneChip, zoneChip } from '../zones/chip';
import { annTip, normAnnotations } from '../ui/annotations';
import { makePreview } from '../ui/preview';
import { dressGhost } from '../ui/ghost';
import { makeWrapper, retireWrapper, revealWrapper } from '../ui/wrapper';
import type { TimelineState } from './state';
import { hideSelection, restoreCursor, setCursor, showSelection } from './cursor';
import { buildAxis, ruleAllBeyond, ruleBeyond } from './axis';

/* ======================= timeline core ======================= */

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

  // the mount's shared state (the fields that change live only here)
  const s: TimelineState = {
    root, cfg, P, TZ, SPAN, LIVE, hostWidth, pxBudget, backend, wrap,
    kiosks: [], cards: {}, cursorT: restoreCursor(root, P), destroyed: false, pollTimer: null,
    axisTickList: [],   // filled by buildAxis; consumed by ruleBeyond
    suppressClick: false,
    pv: makePreview(root, TZ),
    PANEL_TT: zoneTexts(TZ, TZ, false),
  };
  const { cards, pv, PANEL_TT } = s;



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
    const anySized = s.kiosks.some((k) => cards[k.id] && cards[k.id].strip.clientWidth > 0);
    if (!anySized) {
      if (tries > 0 && !s.destroyed) {setTimeout(() => dressAll(tries - 1), 500);}
      return;
    }
    for (const k of s.kiosks) {if (cards[k.id]) {dressStrip(cards[k.id].model);}}
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
      setCursor(s, t, card, false);
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
      if (s.suppressClick) { s.suppressClick = false; return; }
      const sl = model.slotAt(s.cursorT);
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
        if (s.destroyed) {return up(ev);}
        const f1 = fracOf(ev.clientX);
        if (Math.abs(f1 - f0) * r.width > 5) {dragged = true;}
        if (dragged) {
          showSelection(s, f0, f1);
          setCursor(s, P.from + SPAN * f1, card, false);
        }
      };
      const up = ev => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        hideSelection(s);
        if (dragged && !s.destroyed) {
          s.suppressClick = true;
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
      for (const k of s.kiosks) {
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
      else {for (const k of s.kiosks) {if (appliesTo(a, k)) {(perCard[k.id] ||= []).push(a);}}}
      if (a.timeEnd) {
        // regions shade the strips they scope to; globals also shade the lane
        const hosts = isGlobal(a)
          ? s.kiosks.map((k) => cards[k.id].strip).concat([q('.ann-lane')])
          : s.kiosks.filter((k) => appliesTo(a, k)).map((k) => cards[k.id].strip);
        for (const h of hosts) {addRegion(h, a);}
      }
    }
    for (const [id, items] of Object.entries(perCard)) {addMarkers(cards[id].strip, items);}
    if (laneItems.length) {addMarkers(q('.ann-lane'), laneItems);}
    if (laneItems.length || anns.some((a) => a.timeEnd && isGlobal(a))) {q('.ann-lane').style.display = '';}
  }


  (async function boot() {
    try {
      s.kiosks = (await backend.kiosks(P.site))
        .filter((k) => !P.source || P.source.includes(k.id))
        .filter((k) => matchesTags(k.tags, parseTagFilter(cfg.tagFilter)));
    } catch (e) {
      // registry unreachable (or hung past the fetch timeout): SAY so —
      // an eternally blank panel points the blame at the wrong layer
      console.warn('[visual-timeline] sources fetch failed:', e);
      if (s.destroyed) {return;}
      const err = document.createElement('div');
      err.className = 'boot-err';
      err.textContent = 'frames API unreachable — ' + (e && e.message ? e.message : e);
      q('.cards').appendChild(err);
      await revealWrapper(root, wrap);
      return;
    }
    for (const k of s.kiosks) {
      if (s.destroyed) {return;}
      let model;
      try {
        model = await buildSourceModel(k, P, backend, pxBudget);
      } catch (e) {
        // one source's backend hiccup must not black out the whole panel;
        // the next refresh retries it
        console.warn('[visual-timeline] model build failed for ' + k.id + ':', e);
        continue;
      }
      if (s.destroyed) {return;}
      // declared pause IS data — a source that is all SCREEN DARK for the
      // window must render its band, not vanish as if it never reported
      if (cfg.hideEmpty && !model.slots.some((sl) => sl.frame || sl.paused)) {continue;}
      cards[k.id] = buildCard(k, model);
    }
    s.kiosks = s.kiosks.filter((k) => cards[k.id]);
    buildAxis(s);
    ruleAllBeyond(s);
    // host-provided annotations (Grafana: the dashboard's own annotation
    // queries, whatever data source they run on) win; the mock seam only
    // fills demo mode so the feature is visible without a backend
    const rawAnns = (cfg.annotations && cfg.annotations.length)
      ? cfg.annotations
      : (backend.annotations ? backend.annotations() : []);
    if (cfg.showAnnotations !== false) {renderAnnotations(normAnnotations(rawAnns, P));}
    setCursor(s, s.cursorT, null, true);   // rest position; don't publish
    await revealWrapper(root, wrap);  // swap in only once images decoded
    dressAll(20);                     // hatch alignment + labels once layout is real

    if (LIVE) {
      const steps = s.kiosks.map(k => cards[k.id].model.lastActive && cards[k.id].model.lastActive.step).filter(Boolean);
      const minStep = steps.length ? Math.min.apply(null, steps) : 60e3;
      s.pollTimer = setInterval(async () => {
        for (const k of s.kiosks) {
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
                else { if (filler.el) {filler.el.style.flexGrow = String(filler.span / 1000);} ruleBeyond(s, filler); }
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
                else { if (f.el) {f.el.style.flexGrow = String(f.span / 1000);} ruleBeyond(s, f); }
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
          if (s.destroyed) {return;}
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
    setExternalCursor(t) { if (!s.destroyed) {setCursor(s, t, null, true);} },
    isHovering() { return wrap.classList.contains('strip-hover'); },
    destroy() {
      s.destroyed = true;
      if (s.pollTimer) {clearInterval(s.pollTimer);}
      pv.retire();   // an open preview survives refresh remounts (adopted by the successor)
      annTip().close();   // a hovered or pinned tip at teardown would strand
      retireWrapper(wrap);
    },
  };
}
