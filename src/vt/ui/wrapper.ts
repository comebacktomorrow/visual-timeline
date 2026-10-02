/* Double-buffered remounts. A dashboard refresh tears the panel down and
 * rebuilds it; wiping the root first paints a blank frame (visible flash
 * every refresh tick). Instead each mount builds into its own HIDDEN
 * wrapper and swaps it in once its images have decoded — the previous
 * wrapper stays painted until then. destroy() only marks its wrapper
 * stale; the successor removes it (timeout fallback for true unmounts). */
export function makeWrapper(root: HTMLElement): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.className = 'ktl';
  // absolute stacking + visibility (NOT display:none): the wrapper must
  // have real layout while hidden — axis ticks, crosshair and magnifier
  // positions are measured from clientWidth during build
  root.style.position = 'relative';
  root.classList.add('ktl-root');   // carries the palette defaults (CSS)
  wrap.style.position = 'absolute';
  wrap.style.inset = '0';
  wrap.style.visibility = 'hidden';
  root.appendChild(wrap);
  return wrap;
}
export async function revealWrapper(root: HTMLElement, wrap: HTMLElement): Promise<void> {
  const imgs = [...wrap.querySelectorAll('img')];
  await Promise.race([
    Promise.allSettled(imgs.map(i => (i.decode ? i.decode().catch(() => {}) : Promise.resolve()))),
    new Promise(res => setTimeout(res, 900)),
  ]);
  if (!wrap.isConnected) {return;}
  for (const el of [...root.children]) {if (el !== wrap) {el.remove();}}
  wrap.style.visibility = '';
}
export function retireWrapper(wrap: HTMLElement): void {
  wrap.dataset.stale = '1';
  setTimeout(() => wrap.remove(), 1500);
}
/* one of a mount wrapper's own elements, by selector. The mounts only ask
 * for elements their wrapper template (innerHTML) always has, so the result
 * is asserted non-null. */
export function q<E extends Element = HTMLElement>(wrap: ParentNode, sel: string): E {
  return wrap.querySelector<E>(sel)!;
}
