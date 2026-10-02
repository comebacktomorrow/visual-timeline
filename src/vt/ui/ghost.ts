import { ghostFor } from '../model/slots';
import type { Slot } from '../types';

/* keep a strip slot's ghost <img> in step with its state: present only
 * while the slot is pending and has something to carry */
export function dressGhost(slots: Slot[], sl: Slot): void {
  if (!sl.el) {return;}
  const g = sl.future && !sl.frame ? ghostFor(slots, sl) : null;
  let img = sl.el.querySelector<HTMLImageElement>('img.ghost');
  if (!g) { if (img) {img.remove();} return; }
  if (!img) { img = document.createElement('img'); img.className = 'ghost'; img.alt = ''; sl.el.appendChild(img); }
  if (img.src !== g.url) {img.src = g.url;}
}
