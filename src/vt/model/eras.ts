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
type CadenceEvent = Pick<HistoryEvent, 'since' | 'cadence' | 'reason' | 'intended'> & { paused: boolean };
export function erasFor(decl: Partial<Pick<SourceDecl, 'cadence' | 'history'>>, P: TimeWindow): Era[] {
  const hist = (decl.history || [])
    .filter((h) => (h.variant || 'lo') === 'lo')
    .slice()
    .sort((a, b) => a.since - b.since);
  let runCad = decl.cadence || 60e3;
  if (hist.length && hist[0].cadence) {runCad = hist[0].cadence;}
  const evts: CadenceEvent[] = [{ since: -8.64e15, cadence: runCad, paused: false, reason: undefined, intended: undefined }];
  for (const h of hist) {evts.push({ since: h.since, cadence: h.cadence, paused: !!h.paused, reason: h.reason, intended: h.intended });}
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
        prev.reason === e.reason && prev.intended === e.intended) { prev.to = to; continue; }
    eras.push({ from, to, cadence: runCad, paused: !!e.paused, reason: e.reason, intended: e.intended });
  }
  if (!eras.length) {eras.push({ from: P.from, to: P.to, cadence: runCad, paused: false, reason: undefined, intended: undefined });}
  return eras;
}

/* Presentation of a paused era/slot: the pause is the MECHANIC, the reason
 * carries the meaning ("screen asleep" is a world-state; "paused" is what the
 * uploader did about it). intended === false is the triage color: explained
 * but nobody asked for it (power-policy blank, display handoff failure). */
export const PAUSE_CLASSES = ['paused', 'unintended', 'r-quiet', 'r-screen-sleep', 'r-app-stopped', 'r-system-down', 'r-expired'];
/* clear every pause class off an element: PAUSE_CLASSES plus ANY r-<reason>.
 * pauseInfo passes unknown reasons through as classes, so no fixed list can
 * cover them, and a leftover one would outlive the band it came from. */
export function clearPauseClasses(el: Element): void {
  el.classList.remove(...PAUSE_CLASSES);
  for (const c of Array.from(el.classList)) {if (c.startsWith('r-')) {el.classList.remove(c);}}
}
/* what pauseInfo reads off a paused slot or era (null intent tolerated:
 * only intended === false is unintended) */
export type PauseSubject = { paused?: boolean; reason?: string; intended?: boolean | null };
export function pauseInfo(x: PauseSubject | null | undefined): { label: string; classes: string[] } {
  const r = x && x.reason;
  const unintended = !!x && x.intended === false;
  const label =
    r === 'screen-sleep' ? (unintended ? 'SCREEN DARK (UNEXPECTED)' : 'SCREEN ASLEEP') :
    r === 'system-down'  ? 'SYSTEM DOWN (PLANNED)' :
    r === 'app-stopped'  ? 'APP STOPPED' :
    r === 'quiet'        ? 'QUIET HOURS' :
    // the API's retention cutoff: frames this old have been deleted
    r === 'expired'      ? 'NO DATA' : 'PAUSED';
  const classes = ['paused'];
  if (r) {classes.push('r-' + String(r).replace(/[^\w-]/g, ''));}
  if (unintended) {classes.push('unintended');}
  return { label, classes };
}
