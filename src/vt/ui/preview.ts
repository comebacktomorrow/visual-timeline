import { copyVars } from '../dom/styles';
import { zoneTexts, type ZoneTexts } from '../zones/source';
import type { Frame } from '../types';
import { mountPlayer, type PlayerContext } from './player';

/* a mount's handle on the shared preview. open(): expectedTs set = frame is
 * the pending slot's ghost; tt is the source's time text (the panel's when
 * omitted); hiUrl, when set, is tried first and falls back to frame.url */
export interface Preview {
  open(
    site: string, kiosk: string, frame: Frame, x: number, y: number,
    hiUrl: string | null, expectedTs: number | null, tt?: ZoneTexts, player?: PlayerContext
  ): void;
  close(): void;
  retire(): void;
}

/* cursor-anchored larger preview (not full-screen), shared by both modes.
 * Shows the frame at native upload resolution — capture size is the only
 * quality knob; no separate hi-res fetch. Esc / click dismisses. */
/* Click-in preview. ONE per document, leased across the double-buffered
 * remounts a dashboard refresh causes: destroy() RETIRES it (delayed close)
 * and the successor mount adopts it by cancelling that close — so an open
 * preview survives refresh ticks instead of vanishing mid-inspection. A
 * real unmount (navigating away) has no successor, and the delayed close
 * fires. */
interface PopState {
  el: HTMLDivElement | null;
  keyH: ((e: KeyboardEvent) => void) | null;
  downH: ((e: PointerEvent) => void) | null;
  teardown: (() => void) | null;
  retireTimer: ReturnType<typeof setTimeout> | null;
  keyCapture?: boolean;
}
const popState: PopState = { el: null, keyH: null, downH: null, teardown: null, retireTimer: null };
function closePreview(): void {
  if (popState.retireTimer) { clearTimeout(popState.retireTimer); popState.retireTimer = null; }
  if (popState.teardown) { popState.teardown(); popState.teardown = null; }
  if (popState.el) { popState.el.remove(); popState.el = null; }
  if (popState.keyH) {
    if (popState.keyCapture) {window.removeEventListener('keydown', popState.keyH, true);}
    else {document.removeEventListener('keydown', popState.keyH);}
    popState.keyH = null;
    popState.keyCapture = false;
  }
  if (popState.downH) { document.removeEventListener('pointerdown', popState.downH, true); popState.downH = null; }
}
export function makePreview(root: HTMLElement, tz: string): Preview {
  // adopt: a mount created while a retire is pending cancels the close
  if (popState.retireTimer) { clearTimeout(popState.retireTimer); popState.retireTimer = null; }
  const panelTexts = zoneTexts(tz, tz, false);
  return {
    // expectedTs set = frame is the pending slot's ghost: shown blurred and
    // captioned as the last frame, never as the expected one. tt: the
    // source's time text (zoneTexts), the panel's when omitted
    open(site, kiosk, frame, x, y, hiUrl, expectedTs, tt, player) {
      tt = tt || panelTexts;
      closePreview();
      if (player && !expectedTs) { openPlayer(root, site, kiosk, frame, x, y, { ...player, tt, label: site ? site + ' / ' + kiosk : kiosk }); return; }
      const el = document.createElement('div');
      el.className = 'ktl-pop' + (expectedTs ? ' ghost' : '');
      copyVars(root, el);
      el.innerHTML = '<img alt="frame"><div class="cap"></div>';
      // both are in the markup just set
      const img = el.querySelector('img')!;
      el.querySelector('.cap')!.textContent = (site ? site + ' / ' : '') + kiosk + ' — ' + (expectedTs
        ? 'expected ' + tt.short(expectedTs) + ' · last frame ' + tt.time(frame.ts)
        : tt.time(frame.ts)) + tt.sfx(frame.ts);
      el.addEventListener('click', closePreview);
      document.body.appendChild(el);
      const place = () => {
        if (!el.isConnected) {return;}
        const r = el.getBoundingClientRect();
        el.style.left = Math.max(8, Math.min(window.innerWidth - r.width - 8, x + 14)) + 'px';
        el.style.top = Math.max(8, Math.min(window.innerHeight - r.height - 8, y - r.height / 2)) + 'px';
      };
      img.onload = place;
      img.onerror = () => { img.onerror = null; img.src = frame.url; };  // hi 404 → lo
      img.src = hiUrl || frame.url;
      place();
      popState.el = el;
      popState.keyH = e => { if (e.key === 'Escape') {closePreview();} };
      document.addEventListener('keydown', popState.keyH);
    },
    close: closePreview,
    retire() {
      // destroy() path: don't kill an open preview a refresh remount is
      // about to adopt; no successor within the grace = real unmount
      if (popState.el && !popState.retireTimer) {
        popState.retireTimer = setTimeout(closePreview, 1500);
      }
    },
  };
}

/* The preview as a player (M10): it stays open while it's used, and closes
 * on its close button, Esc, or a press outside it. */
function openPlayer(root: HTMLElement, site: string, kiosk: string, frame: Frame, x: number, y: number, ctx: PlayerContext): void {
  const el = document.createElement('div');
  el.className = 'ktl-pop';
  copyVars(root, el);
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', site ? site + ' / ' + kiosk : kiosk);
  document.body.appendChild(el);
  let placed = false;
  const place = () => {
    if (!el.isConnected) {return;}
    const r = el.getBoundingClientRect();
    // anchored once, near the click: it doesn't jump as frames change size
    if (placed && r.right <= window.innerWidth && r.bottom <= window.innerHeight) {return;}
    placed = true;
    el.style.left = Math.max(8, Math.min(window.innerWidth - r.width - 8, x - r.width / 2)) + 'px';
    el.style.top = Math.max(8, Math.min(window.innerHeight - r.height - 8, y + 16)) + 'px';
  };
  popState.teardown = mountPlayer(el, frame, ctx, place, closePreview);
  el.querySelector('button[data-a="close"]')?.addEventListener('click', closePreview);
  place();
  popState.el = el;
  // Esc closes the player, and only the player: caught before Grafana's own
  // Esc (leave panel view, kiosk mode) sees it
  popState.keyH = (e) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); closePreview(); } };
  window.addEventListener('keydown', popState.keyH, true);
  popState.keyCapture = true;
  // a press outside closes it (capture: before anything under it reacts)
  popState.downH = (e) => { if (!el.contains(e.target as Node)) {closePreview();} };
  setTimeout(() => {
    if (popState.el === el && popState.downH) {document.addEventListener('pointerdown', popState.downH, true);}
  }, 0);
}
