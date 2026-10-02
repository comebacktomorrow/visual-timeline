import type { GridState } from './state';
import { lastFrame, setShown } from './tile';

/* The grid's live poll (a window that reaches now): every 10 s it fetches
 * each tile's frames since its latest one and, unless a crosshair time is
 * shown, refreshes the "latest" tiles. Sets s.pollTimer; destroy() clears
 * it. */
export function startPoll(s: GridState): void {
  s.pollTimer = setInterval(async () => {
    for (const k of s.kiosks) {
      const rec = s.tiles[k.id];
      const la = rec.model.lastActive;
      if (!la) {continue;}                   // tail era is a declared pause
      const last = lastFrame(rec);
      const fresh = await s.backend.frames(k.site, k.id, (last ? last.ts : s.P.from) + 1, Date.now(), la.step);
      if (s.destroyed) {return;}
      for (const f of fresh) {
        const slot = rec.model.slotAt(f.ts);
        if (!slot || slot.paused || slot.beyond) {continue;}
        // newer frames replace the bucket representative so "latest" slides
        if (!slot.frame || f.ts > slot.frame.ts) {slot.frame = f;}
      }
    }
    if (s.shownT == null) {setShown(s, null);}   // keep "latest" tiles fresh
  }, 10000);
}
