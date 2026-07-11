"use strict";
var VTCore = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/core.ts
  var core_exports = {};
  __export(core_exports, {
    mountGrid: () => mountGrid,
    mountTimeline: () => mountTimeline
  });
  var STYLE_ID = "ktl-styles";
  var CSS = `
.ktl { display:flex; flex-direction:column; width:100%; height:100%; overflow:hidden;
       --ktl-bg:#181b1f; --ktl-bg2:#22262b; --ktl-border:#2c3235; --ktl-text:#ccccdc;
       --ktl-dim:#7b8087; --ktl-accent:#f2cc0c; --ktl-live:#73bf69; --ktl-off:#f2495c;
       --ktl-axis-grid:rgba(240,250,255,.09);
       color:var(--ktl-text); font:12px/1.4 -apple-system,"Segoe UI",Roboto,sans-serif; }
.ktl * { box-sizing:border-box; margin:0; padding:0; }
.ktl .cards { flex:1 1 auto; min-height:0; display:flex; flex-direction:column; gap:6px; overflow-y:auto; }
/* cards share panel height equally (fewer kiosks \u2192 taller strips), but
   never crush below a usable minimum \u2014 past that the list scrolls */
.ktl .card { flex:1 1 0; min-height:76px; display:flex; flex-direction:column; background:var(--ktl-bg2);
             border:1px solid var(--ktl-border); border-radius:4px; overflow:hidden; transition:opacity 120ms ease;
             position:relative; }
/* inline header: free-floating chip bubbles over the image's top-left \u2014
   hostname bubble on line one, the meta chips on line two \u2014 no scrim
   block. The optional gradient variant backs them with a full-height
   left-to-right fade for busy frames. Sits under the magnifier/crosshair
   and lets all pointer events through. */
.ktl .card.inline-head .card-head, .ktl .tile.inline-head .t-head {
  position:absolute; top:0; left:0; z-index:2; max-width:85%;
  flex-wrap:wrap; row-gap:2px; pointer-events:none; overflow:hidden; }
.ktl .card.inline-head .card-head { padding:5px 0 0 6px; max-height:46px; }
.ktl .tile.inline-head .t-head { padding:4px 0 0 5px; max-height:44px; }
.ktl .inline-brk { display:none; }
.ktl .card.inline-head .card-head .inline-brk, .ktl .tile.inline-head .t-head .inline-brk {
  display:block; width:100%; height:0; }
.ktl .card.inline-head .card-head .nm, .ktl .tile.inline-head .t-head .nm {
  background:#181b1f; border-radius:9px; padding:0 8px; }
.ktl .card.inline-head .card-head .st, .ktl .tile.inline-head .t-head .st {
  background:#181b1f; color:#b9bec6; }
.ktl .card.inline-head .card-head .ft:not(:empty) { background:#181b1f; border-radius:9px; padding:0 8px; }
/* gradient backing: strips fade left-to-right (header hugs the left
   edge); tiles fade top-to-bottom (the header spans the tile's top) */
.ktl .card.inline-grad .strip::before {
  content:""; position:absolute; top:0; bottom:0; left:0; width:42%;
  background:linear-gradient(90deg, rgba(0,0,0,.6), rgba(0,0,0,0));
  z-index:1; pointer-events:none; }
.ktl .tile.inline-grad .t-img::before {
  content:""; position:absolute; top:0; left:0; right:0; height:48%;
  background:linear-gradient(180deg, rgba(0,0,0,.6), rgba(0,0,0,0));
  z-index:1; pointer-events:none; }
.ktl.strip-hover .card:not(.hovered) { opacity:.45; }
.ktl .card-head { display:flex; align-items:center; gap:8px; padding:2px 8px; flex:0 0 auto; color:var(--ktl-dim);
                   flex-wrap:nowrap; overflow:hidden; min-width:0; }
.ktl .card-head .nm { flex:0 0 auto; }
/* chips never wrap: the container wraps instead and clamps to one row,
   so a chip either fits whole or drops out of view (title has it all) */
.ktl .card-head .tags { display:flex; gap:4px; overflow:hidden; min-width:0; flex-shrink:10;
                        flex-wrap:wrap; max-height:17px; align-content:flex-start; }
.ktl .card-head .tags .st { flex:0 0 auto; }
.ktl .card-head .nm { font-weight:600; color:var(--ktl-text); }
.ktl .card-head .st, .ktl .t-head .st { font-size:10px; color:var(--ktl-dim); border:1px solid var(--ktl-border);
                      border-radius:8px; padding:0 6px; white-space:nowrap; }
.ktl .card-head .ft { font-variant-numeric:tabular-nums; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0; flex-shrink:1; }
.ktl .card-head .ft.stale { color:var(--ktl-off); }
.ktl .card-head .cad { margin-left:auto; font-size:10px; color:var(--ktl-dim); }
.ktl .strip { flex:1 1 auto; min-height:0; position:relative; display:flex; align-items:stretch;
              cursor:crosshair; background:#111; }
.ktl .slot { flex:1 1 0; min-width:0; position:relative; overflow:hidden; }
/* Frame delineation tints the FRAME: overflow clips the img to the padding
   box, so a border column would expose the #111 strip bg underneath and
   read as a hard black line on any content. An ::after overlay stacks above
   the image instead. Emboss: dark line + light inner edge \u2014 each half only
   reads against opposing content, so the seam shades light frames and
   highlights dark ones. */
.ktl .strip.sep .slot + .slot::after { content:""; position:absolute; top:0; bottom:0; left:0;
  width:1px; background:rgba(0,0,0,.05); box-shadow:1px 0 0 rgba(255,255,255,.12);
  pointer-events:none; z-index:1; }
.ktl .slot img { position:absolute; top:0; left:50%; transform:translateX(-50%); height:100%; width:auto; }
.ktl .slot.gap { background:repeating-linear-gradient(45deg,#1b1215,#1b1215 5px,#2a171b 5px,#2a171b 10px); }
.ktl .slot.paused { background:repeating-linear-gradient(45deg,#15171a,#15171a 7px,#232830 7px,#232830 14px); }
/* pause REASONS: one color grammar with the dashboards \u2014 planned = distinct
 * cool hues (indigo = screen asleep, violet-slate = system down, teal = app
 * stopped), unintended = amber, undeclared silence stays the red .gap.
 * Reason classes replace the hatch; .unintended overrides them all. */
.ktl .slot.paused.r-screen-sleep { background:repeating-linear-gradient(45deg,#182a4e,#182a4e 7px,#223c6e 7px,#223c6e 14px); }
.ktl .slot.paused.r-system-down { background:repeating-linear-gradient(45deg,#28204a,#28204a 7px,#372c66 7px,#372c66 14px); }
.ktl .slot.paused.r-app-stopped { background:repeating-linear-gradient(45deg,#123832,#123832 7px,#1a4c44 7px,#1a4c44 14px); }
.ktl .slot.paused.unintended { background:repeating-linear-gradient(45deg,#4a350e,#4a350e 7px,#614614 7px,#614614 14px); }
/* hatch continuity: each slot is its own element, so a per-element gradient
 * restarts at every slot edge \u2014 a run of narrow slots shows only the first
 * stripe color and reads as a SOLID block. buildCard aligns each empty
 * slot's background-position to its offset in the strip, so the diagonals
 * run continuously across runs. (NOT background-attachment:fixed \u2014 Chrome
 * refuses to paint fixed backgrounds inside Grafana's transformed panels.)
 * A wide pause band also carries its label inline \u2014 a strip that is ALL
 * pause should say why without requiring a hover. */
.ktl .slot .band-label { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
  font-size:10px; font-weight:700; letter-spacing:.06em; color:var(--ktl-dim);
  white-space:nowrap; overflow:hidden; pointer-events:none; }
.ktl .slot.r-screen-sleep .band-label { color:#8fb0e8; }
.ktl .slot.r-system-down .band-label { color:#a897e0; }
.ktl .slot.r-app-stopped .band-label { color:#6fc4b4; }
.ktl .slot.unintended .band-label { color:#e8b155; }
/* the ONE pending slot (its tick passed, frame in flight) pulses gently \u2014
 * in limbo, not offline. Everything further ahead is one inert .beyond
 * filler: the future is unknown, so it gets no shading at all. */
.ktl .slot.future { background:transparent; position:relative; }
.ktl .slot.future::before { content:""; position:absolute; inset:0; background:#232830;
  animation:ktl-limbo 2.2s ease-in-out infinite; }
@keyframes ktl-limbo { 0%,100% { opacity:.15 } 50% { opacity:.55 } }
.ktl .slot.beyond { background:var(--ktl-bg2); }
.ktl .slot.beyond .bt { position:absolute; top:0; bottom:0; width:1px; background:var(--ktl-axis-grid); }
.ktl .mag.off { display:none; }
.ktl .boot-err { flex:1 1 auto; display:flex; align-items:center; justify-content:center;
                 color:var(--ktl-off); font-size:12px; text-align:center; padding:14px; }
.ktl .mag.future { border-color:var(--ktl-dim); }
.ktl .mag.future img { display:none; }
.ktl .card-head .ft.paused.r-screen-sleep, .ktl .tile.paused.r-screen-sleep .t-off { color:#8fb0e8; }
.ktl .card-head .ft.paused.r-system-down, .ktl .tile.paused.r-system-down .t-off { color:#a897e0; }
.ktl .card-head .ft.paused.r-app-stopped, .ktl .tile.paused.r-app-stopped .t-off { color:#6fc4b4; }
.ktl .card-head .ft.paused.unintended, .ktl .tile.paused.unintended .t-off { color:#e8b155; }
.ktl .mag.paused { border-color:var(--ktl-dim); }
.ktl .mag.paused img { display:none; }
.ktl .card-head .ft.paused { color:var(--ktl-dim); }
.ktl .tile.paused { border-color:var(--ktl-dim); }
.ktl .tile.paused .t-off { display:flex; color:var(--ktl-dim);
  background:repeating-linear-gradient(45deg,#17191c,#17191c 7px,#1d2024 7px,#1d2024 14px); }
.ktl .tile.paused img, .ktl .tile.paused .t-ts { display:none; }
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
.ktl .ann-lane { flex:0 0 13px; position:relative; margin:2px 1px 0; }
.ktl .card-lane { flex:0 0 12px; position:relative; display:none; border-top:1px solid var(--ktl-border); }
.ktl .card.has-lane .card-lane { display:block; }
.ktl .card-lane .ann { top:50%; }
.ktl .card-lane .ann-region { top:2px; bottom:2px; }
.ktl .ann { position:absolute; width:7px; height:7px; transform:translate(-50%,-50%) rotate(45deg);
            background:#5794F2; border:1px solid #0b0c0e; cursor:pointer; z-index:6; }
.ktl .ann.multi { width:11px; height:11px; }
.ktl .ann .n { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
  transform:rotate(-45deg); font:700 8px/1 -apple-system,"Segoe UI",Roboto,sans-serif; color:#fff;
  text-shadow:0 0 2px #000,0 0 2px #000; pointer-events:none; }
.ktl .ann-lane .ann { top:50%; }
.ktl .strip .ann { top:auto; bottom:0; transform:translate(-50%,50%) rotate(45deg); }
.ktl .ann-region { position:absolute; top:0; bottom:0; background:rgba(87,148,242,.12);
                   border-left:1px dashed rgba(87,148,242,.55); border-right:1px dashed rgba(87,148,242,.55);
                   pointer-events:none; z-index:1; }
.ktl .ann-lane .ann-region { top:3px; bottom:3px; }
.ktl-ann-tip { position:fixed; z-index:1070; background:#0b0c0e; border:1px solid #2c3235; border-radius:4px;
               padding:6px 9px; max-width:340px; color:#ccccdc; box-shadow:0 8px 32px rgba(0,0,0,.7);
               font:11px/1.5 -apple-system,"Segoe UI",Roboto,sans-serif; pointer-events:none; }
.ktl-ann-tip.pinned { pointer-events:auto; border-color:#f2cc0c; user-select:text; }
.ktl-ann-tip a { color:#6e9fff; text-decoration:underline; }
.ktl-ann-tip .at { display:flex; gap:8px; align-items:baseline; }
.ktl-ann-tip .at b { color:#fff; }
.ktl-ann-tip .at .tm { color:#7b8087; font-variant-numeric:tabular-nums; margin-left:auto; }
.ktl-ann-tip .ax { color:#9aa0a6; white-space:pre-wrap; }
.ktl-ann-tip .ag { display:flex; gap:4px; flex-wrap:wrap; margin-top:2px; }
.ktl-ann-tip .ag span { font-size:10px; color:#7b8087; border:1px solid #2c3235; border-radius:8px; padding:0 6px; }
.ktl-ann-tip .item + .item { border-top:1px solid #1d2024; margin-top:5px; padding-top:5px; }
.ktl .axis { flex:0 0 24px; position:relative; margin:4px 1px 0; overflow:hidden; }
.ktl .axis .base { position:absolute; top:0; left:0; right:0; height:1px; background:var(--ktl-axis-grid); }
.ktl .tick { position:absolute; top:0; transform:translateX(-50%); color:var(--ktl-text); font-size:12px;
             font-family:'Inter','Helvetica','Arial',sans-serif;
             font-variant-numeric:tabular-nums; padding-top:5px; white-space:nowrap; }
.ktl .tick::before { content:""; position:absolute; top:0; left:50%; width:1px; height:4px; background:var(--ktl-axis-grid); }
.ktl .acur { position:absolute; top:0; transform:translateX(-50%); color:#111; background:var(--ktl-accent);
             font-size:10px; font-weight:700; font-variant-numeric:tabular-nums; padding:0 5px;
             border-radius:2px; margin-top:5px; white-space:nowrap; z-index:2; }
.ktl .acur::before { content:""; position:absolute; top:-5px; left:50%; width:1px; height:5px; background:var(--ktl-accent); }
.ktl .grid { flex:1 1 auto; min-height:0; display:grid; gap:8px; overflow:auto;
             grid-template-columns:repeat(auto-fit, minmax(170px, 1fr)); grid-auto-rows:minmax(110px, 1fr); }
.ktl .tile { display:flex; flex-direction:column; background:var(--ktl-bg2);
             border:1px solid var(--ktl-border); border-radius:4px; overflow:hidden; cursor:zoom-in;
             position:relative; }
.ktl .tile .t-head { display:flex; gap:6px; align-items:center; padding:2px 6px; color:var(--ktl-dim); flex:0 0 auto;
                     flex-wrap:nowrap; overflow:hidden; min-width:0; }
.ktl .tile .t-head .nm { flex:0 0 auto; }
.ktl .tile .t-head .tags { display:flex; gap:4px; overflow:hidden; min-width:0; flex-shrink:10;
                           flex-wrap:wrap; max-height:17px; align-content:flex-start; }
.ktl .tile .t-head .tags .st { flex:0 0 auto; }
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
      const s = document.createElement("style");
      s.id = STYLE_ID;
      s.textContent = CSS;
      document.head.appendChild(s);
    }
  }
  var SITES = {
    "site-a": [
      { id: "source-1", cadence: 6e4, tags: { env: "prod" } },
      { id: "source-2", cadence: 6e4 },
      { id: "source-3", cadence: 12e4 }
    ],
    "site-b": [
      { id: "source-4", cadence: 6e4 },
      { id: "source-5", cadence: 3e4, tags: { orient: "portrait" } }
    ]
  };
  var HUES = { "source-1": 205, "source-2": 275, "source-3": 25, "source-4": 130, "source-5": 340 };
  var DIMS = { "source-3": [288, 216], "source-5": [216, 384] };
  var fmtTime = (ts) => new Date(ts).toLocaleTimeString("en-AU", { hour12: false });
  var fmtShort = (ts) => new Date(ts).toLocaleTimeString("en-AU", { hour12: false, hour: "2-digit", minute: "2-digit" });
  var fmtDur = (ms) => ms % 36e5 === 0 ? ms / 36e5 + "h" : ms % 6e4 === 0 ? ms / 6e4 + "m" : ms / 1e3 + "s";
  function makeBackend(P, SPAN) {
    function renderMockFrame(site, kiosk, ts, step) {
      const dims = DIMS[kiosk] || [384, 216];
      const w = dims[0], h = dims[1];
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const g = c.getContext("2d");
      const hue = HUES[kiosk] != null ? HUES[kiosk] : 130;
      g.fillStyle = "hsl(" + hue + " 30% 14%)";
      g.fillRect(0, 0, w, h);
      g.fillStyle = "hsl(" + hue + " 60% 30%)";
      g.fillRect(0, 0, w, Math.round(h * 0.14));
      g.fillStyle = "#fff";
      g.font = "bold " + Math.round(h * 0.06) + "px sans-serif";
      g.fillText(site + " / " + kiosk, 8, Math.round(h * 0.1));
      g.font = "bold " + Math.round(Math.min(w * 0.16, h * 0.18)) + "px monospace";
      g.fillStyle = "hsl(" + hue + " 70% 72%)";
      g.textAlign = "center";
      g.fillText(fmtTime(ts), w / 2, h * 0.55);
      g.textAlign = "left";
      const phase = ts / step % 20 / 20;
      g.fillStyle = "hsl(" + hue + " 80% 55%)";
      g.fillRect(w * 0.04 + phase * (w * 0.8), h * 0.72, w * 0.13, h * 0.16);
      return c.toDataURL("image/jpeg", 0.7);
    }
    return {
      kiosks(sites) {
        return Object.entries(SITES).filter(([s]) => !sites || sites.includes(s)).flatMap(([s, ks]) => ks.map((k) => {
          const decl = Object.assign({}, k, { site: s, location: "demo" });
          if (k.id === "source-3") {
            decl.history = [
              { since: P.from - 864e5, variant: "lo", cadence: 12e4 },
              { since: P.from + SPAN * 0.5, variant: "lo", cadence: 24e4 }
            ];
            decl.cadence = 24e4;
          }
          if (k.id === "source-4") {
            decl.history = [
              { since: P.from - 864e5, variant: "lo", cadence: 6e4 },
              // demo the reason+intent vocabulary: an UNINTENDED screen-off
              // (power-policy blank) renders amber, not neutral
              { since: P.from + SPAN * 0.2, variant: "lo", paused: true, reason: "screen-sleep", intended: false }
            ];
          }
          return decl;
        }));
      },
      frames(site, kiosk, from, to, step) {
        const out = [];
        const gapA = P.from + SPAN * 0.35, gapB = P.from + SPAN * 0.55;
        const first = Math.ceil(from / step) * step;
        for (let ts = first; ts <= Math.min(to, Date.now()); ts += step) {
          if (kiosk === "source-2" && ts > gapA && ts < gapB) continue;
          if (kiosk === "source-4" && ts > P.from + SPAN * 0.2 && ts < P.from + SPAN * 0.45) continue;
          out.push({ kiosk, ts, url: renderMockFrame(site, kiosk, ts, step) });
        }
        return Promise.resolve(out);
      },
      /* demo annotations — in Grafana these come from the dashboard's own
       * annotation queries (any data source); this is only the mock seam.
       * Deliberately one of each supported shape: global point, source point,
       * global region, source-scoped region (explains source-2's red outage),
       * and a colored burst tight enough to cluster into one ×3 marker. */
      annotations() {
        return [
          { ts: P.from + SPAN * 0.3, title: "deploy v2.4.1", text: "rollout to site-a \u2014 https://example.com/releases/v2.4.1", tags: ["deploy"] },
          { ts: P.from + SPAN * 0.6, title: "app restart", text: "watchdog restarted the shell", tags: ["source:source-1"] },
          { ts: P.from + SPAN * 0.85, title: "gateway reboot", text: "site-b uplink flapped during carrier work", tags: ["site:site-b", "network"] },
          { ts: P.from + SPAN * 0.68, timeEnd: P.from + SPAN * 0.78, title: "content sync", text: "nightly asset refresh", tags: ["maintenance"] },
          {
            ts: P.from + SPAN * 0.35,
            timeEnd: P.from + SPAN * 0.55,
            title: "backend outage",
            text: "upstream API down \u2014 source-2 dark",
            tags: ["source:source-2", "incident"],
            color: "#ff9830"
          },
          { ts: P.from + SPAN * 0.52, title: "alert: high CPU", text: "firing", tags: ["alert"], color: "#f2495c" },
          { ts: P.from + SPAN * 0.522, title: "alert: high CPU", text: "still firing", tags: ["alert"], color: "#f2495c" },
          { ts: P.from + SPAN * 0.524, title: "alert: high CPU", text: "resolved", tags: ["alert"], color: "#f2495c" }
        ];
      }
    };
  }
  function normAnnotations(raw, P) {
    const out = [];
    for (const a of raw || []) {
      const ts = Number(a.ts != null ? a.ts : a.time);
      if (!Number.isFinite(ts)) continue;
      let end = a.timeEnd != null ? Number(a.timeEnd) : NaN;
      if (!Number.isFinite(end) || end <= ts) end = null;
      if ((end || ts) < P.from || ts > P.to) continue;
      const tags = Array.isArray(a.tags) ? a.tags.map(String) : a.tags ? String(a.tags).split(",").map((s) => s.trim()).filter(Boolean) : [];
      let source = a.source || null;
      let siteScope = null;
      for (const t of tags) {
        const m = /^(?:source|kiosk):(.+)$/.exec(t);
        if (m) source = m[1];
        const ms = /^site:(.+)$/.exec(t);
        if (ms) siteScope = ms[1];
      }
      out.push({ ts, timeEnd: end, title: a.title || "", text: a.text || "", tags, color: a.color || "", source, siteScope });
    }
    return out.sort((x, y) => x.ts - y.ts);
  }
  var annTipEl = null;
  var annTipPinned = false;
  function annTip() {
    if (!annTipEl) {
      annTipEl = document.createElement("div");
      annTipEl.className = "ktl-ann-tip";
      annTipEl.style.display = "none";
      document.body.appendChild(annTipEl);
      document.addEventListener("click", (e) => {
        if (annTipPinned && !annTipEl.contains(e.target)) close();
      });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && annTipPinned) close();
      });
    }
    const el = annTipEl;
    function linkify(host, text) {
      const parts = String(text).split(/(https?:\/\/[^\s]+)/g);
      for (const part of parts) {
        if (/^https?:\/\//.test(part)) {
          const a = document.createElement("a");
          a.href = part;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          a.textContent = part;
          host.appendChild(a);
        } else if (part) {
          host.appendChild(document.createTextNode(part));
        }
      }
    }
    function render(items, x, y) {
      el.textContent = "";
      for (const a of items) {
        const item = document.createElement("div");
        item.className = "item";
        const head = document.createElement("div");
        head.className = "at";
        const b = document.createElement("b");
        b.textContent = a.title || "annotation";
        const tm = document.createElement("span");
        tm.className = "tm";
        tm.textContent = fmtTime(a.ts) + (a.timeEnd ? " \u2192 " + fmtTime(a.timeEnd) : "");
        head.appendChild(b);
        head.appendChild(tm);
        item.appendChild(head);
        if (a.text) {
          const tx = document.createElement("div");
          tx.className = "ax";
          linkify(tx, a.text);
          item.appendChild(tx);
        }
        const shown = a.tags.filter((t) => !/^(?:source|kiosk|site):/.test(t));
        if (shown.length) {
          const tg = document.createElement("div");
          tg.className = "ag";
          for (const t of shown) {
            const s = document.createElement("span");
            s.textContent = t;
            tg.appendChild(s);
          }
          item.appendChild(tg);
        }
        el.appendChild(item);
      }
      el.style.display = "block";
      const r = el.getBoundingClientRect();
      el.style.left = Math.max(4, Math.min(window.innerWidth - r.width - 4, x - r.width / 2)) + "px";
      el.style.top = Math.max(4, y - r.height - 10) + "px";
    }
    function close() {
      annTipPinned = false;
      el.classList.remove("pinned");
      el.style.display = "none";
    }
    return {
      show(items, x, y) {
        if (!annTipPinned) render(items, x, y);
      },
      pin(items, x, y) {
        annTipPinned = true;
        el.classList.add("pinned");
        render(items, x, y);
      },
      hide() {
        if (!annTipPinned) el.style.display = "none";
      },
      close
    };
  }
  function makeApiBackend(apiUrl, apiKey) {
    const base = apiUrl.replace(/\/+$/, "");
    const opts = () => ({
      headers: apiKey ? { authorization: "Bearer " + apiKey } : void 0,
      signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(15e3) : void 0
    });
    return {
      async kiosks(sites) {
        const u = new URL(base + "/sources");
        if (sites) u.searchParams.set("site", sites.join(","));
        const r = await fetch(u, opts());
        if (!r.ok) throw new Error("kiosks " + r.status);
        return r.json();
      },
      async frames(site, kiosk, from, to, step) {
        const u = new URL(base + "/frames");
        u.searchParams.set("site", site);
        u.searchParams.set("source", kiosk);
        u.searchParams.set("from", String(Math.round(from)));
        u.searchParams.set("to", String(Math.round(to)));
        u.searchParams.set("step", String(step));
        u.searchParams.set("variant", "lo");
        const r = await fetch(u, opts());
        if (!r.ok) throw new Error("frames " + r.status);
        const frames = await r.json();
        if (apiKey) {
          for (const f of frames) f.url += (f.url.includes("?") ? "&" : "?") + "k=" + encodeURIComponent(apiKey);
        }
        return frames;
      }
    };
  }
  function hiUrlFor(frame, decl, apiUrl, apiKey) {
    if (!apiUrl || !decl.hiCadence) return null;
    const hiTs = Math.round(frame.ts / decl.hiCadence) * decl.hiCadence;
    return apiUrl.replace(/\/+$/, "") + "/frame/hi/" + decl.site + "/" + decl.id + "/" + hiTs + ".jpg" + (apiKey ? "?k=" + encodeURIComponent(apiKey) : "");
  }
  function parseVar(v) {
    if (!v || v === "All" || v === "$__all") return null;
    return v.replace(/^\{|\}$/g, "").split(",").map((s) => s.trim()).filter(Boolean);
  }
  function erasFor(decl, P) {
    const hist = (decl.history || []).filter((h) => (h.variant || "lo") === "lo").slice().sort((a, b) => a.since - b.since);
    let runCad = decl.cadence || 6e4;
    if (hist.length && hist[0].cadence) runCad = hist[0].cadence;
    const evts = [{ since: -864e13, cadence: runCad, paused: false, reason: void 0, intended: void 0 }];
    for (const h of hist) evts.push({ since: h.since, cadence: h.cadence, paused: !!h.paused, reason: h.reason, intended: h.intended });
    const eras = [];
    for (let i = 0; i < evts.length; i++) {
      const e = evts[i];
      const next = evts[i + 1];
      if (e.cadence) runCad = e.cadence;
      const from = Math.max(e.since, P.from);
      const to = Math.min(next ? next.since : P.to, P.to);
      if (to <= from) continue;
      const prev = eras[eras.length - 1];
      if (prev && prev.paused === !!e.paused && prev.cadence === runCad && prev.reason === e.reason && prev.intended === e.intended) {
        prev.to = to;
        continue;
      }
      eras.push({ from, to, cadence: runCad, paused: !!e.paused, reason: e.reason, intended: e.intended });
    }
    if (!eras.length) eras.push({ from: P.from, to: P.to, cadence: runCad, paused: false });
    return eras;
  }
  var PAUSE_CLASSES = ["paused", "unintended", "r-quiet", "r-screen-sleep", "r-app-stopped", "r-system-down"];
  function pauseInfo(x) {
    const r = x && x.reason;
    const unintended = !!x && x.intended === false;
    const label = r === "screen-sleep" ? unintended ? "SCREEN DARK (UNEXPECTED)" : "SCREEN ASLEEP" : r === "system-down" ? "SYSTEM DOWN (PLANNED)" : r === "app-stopped" ? "APP STOPPED" : r === "quiet" ? "QUIET HOURS" : "PAUSED";
    const classes = ["paused"];
    if (r) classes.push("r-" + r);
    if (unintended) classes.push("unintended");
    return { label, classes };
  }
  async function buildSourceModel(decl, P, backend, budgetSlots) {
    const eras = erasFor(decl, P);
    const slots = [];
    const totalActive = eras.filter((e) => !e.paused).reduce((a, e) => a + (e.to - e.from), 0) || 1;
    async function pushActive(era) {
      if (era.to - era.from <= 0) return;
      const eraSpan = era.to - era.from;
      const share = Math.max(4, Math.round(budgetSlots * (eraSpan / totalActive)));
      const raw = Math.max(1, Math.ceil(eraSpan / era.cadence));
      const step = Math.ceil(raw / Math.min(share, raw)) * era.cadence;
      const frames = await backend.frames(decl.site, decl.id, era.from, era.to, step);
      const start = Math.ceil(era.from / step) * step;
      const n = Math.max(1, Math.floor((era.to - start) / step) + 1);
      const by = new Map(frames.map((f) => [Math.round((f.ts - start) / step), f]));
      const nowMs = Date.now();
      for (let i = 0; i < n; i++) {
        const ts = start + i * step;
        slots.push({ ts, span: step, frame: by.get(i) || null, cadence: era.cadence, step, future: ts + step > nowMs });
      }
    }
    const nowAtBuild = Date.now();
    const horizon = Math.min(P.to, nowAtBuild);
    for (const era of eras) {
      const eFrom = era.from;
      const eTo = Math.min(era.to, horizon);
      const isTail = era === eras[eras.length - 1];
      if (!era.paused) {
        if (eTo > eFrom) await pushActive({ from: eFrom, to: eTo, cadence: era.cadence });
        continue;
      }
      if (!isTail) {
        if (eTo > eFrom) slots.push({ ts: eFrom, span: eTo - eFrom, paused: true, reason: era.reason, intended: era.intended });
        continue;
      }
      if (eTo <= eFrom) continue;
      const probe = await backend.frames(decl.site, decl.id, eFrom, eTo, era.cadence);
      const resume = probe.find((f) => f.ts >= eFrom + era.cadence && f.ts < eTo);
      if (resume) {
        const resumeTs = resume.ts;
        slots.push({ ts: eFrom, span: resumeTs - eFrom, paused: true, reason: era.reason, intended: era.intended });
        if (eTo > resumeTs) await pushActive({ from: resumeTs, to: eTo, cadence: era.cadence });
      } else {
        slots.push({ ts: eFrom, span: eTo - eFrom, paused: true, reason: era.reason, intended: era.intended });
      }
    }
    if (P.to > horizon) {
      const last = slots[slots.length - 1];
      const covered = !last ? horizon : last.paused || last.beyond ? last.ts + last.span : last.ts + last.step / 2;
      const fillerFrom = Math.min(Math.max(covered, horizon - 1), P.to);
      if (P.to - fillerFrom > 0) slots.push({ ts: fillerFrom, span: P.to - fillerFrom, beyond: true });
    }
    function slotAt(t) {
      for (const sl of slots) {
        const edge = sl.paused || sl.beyond;
        const from = edge ? sl.ts : sl.ts - sl.span / 2;
        const to = edge ? sl.ts + sl.span : sl.ts + sl.span / 2;
        if (t < to) {
          if (sl.beyond) {
            const i = slots.indexOf(sl);
            const prev = i > 0 ? slots[i - 1] : null;
            if (prev && !prev.beyond && t < sl.ts + (prev.step || 0) / 2) return prev;
          }
          return t >= from || sl === slots[0] ? sl : sl;
        }
      }
      return slots[slots.length - 1] || null;
    }
    const lastActive = [...slots].reverse().find((sl) => !sl.paused && !sl.beyond) || null;
    return { eras, slots, slotAt, lastActive };
  }
  function parseTagFilter(expr) {
    if (!expr) return null;
    const out = {};
    for (const part of String(expr).split(",")) {
      const i = part.indexOf("=");
      if (i > 0) out[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim().toLowerCase();
    }
    return Object.keys(out).length ? out : null;
  }
  function matchesTags(tags, filter) {
    if (!filter) return true;
    if (!tags) return false;
    for (const k in filter) {
      if (String(tags[k] == null ? "" : tags[k]).toLowerCase() !== filter[k]) return false;
    }
    return true;
  }
  function tagChips(decl) {
    if (!decl.tags) return "";
    const chips = Object.entries(decl.tags).map(([k, v]) => '<span class="st">' + k + ":" + v + "</span>").join("");
    return '<span class="tags">' + chips + "</span>";
  }
  function headTitle(decl) {
    const parts = [decl.site];
    if (decl.location) parts.push(decl.location);
    if (decl.tags) for (const [k, v] of Object.entries(decl.tags)) parts.push(k + ":" + v);
    return parts.join(" \xB7 ");
  }
  var TICK_STEPS = [
    6e4,
    5 * 6e4,
    10 * 6e4,
    15 * 6e4,
    30 * 6e4,
    36e5,
    2 * 36e5,
    3 * 36e5,
    6 * 36e5,
    12 * 36e5,
    24 * 36e5,
    2 * 864e5,
    3 * 864e5,
    4 * 864e5,
    5 * 864e5,
    6 * 864e5,
    7 * 864e5,
    8 * 864e5,
    9 * 864e5,
    10 * 864e5,
    15 * 864e5,
    30 * 864e5,
    90 * 864e5,
    365 * 864e5
  ];
  function alignedStart(ts, stepMs) {
    const d = new Date(ts);
    if (stepMs >= 30 * 864e5) {
      d.setHours(0, 0, 0, 0), d.setDate(1);
    } else if (stepMs >= 864e5) {
      d.setHours(0, 0, 0, 0);
    } else if (stepMs >= 36e5) {
      const stepHr = stepMs / 36e5;
      d.setHours(Math.floor(d.getHours() / stepHr) * stepHr, 0, 0, 0);
    } else {
      const stepMin = stepMs / 6e4;
      d.setMinutes(Math.floor(d.getMinutes() / stepMin) * stepMin, 0, 0);
    }
    return d;
  }
  function nextTick(d, stepMs) {
    if (stepMs >= 30 * 864e5) d.setMonth(d.getMonth() + Math.round(stepMs / (30 * 864e5)));
    else if (stepMs >= 864e5) d.setDate(d.getDate() + stepMs / 864e5);
    else d.setTime(+d + stepMs);
    return d;
  }
  function tickFormat(stepMs) {
    if (stepMs < 36e5) return fmtShort;
    if (stepMs < 24 * 36e5)
      return (ts) => new Date(ts).toLocaleString("en-AU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
    if (stepMs < 365 * 864e5)
      return (ts) => new Date(ts).toLocaleDateString("en-AU", { day: "2-digit", month: "2-digit" });
    return (ts) => String(new Date(ts).getFullYear());
  }
  var TICK_FONT = '10px -apple-system, "Segoe UI", Roboto, sans-serif';
  var TICK_LABEL_GAP = 14;
  var measureCtx;
  function measureTickWidth(text) {
    if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
    measureCtx.font = TICK_FONT;
    return measureCtx.measureText(text).width;
  }
  var popState = { el: null, keyH: null, retireTimer: null };
  function closePreview() {
    if (popState.retireTimer) {
      clearTimeout(popState.retireTimer);
      popState.retireTimer = null;
    }
    if (popState.el) {
      popState.el.remove();
      popState.el = null;
    }
    if (popState.keyH) {
      document.removeEventListener("keydown", popState.keyH);
      popState.keyH = null;
    }
  }
  function makePreview() {
    if (popState.retireTimer) {
      clearTimeout(popState.retireTimer);
      popState.retireTimer = null;
    }
    return {
      open(site, kiosk, frame, x, y, hiUrl) {
        closePreview();
        const el = document.createElement("div");
        el.className = "ktl-pop";
        el.innerHTML = '<img alt="frame"><div class="cap"></div>';
        const img = el.querySelector("img");
        el.querySelector(".cap").textContent = site + " / " + kiosk + " \u2014 " + fmtTime(frame.ts);
        el.addEventListener("click", closePreview);
        document.body.appendChild(el);
        const place = () => {
          if (!el.isConnected) return;
          const r = el.getBoundingClientRect();
          el.style.left = Math.max(8, Math.min(window.innerWidth - r.width - 8, x + 14)) + "px";
          el.style.top = Math.max(8, Math.min(window.innerHeight - r.height - 8, y - r.height / 2)) + "px";
        };
        img.onload = place;
        img.onerror = () => {
          img.onerror = null;
          img.src = frame.url;
        };
        img.src = hiUrl || frame.url;
        place();
        popState.el = el;
        popState.keyH = (e) => {
          if (e.key === "Escape") closePreview();
        };
        document.addEventListener("keydown", popState.keyH);
      },
      close: closePreview,
      retire() {
        if (popState.el && !popState.retireTimer) {
          popState.retireTimer = setTimeout(closePreview, 1500);
        }
      }
    };
  }
  function makeWrapper(root) {
    const wrap = document.createElement("div");
    wrap.className = "ktl";
    root.style.position = "relative";
    wrap.style.position = "absolute";
    wrap.style.inset = "0";
    wrap.style.visibility = "hidden";
    root.appendChild(wrap);
    return wrap;
  }
  async function revealWrapper(root, wrap) {
    const imgs = [...wrap.querySelectorAll("img")];
    await Promise.race([
      Promise.allSettled(imgs.map((i) => i.decode ? i.decode().catch(() => {
      }) : Promise.resolve())),
      new Promise((res) => setTimeout(res, 900))
    ]);
    if (!wrap.isConnected) return;
    for (const el of [...root.children]) if (el !== wrap) el.remove();
    wrap.style.visibility = "";
  }
  function retireWrapper(wrap) {
    wrap.dataset.stale = "1";
    setTimeout(() => wrap.remove(), 1500);
  }
  function mountTimeline(root, cfg) {
    injectStyles();
    const P = { site: parseVar(cfg.site), source: parseVar(cfg.source), from: cfg.from, to: cfg.to };
    const SPAN = Math.max(1, P.to - P.from);
    const LIVE = P.to > Date.now() - 2 * 60 * 1e3;
    const MIN_SLICE_PX = 7;
    const hostWidth = cfg.width || root.clientWidth || 800;
    const pxBudget = Math.max(10, Math.floor((hostWidth - 20) / MIN_SLICE_PX));
    const backend = cfg.apiUrl ? makeApiBackend(cfg.apiUrl, cfg.apiKey) : makeBackend(P, SPAN);
    const wrap = makeWrapper(root);
    wrap.classList.toggle("fill", cfg.fit === "fill");
    wrap.innerHTML = '<div class="cards"></div><div class="ann-lane" style="display:none"></div><div class="axis"><div class="base"></div><div class="acur"></div></div>';
    const q = (sel) => wrap.querySelector(sel);
    function restoreCursor() {
      const saved = Number(root.dataset.ktlCursor);
      if (root.dataset.ktlPinned === "1" && Number.isFinite(saved)) {
        return Math.max(P.from, Math.min(P.to, saved));
      }
      return Math.min(P.to, Date.now());
    }
    let kiosks = [], cards = {}, cursorT = restoreCursor(), destroyed = false, pollTimer = null;
    const axisTickList = [];
    let suppressClick = false;
    const pv = makePreview();
    function showSelection(fa, fb) {
      const a = Math.min(fa, fb), b = Math.max(fa, fb);
      for (const k of kiosks) {
        const c = cards[k.id];
        if (!c) continue;
        const w = c.strip.clientWidth;
        c.sel.style.display = "block";
        c.sel.style.left = a * w + "px";
        c.sel.style.width = (b - a) * w + "px";
      }
    }
    function hideSelection() {
      for (const k of kiosks) if (cards[k.id]) cards[k.id].sel.style.display = "none";
    }
    function dressStrip(model) {
      for (const sl of model.slots) {
        if (!sl.el || sl.frame) continue;
        sl.el.style.backgroundPosition = -sl.el.offsetLeft + "px 0";
        if (sl.paused && sl.el.offsetWidth >= 90 && !sl.el.querySelector(".band-label")) {
          const lab = document.createElement("span");
          lab.className = "band-label";
          lab.textContent = pauseInfo(sl).label;
          sl.el.appendChild(lab);
        }
      }
    }
    function dressAll(tries) {
      const anySized = kiosks.some((k) => cards[k.id] && cards[k.id].strip.clientWidth > 0);
      if (!anySized) {
        if (tries > 0 && !destroyed) setTimeout(() => dressAll(tries - 1), 500);
        return;
      }
      for (const k of kiosks) if (cards[k.id]) dressStrip(cards[k.id].model);
    }
    function buildCard(decl, model) {
      const kiosk = decl.id;
      const card = document.createElement("div");
      const inline = cfg.headerMode === "inline" || cfg.headerMode === "inline-gradient";
      card.className = "card" + (inline ? " inline-head" : "") + (cfg.headerMode === "inline-gradient" ? " inline-grad" : "");
      const la = model.lastActive;
      const cad = cfg.showDetails && la ? '<span class="cad">\u23F1 ' + fmtDur(la.cadence) + " \xB7 1/" + fmtDur(la.step) + (la.step > la.cadence ? " \u2193" : "") + "</span>" : "";
      card.innerHTML = '<div class="card-head" title="' + headTitle(decl) + '"><span class="nm">' + kiosk + '</span><span class="inline-brk"></span><span class="st">' + decl.site + (decl.location ? " \xB7 " + decl.location : "") + "</span>" + tagChips(decl) + '<span class="ft"></span>' + cad + '</div><div class="strip"><div class="xh"></div><div class="sel"></div><div class="mag"><img alt=""><div class="cap"></div></div></div><div class="card-lane"></div>';
      const strip = card.querySelector(".strip");
      if (hostWidth / model.slots.length >= 12) strip.classList.add("sep");
      const slots = model.slots;
      for (const sl of slots) {
        const el = document.createElement("div");
        el.className = "slot" + (sl.paused ? " " + pauseInfo(sl).classes.join(" ") : sl.beyond ? " beyond" : sl.frame ? "" : sl.future ? " future" : " gap");
        if (sl.paused) el.title = pauseInfo(sl).label.toLowerCase();
        el.style.flexGrow = String(sl.span / 1e3);
        if (sl.frame) {
          const img = document.createElement("img");
          img.src = sl.frame.url;
          img.alt = kiosk + " " + fmtTime(sl.ts);
          el.appendChild(img);
        }
        strip.appendChild(el);
        sl.el = el;
      }
      dressStrip(model);
      const hoverAt = (e) => {
        const r = strip.getBoundingClientRect();
        if (!r.width) return;
        const t = P.from + SPAN * ((e.clientX - r.left) / r.width);
        setCursor(t, card, false);
      };
      strip.addEventListener("mousemove", hoverAt);
      strip.addEventListener("mouseenter", (e) => {
        wrap.classList.add("strip-hover");
        hoverAt(e);
      });
      strip.addEventListener("mouseleave", () => {
        wrap.classList.remove("strip-hover");
        if (cfg.onHoverClear) cfg.onHoverClear();
      });
      strip.addEventListener("click", (e) => {
        if (suppressClick) {
          suppressClick = false;
          return;
        }
        const sl = model.slotAt(cursorT);
        const f = sl && sl.frame;
        if (f) pv.open(decl.site, kiosk, f, e.clientX, e.clientY, hiUrlFor(f, decl, cfg.apiUrl, cfg.apiKey));
      });
      const magEl = card.querySelector(".mag");
      const magImg = magEl.querySelector("img");
      magImg.addEventListener("load", () => {
        if (magImg.naturalWidth && magImg.naturalHeight)
          magEl.style.aspectRatio = String(magImg.naturalWidth / magImg.naturalHeight);
      });
      strip.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const r = strip.getBoundingClientRect();
        const fracOf = (x) => Math.max(0, Math.min(1, (x - r.left) / r.width));
        const f0 = fracOf(e.clientX);
        let dragged = false;
        const move = (ev) => {
          if (destroyed) return up(ev);
          const f1 = fracOf(ev.clientX);
          if (Math.abs(f1 - f0) * r.width > 5) dragged = true;
          if (dragged) {
            showSelection(f0, f1);
            setCursor(P.from + SPAN * f1, card, false);
          }
        };
        const up = (ev) => {
          document.removeEventListener("mousemove", move);
          document.removeEventListener("mouseup", up);
          hideSelection();
          if (dragged && !destroyed) {
            suppressClick = true;
            const f1 = fracOf(ev.clientX);
            const a = Math.min(f0, f1), b = Math.max(f0, f1);
            if (b > a && cfg.onZoom) cfg.onZoom(Math.round(P.from + SPAN * a), Math.round(P.from + SPAN * b));
          }
        };
        document.addEventListener("mousemove", move);
        document.addEventListener("mouseup", up);
      });
      q(".cards").appendChild(card);
      return {
        card,
        model,
        head: card.querySelector(".ft"),
        strip,
        cross: card.querySelector(".xh"),
        sel: card.querySelector(".sel"),
        mag: card.querySelector(".mag"),
        lane: card.querySelector(".card-lane")
      };
    }
    function buildAxis() {
      const axis = q(".axis");
      const w = axis.clientWidth;
      const roughMaxTicks = Math.max(3, Math.floor(w / 90));
      const roughStep = TICK_STEPS.find((s) => SPAN / s <= roughMaxTicks) || TICK_STEPS[TICK_STEPS.length - 1];
      const sampleWidth = measureTickWidth(tickFormat(roughStep)(P.to));
      const maxTicks = Math.max(3, Math.floor(w / (sampleWidth + TICK_LABEL_GAP)));
      const tickStep = TICK_STEPS.find((s) => SPAN / s <= maxTicks) || TICK_STEPS[TICK_STEPS.length - 1];
      const fmt = tickFormat(tickStep);
      axis.querySelectorAll(".tick").forEach((t) => t.remove());
      axisTickList.length = 0;
      let d = alignedStart(P.from, tickStep);
      while (+d < P.from) d = nextTick(d, tickStep);
      for (; +d <= P.to; d = nextTick(d, tickStep)) {
        const ts = +d;
        axisTickList.push(ts);
        const el = document.createElement("div");
        el.className = "tick";
        el.style.left = (ts - P.from) / SPAN * w + "px";
        el.textContent = fmt(ts);
        axis.appendChild(el);
      }
    }
    function ruleBeyond(sl) {
      if (!sl || !sl.beyond || !sl.el) return;
      sl.el.querySelectorAll(".bt").forEach((t) => t.remove());
      for (const ts of axisTickList) {
        if (ts <= sl.ts || ts > sl.ts + sl.span) continue;
        const t = document.createElement("div");
        t.className = "bt";
        t.style.left = ((ts - sl.ts) / sl.span * 100).toFixed(3) + "%";
        sl.el.appendChild(t);
      }
    }
    function ruleAllBeyond() {
      for (const k of kiosks) {
        const c = cards[k.id];
        if (!c) continue;
        const last = c.model.slots[c.model.slots.length - 1];
        if (last && last.beyond) ruleBeyond(last);
      }
    }
    function renderAnnotations(anns) {
      const tip = annTip();
      const fracOf = (t) => (Math.max(P.from, Math.min(P.to, t)) - P.from) / SPAN;
      const pct = (f) => (f * 100).toFixed(3) + "%";
      function addRegion(host, a) {
        const el = document.createElement("div");
        el.className = "ann-region";
        el.style.left = pct(fracOf(a.ts));
        el.style.width = pct(fracOf(a.timeEnd) - fracOf(a.ts));
        if (a.color) {
          el.style.background = a.color + "22";
          el.style.borderColor = a.color + "88";
        }
        host.appendChild(el);
      }
      function addMarkers(host, items) {
        const groups = [];
        for (const a of items) {
          const g = groups[groups.length - 1];
          if (g && (fracOf(a.ts) - fracOf(g[0].ts)) * hostWidth < 10) g.push(a);
          else groups.push([a]);
        }
        for (const g of groups) {
          const el = document.createElement("div");
          el.className = "ann" + (g.length > 1 ? " multi" : "");
          el.style.left = pct(fracOf(g[0].ts));
          if (g[0].color) el.style.background = g[0].color;
          el.title = "";
          if (g.length > 1) {
            const n = document.createElement("span");
            n.className = "n";
            n.textContent = String(g.length);
            el.appendChild(n);
          }
          el.addEventListener("mouseenter", () => {
            const r = el.getBoundingClientRect();
            tip.show(g, r.left + r.width / 2, r.top);
          });
          el.addEventListener("mouseleave", () => tip.hide());
          el.addEventListener("click", (e) => {
            e.stopPropagation();
            const r = el.getBoundingClientRect();
            tip.pin(g, r.left + r.width / 2, r.top);
          });
          host.appendChild(el);
        }
      }
      const appliesTo = (a, k) => (!a.source || a.source === k.id) && (!a.siteScope || a.siteScope === k.site);
      const isGlobal = (a) => !a.source && !a.siteScope;
      if (cfg.annotationLanes === "per-source") {
        for (const k of kiosks) {
          const c = cards[k.id];
          const items = anns.filter((a) => appliesTo(a, k));
          if (!items.length) continue;
          c.card.classList.add("has-lane");
          for (const a of items) if (a.timeEnd) {
            addRegion(c.strip, a);
            addRegion(c.lane, a);
          }
          addMarkers(c.lane, items);
        }
        return;
      }
      const laneItems = [], perCard = {};
      for (const a of anns) {
        if (isGlobal(a)) laneItems.push(a);
        else for (const k of kiosks) if (appliesTo(a, k)) (perCard[k.id] ||= []).push(a);
        if (a.timeEnd) {
          const hosts = isGlobal(a) ? kiosks.map((k) => cards[k.id].strip).concat([q(".ann-lane")]) : kiosks.filter((k) => appliesTo(a, k)).map((k) => cards[k.id].strip);
          for (const h of hosts) addRegion(h, a);
        }
      }
      for (const [id, items] of Object.entries(perCard)) addMarkers(cards[id].strip, items);
      if (laneItems.length) addMarkers(q(".ann-lane"), laneItems);
      if (laneItems.length || anns.some((a) => a.timeEnd && isGlobal(a))) q(".ann-lane").style.display = "";
    }
    function setCursor(t, hoveredCard, external) {
      cursorT = Math.max(P.from, Math.min(P.to, t));
      root.dataset.ktlCursor = String(cursorT);
      if (!external) root.dataset.ktlPinned = "1";
      if (cfg.onCursor) cfg.onCursor(cursorT);
      const frac = (cursorT - P.from) / SPAN;
      const axis = q(".axis"), ac = q(".acur");
      const acW = ac.offsetWidth || 50;
      ac.textContent = fmtTime(cursorT);
      ac.style.left = Math.max(acW / 2, Math.min(axis.clientWidth - acW / 2, frac * axis.clientWidth)) + "px";
      for (const k of kiosks) {
        const c = cards[k.id];
        if (!c) continue;
        if (!external) c.card.classList.toggle("hovered", hoveredCard === c.card);
        const w = c.strip.clientWidth, x = frac * w;
        c.cross.style.left = x + "px";
        const slot = c.model.slotAt(cursorT);
        const magW = c.mag.offsetWidth || c.strip.clientHeight * 16 / 9;
        c.mag.style.left = Math.max(0, Math.min(w - magW, x - magW / 2)) + "px";
        if (slot && slot.frame) {
          c.mag.classList.remove("gap", "future", "off", ...PAUSE_CLASSES);
          c.mag.querySelector("img").src = slot.frame.url;
          c.mag.querySelector(".cap").textContent = fmtTime(slot.frame.ts);
          c.head.textContent = "";
          c.head.classList.remove("stale", ...PAUSE_CLASSES);
        } else if (slot && slot.paused) {
          const pi = pauseInfo(slot);
          c.mag.classList.remove("gap", "future", "off", ...PAUSE_CLASSES);
          c.mag.classList.add(...pi.classes);
          c.mag.querySelector(".cap").textContent = pi.label.toLowerCase();
          c.head.textContent = pi.label.toLowerCase();
          c.head.classList.remove("stale", ...PAUSE_CLASSES);
          c.head.classList.add(...pi.classes);
        } else if (slot && slot.beyond) {
          c.mag.classList.remove("gap", "future", ...PAUSE_CLASSES);
          c.mag.classList.add("off");
          c.head.textContent = "";
          c.head.classList.remove("stale", ...PAUSE_CLASSES);
        } else if (slot && slot.future) {
          const inFlight = slot.ts <= Date.now();
          c.mag.classList.remove("gap", "off", ...PAUSE_CLASSES);
          c.mag.classList.add("future");
          c.mag.querySelector(".cap").textContent = (inFlight ? "expected \u2014 " : "upcoming \u2014 ") + fmtShort(slot.ts);
          c.head.textContent = inFlight ? "expected" : "upcoming";
          c.head.classList.remove("stale", ...PAUSE_CLASSES);
        } else {
          c.mag.classList.add("gap");
          c.mag.classList.remove("future", "off", ...PAUSE_CLASSES);
          const i = slot ? c.model.slots.indexOf(slot) : c.model.slots.length - 1;
          let last = null;
          for (let j = i; j >= 0; j--) if (c.model.slots[j].frame) {
            last = c.model.slots[j].frame;
            break;
          }
          const msg = last ? "offline \u2014 last seen " + fmtTime(last.ts) : "no data in window";
          c.mag.querySelector(".cap").textContent = msg;
          c.head.textContent = msg;
          c.head.classList.add("stale");
          c.head.classList.remove(...PAUSE_CLASSES);
        }
      }
      if (!external && cfg.onHover) cfg.onHover(cursorT);
    }
    (async function boot() {
      try {
        kiosks = (await backend.kiosks(P.site)).filter((k) => !P.source || P.source.includes(k.id)).filter((k) => matchesTags(k.tags, parseTagFilter(cfg.tagFilter)));
      } catch (e) {
        console.warn("[visual-timeline] sources fetch failed:", e);
        if (destroyed) return;
        const err = document.createElement("div");
        err.className = "boot-err";
        err.textContent = "frames API unreachable \u2014 " + (e && e.message ? e.message : e);
        q(".cards").appendChild(err);
        await revealWrapper(root, wrap);
        return;
      }
      for (const k of kiosks) {
        if (destroyed) return;
        let model;
        try {
          model = await buildSourceModel(k, P, backend, pxBudget);
        } catch (e) {
          console.warn("[visual-timeline] model build failed for " + k.id + ":", e);
          continue;
        }
        if (destroyed) return;
        if (cfg.hideEmpty && !model.slots.some((sl) => sl.frame || sl.paused)) continue;
        cards[k.id] = buildCard(k, model);
      }
      kiosks = kiosks.filter((k) => cards[k.id]);
      buildAxis();
      ruleAllBeyond();
      const rawAnns = cfg.annotations && cfg.annotations.length ? cfg.annotations : backend.annotations ? backend.annotations() : [];
      if (cfg.showAnnotations !== false) renderAnnotations(normAnnotations(rawAnns, P));
      setCursor(cursorT, null, true);
      await revealWrapper(root, wrap);
      dressAll(20);
      if (LIVE) {
        const steps = kiosks.map((k) => cards[k.id].model.lastActive && cards[k.id].model.lastActive.step).filter(Boolean);
        const minStep = steps.length ? Math.min.apply(null, steps) : 6e4;
        pollTimer = setInterval(async () => {
          for (const k of kiosks) {
            const c = cards[k.id];
            const mSlots = c.model.slots;
            const filler = mSlots.length && mSlots[mSlots.length - 1].beyond ? mSlots[mSlots.length - 1] : null;
            if (filler) {
              const nowP = Date.now();
              const prev = mSlots.length > 1 ? mSlots[mSlots.length - 2] : null;
              if (prev && prev.paused) {
                const grow = Math.min(nowP, filler.ts + filler.span) - filler.ts;
                if (grow > 0) {
                  prev.span += grow;
                  filler.ts += grow;
                  filler.span -= grow;
                  if (prev.el) prev.el.style.flexGrow = String(prev.span / 1e3);
                  if (filler.span <= 0) {
                    if (filler.el) filler.el.remove();
                    mSlots.pop();
                  } else {
                    if (filler.el) filler.el.style.flexGrow = String(filler.span / 1e3);
                    ruleBeyond(filler);
                  }
                }
              } else if (prev && prev.step) {
                let nextTs = prev.ts + prev.step;
                while (mSlots[mSlots.length - 1] && mSlots[mSlots.length - 1].beyond && nextTs <= nowP) {
                  const f = mSlots[mSlots.length - 1];
                  const sl = { ts: nextTs, span: prev.step, frame: null, cadence: prev.cadence, step: prev.step, future: true };
                  const el = document.createElement("div");
                  el.className = "slot future";
                  el.style.flexGrow = String(sl.span / 1e3);
                  if (f.el && f.el.parentNode) f.el.parentNode.insertBefore(el, f.el);
                  sl.el = el;
                  mSlots.splice(mSlots.length - 1, 0, sl);
                  f.span -= sl.span;
                  f.ts += sl.span;
                  if (f.span <= 0) {
                    if (f.el) f.el.remove();
                    mSlots.pop();
                  } else {
                    if (f.el) f.el.style.flexGrow = String(f.span / 1e3);
                    ruleBeyond(f);
                  }
                  nextTs += prev.step;
                }
              }
            }
            const la = c.model.lastActive;
            if (!la) continue;
            let lastTs = P.from;
            for (let i = c.model.slots.length - 1; i >= 0; i--) {
              if (c.model.slots[i].frame) {
                lastTs = c.model.slots[i].ts;
                break;
              }
            }
            const fresh = await backend.frames(k.site, k.id, lastTs + 1, Date.now(), la.step);
            if (destroyed) return;
            for (const f of fresh) {
              const slot = c.model.slotAt(f.ts);
              if (!slot || slot.paused || slot.beyond) continue;
              if (slot.frame && f.ts <= slot.frame.ts) continue;
              slot.frame = f;
              slot.future = false;
              slot.el.classList.remove("gap", "future");
              let img = slot.el.querySelector("img");
              if (!img) {
                img = document.createElement("img");
                slot.el.appendChild(img);
              }
              img.src = f.url;
              img.alt = k.id + " " + fmtTime(f.ts);
            }
            const overdue = Date.now();
            for (const sl of c.model.slots) {
              if (sl.future && !sl.frame && sl.ts + sl.step < overdue) {
                sl.future = false;
                if (sl.el) {
                  sl.el.classList.remove("future");
                  sl.el.classList.add("gap");
                }
              }
            }
          }
        }, Math.min(minStep, 1e4));
      }
    })();
    return {
      setExternalCursor(t) {
        if (!destroyed) setCursor(t, null, true);
      },
      isHovering() {
        return wrap.classList.contains("strip-hover");
      },
      destroy() {
        destroyed = true;
        if (pollTimer) clearInterval(pollTimer);
        pv.retire();
        annTip().close();
        retireWrapper(wrap);
      }
    };
  }
  function mountGrid(root, cfg) {
    injectStyles();
    const P = { site: parseVar(cfg.site), source: parseVar(cfg.source), from: cfg.from, to: cfg.to };
    const SPAN = Math.max(1, P.to - P.from);
    const LIVE = P.to > Date.now() - 2 * 60 * 1e3;
    const backend = cfg.apiUrl ? makeApiBackend(cfg.apiUrl, cfg.apiKey) : makeBackend(P, SPAN);
    const budget = 120;
    const wrap = makeWrapper(root);
    wrap.classList.toggle("fill", cfg.fit === "fill");
    wrap.innerHTML = '<div class="grid"></div>';
    const q = (sel) => wrap.querySelector(sel);
    let kiosks = [], tiles = {}, destroyed = false, pollTimer = null, shownT = null;
    const pv = makePreview();
    function buildTile(decl, model) {
      const el = document.createElement("div");
      const inline = cfg.headerMode === "inline" || cfg.headerMode === "inline-gradient";
      el.className = "tile" + (inline ? " inline-head" : "") + (cfg.headerMode === "inline-gradient" ? " inline-grad" : "");
      el.innerHTML = '<div class="t-head" title="' + headTitle(decl) + '"><span class="nm">' + decl.id + '</span><span class="inline-brk"></span><span class="st">' + decl.site + (decl.location ? " \xB7 " + decl.location : "") + "</span>" + tagChips(decl) + '</div><div class="t-img"><img alt="' + decl.id + '"><span class="t-ts"></span><div class="t-off"></div></div>';
      const rec = {
        decl,
        model,
        el,
        shown: null,
        img: el.querySelector("img"),
        ts: el.querySelector(".t-ts"),
        off: el.querySelector(".t-off")
      };
      el.addEventListener("click", (e) => {
        if (rec.shown) pv.open(decl.site, decl.id, rec.shown, e.clientX, e.clientY, hiUrlFor(rec.shown, decl, cfg.apiUrl, cfg.apiKey));
      });
      q(".grid").appendChild(el);
      return rec;
    }
    function lastFrame(rec) {
      for (let i = rec.model.slots.length - 1; i >= 0; i--) {
        if (rec.model.slots[i].frame) return rec.model.slots[i].frame;
      }
      return null;
    }
    function setShown(t) {
      shownT = t;
      if (cfg.onShown) cfg.onShown(t);
      for (const k of kiosks) {
        const rec = tiles[k.id];
        if (!rec) continue;
        let frame = null, offMsg = null, pausedMsg = null, pausedSlot = null;
        const la = rec.model.lastActive;
        if (t == null) {
          const tail = rec.model.slots.length ? rec.model.slots[rec.model.slots.length - 1] : null;
          const tailPaused = tail && tail.paused;
          frame = lastFrame(rec);
          if (tailPaused) {
            pausedSlot = tail;
            pausedMsg = pauseInfo(tail).label + (frame ? " \u2014 last frame " + fmtTime(frame.ts) : "");
          } else if (!frame) offMsg = "no data in window";
          else if (LIVE && la && Date.now() - frame.ts > 2 * la.step)
            offMsg = "OFFLINE \u2014 last seen " + fmtTime(frame.ts);
        } else {
          const slot = rec.model.slotAt(t);
          if (slot && slot.paused) {
            pausedSlot = slot;
            pausedMsg = pauseInfo(slot).label;
          } else {
            frame = slot && slot.frame;
            if (!frame) {
              if (slot && slot.beyond) {
                offMsg = "\u2014";
              } else if (slot && slot.future) {
                offMsg = "EXPECTED \u2014 " + fmtShort(slot.ts);
              } else {
                const i = slot ? rec.model.slots.indexOf(slot) : rec.model.slots.length - 1;
                let last = null;
                for (let j = i; j >= 0; j--) if (rec.model.slots[j].frame) {
                  last = rec.model.slots[j].frame;
                  break;
                }
                offMsg = last ? "OFFLINE \u2014 last seen " + fmtTime(last.ts) : "no data";
              }
            }
          }
        }
        rec.el.classList.toggle("offline", !!offMsg);
        rec.el.classList.remove(...PAUSE_CLASSES);
        if (pausedMsg && !offMsg) rec.el.classList.add(...pauseInfo(pausedSlot).classes);
        rec.off.textContent = offMsg || pausedMsg || "";
        rec.shown = frame;
        if (frame && !offMsg && !pausedMsg) {
          rec.img.src = frame.url;
          rec.ts.textContent = fmtTime(frame.ts);
        }
      }
    }
    (async function boot() {
      try {
        kiosks = (await backend.kiosks(P.site)).filter((k) => !P.source || P.source.includes(k.id)).filter((k) => matchesTags(k.tags, parseTagFilter(cfg.tagFilter)));
      } catch (e) {
        console.warn("[visual-timeline] sources fetch failed:", e);
        if (destroyed) return;
        const err = document.createElement("div");
        err.className = "boot-err";
        err.textContent = "frames API unreachable \u2014 " + (e && e.message ? e.message : e);
        q(".grid").appendChild(err);
        await revealWrapper(root, wrap);
        return;
      }
      for (const k of kiosks) {
        if (destroyed) return;
        let model;
        try {
          model = await buildSourceModel(k, P, backend, budget);
        } catch (e) {
          console.warn("[visual-timeline] model build failed for " + k.id + ":", e);
          continue;
        }
        if (destroyed) return;
        if (cfg.hideEmpty && !model.slots.some((sl) => sl.frame || sl.paused)) continue;
        tiles[k.id] = buildTile(k, model);
      }
      kiosks = kiosks.filter((k) => tiles[k.id]);
      setShown(null);
      await revealWrapper(root, wrap);
      if (LIVE) {
        pollTimer = setInterval(async () => {
          for (const k of kiosks) {
            const rec = tiles[k.id];
            const la = rec.model.lastActive;
            if (!la) continue;
            const last = lastFrame(rec);
            const fresh = await backend.frames(k.site, k.id, (last ? last.ts : P.from) + 1, Date.now(), la.step);
            if (destroyed) return;
            for (const f of fresh) {
              const slot = rec.model.slotAt(f.ts);
              if (!slot || slot.paused || slot.beyond) continue;
              if (!slot.frame || f.ts > slot.frame.ts) slot.frame = f;
            }
          }
          if (shownT == null) setShown(null);
        }, 1e4);
      }
    })();
    return {
      setExternalCursor(t) {
        if (!destroyed) setShown(Math.max(P.from, Math.min(P.to, t)));
      },
      clearExternal() {
        if (!destroyed) setShown(null);
      },
      destroy() {
        destroyed = true;
        if (pollTimer) clearInterval(pollTimer);
        pv.retire();
        retireWrapper(wrap);
      }
    };
  }
  return __toCommonJS(core_exports);
})();
