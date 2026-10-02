import type { Preview } from '../ui/preview';
import type { SourceZone, ZoneTexts } from '../zones/source';
import type { Backend, Frame, MountConfig, MountWindow, SourceDecl, SourceModel } from '../types';

/* One source's tile: its model, the frame it shows and the elements
 * setShown updates (all from buildTile's template). */
export interface Tile {
  decl: SourceDecl;
  model: SourceModel;
  el: HTMLDivElement;
  shown: Frame | null | undefined;   // the frame on the tile (click-in preview)
  shownExpected?: number | null;     // set: shown is the pending slot's ghost, for this tick
  zone: SourceZone;
  tt: ZoneTexts;
  img: HTMLImageElement;
  ts: HTMLElement;    // .t-ts: the timestamp
  off: HTMLElement;   // .t-off: offline / paused text
}

/* Everything one mountGrid call shares between its parts: what were the
 * closure variables of mountGrid, as one object. root through PANEL_TT
 * are fixed when the mount starts; the rest change as it runs. */
export interface GridState {
  root: HTMLElement;
  cfg: MountConfig;
  P: MountWindow;
  TZ: string;          // the resolved panel zone
  SPAN: number;
  LIVE: boolean;       // the window reaches (about) now: poll for frames
  backend: Backend;
  wrap: HTMLDivElement;
  pv: Preview;
  PANEL_TT: ZoneTexts;
  kiosks: SourceDecl[];         // the sources shown (after boot: those with a tile)
  tiles: Record<string, Tile>;  // by source id
  destroyed: boolean;
  pollTimer: ReturnType<typeof setInterval> | null;
  shownT: number | null;        // the crosshair time shown, or null for the latest frames
}
