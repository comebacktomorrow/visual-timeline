/* Kiosk Timeline panel — hand-rolled AMD module, no build step.
 * Grafana's plugin loader supplies 'react' and '@grafana/data' as externals.
 * The timeline core is the framework-free code from web/index.html, adapted:
 *   - time range / site / size come from PanelProps instead of URL params
 *   - pixel budget derives from actual panel width
 *   - DataHoverEvent publish/subscribe = two-way shared-crosshair sync
 */
define(['react', '@grafana/data'], function (React, grafanaData) {
  'use strict';
  const { PanelPlugin, DataHoverEvent, DataHoverClearEvent } = grafanaData;

  /* ======================= styles (injected once) ======================= */
  const STYLE_ID = 'ktl-styles';
  const CSS = `
  .ktl { display:flex; flex-direction:column; width:100%; height:100%; overflow:hidden;
         --ktl-bg:#181b1f; --ktl-bg2:#22262b; --ktl-border:#2c3235; --ktl-text:#ccccdc;
         --ktl-dim:#7b8087; --ktl-accent:#f2cc0c; --ktl-live:#73bf69; --ktl-off:#f2495c;
         color:var(--ktl-text); font:12px/1.4 -apple-system,"Segoe UI",Roboto,sans-serif; }
  .ktl * { box-sizing:border-box; margin:0; padding:0; }
  .ktl .cards { flex:1 1 auto; min-height:0; display:flex; flex-direction:column; gap:6px; overflow-y:auto; }
  /* cards share panel height equally (fewer kiosks → taller strips), but
     never crush below a usable minimum — past that the list scrolls */
  .ktl .card { flex:1 1 0; min-height:76px; display:flex; flex-direction:column; background:var(--ktl-bg2);
               border:1px solid var(--ktl-border); border-radius:4px; overflow:hidden; transition:opacity 120ms ease; }
  .ktl.strip-hover .card:not(.hovered) { opacity:.45; }
  .ktl .card-head { display:flex; align-items:center; gap:8px; padding:2px 8px; flex:0 0 auto; color:var(--ktl-dim); }
  .ktl .card-head .nm { font-weight:600; color:var(--ktl-text); }
  .ktl .card-head .st { font-size:10px; color:var(--ktl-dim); border:1px solid var(--ktl-border);
                        border-radius:8px; padding:0 6px; }
  .ktl .card-head .ft { font-variant-numeric:tabular-nums; }
  .ktl .card-head .ft.stale { color:var(--ktl-off); }
  .ktl .card-head .cad { margin-left:auto; font-size:10px; color:var(--ktl-dim); }
  .ktl .strip { flex:1 1 auto; min-height:0; position:relative; display:flex; align-items:stretch;
                cursor:crosshair; background:#111; }
  .ktl .slot { flex:1 1 0; min-width:0; position:relative; overflow:hidden; }
  .ktl .slot img { position:absolute; top:0; left:50%; transform:translateX(-50%); height:100%; width:auto; }
  .ktl .slot.gap { background:repeating-linear-gradient(45deg,#1b1215,#1b1215 5px,#2a171b 5px,#2a171b 10px); }
  .ktl .xh { position:absolute; top:0; bottom:0; width:1px; background:var(--ktl-accent); opacity:.85;
             pointer-events:none; z-index:4; }
  .ktl .sel { position:absolute; top:0; bottom:0; display:none; background:rgba(242,204,12,.14);
              border-left:1px solid var(--ktl-accent); border-right:1px solid var(--ktl-accent);
              pointer-events:none; z-index:2; }
  .ktl .mag { position:absolute; top:0; height:100%; aspect-ratio:16/9; max-width:40%;
              border:2px solid var(--ktl-accent); border-radius:2px; overflow:hidden; pointer-events:none;
              z-index:3; background:#000; box-shadow:0 0 12px rgba(0,0,0,.8); }
  .ktl .mag img { width:100%; height:100%; object-fit:contain; display:block; background:#000; }
  .ktl.fill .mag img { object-fit:cover; }
  .ktl.fill .tile .t-img img { object-fit:cover; }
  .ktl .mag.gap { border-color:var(--ktl-off);
                  background:repeating-linear-gradient(45deg,#1b1215,#1b1215 5px,#2a171b 5px,#2a171b 10px); }
  .ktl .mag.gap img { display:none; }
  .ktl .mag .cap { position:absolute; left:0; right:0; bottom:0; background:rgba(0,0,0,.6); color:#fff;
                   text-align:center; font-size:10px; font-variant-numeric:tabular-nums; padding:1px 0; }
  .ktl .axis { flex:0 0 24px; position:relative; margin:4px 1px 0; overflow:hidden; }
  .ktl .axis .base { position:absolute; top:0; left:0; right:0; height:1px; background:var(--ktl-border); }
  .ktl .tick { position:absolute; top:0; transform:translateX(-50%); color:var(--ktl-dim); font-size:10px;
               font-variant-numeric:tabular-nums; padding-top:6px; white-space:nowrap; }
  .ktl .tick::before { content:""; position:absolute; top:0; left:50%; width:1px; height:5px; background:var(--ktl-dim); }
  .ktl .acur { position:absolute; top:0; transform:translateX(-50%); color:#111; background:var(--ktl-accent);
               font-size:10px; font-weight:700; font-variant-numeric:tabular-nums; padding:0 5px;
               border-radius:2px; margin-top:5px; white-space:nowrap; z-index:2; }
  .ktl .acur::before { content:""; position:absolute; top:-5px; left:50%; width:1px; height:5px; background:var(--ktl-accent); }
  .ktl .grid { flex:1 1 auto; min-height:0; display:grid; gap:8px; overflow:auto;
               grid-template-columns:repeat(auto-fit, minmax(170px, 1fr)); grid-auto-rows:minmax(110px, 1fr); }
  .ktl .tile { display:flex; flex-direction:column; background:var(--ktl-bg2);
               border:1px solid var(--ktl-border); border-radius:4px; overflow:hidden; cursor:zoom-in; }
  .ktl .tile .t-head { display:flex; gap:6px; align-items:center; padding:2px 6px; color:var(--ktl-dim); flex:0 0 auto; }
  .ktl .tile .t-head .nm { font-weight:600; color:var(--ktl-text); }
  .ktl .tile .t-img { flex:1 1 auto; min-height:0; position:relative; background:#111; }
  .ktl .tile .t-img img { position:absolute; inset:0; width:100%; height:100%; object-fit:contain; }
  .ktl .tile .t-ts { position:absolute; right:4px; bottom:4px; background:rgba(0,0,0,.65); color:#fff;
                     padding:0 5px; border-radius:2px; font-size:10px; font-variant-numeric:tabular-nums; z-index:1; }
  .ktl .tile .t-off { display:none; position:absolute; inset:0; align-items:center; justify-content:center;
                      flex-direction:column; gap:2px; color:var(--ktl-off); font-weight:700; text-align:center;
                      background:repeating-linear-gradient(45deg,#1b1215,#1b1215 5px,#2a171b 5px,#2a171b 10px); }
  .ktl .tile.offline { border-color:var(--ktl-off); }
  .ktl .tile.offline .t-off { display:flex; }
  .ktl .tile.offline img, .ktl .tile.offline .t-ts { display:none; }
  .ktl-pop { position:fixed; z-index:1060; background:#0b0c0e; border:1px solid var(--ktl-accent, #f2cc0c);
             border-radius:4px; padding:4px; cursor:zoom-out;
             box-shadow:0 8px 32px rgba(0,0,0,.7); }
  .ktl-pop img { display:block; max-width:min(560px, 50vw); max-height:55vh; border-radius:2px; }
  .ktl-pop .cap { text-align:center; color:#ccccdc; font-size:11px; padding:3px 0 0;
                  font-variant-numeric:tabular-nums; }`;

  function injectStyles() {
    if (!document.getElementById(STYLE_ID)) {
      const s = document.createElement('style');
      s.id = STYLE_ID;
      s.textContent = CSS;
      document.head.appendChild(s);
    }
  }

  /* ================== built-in demo data (backend seam) ==================
   * Same contract as the frames API (docs/API.md): swap for GET /sources +
   * GET /frames via the apiUrl option. Cadence is DECLARED BY THE SOURCE.
   * source-2 has a synthetic outage. */
  const SITES = {
    'site-a': [
      { id: 'source-1', cadence: 60e3 },
      { id: 'source-2', cadence: 60e3 },
      { id: 'source-3', cadence: 120e3 },
    ],
    'site-b': [
      { id: 'source-4', cadence: 60e3 },
      { id: 'source-5', cadence: 30e3 },
    ],
  };
  const HUES = { 'source-1': 205, 'source-2': 275, 'source-3': 25, 'source-4': 130, 'source-5': 340 };
  /* demo screen shapes: source-3 is 4:3, source-5 is portrait 9:16 */
  const DIMS = { 'source-3': [288, 216], 'source-5': [216, 384] };

  const fmtTime = ts => new Date(ts).toLocaleTimeString('en-AU', { hour12: false });
  const fmtShort = ts => new Date(ts).toLocaleTimeString('en-AU', { hour12: false, hour: '2-digit', minute: '2-digit' });
  const fmtDur = ms => ms % 3600e3 === 0 ? (ms / 3600e3) + 'h' : ms % 60e3 === 0 ? (ms / 60e3) + 'm' : (ms / 1e3) + 's';

  function makeBackend(P, SPAN) {
    function renderMockFrame(site, kiosk, ts, step) {
      const dims = DIMS[kiosk] || [384, 216];
      const w = dims[0], h = dims[1];
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const g = c.getContext('2d');
      const hue = HUES[kiosk] != null ? HUES[kiosk] : 130;
      g.fillStyle = 'hsl(' + hue + ' 30% 14%)'; g.fillRect(0, 0, w, h);
      g.fillStyle = 'hsl(' + hue + ' 60% 30%)'; g.fillRect(0, 0, w, Math.round(h * 0.14));
      g.fillStyle = '#fff'; g.font = 'bold ' + Math.round(h * 0.06) + 'px sans-serif';
      g.fillText(site + ' / ' + kiosk, 8, Math.round(h * 0.10));
      g.font = 'bold ' + Math.round(Math.min(w * 0.16, h * 0.18)) + 'px monospace';
      g.fillStyle = 'hsl(' + hue + ' 70% 72%)';
      g.textAlign = 'center';
      g.fillText(fmtTime(ts), w / 2, h * 0.55);
      g.textAlign = 'left';
      const phase = (ts / step) % 20 / 20;
      g.fillStyle = 'hsl(' + hue + ' 80% 55%)';
      g.fillRect(w * 0.04 + phase * (w * 0.8), h * 0.72, w * 0.13, h * 0.16);
      return c.toDataURL('image/jpeg', 0.7);
    }
    return {
      kiosks(sites) {
        return Object.entries(SITES)
          .filter(([s]) => !sites || sites.includes(s))
          .flatMap(([s, ks]) => ks.map(k => Object.assign({}, k, { site: s, location: 'demo' })));
      },
      frames(site, kiosk, from, to, step) {
        const out = [];
        const gapA = P.from + SPAN * 0.35, gapB = P.from + SPAN * 0.55;
        const first = Math.ceil(from / step) * step;
        for (let ts = first; ts <= Math.min(to, Date.now()); ts += step) {
          if (kiosk === 'source-2' && ts > gapA && ts < gapB) continue;
          out.push({ kiosk, ts, url: renderMockFrame(site, kiosk, ts, step) });
        }
        return Promise.resolve(out);
      },
    };
  }

  /* API-backed data layer — same shapes as the mock. Used when the panel's
   * apiUrl option points at the kiosk-timeline Worker (CORS is served). */
  function makeApiBackend(apiUrl) {
    const base = apiUrl.replace(/\/+$/, '');
    return {
      async kiosks(sites) {
        const u = new URL(base + '/sources');
        if (sites) u.searchParams.set('site', sites.join(','));
        const r = await fetch(u);
        if (!r.ok) throw new Error('kiosks ' + r.status);
        return r.json();
      },
      async frames(site, kiosk, from, to, step) {
        const u = new URL(base + '/frames');
        u.searchParams.set('site', site);
        u.searchParams.set('source', kiosk);
        u.searchParams.set('from', String(Math.round(from)));
        u.searchParams.set('to', String(Math.round(to)));
        u.searchParams.set('step', String(step));
        u.searchParams.set('variant', 'lo');
        const r = await fetch(u);
        if (!r.ok) throw new Error('frames ' + r.status);
        return r.json();
      },
    };
  }

  /* Nearest hi-variant URL for the click-in preview (API mode only); the
   * preview falls back to the lo frame if the hi key 404s. */
  function hiUrlFor(frame, decl, apiUrl) {
    if (!apiUrl || !decl.hiCadence) return null;
    const hiTs = Math.round(frame.ts / decl.hiCadence) * decl.hiCadence;
    return apiUrl.replace(/\/+$/, '') + '/frame/hi/' + decl.site + '/' + decl.id + '/' + hiTs + '.jpg';
  }

  /* ======================= timeline core ======================= */
  function parseVar(v) {
    if (!v || v === 'All' || v === '$__all') return null;
    return v.replace(/^\{|\}$/g, '').split(',').map(s => s.trim()).filter(Boolean);
  }

  const TICK_STEPS = [60e3, 5 * 60e3, 10 * 60e3, 15 * 60e3, 30 * 60e3,
                      3600e3, 2 * 3600e3, 3 * 3600e3, 6 * 3600e3, 12 * 3600e3, 24 * 3600e3];

  /* cursor-anchored larger preview (not full-screen), shared by both modes.
   * Shows the frame at native upload resolution — capture size is the only
   * quality knob; no separate hi-res fetch. Esc / click dismisses. */
  function makePreview() {
    let el = null, keyH = null;
    const close = () => {
      if (el) { el.remove(); el = null; }
      if (keyH) { document.removeEventListener('keydown', keyH); keyH = null; }
    };
    return {
      open(site, kiosk, frame, x, y, hiUrl) {
        close();
        el = document.createElement('div');
        el.className = 'ktl-pop';
        el.innerHTML = '<img alt="frame"><div class="cap"></div>';
        const img = el.querySelector('img');
        el.querySelector('.cap').textContent = site + ' / ' + kiosk + ' — ' + fmtTime(frame.ts);
        el.addEventListener('click', close);
        document.body.appendChild(el);
        const place = () => {
          if (!el) return;
          const r = el.getBoundingClientRect();
          el.style.left = Math.max(8, Math.min(window.innerWidth - r.width - 8, x + 14)) + 'px';
          el.style.top = Math.max(8, Math.min(window.innerHeight - r.height - 8, y - r.height / 2)) + 'px';
        };
        img.onload = place;
        img.onerror = () => { img.onerror = null; img.src = frame.url; };  // hi 404 → lo
        img.src = hiUrl || frame.url;
        place();
        keyH = e => { if (e.key === 'Escape') close(); };
        document.addEventListener('keydown', keyH);
      },
      close,
    };
  }

  /* Double-buffered remounts. A dashboard refresh tears the panel down and
   * rebuilds it; wiping the root first paints a blank frame (visible flash
   * every refresh tick). Instead each mount builds into its own HIDDEN
   * wrapper and swaps it in once its images have decoded — the previous
   * wrapper stays painted until then. destroy() only marks its wrapper
   * stale; the successor removes it (timeout fallback for true unmounts). */
  function makeWrapper(root) {
    const wrap = document.createElement('div');
    wrap.className = 'ktl';
    // absolute stacking + visibility (NOT display:none): the wrapper must
    // have real layout while hidden — axis ticks, crosshair and magnifier
    // positions are measured from clientWidth during build
    root.style.position = 'relative';
    wrap.style.position = 'absolute';
    wrap.style.inset = '0';
    wrap.style.visibility = 'hidden';
    root.appendChild(wrap);
    return wrap;
  }
  async function revealWrapper(root, wrap) {
    const imgs = [...wrap.querySelectorAll('img')];
    await Promise.race([
      Promise.allSettled(imgs.map(i => (i.decode ? i.decode().catch(() => {}) : Promise.resolve()))),
      new Promise(res => setTimeout(res, 900)),
    ]);
    if (!wrap.isConnected) return;
    for (const el of [...root.children]) if (el !== wrap) el.remove();
    wrap.style.visibility = '';
  }
  function retireWrapper(wrap) {
    wrap.dataset.stale = '1';
    setTimeout(() => wrap.remove(), 1500);
  }

  /* cfg: { site, from, to, width, onHover(t), onHoverClear() } */
  function mountTimeline(root, cfg) {
    injectStyles();
    const P = { site: parseVar(cfg.site), from: cfg.from, to: cfg.to };
    const SPAN = Math.max(1, P.to - P.from);
    const LIVE = P.to > Date.now() - 2 * 60 * 1000;
    const MIN_SLICE_PX = 7;
    const pxBudget = Math.max(10, Math.floor((cfg.width - 20) / MIN_SLICE_PX));
    const backend = cfg.apiUrl ? makeApiBackend(cfg.apiUrl) : makeBackend(P, SPAN);

    function geomFor(cadence) {
      const raw = Math.ceil(SPAN / cadence);
      const step = Math.ceil(raw / Math.min(pxBudget, raw)) * cadence;
      const bucketStart = Math.ceil(P.from / step) * step;
      const nBuckets = Math.max(1, Math.floor((P.to - bucketStart) / step) + 1);
      const idx = t => Math.max(0, Math.min(nBuckets - 1, Math.floor((t - bucketStart) / step + 0.5)));
      return { cadence, step, bucketStart, nBuckets, idx };
    }

    const wrap = makeWrapper(root);
    wrap.classList.toggle('fill', cfg.fit === 'fill');
    wrap.innerHTML =
      '<div class="cards"></div>' +
      '<div class="axis"><div class="base"></div><div class="acur"></div></div>';
    const q = sel => wrap.querySelector(sel);

    /* A user-pinned cursor (they hovered/scrubbed) survives remounts at the
     * same ABSOLUTE time, clamped into the new window; an untouched cursor
     * keeps following the live edge. Persisted on the root, which outlives
     * the wrapper swaps. */
    function restoreCursor() {
      const saved = Number(root.dataset.ktlCursor);
      if (root.dataset.ktlPinned === '1' && Number.isFinite(saved)) {
        return Math.max(P.from, Math.min(P.to, saved));
      }
      return Math.min(P.to, Date.now());
    }
    let kiosks = [], cards = {}, cursorT = restoreCursor(), destroyed = false, pollTimer = null;
    let suppressClick = false;
    const pv = makePreview();

    /* selection band shown on every card during drag-zoom (fractions of window) */
    function showSelection(fa, fb) {
      const a = Math.min(fa, fb), b = Math.max(fa, fb);
      for (const k of kiosks) {
        const c = cards[k.id];
        if (!c) continue;
        const w = c.strip.clientWidth;
        c.sel.style.display = 'block';
        c.sel.style.left = (a * w) + 'px';
        c.sel.style.width = ((b - a) * w) + 'px';
      }
    }
    function hideSelection() {
      for (const k of kiosks) if (cards[k.id]) cards[k.id].sel.style.display = 'none';
    }


    function buildCard(decl, geom, frames) {
      const kiosk = decl.id;
      const byIdx = new Map(frames.map(f => [geom.idx(f.ts), f]));
      const card = document.createElement('div');
      card.className = 'card';
      const down = geom.step > geom.cadence;
      const cad = cfg.showDetails
        ? '<span class="cad">⏱ ' + fmtDur(geom.cadence) + ' · 1/' + fmtDur(geom.step) + (down ? ' ↓' : '') + '</span>'
        : '';
      card.innerHTML =
        '<div class="card-head"><span class="nm">' + kiosk + '</span>' +
        '<span class="st">' + decl.site + (decl.location ? ' · ' + decl.location : '') + '</span><span class="ft"></span>' +
        cad + '</div>' +
        '<div class="strip"><div class="xh"></div><div class="sel"></div><div class="mag"><img alt=""><div class="cap"></div></div></div>';
      const strip = card.querySelector('.strip');
      const slots = [];
      for (let i = 0; i < geom.nBuckets; i++) {
        const ts = geom.bucketStart + i * geom.step;
        const frame = byIdx.get(i) || null;
        const el = document.createElement('div');
        el.className = 'slot' + (frame ? '' : ' gap');
        if (frame) {
          const img = document.createElement('img');
          img.src = frame.url; img.alt = kiosk + ' ' + fmtTime(ts);
          el.appendChild(img);
        }
        strip.appendChild(el);
        slots.push({ ts, frame, el });
      }
      strip.addEventListener('mousemove', e => {
        const r = strip.getBoundingClientRect();
        const t = P.from + SPAN * ((e.clientX - r.left) / r.width);
        setCursor(t, card, false);
      });
      strip.addEventListener('mouseenter', () => wrap.classList.add('strip-hover'));
      strip.addEventListener('mouseleave', () => {
        wrap.classList.remove('strip-hover');
        if (cfg.onHoverClear) cfg.onHoverClear();
      });
      strip.addEventListener('click', e => {
        if (suppressClick) { suppressClick = false; return; }
        const f = slots[geom.idx(cursorT)] && slots[geom.idx(cursorT)].frame;
        if (f) pv.open(decl.site, kiosk, f, e.clientX, e.clientY, hiUrlFor(f, decl, cfg.apiUrl));
      });
      /* magnifier takes the aspect of the actual frames (portrait screens etc.) */
      const magEl = card.querySelector('.mag');
      const magImg = magEl.querySelector('img');
      magImg.addEventListener('load', () => {
        if (magImg.naturalWidth && magImg.naturalHeight)
          magEl.style.aspectRatio = String(magImg.naturalWidth / magImg.naturalHeight);
      });
      /* drag-select = zoom, grafana-style: band across all cards, release → onZoom */
      strip.addEventListener('mousedown', e => {
        if (e.button !== 0) return;
        e.preventDefault();
        const r = strip.getBoundingClientRect();
        const fracOf = x => Math.max(0, Math.min(1, (x - r.left) / r.width));
        const f0 = fracOf(e.clientX);
        let dragged = false;
        const move = ev => {
          if (destroyed) return up(ev);
          const f1 = fracOf(ev.clientX);
          if (Math.abs(f1 - f0) * r.width > 5) dragged = true;
          if (dragged) {
            showSelection(f0, f1);
            setCursor(P.from + SPAN * f1, card, false);
          }
        };
        const up = ev => {
          document.removeEventListener('mousemove', move);
          document.removeEventListener('mouseup', up);
          hideSelection();
          if (dragged && !destroyed) {
            suppressClick = true;
            const f1 = fracOf(ev.clientX);
            const a = Math.min(f0, f1), b = Math.max(f0, f1);
            if (b > a && cfg.onZoom) cfg.onZoom(Math.round(P.from + SPAN * a), Math.round(P.from + SPAN * b));
          }
        };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
      });
      q('.cards').appendChild(card);
      return {
        card, geom, slots,
        head: card.querySelector('.ft'),
        strip,
        cross: card.querySelector('.xh'),
        sel: card.querySelector('.sel'),
        mag: card.querySelector('.mag'),
      };
    }

    function buildAxis() {
      const axis = q('.axis');
      const w = axis.clientWidth;
      const maxTicks = Math.max(3, Math.floor(w / 90));
      const tickStep = TICK_STEPS.find(s => SPAN / s <= maxTicks) || TICK_STEPS[TICK_STEPS.length - 1];
      const withDate = SPAN > 20 * 3600e3;
      axis.querySelectorAll('.tick').forEach(t => t.remove());
      for (let ts = Math.ceil(P.from / tickStep) * tickStep; ts <= P.to; ts += tickStep) {
        const el = document.createElement('div');
        el.className = 'tick';
        el.style.left = ((ts - P.from) / SPAN * w) + 'px';
        el.textContent = withDate
          ? new Date(ts).toLocaleString('en-AU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
          : fmtShort(ts);
        axis.appendChild(el);
      }
    }

    /* external=true → came from the event bus; don't re-publish (no loop) */
    function setCursor(t, hoveredCard, external) {
      cursorT = Math.max(P.from, Math.min(P.to, t));
      root.dataset.ktlCursor = String(cursorT);
      if (!external) root.dataset.ktlPinned = '1';
      const frac = (cursorT - P.from) / SPAN;

      const axis = q('.axis'), ac = q('.acur');
      const acW = ac.offsetWidth || 50;
      ac.textContent = fmtTime(cursorT);
      ac.style.left = Math.max(acW / 2, Math.min(axis.clientWidth - acW / 2, frac * axis.clientWidth)) + 'px';

      for (const k of kiosks) {
        const c = cards[k.id];
        if (!c) continue;
        // external cursor moves (event bus) must not strip local hover state —
        // other panels re-emit hover events and would un-dim us mid-hover
        if (!external) c.card.classList.toggle('hovered', hoveredCard === c.card);
        const w = c.strip.clientWidth, x = frac * w;
        c.cross.style.left = x + 'px';
        const idx = c.geom.idx(cursorT);
        const slot = c.slots[idx];
        const magW = c.mag.offsetWidth || c.strip.clientHeight * 16 / 9;
        c.mag.style.left = Math.max(0, Math.min(w - magW, x - magW / 2)) + 'px';
        if (slot && slot.frame) {
          c.mag.classList.remove('gap');
          c.mag.querySelector('img').src = slot.frame.url;
          c.mag.querySelector('.cap').textContent = fmtTime(slot.frame.ts);
          c.head.textContent = '';                 // healthy: time lives on the magnifier
          c.head.classList.remove('stale');
        } else {
          c.mag.classList.add('gap');
          let last = null;
          for (let i = idx; i >= 0; i--) if (c.slots[i].frame) { last = c.slots[i].frame; break; }
          const msg = last ? 'offline — last seen ' + fmtTime(last.ts) : 'no data in window';
          c.mag.querySelector('.cap').textContent = msg;
          c.head.textContent = msg;
          c.head.classList.add('stale');
        }
      }
      if (!external && cfg.onHover) cfg.onHover(cursorT);
    }

    (async function boot() {
      kiosks = await backend.kiosks(P.site);
      for (const k of kiosks) {
        if (destroyed) return;
        const geom = geomFor(k.cadence);
        const frames = await backend.frames(k.site, k.id, P.from, P.to, geom.step);
        if (destroyed) return;
        cards[k.id] = buildCard(k, geom, frames);
      }
      buildAxis();
      setCursor(cursorT, null, true);   // rest position; don't publish
      await revealWrapper(root, wrap);  // swap in only once images decoded

      if (LIVE) {
        const steps = kiosks.map(k => cards[k.id].geom.step);
        const minStep = steps.length ? Math.min.apply(null, steps) : 60e3;
        pollTimer = setInterval(async () => {
          for (const k of kiosks) {
            const c = cards[k.id];
            let lastTs = P.from;
            for (let i = c.slots.length - 1; i >= 0; i--) if (c.slots[i].frame) { lastTs = c.slots[i].ts; break; }
            const fresh = await backend.frames(k.site, k.id, lastTs + 1, Date.now(), c.geom.step);
            if (destroyed) return;
            for (const f of fresh) {
              const slot = c.slots[c.geom.idx(f.ts)];
              if (!slot) continue;
              // newer frames REPLACE the bucket representative (frames past
              // the window end clamp into the last bucket) so the right edge
              // keeps sliding between dashboard refreshes — grid parity
              if (slot.frame && f.ts <= slot.frame.ts) continue;
              slot.frame = f;
              slot.el.classList.remove('gap');
              let img = slot.el.querySelector('img');
              if (!img) { img = document.createElement('img'); slot.el.appendChild(img); }
              img.src = f.url; img.alt = k.id + ' ' + fmtTime(f.ts);
            }
          }
        }, Math.min(minStep, 10000));
      }
    })();

    return {
      setExternalCursor(t) { if (!destroyed) setCursor(t, null, true); },
      isHovering() { return wrap.classList.contains('strip-hover'); },
      destroy() {
        destroyed = true;
        if (pollTimer) clearInterval(pollTimer);
        pv.close();
        retireWrapper(wrap);
      },
    };
  }

  /* ======================= multiview grid mode =======================
   * One tile per kiosk, no timeline. Shows the most recent frame in the
   * window; with follow-crosshair on, shows the frame at the shared
   * crosshair time while another panel is hovered, reverting on clear. */
  function mountGrid(root, cfg) {
    injectStyles();
    const P = { site: parseVar(cfg.site), from: cfg.from, to: cfg.to };
    const SPAN = Math.max(1, P.to - P.from);
    const LIVE = P.to > Date.now() - 2 * 60 * 1000;
    const backend = cfg.apiUrl ? makeApiBackend(cfg.apiUrl) : makeBackend(P, SPAN);
    const budget = 120;   // temporal buckets for crosshair-follow resolution

    function geomFor(cadence) {
      const raw = Math.ceil(SPAN / cadence);
      const step = Math.ceil(raw / Math.min(budget, raw)) * cadence;
      const bucketStart = Math.ceil(P.from / step) * step;
      const nBuckets = Math.max(1, Math.floor((P.to - bucketStart) / step) + 1);
      const idx = t => Math.max(0, Math.min(nBuckets - 1, Math.floor((t - bucketStart) / step + 0.5)));
      return { cadence, step, bucketStart, nBuckets, idx };
    }

    const wrap = makeWrapper(root);
    wrap.classList.toggle('fill', cfg.fit === 'fill');
    wrap.innerHTML = '<div class="grid"></div>';
    const q = sel => wrap.querySelector(sel);

    let kiosks = [], tiles = {}, destroyed = false, pollTimer = null, shownT = null;
    const pv = makePreview();

    function buildTile(decl, geom, frames) {
      const slots = new Array(geom.nBuckets).fill(null);
      for (const f of frames) slots[geom.idx(f.ts)] = f;
      const el = document.createElement('div');
      el.className = 'tile';
      el.innerHTML =
        '<div class="t-head"><span class="nm">' + decl.id + '</span>' +
        '<span class="st">' + decl.site + (decl.location ? ' · ' + decl.location : '') + '</span></div>' +
        '<div class="t-img"><img alt="' + decl.id + '"><span class="t-ts"></span><div class="t-off"></div></div>';
      const rec = {
        decl, geom, slots, el, shown: null,
        img: el.querySelector('img'),
        ts: el.querySelector('.t-ts'),
        off: el.querySelector('.t-off'),
      };
      el.addEventListener('click', e => {
        if (rec.shown) pv.open(decl.site, decl.id, rec.shown, e.clientX, e.clientY, hiUrlFor(rec.shown, decl, cfg.apiUrl));
      });
      q('.grid').appendChild(el);
      return rec;
    }

    function lastFrame(rec) {
      for (let i = rec.slots.length - 1; i >= 0; i--) if (rec.slots[i]) return rec.slots[i];
      return null;
    }

    /* t = null → most recent in window; otherwise frame at crosshair time */
    function setShown(t) {
      shownT = t;
      for (const k of kiosks) {
        const rec = tiles[k.id];
        if (!rec) continue;
        let frame = null, offMsg = null;
        if (t == null) {
          frame = lastFrame(rec);
          if (!frame) offMsg = 'no data in window';
          else if (LIVE && Date.now() - frame.ts > 2 * rec.geom.step)
            offMsg = 'OFFLINE — last seen ' + fmtTime(frame.ts);
        } else {
          frame = rec.slots[rec.geom.idx(t)];
          if (!frame) {
            let last = null;
            for (let i = rec.geom.idx(t); i >= 0; i--) if (rec.slots[i]) { last = rec.slots[i]; break; }
            offMsg = last ? 'OFFLINE — last seen ' + fmtTime(last.ts) : 'no data';
          }
        }
        rec.el.classList.toggle('offline', !!offMsg);
        rec.off.textContent = offMsg || '';
        rec.shown = frame;
        if (frame && !offMsg) {
          rec.img.src = frame.url;
          rec.ts.textContent = fmtTime(frame.ts);
        }
      }
    }

    (async function boot() {
      kiosks = await backend.kiosks(P.site);
      for (const k of kiosks) {
        if (destroyed) return;
        const geom = geomFor(k.cadence);
        const frames = await backend.frames(k.site, k.id, P.from, P.to, geom.step);
        if (destroyed) return;
        tiles[k.id] = buildTile(k, geom, frames);
      }
      setShown(null);
      await revealWrapper(root, wrap);

      if (LIVE) {
        pollTimer = setInterval(async () => {
          for (const k of kiosks) {
            const rec = tiles[k.id];
            const last = lastFrame(rec);
            const fresh = await backend.frames(k.site, k.id, (last ? last.ts : P.from) + 1, Date.now(), rec.geom.step);
            if (destroyed) return;
            for (const f of fresh) {
              const i = rec.geom.idx(f.ts);
              // newer frames replace the bucket representative so "latest" slides
              if (!rec.slots[i] || f.ts > rec.slots[i].ts) rec.slots[i] = f;
            }
          }
          if (shownT == null) setShown(null);   // keep "latest" tiles fresh
        }, 10000);
      }
    })();

    return {
      setExternalCursor(t) { if (!destroyed) setShown(Math.max(P.from, Math.min(P.to, t))); },
      clearExternal() { if (!destroyed) setShown(null); },
      destroy() {
        destroyed = true;
        if (pollTimer) clearInterval(pollTimer);
        pv.close();
        retireWrapper(wrap);
      },
    };
  }

  /* ======================= React panel wrapper ======================= */
  function TimelinePanel(props) {
    const ref = React.useRef(null);
    const instRef = React.useRef(null);
    const localHoverRef = React.useRef(false);
    const from = props.timeRange.from.valueOf();
    const to = props.timeRange.to.valueOf();
    const options = props.options || {};
    /* The site expression lives in a panel OPTION (persisted in panel JSON)
     * so Grafana's variable-dependency scan sees it and refreshes this panel
     * on variable change — resolving it only via replaceVariables() would be
     * invisible to the scanner and the panel would go stale until refresh. */
    const siteExpr = options.sites || '${site:csv}';
    const site = props.replaceVariables ? props.replaceVariables(siteExpr) : '';
    const mode = options.mode || 'timeline';
    const follow = options.followCrosshair !== false;
    const fit = options.imageFit || 'fit';
    const apiUrl = (options.apiUrl || '').trim();
    const showDetails = options.showDetails === true;

    React.useEffect(() => {
      const common = { site, from, to, width: props.width, fit, apiUrl, showDetails };
      const inst = mode === 'grid'
        ? mountGrid(ref.current, common)
        : mountTimeline(ref.current, Object.assign(common, {
            onHover: t => {
              localHoverRef.current = true;
              props.eventBus.publish(new DataHoverEvent({ point: { time: t } }));
              localHoverRef.current = false;
            },
            onHoverClear: () => props.eventBus.publish(new DataHoverClearEvent()),
            onZoom: (zFrom, zTo) => {
              if (props.onChangeTimeRange) props.onChangeTimeRange({ from: zFrom, to: zTo });
            },
          }));
      instRef.current = inst;
      return () => { instRef.current = null; inst.destroy(); };
    }, [mode, fit, apiUrl, showDetails, site, from, to, props.width, props.height]);

    React.useEffect(() => {
      const subs = [
        props.eventBus.subscribe(DataHoverEvent, ev => {
          if (localHoverRef.current) return;   // our own publish echoing back
          const t = ev.payload && ev.payload.point && ev.payload.point.time;
          if (t == null || !instRef.current) return;
          if (mode === 'grid' && !follow) return;
          // while the user hovers OUR strips, our mouse is authoritative —
          // other panels re-emit hover events that would fight the cursor
          if (instRef.current.isHovering && instRef.current.isHovering()) return;
          instRef.current.setExternalCursor(t);
        }),
        props.eventBus.subscribe(DataHoverClearEvent, () => {
          if (instRef.current && instRef.current.clearExternal) instRef.current.clearExternal();
        }),
      ];
      return () => subs.forEach(s => s.unsubscribe());
    }, [props.eventBus, mode, follow]);

    return React.createElement('div', {
      ref,
      style: { width: '100%', height: '100%', overflow: 'hidden' },
    });
  }

  const plugin = new PanelPlugin(TimelinePanel).setPanelOptions(function (builder) {
    builder
      .addTextInput({
        path: 'apiUrl',
        name: 'API URL',
        description: 'Frames API base URL (see docs/API.md). Empty = built-in demo data.',
        defaultValue: '',
      })
      .addTextInput({
        path: 'sites',
        name: 'Sites',
        description: 'Site filter expression, e.g. ${site:csv} or a literal site id. Keep the variable here so Grafana refreshes the panel when it changes.',
        defaultValue: '${site:csv}',
      })
      .addRadio({
        path: 'mode',
        name: 'Display mode',
        defaultValue: 'timeline',
        settings: {
          options: [
            { value: 'timeline', label: 'Timeline' },
            { value: 'grid', label: 'Multiview grid' },
          ],
        },
      })
      .addBooleanSwitch({
        path: 'followCrosshair',
        name: 'Follow shared crosshair',
        description: 'Show the frame at the crosshair time from other panels; otherwise the most recent frame in range',
        defaultValue: true,
        showIf: function (o) { return o.mode === 'grid'; },
      })
      .addBooleanSwitch({
        path: 'showDetails',
        name: 'Show cadence details',
        description: 'Per-source capture cadence and display resolution (debug/tuning info)',
        defaultValue: false,
      })
      .addRadio({
        path: 'imageFit',
        name: 'Image fit',
        description: 'Fit letterboxes the whole frame; fill crops to cover. Never stretches.',
        defaultValue: 'fit',
        settings: {
          options: [
            { value: 'fit', label: 'Fit' },
            { value: 'fill', label: 'Fill' },
          ],
        },
      });
  });

  return { plugin };
});
