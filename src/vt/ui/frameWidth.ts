import type { MountConfig } from '../types';

/** The least width a frame gets wherever it's drawn, by default: the
 * strip's slots and the preview player's ticks (the panel's Frame width). */
export const FRAME_WIDTH = 7;
export const FRAME_WIDTH_MIN = 3;
export const FRAME_WIDTH_MAX = 48;

/** A mount's frame width, within bounds. */
export function frameWidthOf(cfg: Pick<MountConfig, 'frameWidth'>): number {
  const w = Number(cfg.frameWidth);
  return Number.isFinite(w) && w > 0 ? Math.max(FRAME_WIDTH_MIN, Math.min(FRAME_WIDTH_MAX, Math.round(w))) : FRAME_WIDTH;
}
