import { dressStrip, renderStrip } from './card';
import type { TimelineState } from './state';

/* The live poll (a window that reaches now): every min(step, 10 s) it
 * fetches each host's frames since its last one and rebuilds its intervals
 * for the new now (model.refresh): the strip slides along, a promise that
 * comes due turns pending, then dropped, and a frame that makes no promise
 * runs out into no data, all between dashboard refreshes. The strip is
 * re-rendered in place; unchanged cells keep their elements. Sets
 * s.pollTimer; destroy() clears it. */
export function startPoll(s: TimelineState): void {
  const steps = s.kiosks.map((k) => s.cards[k.id]?.model.step).filter((x): x is number => !!x);
  const minStep = steps.length ? Math.min(...steps) : 60e3;
  let busy = false;   // a slow tick (many sources, slow API) must not overlap the next
  s.pollTimer = setInterval(async () => {
    if (busy) {return;}
    busy = true;
    try { await pollOnce(s); } finally { busy = false; }
  }, Math.min(minStep, 10000));
}

async function pollOnce(s: TimelineState): Promise<void> {
  for (const k of s.kiosks) {
    const c = s.cards[k.id];
    if (!c) {continue;}
    const m = c.model;
    const last = m.frames.length ? m.frames[m.frames.length - 1].ts : s.P.from;
    let fresh, clips;
    try {
      const from = Math.max(last, s.P.from) + 1, to = Math.min(s.P.to, Date.now());
      fresh = s.backend.allFrames ? await s.backend.allFrames(k.site, k.id, from, to) : await s.backend.frames(k.site, k.id, from, to, m.step);
      clips = s.backend.clips ? await s.backend.clips(k.site, k.id, from, to) : undefined;
    } catch (e) {
      // one source's failure must not stop the others' polls
      console.warn('[visual-timeline] live poll failed for ' + k.id + ':', e);
      continue;
    }
    if (s.destroyed) {return;}
    m.refresh(fresh, Date.now(), clips);
    renderStrip(s, m, c.strip, k.id, c.tt);
    // the hatch aligned across the strip and band labels, as at build; an
    // unsized (hidden) strip is left as is
    if (c.strip.clientWidth > 0) {dressStrip(m);}
    c.shown = null;   // the magnifier re-reads its slot on the next cursor move
  }
}
