import type { Backend, Frame, Slot, SourceDecl, SourceModel, TickSlot, TimeWindow } from '../types';
import { erasFor, pauseInfo, type PauseSubject } from './eras';

/* an active stretch to lay ticks over: an active era clamped to the
 * horizon, or the resumed tail of a paused one */
type ActiveSpan = { from: number; to: number; cadence: number };

/* One flat slot list across all eras. Each slot knows its time span (for
 * proportional width — x↔time stays linear across era boundaries), its
 * era's cadence/step (gap + staleness thresholds), or paused:true. */
export async function buildSourceModel(
  decl: SourceDecl, P: TimeWindow, backend: Pick<Backend, 'frames'>, budgetSlots: number
): Promise<SourceModel> {
  const eras = erasFor(decl, P);
  const slots: Slot[] = [];
  const totalActive = eras.filter((e) => !e.paused).reduce((a, e) => a + (e.to - e.from), 0) || 1;
  // ONE "now" for the whole build: the horizon and every slot's pending
  // ("future") flag are judged against it, however long the frame fetches
  // in between take (#77)
  const nowAtBuild = Date.now();

  // the one slot of an active era with no grid tick of its own (#65)
  function shortEraSlot(era: ActiveSpan, frame: Frame | null): TickSlot {
    return { ts: era.from, span: era.to - era.from, frame, cadence: era.cadence, step: era.cadence,
      future: era.from + era.cadence >= nowAtBuild };
  }

  /* Where a closed active era meets the next era, its last tick can sit ON
   * the boundary. The later era owns that tick (#65): drop the earlier
   * era's copy when the later era draws the same tick itself, or when it's
   * an empty gap slot right before a pause band. A boundary tick that holds
   * a frame the later era won't show (off the later grid, or a goodbye
   * frame at a pause's start) stays, so no frame is lost. If that leaves
   * the earlier era with no slot, it gets the one-slot-at-its-start form. */
  function resolveBoundary(prev: (ActiveSpan & { startIdx: number }) | null, firstIdx: number): void {
    if (!prev || firstIdx <= prev.startIdx || firstIdx >= slots.length) {return;}
    const p = slots[firstIdx - 1];
    const first = slots[firstIdx];
    if (p.paused || p.beyond || p.ts !== prev.to) {return;}
    const laterDrawsIt = !first.paused && !first.beyond && first.ts === p.ts;
    if (!laterDrawsIt && !(first.paused && !p.frame)) {return;}
    if (laterDrawsIt && !first.frame && p.frame) {first.frame = p.frame;}
    slots.splice(firstIdx - 1, 1);
    if (firstIdx - 1 === prev.startIdx) {
      slots.splice(prev.startIdx, 0, shortEraSlot(prev, null));
    }
  }

  async function pushActive(era: ActiveSpan): Promise<void> {
    if (era.to - era.from <= 0) {return;}   // degenerate span — nothing to render
    const eraSpan = era.to - era.from;
    const share = Math.max(4, Math.round(budgetSlots * (eraSpan / totalActive)));
    const raw = Math.max(1, Math.ceil(eraSpan / era.cadence));
    const step = Math.ceil(raw / Math.min(share, raw)) * era.cadence;
    const start = Math.ceil(era.from / step) * step;
    const n = era.to >= start ? Math.floor((era.to - start) / step) + 1 : 0;
    if (n === 0) {
      // No grid tick inside (shorter than a step, between two grid points):
      // one slot at the era's start, spanning the era (#65). Uploads snap to
      // the NEAREST grid point, so the frame it sent can sit up to half a
      // cadence outside it.
      const half = era.cadence / 2;
      const near = await backend.frames(decl.site, decl.id, era.from - half, era.to + half, era.cadence);
      const frame = near
        .filter((f) => f.ts >= era.from - half && f.ts <= era.to + half)
        .sort((a, b) => Math.abs(a.ts - era.from) - Math.abs(b.ts - era.from))[0] || null;
      slots.push(shortEraSlot(era, frame));
      return;
    }
    const frames = await backend.frames(decl.site, decl.id, era.from, era.to, step);
    const by = new Map(frames.map((f) => [Math.round((f.ts - start) / step), f]));
    for (let i = 0; i < n; i++) {
      const ts = start + i * step;
      // a slot keeps "future" grace until ONE FULL STEP past its tick — the
      // same boundary the live poll uses to age future slots into gaps. A
      // tick that just passed has its frame IN FLIGHT (capture + upload +
      // the backend's response cache), and calling it offline for those
      // seconds painted a red live edge that healed on the next poll.
      // Pending through ts + step itself, offline after: missedHeartbeat's rule.
      slots.push({ ts, span: step, frame: by.get(i) || null, cadence: era.cadence, step, future: ts + step >= nowAtBuild });
    }
  }

  // Beyond-now horizon: the window can extend past now, but nothing is
  // KNOWN there — every era is clamped to min(now, P.to) and ONE inert
  // .beyond spacer covers the remainder (keeps x↔time linear; the poll
  // carves real slots out of it, or grows a tail pause band into it, as
  // time actually passes). Bands that painted prediction as knowledge
  // ("system down forever into the future") stop at now — and so do
  // active eras bounded by FUTURE events (a scheduled cadence change
  // must not spray pending slots across the next 45 minutes).
  const horizon = Math.min(P.to, nowAtBuild);
  let prevActive: (ActiveSpan & { startIdx: number }) | null = null;   // the last active era pushed, for resolveBoundary
  for (const era of eras) {
    const eFrom = era.from;
    const eTo = Math.min(era.to, horizon);
    const isTail = era === eras[eras.length - 1];
    const firstIdx = slots.length;
    const prev = prevActive;
    prevActive = null;
    if (!era.paused) {
      if (eTo > eFrom) {
        const span = { from: eFrom, to: eTo, cadence: era.cadence };
        await pushActive(span);
        resolveBoundary(prev, firstIdx);
        prevActive = { ...span, startIdx: firstIdx };
      }
      continue;
    }
    // BOUNDED paused era (a later history event closes it): the registry is
    // the truth — render the whole span paused, no probe. Probing here is
    // what broke sandwiched pauses: uploads snap to the NEAREST grid point,
    // so the goodbye frame sent just before the declare can carry a key up
    // to cadence/2 AFTER era.from — a phantom "resume" that split the era
    // into a sliver of pause plus a frameless "active" run of offline-red.
    if (!isTail) {
      if (eTo > eFrom) {
        slots.push({ ts: eFrom, span: eTo - eFrom, paused: true, reason: era.reason, intended: era.intended });
        resolveBoundary(prev, firstIdx);
      }
      continue;
    }
    // TAIL paused era: no closing event yet — infer resume from frames
    // (crash-safe: a source that dies while paused never resumes). Ignore
    // the first cadence of the era: that's where the round-half-up goodbye
    // straggler lands; a real resume that fast is indistinguishable anyway
    // and costs at most one cadence of detection lag. The band is clamped
    // to NOW — the future portion of the window is unknown, not paused.
    if (eTo <= eFrom) {continue;}
    const probe = await backend.frames(decl.site, decl.id, eFrom, eTo, era.cadence);
    const tailIdx = slots.length;
    const resume = probe.find((f) => f.ts >= eFrom + era.cadence && f.ts < eTo);
    if (resume) {
      const resumeTs = resume.ts;
      slots.push({ ts: eFrom, span: resumeTs - eFrom, paused: true, reason: era.reason, intended: era.intended });
      if (eTo > resumeTs) {await pushActive({ from: resumeTs, to: eTo, cadence: era.cadence });}
    } else {
      slots.push({ ts: eFrom, span: eTo - eFrom, paused: true, reason: era.reason, intended: era.intended });
    }
    resolveBoundary(prev, tailIdx);
  }
  // one spacer for everything past the horizon
  if (P.to > horizon) {
    const last = slots[slots.length - 1];
    const covered = !last ? horizon
      : (last.paused || last.beyond) ? last.ts + last.span
      : last.ts + last.step / 2;
    const fillerFrom = Math.min(Math.max(covered, horizon - 1), P.to);
    if (P.to - fillerFrom > 0) {slots.push({ ts: fillerFrom, span: P.to - fillerFrom, beyond: true });}
  }

  /* The slot under t: the first one whose END lies past t. Only the end is
   * tested: the slots tile the window in order, so every earlier slot has
   * already ended, and a t before the window resolves to the first slot
   * (past it, to the last). */
  function slotAt(t: number): Slot | null {
    for (const sl of slots) {
      const edge = sl.paused || sl.beyond;   // bands/fillers span [ts, ts+span); ticks are centered
      const to = edge ? sl.ts + sl.span : sl.ts + sl.span / 2;
      if (t < to) {
        if (sl.beyond) {
          // the filler's leading half-step is the tail of the last real
          // slot's coverage — resolve to it so the live-edge rest cursor
          // shows the latest frame instead of the unknown-future dash
          const i = slots.indexOf(sl);
          const prev = i > 0 ? slots[i - 1] : null;
          if (prev && !prev.beyond && t < sl.ts + (prev.step || 0) / 2) {return prev;}
        }
        return sl;
      }
    }
    return slots[slots.length - 1] || null;
  }
  const lastActive = [...slots].reverse().find((sl) => !sl.paused && !sl.beyond) || null;
  return { eras, slots, slotAt, lastActive };
}

