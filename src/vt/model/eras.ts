import type { Era, HistoryEvent, SourceDecl, TimeWindow } from '../types';

/* ======================= cadence events → eras =======================
 * A source's registry history is a stream of CADENCE EVENTS — declarations
 * that change the contract in force from that moment on: a new pace, or a
 * pause ("I will deliberately send nothing"). Eras are the spans between
 * events; the timeline renders each era on its own grid, so sparse frames
 * during a slow era aren't gaps and declared pauses render as neutral
 * silence rather than the red offline hatch. Resume is inferred from data:
 * a frame arriving inside a paused era ends it (crash-safe — a source that
 * dies unexpectedly never declares, so its silence stays "offline"). */
/* one cadence event: the history entry, or the leading pace before it */
type CadenceEvent = Pick<HistoryEvent, 'since' | 'cadence' | 'reason' | 'intended' | 'label' | 'color'> & { paused: boolean };
export function erasFor(decl: Partial<Pick<SourceDecl, 'cadence' | 'history'>>, P: TimeWindow): Era[] {
  const hist = (decl.history || [])
    .filter((h) => (h.variant || 'lo') === 'lo')
    .slice()
    .sort((a, b) => a.since - b.since);
  let runCad = decl.cadence || 60e3;
  if (hist.length && hist[0].cadence) {runCad = hist[0].cadence;}
  const evts: CadenceEvent[] = [{ since: -8.64e15, cadence: runCad, paused: false, reason: undefined, intended: undefined }];
  for (const h of hist) {evts.push({ since: h.since, cadence: h.cadence, paused: !!h.paused, reason: h.reason, intended: h.intended, label: h.label, color: h.color });}
  const eras: Era[] = [];
  for (let i = 0; i < evts.length; i++) {
    const e = evts[i];
    const next = evts[i + 1];
    if (e.cadence) {runCad = e.cadence;}
    const from = Math.max(e.since, P.from);
    const to = Math.min(next ? next.since : P.to, P.to);
    if (to <= from) {continue;}
    const prev = eras[eras.length - 1];
    if (prev && prev.paused === !!e.paused && prev.cadence === runCad &&
        prev.reason === e.reason && prev.intended === e.intended && prev.label === e.label && prev.color === e.color) { prev.to = to; continue; }
    eras.push({ from, to, cadence: runCad, paused: !!e.paused, reason: e.reason, intended: e.intended,
      ...(e.label ? { label: e.label } : {}), ...(e.color ? { color: e.color } : {}) });
  }
  if (!eras.length) {eras.push({ from: P.from, to: P.to, cadence: runCad, paused: false, reason: undefined, intended: undefined });}
  return eras;
}

/* Presentation of a paused era/slot. The core knows no reasons: a pause
 * says what it is (its label) and how it looks (its colour), whether it came
 * from a state query's value mappings or from a backend that translated its
 * own vocabulary (backends/reasons.ts). Without either it's a plain PAUSED
 * band in the neutral hatch. */
export const PAUSE_CLASSES = ['paused', 'tinted'];
export function clearPauseClasses(el: Element): void {
  el.classList.remove(...PAUSE_CLASSES);
  (el as HTMLElement).style?.removeProperty('--ktl-band');
}
/* a pause's classes and, for one that brings its own colour, that colour */
export function addPauseClasses(el: Element, x: PauseSubject | null | undefined): void {
  const pi = pauseInfo(x);
  el.classList.add(...pi.classes);
  if (pi.color) {(el as HTMLElement).style.setProperty('--ktl-band', pi.color);}
}
/* what pauseInfo reads off a paused slot or era */
export type PauseSubject = { paused?: boolean; label?: string; color?: string };
export function pauseInfo(x: PauseSubject | null | undefined): { label: string; classes: string[]; color?: string } {
  const label = (x && x.label) || 'PAUSED';
  const color = x && x.color;
  return { label, classes: color ? ['paused', 'tinted'] : ['paused'], ...(color ? { color } : {}) };
}
