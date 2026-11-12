/* ======================= styles (injected once) =======================
 * The core's whole stylesheet, injected into <head> once per document, and
 * the palette variables a host themes it with. */
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
export const KTL_VAR_DEFAULTS: Record<string, string> = {
  '--ktl-bg': '#181b1f', '--ktl-bg2': '#22262b', '--ktl-border': '#2c3235', '--ktl-text': '#ccccdc',
  '--ktl-dim': '#7b8087', '--ktl-muted': '#9aa0a6', '--ktl-strong': '#fff', '--ktl-chip-text': '#b9bec6',
  '--ktl-link': '#6e9fff', '--ktl-accent': '#f2cc0c', '--ktl-sel': 'rgba(242,204,12,.14)',
  '--ktl-live': '#73bf69', '--ktl-off': '#f2495c', '--ktl-axis-grid': 'rgba(240,250,255,.09)',
  '--ktl-media': '#111', '--ktl-mag-bg': '#000', '--ktl-float-bg': '#0b0c0e', '--ktl-divider': '#1d2024',
  '--ktl-shadow': '0 8px 32px rgba(0,0,0,.7)', '--ktl-pending': '#232830', '--ktl-scrim': 'rgba(0,0,0,.6)',
  '--ktl-gap-a': '#1b1215', '--ktl-gap-b': '#2a171b',
  '--ktl-pause-a': '#15171a', '--ktl-pause-b': '#232830', '--ktl-tpause-a': '#17191c', '--ktl-tpause-b': '#1d2024',
  '--ktl-ann': '#5794F2', '--ktl-ann-edge': '#0b0c0e',
  '--ktl-ann-region': 'rgba(87,148,242,.12)', '--ktl-ann-region-edge': 'rgba(87,148,242,.55)',
};
const KTL_VARS = Object.keys(KTL_VAR_DEFAULTS);
/* the width (px) a magnifier caption may always take, however narrow the
 * magnifier: see .mag .cap below, and setCursor */
export const MAG_CAP_ROOM = 90;
/* the resolved palette of `from` (a mount root or anything inside one),
 * set inline on `to`: how body-level popups follow the panel they serve */
