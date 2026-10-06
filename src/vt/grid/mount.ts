import { resolveTimeZone } from '../time/zones';
import { buildSourceModel } from '../model/slots';
import { matchesTags, parseTagFilter, parseVar } from '../model/filters';
import { zoneTexts } from '../zones/source';
import { bootErrorText, makeApiBackend } from '../backends/api';
import { injectStyles } from '../dom/styles';
import { makeBackend } from '../backends/demo';
import { makePreview } from '../ui/preview';
import { makeWrapper, q, retireWrapper, revealWrapper } from '../ui/wrapper';
import type { Backend, MountConfig, MountInstance, MountWindow, SourceModel } from '../types';
import type { GridState } from './state';
import { buildTile, setShown } from './tile';
import { startPoll } from './poll';

/* ======================= multiview grid mode =======================
 * One tile per kiosk, no timeline. Shows the most recent frame in the
 * window; with follow-crosshair on, shows the frame at the shared
 * crosshair time while another panel is hovered, reverting on clear.
 * cfg: MountConfig (src/vt/types.ts); the host callback is onShown(t). */
export function mountGrid(root: HTMLElement, cfg: MountConfig): MountInstance & { clearExternal(): void } {
  injectStyles();
  const P: MountWindow = { site: parseVar(cfg.site), source: parseVar(cfg.source), from: cfg.from, to: cfg.to };
  const TZ = resolveTimeZone(cfg.timeZone);   // as mountTimeline
  const SPAN = Math.max(1, P.to - P.from);
  const LIVE = P.to > Date.now() - 2 * 60 * 1000;
  const backend: Backend = cfg.apiUrl || cfg.apiFetch ? makeApiBackend(cfg.apiUrl, cfg.apiKey, cfg.apiFetch) : makeBackend(P, SPAN, TZ);
  const budget = 120;   // temporal buckets for crosshair-follow resolution

  const wrap = makeWrapper(root);
  wrap.classList.toggle('fill', cfg.fit === 'fill');
  wrap.innerHTML = '<div class="grid"></div>';

  // the mount's shared state (the fields that change live only here)
  const s: GridState = {
    root, cfg, P, TZ, SPAN, LIVE, backend, wrap,
    kiosks: [], tiles: {}, destroyed: false, pollTimer: null, shownT: null,
    pv: makePreview(root, TZ),
    PANEL_TT: zoneTexts(TZ, TZ, false),
  };

  (async function boot() {
    try {
      s.kiosks = (await backend.kiosks(P.site))
        .filter((k) => !P.source || P.source.includes(k.id))
        .filter((k) => matchesTags(k.tags, parseTagFilter(cfg.tagFilter)));
    } catch (e: any) {   // whatever was thrown, read loosely as before
      console.warn('[visual-timeline] sources fetch failed:', e);
      if (s.destroyed) {return;}
      const err = document.createElement('div');
      err.className = 'boot-err';
      err.textContent = bootErrorText(e, cfg.authHint);
      q(s.wrap, '.grid').appendChild(err);
      await revealWrapper(root, wrap);
      return;
    }
    for (const k of s.kiosks) {
      if (s.destroyed) {return;}
      let model: SourceModel;
      try {
        model = await buildSourceModel(k, P, backend, budget);
      } catch (e) {
        console.warn('[visual-timeline] model build failed for ' + k.id + ':', e);
        continue;
      }
      if (s.destroyed) {return;}
      // declared pause IS data — a source that is all SCREEN DARK for the
      // window must render its band, not vanish as if it never reported
      if (cfg.hideEmpty && !model.slots.some((sl) => sl.frame || sl.paused)) {continue;}
      s.tiles[k.id] = buildTile(s, k, model);
    }
    s.kiosks = s.kiosks.filter((k) => s.tiles[k.id]);
    setShown(s, null);
    await revealWrapper(root, wrap);

    if (LIVE) {startPoll(s);}
  })();

  return {
    setExternalCursor(t) { if (!s.destroyed) {setShown(s, Math.max(P.from, Math.min(P.to, t)));} },
    clearExternal() { if (!s.destroyed) {setShown(s, null);} },
    destroy() {
      s.destroyed = true;
      if (s.pollTimer) {clearInterval(s.pollTimer);}
      s.pv.retire();   // an open preview survives refresh remounts (adopted by the successor)
      retireWrapper(wrap);
    },
  };
}
