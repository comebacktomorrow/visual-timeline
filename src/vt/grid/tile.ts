import { addPauseClasses, clearPauseClasses, pauseInfo, type PauseSubject } from '../model/eras';
import { esc, filterAttrs, headChips, headTitle } from '../dom/html';
import { q } from '../ui/wrapper';
import { attachZoneChip, dressZoneChip, zoneChip } from '../zones/chip';
import { zoneFor } from '../zones/source';
import type { Frame, SourceDecl, SourceModel } from '../types';
import type { GridState, Tile } from './state';

/* The grid's tiles: building one (header, image, click-in preview), the
 * latest frame of a tile, and setShown, which shows every tile at a time
 * (the shared crosshair) or at its latest frame. */

/* one source's tile; its click opens the preview of the frame it shows */
export function buildTile(s: GridState, decl: SourceDecl, model: SourceModel): Tile {
  const el = document.createElement('div');
  const zone = zoneFor(decl, s.TZ, s.cfg.thumbTimes, s.PANEL_TT);
  const inline = s.cfg.headerMode === 'inline' || s.cfg.headerMode === 'inline-gradient';
  el.className = 'tile' + (inline ? ' inline-head' : '') +
    (s.cfg.headerMode === 'inline-gradient' ? ' inline-grad' : '');
  el.innerHTML =
    '<div class="t-head" title="' + esc(headTitle(decl)) + '"><span class="nm"' + filterAttrs('host', decl.id, !!s.cfg.onFilter) + '>' + esc(decl.id) + '</span>' +
    '<span class="inline-brk"></span>' + zoneChip(zone.srcTZ) +
    headChips(decl, s.cfg.chips, !!s.cfg.onFilter) + '</div>' +
    '<div class="t-img"><img alt="' + esc(decl.id) + '"><span class="t-ts"></span><div class="t-off"></div></div>';
  attachZoneChip(zone, el);
  // img, .t-ts and .t-off are in the template just set
  const rec: Tile = {
    decl, model, el, shown: null, zone, tt: zone.tt,
    img: el.querySelector('img')!,
    ts: el.querySelector<HTMLElement>('.t-ts')!,
    off: el.querySelector<HTMLElement>('.t-off')!,
  };
  el.addEventListener('click', e => {
    if (rec.shown && rec.shownExpected) {s.pv.open(decl.site, decl.id, rec.shown, e.clientX, e.clientY, null, rec.shownExpected, rec.tt);}
    else if (rec.shown) {s.pv.open(decl.site, decl.id, rec.shown, e.clientX, e.clientY, rec.shown.hi ?? null, null, rec.tt);}
  });
  q(s.wrap, '.grid').appendChild(el);
  return rec;
}

/* the latest frame the tile's host took in the window */
export function lastFrame(rec: Tile): Frame | null {
  const f = rec.model.frames;
  return f.length ? f[f.length - 1] : null;
}

/* the last frame taken at or before t */
function frameBefore(rec: Tile, t: number): Frame | null {
  const f = rec.model.frames;
  for (let i = f.length - 1; i >= 0; i--) {if (f[i].ts <= t) {return f[i];}}
  return null;
}

/* t = null → most recent in window; otherwise what's in force at the
 * crosshair time: a frame, a pending one (shown as expected), a pause,
 * dropped (offline: a promise broke) or no data (neutral) */
export function setShown(s: GridState, t: number | null): void {
  s.shownT = t;
  if (s.cfg.onShown) {s.cfg.onShown(t);}                // host chrome hook (standalone app)
  // zone chips: offset at the crosshair, else at the window's live edge
  const live = Math.min(s.P.to, Date.now());
  const zoneAt = t == null ? live : t;
  for (const k of s.kiosks) {
    const rec = s.tiles[k.id];
    if (!rec) {continue;}
    if (rec.zone.el) {dressZoneChip(rec.zone, zoneAt);}
    const tt = rec.tt;
    let frame: Frame | null = null, offMsg: string | null = null, pausedMsg: string | null = null,
      pausedAt: PauseSubject | null = null, expectedTs: number | null = null, nodata = false;
    // "latest": in a live window, what's in force now; in a past one, the
    // window's last frame (no offline call), or the pause it ended in
    const at = t == null ? live - 1 : t;
    const iv = rec.model.intervalAt(at);
    let kind = iv ? iv.kind : 'nodata';
    const latest = t == null ? lastFrame(rec) : null;
    if (t == null && !s.LIVE && kind !== 'paused') {kind = latest ? 'frame' : 'nodata';}
    if (t == null && kind === 'frame' && latest) {
      frame = latest;
    } else if (kind === 'frame') {
      frame = iv!.frame!;
    } else if (kind === 'pending') {
      // the promise is due, the frame still in flight: the last frame, as expected
      frame = iv!.frame!;
      expectedTs = iv!.from;
    } else if (kind === 'paused') {
      pausedAt = { paused: true, label: iv!.pause!.label, color: iv!.pause!.color };
      const last = t == null ? lastFrame(rec) : null;
      pausedMsg = pauseInfo(pausedAt).label + (last ? ' — last frame ' + tt.time(last.ts) + tt.sfx(last.ts) : '');
    } else if (kind === 'beyond') {
      offMsg = '—';   // ahead of now: unknown, not a failure: neutral
      nodata = true;
    } else {
      nodata = kind === 'nodata';
      const last = frameBefore(rec, at);
      offMsg = last
        ? (nodata ? 'NO FRAME' : 'OFFLINE') + ' — last seen ' + tt.time(last.ts) + tt.sfx(last.ts)
        : t == null ? 'no data in window' : 'no data';
    }
    rec.el.classList.toggle('offline', !!offMsg);
    rec.el.classList.toggle('nodata', !!offMsg && nodata);
    clearPauseClasses(rec.el);
    if (pausedMsg && !offMsg) {addPauseClasses(rec.el, pausedAt);}
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
