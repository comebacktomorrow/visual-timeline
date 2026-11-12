/* The preview player's remembered choices (player.ts): how the scrubber
 * draws, the frame rate, HD and sound, kept in localStorage across previews
 * and panels. */

export type ScrubStyle = 'ticks' | 'thumbs';

export interface Prefs { style: ScrubStyle; fps: number; hd: boolean; muted: boolean }

const PREFS_KEY = 'ktl-player';
/** the frame rates the speed button steps through */
export const FPS = [1, 2, 4, 8, 16];
/** a slot's video: its speed, from what fits it into a few seconds
 * (Reel.videoRate) to the viewer's choice of these */
export const SPEEDS = [0.25, 0.5, 1, 2, 4, 8, 16];
export const fmtRate = (r: number) => (r === 0.25 ? '¼' : r === 0.5 ? '½' : String(Math.round(r * 10) / 10)) + '×';

/** The viewer's last choices; `style` (the panel's default) when none. */
export function loadPrefs(style: ScrubStyle = 'ticks'): Prefs {
  const base: Prefs = { style, fps: 4, hd: true, muted: true };
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    return {
      style: p.style === 'thumbs' || p.style === 'ticks' ? p.style : base.style,
      fps: FPS.includes(p.fps) ? p.fps : base.fps,
      hd: typeof p.hd === 'boolean' ? p.hd : base.hd,
      muted: typeof p.muted === 'boolean' ? p.muted : base.muted,
    };
  } catch { return base; }
}
export function savePrefs(p: Prefs): void {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* private mode: the choice lasts this preview */ }
}
