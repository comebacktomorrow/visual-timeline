import type { Backend, DropMark, Frame, Slot, SourceDecl, SourceModel, TickSlot, TimeWindow } from '../types';
import { erasFor, pauseInfo, type PauseSubject } from './eras';
import { buildIntervals, type HoldLimit, type Interval, type Intervals, type PauseSpan } from './intervals';

/* A host's window as the strip draws it (docs/TIMELINE-MODEL.md): its frames
 * become intervals (buildIntervals), and the intervals are sampled into
 * slots, about one per pixel budget's share of the window. A slot shows a
 * frame taken within it, else what's in force at its tick: a frame, pending,
 * dropped (offline) or no data. Pauses are one band each, and past now is
 * one inert spacer. The slots tile the window exactly, in time order. */

/* How far before the window frames are fetched, at most, in steps: enough
 * to find the frame in force at its start without asking an API for more
 * buckets than it allows (the reference worker caps a request at 800). */
const LOOKBACK_STEPS = 100;
/* A host with no promise: look back this far for the frame in force. */
const LOOKBACK_UNPROMISED = 3600e3;

export interface ModelOptions {
  /** the hold limit for frames that make no promise */
  hold?: HoldLimit;
  /** the build's "now" (tests) */
  now?: number;
  /** a promise for every frame (ms), whatever the source says: the panel's
   * Expected cadence */
  expected?: number;
  /** the interval the frames were asked for at (ms): Grafana's $__interval */
  sample?: number;
}

export async function buildSourceModel(
  decl: SourceDecl, P: TimeWindow, backend: Pick<Backend, 'frames' | 'allFrames'>, budgetSlots: number, opts: ModelOptions = {}
): Promise<SourceModel> {
  const expected = opts.expected && opts.expected > 0 ? opts.expected : undefined;
  // a source with an Expected cadence promises it, whatever it declared
  const eras = erasFor(expected ? { ...decl, cadence: expected, history: (decl.history || []).filter((h) => h.paused !== undefined || !h.cadence) } : decl, P);
  const promised = !!expected || !decl.inferred;
  const hold = opts.hold ?? 'auto';
  // one grid per host, at its finest pace in the window (or its typical gap,
  // without a promise), coarsened to the pixel budget in whole paces
  const active = eras.filter((e) => !e.paused);
  const base = Math.max(1000, Math.min(...(active.length ? active : eras).map((e) => e.cadence)));
  // the budget is for active time: a closed pause is one band, however long.
  // An open one (the last era) counts as active: frames may end it anywhere
  const closedPaused = eras.slice(0, -1).filter((e) => e.paused).reduce((a, e) => a + (e.to - e.from), 0);
  const activeSpan = Math.max(1, (P.to - P.from) - closedPaused);
  const step = base * Math.max(1, Math.ceil(activeSpan / base / Math.max(4, budgetSlots)));
  const maxCadence = Math.max(...eras.map((e) => e.cadence));
  const wanted = promised ? 1.5 * maxCadence + step
    : typeof hold === 'number' ? hold : LOOKBACK_UNPROMISED;
  const lookback = Math.min(wanted, LOOKBACK_STEPS * step);

  const now0 = opts.now ?? Date.now();
  // every frame when the backend holds them all (records): slots then know
  // how many frames they hold (the hover flipbook plays them); else one per step
  const fetched = backend.allFrames
    ? await backend.allFrames(decl.site, decl.id, P.from - lookback, Math.min(P.to, now0))
    : await backend.frames(decl.site, decl.id, P.from - lookback, Math.min(P.to, now0), step);

  // the promise in force at a time: its era's pace (the first era's before
  // the window); none for a source whose cadence was only inferred
  const promiseAt = (t: number): number | null => {
    if (!promised) {return null;}
    let c = eras[0].cadence;
    for (const e of eras) {if (e.from <= t) {c = e.cadence;}}
    return c;
  };
  // declared pauses: a closed one is the truth; the last, still open, ends at
  // the first frame a cadence or more into it (a goodbye frame, taken as it
  // pauses, can land just after the declaration)
  const pauses: PauseSpan[] = [];
  eras.forEach((e, i) => {
    if (!e.paused) {return;}
    const open = i === eras.length - 1;
    pauses.push({
      from: e.from, to: open ? null : e.to, resumeAfter: open ? e.cadence : undefined,
      label: e.label, color: e.color, reason: e.reason, intended: e.intended,
    });
  });

  const model: SourceModel = {
    eras, step, promised, frames: [], intervals: [], slots: [], drops: [], lastActive: null,
    slotAt: () => null, intervalAt: () => null,
    // frames for a span (the player's): exact when they were fetched at full
    // resolution for it, else judged at the interval they were asked for at
    intervalsFor: (frames, window, now, exact) => buildIntervals({
      frames, promiseAt, pauses, hold, window, now, promiseOverride: expected, ...(exact ? {} : { sample: opts.sample }),
    }).intervals,
    refresh(fresh: Frame[], now: number) {
      const byTs = new Map(model.frames.map((f) => [f.ts, f]));
      for (const f of fresh) {byTs.set(f.ts, f);}
      model.frames = [...byTs.values()].sort((a, b) => a.ts - b.ts);
      // A backend that answers one frame per step (the reference worker)
      // thins a fast feed: its frames are a step apart, which isn't a broken
      // promise. When the frames look thinned, a promise counts as at least
      // a step; when they come denser, they're judged as they are.
      const buckets = (Math.min(P.to, now) - (P.from - lookback)) / step + 2;
      const thinned = model.frames.length <= 1.1 * buckets;
      const built = buildIntervals({
        frames: model.frames, promiseAt, pauses, hold, window: P, now, step: promised && thinned ? step : undefined,
        promiseOverride: expected, sample: opts.sample,
      });
      // each slot's cadence: the promise in force at its tick, or the typical gap
      const { slots, drops } = sample(built, step, (t) => promiseAt(t) ?? base);
      model.intervals = built.intervals;
      model.intervalAt = built.at;
      model.slots = slots;
      model.drops = drops;
      model.slotAt = (t) => slotAt(slots, t);
      model.lastActive = [...slots].reverse().find((sl): sl is TickSlot => !sl.paused && !sl.beyond) || null;
    },
  };
  model.refresh(fetched, now0);
  return model;
}

