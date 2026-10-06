import { axisTicks, pickTickStep, tickFormat } from '../time/ticks';
import { measureTickWidth } from '../time/measure';
import { q } from '../ui/wrapper';
import type { Slot } from '../types';
import type { TimelineState } from './state';

/* The time axis under the cards, and the hairlines that continue its ticks
 * across each strip's beyond-now spacer. */

/* Ticks and labels follow Grafana's own time series axis: the same steps,
 * spacing rule and label tiers (pickTickStep / tickFormat), and the host's
 * formatter when it passes one (the panel passes Grafana's). The axis has
 * no gutter, so a label that would be cut off at either end keeps its tick
 * mark but hides its text. */
export function buildAxis(s: TimelineState): void {
  const axis = q(s.wrap, '.axis');
  const w = axis.clientWidth;
  const { from, to } = s.P;
  const host = s.cfg.axisFormat;
  const tickStep = pickTickStep(from, to, w, (text) => measureTickWidth(axis, text), s.TZ, host);
  const fmt = tickFormat(tickStep, to - from, s.TZ, host);

  axis.querySelectorAll('.tick').forEach(t => t.remove());
  s.axisTickList.length = 0;
  s.axisLabels.length = 0;
  const placed: Array<{ el: HTMLElement; x: number }> = [];
  for (const ts of axisTicks(from, to, tickStep, s.TZ)) {
    s.axisTickList.push(ts);
    const el = document.createElement('div');
    el.className = 'tick';
    const x = ((ts - from) / s.SPAN) * w;
    el.style.left = x + 'px';
    el.textContent = fmt(ts);
    axis.appendChild(el);
    placed.push({ el, x });
  }
  // one read pass after all the writes (a single layout), then the classes
  const widths = placed.map(p => p.el.getBoundingClientRect().width);
  placed.forEach((p, i) => {
    const half = widths[i] / 2;
    if (p.x - half < 0 || p.x + half > w) {p.el.classList.add('edge');}
    else {s.axisLabels.push({ el: p.el, x: p.x, half });}
  });
}

/* The beyond-now spacer looks EMPTY, not black — the card's own surface,
 * ruled only by hairlines continuing the axis ticks (black is a signal in
 * a screenshot timeline; the future is the absence of signal). Re-run
 * whenever the spacer's geometry changes (poll carving/band growth). */
export function ruleBeyond(s: TimelineState, sl: Slot | null | undefined): void {
  if (!sl || !sl.beyond || !sl.el) {return;}
  sl.el.querySelectorAll('.bt').forEach(t => t.remove());
  for (const ts of s.axisTickList) {
    if (ts <= sl.ts || ts > sl.ts + sl.span) {continue;}
    const t = document.createElement('div');
    t.className = 'bt';
    t.style.left = (((ts - sl.ts) / sl.span) * 100).toFixed(3) + '%';
    sl.el.appendChild(t);
  }
}
export function ruleAllBeyond(s: TimelineState): void {
  for (const k of s.kiosks) {
    const c = s.cards[k.id];
    if (!c) {continue;}
    const last = c.model.slots[c.model.slots.length - 1];
    if (last && last.beyond) {ruleBeyond(s, last);}
  }
}
