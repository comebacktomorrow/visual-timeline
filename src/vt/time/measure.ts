/* Axis label metrics: the width a tick label renders at, measured on a
 * shared offscreen canvas (one per document). buildAxis sizes its tick step
 * from it. */
export const TICK_FONT = '10px -apple-system, "Segoe UI", Roboto, sans-serif';
export const TICK_LABEL_GAP = 14;
let measureCtx: CanvasRenderingContext2D | null | undefined;

export function measureTickWidth(text: string): number {
  if (!measureCtx) {measureCtx = document.createElement('canvas').getContext('2d');}
  // the canvas's 2d context (the code never handled a null one)
  measureCtx!.font = TICK_FONT;
  return measureCtx!.measureText(text).width;
}
