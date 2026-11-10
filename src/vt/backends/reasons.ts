import type { HistoryEvent, SourceDecl } from '../types';

/* What the reference worker's pause reasons look like (#126). This is the
 * edge's vocabulary, not the core's: the core draws a pause from its label
 * and colour alone. This table is the one place it's defined. Our data
 * source builds its default value mappings from it (shared/sources.ts), the
 * self-hosted dashboard carries those mappings (a test keeps them equal),
 * and the standalone viewer, which has no value mappings, reads it here.
 * Colours are Grafana colour names, so in Grafana they follow the theme;
 * teal isn't in Grafana's palette, so app-stopped's is a hex value. */
export const REASON_STYLES: Record<string, { label: string; color?: string }> = {
  paused: { label: 'PAUSED' },
  quiet: { label: 'QUIET HOURS' },
  'screen-sleep': { label: 'SCREEN ASLEEP', color: 'blue' },
  'system-down': { label: 'SYSTEM DOWN (PLANNED)', color: 'purple' },
  'app-stopped': { label: 'APP STOPPED', color: '#2BA08C' },
  // the retention cutoff: frames this old have been deleted
  expired: { label: 'NO DATA' },
};
/** A pause nobody intended: amber, explained but unasked for. */
export const UNEXPECTED_COLOR = 'orange';

/** An unintended pause's label: its usual one (a screen that went dark
 * unexpectedly has its own). */
export function unexpectedLabel(reason: string | undefined): string {
  return reason === 'screen-sleep' ? 'SCREEN DARK (UNEXPECTED)' : (reason && REASON_STYLES[reason]?.label) || 'PAUSED';
}

/* Grafana's dark-theme values for the colour names above, for the standalone
 * viewer, which has no Grafana theme */
const NAMED: Record<string, string> = { blue: '#5794F2', purple: '#B877D9', orange: '#FF9830' };
const resolve = (c: string) => NAMED[c] ?? c;

/** A declared pause's label and colour, from its reason and whether anyone
 * intended it. An unknown reason is PAUSED. */
export function reasonDisplay(reason: string | undefined, intended: boolean | undefined): { label: string; color?: string } {
  if (intended === false) {return { label: unexpectedLabel(reason), color: resolve(UNEXPECTED_COLOR) };}
  const known = (reason && REASON_STYLES[reason]) || REASON_STYLES.paused;
  return known.color ? { label: known.label, color: resolve(known.color) } : { label: known.label };
}

/** A source's history with each declared pause given its label and colour,
 * where it doesn't already carry them. */
export function labelPauses<T extends Pick<SourceDecl, 'history'>>(decl: T): T {
  if (!decl.history?.some((h) => h.paused && !h.label)) {return decl;}
  const history: HistoryEvent[] = decl.history.map((h) =>
    h.paused && !h.label ? { ...h, ...reasonDisplay(h.reason, h.intended) } : h);
  return { ...decl, history };
}
