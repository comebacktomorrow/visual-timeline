// @ts-nocheck
/* Visual Timeline core — framework-free DOM implementation shared by the
 * Grafana panel entry (module.ts). Deliberately plain JS semantics: the
 * timeline/grid render and update imperatively for scrub-speed, with React
 * only at the panel boundary. */

import { fmtDur, fmtTime, resolveTimeZone } from './vt/time/zones';
import { axisTicks, TICK_STEPS, tickFormat } from './vt/time/ticks';
import { clearPauseClasses, pauseInfo } from './vt/model/eras';
import { buildSourceModel, ghostFor, missedHeartbeat, slotClass } from './vt/model/slots';
import { matchesTags, parseTagFilter, parseVar } from './vt/model/filters';
import { zoneFor, zoneLabel, zoneTexts } from './vt/zones/source';
import { hiUrlFor, makeApiBackend } from './vt/backends/api';
import { esc, headTitle, tagChips } from './vt/dom/html';

export { fmtShort, fmtTime, resolveTimeZone, zonedParts, zonedTime } from './vt/time/zones';
export { alignedStart, axisTicks, nextTick, TICK_STEPS, tickFormat } from './vt/time/ticks';
export { clearPauseClasses, erasFor, PAUSE_CLASSES, pauseInfo } from './vt/model/eras';
export { buildSourceModel, ghostFor, missedHeartbeat, slotClass } from './vt/model/slots';
export { matchesTags, parseTagFilter } from './vt/model/filters';
export { fmtOffset, sourceTimeZone, zoneHeadText, zoneLabel, zoneOffsetText } from './vt/zones/source';
export { framesPath, hiUrlFor, imageUrlWithKey, makeApiBackend, resolveFrameUrl, sourcesPath } from './vt/backends/api';
export { esc, headTitle, tagChips } from './vt/dom/html';

/* ======================= styles (injected once) ======================= */
const STYLE_ID = 'ktl-styles';
/* Palette: every chrome colour below reads one of these. The defaults are
 * the dark palette the standalone app and embed have always used. They sit
 * on the mount root (.ktl-root, added by makeWrapper) rather than on .ktl,
 * so a host can theme a mount by setting them inline on the element it
 * mounts into — the Grafana panel does, from the active theme (theme.ts).
 * The tooltip and click-in preview live on <body>, outside any root: they
 * carry the defaults too, and copyVars gives them the opening mount's
 * resolved values. Colours drawn over frame images (captions, timestamps,
 * the slot seam, the magnifier's shadow) and text on an accent or
 * annotation colour stay literal: they sit on the picture or on a fixed
 * hue, not on the theme's surfaces. */
export const KTL_VAR_DEFAULTS = {
  '--ktl-bg': '#181b1f', '--ktl-bg2': '#22262b', '--ktl-border': '#2c3235', '--ktl-text': '#ccccdc',
  '--ktl-dim': '#7b8087', '--ktl-muted': '#9aa0a6', '--ktl-strong': '#fff', '--ktl-chip-text': '#b9bec6',
  '--ktl-link': '#6e9fff', '--ktl-accent': '#f2cc0c', '--ktl-sel': 'rgba(242,204,12,.14)',
  '--ktl-live': '#73bf69', '--ktl-off': '#f2495c', '--ktl-axis-grid': 'rgba(240,250,255,.09)',
  '--ktl-media': '#111', '--ktl-mag-bg': '#000', '--ktl-float-bg': '#0b0c0e', '--ktl-divider': '#1d2024',
  '--ktl-shadow': '0 8px 32px rgba(0,0,0,.7)', '--ktl-pending': '#232830', '--ktl-scrim': 'rgba(0,0,0,.6)',
  '--ktl-gap-a': '#1b1215', '--ktl-gap-b': '#2a171b',
  '--ktl-pause-a': '#15171a', '--ktl-pause-b': '#232830', '--ktl-tpause-a': '#17191c', '--ktl-tpause-b': '#1d2024',
  '--ktl-sleep-a': '#182a4e', '--ktl-sleep-b': '#223c6e', '--ktl-sleep': '#8fb0e8',
  '--ktl-down-a': '#28204a', '--ktl-down-b': '#372c66', '--ktl-down': '#a897e0',
  '--ktl-stopped-a': '#123832', '--ktl-stopped-b': '#1a4c44', '--ktl-stopped': '#6fc4b4',
  '--ktl-unint-a': '#4a350e', '--ktl-unint-b': '#614614', '--ktl-unint': '#e8b155',
  '--ktl-ann': '#5794F2', '--ktl-ann-edge': '#0b0c0e',
  '--ktl-ann-region': 'rgba(87,148,242,.12)', '--ktl-ann-region-edge': 'rgba(87,148,242,.55)',
};
const KTL_VARS = Object.keys(KTL_VAR_DEFAULTS);
/* the resolved palette of `from` (a mount root or anything inside one),
 * set inline on `to`: how body-level popups follow the panel they serve */
