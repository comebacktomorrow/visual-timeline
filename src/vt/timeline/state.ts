import type { Preview } from '../ui/preview';
import type { SourceZone, ZoneTexts } from '../zones/source';
import type { Backend, MountConfig, MountWindow, SourceDecl, SourceModel } from '../types';

/* One source's card: its model and the elements setCursor and the poll
 * update (all from buildCard's template). */
export interface Card {
  card: HTMLDivElement;
  model: SourceModel;
  zone: SourceZone;
  tt: ZoneTexts;     // the time text its captions use (zoneFor)
  head: HTMLElement; // .ft: the header's status text
  strip: HTMLElement;
  cross: HTMLElement;
  sel: HTMLElement;
  mag: HTMLElement;
  lane: HTMLElement;
}

/* Everything one mountTimeline call shares between its parts: what were
 * the closure variables of mountTimeline, as one object. root through
 * PANEL_TT are fixed when the mount starts; the rest change as it runs. */
/* a visible axis label: its element, centre and half-width in px */
export interface AxisLabel {
  el: HTMLElement;
  x: number;
  half: number;
}

export interface TimelineState {
  root: HTMLElement;
  cfg: MountConfig;
  P: MountWindow;
  TZ: string;          // the resolved panel zone
  SPAN: number;        // P.to - P.from, at least 1
  LIVE: boolean;       // the window reaches (about) now: poll for frames
  hostWidth: number;
  pxBudget: number;    // slots per source (buildSourceModel's budget)
  backend: Backend;
  wrap: HTMLDivElement;
  pv: Preview;
  PANEL_TT: ZoneTexts;
  kiosks: SourceDecl[];         // the sources shown (after boot: those with a card)
  cards: Record<string, Card>;  // by source id
  cursorT: number;
  destroyed: boolean;
  pollTimer: ReturnType<typeof setInterval> | null;
  axisTickList: number[];       // filled by buildAxis; consumed by ruleBeyond
  axisLabels: AxisLabel[];      // filled by buildAxis; setCursor hides the one under the cursor tag
  suppressClick: boolean;       // a drag-zoom just ended: swallow its click
}
