import type { HistoryEvent, SourceDecl } from '../types';

/* What the reference worker's pause reasons look like (#126). This is the
 * edge's vocabulary, not the core's: the core draws a pause from its label
 * and colour alone, so a pause from any state query and one from our API look
 * the same way. The colours are Grafana's palette (blue, orange, purple), the
 * ones our data source's value mappings use, and teal for app-stopped. */
const REASONS: Record<string, { label: string; color?: string }> = {
  quiet: { label: 'QUIET HOURS' },
  'screen-sleep': { label: 'SCREEN ASLEEP', color: '#5794F2' },
  'system-down': { label: 'SYSTEM DOWN (PLANNED)', color: '#B877D9' },
  'app-stopped': { label: 'APP STOPPED', color: '#2BA08C' },
  // the retention cutoff: frames this old have been deleted
  expired: { label: 'NO DATA' },
};
const UNEXPECTED = '#FF9830';

/** A declared pause's label and colour, from its reason and whether anyone
 * intended it (an unintended one is amber: explained, but nobody asked). */
export function reasonDisplay(reason: string | undefined, intended: boolean | undefined): { label: string; color?: string } {
  const known = reason ? REASONS[reason] : undefined;
  // an unknown reason is PAUSED, as before; only a known one names itself
  const label = known?.label ?? 'PAUSED';
  if (intended === false) {
    return { label: reason === 'screen-sleep' ? 'SCREEN DARK (UNEXPECTED)' : label, color: UNEXPECTED };
  }
  return known?.color ? { label, color: known.color } : { label };
}

/** A source's history with each declared pause given its label and colour,
 * where it doesn't already carry them. */
export function labelPauses<T extends Pick<SourceDecl, 'history'>>(decl: T): T {
  if (!decl.history?.some((h) => h.paused && !h.label)) {return decl;}
  const history: HistoryEvent[] = decl.history.map((h) =>
    h.paused && !h.label ? { ...h, ...reasonDisplay(h.reason, h.intended) } : h);
  return { ...decl, history };
}