function copyVars(from, to) {
  if (!from || !from.isConnected) {return;}
  const cs = getComputedStyle(from);
  for (const v of KTL_VARS) {
    const val = cs.getPropertyValue(v).trim();
    if (val) {to.style.setProperty(v, val);} else {to.style.removeProperty(v);}
  }
}
const CSS = `
.ktl-root, .ktl-ann-tip, .ktl-pop { ${KTL_VARS.map(v => v + ':' + KTL_VAR_DEFAULTS[v] + ';').join(' ')} }
.ktl { display:flex; flex-direction:column; width:100%; height:100%; overflow:hidden;
       color:var(--ktl-text); font:12px/1.4 -apple-system,"Segoe UI",Roboto,sans-serif; }
.ktl * { box-sizing:border-box; margin:0; padding:0; }
.ktl .cards { flex:1 1 auto; min-height:0; display:flex; flex-direction:column; gap:6px; overflow-y:auto; }
/* cards share panel height equally (fewer kiosks → taller strips), but
   never crush below a usable minimum — past that the list scrolls */
.ktl .card { flex:1 1 0; min-height:76px; display:flex; flex-direction:column; background:var(--ktl-bg2);
             border:1px solid var(--ktl-border); border-radius:4px; overflow:hidden; transition:opacity 120ms ease;
             position:relative; }
/* inline header: free-floating chip bubbles over the image's top-left —
   hostname bubble on line one, the meta chips on line two — no scrim
   block. The optional gradient variant backs them with a full-height
   left-to-right fade for busy frames. Sits under the magnifier/crosshair
   and lets all pointer events through. The max-heights hold exactly the
   two lines (16.8px name + 2px gap + a line of 10px chips or 12px status
   text), so a chip that wraps to a third line is hidden, not a sliver. */
.ktl .card.inline-head .card-head, .ktl .tile.inline-head .t-head {
  position:absolute; top:0; left:0; z-index:2; max-width:85%;
  flex-wrap:wrap; row-gap:2px; pointer-events:none; overflow:hidden; }
.ktl .card.inline-head .card-head { padding:5px 0 0 6px; max-height:42px; }
.ktl .tile.inline-head .t-head { padding:4px 0 0 5px; max-height:40px; }
.ktl .inline-brk { display:none; }
.ktl .card.inline-head .card-head .inline-brk, .ktl .tile.inline-head .t-head .inline-brk {
  display:block; width:100%; height:0; }
.ktl .card.inline-head .card-head .nm, .ktl .tile.inline-head .t-head .nm {
  background:var(--ktl-bg); border-radius:9px; padding:0 8px; }
.ktl .card.inline-head .card-head .st, .ktl .tile.inline-head .t-head .st {
  background:var(--ktl-bg); color:var(--ktl-chip-text); }
.ktl .card.inline-head .card-head .ft:not(:empty) { background:var(--ktl-bg); border-radius:9px; padding:0 8px; }
/* gradient backing: strips fade left-to-right (header hugs the left
   edge); tiles fade top-to-bottom (the header spans the tile's top) */
.ktl .card.inline-grad .strip::before {
  content:""; position:absolute; top:0; bottom:0; left:0; width:42%;
  background:linear-gradient(90deg, var(--ktl-scrim), rgba(0,0,0,0));
  z-index:1; pointer-events:none; }
.ktl .tile.inline-grad .t-img::before {
  content:""; position:absolute; top:0; left:0; right:0; height:48%;
  background:linear-gradient(180deg, var(--ktl-scrim), rgba(0,0,0,0));
  z-index:1; pointer-events:none; }
.ktl.strip-hover .card:not(.hovered) { opacity:.45; }
.ktl .card-head { display:flex; align-items:center; gap:8px; padding:2px 8px; flex:0 0 auto; color:var(--ktl-dim);
                   flex-wrap:nowrap; overflow:hidden; min-width:0; }
.ktl .card-head .nm { flex:0 0 auto; }
/* chips never wrap: the container wraps instead and clamps to one row,
   so a chip either fits whole or drops out of view (title has it all) */
.ktl .card-head .tags { display:flex; gap:4px; overflow:hidden; min-width:0; flex-shrink:1000000;
                        flex-wrap:wrap; max-height:17px; align-content:flex-start; }
.ktl .card-head .tags .st { flex:0 0 auto; }
.ktl .card-head .nm { font-weight:600; color:var(--ktl-text); }
.ktl .card-head .st, .ktl .t-head .st { font-size:10px; color:var(--ktl-dim); border:1px solid var(--ktl-border);
                      border-radius:8px; padding:0 6px; white-space:nowrap; }
/* a source's zone chip ("Sydney · +3h") leads the details: it is what
   reads the frame's clock. Short of room, the header gives up the tags
   first, then the site/location chip (ellipsized), then the zone's city;
   the offset itself always stays */
.ktl .card-head > .st, .ktl .t-head > .st { min-width:0; overflow:hidden; text-overflow:ellipsis; flex-shrink:10000; }
.ktl .card-head > .st.tz, .ktl .t-head > .st.tz { display:flex; flex-shrink:1; font-variant-numeric:tabular-nums; }
.ktl .st.tz .tzc { min-width:0; overflow:hidden; text-overflow:ellipsis; }
.ktl .st.tz .tzo { flex:0 0 auto; white-space:pre; }
.ktl .card-head .ft { font-variant-numeric:tabular-nums; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0; flex-shrink:1; }
.ktl .card-head .ft.stale { color:var(--ktl-off); }
.ktl .card-head .cad { margin-left:auto; font-size:10px; color:var(--ktl-dim); }
.ktl .strip { flex:1 1 auto; min-height:0; position:relative; display:flex; align-items:stretch;
              cursor:crosshair; background:var(--ktl-media); }
.ktl .slot { flex:1 1 0; min-width:0; position:relative; overflow:hidden; }
/* Frame delineation tints the FRAME: overflow clips the img to the padding
   box, so a border column would expose the #111 strip bg underneath and
   read as a hard black line on any content. An ::after overlay stacks above
   the image instead. Emboss: dark line + light inner edge — each half only
   reads against opposing content, so the seam shades light frames and
   highlights dark ones. */
.ktl .strip.sep .slot + .slot::after { content:""; position:absolute; top:0; bottom:0; left:0;
  width:1px; background:rgba(0,0,0,.05); box-shadow:1px 0 0 rgba(255,255,255,.12);
  pointer-events:none; z-index:1; }
.ktl .slot img { position:absolute; top:0; left:50%; transform:translateX(-50%); height:100%; width:auto; }
.ktl .slot.gap { background:repeating-linear-gradient(45deg,var(--ktl-gap-a),var(--ktl-gap-a) 5px,var(--ktl-gap-b) 5px,var(--ktl-gap-b) 10px); }
.ktl .slot.paused { background:repeating-linear-gradient(45deg,var(--ktl-pause-a),var(--ktl-pause-a) 7px,var(--ktl-pause-b) 7px,var(--ktl-pause-b) 14px); }
/* pause REASONS: one color grammar with the dashboards — planned = distinct
 * cool hues (indigo = screen asleep, violet-slate = system down, teal = app
 * stopped), unintended = amber, undeclared silence stays the red .gap.
 * Reason classes replace the hatch; .unintended overrides them all. */
.ktl .slot.paused.r-screen-sleep { background:repeating-linear-gradient(45deg,var(--ktl-sleep-a),var(--ktl-sleep-a) 7px,var(--ktl-sleep-b) 7px,var(--ktl-sleep-b) 14px); }
.ktl .slot.paused.r-system-down { background:repeating-linear-gradient(45deg,var(--ktl-down-a),var(--ktl-down-a) 7px,var(--ktl-down-b) 7px,var(--ktl-down-b) 14px); }
.ktl .slot.paused.r-app-stopped { background:repeating-linear-gradient(45deg,var(--ktl-stopped-a),var(--ktl-stopped-a) 7px,var(--ktl-stopped-b) 7px,var(--ktl-stopped-b) 14px); }
.ktl .slot.paused.unintended { background:repeating-linear-gradient(45deg,var(--ktl-unint-a),var(--ktl-unint-a) 7px,var(--ktl-unint-b) 7px,var(--ktl-unint-b) 14px); }
/* hatch continuity: each slot is its own element, so a per-element gradient
 * restarts at every slot edge — a run of narrow slots shows only the first
 * stripe color and reads as a SOLID block. buildCard aligns each empty
 * slot's background-position to its offset in the strip, so the diagonals
 * run continuously across runs. (NOT background-attachment:fixed — Chrome
 * refuses to paint fixed backgrounds inside Grafana's transformed panels.)
 * A wide pause band also carries its label inline — a strip that is ALL
 * pause should say why without requiring a hover. */
.ktl .slot .band-label { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
  font-size:10px; font-weight:700; letter-spacing:.06em; color:var(--ktl-dim);
  white-space:nowrap; overflow:hidden; pointer-events:none; }
.ktl .slot.r-screen-sleep .band-label { color:var(--ktl-sleep); }
.ktl .slot.r-system-down .band-label { color:var(--ktl-down); }
.ktl .slot.r-app-stopped .band-label { color:var(--ktl-stopped); }
.ktl .slot.unintended .band-label { color:var(--ktl-unint); }
/* the ONE pending slot (its tick passed, frame in flight) pulses gently —
 * in limbo, not offline. Everything further ahead is one inert .beyond
 * filler: the future is unknown, so it gets no shading at all. */
.ktl .slot.future { background:transparent; position:relative; }
.ktl .slot.future::before { content:""; position:absolute; inset:0; background:var(--ktl-pending);
  animation:ktl-limbo 2.2s ease-in-out infinite; z-index:1; }
@keyframes ktl-limbo { 0%,100% { opacity:.15 } 50% { opacity:.55 } }
/* ...carrying the last frame as a "last known" ghost under that pulse: a
 * hole at the live edge reads as a fault, and the pulse is what keeps the
 * ghost from passing for a real frame. Bigger views (magnifier, click-in
 * preview, crosshair-following tile) also blur it, because at that size a
 * sharp frame would read as real. After a gap or a pause there is nothing
 * honest to carry, so the slot stays a plain skeleton. */
.ktl .mag.future.ghost img { display:block; filter:blur(5px) brightness(.8);
  animation:ktl-ghost 2.2s ease-in-out infinite; }
.ktl .tile.ghost .t-img img { filter:blur(5px) brightness(.8); animation:ktl-ghost 2.2s ease-in-out infinite; }
.ktl-pop.ghost img { filter:blur(8px) brightness(.8); animation:ktl-ghost 2.2s ease-in-out infinite; }
@keyframes ktl-ghost { 0%,100% { opacity:.45 } 50% { opacity:.85 } }
@media (prefers-reduced-motion: reduce) {
  .ktl .slot.future::before { animation:none; opacity:.4; }
  .ktl .mag.future.ghost img, .ktl .tile.ghost .t-img img, .ktl-pop.ghost img { animation:none; opacity:.6; }
}
.ktl .slot.beyond { background:var(--ktl-bg2); }
.ktl .slot.beyond .bt { position:absolute; top:0; bottom:0; width:1px; background:var(--ktl-axis-grid); }
.ktl .mag.off { display:none; }
.ktl .boot-err { flex:1 1 auto; display:flex; align-items:center; justify-content:center;
                 color:var(--ktl-off); font-size:12px; text-align:center; padding:14px; }
.ktl .mag.future { border-color:var(--ktl-dim); }
.ktl .mag.future img { display:none; }
.ktl .card-head .ft.paused.r-screen-sleep, .ktl .tile.paused.r-screen-sleep .t-off { color:var(--ktl-sleep); }
.ktl .card-head .ft.paused.r-system-down, .ktl .tile.paused.r-system-down .t-off { color:var(--ktl-down); }
.ktl .card-head .ft.paused.r-app-stopped, .ktl .tile.paused.r-app-stopped .t-off { color:var(--ktl-stopped); }
.ktl .card-head .ft.paused.unintended, .ktl .tile.paused.unintended .t-off { color:var(--ktl-unint); }
.ktl .mag.paused { border-color:var(--ktl-dim); }
.ktl .mag.paused img { display:none; }
.ktl .card-head .ft.paused { color:var(--ktl-dim); }
.ktl .tile.paused { border-color:var(--ktl-dim); }
.ktl .tile.paused .t-off { display:flex; color:var(--ktl-dim);
  background:repeating-linear-gradient(45deg,var(--ktl-tpause-a),var(--ktl-tpause-a) 7px,var(--ktl-tpause-b) 7px,var(--ktl-tpause-b) 14px); }
.ktl .tile.paused img, .ktl .tile.paused .t-ts { display:none; }
.ktl .xh { position:absolute; top:0; bottom:0; width:1px; background:var(--ktl-accent); opacity:.85;
           pointer-events:none; z-index:4; }
.ktl .sel { position:absolute; top:0; bottom:0; display:none; background:var(--ktl-sel);
            border-left:1px solid var(--ktl-accent); border-right:1px solid var(--ktl-accent);
            pointer-events:none; z-index:2; }
.ktl .mag { position:absolute; top:0; height:100%; aspect-ratio:16/9; max-width:40%;
            border:2px solid var(--ktl-accent); border-radius:2px; overflow:hidden; pointer-events:none;
            z-index:3; background:var(--ktl-mag-bg); box-shadow:0 0 12px rgba(0,0,0,.8); }
.ktl .mag img { width:100%; height:100%; object-fit:contain; display:block; background:var(--ktl-mag-bg); }
.ktl.fill .mag img { object-fit:cover; }
.ktl.fill .tile .t-img img { object-fit:cover; }
.ktl .mag.gap { border-color:var(--ktl-off);
                background:repeating-linear-gradient(45deg,var(--ktl-gap-a),var(--ktl-gap-a) 5px,var(--ktl-gap-b) 5px,var(--ktl-gap-b) 10px), var(--ktl-mag-bg); }
.ktl .mag.gap img { display:none; }
.ktl .mag .cap { position:absolute; left:0; right:0; bottom:0; background:rgba(0,0,0,.6); color:#fff;
                 text-align:center; font-size:10px; font-variant-numeric:tabular-nums; padding:1px 0; }
.ktl .ann-lane { flex:0 0 13px; position:relative; margin:2px 1px 0; }
.ktl .card-lane { flex:0 0 12px; position:relative; display:none; border-top:1px solid var(--ktl-border); }
.ktl .card.has-lane .card-lane { display:block; }
.ktl .card-lane .ann { top:50%; }
.ktl .card-lane .ann-region { top:2px; bottom:2px; }
.ktl .ann { position:absolute; width:7px; height:7px; transform:translate(-50%,-50%) rotate(45deg);
            background:var(--ktl-ann); border:1px solid var(--ktl-ann-edge); cursor:pointer; z-index:6; }
.ktl .ann.multi { width:11px; height:11px; }
.ktl .ann .n { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
  transform:rotate(-45deg); font:700 8px/1 -apple-system,"Segoe UI",Roboto,sans-serif; color:#fff;
  text-shadow:0 0 2px #000,0 0 2px #000; pointer-events:none; }
.ktl .ann-lane .ann { top:50%; }
.ktl .strip .ann { top:auto; bottom:0; transform:translate(-50%,50%) rotate(45deg); }
.ktl .ann-region { position:absolute; top:0; bottom:0; background:var(--ktl-ann-region);
                   border-left:1px dashed var(--ktl-ann-region-edge); border-right:1px dashed var(--ktl-ann-region-edge);
                   pointer-events:none; z-index:1; }
.ktl .ann-lane .ann-region { top:3px; bottom:3px; }
.ktl-ann-tip { position:fixed; z-index:1070; background:var(--ktl-float-bg); border:1px solid var(--ktl-border); border-radius:4px;
               padding:6px 9px; max-width:340px; color:var(--ktl-text); box-shadow:var(--ktl-shadow);
               font:11px/1.5 -apple-system,"Segoe UI",Roboto,sans-serif; pointer-events:none; }
.ktl-ann-tip.pinned { pointer-events:auto; border-color:var(--ktl-accent); user-select:text; }
.ktl-ann-tip a { color:var(--ktl-link); text-decoration:underline; }
.ktl-ann-tip .at { display:flex; gap:8px; align-items:baseline; }
.ktl-ann-tip .at b { color:var(--ktl-strong); }
.ktl-ann-tip .at .tm { color:var(--ktl-dim); font-variant-numeric:tabular-nums; margin-left:auto; }
.ktl-ann-tip .ax { color:var(--ktl-muted); white-space:pre-wrap; }
.ktl-ann-tip .ag { display:flex; gap:4px; flex-wrap:wrap; margin-top:2px; }
.ktl-ann-tip .ag span { font-size:10px; color:var(--ktl-dim); border:1px solid var(--ktl-border); border-radius:8px; padding:0 6px; }
.ktl-ann-tip .item + .item { border-top:1px solid var(--ktl-divider); margin-top:5px; padding-top:5px; }
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
.ktl .tile .t-head .tags { display:flex; gap:4px; overflow:hidden; min-width:0; flex-shrink:1000000;
                           flex-wrap:wrap; max-height:17px; align-content:flex-start; }
.ktl .tile .t-head .tags .st { flex:0 0 auto; }
.ktl .tile .t-head .nm { font-weight:600; color:var(--ktl-text); }
.ktl .tile .t-img { flex:1 1 auto; min-height:0; position:relative; background:var(--ktl-media); }
.ktl .tile .t-img img { position:absolute; inset:0; width:100%; height:100%; object-fit:contain; }
.ktl .tile .t-ts { position:absolute; right:4px; bottom:4px; background:rgba(0,0,0,.65); color:#fff;
                   padding:0 5px; border-radius:2px; font-size:10px; font-variant-numeric:tabular-nums; z-index:1; }
.ktl .tile .t-off { display:none; position:absolute; inset:0; align-items:center; justify-content:center;
                    flex-direction:column; gap:2px; color:var(--ktl-off); font-weight:700; text-align:center;
                    background:repeating-linear-gradient(45deg,var(--ktl-gap-a),var(--ktl-gap-a) 5px,var(--ktl-gap-b) 5px,var(--ktl-gap-b) 10px); }
.ktl .tile.offline { border-color:var(--ktl-off); }
.ktl .tile.offline .t-off { display:flex; }
.ktl .tile.offline img, .ktl .tile.offline .t-ts { display:none; }
.ktl-pop { position:fixed; z-index:1060; background:var(--ktl-float-bg); border:1px solid var(--ktl-accent);
           border-radius:4px; padding:4px; cursor:zoom-out;
           box-shadow:var(--ktl-shadow); }
.ktl-pop img { display:block; max-width:min(560px, 50vw); max-height:55vh; border-radius:2px; }
.ktl-pop .cap { text-align:center; color:var(--ktl-text); font-size:11px; padding:3px 0 0;
                font-variant-numeric:tabular-nums; }`;

