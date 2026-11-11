import type { AxisFormatter } from './time/ticks';
import type { HoldLimit, Interval } from './model/intervals';
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
  /* what a pause says about itself when it comes from a state query (#126):
   * its label and colour from the value mappings, in place of a reason */
  label?: string;
  color?: string;
}

/* A source as GET /sources returns it (and the demo backend builds it). */
export interface SourceDecl {
  id: string;
  site: string;
  location?: string;
  tags?: Record<string, string>;
  cadence: number;
  /* the cadence is only the typical gap between frames, worked out from
   * them, not one the source declared: its frames make no promise
   * (docs/TIMELINE-MODEL.md) */
  inferred?: boolean;
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
  /* the larger image for the click-in preview, when the source gives one:
   * a preview field in frame records (#126), or the API's url_hi (#129) */
  hi?: string;
  /* the promise this frame makes: the next frame within this many ms
   * (docs/TIMELINE-MODEL.md); unset, the source's declaration decides */
  cadence?: number;
  /* how many frames this one stands for, when a data source thinned them
   * (a frame_count field); unset, one */
  count?: number;
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
  label?: string;
  color?: string;
}

/* The data layer both mounts read through: the API backend (makeApiBackend)
 * or the demo one. The demo's kiosks() answers synchronously. */
export interface Backend {
  kiosks(sites?: string[] | null): Promise<SourceDecl[]> | SourceDecl[];
  frames(site: string, id: string, from: number, to: number, step: number): Promise<Frame[]>;
  /* every frame in [from, to], unthinned: a backend that holds them all
   * (frame records) offers it, for the preview player (M10) */
  allFrames?(site: string, id: string, from: number, to: number): Promise<Frame[]>;
  /* one short span's frames, asking for them again if need be (the panel
   * re-runs its query for the span): what the preview player and the hover
   * flipbook play (M10). At most maxPoints, as a source thins them (each
   * kept frame's count says how many it stands for); unset, all of them */
  detail?(site: string, id: string, from: number, to: number, maxPoints?: number): Promise<Frame[]>;
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

/* ---- slots: a host's intervals sampled for the strip (buildSourceModel) ----
 * The slots tile the window in order: each covers [x0, x0 + span), its
 * width on the strip. The kinds are told apart by `paused` / `beyond`: a
 * tick slot has neither. `el` is the slot's strip element, set by the DOM
 * layer once it renders the slot (slots showing the same frame share one). */
interface SlotBase {
  ts: number;
  x0: number;
  span: number;
  el?: HTMLElement;
}
/* a sample of an active stretch at its tick `ts`: the frame it shows (one
 * taken within the slot, else the one in force at the tick), or pending
 * (`future`: the live edge's promise is due), dropped (a broken promise:
 * offline) or no data (`nodata`: nothing promised) */
export interface TickSlot extends SlotBase {
  frame: Frame | null;
  /* the promise in force, or the typical gap for a source with none */
  cadence: number;
  step: number;
  future: boolean;
  nodata?: boolean;
  /* how many frames were taken within the slot (more than one: a slot to
   * play through) */
  count: number;
  /* kept so code that tests it still reads; the interval model never holds */
  held?: undefined;
  paused?: undefined;
  beyond?: undefined;
}
/* a declared pause band: [ts, ts + span) */
export interface PauseSlot extends SlotBase {
  paused: true;
  held?: undefined;
  reason?: string;
  intended?: boolean;
  label?: string;
  color?: string;
  beyond?: undefined;
  frame?: undefined;
  future?: undefined;
  step?: undefined;
  nodata?: undefined;
}
/* the one inert spacer past now: [ts, ts + span) */
export interface BeyondSlot extends SlotBase {
  beyond: true;
  paused?: undefined;
  frame?: undefined;
  future?: undefined;
  step?: undefined;
  held?: undefined;
  nodata?: undefined;
}
export type Slot = TickSlot | PauseSlot | BeyondSlot;

/* a stretch of dropped time inside slots that show a frame: drawn at its
 * true place, so an outage shorter than a slot still shows */
export interface DropMark {
  from: number;
  to: number;
}

/* what buildSourceModel returns: rebuilt in place by refresh() as the live
 * poll brings frames and time passes */
export interface SourceModel {
  eras: Era[];
  /* the slot duration: the step frames are fetched and sampled at */
  step: number;
  /* whether the source's cadence is a promise (not inferred) */
  promised: boolean;
  /* every frame fetched, in time order */
  frames: Frame[];
  intervals: Interval[];
  slots: Slot[];
  drops: DropMark[];
  slotAt(t: number): Slot | null;
  intervalAt(t: number): Interval | null;
  lastActive: TickSlot | null;
  /* add frames (the live poll's) and rebuild for `now` */
  refresh(fresh: Frame[], now: number): void;
  /* intervals for other frames over another range, by this host's promise,
   * pauses and hold (the preview player's scrubber) */
  intervalsFor(frames: Frame[], window: TimeWindow, now: number, exact?: boolean): Interval[];
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
  /* the host's own data layer (the Grafana panel: sources from its query
   * result, frames through its data source). When set it is used as is:
   * apiUrl/apiKey/apiFetch are ignored, and the host has already applied any
   * site and tag filtering. */
  backend?: Backend;
  authHint?: string;           // appended to a token error's message (the panel: how to connect)
  axisFormat?: AxisFormatter;  // timeline: the host's axis label formatter (the panel: Grafana's)
  annotations?: RawAnnotation[];   // timeline: host annotations (else the demo seam's)
  showAnnotations?: boolean;       // timeline: false hides them
  annotationLanes?: string;        // timeline: 'shared' (default) | 'per-source'
  /* how long a frame that makes no promise is shown when no frame follows
   * it soon: 'auto' (default), 'none' (until the next frame) or ms */
  hold?: HoldLimit;
  /* a promise for every host (ms), whatever its source says: the panel's
   * Expected cadence (docs/TIMELINE-MODEL.md); unset, the sources decide */
  expectedCadence?: number;
  /* the interval the host's queries were asked for at (ms; Grafana's
   * $__interval): a source may answer one frame per it, so promises are
   * judged no finer */
  sampleInterval?: number;
  /* the preview player's default scrubber style (a viewer's own last choice
   * wins): 'ticks' (default) or 'thumbs' */
  playerScrubber?: string;
  onHover?: (t: number) => void;               // timeline: a local hover moved the cursor
  onHoverClear?: () => void;                   // timeline: the mouse left a strip
  onCursor?: (t: number) => void;              // timeline: every cursor move (host chrome)
  onZoom?: (from: number, to: number) => void; // timeline: drag-select released
  onShown?: (t: number | null) => void;        // grid: shown time changed (null = latest)
  onFilter?: (key: string, value: string, host?: string) => void; // a header chip was clicked: its key (host, site, location or a tag key), value, and the host whose header it is
  /* which header chips, in order: "site", "location" or tag keys; unset: the
   * site (with the location) and every tag */
  chips?: string[];
}

/* What both mounts return. The timeline has isHovering, the grid
 * clearExternal. */
export interface MountInstance {
  setExternalCursor(t: number): void;
  isHovering?(): boolean;
  clearExternal?(): void;
  destroy(): void;
}
