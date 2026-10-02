import { axisTicks, TICK_STEPS, tickFormat } from '../time/ticks';
import { measureTickWidth, TICK_LABEL_GAP } from '../time/measure';
import { q } from '../ui/wrapper';
import type { Slot } from '../types';
import type { TimelineState } from './state';

/* The time axis under the cards, and the hairlines that continue its ticks
 * across each strip's beyond-now spacer. */

export function buildAxis(s: TimelineState): void {
  const axis = q(s.wrap, '.axis');
  const w = axis.clientWidth;

  // pass 1: rough step from a flat guess, just to pick a representative
  // label to measure (mirrors Grafana's calculateSpace bootstrap)
  const roughMaxTicks = Math.max(3, Math.floor(w / 90));
  const roughStep = TICK_STEPS.find(st => s.SPAN / st <= roughMaxTicks) || TICK_STEPS[TICK_STEPS.length - 1];
  const sampleWidth = measureTickWidth(tickFormat(roughStep, s.TZ)(s.P.to));

  // pass 2: real step, sized to the label width that will actually render
  const maxTicks = Math.max(3, Math.floor(w / (sampleWidth + TICK_LABEL_GAP)));
  const tickStep = TICK_STEPS.find(st => s.SPAN / st <= maxTicks) || TICK_STEPS[TICK_STEPS.length - 1];
  const fmt = tickFormat(tickStep, s.TZ);

  axis.querySelectorAll('.tick').forEach(t => t.remove());
  s.axisTickList.length = 0;
  for (const ts of axisTicks(s.P.from, s.P.to, tickStep, s.TZ)) {
    s.axisTickList.push(ts);
    const el = document.createElement('div');
    el.className = 'tick';
    el.style.left = ((ts - s.P.from) / s.SPAN * w) + 'px';
    el.textContent = fmt(ts);
    axis.appendChild(el);
  }
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