function injectStyles() {
  const existing = document.getElementById(STYLE_ID);
  if (existing) {
    // a NEWER module version executing in a long-lived page (SPA navigation,
    // cached bundles) must refresh the shared styles, not defer to stale ones
    if (existing.textContent !== CSS) {existing.textContent = CSS;}
    return;
  }
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

/* ================== built-in demo data (backend seam) ==================
 * Same contract as the frames API (docs/API.md): swap for GET /sources +
 * GET /frames via the apiUrl option. Cadence is DECLARED BY THE SOURCE.
 * source-2 has a synthetic outage. */
const SITES = {
  'site-a': [
    { id: 'source-1', cadence: 60e3, tags: { env: 'prod' } },
    { id: 'source-2', cadence: 60e3 },
    // declared zones (#68): one with DST, one on a :45 offset, so the
    // header offset label shows from (almost) any viewer's zone
    { id: 'source-3', cadence: 120e3, timezone: 'Australia/Sydney' },
  ],
  'site-b': [
    { id: 'source-4', cadence: 60e3 },
    { id: 'source-5', cadence: 30e3, tags: { orient: 'portrait' }, timezone: 'Asia/Kathmandu' },
  ],
};
const DEMO_ZONES = {};
for (const ks of Object.values(SITES)) {for (const k of ks) {if (k.timezone) {DEMO_ZONES[k.id] = k.timezone;}}}
const HUES = { 'source-1': 205, 'source-2': 275, 'source-3': 25, 'source-4': 130, 'source-5': 340 };
/* demo screen shapes: source-3 is 4:3, source-5 is portrait 9:16 */
const DIMS = { 'source-3': [288, 216], 'source-5': [216, 384] };

/* the header chip for a zoned source: city, then " · offset". Text and
 * title are set by attachZoneChip/dressZoneChip with textContent, so a
 * zone name never becomes markup */
function zoneChip(srcTZ) {
  return srcTZ ? '<span class="st tz"><span class="tzc"></span><span class="tzo"></span></span>' : '';
}
function attachZoneChip(z, host) {
  z.el = host.querySelector('.tz');
  if (!z.el) {return;}
  z.el.querySelector('.tzc').textContent = z.texts.label;
  z.offEl = z.el.querySelector('.tzo');
}
/* refresh a zone chip's offset for instant ts: one memoized lookup, and the
 * DOM is touched only when the text changes (a DST change inside the
 * window, the cursor crossing it) */
function dressZoneChip(z, ts) {
  if (!z.el) {return;}
  const o = z.texts.off(ts);
  if (o === z.off) {return;}
  z.off = o;
  z.offEl.textContent = o ? ' · ' + o : '';
  z.el.title = 'Source time zone: ' + z.texts.zone + (o ? ' (' + o + ' from panel time)' : ' (same as panel time)');
}

/* demo frames draw a clock as the screen would: a source with a declared
 * zone shows its own local time (labelled with the city), the rest the
 * mount's zone, so they agree with their captions and the axis */
function makeBackend(P, SPAN, tz) {
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
    const own = DEMO_ZONES[kiosk];
    g.fillText(fmtTime(ts, own || tz), w / 2, h * 0.55);
    if (own) {
      g.font = Math.round(Math.min(h * 0.055, w * 0.06)) + 'px sans-serif';
      g.fillText(zoneLabel(own) + ' local time', w / 2, h * 0.655);
    }
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
        .flatMap(([s, ks]) => ks.map(k => {
          const decl = Object.assign({}, k, { site: s, location: 'demo' });
          // demo cadence events: source-3 slows 120s→240s mid-window (pace
          // change era); source-4 declares a pause for 20%–45% of the window
          // (resume inferred from its frames). source-2 keeps its UNDECLARED
          // outage — the red-vs-neutral contrast is the point of the demo.
          if (k.id === 'source-3') {
            decl.history = [
              { since: P.from - 864e5, variant: 'lo', cadence: 120e3 },
              { since: P.from + SPAN * 0.5, variant: 'lo', cadence: 240e3 },
            ];
            decl.cadence = 240e3;
          }
          if (k.id === 'source-4') {
            decl.history = [
              { since: P.from - 864e5, variant: 'lo', cadence: 60e3 },
              // demo the reason+intent vocabulary: an UNINTENDED screen-off
              // (power-policy blank) renders amber, not neutral
              { since: P.from + SPAN * 0.2, variant: 'lo', paused: true, reason: 'screen-sleep', intended: false },
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
        if (kiosk === 'source-2' && ts > gapA && ts < gapB) {continue;}
      if (kiosk === 'source-4' && ts > P.from + SPAN * 0.2 && ts < P.from + SPAN * 0.45) {continue;}
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
        { ts: P.from + SPAN * 0.30, title: 'deploy v2.4.1', text: 'rollout to site-a — https://example.com/releases/v2.4.1', tags: ['deploy'] },
        { ts: P.from + SPAN * 0.60, title: 'app restart', text: 'watchdog restarted the shell', tags: ['source:source-1'] },
        { ts: P.from + SPAN * 0.85, title: 'gateway reboot', text: 'site-b uplink flapped during carrier work', tags: ['site:site-b', 'network'] },
        { ts: P.from + SPAN * 0.68, timeEnd: P.from + SPAN * 0.78, title: 'content sync', text: 'nightly asset refresh', tags: ['maintenance'] },
        { ts: P.from + SPAN * 0.35, timeEnd: P.from + SPAN * 0.55, title: 'backend outage',
          text: 'upstream API down — source-2 dark', tags: ['source:source-2', 'incident'], color: '#ff9830' },
        { ts: P.from + SPAN * 0.520, title: 'alert: high CPU', text: 'firing', tags: ['alert'], color: '#f2495c' },
        { ts: P.from + SPAN * 0.522, title: 'alert: high CPU', text: 'still firing', tags: ['alert'], color: '#f2495c' },
        { ts: P.from + SPAN * 0.524, title: 'alert: high CPU', text: 'resolved', tags: ['alert'], color: '#f2495c' },
      ];
    },
  };
}

/* Normalize annotations from any provider (Grafana annotation frames, the
 * mock seam, a host page) into { ts, timeEnd?, title, text, tags[], color,
 * source, siteScope }. A `source:<id>` (or legacy `kiosk:<id>`) tag pins the
 * marker to that source's strip; a `site:<id>` tag scopes it to every source
 * at that site; everything else renders on the shared lane. Events from
 * wider time windows are kept if they OVERLAP ours and clamp-render. */
function normAnnotations(raw, P) {
  const out = [];
  for (const a of raw || []) {
    const ts = Number(a.ts != null ? a.ts : a.time);
    if (!Number.isFinite(ts)) {continue;}
    let end = a.timeEnd != null ? Number(a.timeEnd) : NaN;
    if (!Number.isFinite(end) || end <= ts) {end = null;}
    if ((end || ts) < P.from || ts > P.to) {continue;}
    const tags = Array.isArray(a.tags) ? a.tags.map(String)
      : a.tags ? String(a.tags).split(',').map((s) => s.trim()).filter(Boolean) : [];
    let source = a.source || null;
    let siteScope = null;
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

/* Shared fixed-position tooltip for annotation markers (one per document,
 * like the injected styles). Built with textContent — annotation text is
 * foreign data, never markup; only http(s) URLs inside it are promoted to
 * real anchors. Hover shows it; CLICK PINS it (selectable text, clickable
 * links) until a click elsewhere or Escape. */
let annTipEl = null;
let annTipPinned = false;
function annTip() {
  if (!annTipEl) {
    annTipEl = document.createElement('div');
    annTipEl.className = 'ktl-ann-tip';
    annTipEl.style.display = 'none';
    document.body.appendChild(annTipEl);
    document.addEventListener('click', (e) => {
      if (annTipPinned && !annTipEl.contains(e.target)) {close();}
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && annTipPinned) {close();}
    });
  }
  const el = annTipEl;

  function linkify(host, text) {
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

  function render(items, x, y, src, tz) {
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

  function close() {
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

/* ======================= timeline core ======================= */

const TICK_FONT = '10px -apple-system, "Segoe UI", Roboto, sans-serif';
const TICK_LABEL_GAP = 14;
let measureCtx;

function measureTickWidth(text) {
  if (!measureCtx) {measureCtx = document.createElement('canvas').getContext('2d');}
  measureCtx.font = TICK_FONT;
  return measureCtx.measureText(text).width;
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
const popState = { el: null, keyH: null, retireTimer: null };
function closePreview() {
  if (popState.retireTimer) { clearTimeout(popState.retireTimer); popState.retireTimer = null; }
  if (popState.el) { popState.el.remove(); popState.el = null; }
  if (popState.keyH) { document.removeEventListener('keydown', popState.keyH); popState.keyH = null; }
}
/* keep a strip slot's ghost <img> in step with its state: present only
 * while the slot is pending and has something to carry */
function dressGhost(slots, sl) {
  if (!sl.el) {return;}
  const g = sl.future && !sl.frame ? ghostFor(slots, sl) : null;
  let img = sl.el.querySelector('img.ghost');
  if (!g) { if (img) {img.remove();} return; }
  if (!img) { img = document.createElement('img'); img.className = 'ghost'; img.alt = ''; sl.el.appendChild(img); }
  if (img.src !== g.url) {img.src = g.url;}
}

function makePreview(root, tz) {
  // adopt: a mount created while a retire is pending cancels the close
  if (popState.retireTimer) { clearTimeout(popState.retireTimer); popState.retireTimer = null; }
  const panelTexts = zoneTexts(tz, tz, false);
  return {
    // expectedTs set = frame is the pending slot's ghost: shown blurred and
    // captioned as the last frame, never as the expected one. tt: the
    // source's time text (zoneTexts), the panel's when omitted
    open(site, kiosk, frame, x, y, hiUrl, expectedTs, tt) {
      tt = tt || panelTexts;
      closePreview();
      const el = document.createElement('div');
      el.className = 'ktl-pop' + (expectedTs ? ' ghost' : '');
      copyVars(root, el);
      el.innerHTML = '<img alt="frame"><div class="cap"></div>';
      const img = el.querySelector('img');
      el.querySelector('.cap').textContent = site + ' / ' + kiosk + ' — ' + (expectedTs
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
  root.classList.add('ktl-root');   // carries the palette defaults (CSS)
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
  if (!wrap.isConnected) {return;}
  for (const el of [...root.children]) {if (el !== wrap) {el.remove();}}
  wrap.style.visibility = '';
}
function retireWrapper(wrap) {
  wrap.dataset.stale = '1';
  setTimeout(() => wrap.remove(), 1500);
}

/* cfg: { site, from, to, width, timeZone, thumbTimes, onHover(t), onHoverClear() }
 * timeZone: an IANA name, 'utc', or undefined/'browser' (the viewer's own
 * zone, the default). It sets every time the mount shows as text — axis,
 * cursor, captions, tooltips, the demo frames' clock — and where the axis
 * ticks fall. Data stays UTC epoch ms either way.
 * thumbTimes: 'panel' (default) or 'source'. With 'source', a source that
 * declares a zone (decl.timezone) shows ITS times — magnifier and preview
 * captions, last-seen/expected text, image alt text, grid timestamps — in
 * that zone, each marked with its offset from the panel's: 07:31:00 (+3h).
 * The axis, cursor label and annotation tooltips stay in the panel zone.
 * Either way a zoned source's header names its zone: "Sydney · +3h". */
export function mountTimeline(root, cfg) {
  injectStyles();
  const P = { site: parseVar(cfg.site), source: parseVar(cfg.source), from: cfg.from, to: cfg.to };
  const TZ = resolveTimeZone(cfg.timeZone);
  const SPAN = Math.max(1, P.to - P.from);
  const LIVE = P.to > Date.now() - 2 * 60 * 1000;
  const MIN_SLICE_PX = 7;
  const hostWidth = cfg.width || root.clientWidth || 800;   // plugin passes width; web mounts measure
  const pxBudget = Math.max(10, Math.floor((hostWidth - 20) / MIN_SLICE_PX));
  const backend = cfg.apiUrl || cfg.apiFetch ? makeApiBackend(cfg.apiUrl, cfg.apiKey, cfg.apiFetch) : makeBackend(P, SPAN, TZ);

  const wrap = makeWrapper(root);
  wrap.classList.toggle('fill', cfg.fit === 'fill');
  wrap.innerHTML =
    '<div class="cards"></div>' +
    '<div class="ann-lane" style="display:none"></div>' +
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
  const axisTickList = [];   // filled by buildAxis; consumed by ruleBeyond
  let suppressClick = false;
  const pv = makePreview(root, TZ);
  const PANEL_TT = zoneTexts(TZ, TZ, false);

  /* selection band shown on every card during drag-zoom (fractions of window) */
  function showSelection(fa, fb) {
    const a = Math.min(fa, fb), b = Math.max(fa, fb);
    for (const k of kiosks) {
      const c = cards[k.id];
      if (!c) {continue;}
      const w = c.strip.clientWidth;
      c.sel.style.display = 'block';
      c.sel.style.left = (a * w) + 'px';
      c.sel.style.width = ((b - a) * w) + 'px';
    }
  }
  function hideSelection() {
    for (const k of kiosks) {if (cards[k.id]) {cards[k.id].sel.style.display = 'none';}}
  }


  /* Post-layout dressing, idempotent and re-runnable:
   * - align each empty slot's hatch to its strip offset so the diagonals run
   *   continuously across gap runs (per-element gradients restart at every
   *   slot edge; narrow runs otherwise read as one solid block)
   * - wide pause bands carry their label inline: a strip that is ALL
   *   "screen dark" should say so without requiring a hover
   * Needs real layout — called at build (visible mounts) and again after
   * reveal with retries (panels that mount before they have a size). */
  function dressStrip(model) {
    for (const sl of model.slots) {
      if (!sl.el || sl.frame) {continue;}
      sl.el.style.backgroundPosition = (-sl.el.offsetLeft) + 'px 0';
      if (sl.paused && sl.el.offsetWidth >= 90 && !sl.el.querySelector('.band-label')) {
        const lab = document.createElement('span');
        lab.className = 'band-label';
        lab.textContent = pauseInfo(sl).label;
        sl.el.appendChild(lab);
      }
    }
  }
  function dressAll(tries) {
    const anySized = kiosks.some((k) => cards[k.id] && cards[k.id].strip.clientWidth > 0);
    if (!anySized) {
      if (tries > 0 && !destroyed) {setTimeout(() => dressAll(tries - 1), 500);}
      return;
    }
    for (const k of kiosks) {if (cards[k.id]) {dressStrip(cards[k.id].model);}}
  }

  function buildCard(decl, model) {
    const kiosk = decl.id;
    const zone = zoneFor(decl, TZ, cfg.thumbTimes, PANEL_TT), tt = zone.tt;
    const card = document.createElement('div');
    const inline = cfg.headerMode === 'inline' || cfg.headerMode === 'inline-gradient';
    card.className = 'card' + (inline ? ' inline-head' : '') +
      (cfg.headerMode === 'inline-gradient' ? ' inline-grad' : '');
    const la = model.lastActive;
    const cad = cfg.showDetails && la
      ? '<span class="cad">⏱ ' + fmtDur(la.cadence) + ' · 1/' + fmtDur(la.step) + (la.step > la.cadence ? ' ↓' : '') + '</span>'
      : '';
    card.innerHTML =
      '<div class="card-head" title="' + esc(headTitle(decl)) + '"><span class="nm">' + esc(kiosk) + '</span>' +
      '<span class="inline-brk"></span>' + zoneChip(zone.srcTZ) +
      '<span class="st">' + esc(decl.site) + (decl.location ? ' · ' + esc(decl.location) : '') + '</span>' +
      tagChips(decl) + '<span class="ft"></span>' +
      cad + '</div>' +
      '<div class="strip"><div class="xh"></div><div class="sel"></div><div class="mag"><img alt=""><div class="cap"></div></div></div>' +
      '<div class="card-lane"></div>';
    const strip = card.querySelector('.strip');
    // hairline frame boundaries only when slices are wide enough — below
    // ~12px they read as zebra noise rather than structure
    if (hostWidth / model.slots.length >= 12) {strip.classList.add('sep');}
    const slots = model.slots;
    for (const sl of slots) {
      const el = document.createElement('div');
      el.className = 'slot' + slotClass(sl);
      if (sl.paused) {el.title = pauseInfo(sl).label.toLowerCase();}
      // width ∝ time span, so x↔time stays linear across era boundaries
      el.style.flexGrow = String(sl.span / 1000);
      if (sl.frame) {
        const img = document.createElement('img');
        img.src = sl.frame.url; img.alt = kiosk + ' ' + tt.time(sl.ts) + tt.sfx(sl.ts);
        el.appendChild(img);
      }
      strip.appendChild(el);
      sl.el = el;
    }
    for (const sl of slots) {if (sl.future) {dressGhost(slots, sl);}}
    dressStrip(model);   // hatch alignment + band labels (re-run post-reveal)
    const hoverAt = e => {
      const r = strip.getBoundingClientRect();
      if (!r.width) {return;}   // stale wrapper mid-swap: no geometry, no cursor
      const t = P.from + SPAN * ((e.clientX - r.left) / r.width);
      setCursor(t, card, false);
    };
    strip.addEventListener('mousemove', hoverAt);
    strip.addEventListener('mouseenter', e => {
      wrap.classList.add('strip-hover');
      // a refresh swaps the DOM under a STATIONARY cursor: the browser fires
      // mouseenter on the new strip but no mousemove, so without this the
      // dim class lands with no card marked hovered — everything dims,
      // including the strip under the mouse
      hoverAt(e);
    });
    strip.addEventListener('mouseleave', () => {
      wrap.classList.remove('strip-hover');
      if (cfg.onHoverClear) {cfg.onHoverClear();}
    });
    strip.addEventListener('click', e => {
      if (suppressClick) { suppressClick = false; return; }
      const sl = model.slotAt(cursorT);
      const f = sl && sl.frame;
      const g = !f && sl && sl.future ? ghostFor(model.slots, sl) : null;
      if (f) {pv.open(decl.site, kiosk, f, e.clientX, e.clientY, hiUrlFor(f, decl, cfg.apiUrl, cfg.apiKey), null, tt);}
      else if (g) {pv.open(decl.site, kiosk, g, e.clientX, e.clientY, null, sl.ts, tt);}
    });
    /* magnifier takes the aspect of the actual frames (portrait screens etc.) */
    const magEl = card.querySelector('.mag');
    const magImg = magEl.querySelector('img');
    magImg.addEventListener('load', () => {
      if (magImg.naturalWidth && magImg.naturalHeight)
        {magEl.style.aspectRatio = String(magImg.naturalWidth / magImg.naturalHeight);}
    });
    /* drag-select = zoom, grafana-style: band across all cards, release → onZoom */
    strip.addEventListener('mousedown', e => {
      if (e.button !== 0) {return;}
      e.preventDefault();
      const r = strip.getBoundingClientRect();
      const fracOf = x => Math.max(0, Math.min(1, (x - r.left) / r.width));
      const f0 = fracOf(e.clientX);
      let dragged = false;
      const move = ev => {
        if (destroyed) {return up(ev);}
        const f1 = fracOf(ev.clientX);
        if (Math.abs(f1 - f0) * r.width > 5) {dragged = true;}
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
          if (b > a && cfg.onZoom) {cfg.onZoom(Math.round(P.from + SPAN * a), Math.round(P.from + SPAN * b));}
        }
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
    q('.cards').appendChild(card);
    attachZoneChip(zone, card);
    return {
      card, model, zone, tt,
      head: card.querySelector('.ft'),
      strip,
      cross: card.querySelector('.xh'),
      sel: card.querySelector('.sel'),
      mag: card.querySelector('.mag'),
      lane: card.querySelector('.card-lane'),
    };
  }

  function buildAxis() {
    const axis = q('.axis');
    const w = axis.clientWidth;

    // pass 1: rough step from a flat guess, just to pick a representative
    // label to measure (mirrors Grafana's calculateSpace bootstrap)
    const roughMaxTicks = Math.max(3, Math.floor(w / 90));
    const roughStep = TICK_STEPS.find(s => SPAN / s <= roughMaxTicks) || TICK_STEPS[TICK_STEPS.length - 1];
    const sampleWidth = measureTickWidth(tickFormat(roughStep, TZ)(P.to));

    // pass 2: real step, sized to the label width that will actually render
    const maxTicks = Math.max(3, Math.floor(w / (sampleWidth + TICK_LABEL_GAP)));
    const tickStep = TICK_STEPS.find(s => SPAN / s <= maxTicks) || TICK_STEPS[TICK_STEPS.length - 1];
    const fmt = tickFormat(tickStep, TZ);

    axis.querySelectorAll('.tick').forEach(t => t.remove());
    axisTickList.length = 0;
    for (const ts of axisTicks(P.from, P.to, tickStep, TZ)) {
      axisTickList.push(ts);
      const el = document.createElement('div');
      el.className = 'tick';
      el.style.left = ((ts - P.from) / SPAN * w) + 'px';
      el.textContent = fmt(ts);
      axis.appendChild(el);
    }
  }

  /* The beyond-now spacer looks EMPTY, not black — the card's own surface,
   * ruled only by hairlines continuing the axis ticks (black is a signal in
   * a screenshot timeline; the future is the absence of signal). Re-run
   * whenever the spacer's geometry changes (poll carving/band growth). */
  function ruleBeyond(sl) {
    if (!sl || !sl.beyond || !sl.el) {return;}
    sl.el.querySelectorAll('.bt').forEach(t => t.remove());
    for (const ts of axisTickList) {
      if (ts <= sl.ts || ts > sl.ts + sl.span) {continue;}
      const t = document.createElement('div');
      t.className = 'bt';
      t.style.left = (((ts - sl.ts) / sl.span) * 100).toFixed(3) + '%';
      sl.el.appendChild(t);
    }
  }
  function ruleAllBeyond() {
    for (const k of kiosks) {
      const c = cards[k.id];
      if (!c) {continue;}
      const last = c.model.slots[c.model.slots.length - 1];
      if (last && last.beyond) {ruleBeyond(last);}
    }
  }

  /* Annotations: per-source markers ride that source's strip; the rest
   * share one lane above the axis. Regions shade their span; markers
   * cluster when closer than ~10px. Positions are %-based so they survive
   * flexbox resizes without a re-render. */
  function renderAnnotations(anns) {
    const tip = annTip();
    const fracOf = (t) => (Math.max(P.from, Math.min(P.to, t)) - P.from) / SPAN;
    const pct = (f) => (f * 100).toFixed(3) + '%';

    function addRegion(host, a) {
      const el = document.createElement('div');
      el.className = 'ann-region';
      el.style.left = pct(fracOf(a.ts));
      el.style.width = pct(fracOf(a.timeEnd) - fracOf(a.ts));
      if (a.color) { el.style.background = a.color + '22'; el.style.borderColor = a.color + '88'; }
      host.appendChild(el);
    }
    function addMarkers(host, items) {
      // cluster markers closer than ~10px so dense event bursts stay legible
      const groups = [];
      for (const a of items) {
        const g = groups[groups.length - 1];
        if (g && (fracOf(a.ts) - fracOf(g[0].ts)) * hostWidth < 10) {g.push(a);}
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
          tip.show(g, r.left + r.width / 2, r.top, el, TZ);
        });
        el.addEventListener('mouseleave', () => tip.hide());
        el.addEventListener('click', (e) => {
          // pin: selectable text + clickable links; don't open the frame
          // preview underneath, and don't let the document unpin us
          e.stopPropagation();
          const r = el.getBoundingClientRect();
          tip.pin(g, r.left + r.width / 2, r.top, el, TZ);
        });
        host.appendChild(el);
      }
    }

    // scoping: source:<id> pins to one card, site:<id> to every card at
    // that site, neither = global. A scoped annotation whose target isn't
    // on this panel is DROPPED, not shown global — its context is absent.
    const appliesTo = (a, k) =>
      (!a.source || a.source === k.id) && (!a.siteScope || a.siteScope === k.site);
    const isGlobal = (a) => !a.source && !a.siteScope;

    if (cfg.annotationLanes === 'per-source') {
      // one lane per card: its own scoped events plus every global, so each
      // timeline reads in context — stacked windows never share one bar
      for (const k of kiosks) {
        const c = cards[k.id];
        const items = anns.filter((a) => appliesTo(a, k));
        if (!items.length) {continue;}
        c.card.classList.add('has-lane');
        for (const a of items) {if (a.timeEnd) { addRegion(c.strip, a); addRegion(c.lane, a); }}
        addMarkers(c.lane, items);
      }
      return;
    }

    const laneItems = [], perCard = {};
    for (const a of anns) {
      if (isGlobal(a)) {laneItems.push(a);}
      else {for (const k of kiosks) {if (appliesTo(a, k)) {(perCard[k.id] ||= []).push(a);}}}
      if (a.timeEnd) {
        // regions shade the strips they scope to; globals also shade the lane
        const hosts = isGlobal(a)
          ? kiosks.map((k) => cards[k.id].strip).concat([q('.ann-lane')])
          : kiosks.filter((k) => appliesTo(a, k)).map((k) => cards[k.id].strip);
        for (const h of hosts) {addRegion(h, a);}
      }
    }
    for (const [id, items] of Object.entries(perCard)) {addMarkers(cards[id].strip, items);}
    if (laneItems.length) {addMarkers(q('.ann-lane'), laneItems);}
    if (laneItems.length || anns.some((a) => a.timeEnd && isGlobal(a))) {q('.ann-lane').style.display = '';}
  }

  /* external=true → came from the event bus; don't re-publish (no loop) */
  function setCursor(t, hoveredCard, external) {
    cursorT = Math.max(P.from, Math.min(P.to, t));
    root.dataset.ktlCursor = String(cursorT);
    if (!external) {root.dataset.ktlPinned = '1';}
    if (cfg.onCursor) {cfg.onCursor(cursorT);}        // host chrome hook (standalone app)
    const frac = (cursorT - P.from) / SPAN;

    const axis = q('.axis'), ac = q('.acur');
    const acW = ac.offsetWidth || 50;
    ac.textContent = fmtTime(cursorT, TZ);
    ac.style.left = Math.max(acW / 2, Math.min(axis.clientWidth - acW / 2, frac * axis.clientWidth)) + 'px';

    for (const k of kiosks) {
      const c = cards[k.id];
      if (!c) {continue;}
      // external cursor moves (event bus) must not strip local hover state —
      // other panels re-emit hover events and would un-dim us mid-hover
      if (!external) {c.card.classList.toggle('hovered', hoveredCard === c.card);}
      const w = c.strip.clientWidth, x = frac * w;
      c.cross.style.left = x + 'px';
      const slot = c.model.slotAt(cursorT);
      const tt = c.tt;
      // the zone chip's offset at the cursor: changes only across a DST edge
      if (c.zone.el) {dressZoneChip(c.zone, cursorT);}
      const magW = c.mag.offsetWidth || c.strip.clientHeight * 16 / 9;
      c.mag.style.left = Math.max(0, Math.min(w - magW, x - magW / 2)) + 'px';
      c.mag.classList.remove('ghost');
      if (slot && slot.frame) {
        c.mag.classList.remove('gap', 'future', 'off'); clearPauseClasses(c.mag);
        c.mag.querySelector('img').src = slot.frame.url;
        c.mag.querySelector('.cap').textContent = tt.time(slot.frame.ts) + tt.sfx(slot.frame.ts);
        c.head.textContent = '';                 // healthy: time lives on the magnifier
        c.head.classList.remove('stale'); clearPauseClasses(c.head);
      } else if (slot && slot.paused) {
        // declared silence — neutral (or amber when unintended), not offline-red
        const pi = pauseInfo(slot);
        c.mag.classList.remove('gap', 'future', 'off'); clearPauseClasses(c.mag);
        c.mag.classList.add(...pi.classes);
        c.mag.querySelector('.cap').textContent = pi.label.toLowerCase();
        c.head.textContent = pi.label.toLowerCase();
        c.head.classList.remove('stale'); clearPauseClasses(c.head);
        c.head.classList.add(...pi.classes);
      } else if (slot && slot.beyond) {
        // ahead of now: unknown — nothing to preview, only the crosshair
        c.mag.classList.remove('gap', 'future'); clearPauseClasses(c.mag);
        c.mag.classList.add('off');
        c.head.textContent = '';
        c.head.classList.remove('stale'); clearPauseClasses(c.head);
      } else if (slot && slot.future) {
        // not offline, not stale: either the tick is ahead of now, or it
        // just passed and its frame is still in flight (one-step grace)
        const inFlight = slot.ts <= Date.now();
        const g = ghostFor(c.model.slots, slot);
        c.mag.classList.remove('gap', 'off'); clearPauseClasses(c.mag);
        c.mag.classList.add('future');
        if (g) { c.mag.classList.add('ghost'); c.mag.querySelector('img').src = g.url; }
        c.mag.querySelector('.cap').textContent = (inFlight ? 'expected — ' : 'upcoming — ') + tt.short(slot.ts) +
          (g ? ' · last frame ' + tt.time(g.ts) : '') + tt.sfx(slot.ts);
        c.head.textContent = inFlight ? 'expected' : 'upcoming';
        c.head.classList.remove('stale'); clearPauseClasses(c.head);
      } else {
        c.mag.classList.add('gap');
        c.mag.classList.remove('future', 'off'); clearPauseClasses(c.mag);
        const i = slot ? c.model.slots.indexOf(slot) : c.model.slots.length - 1;
        let last = null;
        for (let j = i; j >= 0; j--) {if (c.model.slots[j].frame) { last = c.model.slots[j].frame; break; }}
        const msg = last ? 'offline — last seen ' + tt.time(last.ts) + tt.sfx(last.ts) : 'no data in window';
        c.mag.querySelector('.cap').textContent = msg;
        c.head.textContent = msg;
        c.head.classList.add('stale');
        clearPauseClasses(c.head);
      }
    }
    if (!external && cfg.onHover) {cfg.onHover(cursorT);}
  }

  (async function boot() {
    try {
      kiosks = (await backend.kiosks(P.site))
        .filter((k) => !P.source || P.source.includes(k.id))
        .filter((k) => matchesTags(k.tags, parseTagFilter(cfg.tagFilter)));
    } catch (e) {
      // registry unreachable (or hung past the fetch timeout): SAY so —
      // an eternally blank panel points the blame at the wrong layer
      console.warn('[visual-timeline] sources fetch failed:', e);
      if (destroyed) {return;}
      const err = document.createElement('div');
      err.className = 'boot-err';
      err.textContent = 'frames API unreachable — ' + (e && e.message ? e.message : e);
      q('.cards').appendChild(err);
      await revealWrapper(root, wrap);
      return;
    }
    for (const k of kiosks) {
      if (destroyed) {return;}
      let model;
      try {
        model = await buildSourceModel(k, P, backend, pxBudget);
      } catch (e) {
        // one source's backend hiccup must not black out the whole panel;
        // the next refresh retries it
        console.warn('[visual-timeline] model build failed for ' + k.id + ':', e);
        continue;
      }
      if (destroyed) {return;}
      // declared pause IS data — a source that is all SCREEN DARK for the
      // window must render its band, not vanish as if it never reported
      if (cfg.hideEmpty && !model.slots.some((sl) => sl.frame || sl.paused)) {continue;}
      cards[k.id] = buildCard(k, model);
    }
    kiosks = kiosks.filter((k) => cards[k.id]);
    buildAxis();
    ruleAllBeyond();
    // host-provided annotations (Grafana: the dashboard's own annotation
    // queries, whatever data source they run on) win; the mock seam only
    // fills demo mode so the feature is visible without a backend
    const rawAnns = (cfg.annotations && cfg.annotations.length)
      ? cfg.annotations
      : (backend.annotations ? backend.annotations() : []);
    if (cfg.showAnnotations !== false) {renderAnnotations(normAnnotations(rawAnns, P));}
    setCursor(cursorT, null, true);   // rest position; don't publish
    await revealWrapper(root, wrap);  // swap in only once images decoded
    dressAll(20);                     // hatch alignment + labels once layout is real

    if (LIVE) {
      const steps = kiosks.map(k => cards[k.id].model.lastActive && cards[k.id].model.lastActive.step).filter(Boolean);
      const minStep = steps.length ? Math.min.apply(null, steps) : 60e3;
      pollTimer = setInterval(async () => {
        for (const k of kiosks) {
          const c = cards[k.id];
          // advance the live edge: newly-elapsed ticks are carved out of the
          // beyond filler (active tail), or a tail pause band GROWS into it —
          // the strip keeps sliding between dashboard refreshes without ever
          // shading time that hasn't happened
          const mSlots = c.model.slots;
          const filler = mSlots.length && mSlots[mSlots.length - 1].beyond ? mSlots[mSlots.length - 1] : null;
          if (filler) {
            const nowP = Date.now();
            const prev = mSlots.length > 1 ? mSlots[mSlots.length - 2] : null;
            if (prev && prev.paused) {
              const grow = Math.min(nowP, filler.ts + filler.span) - filler.ts;
              if (grow > 0) {
                prev.span += grow;
                filler.ts += grow; filler.span -= grow;
                if (prev.el) {prev.el.style.flexGrow = String(prev.span / 1000);}
                if (filler.span <= 0) { if (filler.el) {filler.el.remove();} mSlots.pop(); }
                else { if (filler.el) {filler.el.style.flexGrow = String(filler.span / 1000);} ruleBeyond(filler); }
              }
            } else if (prev && prev.step) {
              let nextTs = prev.ts + prev.step;
              while (mSlots[mSlots.length - 1] && mSlots[mSlots.length - 1].beyond && nextTs <= nowP) {
                const f = mSlots[mSlots.length - 1];
                const sl = { ts: nextTs, span: prev.step, frame: null, cadence: prev.cadence, step: prev.step, future: true };
                const el = document.createElement('div');
                el.className = 'slot future';
                el.style.flexGrow = String(sl.span / 1000);
                if (f.el && f.el.parentNode) {f.el.parentNode.insertBefore(el, f.el);}
                sl.el = el;
                mSlots.splice(mSlots.length - 1, 0, sl);
                f.span -= sl.span; f.ts += sl.span;
                if (f.span <= 0) { if (f.el) {f.el.remove();} mSlots.pop(); }
                else { if (f.el) {f.el.style.flexGrow = String(f.span / 1000);} ruleBeyond(f); }
                nextTs += prev.step;
              }
            }
          }
          const la = c.model.lastActive;
          if (!la) {continue;}                    // tail era is a declared pause
          let lastTs = P.from;
          for (let i = c.model.slots.length - 1; i >= 0; i--) {
            if (c.model.slots[i].frame) { lastTs = c.model.slots[i].ts; break; }
          }
          const fresh = await backend.frames(k.site, k.id, lastTs + 1, Date.now(), la.step);
          if (destroyed) {return;}
          for (const f of fresh) {
            const slot = c.model.slotAt(f.ts);
            if (!slot || slot.paused || slot.beyond) {continue;}
            // newer frames REPLACE the bucket representative (frames past
            // the window end clamp into the last bucket) so the right edge
            // keeps sliding between dashboard refreshes — grid parity
            if (slot.frame && f.ts <= slot.frame.ts) {continue;}
            slot.frame = f;
            slot.future = false;
            slot.el.classList.remove('gap', 'future');
            // the real frame replaces the ghost in place: a snap, no fade
            let img = slot.el.querySelector('img');
            if (!img) { img = document.createElement('img'); slot.el.appendChild(img); }
            img.classList.remove('ghost');
            img.src = f.url; img.alt = k.id + ' ' + c.tt.time(f.ts) + c.tt.sfx(f.ts);
          }
          // future slots age into the present; one still empty a full step
          // past its tick has now genuinely missed its heartbeat
          const overdue = Date.now();
          for (const sl of c.model.slots) {
            if (missedHeartbeat(sl, overdue)) {
              sl.future = false;
              if (sl.el) { sl.el.classList.remove('future'); sl.el.classList.add('gap'); }
            }
          }
          // one pass covers every path above: newly carved pending slots
          // pick up a ghost, a missed heartbeat drops it
          for (const sl of c.model.slots) {dressGhost(c.model.slots, sl);}
        }
      }, Math.min(minStep, 10000));
    }
  })();

  return {
    setExternalCursor(t) { if (!destroyed) {setCursor(t, null, true);} },
    isHovering() { return wrap.classList.contains('strip-hover'); },
    destroy() {
      destroyed = true;
      if (pollTimer) {clearInterval(pollTimer);}
      pv.retire();   // an open preview survives refresh remounts (adopted by the successor)
      annTip().close();   // a hovered or pinned tip at teardown would strand
      retireWrapper(wrap);
    },
  };
}

/* ======================= multiview grid mode =======================
 * One tile per kiosk, no timeline. Shows the most recent frame in the
 * window; with follow-crosshair on, shows the frame at the shared
 * crosshair time while another panel is hovered, reverting on clear. */
export function mountGrid(root, cfg) {
  injectStyles();
  const P = { site: parseVar(cfg.site), source: parseVar(cfg.source), from: cfg.from, to: cfg.to };
  const TZ = resolveTimeZone(cfg.timeZone);   // as mountTimeline
  const SPAN = Math.max(1, P.to - P.from);
  const LIVE = P.to > Date.now() - 2 * 60 * 1000;
  const backend = cfg.apiUrl || cfg.apiFetch ? makeApiBackend(cfg.apiUrl, cfg.apiKey, cfg.apiFetch) : makeBackend(P, SPAN, TZ);
  const budget = 120;   // temporal buckets for crosshair-follow resolution

  const wrap = makeWrapper(root);
  wrap.classList.toggle('fill', cfg.fit === 'fill');
  wrap.innerHTML = '<div class="grid"></div>';
  const q = sel => wrap.querySelector(sel);

  let kiosks = [], tiles = {}, destroyed = false, pollTimer = null, shownT = null;
  const pv = makePreview(root, TZ);
  const PANEL_TT = zoneTexts(TZ, TZ, false);

  function buildTile(decl, model) {
    const el = document.createElement('div');
    const zone = zoneFor(decl, TZ, cfg.thumbTimes, PANEL_TT);
    const inline = cfg.headerMode === 'inline' || cfg.headerMode === 'inline-gradient';
    el.className = 'tile' + (inline ? ' inline-head' : '') +
      (cfg.headerMode === 'inline-gradient' ? ' inline-grad' : '');
    el.innerHTML =
      '<div class="t-head" title="' + esc(headTitle(decl)) + '"><span class="nm">' + esc(decl.id) + '</span>' +
      '<span class="inline-brk"></span>' + zoneChip(zone.srcTZ) +
      '<span class="st">' + esc(decl.site) + (decl.location ? ' · ' + esc(decl.location) : '') + '</span>' +
      tagChips(decl) + '</div>' +
      '<div class="t-img"><img alt="' + esc(decl.id) + '"><span class="t-ts"></span><div class="t-off"></div></div>';
    attachZoneChip(zone, el);
    const rec = {
      decl, model, el, shown: null, zone, tt: zone.tt,
      img: el.querySelector('img'),
      ts: el.querySelector('.t-ts'),
      off: el.querySelector('.t-off'),
    };
    el.addEventListener('click', e => {
      if (rec.shown && rec.shownExpected) {pv.open(decl.site, decl.id, rec.shown, e.clientX, e.clientY, null, rec.shownExpected, rec.tt);}
      else if (rec.shown) {pv.open(decl.site, decl.id, rec.shown, e.clientX, e.clientY, hiUrlFor(rec.shown, decl, cfg.apiUrl, cfg.apiKey), null, rec.tt);}
    });
    q('.grid').appendChild(el);
    return rec;
  }

  function lastFrame(rec) {
    for (let i = rec.model.slots.length - 1; i >= 0; i--) {
      if (rec.model.slots[i].frame) {return rec.model.slots[i].frame;}
    }
    return null;
  }

  /* t = null → most recent in window; otherwise frame at crosshair time */
  function setShown(t) {
    shownT = t;
    if (cfg.onShown) {cfg.onShown(t);}                // host chrome hook (standalone app)
    // zone chips: offset at the crosshair, else at the window's live edge
    const zoneAt = t == null ? Math.min(P.to, Date.now()) : t;
    for (const k of kiosks) {
      const rec = tiles[k.id];
      if (!rec) {continue;}
      if (rec.zone.el) {dressZoneChip(rec.zone, zoneAt);}
      const tt = rec.tt;
      let frame = null, offMsg = null, pausedMsg = null, pausedSlot = null, expectedTs = null;
      const la = rec.model.lastActive;
      if (t == null) {
        const tail = rec.model.slots.length ? rec.model.slots[rec.model.slots.length - 1] : null;
        const tailPaused = tail && tail.paused;
        frame = lastFrame(rec);
        if (tailPaused) {
          pausedSlot = tail;
          pausedMsg = pauseInfo(tail).label + (frame ? ' — last frame ' + tt.time(frame.ts) + tt.sfx(frame.ts) : '');
        }
        else if (!frame) {offMsg = 'no data in window';}
        else if (LIVE && la && Date.now() - frame.ts > 2 * la.step)
          {offMsg = 'OFFLINE — last seen ' + tt.time(frame.ts) + tt.sfx(frame.ts);}
      } else {
        const slot = rec.model.slotAt(t);
        if (slot && slot.paused) {
          pausedSlot = slot;
          pausedMsg = pauseInfo(slot).label;
        } else {
          frame = slot && slot.frame;
          if (!frame) {
            if (slot && slot.beyond) {
              offMsg = '—';   // ahead of now: unknown, not a failure
            } else if (slot && slot.future) {
              // just-passed tick, frame in flight: show the last frame as a
              // ghost when there is one (never the red offline tile)
              frame = ghostFor(rec.model.slots, slot);
              if (frame) {expectedTs = slot.ts;}
              else {offMsg = 'EXPECTED — ' + tt.short(slot.ts) + tt.sfx(slot.ts);}
            } else {
              const i = slot ? rec.model.slots.indexOf(slot) : rec.model.slots.length - 1;
              let last = null;
              for (let j = i; j >= 0; j--) {if (rec.model.slots[j].frame) { last = rec.model.slots[j].frame; break; }}
              offMsg = last ? 'OFFLINE — last seen ' + tt.time(last.ts) + tt.sfx(last.ts) : 'no data';
            }
          }
        }
      }
      rec.el.classList.toggle('offline', !!offMsg);
      clearPauseClasses(rec.el);
      if (pausedMsg && !offMsg) {rec.el.classList.add(...pauseInfo(pausedSlot).classes);}
      rec.off.textContent = offMsg || pausedMsg || '';
      rec.el.classList.toggle('ghost', !!expectedTs);
      rec.shown = frame;
      rec.shownExpected = expectedTs;
      if (frame && !offMsg && !pausedMsg) {
        rec.img.src = frame.url;
        rec.ts.textContent = (expectedTs
          ? 'expected ' + tt.short(expectedTs) + ' · last ' + tt.time(frame.ts)
          : tt.time(frame.ts)) + tt.sfx(frame.ts);
      }
    }
  }

  (async function boot() {
    try {
      kiosks = (await backend.kiosks(P.site))
        .filter((k) => !P.source || P.source.includes(k.id))
        .filter((k) => matchesTags(k.tags, parseTagFilter(cfg.tagFilter)));
    } catch (e) {
      console.warn('[visual-timeline] sources fetch failed:', e);
      if (destroyed) {return;}
      const err = document.createElement('div');
      err.className = 'boot-err';
      err.textContent = 'frames API unreachable — ' + (e && e.message ? e.message : e);
      q('.grid').appendChild(err);
      await revealWrapper(root, wrap);
      return;
    }
    for (const k of kiosks) {
      if (destroyed) {return;}
      let model;
      try {
        model = await buildSourceModel(k, P, backend, budget);
      } catch (e) {
        console.warn('[visual-timeline] model build failed for ' + k.id + ':', e);
        continue;
      }
      if (destroyed) {return;}
      // declared pause IS data — a source that is all SCREEN DARK for the
      // window must render its band, not vanish as if it never reported
      if (cfg.hideEmpty && !model.slots.some((sl) => sl.frame || sl.paused)) {continue;}
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
          if (!la) {continue;}                   // tail era is a declared pause
          const last = lastFrame(rec);
          const fresh = await backend.frames(k.site, k.id, (last ? last.ts : P.from) + 1, Date.now(), la.step);
          if (destroyed) {return;}
          for (const f of fresh) {
            const slot = rec.model.slotAt(f.ts);
            if (!slot || slot.paused || slot.beyond) {continue;}
            // newer frames replace the bucket representative so "latest" slides
            if (!slot.frame || f.ts > slot.frame.ts) {slot.frame = f;}
          }
        }
        if (shownT == null) {setShown(null);}   // keep "latest" tiles fresh
      }, 10000);
    }
  })();

  return {
    setExternalCursor(t) { if (!destroyed) {setShown(Math.max(P.from, Math.min(P.to, t)));} },
    clearExternal() { if (!destroyed) {setShown(null);} },
    destroy() {
      destroyed = true;
      if (pollTimer) {clearInterval(pollTimer);}
      pv.retire();   // an open preview survives refresh remounts (adopted by the successor)
      retireWrapper(wrap);
    },
  };
}

