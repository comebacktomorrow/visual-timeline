// @ts-nocheck
import { resolveTimeZone } from '../time/zones';
import { buildSourceModel, missedHeartbeat } from '../model/slots';
import { matchesTags, parseTagFilter, parseVar } from '../model/filters';
import { zoneTexts } from '../zones/source';
import { makeApiBackend } from '../backends/api';
import { injectStyles } from '../dom/styles';
import { makeBackend } from '../backends/demo';
import { annTip, normAnnotations } from '../ui/annotations';
import { makePreview } from '../ui/preview';
import { dressGhost } from '../ui/ghost';
import { makeWrapper, retireWrapper, revealWrapper } from '../ui/wrapper';
import type { TimelineState } from './state';
import { restoreCursor, setCursor } from './cursor';
import { buildAxis, ruleAllBeyond, ruleBeyond } from './axis';
import { buildCard, dressAll } from './card';
import { renderAnnotations } from './annotations';

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
      cards[k.id] = buildCard(s, k, model);
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
    if (cfg.showAnnotations !== false) {renderAnnotations(s, normAnnotations(rawAnns, P));}
    setCursor(s, s.cursorT, null, true);   // rest position; don't publish
    await revealWrapper(root, wrap);  // swap in only once images decoded
    dressAll(s, 20);                     // hatch alignment + labels once layout is real

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
