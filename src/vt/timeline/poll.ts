import { missedHeartbeat } from '../model/slots';
import { dressGhost } from '../ui/ghost';
import type { TickSlot } from '../types';
import { ruleBeyond } from './axis';
import { dressStrip } from './card';
import type { TimelineState } from './state';

/* The live poll (a window that reaches now): every min(step, 10 s) it
 * advances each strip's live edge, fetches the frames since its last one,
 * ages pending slots that missed their heartbeat into gaps, and re-dresses
 * the ghosts. Sets s.pollTimer; destroy() clears it. */
export function startPoll(s: TimelineState): void {
  // (TS cannot narrow lastActive through s.cards[k.id], nor see that
  // filter(Boolean) drops the nulls)
  const steps = s.kiosks.map(k => s.cards[k.id].model.lastActive && s.cards[k.id].model.lastActive!.step).filter(Boolean);
  const minStep = steps.length ? Math.min.apply(null, steps as number[]) : 60e3;
  s.pollTimer = setInterval(async () => {
    for (const k of s.kiosks) {
      const c = s.cards[k.id];
      // advance the live edge: newly-elapsed ticks are carved out of the
      // beyond filler (active tail), or a tail pause band GROWS into it —
      // the strip keeps sliding between dashboard refreshes without ever
      // shading time that hasn't happened
      const mSlots = c.model.slots;
      let reshaped = false;   // a slot was carved or a tail band grew: re-dress the strip
      const filler = mSlots.length && mSlots[mSlots.length - 1].beyond ? mSlots[mSlots.length - 1] : null;
      if (filler) {
        const nowP = Date.now();
        const prev = mSlots.length > 1 ? mSlots[mSlots.length - 2] : null;
        if (prev && prev.paused) {
          const grow = Math.min(nowP, filler.ts + filler.span) - filler.ts;
          if (grow > 0) {
            reshaped = true;
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
            const sl: TickSlot = { ts: nextTs, span: prev.step, frame: null, cadence: prev.cadence, step: prev.step, future: true };
            const el = document.createElement('div');
            el.className = 'slot future';
            el.style.flexGrow = String(sl.span / 1000);
            if (f.el && f.el.parentNode) {f.el.parentNode.insertBefore(el, f.el);}
            sl.el = el;
            mSlots.splice(mSlots.length - 1, 0, sl);
            reshaped = true;
            f.span -= sl.span; f.ts += sl.span;
            if (f.span <= 0) { if (f.el) {f.el.remove();} mSlots.pop(); }
            else { if (f.el) {f.el.style.flexGrow = String(f.span / 1000);} ruleBeyond(s, f); }
            nextTs += prev.step;
          }
        }
      }
      // slots carved or grown above get the dressing built slots got
      // (dressStrip): the hatch aligned to the strip, so when a carved slot
      // later misses its heartbeat its gap hatch runs on from its
      // neighbours' instead of restarting per slot, and the label of a
      // pause band grown wide enough. One layout read, only on polls that
      // reshaped this strip; an unsized (hidden) strip is left as is.
      if (reshaped && c.strip.clientWidth > 0) {dressStrip(c.model);}
      const la = c.model.lastActive;
      if (!la) {continue;}                    // tail era is a declared pause
      let lastTs = s.P.from;
      for (let i = c.model.slots.length - 1; i >= 0; i--) {
        if (c.model.slots[i].frame) { lastTs = c.model.slots[i].ts; break; }
      }
      const fresh = await s.backend.frames(k.site, k.id, lastTs + 1, Date.now(), la.step);
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
        // every model slot has its element (buildCard, or carved above)
        slot.el!.classList.remove('gap', 'future');
        // the real frame replaces the ghost in place: a snap, no fade
        let img = slot.el!.querySelector('img');
        if (!img) { img = document.createElement('img'); slot.el!.appendChild(img); }
        img.classList.remove('ghost');
        img.src = f.url; img.alt = k.id + ' ' + c.tt.time(f.ts) + c.tt.sfx(f.ts);
      }
      // future slots age into the present; one still empty a full step
      // past its tick has now genuinely missed its heartbeat
      const overdue = Date.now();
      for (const sl of c.model.slots) {
        if (missedHeartbeat(sl, overdue)) {
          (sl as TickSlot).future = false;   // only a pending tick slot misses a heartbeat
          if (sl.el) { sl.el.classList.remove('future'); sl.el.classList.add('gap'); }
        }
      }
      // one pass covers every path above: newly carved pending slots
      // pick up a ghost, a missed heartbeat drops it
      for (const sl of c.model.slots) {dressGhost(c.model.slots, sl);}
    }
  }, Math.min(minStep, 10000));
}