/* The intervals as slots. Within each active stretch (between pauses and
 * the spacer past now), a tick at every multiple of the step; each tick's
 * slot reaches halfway to its neighbours, and the stretch's ends. A stretch
 * too short for a tick gets one slot, sampled at its middle. */
function sample(built: Intervals, step: number, cadenceAt: (t: number) => number): { slots: Slot[]; drops: DropMark[] } {
  const ivs = built.intervals;
  const frames = built.frames;
  const slots: Slot[] = [];
  let fi = 0;   // frames before the current slot are behind this index
  for (let i = 0; i < ivs.length;) {
    const iv = ivs[i];
    if (iv.kind === 'paused') {
      const p = iv.pause!;
      slots.push({ ts: iv.from, x0: iv.from, span: iv.to - iv.from, paused: true,
        reason: p.reason, intended: p.intended, label: p.label, color: p.color });
      i++;
      continue;
    }
    if (iv.kind === 'beyond') {
      slots.push({ ts: iv.from, x0: iv.from, span: iv.to - iv.from, beyond: true });
      i++;
      continue;
    }
    let j = i;
    while (j < ivs.length && ivs[j].kind !== 'paused' && ivs[j].kind !== 'beyond') {j++;}
    const a = iv.from, b = ivs[j - 1].to;
    const ticks: number[] = [];
    // both ends inclusive: a frame on the window's end, or on a pause's
    // start (a goodbye frame), is the stretch's last
    for (let t = Math.ceil(a / step) * step; t <= b; t += step) {ticks.push(t);}
    if (!ticks.length) {ticks.push((a + b) / 2);}
    for (let k = 0; k < ticks.length; k++) {
      const t = ticks[k];
      const x0 = k === 0 ? a : (ticks[k - 1] + t) / 2;
      const x1 = k === ticks.length - 1 ? b : (t + ticks[k + 1]) / 2;
      // the frames taken within the slot: it shows the one nearest its tick
      while (fi < frames.length && frames[fi].ts < x0) {fi++;}
      let count = 0, best: Frame | null = null;
      const last = k === ticks.length - 1;
      for (let m = fi; m < frames.length && (frames[m].ts < x1 || (last && frames[m].ts === x1)); m++) {
        count += frames[m].count && frames[m].count! > 1 ? frames[m].count! : 1;
        if (!best || Math.abs(frames[m].ts - t) < Math.abs(best.ts - t)) {best = frames[m];}
      }
      // the last slot of a stretch reads its end (at the live edge: now)
      const at = best ? null : built.at(last ? b - 1 : Math.min(t, b - 1));
      const sl: TickSlot = {
        ts: t, x0, span: x1 - x0, cadence: cadenceAt(t), step, count,
        frame: best ?? (at && at.kind === 'frame' ? at.frame! : null),
        future: !best && !!at && at.kind === 'pending',
      };
      if (!best && at && at.kind === 'nodata') {sl.nodata = true;}
      slots.push(sl);
    }
    i = j;
  }
  // dropped time inside slots that show a frame
  const drops: DropMark[] = [];
  for (const iv of ivs) {
    if (iv.kind !== 'dropped') {continue;}
    for (const sl of slots) {
      if (!sl.frame || sl.x0 >= iv.to || sl.x0 + sl.span <= iv.from) {continue;}
      const from = Math.max(iv.from, sl.x0), to = Math.min(iv.to, sl.x0 + sl.span);
      const last = drops[drops.length - 1];
      if (last && last.to === from) {last.to = to;} else {drops.push({ from, to });}
    }
  }
  return { slots, drops };
}

/* The slot under t: they tile the window in order, so the last one that
 * starts at or before t. Before the window, the first; past it, the last.
 * The spacer's leading half step belongs to the slot before it, so the
 * live-edge rest cursor shows the latest frame, not the unknown. */
function slotAt(slots: Slot[], t: number): Slot | null {
  if (!slots.length) {return null;}
  let lo = 0, hi = slots.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (slots[mid].x0 <= t) {lo = mid;} else {hi = mid - 1;}
  }
  const sl = slots[lo];
  if (sl.beyond && lo > 0) {
    const prev = slots[lo - 1];
    if (!prev.paused && !prev.beyond && t < sl.x0 + prev.step / 2) {return prev;}
  }
  return sl;
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
export type SlotState = PauseSubject & { beyond?: boolean; frame?: Frame | null; future?: boolean; nodata?: boolean };
/* A strip slot's state classes (appended to "slot"): a pause band, the
 * beyond-now spacer, a frame, pending ("future"), dropped ("gap": offline)
 * or no data ("gap nodata": neutral). */
export function slotClass(sl: SlotState): string {
  return sl.paused ? ' ' + pauseInfo(sl).classes.join(' ') : sl.beyond ? ' beyond'
    : sl.frame ? '' : sl.future ? ' future' : sl.nodata ? ' gap nodata' : ' gap';
}

export type { Interval };
