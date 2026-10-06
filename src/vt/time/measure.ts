/* Axis label metrics: the width a tick label renders at, measured with a
 * hidden .tick in the axis itself, so the measurement uses exactly the
 * font, size and tabular digits the labels are drawn with. (A canvas
 * measurement drifted from the CSS once: it measured 10 px text while the
 * labels rendered at 12 px, and narrow axes overlapped.) */
export function measureTickWidth(axis: HTMLElement, text: string): number {
  const probe = document.createElement('div');
  probe.className = 'tick';
  probe.style.visibility = 'hidden';
  probe.textContent = text;
  axis.appendChild(probe);
  const w = probe.getBoundingClientRect().width;
  probe.remove();
  return w;
}
