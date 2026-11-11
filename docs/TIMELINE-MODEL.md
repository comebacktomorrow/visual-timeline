# The timeline model: frames, promises and intervals (M9)

A design note for 2.0's M9. Status: agreed (2026-11-11) and built (M9a to
M9c). It replaces the cadence grid that `src/vt/model/slots.ts` built
before it. Video (M10) and the folder's video files (M11) build on it.

## Why

Today every host gets a cadence, and the timeline lays a grid of ticks at
whole multiples of it. Each frame snaps to its nearest tick, and a tick with
no frame is a gap: red by default. When a source doesn't say its cadence,
the panel infers one, the median gap between frames, and then holds the
source to it.

That works for heartbeat feeds that declare their pace (the reference
worker, the demo). It fails for feeds that never promised a pace. USGS's
Kīlauea F1 camera sends frames at :09, :29, :39 and :59 each hour, so its
gaps alternate 20 and 10 minutes. The median is 10 minutes, and every
20-minute gap leaves an empty tick. The result is a regular "outage" every
other frame from a camera that is working exactly as designed.

## The model

### A cadence is a promise

A frame that comes with a cadence promises the next one within it: frame
`f` at `t` with cadence `c` says "the next frame by `t + c`". The promise is
kept when the next frame arrives within a tolerance, by `t + 1.5c` (the half
cadence of drift the grid absorbs today). A promise that runs out before the
next frame arrives is a **dropped** frame, from when it was due. That is the
only thing the timeline draws as red. The tolerance only decides whether a
promise broke: a 1-minute heartbeat that misses one frame shows that minute
as dropped, as it does today.

A frame without a cadence makes **no promise**. Nothing it is followed by,
or not followed by, is ever red.

An inferred cadence is never a promise. The median gap still has uses, but
only for display (below).

### Where a promise comes from

For each frame, first match wins:

1. **The panel's Expected cadence** option, when set: the dashboard author's
   override, as Grafana's overrides beat data.
2. **The frame's own row**: a `cadence` field, or the field named under
   Frame fields → Cadence. A value that changes over time is a new promise
   from that frame on; no eras are needed.
3. **What the source declares**: a host table's `cadence`, the Visual
   Timeline data source (the demo's history; the HTTP folder's new **Expected
   every** setting), or the reference worker's source list and its cadence
   history.
4. **None.**

### Each frame is an interval

A frame is shown from its own time until the next frame replaces it, or
until it runs out:

| Frame                    | Shown until        | Then, until the next frame           |
| ------------------------ | ------------------ | ------------------------------------ |
| Promised, kept           | the next frame     | (nothing: the next frame takes over) |
| Promised, broken         | `t + c` (when due) | **dropped** (red)                    |
| No promise, within limit | the next frame     | (nothing)                            |
| No promise, past limit   | `t + hold limit`   | **no data** (neutral)                |

The **hold limit** for frames without a promise is the panel option that
replaces today's Hold last frame:

- **Auto** (the default): three times the typical gap around that frame (the
  median of the few gaps either side). Display only, never red. Kīlauea F1's
  gaps of 10 and 20 minutes give a limit of 30 to 60 minutes, so it draws as
  a continuous strip.
- **Until the next frame**: no limit.
- **Up to a duration**, such as `10m`.

A **video clip** (M10c) covers what would be **no data**: there's no frame
in force, but there is video, so it's clip time, drawn as a plain band. A
frame still wins where one is in force, and a broken promise is still
dropped: a promise is about frames.

A **pause** (a state with Pauses frames, or a declared pause in a source's
history) suspends promises. The frame before it is shown up to the pause, the
pause draws as its band, and the first frame inside a pause with no end yet
ends it (the rule today).

At the **live edge** the last frame's "next" is now:

