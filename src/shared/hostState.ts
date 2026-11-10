/* Host state from any query (#126, M4): rows with a time, a host and a
 * state value, from whatever data source answered, become each host's state
 * spans. What a value means is not known here: its label and colour come
 * from the field's value mappings, as in Grafana's State timeline panel.
 * Two things end a span: an empty or null value, and a value mapped to the
 * colour "transparent", which is how a mapping says "this is the normal
 * state, draw nothing" (up, running, 1 ...). An end-time field closes a span
 * on its own row. */
import { colorManipulator, DataFrame, Field, FieldColorModeId, getDisplayProcessor, GrafanaTheme2 } from '@grafana/data';

import type { HistoryEvent, RawAnnotation } from '../vt/types';
import { fieldNamed, timeField, toMillis, ROLE_NAMES } from './frameRecords';

/** Which field plays which role in a state query. Empty: the usual names. */
export interface StateRoles {
  time?: string;
  host?: string;
  site?: string;
  state?: string;
  end?: string;
}

/** A state in force from `from` until `to` (open while undefined). */
export interface StateSpan {
  from: number;
  to?: number;
  /** The value as its mapping (or Grafana's formatting) shows it. */
  label: string;
  /** A CSS colour from the value's mapping, or undefined: no mapping colour. */
  color?: string;
  /** From a field set to "Pauses frames": the host deliberately sends no
   * frames while it lasts, so missing ones are explained, not offline. */
  pauses?: boolean;
}

export interface HostStates {
  id: string;
  site: string;
  spans: StateSpan[];
}

const STATE_NAMES = ['state', 'status'];
const END_NAMES = ['end', 'time_end', 'timeend', 'end_time'];

/* the colour an unmapped value gets for the lookup: a value whose display
 * colour is this one had no colour from a mapping */
const NO_COLOR = '#00000001';

/** Turns a state field's values into labels and colours, through its value
 * mappings. Exported for tests. */
export function stateDisplay(field: Field, theme: GrafanaTheme2): (v: unknown) => { label: string; color?: string; clear: boolean } {
  const probe: Field = {
    ...field,
    config: { ...field.config, color: { mode: FieldColorModeId.Fixed, fixedColor: NO_COLOR } },
  };
  const display = getDisplayProcessor({ field: probe, theme });
  const transparent = theme.visualization.getColorByName('transparent');
  return (v) => {
    if (v == null || v === '') {return { label: '', clear: true };}
    const d = display(v);
    const color = d.color && d.color !== NO_COLOR ? d.color : undefined;
    if (color === 'transparent' || color === transparent) {return { label: d.text, clear: true };}
    return { label: d.text, color, clear: false };
  };
}

/** Each host's state spans from a query result, or null when no frame in it
 * is a state query: a time, a state field and no image field. */
export function statesFromSeries(series: DataFrame[] | undefined, theme: GrafanaTheme2, roles: StateRoles = {}): HostStates[] | null {
  type Row = { ts: number; end?: number; label: string; color?: string; clear: boolean; pauses: boolean };
  const byHost = new Map<string, { id: string; site: string; rows: Row[] }>();
  let found = false;
  for (const frame of series || []) {
    // a frame of images is frames, not state, even if it has a status column
    if (fieldNamed(frame, undefined, ROLE_NAMES.image)) {continue;}
    const state = fieldNamed(frame, roles.state, STATE_NAMES);
    const time = timeField(frame, roles.time);
    if (!state || !time || state === time) {continue;}
    found = true;
    const host = fieldNamed(frame, roles.host, ROLE_NAMES.host);
    const site = fieldNamed(frame, roles.site, ROLE_NAMES.site);
    const end = fieldNamed(frame, roles.end, END_NAMES);
    const show = stateDisplay(state, theme);
    const pauses = state.config?.custom?.pausesFrames === true;
    const fallbackHost = state.labels?.host ?? frame.name ?? frame.refId ?? 'host';
    const fallbackSite = state.labels?.site ?? '';
    for (let i = 0; i < frame.length; i++) {
      const ts = toMillis(time.values[i]);
      if (ts == null) {continue;}
      const id = String(host ? host.values[i] ?? '' : fallbackHost);
      if (!id) {continue;}
      const siteId = String(site ? site.values[i] ?? '' : fallbackSite);
      const key = siteId + '/' + id;
      let rec = byHost.get(key);
      if (!rec) {
        rec = { id, site: siteId, rows: [] };
        byHost.set(key, rec);
      }
      const e = end ? toMillis(end.values[i]) : null;
      rec.rows.push({ ts, ...(e != null && e > ts ? { end: e } : {}), ...show(state.values[i]), pauses });
    }
  }
  if (!found) {return null;}
  return [...byHost.values()].map((h) => ({ id: h.id, site: h.site, spans: spansFrom(h.rows) }));
}

