import type { GridState } from './state';
import { lastFrame, setShown } from './tile';

/* The grid's live poll (a window that reaches now): every 10 s it fetches
 * each tile's frames since its latest one and, unless a crosshair time is
 * shown, refreshes the "latest" tiles. Sets s.pollTimer; destroy() clears
 * it. */
export function startPoll(s: GridState): void {
  let busy = false;   // a slow tick must not overlap the next
  s.pollTimer = setInterval(async () => {
    if (busy) {return;}
    busy = true;
    try { await pollOnce(s); } finally { busy = false; }
  }, 10000);
}

async function pollOnce(s: GridState): Promise<void> {
  for (const k of s.kiosks) {
    const rec = s.tiles[k.id];
    const la = rec.model.lastActive;
    if (!la) {continue;}                   // tail era is a declared pause
    const last = lastFrame(rec);
    let fresh;
    try {
      fresh = await s.backend.frames(k.site, k.id, (last ? last.ts : s.P.from) + 1, Date.now(), la.step);
    } catch (e) {
      // one source's failure must not stop the others' polls
      console.warn('[visual-timeline] live poll failed for ' + k.id + ':', e);
      continue;
    }
    if (s.destroyed) {return;}
    for (const f of fresh) {
      const slot = rec.model.slotAt(f.ts);
      if (!slot || slot.paused || slot.beyond) {continue;}
      // newer frames replace the bucket representative so "latest" slides
      if (!slot.frame || f.ts > slot.frame.ts) {slot.frame = f;}
    }
  }
  if (s.shownT == null) {setShown(s, null);}   // keep "latest" tiles fresh
}