/* The pending slot's "last known" frame: the nearest earlier frame, carried
 * only across other pending slots. A gap, a pause band or the window start
 * in between means there's nothing honest to carry. */
export function ghostFor(slots: Slot[], sl: Slot): Frame | null {
  for (let j = slots.indexOf(sl) - 1; j >= 0; j--) {
    if (slots[j].frame) {return slots[j].frame as Frame;}   // truthy, so a Frame (no narrowing through slots[j])
    if (!slots[j].future) {return null;}
  }
  return null;
}
/* the slot state slotClass reads: any Slot, or a slot-shaped object */
export type SlotState = PauseSubject & { beyond?: boolean; frame?: Frame | null; future?: boolean };
/* A strip slot's state classes (appended to "slot"): a pause band, the
 * beyond-now spacer, a frame, pending ("future") or offline ("gap"). */
export function slotClass(sl: SlotState): string {
  return sl.paused ? ' ' + pauseInfo(sl).classes.join(' ') : sl.beyond ? ' beyond' : sl.frame ? '' : sl.future ? ' future' : ' gap';
}
/* a pending slot still empty a full step past its tick has missed its
 * heartbeat: the live poll turns it from pending into offline */
export function missedHeartbeat(sl: Slot, now: number): boolean {
  return sl.future === true && !sl.frame && sl.ts + sl.step < now;
}
