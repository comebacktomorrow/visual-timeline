import { annTip } from '../ui/annotations';
import { q } from '../ui/wrapper';
import type { Annotation, SourceDecl } from '../types';
import type { TimelineState } from './state';

/* Annotations: per-source markers ride that source's strip; the rest
 * share one lane above the axis. Regions shade their span; markers
 * cluster when closer than ~10px. Positions are %-based so they survive
 * flexbox resizes without a re-render. */
export function renderAnnotations(s: TimelineState, anns: Annotation[]): void {
  const tip = annTip();
  const fracOf = (t: number) => (Math.max(s.P.from, Math.min(s.P.to, t)) - s.P.from) / s.SPAN;
  const pct = (f: number) => (f * 100).toFixed(3) + '%';

  function addRegion(host: HTMLElement, a: Annotation): void {
    const el = document.createElement('div');
    el.className = 'ann-region';
    el.style.left = pct(fracOf(a.ts));
    el.style.width = pct(fracOf(a.timeEnd!) - fracOf(a.ts));   // regions only: callers check timeEnd
    if (a.color) { el.style.background = a.color + '22'; el.style.borderColor = a.color + '88'; }
    host.appendChild(el);
  }
  function addMarkers(host: HTMLElement, items: Annotation[]): void {
    // cluster markers closer than ~10px so dense event bursts stay legible
    const groups: Annotation[][] = [];
    for (const a of items) {
      const g = groups[groups.length - 1];
      if (g && (fracOf(a.ts) - fracOf(g[0].ts)) * s.hostWidth < 10) {g.push(a);}
      else {groups.push([a]);}
    }
    for (const g of groups) {
      const el = document.createElement('div');
      el.className = 'ann' + (g.length > 1 ? ' multi' : '');
      el.style.left = pct(fracOf(g[0].ts));
      if (g[0].color) {el.style.background = g[0].color;}
      el.title = '';   // suppress native tooltip; ours carries the detail
      if (g.length > 1) {
        const n = document.createElement('span');
        n.className = 'n';
        n.textContent = String(g.length);
        el.appendChild(n);
      }
      el.addEventListener('mouseenter', () => {
        const r = el.getBoundingClientRect();
        tip.show(g, r.left + r.width / 2, r.top, el, s.TZ);
      });
      el.addEventListener('mouseleave', () => tip.hide());
      el.addEventListener('click', (e) => {
        // pin: selectable text + clickable links; don't open the frame
        // preview underneath, and don't let the document unpin us
        e.stopPropagation();
        const r = el.getBoundingClientRect();
        tip.pin(g, r.left + r.width / 2, r.top, el, s.TZ);
      });
      host.appendChild(el);
    }
  }

  // scoping: source:<id> pins to one card, site:<id> to every card at
  // that site, neither = global. A scoped annotation whose target isn't
  // on this panel is DROPPED, not shown global — its context is absent.
  const appliesTo = (a: Annotation, k: SourceDecl) =>
    (!a.source || a.source === k.id) && (!a.siteScope || a.siteScope === k.site);
  const isGlobal = (a: Annotation) => !a.source && !a.siteScope;

  if (s.cfg.annotationLanes === 'per-source') {
    // one lane per card: its own scoped events plus every global, so each
    // timeline reads in context — stacked windows never share one bar
    for (const k of s.kiosks) {
      const c = s.cards[k.id];
      const items = anns.filter((a) => appliesTo(a, k));
      if (!items.length) {continue;}
      c.card.classList.add('has-lane');
      for (const a of items) {if (a.timeEnd) { addRegion(c.strip, a); addRegion(c.lane, a); }}
      addMarkers(c.lane, items);
    }
    return;
  }

  const laneItems: Annotation[] = [], perCard: Record<string, Annotation[]> = {};
  for (const a of anns) {
    if (isGlobal(a)) {laneItems.push(a);}
    else {for (const k of s.kiosks) {if (appliesTo(a, k)) {(perCard[k.id] ||= []).push(a);}}}
    if (a.timeEnd) {
      // regions shade the strips they scope to; globals also shade the lane
      const hosts = isGlobal(a)
        ? s.kiosks.map((k) => s.cards[k.id].strip).concat([q(s.wrap, '.ann-lane')])
        : s.kiosks.filter((k) => appliesTo(a, k)).map((k) => s.cards[k.id].strip);
      for (const h of hosts) {addRegion(h, a);}
    }
  }
  for (const [id, items] of Object.entries(perCard)) {addMarkers(s.cards[id].strip, items);}
  if (laneItems.length) {addMarkers(q(s.wrap, '.ann-lane'), laneItems);}
  if (laneItems.length || anns.some((a) => a.timeEnd && isGlobal(a))) {q(s.wrap, '.ann-lane').style.display = '';}
}
