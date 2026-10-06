import type { AxisFormatter } from './time/ticks';
/* Shared shapes of the Visual Timeline core: what the frames API (and the
 * built-in demo backend) hands over, and the per-source model the timeline
 * and grid render from. Types only: no runtime code. Field sets follow what
 * the core reads and writes; docs/API.md is the wire contract. */

/* A query window (a mount's P), epoch ms. The mounts' P also carries the
 * site/source filters. Not `Window`: that is the DOM's global. */
export interface TimeWindow {
  from: number;
  to: number;
}

/* One entry of a source's registry history: a CADENCE EVENT (see erasFor).
 * A cadence entry starts a new pace, a paused entry starts declared silence,
 * an entry with neither ends a pause at the pace in force. */
export interface HistoryEvent {
  since: number;
  variant?: string; // 'lo' | 'hi'; missing means 'lo'
  cadence?: number;
  paused?: boolean;
  reason?: string;
  intended?: boolean;
}

/* A source as GET /sources returns it (and the demo backend builds it). */
export interface SourceDecl {
  id: string;
  site: string;
  location?: string;
  tags?: Record<string, string>;
  cadence: number;
  hiCadence?: number;
  history?: HistoryEvent[];
  timezone?: string; // only when the source declared one (X-Timezone)
}

/* One lo-variant frame from GET /frames. The API names its source
 * `source`; the demo backend writes `kiosk`. The core reads ts and url. */
export interface Frame {
  ts: number;
  url: string;
  source?: string;
  kiosk?: string;
}

/* A span of a source's window on one grid (erasFor). reason and intended
 * are always present, undefined when the event that opened the era carried
 * none. */
export interface Era {
  from: number;
  to: number;
  cadence: number;
  paused: boolean;
  reason: string | undefined;
  intended: boolean | undefined;
}

/* The data layer both mounts read through: the API backend (makeApiBackend)
 * or the demo one. The demo's kiosks() answers synchronously. */
export interface Backend {
  kiosks(sites?: string[] | null): Promise<SourceDecl[]> | SourceDecl[];
  frames(site: string, id: string, from: number, to: number, step: number): Promise<Frame[]>;
  /* demo seam only; raw annotations, normalized by normAnnotations */
  annotations?(): RawAnnotation[];
}

/* An annotation as a provider hands it over (the panel's flattened
 * annotation frames, the demo seam, a host page): loosely typed, since
 * normAnnotations coerces and validates every field. `time` is an alias of
 * `ts`; `tags` is an array or a comma list. */
export interface RawAnnotation {
  ts?: number | string | null;
  time?: number | string | null;
  timeEnd?: number | string | null;
  title?: string;
  text?: string;
  tags?: unknown;
  color?: string;
  source?: string | null;
}
/* a normalized annotation (normAnnotations): timeEnd set only for a region;
 * source / siteScope from a source:/kiosk: or site: tag (or `source`) */
export interface Annotation {
  ts: number;
  timeEnd: number | null;
  title: string;
  text: string;
  tags: string[];
  color: string;
  source: string | null;
  siteScope: string | null;
}

/* the injected transport (Grafana: the data source proxy) and what it
 * resolves to: the parts of a fetch Response the API backend uses */
export interface ApiResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}
export type ApiFetch = (path: string) => Promise<ApiResponse>;

/* ---- slots: one flat list across a source's eras (buildSourceModel) ----
 * Every slot has a time span (its width on the strip). The kinds are told
 * apart by `paused` / `beyond`: a tick slot has neither. `el` is the slot's
 * strip element, set by the DOM layer once it renders the slot. */
interface SlotBase {
  ts: number;
  span: number;
  el?: HTMLElement;
}
/* a grid tick of an active era: centered on ts; its frame, or pending
 * (`future`) until a step past its tick, else offline */
export interface TickSlot extends SlotBase {
  frame: Frame | null;
  cadence: number;
  step: number;
  future: boolean;
  paused?: undefined;
  beyond?: undefined;
}
/* a declared pause band: [ts, ts + span) */
export interface PauseSlot extends SlotBase {
  paused: true;
  reason?: string;
  intended?: boolean;
  beyond?: undefined;
  frame?: undefined;
  future?: undefined;
  step?: undefined;
}
/* the one inert spacer past now: [ts, ts + span) */
export interface BeyondSlot extends SlotBase {
  beyond: true;
  paused?: undefined;
  frame?: undefined;
  future?: undefined;
  step?: undefined;
}
export type Slot = TickSlot | PauseSlot | BeyondSlot;

/* what buildSourceModel returns */
export interface SourceModel {
  eras: Era[];
  slots: Slot[];
  slotAt(t: number): Slot | null;
  lastActive: TickSlot | null;
}

/* ---- mounts (mountTimeline, mountGrid) ---- */

/* A mount's window: the query window plus the site/source variables, parsed
 * (parseVar: null selects all) */
export interface MountWindow extends TimeWindow {
  site: string[] | null;
  source: string[] | null;
}

/* What a host passes to mountTimeline / mountGrid: every cfg field either
 * mount reads. The string options are typed loosely (hosts pass whatever
 * their option holds); the comments give the values the mounts act on. */
export interface MountConfig {
  from: number;
  to: number;
  site?: string | null;        // a Grafana variable value: 'a,b', '{a,b}', 'All', '$__all'
  source?: string | null;
  tagFilter?: string | null;   // "env=prod, room=lobby"
  hideEmpty?: boolean;
  timeZone?: string;           // IANA name, 'utc', or undefined/'browser'
  thumbTimes?: string;         // 'panel' (default) | 'source'
  width?: number;              // host width in px; web mounts measure the root
  fit?: string;                // 'fill' crops frames to cover; anything else fits
  headerMode?: string;         // 'bar' (default) | 'inline' | 'inline-gradient'
  showDetails?: boolean;       // timeline: the cadence chip
  apiUrl?: string;
  apiKey?: string;
  apiFetch?: ApiFetch;
  authHint?: string;           // appended to a token error's message (the panel: how to connect)
  axisFormat?: AxisFormatter;  // timeline: the host's axis label formatter (the panel: Grafana's)
  annotations?: RawAnnotation[];   // timeline: host annotations (else the demo seam's)
  showAnnotations?: boolean;       // timeline: false hides them
  annotationLanes?: string;        // timeline: 'shared' (default) | 'per-source'
  onHover?: (t: number) => void;               // timeline: a local hover moved the cursor
  onHoverClear?: () => void;                   // timeline: the mouse left a strip
  onCursor?: (t: number) => void;              // timeline: every cursor move (host chrome)
  onZoom?: (from: number, to: number) => void; // timeline: drag-select released
  onShown?: (t: number | null) => void;        // grid: shown time changed (null = latest)
}

/* What both mounts return. The timeline has isHovering, the grid
 * clearExternal. */
export interface MountInstance {
  setExternalCursor(t: number): void;
  isHovering?(): boolean;
  clearExternal?(): void;
  destroy(): void;
}
