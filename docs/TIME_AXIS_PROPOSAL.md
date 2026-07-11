# Proposal: Time axis ticks matching Grafana's native behavior

## Current state (`buildAxis()`, `src/core.ts:978`)

```js
const maxTicks = Math.max(3, Math.floor(w / 90));
const tickStep = TICK_STEPS.find(s => SPAN / s <= maxTicks) || TICK_STEPS[TICK_STEPS.length - 1];
const withDate = SPAN > 20 * 3600e3;
for (let ts = Math.ceil(P.from / tickStep) * tickStep; ts <= P.to; ts += tickStep) { ... }
```

`TICK_STEPS` (`core.ts:696`) tops out at `24 * 3600e3` (1 day). Labels are one of two
fixed formats (`fmtShort` = `HH:mm`, or `HH:mm` + date), chosen once for the whole
axis based on total `SPAN`, not per-tick.

## Problems this causes

1. **No increments above 1 day.** For any view spanning multiple days-to-months,
   `TICK_STEPS.find(...)` fails for every entry (`SPAN / 24h` always exceeds
   `maxTicks`), so it falls through to the `|| TICK_STEPS[last]` default —
   1 tick per day regardless of width. A 30-day view on a normal panel renders
   ~30 overlapping ticks instead of ~6 (e.g. weekly).
2. **Epoch-aligned, not calendar-aligned, boundaries.** `Math.ceil(P.from / tickStep) * tickStep`
   snaps to multiples of `tickStep` from the Unix epoch (UTC). Labels are
   rendered with `toLocaleString` (local time), so in any timezone not at a
   whole-hour UTC offset, "hour" or "day" ticks won't land on local `:00` or
   local midnight — the grid and the label text disagree. This is exactly
   what uPlot's `timeAxisSplits` calendar-boundary snapping (see prior
   discussion) exists to prevent.
3. **No DST correction.** Same root cause as #2 — pure epoch arithmetic drifts
   by an hour across a DST transition within a fine-grained (hour/minute)
   view.
4. **Tick spacing is a flat guess (`w / 90`), not measured.** 90px is a guess
   at worst-case label width. It's never too dense, but on narrow labels
   (`14:05`) it wastes ~40px of spacing per tick that could hold more ticks,
   and if a locale or format change ever produces wider labels (e.g. adding
   seconds, or a non-`en-AU` locale) it would start overlapping with no
   warning.
5. **Binary label format, not per-zoom-tier.** Only two states exist: `HH:mm`
   or `HH:mm`+date, switched on whole-axis `SPAN`. Zooming into a 2-minute
   window still shows `HH:mm` (no seconds — ticks can show identical labels
   if `tickStep` is sub-minute... though today's `TICK_STEPS` floor is 60s so
   this is latent, not yet triggered). Zooming out to weeks always carries
   the full date+time string, wasting label width you could spend on more
   ticks.

## Proposed design

Adopt the same *shape* as uPlot/Grafana's approach (detailed in-thread), adapted
to this codebase's plain-DOM tick rendering — no uPlot dependency needed.

### 1. Extend `TICK_STEPS` past 1 day

```js
const TICK_STEPS = [
  1e3, 5e3, 10e3, 15e3, 30e3,                              // sub-minute (currently unused, future-proofing)
  60e3, 5*60e3, 10*60e3, 15*60e3, 30*60e3,                 // minutes
  3600e3, 2*3600e3, 3*3600e3, 6*3600e3, 12*3600e3,         // hours
  24*3600e3, 2*86400e3, 7*86400e3, 14*86400e3,             // days / weeks
  30*86400e3, 90*86400e3, 365*86400e3,                     // months / year
];
```

### 2. Calendar-aligned tick placement (local time, DST-safe)

Replace epoch-multiple math with a step derived from local date components,
same principle as uPlot's `timeAxisSplits`:

```js
function alignedStart(fromTs, stepMs) {
  const d = new Date(fromTs);
  if (stepMs >= 86400e3) {                       // day+ steps: snap to local midnight
    d.setHours(0, 0, 0, 0);
    if (stepMs >= 30 * 86400e3) d.setDate(1);    // month+ steps: snap to 1st
  } else if (stepMs >= 3600e3) {                 // hour steps: snap to local :00
    d.setMinutes(0, 0, 0);
  } else {                                       // sub-hour: snap to local minute grid
    d.setSeconds(0, 0);
  }
  let ts = +d;
  while (ts < fromTs) ts += stepMs;              // step forward in real calendar units, not raw ms multiples, for day/month steps
  return ts;
}
```

Day/month-scale steps must advance via `setDate`/`setMonth` in a loop (not
`+= stepMs`) so a "1 month" step lands on the 1st of each month regardless of
28/29/30/31-day variance — mirrors uPlot's month/year branch in
`timeAxisSplits`.

### 3. Measure actual label width instead of guessing 90px

```js
function measureTickWidth(sampleText) {
  const probe = axis.querySelector('.tick') ?? document.createElement('div');
  probe.className = 'tick';
  probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap';
  probe.textContent = sampleText;
  axis.appendChild(probe);
  const width = probe.getBoundingClientRect().width;
  probe.remove();
  return width;
}
```

Use this with a representative sample (formatted at the candidate step) to
size `maxTicks = w / (measuredWidth + gap)`, same principle as Grafana's
`calculateSpace()` — replaces the flat `/ 90`.

### 4. Per-tier label format (one consistent format per tick, no mid-axis switch)

```js
function tickFormat(stepMs) {
  if (stepMs < 60e3)        return ts => fmtTime(ts);                                    // HH:mm:ss
  if (stepMs < 3600e3)      return ts => fmtShort(ts);                                    // HH:mm
  if (stepMs < 24*3600e3)   return ts => new Date(ts).toLocaleString('en-AU', DAY_HM);     // DD/MM HH:mm
  if (stepMs < 365*86400e3) return ts => new Date(ts).toLocaleDateString('en-AU', DAY_MO); // DD/MM
  return ts => String(new Date(ts).getFullYear());                                        // YYYY
}
```

Chosen once from `tickStep` (which is already derived from panel width), so
every tick on the axis reads consistently — no more whole-axis `withDate`
boolean.

## Non-goals

- Not adopting uPlot itself — this plugin renders its own DOM ticks and that
  stays; only the *step-selection and alignment logic* is being brought in
  line with it.
- Not implementing uPlot's dual-tier "rollover" labels (e.g. showing date only
  on the tick where the day changes) — matching Grafana's simpler
  single-format-per-axis behavior, which is also the better fit for this
  plugin's compact 24px axis strip.

## Effort / risk

- **Size:** small — confined to `TICK_STEPS`, `buildAxis()`, and the two
  `fmt*` helpers in `core.ts`. No new dependencies, no plugin.json/build
  changes.
- **Risk:** low. Worth a manual check across the demo dataset (`demo/`) at a
  few span sizes (minutes, hours, multi-day, multi-week) and two timezones
  (e.g. system TZ + one non-whole-hour-offset TZ, like Adelaide/Kathmandu) to
  confirm calendar alignment actually fixes the drift described in #2.
- **Suggested split:** step-table + calendar alignment as one commit (fixes
  #1–#3, the actual correctness bugs), measured-width spacing + per-tier
  format as a follow-up commit (the polish/parity items, #4–#5).