export function copyVars(from: Element | null | undefined, to: HTMLElement): void {
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
/* cards share panel height equally (fewer hosts → taller strips), but
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
.ktl .card-head .ft.stale.nodata { color:var(--ktl-dim); }
.ktl .card-head .cad { margin-left:auto; font-size:10px; color:var(--ktl-dim); }
.ktl .strip { flex:1 1 auto; min-height:0; position:relative; display:flex; align-items:stretch;
              cursor:crosshair; background:var(--ktl-media); }
/* a strip has focus only from the keyboard (a press doesn't focus it) */
.ktl .strip:focus { outline:none; }
.ktl .strip:focus-visible { outline:2px solid var(--ktl-accent); outline-offset:-2px; }
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
.ktl .slot img:not([src]) { visibility:hidden; }   /* queued (ui/imageQueue.ts): no alt text or broken-image icon meanwhile */
.ktl .slot.gap { background:repeating-linear-gradient(45deg,var(--ktl-gap-a),var(--ktl-gap-a) 5px,var(--ktl-gap-b) 5px,var(--ktl-gap-b) 10px); }
/* no data (no promise in force, or none kept past its hold limit): the
 * neutral hatch, not the red one (docs/TIMELINE-MODEL.md) */
.ktl .slot.gap.nodata { background:repeating-linear-gradient(45deg,var(--ktl-pause-a),var(--ktl-pause-a) 5px,var(--ktl-pause-b) 5px,var(--ktl-pause-b) 10px); }
/* dropped time inside cells that show a frame, at its true place: at least
 * a pixel, so an outage shorter than a slot still shows */
.ktl .strip .drops { position:absolute; inset:0; pointer-events:none; z-index:2; }
.ktl .strip .drop { position:absolute; top:0; bottom:0; min-width:1px; background:var(--ktl-off); opacity:.8; }
/* video clips (M10c): a slot with no frame that a clip covers is a plain
 * band with a play mark, and a line along the strip's foot shows where the
 * host has video, over frames too */
.ktl .slot.clip { background:var(--ktl-pause-a); }
.ktl .slot.clip::before { content:'▶'; position:absolute; top:50%; left:50%; transform:translate(-50%,-50%);
  font-size:10px; line-height:1; color:var(--ktl-link); opacity:.85; pointer-events:none; }
.ktl .strip .clips { position:absolute; left:0; right:0; bottom:0; height:3px; pointer-events:none; z-index:2; }
.ktl .strip .cliplane { position:absolute; top:0; bottom:0; min-width:1px; background:var(--ktl-link); opacity:.8; }
.ktl .slot.paused { background:repeating-linear-gradient(45deg,var(--ktl-pause-a),var(--ktl-pause-a) 7px,var(--ktl-pause-b) 7px,var(--ktl-pause-b) 14px); }
.ktl.filterable [data-fk] { cursor:pointer; }
.ktl.filterable [data-fk]:hover { text-decoration:underline; text-underline-offset:2px; }
.ktl.filterable [data-fk]:focus-visible { outline:2px solid var(--ktl-accent); outline-offset:1px; }
/* an inline header lets hover through to the image, but not its filters */
.ktl.filterable .inline-head [data-fk] { pointer-events:auto; }
/* a pause from a state query brings its own colour (its value mapping) */
.ktl .slot.paused.tinted { background:repeating-linear-gradient(45deg,color-mix(in srgb,var(--ktl-band) 30%,transparent),color-mix(in srgb,var(--ktl-band) 30%,transparent) 7px,color-mix(in srgb,var(--ktl-band) 12%,transparent) 7px,color-mix(in srgb,var(--ktl-band) 12%,transparent) 14px); }
/* hatch continuity: each slot is its own element, so a per-element gradient
 * restarts at every slot edge — a run of narrow slots shows only the first
 * stripe color and reads as a SOLID block. dressStrip aligns each empty
 * slot's background-position to its offset in the strip (at build, and for
 * the slots the live poll adds), so the diagonals
 * run continuously across runs. (NOT background-attachment:fixed — Chrome
 * refuses to paint fixed backgrounds inside Grafana's transformed panels.)
 * A wide pause band also carries its label inline — a strip that is ALL
 * pause should say why without requiring a hover. */
.ktl .slot .band-label { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
  font-size:10px; font-weight:700; letter-spacing:.06em; color:var(--ktl-dim);
  white-space:nowrap; overflow:hidden; pointer-events:none; }
.ktl .slot.tinted .band-label { color:var(--ktl-band); }
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
.ktl .card-head .ft.paused.tinted, .ktl .tile.paused.tinted .t-off { color:var(--ktl-band); }
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
            border:2px solid var(--ktl-accent); border-radius:2px; pointer-events:none;
            z-index:3; background:var(--ktl-mag-bg); box-shadow:0 0 12px rgba(0,0,0,.8); }
/* clip-path, not overflow:hidden on .mag, keeps the ghost's blur inside the
 * frame: the caption below must be free to overflow the magnifier */
.ktl .mag img { width:100%; height:100%; object-fit:contain; display:block; background:var(--ktl-mag-bg);
                clip-path:inset(0); }
.ktl .mag img:not([src]) { visibility:hidden; }   /* before the cursor first sets it: no broken-image box */
.ktl.fill .mag img { object-fit:cover; }
.ktl.fill .tile .t-img img { object-fit:cover; }
.ktl .mag.gap { border-color:var(--ktl-off);
                background:repeating-linear-gradient(45deg,var(--ktl-gap-a),var(--ktl-gap-a) 5px,var(--ktl-gap-b) 5px,var(--ktl-gap-b) 10px), var(--ktl-mag-bg); }
.ktl .mag.gap.nodata { border-color:var(--ktl-dim);
                background:repeating-linear-gradient(45deg,var(--ktl-pause-a),var(--ktl-pause-a) 5px,var(--ktl-pause-b) 5px,var(--ktl-pause-b) 10px), var(--ktl-mag-bg); }
.ktl .mag.gap img { display:none; }
.ktl .mag.clip { border-color:var(--ktl-link); }
.ktl .mag.clip img { display:none; }
.ktl .mag video { display:none; width:100%; height:100%; object-fit:contain; background:var(--ktl-mag-bg); }
.ktl .mag.flip-video video { display:block; }
.ktl .mag.flip-video img { display:none; }
.ktl .tile.clip { cursor:pointer; }
.ktl .tile.clip .t-off { color:var(--ktl-link); }
/* The caption spans the magnifier, centred on it. A narrow magnifier (a
 * portrait source's is ~30px wide) wrapped and clipped even a time with a
 * zone offset, "16:15:00 (+5h45m)" (~85px), so the caption may grow to
 * MAG_CAP_ROOM and overflow the magnifier on both sides. Near a strip end it
 * slides inward instead of being cut off by the card: for a magnifier that
 * narrow, setCursor sets --cap-lo and --cap-hi, the strip's two ends
 * measured from the magnifier's centre. A 16:9 magnifier is at least 90px
 * inside (the smallest card's strip is 53px tall), so its caption keeps the
 * magnifier's width and wraps within it as before. */