/* Rows in time order become spans: each state runs until its own end time,
 * the next row, or (the last one) on. A clearing row only ends what came
 * before it. Consecutive rows of the same label and colour are one span. */
function spansFrom(rows: Array<{ ts: number; end?: number; label: string; color?: string; clear: boolean; pauses: boolean }>): StateSpan[] {
  rows.sort((a, b) => a.ts - b.ts);
  const spans: StateSpan[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const open = spans[spans.length - 1];
    if (open && open.to === undefined) {open.to = r.ts;}
    if (r.clear) {continue;}
    const to = r.end;
    const prev = spans[spans.length - 1];
    if (prev && prev.to === r.ts && prev.label === r.label && prev.color === r.color && !!prev.pauses === r.pauses) {
      prev.to = to;   // the same state again: carry on
      continue;
    }
    spans.push({ from: r.ts, ...(to !== undefined ? { to } : {}), label: r.label, ...(r.color ? { color: r.color } : {}), ...(r.pauses ? { pauses: true } : {}) });
  }
  return spans;
}

/** A host's declaration with the pause states from a state query in place
 * of any pauses it declared itself: each pause span becomes a paused history
 * event, and its end a resume at the pace in force. Cadence events stay. */
export function withPauseStates<T extends { history?: HistoryEvent[] }>(decl: T, spans: StateSpan[]): T {
  const pauses = spans.filter((s) => s.pauses);
  if (!pauses.length) {return decl;}
  const history: HistoryEvent[] = (decl.history || []).filter((h) => !h.paused);
  for (const p of pauses) {
    history.push({ since: p.from, paused: true, label: p.label, ...(p.color ? { color: p.color } : {}) });
    if (p.to !== undefined) {history.push({ since: p.to });}
  }
  history.sort((a, b) => a.since - b.since);
  return { ...decl, history };
}

/** States that run alongside the frames (not "Pauses frames"), as region
 * annotations pinned to their host (host:<id>, and site:<id> when there is
 * one): the timeline draws them where it draws annotations, on the host's
 * strip and in its lane, so an interesting span from a state query reads
 * like one from an annotation query (#126, M4b). A state still open runs to
 * `until` (now, or the window's end). Spans outside [from, until] are left
 * out. */
export function stateAnnotations(hosts: HostStates[], from: number, until: number): RawAnnotation[] {
  const out: RawAnnotation[] = [];
  for (const h of hosts) {
    for (const sp of h.spans) {
      if (sp.pauses) {continue;}
      const end = sp.to ?? until;
      if (end < from || sp.from > until || end <= sp.from) {continue;}
      out.push({
        ts: sp.from,
        timeEnd: end,
        title: sp.label,
        text: '',
        tags: ['host:' + h.id, ...(h.site ? ['site:' + h.site] : []), 'state'],
        // regions tint with the colour plus an alpha suffix: it must be hex
        ...(sp.color ? { color: colorManipulator.asHexString(sp.color) } : {}),
      });
    }
  }
  return out;
}