- promised: shown until `t + c`, then **pending** ("expected") for one more
  cadence, until `t + 2c` (capture, upload, an API's response cache and the
  poll all take time: a shorter grace painted a red edge that healed on the
  next poll, #77), then dropped ("overdue") until now;
- no promise: shown until its hold limit, then no data until now. It is
  never overdue.

The poll re-evaluates that last interval as time passes, as it ages pending
slots today.

Before the first frame in the window, the timeline needs the frame in force
at the window's start. The query asks from a little before the window: the
largest of 1.5 times the promise, the hold limit, and an hour.

## Drawing it

The strip keeps a uniform row of **slots**, about one per **Frame width**
(a panel option, 7 px by default), but a
slot is now a sample, not a promise. Slots are sized to a round duration and
aligned to its multiples, so they don't shimmer as the window slides. Each
slot shows what is in force at its centre: a frame, dropped, no data,
pending, a pause, or beyond now.

- **Adjacent slots showing the same frame merge into one cell**, which shows
  a wider slice of that frame. A frame that stood for 20 minutes is 20
  minutes wide.
- **Non-frame intervals are also drawn at their true time and width**, on a
  layer over the slots. A dropped stretch shorter than a slot still shows,
  at least 1 px wide, so zooming out can't hide a short outage.
- **A slot holding more than one frame** is marked, and its magnifier says
  how many. Resting the cursor on it for three seconds plays them there
  (the hover flipbook); clicking it opens the preview player on the slot's
  own timeline (below).
- (Not built: each frame's own time as a notch along the strip's bottom
  edge.)

Grid tiles show the interval in force at the crosshair, as the strip does.

## Fetching

`Backend.frames(site, id, from, to, step)` doesn't change. The core passes
the slot duration as `step`. A backend may return more than one frame per
step, and the core uses every frame it gets:

- **Records** (any data source through the panel) return every row the
  query returned.
- **The reference worker** answers one frame per step. Its frames keep their
  true times; a drop shorter than a step, with frames on both sides, can't
  be seen (a limit today too).
- **Our data source** (demo data, the HTTP folder) thins its rows to the
  panel's width (max data points), each kept row carrying `frame_count`:
  how many frames it stands for.

**Thinned answers aren't broken promises.** A data source may answer one
row per the interval Grafana asked it for (the larger of `$__interval` and
the range over max data points): a 1-minute host's rows 2 minutes apart over
a day. A promise finer than that interval counts as the whole multiple of
itself that covers it, so only a gap longer than the data can show is red.

## A slot's frames (M10)

The preview player and the hover flipbook play one slot's frames: its
**reel** (`src/vt/model/reel.ts`), one model for both. The reel asks for
the slot again (`Backend.detail`): the panel runs its own query once more
for just that slot's span, asking for no more points than the view can draw
(a tick per Frame width; the flipbook at most 100), with `$__interval` to
match. A slot so fetched is judged at that interval too. The reel holds the
slot's frames and the one in force at its start, the stretches they make,
what's in force at a time, the frames shown when there are more than fit
(evenly through the slot), and its stops: each frame shown, and the start
of each gap, which playing shows with its reason rather than skipping.

A video clip over the slot plays over its frames: the clip's part of the
slot is one stop, played as video, and the frames under it are left out.
A time within a clip maps to its fraction of the way through the video,
so a clip of real time and a timelapse are handled alike. A part too short
to watch (a slot's sliver of a day-long timelapse) is shown as a still.

## Options, before and after

| Today                                    | After M9                                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------------------------ |
| Gaps mean (Offline / No data)            | Removed: red only where a promise broke.                                                   |
| Hold last frame (Never / Always / Up to) | **Hold frames without a promise**: Auto (default), Until the next frame, Up to a duration. |
| Frame fields → Cadence                   | Unchanged: names the field whose values are promises.                                      |
| (none)                                   | **Expected cadence** (panel): a promise for every host in the panel.                       |
| (none)                                   | **Expected every** (HTTP folder setting): the folder's promise.                            |
| Show cadence details                     | `⏱ 1m · 1/2m ↓` for a promise; `⏱ ~10m · 1/10m · no promise` for a typical gap.            |

Both removed options are new in 2.0 and were never released, so nothing to
migrate.

## What changes visibly

- **Promised sources** (the reference worker, the demo data, a SQL table
  with a `cadence` column) look as they do today. Frames sit at their true
  times instead of snapping, which at normal zooms looks the same.
- **Sources with no promise** (TestData, SQL and Loki without a cadence,
  Infinity, the HTTP folder without Expected every) stop showing red gaps.
  Frames are shown until the next one or the hold limit, and long silences
  are neutral. Set a promise for red.
- **The last-frame table and status** (`src/shared/lastFrame.ts`): live
  while a promise is kept, offline once it breaks, paused in a pause. A host
  with no promise is never offline; it shows when its last frame was.

## What doesn't change

Annotations, the axis, the crosshair, the magnifier and preview, filters,
header chips, the standalone viewer's API backend (its sources promise), and
the public `Backend` interface.

## Plan

- **M9a:** the interval builder, `src/vt/model/intervals.ts`. A pure
  function from frames, promises, pauses, hold limit and window to
  intervals, with unit tests. Not wired in yet.
- **M9b:** draw from intervals: slots as samples, merged frame cells, the
  true-width layer, the live-edge poll, the cursor, grid tiles. Remove the
  grid model, the Gaps mean option and today's hold, and update the e2e
  tests.
- **M9c:** the promise sources: the panel's Expected cadence, the folder's
  Expected every, records that tell a promise from a typical gap, the
  cadence chip and the last-frame status, then the docs (README "How a time
  range is drawn" and panel options, DATA-SOURCES, FOLDERS, CHANGELOG).