.ktl .mag .cap { position:absolute; left:50%; bottom:0; width:max-content; min-width:100%; max-width:max(100%, ${MAG_CAP_ROOM}px);
                 transform:translateX(clamp(var(--cap-lo, -100vw), -50%, calc(var(--cap-hi, 100vw) - 100%)));
                 background:rgba(0,0,0,.6); color:#fff;
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
.ktl .tick.edge, .ktl .tick.under-cursor { color:transparent; }   /* cut off at an end, or under the cursor tag: keep the mark, drop the text */
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
.ktl .tile.offline.nodata { border-color:var(--ktl-border); }
.ktl .tile.offline.nodata .t-off { color:var(--ktl-dim);
  background:repeating-linear-gradient(45deg,var(--ktl-tpause-a),var(--ktl-tpause-a) 7px,var(--ktl-tpause-b) 7px,var(--ktl-tpause-b) 14px); }
.ktl .tile.offline .t-off { display:flex; }
.ktl .tile.offline img, .ktl .tile.offline .t-ts { display:none; }
.ktl .mag.flip::after { content:'▶'; position:absolute; top:3px; left:5px; font-size:9px; line-height:1;
                        color:var(--ktl-accent); text-shadow:0 0 3px rgba(0,0,0,.8); pointer-events:none; }
.ktl .mag.flip-gap img { opacity:.35; }
.ktl-pop { position:fixed; z-index:1060; background:var(--ktl-float-bg); border:1px solid var(--ktl-accent);
           border-radius:4px; padding:4px; cursor:zoom-out;
           box-shadow:var(--ktl-shadow); }
.ktl-pop img { display:block; max-width:min(560px, 50vw); max-height:55vh; border-radius:2px; }
.ktl-pop .cap { text-align:center; color:var(--ktl-text); font-size:11px; padding:3px 0 0;
                font-variant-numeric:tabular-nums; }
/* the preview as a player (M10): stage, scrubber, controls. The popup
 * itself takes focus when it opens: no ring round all of it */
.ktl-pop.player:focus { outline:none; }
.ktl-pop.player { cursor:default; padding:6px; width:min(720px, 92vw); max-width:92vw; font:12px/1.4 -apple-system,"Segoe UI",Roboto,sans-serif;
                  color:var(--ktl-text); display:flex; flex-direction:column; gap:6px; }
.ktl-pop.player .stage { position:relative; display:flex; align-items:center; justify-content:center; background:var(--ktl-media);
                         border-radius:2px; height:min(55vh, 405px); }
/* one size whatever the frame's shape: the popup doesn't change size as it plays */
.ktl-pop.player .stage img { width:100%; height:100%; object-fit:contain; }
.ktl-pop.player .stage video { display:none; width:100%; height:100%; object-fit:contain; }
.ktl-pop.player.video .stage video { display:block; }
.ktl-pop.player.video .stage img { display:none; }
.ktl-pop.player.video.no-picture .stage img[src] { display:block; }
.ktl-pop.player.video.no-picture .stage video { display:none; }
.ktl-pop.player.video.loading .stage .state { color:var(--ktl-text); font-weight:500; opacity:.85; }
.ktl-pop.player:not(.has-clip) button[data-a="mute"], .ktl-pop.player:not(.has-clip) button[data-a="hd"],
.ktl-pop.player:not(.has-hi) button[data-a="hd"] { display:none; }
.ktl-pop.player.off .stage img { opacity:.35; }
.ktl-pop.player .stage .state { position:absolute; inset:auto 0 8px; text-align:center; font-weight:700; color:var(--ktl-off);
                                 text-transform:uppercase; letter-spacing:.04em; pointer-events:none; }
.ktl-pop.player .scrub { position:relative; height:22px; border-radius:2px; background:var(--ktl-pause-a); cursor:pointer;
                         touch-action:none; overflow:hidden; outline:none; }
.ktl-pop.player.thumbs .scrub { height:40px; }
.ktl-pop.player .scrub:focus-visible { box-shadow:0 0 0 2px var(--ktl-accent); }
.ktl-pop.player .lane { position:absolute; top:0; bottom:0; }
.ktl-pop.player .lane.dropped { background:repeating-linear-gradient(45deg,var(--ktl-gap-a),var(--ktl-gap-a) 4px,var(--ktl-gap-b) 4px,var(--ktl-gap-b) 8px); }
.ktl-pop.player .lane.nodata { background:repeating-linear-gradient(45deg,var(--ktl-pause-a),var(--ktl-pause-a) 4px,var(--ktl-pause-b) 4px,var(--ktl-pause-b) 8px); }
.ktl-pop.player .lane.paused { background:var(--ktl-band, var(--ktl-pause-b)); opacity:.6; }
.ktl-pop.player .lane.beyond { background:transparent; }
.ktl-pop.player .lane.clip { background:var(--ktl-link); opacity:.45; }
.ktl-pop.player .stage video.spare { display:none !important; }
.ktl-pop.player .tick.clip-start { height:100%; width:2px; background:var(--ktl-link); opacity:.9; }
.ktl-pop.player .thumb.clip { border-left:2px solid var(--ktl-link); }
.ktl-pop.player.no-stills button[data-a="style-ticks"], .ktl-pop.player.no-stills button[data-a="style-thumbs"] { display:none; }
/* video this scale can't show: a bubble over the picture, just above the
 * timeline; pressed, it zooms the dashboard to the slot as Zoom does */
.ktl-pop.player .zoom-video { display:none; position:absolute; left:50%; bottom:8px; transform:translateX(-50%); z-index:2;
  padding:3px 10px; border-radius:12px; border:1px solid var(--ktl-link); background:var(--ktl-float-bg); color:var(--ktl-link);
  font:500 11px/1.4 -apple-system,"Segoe UI",Roboto,sans-serif; white-space:nowrap; }
.ktl-pop.player button.zoom-video { cursor:pointer; }
.ktl-pop.player.video-far .zoom-video { display:block; }
.ktl-pop.player.video-far .stage .state { bottom:36px; }
.ktl-pop.player .thumbs { position:absolute; inset:0; pointer-events:none; }
.ktl-pop.player .thumb { position:absolute; top:0; bottom:0; overflow:hidden; border-right:1px solid rgba(0,0,0,.4); }
.ktl-pop.player .thumb img { width:100%; height:100%; object-fit:cover; display:block; }
.ktl-pop.player .thumb.prior img { opacity:.4; }
.ktl-pop.player .ticks { position:absolute; inset:0; pointer-events:none; }
.ktl-pop.player .tick { position:absolute; bottom:0; height:40%; width:1px; background:var(--ktl-text); opacity:.55; }
.ktl-pop.player.thumbs .tick { height:6px; }
.ktl-pop.player .head { position:absolute; top:0; bottom:0; width:2px; margin-left:-1px; background:var(--ktl-accent); pointer-events:none; }
.ktl-pop.player .top, .ktl-pop.player .bar { display:grid; grid-template-columns:1fr auto 1fr; align-items:center; gap:6px; }
/* on top, what this is: the title gives way rather than wrap and grow the popup */
.ktl-pop.player .top { grid-template-columns:auto minmax(0, 1fr) auto; }
.ktl-pop.player .top .title { text-align:center; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-weight:500; }
/* below, the playback: the frame's time, the transport centred, the options */
.ktl-pop.player .bar .time { justify-self:start; font-variant-numeric:tabular-nums; white-space:nowrap; }
.ktl-pop.player .bar .transport, .ktl-pop.player .bar .opts { display:flex; gap:4px; align-items:center; }
.ktl-pop.player .bar .opts { justify-self:end; }
.ktl-pop.player button svg { display:block; }
.ktl-pop.player button[aria-pressed="true"] { border-color:var(--ktl-accent); color:var(--ktl-accent); }
.ktl-pop.player button[aria-pressed="false"] { opacity:.6; }
.ktl-pop.player button { flex:0 0 auto; }
.ktl-pop.player button.hint { border-color:var(--ktl-accent); color:var(--ktl-accent); }
.ktl-pop.player button { font:inherit; color:var(--ktl-text); background:transparent; border:1px solid var(--ktl-border);
                         border-radius:2px; padding:2px 7px; min-width:28px; height:24px; cursor:pointer; line-height:18px;
                         display:inline-flex; align-items:center; justify-content:center; }
.ktl-pop.player button:hover:not(:disabled) { border-color:var(--ktl-accent); }
.ktl-pop.player button:disabled { opacity:.4; cursor:default; }
.ktl-pop.player button:focus-visible { outline:2px solid var(--ktl-accent); outline-offset:1px; }
.ktl-pop.player button[data-a="play"] { min-width:36px; }`;

export function injectStyles(): void {
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
