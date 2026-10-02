import { copyVars } from '../dom/styles';
import { fmtTime } from '../time/zones';
import type { Annotation, RawAnnotation, TimeWindow } from '../types';

/* Normalize annotations from any provider (Grafana annotation frames, the
 * mock seam, a host page) into { ts, timeEnd?, title, text, tags[], color,
 * source, siteScope }. A `source:<id>` (or legacy `kiosk:<id>`) tag pins the
 * marker to that source's strip; a `site:<id>` tag scopes it to every source
 * at that site; everything else renders on the shared lane. Events from
 * wider time windows are kept if they OVERLAP ours and clamp-render. */
export function normAnnotations(raw: RawAnnotation[] | null | undefined, P: TimeWindow): Annotation[] {
  const out: Annotation[] = [];
  for (const a of raw || []) {
    const ts = Number(a.ts != null ? a.ts : a.time);
    if (!Number.isFinite(ts)) {continue;}
    let end: number | null = a.timeEnd != null ? Number(a.timeEnd) : NaN;
    if (!Number.isFinite(end) || end <= ts) {end = null;}
    if ((end || ts) < P.from || ts > P.to) {continue;}
    const tags = Array.isArray(a.tags) ? a.tags.map(String)
      : a.tags ? String(a.tags).split(',').map((s) => s.trim()).filter(Boolean) : [];
    let source = a.source || null;
    let siteScope: string | null = null;
    for (const t of tags) {
      const m = /^(?:source|kiosk):(.+)$/.exec(t);
      if (m) {source = m[1];}
      const ms = /^site:(.+)$/.exec(t);
      if (ms) {siteScope = ms[1];}
    }
    out.push({ ts, timeEnd: end, title: a.title || '', text: a.text || '', tags, color: a.color || '', source, siteScope });
  }
  return out.sort((x, y) => x.ts - y.ts);
}

/* the shared tooltip's handle: show/hide follow hover, pin keeps it open
 * (src: the marker that opened it, whose mount palette it wears; tz: that
 * mount's zone) */
export interface AnnTip {
  show(items: Annotation[], x: number, y: number, src: Element, tz: string): void;
  pin(items: Annotation[], x: number, y: number, src: Element, tz: string): void;
  hide(): void;
  close(): void;
}

/* Shared fixed-position tooltip for annotation markers (one per document,
 * like the injected styles). Built with textContent — annotation text is
 * foreign data, never markup; only http(s) URLs inside it are promoted to
 * real anchors. Hover shows it; CLICK PINS it (selectable text, clickable
 * links) until a click elsewhere or Escape. */
let annTipEl: HTMLDivElement | null = null;
let annTipPinned = false;
export function annTip(): AnnTip {
  if (!annTipEl) {
    annTipEl = document.createElement('div');
    annTipEl.className = 'ktl-ann-tip';
    annTipEl.style.display = 'none';
    document.body.appendChild(annTipEl);
    document.addEventListener('click', (e) => {
      // annTipEl is set just above, before this listener exists, and never cleared
      if (annTipPinned && !annTipEl!.contains(e.target as Node | null)) {close();}
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && annTipPinned) {close();}
    });
  }
  const el = annTipEl;

  function linkify(host: HTMLElement, text: string): void {
    const parts = String(text).split(/(https?:\/\/[^\s]+)/g);
    for (const part of parts) {
      if (/^https?:\/\//.test(part)) {
        const a = document.createElement('a');
        a.href = part;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = part;
        host.appendChild(a);
      } else if (part) {
        host.appendChild(document.createTextNode(part));
      }
    }
  }

  function render(items: Annotation[], x: number, y: number, src: Element, tz: string): void {
    copyVars(src, el);   // one tip serves every panel: wear the caller's palette
    el.textContent = '';
    for (const a of items) {
      const item = document.createElement('div');
      item.className = 'item';
      const head = document.createElement('div');
      head.className = 'at';
      const b = document.createElement('b');
      b.textContent = a.title || 'annotation';
      const tm = document.createElement('span');
      tm.className = 'tm';
      tm.textContent = fmtTime(a.ts, tz) + (a.timeEnd ? ' → ' + fmtTime(a.timeEnd, tz) : '');
      head.appendChild(b); head.appendChild(tm);
      item.appendChild(head);
      if (a.text) {
        const tx = document.createElement('div');
        tx.className = 'ax';
        linkify(tx, a.text);
        item.appendChild(tx);
      }
      const shown = a.tags.filter((t) => !/^(?:source|kiosk|site):/.test(t));
      if (shown.length) {
        const tg = document.createElement('div');
        tg.className = 'ag';
        for (const t of shown) {
          const s = document.createElement('span');
          s.textContent = t;
          tg.appendChild(s);
        }
        item.appendChild(tg);
      }
      el.appendChild(item);
    }
    el.style.display = 'block';
    const r = el.getBoundingClientRect();
    el.style.left = Math.max(4, Math.min(window.innerWidth - r.width - 4, x - r.width / 2)) + 'px';
    el.style.top = Math.max(4, y - r.height - 10) + 'px';
  }

  function close(): void {
    annTipPinned = false;
    el.classList.remove('pinned');
    el.style.display = 'none';
  }

  return {
    // tz: the zone of the panel that opened the tip (one tip serves every panel)
    show(items, x, y, src, tz) { if (!annTipPinned) {render(items, x, y, src, tz);} },
    pin(items, x, y, src, tz) {
      annTipPinned = true;
      el.classList.add('pinned');
      render(items, x, y, src, tz);
    },
    hide() { if (!annTipPinned) {el.style.display = 'none';} },
    close,
  };
}
