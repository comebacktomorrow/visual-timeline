import { clearPauseClasses, pauseInfo } from '../model/eras';
import { ghostFor } from '../model/slots';
import { hiUrlFor } from '../backends/api';
import { esc, headTitle, tagChips } from '../dom/html';
import { q } from '../ui/wrapper';
import { attachZoneChip, dressZoneChip, zoneChip } from '../zones/chip';
import { zoneFor } from '../zones/source';
import type { Frame, Slot, SourceDecl, SourceModel } from '../types';
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
    '<div class="t-head" title="' + esc(headTitle(decl)) + '"><span class="nm">' + esc(decl.id) + '</span>' +
    '<span class="inline-brk"></span>' + zoneChip(zone.srcTZ) +
    '<span class="st">' + esc(decl.site) + (decl.location ? ' · ' + esc(decl.location) : '') + '</span>' +
    tagChips(decl) + '</div>' +
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
    else if (rec.shown) {s.pv.open(decl.site, decl.id, rec.shown, e.clientX, e.clientY, hiUrlFor(rec.shown, decl, s.cfg.apiUrl, s.cfg.apiKey), null, rec.tt);}
  });
  q(s.wrap, '.grid').appendChild(el);
  return rec;
}

export function lastFrame(rec: Tile): Frame | null {
  for (let i = rec.model.slots.length - 1; i >= 0; i--) {
    if (rec.model.slots[i].frame) {return rec.model.slots[i].frame as Frame;}   // truthy, so a Frame (no narrowing through slots[i])
  }
  return null;
}

/* t = null → most recent in window; otherwise frame at crosshair time */
export function setShown(s: GridState, t: number | null): void {
  s.shownT = t;
  if (s.cfg.onShown) {s.cfg.onShown(t);}                // host chrome hook (standalone app)
  // zone chips: offset at the crosshair, else at the window's live edge
  const zoneAt = t == null ? Math.min(s.P.to, Date.now()) : t;
  for (const k of s.kiosks) {
    const rec = s.tiles[k.id];
    if (!rec) {continue;}
    if (rec.zone.el) {dressZoneChip(rec.zone, zoneAt);}
    const tt = rec.tt;
    let frame: Frame | null | undefined = null, offMsg: string | null = null, pausedMsg: string | null = null,
      pausedSlot: Slot | null = null, expectedTs: number | null = null;
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
      else if (s.LIVE && la && Date.now() - frame.ts > 2 * la.step)
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
            let last: Frame | null | undefined = null;
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
