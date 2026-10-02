// @ts-nocheck
import { resolveTimeZone } from '../time/zones';
import { clearPauseClasses, pauseInfo } from '../model/eras';
import { buildSourceModel, ghostFor } from '../model/slots';
import { matchesTags, parseTagFilter, parseVar } from '../model/filters';
import { zoneFor, zoneTexts } from '../zones/source';
import { hiUrlFor, makeApiBackend } from '../backends/api';
import { esc, headTitle, tagChips } from '../dom/html';
import { injectStyles } from '../dom/styles';
import { makeBackend } from '../backends/demo';
import { attachZoneChip, dressZoneChip, zoneChip } from '../zones/chip';
import { makePreview } from '../ui/preview';
import { makeWrapper, retireWrapper, revealWrapper } from '../ui/wrapper';

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
