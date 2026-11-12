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
  for (const k of s.hosts) {
    const rec = s.tiles[k.id];
    if (!rec) {continue;}
    const last = lastFrame(rec);
    let fresh, clips;
    try {
      const from = Math.max(last ? last.ts : s.P.from, s.P.from) + 1, to = Math.min(s.P.to, Date.now());
      fresh = s.backend.allFrames ? await s.backend.allFrames(k.site, k.id, from, to) : await s.backend.frames(k.site, k.id, from, to, rec.model.step);
      clips = s.backend.clips ? await s.backend.clips(k.site, k.id, from, to) : undefined;
    } catch (e) {
      // one source's failure must not stop the others' polls
      console.warn('[visual-timeline] live poll failed for ' + k.id + ':', e);
      continue;
    }
    if (s.destroyed) {return;}
    rec.model.refresh(fresh, Date.now(), clips);
  }
  setShown(s, s.shownT);   // the latest tiles slide; a crosshair time re-reads its intervals
}
