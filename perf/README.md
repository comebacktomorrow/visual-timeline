# Scrub benchmark

Measures what one cursor move costs as the number of sources grows. It's the
baseline for splitting `src/core.ts` and for the scrub-path work in #64.

```bash
npm run bench:scrub                        # build web/vt-core.js, then 20 sources, timeline, 1x and 4x CPU
node perf/scrub-bench.mjs --sources 40 --mode grid --cpu 1,4,6 --runs 5 --json out.json
```

Options: `--sources` (default 20), `--mode timeline|grid`, `--cpu` (comma list
of CPU throttling rates, default `1,4`), `--moves` (default 240), `--runs`
(median of N, default 3), `--gaps` (every source has three outages, so a
sweep crosses many frame/gap boundaries), `--json <file>`. Set `BENCH_CHROMIUM` to use a
Chromium other than Playwright's own.

`harness.html` loads the built `web/vt-core.js` and mounts the panel on a
fixed past window with a synthetic frames API passed in as `cfg.apiFetch`, so
no network or worker is involved. Most sources run at 60 s, every fourth at
30 s; one has an outage and one a declared pause.

Two paths are measured:

- **hover**: real mouse moves across a timeline strip, as a viewer scrubbing.
  Time is the strip's `mousemove` handling, between a window capture listener
  and a window bubble listener.
- **sync**: `setExternalCursor` calls, as the shared crosshair from another
  panel. Each call is followed by a layout flush, so the DOM writes are paid
  inside the measurement.

Layouts and style recalcs per move come from the Chrome DevTools Protocol
`Performance` domain. More than one layout per move means the code reads
layout between style writes (a forced reflow).

## Baseline (2026-10-02, before #64)

20 sources, 2 h window, 2,398 slots in the DOM; 240 moves, median of 3 runs,
headless Chromium 141 on a cloud container. Absolute times vary by machine;
compare runs on the same machine.

| Mode     | CPU | Path  | Mean ms | p95 ms | Layouts/move | Layout ms/move |
| -------- | --- | ----- | ------- | ------ | ------------ | -------------- |
| timeline | 1x  | hover | 4.2     | 5.9    | 41.9         | 2.5            |
| timeline | 1x  | sync  | 3.6     | 5.4    | 42.0         | 2.2            |
| timeline | 4x  | hover | 27.7    | 38.3   | 41.9         | 15.4           |
| timeline | 4x  | sync  | 22.1    | 36.3   | 42.0         | 12.9           |
| grid     | 1x  | sync  | 0.7     | 1.1    | 1            | 0.3            |
| grid     | 4x  | sync  | 3.8     | 5.5    | 1            | 1.5            |

The timeline pays about two forced layouts per source on every move:
`setCursor` reads `clientWidth`/`offsetWidth` card by card between style
writes. At 4x CPU a move takes longer than a 16 ms frame. The grid does one
layout per move.

## After #64 PR D (read before write in `setCursor`)

Same machine and settings as the baseline.

| Mode     | CPU | Path  | Mean ms | p95 ms | Layouts/move | Layout ms/move |
| -------- | --- | ----- | ------- | ------ | ------------ | -------------- |
| timeline | 1x  | hover | 0.95    | 1.2    | 1            | 1.3            |
| timeline | 1x  | sync  | 2.2     | 4.0    | 1            | 1.2            |
| timeline | 4x  | hover | 5.5     | 7.6    | 1            | 7.8            |
| timeline | 4x  | sync  | 11.3    | 19.0   | 1            | 6.3            |

`setCursor` now reads every width it needs (the axis, then each card's strip
and magnifier) before writing any style, so a move costs one layout however
many sources there are. The remaining layout time is the one real layout of
the panel after the writes. The sync path's figures include the forced
layout flush the benchmark adds after each call.

## After the 1.1 performance pass (2026-10-15)

Moving over a gap used to cost four to five times the layout of moving over
frames: every move rewrote each card's header with "offline — last seen …",
and writing text, even the same text, replaces the text node and relays out
every card. `setCursor` now keeps what each card shows (`shownKey`) and skips
the content writes when a move stays in the same state, and every remaining
text and image write is skipped when unchanged.

Before and after on one machine (headless Chromium 149 on macOS); compare
these rows with each other, not with the tables above.

20 sources, timeline:

| CPU | Path  | Mean ms (before → after) | p95 ms    | Layout ms/move | Long tasks/run |
| --- | ----- | ------------------------ | --------- | -------------- | -------------- |
| 1x  | hover | 0.22 → 0.173             | 0.3 → 0.3 | 0.474 → 0.359  | 1 → 1          |
| 1x  | sync  | 0.615 → 0.442            | 1.2 → 0.7 | 0.397 → 0.284  | 1 → 1          |
| 4x  | hover | 1.12 → 0.793             | 1.7 → 1.2 | 2.038 → 1.671  | 2 → 2          |
| 4x  | sync  | 2.444 → 1.848            | 4.7 → 3   | 1.577 → 1.158  | 2 → 2          |

20 sources, timeline, `--gaps`:

| CPU | Path  | Mean ms (before → after) | p95 ms     | Layout ms/move | Long tasks/run |
| --- | ----- | ------------------------ | ---------- | -------------- | -------------- |
| 1x  | hover | 0.223 → 0.168            | 0.3 → 0.3  | 2.275 → 0.575  | 1 → 1          |
| 1x  | sync  | 2.199 → 0.617            | 5.1 → 1.5  | 1.998 → 0.472  | 1 → 1          |
| 4x  | hover | 1.039 → 0.826            | 1.6 → 1.3  | 9.393 → 2.677  | 18 → 2         |
| 4x  | sync  | 9.824 → 2.898            | 22.4 → 6.9 | 8.781 → 2.189  | 18 → 2         |
