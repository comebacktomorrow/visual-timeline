import type { Backend, MountConfig, SourceDecl, SourceModel, TimeWindow } from '../types';
import type { ZoneTexts } from '../zones/source';
import type { PlayerContext } from './player';

/* The most buckets one player fetch asks an API for (the reference worker
 * caps a request at 800). */
const PLAYER_BUCKETS = 800;

/** A host's preview player context, for a mount: its frames at full
 * resolution (every one a records backend holds; an API's at the host's own
 * cadence), its intervals by its promise, and the mount's crosshair. */
export function playerContext(
  backend: Backend, cfg: MountConfig, P: TimeWindow, decl: SourceDecl, model: SourceModel, tt: ZoneTexts, onTime: (t: number) => void
): PlayerContext {
  return {
    window: { from: P.from, to: P.to },
    step: model.step,
    tt,
    fetch: (from, to) => backend.allFrames
      ? backend.allFrames(decl.site, decl.id, from, to)
      : backend.frames(decl.site, decl.id, from, to, Math.max(model.lastActive?.cadence ?? model.step, Math.ceil((to - from) / PLAYER_BUCKETS))),
    intervals: (frames, range) => model.intervalsFor(frames, range, Date.now()),
    onTime,
    reach: cfg.playerReach === 'all' ? 'all' : cfg.playerReach === 'near' ? 'near' : undefined,
    scrubber: cfg.playerScrubber === 'thumbs' ? 'thumbs' : cfg.playerScrubber === 'ticks' ? 'ticks' : undefined,
  };
}
