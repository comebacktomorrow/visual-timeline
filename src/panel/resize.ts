/** The core's view scales with the panel (flex slots, percentage axis and
 * annotations), so a small width change needs no rebuild: only one big
 * enough that the slot count or the axis's label spacing should change. 5%
 * keeps shrunk labels from touching (they're spaced by their width plus
 * 18 px) and is more than a scrollbar appearing (about 16 px) costs any
 * panel wider than about 320 px. */
const REBUILD_WIDTH_CHANGE = 0.05;
export function needsRebuild(builtWidth: number, width: number): boolean {
  if (!builtWidth || !width) {
    return builtWidth !== width;
  }
  return Math.abs(width - builtWidth) / builtWidth > REBUILD_WIDTH_CHANGE;
}
