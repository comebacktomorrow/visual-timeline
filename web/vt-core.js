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
    ApiError: () => ApiError,
    KTL_VAR_DEFAULTS: () => KTL_VAR_DEFAULTS,
    PAUSE_CLASSES: () => PAUSE_CLASSES,
    TICK_STEPS: () => TICK_STEPS,
    alignedStart: () => alignedStart,
    axisTicks: () => axisTicks,
    bootErrorText: () => bootErrorText,
    buildIntervals: () => buildIntervals,
    buildSourceModel: () => buildSourceModel,
    clearPauseClasses: () => clearPauseClasses,
    erasFor: () => erasFor,
    esc: () => esc,
    fmtOffset: () => fmtOffset,
    fmtShort: () => fmtShort,
    fmtTime: () => fmtTime,
    framesPath: () => framesPath,
    ghostFor: () => ghostFor,
    headTitle: () => headTitle,
    hiUrlFor: () => hiUrlFor,
    imageUrlWithKey: () => imageUrlWithKey,
    kindFormat: () => kindFormat,
    makeApiBackend: () => makeApiBackend,
    matchesTags: () => matchesTags,
    mountGrid: () => mountGrid,
    mountTimeline: () => mountTimeline,
    nextTick: () => nextTick,
    parseTagFilter: () => parseTagFilter,
    pauseInfo: () => pauseInfo,
    pickTickStep: () => pickTickStep,
    resolveFrameUrl: () => resolveFrameUrl,
    resolveTimeZone: () => resolveTimeZone,
    slotClass: () => slotClass,
    sourceTimeZone: () => sourceTimeZone,
    sourcesPath: () => sourcesPath,
    tagChips: () => tagChips,
    tickFormat: () => tickFormat,
    tickKind: () => tickKind,
    zoneHeadText: () => zoneHeadText,
    zoneLabel: () => zoneLabel,
    zoneOffsetText: () => zoneOffsetText,
    zonedParts: () => zonedParts,
    zonedTime: () => zonedTime
  });

  // src/vt/time/zones.ts
  var LOCAL_TZ = "local";
  var zoneOk = /* @__PURE__ */ new Map();
  function isZone(name) {
    let ok = zoneOk.get(name);
    if (ok === void 0) {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: name });
        ok = true;
      } catch (e) {
        ok = false;
      }
      zoneOk.set(name, ok);
    }
    return ok;
  }
  function systemZone() {
    let z = null;
    try {
      z = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch (e) {
      z = null;
    }
    return z && isZone(z) ? z : LOCAL_TZ;
  }
  var panelZoneWarned = /* @__PURE__ */ new Set();
  function resolveTimeZone(tz) {
    const s = tz == null ? "" : String(tz).trim();
    if (!s || /^(browser|default|local)$/i.test(s)) {
      return systemZone();
    }
    if (/^utc$/i.test(s)) {
      return "UTC";
    }
    if (isZone(s)) {
      return s;
    }
    if (!panelZoneWarned.has(s)) {
      panelZoneWarned.add(s);
      console.warn('[visual-timeline] unknown time zone "' + s + `"; using the browser's`);
    }
    return systemZone();
  }
  var zones = /* @__PURE__ */ new Map();
  function zoneOf(tz) {
    const id = resolveTimeZone(tz);
    let z = zones.get(id);
    if (!z) {
      const tzOpt = id === LOCAL_TZ ? {} : { timeZone: id };
      const fmts = /* @__PURE__ */ new Map();
      let offset;
      if (id === "UTC") {
        offset = () => 0;
      } else if (id === LOCAL_TZ) {
        offset = (ts) => -new Date(ts).getTimezoneOffset() * 6e4;
      } else {
        const pf = new Intl.DateTimeFormat("en-US", Object.assign({
          hourCycle: "h23",
          year: "numeric",
          month: "numeric",
          day: "numeric",
          hour: "numeric",
          minute: "numeric",
          second: "numeric"
        }, tzOpt));
        offset = (ts) => {
          const p = {};
          for (const x of pf.formatToParts(ts)) {
            p[x.type] = x.value;
          }
          const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
          return wall - Math.floor(ts / 1e3) * 1e3;
        };
      }
      z = {
        id,
        offset,
        // en-AU, 24 h: the panel's one display format (locale/12 h are not options)
        fmt(key, opts) {
          let f = fmts.get(key);
          if (!f) {
            f = new Intl.DateTimeFormat("en-AU", Object.assign({}, opts, tzOpt));
            fmts.set(key, f);
          }
          return f;
        }
      };
      zones.set(id, z);
    }
    return z;
  }
  var wallOf = (ts, z) => ts + z.offset(ts);
  function fromWall(w, z) {
    const before = z.offset(w - 864e5), after = z.offset(w + 864e5);
    const a = w - before;
    if (before === after) {
      return a;
    }
    const b = w - after;
    const aOk = z.offset(a) === before, bOk = z.offset(b) === after;
    if (aOk && bOk) {
      return Math.min(a, b);
    }
    if (bOk) {
      return b;
    }
    return a;
  }
  function zonedParts(ts, tz) {
    const d = new Date(wallOf(ts, zoneOf(tz)));
    return {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
      hour: d.getUTCHours(),
      minute: d.getUTCMinutes(),
      second: d.getUTCSeconds(),
      ms: d.getUTCMilliseconds()
    };
  }
  function zonedTime(f, tz) {
    return fromWall(Date.UTC(f.year, f.month - 1, f.day, f.hour || 0, f.minute || 0, f.second || 0, f.ms || 0), zoneOf(tz));
  }
  var F_TIME = { hour12: false, hour: "numeric", minute: "numeric", second: "numeric" };
  var F_SHORT = { hour12: false, hour: "2-digit", minute: "2-digit" };
  var F_DAY_HM = { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false };
  var F_DAY = { day: "2-digit", month: "2-digit" };
  var fmtTime = (ts, tz) => zoneOf(tz).fmt("time", F_TIME).format(ts);
  var fmtShort = (ts, tz) => zoneOf(tz).fmt("short", F_SHORT).format(ts);
  var fmtDur = (ms) => ms % 36e5 === 0 ? ms / 36e5 + "h" : ms % 6e4 === 0 ? ms / 6e4 + "m" : ms / 1e3 + "s";

  // src/vt/time/ticks.ts
  var TICK_STEPS = [
    6e4,
    5 * 6e4,
    10 * 6e4,
    15 * 6e4,
    30 * 6e4,
    36e5,
    2 * 36e5,
    3 * 36e5,
    4 * 36e5,
    6 * 36e5,
    8 * 36e5,
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
    60 * 864e5,
    90 * 864e5,
    120 * 864e5,
    180 * 864e5,
    365 * 864e5
  ];
  var DAY_MS = 864e5;
  function monthsOf(stepMs) {
    return stepMs >= 30 * DAY_MS ? Math.round(stepMs / (30 * DAY_MS)) : 0;
  }
  function offsetChange(lo, hi, o, z) {
    let a = Math.floor(lo / 1e3), b = Math.ceil(hi / 1e3);
    while (b - a > 1) {
      const m = Math.floor((a + b) / 2);
      if (z.offset(m * 1e3) === o) {
        a = m;
      } else {
        b = m;
      }
    }
    return b * 1e3;
  }
  function ceilWall(ts, step, z) {
    let t = ts;
    for (let i = 0; i < 6; i++) {
      const o = z.offset(t);
      const c = Math.ceil((t + o) / step) * step - o;
      if (z.offset(c) === o) {
        return c;
      }
      t = offsetChange(t, c, o, z);
    }
    return Math.ceil(ts / step) * step;
  }
  function floorWall(ts, step, z) {
    let t = ts;
    for (let i = 0; i < 6; i++) {
      const o = z.offset(t);
      const c = Math.floor((t + o) / step) * step - o;
      const oc = z.offset(c);
      if (oc === o) {
        return c;
      }
      t = offsetChange(c, t, oc, z) - 1;
    }
    return Math.floor(ts / step) * step;
  }
  function monthStart(idx, z) {
    return fromWall(Date.UTC(Math.floor(idx / 12), (idx % 12 + 12) % 12, 1), z);
  }
  function dayStartWall(ts, z) {
    const w = wallOf(ts, z);
    return w - (w % DAY_MS + DAY_MS) % DAY_MS;
  }
  function alignIn(ts, stepMs, z) {
    const k = monthsOf(stepMs);
    if (k) {
      const d = new Date(wallOf(ts, z));
      const idx = d.getUTCFullYear() * 12 + d.getUTCMonth();
      return monthStart(Math.floor(idx / k) * k, z);
    }
    if (stepMs >= DAY_MS) {
      return fromWall(dayStartWall(ts, z), z);
    }
    return floorWall(ts, stepMs, z);
  }
  function nextIn(ts, stepMs, z) {
    const k = monthsOf(stepMs);
    let n;
    if (k) {
      const d = new Date(wallOf(ts, z));
      const idx = d.getUTCFullYear() * 12 + d.getUTCMonth();
      n = monthStart(Math.floor(idx / k) * k + k, z);
    } else if (stepMs >= DAY_MS) {
      n = fromWall(dayStartWall(ts, z) + Math.round(stepMs / DAY_MS) * DAY_MS, z);
    } else {
      n = ceilWall(ts + 1, stepMs, z);
    }
    return n > ts ? n : ts + stepMs;
  }
  function alignedStart(ts, stepMs, tz) {
    return alignIn(ts, stepMs, zoneOf(tz));
  }
  function nextTick(ts, stepMs, tz) {
    return nextIn(ts, stepMs, zoneOf(tz));
  }
  function axisTicks(from, to, stepMs, tz) {
    const z = zoneOf(tz);
    const out = [];
    let t = alignIn(from, stepMs, z);
    while (t < from) {
      t = nextIn(t, stepMs, z);
    }
    for (; t <= to && out.length < 1e4; t = nextIn(t, stepMs, z)) {
      out.push(t);
    }
    return out;
  }
  var YEAR_MS = 365 * DAY_MS;
  function tickKind(stepMs, rangeMs) {
    if (stepMs <= 6e4) {
      return "second";
    }
    if (rangeMs <= DAY_MS) {
      return "minute";
    }
    if (stepMs <= DAY_MS) {
      return "hour";
    }
    if (rangeMs < YEAR_MS) {
      return "day";
    }
    if (Math.round(stepMs / DAY_MS) === 365) {
      return "year";
    }
    return stepMs <= YEAR_MS ? "month" : "year";
  }
  var F_SECOND = { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" };
  var pad2 = (n) => String(n).padStart(2, "0");
  function kindFormat(kind, tz) {
    const z = zoneOf(tz);
    switch (kind) {
      case "second": {
        const f = z.fmt("second", F_SECOND);
        return (ts) => f.format(ts);
      }
      case "minute": {
        const f = z.fmt("short", F_SHORT);
        return (ts) => f.format(ts);
      }
      case "hour": {
        const f = z.fmt("dayhm", F_DAY_HM);
        return (ts) => f.format(ts);
      }
      case "day": {
        const f = z.fmt("day", F_DAY);
        return (ts) => f.format(ts);
      }
      case "month":
        return (ts) => {
          const d = new Date(wallOf(ts, z));
          return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1);
        };
      default:
        return (ts) => String(new Date(wallOf(ts, z)).getUTCFullYear());
    }
  }
  function tickFormat(stepMs, rangeMs, tz, host) {
    const kind = tickKind(stepMs, rangeMs);
    if (host) {
      return (ts) => host(ts, kind);
    }
    return kindFormat(kind, tz);
  }
  var X_TICK_SPACING = 40;
  var X_TICK_VALUE_GAP = 18;
  function pickTickStep(from, to, widthPx, measure, tz, host) {
    const range = to - from;
    if (!(range > 0) || !(widthPx > 0)) {
      return TICK_STEPS[TICK_STEPS.length - 1];
    }
    const roughStep = range / (widthPx / X_TICK_SPACING);
    const space = measure(tickFormat(roughStep, range, tz, host)(to)) + X_TICK_VALUE_GAP;
    return TICK_STEPS.find((st) => st / range * widthPx >= space) || TICK_STEPS[TICK_STEPS.length - 1];
  }

  // src/vt/model/eras.ts
  function erasFor(decl, P) {
    const hist = (decl.history || []).filter((h) => (h.variant || "lo") === "lo").slice().sort((a, b) => a.since - b.since);
    let runCad = decl.cadence || 6e4;
    if (hist.length && hist[0].cadence) {
      runCad = hist[0].cadence;
    }
    const evts = [{ since: -864e13, cadence: runCad, paused: false, reason: void 0, intended: void 0 }];
    for (const h of hist) {
      evts.push({ since: h.since, cadence: h.cadence, paused: !!h.paused, reason: h.reason, intended: h.intended, label: h.label, color: h.color });
    }
    const eras = [];
    for (let i = 0; i < evts.length; i++) {
      const e = evts[i];
      const next = evts[i + 1];
      if (e.cadence) {
        runCad = e.cadence;
      }
      const from = Math.max(e.since, P.from);
      const to = Math.min(next ? next.since : P.to, P.to);
      if (to <= from) {
        continue;
      }
      const prev = eras[eras.length - 1];
      if (prev && prev.paused === !!e.paused && prev.cadence === runCad && prev.reason === e.reason && prev.intended === e.intended && prev.label === e.label && prev.color === e.color) {
        prev.to = to;
        continue;
      }
      eras.push({
        from,
        to,
        cadence: runCad,
        paused: !!e.paused,
        reason: e.reason,
        intended: e.intended,
        ...e.label ? { label: e.label } : {},
        ...e.color ? { color: e.color } : {}
      });
    }
    if (!eras.length) {
      eras.push({ from: P.from, to: P.to, cadence: runCad, paused: false, reason: void 0, intended: void 0 });
    }
    return eras;
  }
  var PAUSE_CLASSES = ["paused", "tinted"];
  function clearPauseClasses(el) {
    el.classList.remove(...PAUSE_CLASSES);
    el.style?.removeProperty("--ktl-band");
  }
  function addPauseClasses(el, x) {
    const pi = pauseInfo(x);
    el.classList.add(...pi.classes);
    if (pi.color) {
      el.style.setProperty("--ktl-band", pi.color);
    }
  }
  function pauseInfo(x) {
    const label = x && x.label || "PAUSED";
    const color = x && x.color;
    return { label, classes: color ? ["paused", "tinted"] : ["paused"], ...color ? { color } : {} };
  }

  // src/vt/model/intervals.ts
  var AUTO_HOLD_FACTOR = 3;
  var AUTO_HOLD_FALLBACK = 36e5;
  var AUTO_HOLD_NEIGHBOURS = 4;
  function buildIntervals(input) {
    const { window: W, now } = input;
    const tol = input.tolerance ?? 0.5;
    const hold = input.hold ?? "auto";
    const declared = input.promiseAt ?? (() => null);
    const promiseAt = (t) => {
      const p = input.promiseOverride && input.promiseOverride > 0 ? input.promiseOverride : declared(t);
      return p && p > 0 ? Math.max(p, input.step ?? 0) : null;
    };
    const horizon = Math.max(W.from, Math.min(W.to, now));
    const byTs = /* @__PURE__ */ new Map();
    for (const f of input.frames) {
      if (Number.isFinite(f.ts)) {
        byTs.set(f.ts, f);
      }
    }
    let frames = [...byTs.values()].sort((a, b) => a.ts - b.ts);
    const pauses = resolvePauses(input.pauses ?? [], frames, horizon);
    const inPause = (t) => pauses.some((p) => t > p.from && t < p.to);
    frames = frames.filter((f) => f.ts <= horizon && !inPause(f.ts));
    let offset = 0;
    while (offset + 1 < frames.length && frames[offset + 1].ts <= W.from) {
      offset++;
    }
    const shown = frames.slice(offset);
    const promiseOf = (f) => {
      const own = input.promiseOverride && input.promiseOverride > 0 ? input.promiseOverride : f.cadence;
      return typeof own === "number" && own > 0 ? Math.max(own, input.step ?? 0) : promiseAt(f.ts);
    };
    const holdFor = (i) => {
      if (hold === "none") {
        return Infinity;
      }
      if (typeof hold === "number") {
        return hold > 0 ? hold : Infinity;
      }
      const gaps = [];
      for (let j = Math.max(1, i - AUTO_HOLD_NEIGHBOURS + 1); j <= Math.min(frames.length - 1, i + AUTO_HOLD_NEIGHBOURS); j++) {
        gaps.push(frames[j].ts - frames[j - 1].ts);
      }
      if (!gaps.length) {
        return AUTO_HOLD_FALLBACK;
      }
      gaps.sort((a, b) => a - b);
      return AUTO_HOLD_FACTOR * gaps[Math.floor(gaps.length / 2)];
    };
    const out = [];
    const push = (from, to, kind, extra = {}) => {
      const a = Math.max(from, W.from), b = Math.min(to, horizon);
      if (b <= a) {
        return;
      }
      const last = out[out.length - 1];
      if (last && last.kind === kind && last.to === a && !extra.frame && !last.frame && !last.pause && !extra.pause) {
        last.to = b;
        return;
      }
      out.push({ from: a, to: b, kind, ...extra });
    };
    const follow = (f, t, until, promise, holdMs, live) => {
      if (until <= t) {
        return;
      }
      if (promise) {
        const due = t + promise, kept = t + (1 + tol) * promise;
        if (live && f) {
          const grace = due + promise;
          push(t, Math.min(due, until), "frame", { frame: f });
          push(due, Math.min(grace, until), "pending", { frame: f });
          push(grace, until, "dropped");
        } else if (until <= kept) {
          push(t, until, f ? "frame" : "nodata", f ? { frame: f } : {});
        } else {
          push(t, due, f ? "frame" : "nodata", f ? { frame: f } : {});
          push(due, until, "dropped");
        }
        return;
      }
      if (f) {
        push(t, Math.min(t + holdMs, until), "frame", { frame: f });
        push(t + holdMs, until, "nodata");
      } else {
        push(t, until, "nodata");
      }
    };
    let cursor = W.from;
    const firstTs = shown.length ? shown[0].ts : horizon;
    if (firstTs > W.from) {
      const p = promiseAt(W.from);
      let t = W.from;
      for (const pz of pauses) {
        if (pz.to <= t || pz.from >= firstTs) {
          continue;
        }
        push(t, pz.from, p ? "dropped" : "nodata");
        push(pz.from, Math.min(pz.to, firstTs), "paused", { pause: pz });
        t = Math.min(pz.to, firstTs);
      }
      if (t < firstTs) {
        if (t > W.from) {
          follow(null, t, firstTs, promiseAt(t), 0, false);
        } else {
          push(t, firstTs, p ? "dropped" : "nodata");
        }
      }
      cursor = firstTs;
    }
    for (let k = 0; k < shown.length; k++) {
      const f = shown[k];
      const i = offset + k;
      const next = shown[k + 1];
      const end = next ? next.ts : horizon;
      const live = !next;
      let t = f.ts;
      let cur = f;
      let promise = promiseOf(f);
      let holdMs = holdFor(i);
      for (const pz of pauses) {
        if (pz.from < t || pz.from >= end) {
          continue;
        }
        follow(cur, t, pz.from, promise, holdMs, false);
        push(pz.from, Math.min(pz.to, end), "paused", { pause: pz });
        t = Math.min(pz.to, end);
        cur = null;
        promise = promiseAt(t);
        holdMs = 0;
      }
      follow(cur, t, end, promise, holdMs, live && cur !== null);
      cursor = end;
    }
    if (horizon < W.to) {
      out.push({ from: Math.max(cursor, horizon), to: W.to, kind: "beyond" });
    }
    const inWindow = shown.filter((f) => f.ts <= W.to);
    return {
      intervals: out,
      frames: inWindow,
      at(t) {
        if (!out.length) {
          return null;
        }
        const x = Math.max(out[0].from, Math.min(out[out.length - 1].to - 1e-6, t));
        let lo = 0, hi = out.length - 1;
        while (lo < hi) {
          const mid = lo + hi + 1 >> 1;
          if (out[mid].from <= x) {
            lo = mid;
          } else {
            hi = mid - 1;
          }
        }
        return out[lo];
      }
    };
  }
  function resolvePauses(pauses, frames, horizon) {
    return pauses.map((p) => {
      if (p.to != null) {
        return p;
      }
      const after = p.from + (p.resumeAfter ?? 0);
      const resume = frames.find((f) => f.ts >= after && f.ts <= horizon);
      return { ...p, to: resume ? resume.ts : horizon };
    }).filter((p) => p.to > p.from).sort((a, b) => a.from - b.from);
  }

  // src/vt/model/slots.ts
  var LOOKBACK_STEPS = 100;
  var LOOKBACK_UNPROMISED = 36e5;
  async function buildSourceModel(decl, P, backend, budgetSlots, opts = {}) {
    const expected = opts.expected && opts.expected > 0 ? opts.expected : void 0;
    const eras = erasFor(expected ? { ...decl, cadence: expected, history: (decl.history || []).filter((h) => h.paused !== void 0 || !h.cadence) } : decl, P);
    const promised = !!expected || !decl.inferred;
    const hold = opts.hold ?? "auto";
    const active = eras.filter((e) => !e.paused);
    const base = Math.max(1e3, Math.min(...(active.length ? active : eras).map((e) => e.cadence)));
    const activeSpan = Math.max(1, active.reduce((a, e) => a + (e.to - e.from), 0) || P.to - P.from);
    const step = base * Math.max(1, Math.ceil(activeSpan / base / Math.max(4, budgetSlots)));
    const maxCadence = Math.max(...eras.map((e) => e.cadence));
    const wanted = promised ? 1.5 * maxCadence + step : typeof hold === "number" ? hold : LOOKBACK_UNPROMISED;
    const lookback = Math.min(wanted, LOOKBACK_STEPS * step);
    const now0 = opts.now ?? Date.now();
    const fetched = backend.allFrames ? await backend.allFrames(decl.site, decl.id, P.from - lookback, Math.min(P.to, now0)) : await backend.frames(decl.site, decl.id, P.from - lookback, Math.min(P.to, now0), step);
    const promiseAt = (t) => {
      if (!promised) {
        return null;
      }
      let c = eras[0].cadence;
      for (const e of eras) {
        if (e.from <= t) {
          c = e.cadence;
        }
      }
      return c;
    };
    const pauses = [];
    eras.forEach((e, i) => {
      if (!e.paused) {
        return;
      }
      const open = i === eras.length - 1;
      pauses.push({
        from: e.from,
        to: open ? null : e.to,
        resumeAfter: open ? e.cadence : void 0,
        label: e.label,
        color: e.color,
        reason: e.reason,
        intended: e.intended
      });
    });
    const model = {
      eras,
      step,
      promised,
      frames: [],
      intervals: [],
      slots: [],
      drops: [],
      lastActive: null,
      slotAt: () => null,
      intervalAt: () => null,
      intervalsFor: (frames, window2, now) => buildIntervals({
        frames,
        promiseAt,
        pauses,
        hold,
        window: window2,
        now,
        promiseOverride: expected
      }).intervals,
      refresh(fresh, now) {
        const byTs = new Map(model.frames.map((f) => [f.ts, f]));
        for (const f of fresh) {
          byTs.set(f.ts, f);
        }
        model.frames = [...byTs.values()].sort((a, b) => a.ts - b.ts);
        const buckets = (Math.min(P.to, now) - (P.from - lookback)) / step + 2;
        const thinned = model.frames.length <= 1.1 * buckets;
        const built = buildIntervals({
          frames: model.frames,
          promiseAt,
          pauses,
          hold,
          window: P,
          now,
          step: promised && thinned ? step : void 0,
          promiseOverride: expected
        });
        const { slots, drops } = sample(built, step, (t) => promiseAt(t) ?? base);
        model.intervals = built.intervals;
        model.intervalAt = built.at;
        model.slots = slots;
        model.drops = drops;
        model.slotAt = (t) => slotAt(slots, t);
        model.lastActive = [...slots].reverse().find((sl) => !sl.paused && !sl.beyond) || null;
      }
    };
    model.refresh(fetched, now0);
    return model;
  }
  function sample(built, step, cadenceAt) {
    const ivs = built.intervals;
    const frames = built.frames;
    const slots = [];
    let fi = 0;
    for (let i = 0; i < ivs.length; ) {
      const iv = ivs[i];
      if (iv.kind === "paused") {
        const p = iv.pause;
        slots.push({
          ts: iv.from,
          x0: iv.from,
          span: iv.to - iv.from,
          paused: true,
          reason: p.reason,
          intended: p.intended,
          label: p.label,
          color: p.color
        });
        i++;
        continue;
      }
      if (iv.kind === "beyond") {
        slots.push({ ts: iv.from, x0: iv.from, span: iv.to - iv.from, beyond: true });
        i++;
        continue;
      }
      let j = i;
      while (j < ivs.length && ivs[j].kind !== "paused" && ivs[j].kind !== "beyond") {
        j++;
      }
      const a = iv.from, b = ivs[j - 1].to;
      const ticks = [];
      for (let t = Math.ceil(a / step) * step; t <= b; t += step) {
        ticks.push(t);
      }
      if (!ticks.length) {
        ticks.push((a + b) / 2);
      }
      for (let k = 0; k < ticks.length; k++) {
        const t = ticks[k];
        const x0 = k === 0 ? a : (ticks[k - 1] + t) / 2;
        const x1 = k === ticks.length - 1 ? b : (t + ticks[k + 1]) / 2;
        while (fi < frames.length && frames[fi].ts < x0) {
          fi++;
        }
        let count = 0, best = null;
        const last = k === ticks.length - 1;
        for (let m = fi; m < frames.length && (frames[m].ts < x1 || last && frames[m].ts === x1); m++) {
          count += frames[m].count && frames[m].count > 1 ? frames[m].count : 1;
          if (!best || Math.abs(frames[m].ts - t) < Math.abs(best.ts - t)) {
            best = frames[m];
          }
        }
        const at = best ? null : built.at(last ? b - 1 : Math.min(t, b - 1));
        const sl = {
          ts: t,
          x0,
          span: x1 - x0,
          cadence: cadenceAt(t),
          step,
          count,
          frame: best ?? (at && at.kind === "frame" ? at.frame : null),
          future: !best && !!at && at.kind === "pending"
        };
        if (!best && at && at.kind === "nodata") {
          sl.nodata = true;
        }
        slots.push(sl);
      }
      i = j;
    }
    const drops = [];
    for (const iv of ivs) {
      if (iv.kind !== "dropped") {
        continue;
      }
      for (const sl of slots) {
        if (!sl.frame || sl.x0 >= iv.to || sl.x0 + sl.span <= iv.from) {
          continue;
        }
        const from = Math.max(iv.from, sl.x0), to = Math.min(iv.to, sl.x0 + sl.span);
        const last = drops[drops.length - 1];
        if (last && last.to === from) {
          last.to = to;
        } else {
          drops.push({ from, to });
        }
      }
    }
    return { slots, drops };
  }
  function slotAt(slots, t) {
    if (!slots.length) {
      return null;
    }
    let lo = 0, hi = slots.length - 1;
    while (lo < hi) {
      const mid = lo + hi + 1 >> 1;
      if (slots[mid].x0 <= t) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    const sl = slots[lo];
    if (sl.beyond && lo > 0) {
      const prev = slots[lo - 1];
      if (!prev.paused && !prev.beyond && t < sl.x0 + prev.step / 2) {
        return prev;
      }
    }
    return sl;
  }
  function ghostFor(slots, sl) {
    for (let j = slots.indexOf(sl) - 1; j >= 0; j--) {
      if (slots[j].frame) {
        return slots[j].frame;
      }
      if (!slots[j].future) {
        return null;
      }
    }
    return null;
  }
  function slotClass(sl) {
    return sl.paused ? " " + pauseInfo(sl).classes.join(" ") : sl.beyond ? " beyond" : sl.frame ? "" : sl.future ? " future" : sl.nodata ? " gap nodata" : " gap";
  }

  // src/vt/model/filters.ts
  function parseVar(v) {
    if (!v || v === "All" || v === "$__all") {
      return null;
    }
    return v.replace(/^\{|\}$/g, "").split(",").map((s) => s.trim()).filter(Boolean);
  }
  function parseTagFilter(expr) {
    if (!expr) {
      return null;
    }
    const out = {};
    for (const part of String(expr).split(",")) {
      const i = part.indexOf("=");
      const key = i >= 0 ? part.slice(0, i).trim().toLowerCase() : "";
      if (key) {
        out[key] = part.slice(i + 1).trim().toLowerCase();
      }
    }
    return Object.keys(out).length ? out : null;
  }
  function matchesTags(tags, filter) {
    if (!filter) {
      return true;
    }
    const t = tags || {};
    for (const k in filter) {
      if (String(t[k] == null ? "" : t[k]).toLowerCase() !== filter[k]) {
        return false;
      }
    }
    return true;
  }

  // src/vt/zones/source.ts
  var sourceZoneWarned = /* @__PURE__ */ new Set();
  function sourceTimeZone(decl) {
    const raw = decl && decl.timezone;
    if (typeof raw !== "string") {
      return null;
    }
    const s = raw.trim();
    if (!s || /^(browser|default|local)$/i.test(s)) {
      return null;
    }
    if (/^(?:etc\/)?utc$/i.test(s)) {
      return "UTC";
    }
    if (isZone(s)) {
      return s;
    }
    if (!sourceZoneWarned.has(s)) {
      sourceZoneWarned.add(s);
      console.warn('[visual-timeline] source declares unknown time zone "' + s + '"; ignoring it');
    }
    return null;
  }
  function zoneLabel(tz) {
    const s = String(tz || "");
    if (/^(?:etc\/)?utc$/i.test(s)) {
      return "UTC";
    }
    return s.slice(s.lastIndexOf("/") + 1).replace(/_/g, " ");
  }
  function fmtOffset(ms) {
    const m = Math.round(ms / 6e4);
    if (!m) {
      return "";
    }
    const a = Math.abs(m), h = Math.floor(a / 60), mm = a % 60;
    return (m < 0 ? "\u2212" : "+") + (h ? h + "h" : "") + (mm ? mm + "m" : "");
  }
  function zoneOffsetText(tz, refTz, ts) {
    return fmtOffset(zoneOf(tz).offset(ts) - zoneOf(refTz).offset(ts));
  }
  function zoneHeadText(tz, refTz, ts) {
    const off = zoneOffsetText(tz, refTz, ts);
    return zoneLabel(tz) + (off ? " \xB7 " + off : "");
  }
  function zoneTexts(zone, panelTZ, suffix) {
    let memoMin = NaN, memo = "";
    const off = (ts) => {
      const m = Math.floor(ts / 6e4);
      if (m !== memoMin) {
        memoMin = m;
        memo = zone === panelTZ ? "" : zoneOffsetText(zone, panelTZ, ts);
      }
      return memo;
    };
    const label = zoneLabel(zone);
    return {
      zone,
      label,
      off,
      time: (ts) => fmtTime(ts, zone),
      short: (ts) => fmtShort(ts, zone),
      sfx: suffix ? (ts) => {
        const o = off(ts);
        return o ? " (" + o + ")" : "";
      } : () => ""
    };
  }
  function zoneFor(decl, panelTZ, thumbTimes, panelTT) {
    const srcTZ = sourceTimeZone(decl);
    const texts = srcTZ ? zoneTexts(srcTZ, panelTZ, true) : null;
    return { srcTZ, texts, tt: texts && thumbTimes === "source" ? texts : panelTT, el: null, offEl: null, off: null };
  }

  // src/vt/backends/reasons.ts
  var REASON_STYLES = {
    paused: { label: "PAUSED" },
    quiet: { label: "QUIET HOURS" },
    "screen-sleep": { label: "SCREEN ASLEEP", color: "blue" },
    "system-down": { label: "SYSTEM DOWN (PLANNED)", color: "purple" },
    "app-stopped": { label: "APP STOPPED", color: "#2BA08C" },
    // the retention cutoff: frames this old have been deleted
    expired: { label: "NO DATA" }
  };
  var UNEXPECTED_COLOR = "orange";
  function unexpectedLabel(reason) {
    return reason === "screen-sleep" ? "SCREEN DARK (UNEXPECTED)" : reason && REASON_STYLES[reason]?.label || "PAUSED";
  }
  var NAMED = { blue: "#5794F2", purple: "#B877D9", orange: "#FF9830" };
  var resolve = (c) => NAMED[c] ?? c;
  function reasonDisplay(reason, intended) {
    if (intended === false) {
      return { label: unexpectedLabel(reason), color: resolve(UNEXPECTED_COLOR) };
    }
    const known = reason && REASON_STYLES[reason] || REASON_STYLES.paused;
    return known.color ? { label: known.label, color: resolve(known.color) } : { label: known.label };
  }
  function labelPauses(decl) {
    if (!decl.history?.some((h) => h.paused && !h.label)) {
      return decl;
    }
    const history = decl.history.map((h) => h.paused && !h.label ? { ...h, ...reasonDisplay(h.reason, h.intended) } : h);
    return { ...decl, history };
  }

  // src/vt/backends/api.ts
  function imageUrlWithKey(url, apiBase, apiKey) {
    if (!apiKey || !url) {
      return url;
    }
    const u = new URL(url, apiBase);
    if (u.search || u.origin !== new URL(apiBase).origin) {
      return url;
    }
    u.searchParams.set("k", apiKey);
    return u.href;
  }
  function sourcesPath(sites) {
    const q2 = new URLSearchParams();
    if (sites) {
      q2.set("site", sites.join(","));
    }
    const qs = q2.toString();
    return "/sources" + (qs ? "?" + qs : "");
  }
  function framesPath(site, kiosk, from, to, step) {
    const q2 = new URLSearchParams();
    q2.set("site", site);
    q2.set("source", kiosk);
    q2.set("from", String(Math.round(from)));
    q2.set("to", String(Math.round(to)));
    q2.set("step", String(step));
    q2.set("variant", "lo");
    return "/frames?" + q2.toString();
  }
  function resolveFrameUrl(url, apiBase) {
    if (!url || !apiBase) {
      return url;
    }
    try {
      return new URL(url, apiBase.replace(/\/+$/, "") + "/frames").href;
    } catch {
      return url;
    }
  }
  var PROXY_AUTH_FAILED = "Authentication to data source failed";
  var ApiError = class extends Error {
    constructor(message, status, call, auth) {
      super(message);
      this.status = status;
      this.call = call;
      this.auth = auth;
      this.name = "ApiError";
    }
  };
  async function apiError(call, r, viaProxy) {
    const st = r.status;
    if (viaProxy) {
      let proxyAuth = st === 401;
      if (st === 400) {
        try {
          const body = await r.json();
          proxyAuth = (typeof body === "string" ? body : JSON.stringify(body ?? "")).includes(PROXY_AUTH_FAILED);
        } catch {
        }
      }
      if (proxyAuth) {
        return new ApiError(
          "The data source's viewer token was rejected. Check it in the data source's settings: Save & test shows what the API says.",
          st,
          call,
          true
        );
      }
      if (st === 403) {
        return new ApiError(
          "The data source's viewer token isn't allowed to read these sources (403). It may be scoped to other sites.",
          st,
          call,
          true
        );
      }
      if (st === 502 || st === 503 || st === 504) {
        return new ApiError(
          `Grafana couldn't reach the frames API (${st}). Check the data source's API URL.`,
          st,
          call,
          false
        );
      }
    } else if (st === 401) {
      return new ApiError("The frames API needs a valid viewer token (401).", st, call, true);
    } else if (st === 403) {
      return new ApiError(
        "The viewer token isn't allowed to read these sources (403). It may be scoped to other sites.",
        st,
        call,
        true
      );
    }
    return new ApiError(
      st ? `The frames API answered ${st} to /${call}.` : `No answer from the frames API for /${call}.`,
      st,
      call,
      false
    );
  }
  function bootErrorText(e, authHint) {
    if (e instanceof ApiError) {
      return e.auth && authHint ? e.message + " " + authHint : e.message;
    }
    const msg = e && e.message ? e.message : String(e);
    return "frames API unreachable \u2014 " + msg;
  }
  function makeApiBackend(apiUrl, apiKey, apiFetch) {
    const base = (apiUrl || "").replace(/\/+$/, "");
    const key = apiFetch ? "" : apiKey;
    const opts = () => ({
      headers: key ? { authorization: "Bearer " + key } : void 0,
      signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(15e3) : void 0
    });
    const get = apiFetch ? (path) => apiFetch(path) : (path) => fetch(base + path, opts());
    const image = (u) => apiFetch ? resolveFrameUrl(u, base) : imageUrlWithKey(u, base, key);
    const decls = /* @__PURE__ */ new Map();
    return {
      async kiosks(sites) {
        const r = await get(sourcesPath(sites));
        if (!r.ok) {
          throw await apiError("sources", r, !!apiFetch);
        }
        const list = (await r.json()).map(labelPauses);
        for (const d of list) {
          decls.set(d.site + "/" + d.id, d);
        }
        return list;
      },
      async frames(site, kiosk, from, to, step) {
        const r = await get(framesPath(site, kiosk, from, to, step));
        if (!r.ok) {
          throw await apiError("frames", r, !!apiFetch);
        }
        const rows = await r.json();
        const decl = decls.get(site + "/" + kiosk);
        for (const f of rows) {
          f.url = image(f.url);
          if (f.url_hi) {
            f.hi = image(f.url_hi);
          } else if (decl) {
            f.hi = hiUrlFor(f, decl, base, key) ?? void 0;
          }
          delete f.url_hi;
        }
        return rows;
      }
    };
  }
  function hiUrlFor(frame, decl, apiUrl, apiKey) {
    if (frame?.hi) {
      return frame.hi;
    }
    if (!decl.hiCadence || !frame) {
      return null;
    }
    const url = frame.url || "";
    const qAt = url.indexOf("?");
    const path = qAt >= 0 ? url.slice(0, qAt) : url;
    const at = path.lastIndexOf("/frame/");
    const base = at >= 0 ? path.slice(0, at) : apiUrl ? apiUrl.replace(/\/+$/, "") : null;
    if (base === null) {
      return null;
    }
    const hiTs = Math.round(frame.ts / decl.hiCadence) * decl.hiCadence;
    const hi = base + "/frame/hi/" + encodeURIComponent(decl.site) + "/" + encodeURIComponent(decl.id) + "/" + hiTs + ".jpg";
    if (qAt >= 0) {
      return hi + url.slice(qAt);
    }
    return apiUrl ? imageUrlWithKey(hi, apiUrl, apiKey) : hi;
  }

  // src/vt/dom/html.ts
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => "&#" + c.charCodeAt(0) + ";");
  }
  function filterAttrs(key, value, filterable = false) {
    const a = ' data-fk="' + esc(key) + '" data-fv="' + esc(value) + '"';
    return filterable ? a + ' role="button" tabindex="0" title="' + esc("Filter by " + key + " = " + value) + '"' : a;
  }
  function tagChips(decl, filterable = false) {
    if (!decl.tags) {
      return "";
    }
    const chips = Object.entries(decl.tags).map(([k, v]) => '<span class="st"' + filterAttrs(k, v, filterable) + ">" + esc(k) + "=" + esc(v) + "</span>").join("");
    return '<span class="tags">' + chips + "</span>";
  }
  function headChips(decl, chips, filterable = false) {
    if (!chips) {
      return (decl.site || decl.location ? '<span class="st"' + filterAttrs("site", decl.site, filterable) + ">" + esc(decl.site) + (decl.site && decl.location ? " \xB7 " : "") + esc(decl.location || "") + "</span>" : "") + tagChips(decl, filterable);
    }
    let out = "";
    for (const key of chips) {
      const value = key === "site" ? decl.site : key === "location" ? decl.location : decl.tags?.[key];
      if (!value) {
        continue;
      }
      const text = key === "site" || key === "location" ? esc(value) : esc(key) + "=" + esc(value);
      out += '<span class="st"' + filterAttrs(key, value, filterable) + ">" + text + "</span>";
    }
    return out;
  }
  function headTitle(decl) {
    const parts = [decl.site];
    if (decl.location) {
      parts.push(decl.location);
    }
    if (decl.tags) {
      for (const [k, v] of Object.entries(decl.tags)) {
        parts.push(k + "=" + v);
      }
    }
    return parts.join(" \xB7 ");
  }
  function wireFilters(wrap, onFilter) {
    if (!onFilter) {
      return;
    }
    wrap.classList.add("filterable");
    const filter = (e) => {
      const el = e.target?.closest("[data-fk]");
      if (!el || !wrap.contains(el)) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      const host = el.closest(".card-head, .t-head")?.querySelector(".nm")?.dataset.fv;
      onFilter(el.dataset.fk || "", el.dataset.fv || "", host);
    };
    wrap.addEventListener("click", filter, true);
    wrap.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        filter(e);
      }
    });
  }

  // src/vt/dom/styles.ts
  var STYLE_ID = "ktl-styles";
  var KTL_VAR_DEFAULTS = {
    "--ktl-bg": "#181b1f",
    "--ktl-bg2": "#22262b",
    "--ktl-border": "#2c3235",
    "--ktl-text": "#ccccdc",
    "--ktl-dim": "#7b8087",
    "--ktl-muted": "#9aa0a6",
    "--ktl-strong": "#fff",
    "--ktl-chip-text": "#b9bec6",
    "--ktl-link": "#6e9fff",
    "--ktl-accent": "#f2cc0c",
    "--ktl-sel": "rgba(242,204,12,.14)",
    "--ktl-live": "#73bf69",
    "--ktl-off": "#f2495c",
    "--ktl-axis-grid": "rgba(240,250,255,.09)",
    "--ktl-media": "#111",
    "--ktl-mag-bg": "#000",
    "--ktl-float-bg": "#0b0c0e",
    "--ktl-divider": "#1d2024",
    "--ktl-shadow": "0 8px 32px rgba(0,0,0,.7)",
    "--ktl-pending": "#232830",
    "--ktl-scrim": "rgba(0,0,0,.6)",
    "--ktl-gap-a": "#1b1215",
    "--ktl-gap-b": "#2a171b",
    "--ktl-pause-a": "#15171a",
    "--ktl-pause-b": "#232830",
    "--ktl-tpause-a": "#17191c",
    "--ktl-tpause-b": "#1d2024",
    "--ktl-ann": "#5794F2",
    "--ktl-ann-edge": "#0b0c0e",
    "--ktl-ann-region": "rgba(87,148,242,.12)",
    "--ktl-ann-region-edge": "rgba(87,148,242,.55)"
  };
  var KTL_VARS = Object.keys(KTL_VAR_DEFAULTS);
  var MAG_CAP_ROOM = 90;
  function copyVars(from, to) {
    if (!from || !from.isConnected) {
      return;
    }
    const cs = getComputedStyle(from);
    for (const v of KTL_VARS) {
      const val = cs.getPropertyValue(v).trim();
      if (val) {
        to.style.setProperty(v, val);
      } else {
        to.style.removeProperty(v);
      }
    }
  }
  var CSS = `
.ktl-root, .ktl-ann-tip, .ktl-pop { ${KTL_VARS.map((v) => v + ":" + KTL_VAR_DEFAULTS[v] + ";").join(" ")} }
.ktl { display:flex; flex-direction:column; width:100%; height:100%; overflow:hidden;
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
/* a source's zone chip ("Sydney \xB7 +3h") leads the details: it is what
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
.ktl .slot img:not([src]) { visibility:hidden; }   /* queued (ui/imageQueue.ts): no alt text or broken-image icon meanwhile */
.ktl .slot.gap { background:repeating-linear-gradient(45deg,var(--ktl-gap-a),var(--ktl-gap-a) 5px,var(--ktl-gap-b) 5px,var(--ktl-gap-b) 10px); }
/* no data (no promise in force, or none kept past its hold limit): the
 * neutral hatch, not the red one (docs/TIMELINE-MODEL.md) */
.ktl .slot.gap.nodata { background:repeating-linear-gradient(45deg,var(--ktl-pause-a),var(--ktl-pause-a) 5px,var(--ktl-pause-b) 5px,var(--ktl-pause-b) 10px); }
/* dropped time inside cells that show a frame, at its true place: at least
 * a pixel, so an outage shorter than a slot still shows */
.ktl .strip .drops { position:absolute; inset:0; pointer-events:none; z-index:2; }
.ktl .strip .drop { position:absolute; top:0; bottom:0; min-width:1px; background:var(--ktl-off); opacity:.8; }
.ktl .slot.paused { background:repeating-linear-gradient(45deg,var(--ktl-pause-a),var(--ktl-pause-a) 7px,var(--ktl-pause-b) 7px,var(--ktl-pause-b) 14px); }
.ktl.filterable [data-fk] { cursor:pointer; }
.ktl.filterable [data-fk]:hover { text-decoration:underline; text-underline-offset:2px; }
.ktl.filterable [data-fk]:focus-visible { outline:2px solid var(--ktl-accent); outline-offset:1px; }
/* an inline header lets hover through to the image, but not its filters */
.ktl.filterable .inline-head [data-fk] { pointer-events:auto; }
/* a pause from a state query brings its own colour (its value mapping) */
.ktl .slot.paused.tinted { background:repeating-linear-gradient(45deg,color-mix(in srgb,var(--ktl-band) 30%,transparent),color-mix(in srgb,var(--ktl-band) 30%,transparent) 7px,color-mix(in srgb,var(--ktl-band) 12%,transparent) 7px,color-mix(in srgb,var(--ktl-band) 12%,transparent) 14px); }
/* hatch continuity: each slot is its own element, so a per-element gradient
 * restarts at every slot edge \u2014 a run of narrow slots shows only the first
 * stripe color and reads as a SOLID block. dressStrip aligns each empty
 * slot's background-position to its offset in the strip (at build, and for
 * the slots the live poll adds), so the diagonals
 * run continuously across runs. (NOT background-attachment:fixed \u2014 Chrome
 * refuses to paint fixed backgrounds inside Grafana's transformed panels.)
 * A wide pause band also carries its label inline \u2014 a strip that is ALL
 * pause should say why without requiring a hover. */
.ktl .slot .band-label { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
  font-size:10px; font-weight:700; letter-spacing:.06em; color:var(--ktl-dim);
  white-space:nowrap; overflow:hidden; pointer-events:none; }
.ktl .slot.tinted .band-label { color:var(--ktl-band); }
/* the ONE pending slot (its tick passed, frame in flight) pulses gently \u2014
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
.ktl.fill .mag img { object-fit:cover; }
.ktl.fill .tile .t-img img { object-fit:cover; }
.ktl .mag.gap { border-color:var(--ktl-off);
                background:repeating-linear-gradient(45deg,var(--ktl-gap-a),var(--ktl-gap-a) 5px,var(--ktl-gap-b) 5px,var(--ktl-gap-b) 10px), var(--ktl-mag-bg); }
.ktl .mag.gap.nodata { border-color:var(--ktl-dim);
                background:repeating-linear-gradient(45deg,var(--ktl-pause-a),var(--ktl-pause-a) 5px,var(--ktl-pause-b) 5px,var(--ktl-pause-b) 10px), var(--ktl-mag-bg); }
.ktl .mag.gap img { display:none; }
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
.ktl .mag.flip::after { content:'\u25B6'; position:absolute; top:3px; left:5px; font-size:9px; line-height:1;
                        color:var(--ktl-accent); text-shadow:0 0 3px rgba(0,0,0,.8); pointer-events:none; }
.ktl-pop { position:fixed; z-index:1060; background:var(--ktl-float-bg); border:1px solid var(--ktl-accent);
           border-radius:4px; padding:4px; cursor:zoom-out;
           box-shadow:var(--ktl-shadow); }
.ktl-pop img { display:block; max-width:min(560px, 50vw); max-height:55vh; border-radius:2px; }
.ktl-pop .cap { text-align:center; color:var(--ktl-text); font-size:11px; padding:3px 0 0;
                font-variant-numeric:tabular-nums; }
/* the preview as a player (M10): stage, scrubber, controls */
.ktl-pop.player { cursor:default; padding:6px; width:min(720px, 92vw); font:12px/1.4 -apple-system,"Segoe UI",Roboto,sans-serif;
                  color:var(--ktl-text); display:flex; flex-direction:column; gap:6px; }
.ktl-pop.player .stage { position:relative; display:flex; justify-content:center; background:var(--ktl-media); border-radius:2px; min-height:120px; }
.ktl-pop.player .stage img { max-width:100%; max-height:60vh; }
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
.ktl-pop.player .thumbs { position:absolute; inset:0; pointer-events:none; }
.ktl-pop.player .thumb { position:absolute; top:0; bottom:0; overflow:hidden; border-right:1px solid rgba(0,0,0,.4); }
.ktl-pop.player .thumb img { width:100%; height:100%; object-fit:cover; display:block; }
.ktl-pop.player .thumb.prior img { opacity:.4; }
.ktl-pop.player .ticks { position:absolute; inset:0; pointer-events:none; }
.ktl-pop.player .tick { position:absolute; bottom:0; height:40%; width:1px; background:var(--ktl-text); opacity:.55; }
.ktl-pop.player.thumbs .tick { height:6px; }
.ktl-pop.player .head { position:absolute; top:0; bottom:0; width:2px; margin-left:-1px; background:var(--ktl-accent); pointer-events:none; }
.ktl-pop.player .bar { display:flex; align-items:center; gap:4px; flex-wrap:wrap; }
.ktl-pop.player .bar .cap { flex:1 1 auto; min-width:120px; padding:0 6px; text-align:center; }
.ktl-pop.player button { font:inherit; color:var(--ktl-text); background:transparent; border:1px solid var(--ktl-border);
                         border-radius:2px; padding:2px 7px; min-width:28px; cursor:pointer; line-height:18px; }
.ktl-pop.player button:hover:not(:disabled) { border-color:var(--ktl-accent); }
.ktl-pop.player button:disabled { opacity:.4; cursor:default; }
.ktl-pop.player button:focus-visible { outline:2px solid var(--ktl-accent); outline-offset:1px; }
.ktl-pop.player button[data-a="play"] { min-width:36px; }`;
  function injectStyles() {
    const existing = document.getElementById(STYLE_ID);
    if (existing) {
      if (existing.textContent !== CSS) {
        existing.textContent = CSS;
      }
      return;
    }
    const s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  // src/vt/model/pool.ts
  var MODEL_CONCURRENCY = 6;
  function limited(items, limit, fn) {
    let running = 0;
    const waiting = [];
    const next = () => {
      running--;
      waiting.shift()?.();
    };
    return items.map((item) => new Promise((resolve2, reject) => {
      const run = () => {
        running++;
        Promise.resolve().then(() => fn(item)).then(resolve2, reject).finally(next);
      };
      if (running < limit) {
        run();
      } else {
        waiting.push(run);
      }
    }));
  }

  // src/vt/backends/demo.ts
  var SITES = {
    "site-a": [
      { id: "source-1", cadence: 6e4, tags: { env: "prod" } },
      { id: "source-2", cadence: 6e4 },
      // declared zones (#68): one with DST, one on a :45 offset, so the
      // header offset label shows from (almost) any viewer's zone
      { id: "source-3", cadence: 12e4, timezone: "Australia/Sydney" }
    ],
    "site-b": [
      { id: "source-4", cadence: 6e4 },
      { id: "source-5", cadence: 3e4, tags: { orient: "portrait" }, timezone: "Asia/Kathmandu" }
    ]
  };
  var DEMO_ZONES = {};
  for (const ks of Object.values(SITES)) {
    for (const k of ks) {
      if (k.timezone) {
        DEMO_ZONES[k.id] = k.timezone;
      }
    }
  }
  var HUES = { "source-1": 205, "source-2": 275, "source-3": 25, "source-4": 130, "source-5": 340 };
  var DIMS = { "source-3": [288, 216], "source-5": [216, 384] };
  var xml = (t) => t.replace(/[&<>'"]/g, (c) => "&#" + c.charCodeAt(0) + ";");
  function makeBackend(P, SPAN, tz) {
    function renderMockFrame(site, kiosk, ts, step) {
      const dims = DIMS[kiosk] || [384, 216];
      const w = dims[0], h = dims[1];
      const hue = HUES[kiosk] != null ? HUES[kiosk] : 130;
      const own = DEMO_ZONES[kiosk];
      const phase = ts / step % 20 / 20;
      const big = Math.round(Math.min(w * 0.16, h * 0.18));
      const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'><rect width='${w}' height='${h}' fill='hsl(${hue},30%,14%)'/><rect width='${w}' height='${Math.round(h * 0.14)}' fill='hsl(${hue},60%,30%)'/><text x='8' y='${Math.round(h * 0.1)}' font-family='sans-serif' font-weight='bold' font-size='${Math.round(h * 0.06)}' fill='#fff'>${xml(site)} / ${xml(kiosk)}</text><text x='${w / 2}' y='${Math.round(h * 0.55)}' text-anchor='middle' font-family='monospace' font-weight='bold' font-size='${big}' fill='hsl(${hue},70%,72%)'>${xml(fmtTime(ts, own || tz))}</text>` + (own ? `<text x='${w / 2}' y='${Math.round(h * 0.655)}' text-anchor='middle' font-family='sans-serif' font-size='${Math.round(Math.min(h * 0.055, w * 0.06))}' fill='hsl(${hue},70%,72%)'>${xml(zoneLabel(own))} local time</text>` : "") + `<rect x='${(w * 0.04 + phase * w * 0.8).toFixed(1)}' y='${(h * 0.72).toFixed(1)}' width='${(w * 0.13).toFixed(1)}' height='${(h * 0.16).toFixed(1)}' fill='hsl(${hue},80%,55%)'/></svg>`;
      return "data:image/svg+xml," + encodeURIComponent(svg);
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
          return labelPauses(decl);
        }));
      },
      frames(site, kiosk, from, to, step) {
        const out = [];
        const gapA = P.from + SPAN * 0.35, gapB = P.from + SPAN * 0.55;
        const first = Math.ceil(from / step) * step;
        for (let ts = first; ts <= Math.min(to, Date.now()); ts += step) {
          if (kiosk === "source-2" && ts > gapA && ts < gapB) {
            continue;
          }
          if (kiosk === "source-4" && ts > P.from + SPAN * 0.2 && ts < P.from + SPAN * 0.45) {
            continue;
          }
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

  // src/vt/ui/annotations.ts
  function normAnnotations(raw, P) {
    const out = [];
    for (const a of raw || []) {
      const ts = Number(a.ts != null ? a.ts : a.time);
      if (!Number.isFinite(ts)) {
        continue;
      }
      let end = a.timeEnd != null ? Number(a.timeEnd) : NaN;
      if (!Number.isFinite(end) || end <= ts) {
        end = null;
      }
      if ((end || ts) < P.from || ts > P.to) {
        continue;
      }
      const tags = Array.isArray(a.tags) ? a.tags.map(String) : a.tags ? String(a.tags).split(",").map((s) => s.trim()).filter(Boolean) : [];
      let source = a.source || null;
      let siteScope = null;
      for (const t of tags) {
        const m = /^(?:host|source|kiosk):(.+)$/.exec(t);
        if (m) {
          source = m[1];
        }
        const ms = /^site:(.+)$/.exec(t);
        if (ms) {
          siteScope = ms[1];
        }
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
        if (annTipPinned && !annTipEl.contains(e.target)) {
          close();
        }
      });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && annTipPinned) {
          close();
        }
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
    function render(items, x, y, src, tz) {
      copyVars(src, el);
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
        tm.textContent = fmtTime(a.ts, tz) + (a.timeEnd ? " \u2192 " + fmtTime(a.timeEnd, tz) : "");
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
      // tz: the zone of the panel that opened the tip (one tip serves every panel)
      show(items, x, y, src, tz) {
        if (!annTipPinned) {
          render(items, x, y, src, tz);
        }
      },
      pin(items, x, y, src, tz) {
        annTipPinned = true;
        el.classList.add("pinned");
        render(items, x, y, src, tz);
      },
      hide() {
        if (!annTipPinned) {
          el.style.display = "none";
        }
      },
      close
    };
  }

  // src/vt/ui/imageQueue.ts
  var IMAGE_CONCURRENCY = 4;
  function makeImageQueue(concurrency = IMAGE_CONCURRENCY) {
    let pending = [];
    let sorted = true;
    let active = 0;
    let stopped = false;
    let scheduled = false;
    let pumping = false;
    let idleWaiters = [];
    function settleIdle() {
      if (active === 0 && pending.length === 0) {
        const w = idleWaiters;
        idleWaiters = [];
        w.forEach((r) => r());
      }
    }
    function pump() {
      scheduled = false;
      if (stopped || pumping) {
        return;
      }
      pumping = true;
      if (!sorted) {
        pending.sort((a, b) => a.ts - b.ts);
        sorted = true;
      }
      while (active < concurrency && pending.length) {
        const job = pending.pop();
        active++;
        let finished = false;
        const done = () => {
          if (finished) {
            return;
          }
          finished = true;
          job.img.removeEventListener("load", done);
          job.img.removeEventListener("error", done);
          active--;
          pump();
        };
        job.img.addEventListener("load", done);
        job.img.addEventListener("error", done);
        job.img.src = job.url;
        if (job.img.complete && job.img.naturalWidth) {
          done();
        }
      }
      pumping = false;
      settleIdle();
    }
    return {
      add(img, url, ts) {
        if (stopped) {
          return;
        }
        pending.push({ img, url, ts });
        sorted = false;
        if (!scheduled) {
          scheduled = true;
          queueMicrotask(pump);
        }
      },
      idle() {
        if (stopped || active === 0 && pending.length === 0 && !scheduled) {
          return Promise.resolve();
        }
        return new Promise((resolve2) => idleWaiters.push(resolve2));
      },
      stop() {
        stopped = true;
        pending = [];
        const w = idleWaiters;
        idleWaiters = [];
        w.forEach((r) => r());
      }
    };
  }

  // src/vt/model/playhead.ts
  function frameIndexAt(frames, t) {
    let lo = 0, hi = frames.length - 1, out = -1;
    while (lo <= hi) {
      const mid = lo + hi >> 1;
      if (frames[mid].ts <= t) {
        out = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return out;
  }

  // src/vt/ui/player.ts
  var PREFS_KEY = "ktl-player";
  var FPS = [1, 2, 4, 8, 16];
  function loadPrefs(ctx) {
    const base = { style: ctx.scrubber ?? "ticks", fps: 4 };
    try {
      const p = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
      return {
        style: p.style === "thumbs" || p.style === "ticks" ? p.style : base.style,
        fps: FPS.includes(p.fps) ? p.fps : base.fps
      };
    } catch {
      return base;
    }
  }
  function savePrefs(p) {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(p));
    } catch {
    }
  }
  var btn = (a, label, title) => `<button type="button" data-a="${a}" title="${title}" aria-label="${title}">${label}</button>`;
  function mountPlayer(el, start, ctx, place) {
    const prefs = loadPrefs(ctx);
    el.classList.add("player");
    el.innerHTML = '<div class="stage"><div class="state"></div></div><div class="scrub" role="slider" tabindex="0" aria-label="The frames in this slot"><div class="lanes"></div><div class="thumbs"></div><div class="ticks"></div><div class="head"></div></div><div class="bar">' + btn("prev-slot", "\u2039\u2039", "Previous slot (Shift+\u2190)") + btn("prev", "\u2039", "Previous frame in this slot (\u2190)") + btn("play", "\u25B6", "Play the frames in this slot (Space)") + btn("next", "\u203A", "Next frame in this slot (\u2192)") + btn("next-slot", "\u203A\u203A", "Next slot (Shift+\u2192)") + '<span class="cap"></span>' + btn("fps", "", "Speed") + btn("style", "", "Scrubber: ticks or thumbnails") + btn("close", "\u2715", "Close (Esc)") + "</div>";
    const img = document.createElement("img");
    img.alt = "frame";
    img.src = start.url;
    el.querySelector(".stage").prepend(img);
    const stateEl = el.querySelector(".stage .state");
    const scrub = el.querySelector(".scrub");
    const lanes = el.querySelector(".lanes");
    const thumbs = el.querySelector(".thumbs");
    const ticks = el.querySelector(".ticks");
    const head = el.querySelector(".head");
    const cap = el.querySelector(".cap");
    const b = (a) => el.querySelector(`button[data-a="${a}"]`);
    let slot = ctx.slotAt(start.ts) ?? { from: start.ts - ctx.step / 2, to: start.ts + ctx.step / 2, ts: start.ts };
    let frames = [start];
    let ivs = [];
    let t = start.ts;
    let playing = false;
    let timer = null;
    let hiTimer = null;
    let loadSeq = 0;
    let gone = false;
    const span = () => Math.max(1, slot.to - slot.from);
    const xOf = (ts) => (ts - slot.from) / span() * 100;
    const inSlot = () => frames.filter((f) => f.ts >= slot.from && f.ts < slot.to);
    const stops = () => {
      const out = new Set(inSlot().map((f) => f.ts));
      for (const iv of ivs) {
        if (iv.kind === "dropped" || iv.kind === "nodata" || iv.kind === "paused") {
          const from = Math.max(iv.from, slot.from);
          if (from < slot.to) {
            out.add(from);
          }
        }
      }
      return [...out].sort((a, z) => a - z);
    };
    function labels() {
      b("fps").textContent = prefs.fps + " fps";
      b("style").textContent = prefs.style === "ticks" ? "Ticks" : "Thumbs";
      b("play").textContent = playing ? "\u275A\u275A" : "\u25B6";
      const n = stops().length;
      b("play").disabled = n < 2;
      b("play").title = n < 2 ? "One frame in this slot: nothing to play" : playing ? "Pause (Space)" : "Play this slot (Space)";
      b("prev").disabled = b("next").disabled = n < 2;
      el.classList.toggle("thumbs", prefs.style === "thumbs");
    }
    function drawScrub() {
      lanes.textContent = "";
      for (const iv of ivs) {
        if (iv.kind === "frame" || iv.kind === "pending" || iv.kind === "beyond") {
          continue;
        }
        const d = document.createElement("div");
        d.className = "lane " + iv.kind;
        if (iv.kind === "paused") {
          if (iv.pause?.color) {
            d.style.setProperty("--ktl-band", iv.pause.color);
          }
          d.title = pauseInfo({ paused: true, label: iv.pause?.label, color: iv.pause?.color }).label.toLowerCase();
        }
        d.style.left = Math.max(0, xOf(iv.from)) + "%";
        d.style.width = Math.max(0, Math.min(100, xOf(iv.to)) - Math.max(0, xOf(iv.from))) + "%";
        lanes.appendChild(d);
      }
      const fs = inSlot();
      ticks.textContent = "";
      for (const f of fs) {
        const k = document.createElement("div");
        k.className = "tick";
        k.style.left = xOf(f.ts) + "%";
        ticks.appendChild(k);
      }
      thumbs.textContent = "";
      if (prefs.style === "thumbs") {
        const prior = frames.filter((f) => f.ts < slot.from).pop();
        const firstTs = fs.length ? fs[0].ts : slot.to;
        if (prior && firstTs > slot.from) {
          const cell = document.createElement("div");
          cell.className = "thumb prior";
          cell.style.left = "0%";
          cell.style.width = xOf(firstTs) + "%";
          const ti = document.createElement("img");
          ti.alt = "";
          ti.src = prior.url;
          cell.appendChild(ti);
          thumbs.appendChild(cell);
        }
        fs.forEach((f, i) => {
          const shownTo = ivs.find((iv) => (iv.kind === "frame" || iv.kind === "pending") && iv.frame?.ts === f.ts && iv.to > f.ts);
          const end = Math.min(i + 1 < fs.length ? fs[i + 1].ts : slot.to, shownTo ? shownTo.to : slot.to);
          const cell = document.createElement("div");
          cell.className = "thumb";
          cell.style.left = xOf(f.ts) + "%";
          cell.style.width = Math.max(0, xOf(end) - xOf(f.ts)) + "%";
          const ti = document.createElement("img");
          ti.alt = "";
          ti.src = f.url;
          cell.appendChild(ti);
          thumbs.appendChild(cell);
        });
      }
    }
    function show() {
      head.style.left = xOf(t) + "%";
      const j = frameIndexAt(frames, t);
      const f = j >= 0 ? frames[j] : null;
      const iv = ivs.find((x) => x.from <= t && t < x.to) || null;
      const kind = iv ? iv.kind : f ? "frame" : "nodata";
      el.classList.toggle("off", kind === "dropped" || kind === "nodata" || kind === "paused");
      stateEl.textContent = kind === "dropped" ? "offline" : kind === "nodata" ? "no frame" : kind === "paused" ? pauseInfo({ paused: true, label: iv?.pause?.label }).label.toLowerCase() : "";
      if (f && img.getAttribute("src") !== f.url && img.dataset.hiOf !== f.url) {
        img.src = f.url;
        delete img.dataset.hiOf;
      }
      caption(f);
      if (hiTimer) {
        clearTimeout(hiTimer);
      }
      if (f && f.hi && !playing) {
        const hi = f.hi, lo = f.url;
        hiTimer = setTimeout(() => {
          const pre = new Image();
          pre.onload = () => {
            if (!gone && frames[frameIndexAt(frames, t)] === f) {
              img.src = hi;
              img.dataset.hiOf = lo;
            }
          };
          pre.src = hi;
        }, 300);
      }
    }
    function caption(f) {
      const fs = inSlot();
      const i = f ? fs.indexOf(f) : -1;
      cap.textContent = (ctx.label ? ctx.label + " \u2014 " : "") + ctx.tt.time(t) + ctx.tt.sfx(t) + (f && f.ts !== t ? " \xB7 frame " + ctx.tt.time(f.ts) + ctx.tt.sfx(f.ts) : "") + (fs.length > 1 && i >= 0 ? " \xB7 " + (i + 1) + "/" + fs.length + " in slot" : "");
    }
    function seek(to) {
      t = Math.max(slot.from, Math.min(slot.to - 1, to));
      show();
    }
    async function load(at) {
      const seq = ++loadSeq;
      const range = { from: slot.from, to: slot.to };
      let got = [];
      try {
        const before = (await ctx.fetch(range.from - ctx.step * 2, range.from)).filter((f) => f.ts < range.from);
        const within = ctx.detail ? await ctx.detail(range.from, range.to) : await ctx.fetch(range.from, range.to);
        got = [...before.slice(-1), ...within];
      } catch (e) {
        console.warn("[visual-timeline] player fetch failed:", e);
      }
      if (gone || seq !== loadSeq) {
        return;
      }
      const byTs = /* @__PURE__ */ new Map();
      for (const f of got) {
        byTs.set(f.ts, f);
      }
      if (start.ts >= range.from && start.ts < range.to && !byTs.has(start.ts)) {
        byTs.set(start.ts, start);
      }
      frames = [...byTs.values()].sort((x, y) => x.ts - y.ts);
      ivs = ctx.intervals(frames, range);
      drawScrub();
      labels();
      seek(at);
    }
    function stop() {
      playing = false;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      labels();
    }
    function tick() {
      const st = stops();
      if (st.length < 2) {
        stop();
        return;
      }
      const i = st.findIndex((x) => x > t);
      seek(st[i < 0 ? 0 : i]);
      const fs = inSlot();
      const j = fs.findIndex((f) => f.ts > t);
      for (let k = 0; k < 3 && fs.length; k++) {
        const p = new Image();
        p.src = fs[((j < 0 ? 0 : j) + k) % fs.length].url;
      }
    }
    function play() {
      if (playing || stops().length < 2) {
        return;
      }
      playing = true;
      labels();
      timer = setInterval(tick, 1e3 / prefs.fps);
    }
    function toSlot(dir) {
      const next = ctx.slotAt(dir > 0 ? slot.to : slot.from - 1);
      if (!next || next.from === slot.from) {
        return;
      }
      slot = next;
      const at = next.frameTs !== void 0 && next.frameTs >= next.from && next.frameTs < next.to ? next.frameTs : next.ts;
      frames = frames.filter((f) => f.ts < next.from).slice(-1);
      ivs = [];
      drawScrub();
      labels();
      seek(at);
      ctx.onTime?.(next.ts);
      void load(at);
    }
    const act = (a) => {
      switch (a) {
        case "play":
          if (playing) {
            stop();
          } else {
            play();
          }
          break;
        case "prev":
        case "next": {
          stop();
          const st = stops();
          const i = st.findIndex((x) => x > t);
          const cur = i < 0 ? st.length - 1 : i - 1;
          const to = st[a === "next" ? cur + 1 : cur - 1];
          if (to !== void 0) {
            seek(to);
          }
          break;
        }
        case "prev-slot":
          stop();
          toSlot(-1);
          break;
        case "next-slot":
          stop();
          toSlot(1);
          break;
        case "fps":
          prefs.fps = FPS[(FPS.indexOf(prefs.fps) + 1) % FPS.length];
          savePrefs(prefs);
          if (playing) {
            stop();
            play();
          }
          labels();
          break;
        case "style":
          prefs.style = prefs.style === "ticks" ? "thumbs" : "ticks";
          savePrefs(prefs);
          labels();
          drawScrub();
          show();
          break;
      }
    };
    el.querySelector(".bar").addEventListener("click", (e) => {
      const a = e.target.closest("button")?.dataset.a;
      if (a && a !== "close") {
        act(a);
      }
    });
    const tAt = (clientX) => {
      const r = scrub.getBoundingClientRect();
      return slot.from + Math.max(0, Math.min(1, (clientX - r.left) / Math.max(1, r.width))) * span();
    };
    scrub.addEventListener("pointermove", (e) => {
      if (playing) {
        stop();
      }
      seek(tAt(e.clientX));
    });
    scrub.addEventListener("pointerdown", (e) => {
      if (playing) {
        stop();
      }
      scrub.setPointerCapture?.(e.pointerId);
      seek(tAt(e.clientX));
    });
    const keyH = (e) => {
      const k = e.key;
      if (k === " ") {
        e.preventDefault();
        act("play");
      } else if (k === "ArrowLeft") {
        e.preventDefault();
        act(e.shiftKey ? "prev-slot" : "prev");
      } else if (k === "ArrowRight") {
        e.preventDefault();
        act(e.shiftKey ? "next-slot" : "next");
      }
    };
    document.addEventListener("keydown", keyH);
    img.onload = place;
    img.onerror = () => {
      if (img.dataset.hiOf) {
        img.src = img.dataset.hiOf;
        delete img.dataset.hiOf;
      }
    };
    if (img.complete) {
      place();
    }
    labels();
    caption(start);
    void load(start.ts);
    return () => {
      gone = true;
      stop();
      if (hiTimer) {
        clearTimeout(hiTimer);
      }
      document.removeEventListener("keydown", keyH);
    };
  }

  // src/vt/ui/preview.ts
  var popState = { el: null, keyH: null, downH: null, teardown: null, retireTimer: null };
  function closePreview() {
    if (popState.retireTimer) {
      clearTimeout(popState.retireTimer);
      popState.retireTimer = null;
    }
    if (popState.teardown) {
      popState.teardown();
      popState.teardown = null;
    }
    if (popState.el) {
      popState.el.remove();
      popState.el = null;
    }
    if (popState.keyH) {
      document.removeEventListener("keydown", popState.keyH);
      popState.keyH = null;
    }
    if (popState.downH) {
      document.removeEventListener("pointerdown", popState.downH, true);
      popState.downH = null;
    }
  }
  function makePreview(root, tz) {
    if (popState.retireTimer) {
      clearTimeout(popState.retireTimer);
      popState.retireTimer = null;
    }
    const panelTexts = zoneTexts(tz, tz, false);
    return {
      // expectedTs set = frame is the pending slot's ghost: shown blurred and
      // captioned as the last frame, never as the expected one. tt: the
      // source's time text (zoneTexts), the panel's when omitted
      open(site, kiosk, frame, x, y, hiUrl, expectedTs, tt, player) {
        tt = tt || panelTexts;
        closePreview();
        if (player && !expectedTs) {
          openPlayer(root, site, kiosk, frame, x, y, { ...player, tt, label: site ? site + " / " + kiosk : kiosk });
          return;
        }
        const el = document.createElement("div");
        el.className = "ktl-pop" + (expectedTs ? " ghost" : "");
        copyVars(root, el);
        el.innerHTML = '<img alt="frame"><div class="cap"></div>';
        const img = el.querySelector("img");
        el.querySelector(".cap").textContent = (site ? site + " / " : "") + kiosk + " \u2014 " + (expectedTs ? "expected " + tt.short(expectedTs) + " \xB7 last frame " + tt.time(frame.ts) : tt.time(frame.ts)) + tt.sfx(frame.ts);
        el.addEventListener("click", closePreview);
        document.body.appendChild(el);
        const place = () => {
          if (!el.isConnected) {
            return;
          }
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
          if (e.key === "Escape") {
            closePreview();
          }
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
  function openPlayer(root, site, kiosk, frame, x, y, ctx) {
    const el = document.createElement("div");
    el.className = "ktl-pop";
    copyVars(root, el);
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", site ? site + " / " + kiosk : kiosk);
    document.body.appendChild(el);
    let placed = false;
    const place = () => {
      if (!el.isConnected) {
        return;
      }
      const r = el.getBoundingClientRect();
      if (placed && r.right <= window.innerWidth && r.bottom <= window.innerHeight) {
        return;
      }
      placed = true;
      el.style.left = Math.max(8, Math.min(window.innerWidth - r.width - 8, x - r.width / 2)) + "px";
      el.style.top = Math.max(8, Math.min(window.innerHeight - r.height - 8, y + 16)) + "px";
    };
    popState.teardown = mountPlayer(el, frame, ctx, place);
    el.querySelector('button[data-a="close"]')?.addEventListener("click", closePreview);
    place();
    popState.el = el;
    popState.keyH = (e) => {
      if (e.key === "Escape") {
        closePreview();
      }
    };
    document.addEventListener("keydown", popState.keyH);
    popState.downH = (e) => {
      if (!el.contains(e.target)) {
        closePreview();
      }
    };
    setTimeout(() => {
      if (popState.el === el && popState.downH) {
        document.addEventListener("pointerdown", popState.downH, true);
      }
    }, 0);
  }

  // src/vt/ui/wrapper.ts
  function makeWrapper(root) {
    const wrap = document.createElement("div");
    wrap.className = "ktl";
    root.style.position = "relative";
    root.classList.add("ktl-root");
    wrap.style.position = "absolute";
    wrap.style.inset = "0";
    wrap.style.visibility = "hidden";
    root.appendChild(wrap);
    return wrap;
  }
  async function revealWrapper(root, wrap, loaded) {
    const imgs = [...wrap.querySelectorAll("img")];
    await Promise.race([
      Promise.allSettled([
        ...imgs.map((i) => i.decode ? i.decode().catch(() => {
        }) : Promise.resolve()),
        loaded || Promise.resolve()
      ]),
      new Promise((res) => setTimeout(res, 900))
    ]);
    if (!wrap.isConnected || wrap.dataset.stale) {
      return;
    }
    for (const el of [...root.children]) {
      if (el !== wrap) {
        el.remove();
      }
    }
    wrap.style.visibility = "";
  }
  function retireWrapper(wrap) {
    wrap.dataset.stale = "1";
    setTimeout(() => wrap.remove(), 1500);
  }
  function q(wrap, sel) {
    return wrap.querySelector(sel);
  }

  // src/vt/zones/chip.ts
  function zoneChip(srcTZ) {
    return srcTZ ? '<span class="st tz"><span class="tzc"></span><span class="tzo"></span></span>' : "";
  }
  function attachZoneChip(z, host) {
    z.el = host.querySelector(".tz");
    if (!z.el) {
      return;
    }
    z.el.querySelector(".tzc").textContent = z.texts.label;
    z.offEl = z.el.querySelector(".tzo");
  }
  function dressZoneChip(z, ts) {
    if (!z.el) {
      return;
    }
    const o = z.texts.off(ts);
    if (o === z.off) {
      return;
    }
    z.off = o;
    z.offEl.textContent = o ? " \xB7 " + o : "";
    z.el.title = "Source time zone: " + z.texts.zone + (o ? " (" + o + " from panel time)" : " (same as panel time)");
  }

  // src/vt/timeline/cursor.ts
  function restoreCursor(root, P) {
    const saved = Number(root.dataset.ktlCursor);
    if (root.dataset.ktlPinned === "1" && Number.isFinite(saved)) {
      return Math.max(P.from, Math.min(P.to, saved));
    }
    return Math.min(P.to, Date.now());
  }
  function showSelection(s, fa, fb) {
    const a = Math.min(fa, fb), b = Math.max(fa, fb);
    const widths = s.kiosks.map((k) => s.cards[k.id] ? s.cards[k.id].strip.clientWidth : 0);
    s.kiosks.forEach((k, i) => {
      const c = s.cards[k.id];
      if (!c) {
        return;
      }
      const w = widths[i];
      c.sel.style.display = "block";
      c.sel.style.left = a * w + "px";
      c.sel.style.width = (b - a) * w + "px";
    });
  }
  function hideSelection(s) {
    for (const k of s.kiosks) {
      if (s.cards[k.id]) {
        s.cards[k.id].sel.style.display = "none";
      }
    }
  }
  function setCursor(s, t, hoveredCard, external) {
    s.cursorT = Math.max(s.P.from, Math.min(s.P.to, t));
    s.root.dataset.ktlCursor = String(s.cursorT);
    if (!external) {
      s.root.dataset.ktlPinned = "1";
    }
    if (s.cfg.onCursor) {
      s.cfg.onCursor(s.cursorT);
    }
    const frac = (s.cursorT - s.P.from) / s.SPAN;
    const axis = q(s.wrap, ".axis"), ac = q(s.wrap, ".acur");
    const acW = ac.offsetWidth || 50;
    const axisW = axis.clientWidth;
    const widths = /* @__PURE__ */ new Map();
    for (const k of s.kiosks) {
      const c = s.cards[k.id];
      if (c) {
        widths.set(k.id, { w: c.strip.clientWidth, magW: c.mag.offsetWidth || c.strip.clientHeight * 16 / 9 });
      }
    }
    ac.textContent = fmtTime(s.cursorT, s.TZ);
    const acX = Math.max(acW / 2, Math.min(axisW - acW / 2, frac * axisW));
    ac.style.left = acX + "px";
    for (const l of s.axisLabels) {
      l.el.classList.toggle("under-cursor", Math.abs(l.frac * axisW - acX) < l.half + acW / 2 + 2);
    }
    for (const k of s.kiosks) {
      const c = s.cards[k.id];
      if (!c) {
        continue;
      }
      const { w, magW } = widths.get(k.id);
      if (!external && c.card.classList.contains("hovered") !== (hoveredCard === c.card)) {
        c.card.classList.toggle("hovered", hoveredCard === c.card);
      }
      const x = frac * w;
      c.cross.style.left = x + "px";
      const slot = c.model.slotAt(s.cursorT);
      const tt = c.tt;
      if (c.zone.el) {
        dressZoneChip(c.zone, s.cursorT);
      }
      const magL = Math.max(0, Math.min(w - magW, x - magW / 2));
      c.mag.style.left = magL + "px";
      if (magW > 0 && magW < MAG_CAP_ROOM + 4) {
        c.mag.style.setProperty("--cap-lo", -(magL + magW / 2) + "px");
        c.mag.style.setProperty("--cap-hi", w - magL - magW / 2 + "px");
      }
      if (external && c.flip && !s.wrap.classList.contains("strip-hover")) {
        c.flip.stop();
      }
      if (c.flip?.playing()) {
        continue;
      }
      const many = !!(slot && slot.frame && !slot.paused && !slot.beyond && slot.count > 1 && c.card.classList.contains("hovered"));
      const base = shownKey(slot);
      const key = base === null ? null : base + (many ? ":n" : "");
      if (key !== null && key === c.shown) {
        continue;
      }
      c.shown = key;
      c.mag.classList.remove("ghost");
      if (slot && slot.frame) {
        c.mag.classList.remove("gap", "future", "off");
        clearPauseClasses(c.mag);
        setSrc(c.mag.querySelector("img"), slot.frame.url);
        setText(c.mag.querySelector(".cap"), tt.time(slot.frame.ts) + tt.sfx(slot.frame.ts) + (many ? " \xB7 " + slot.count + " frames" : ""));
        setText(c.head, "");
        c.head.classList.remove("stale");
        clearPauseClasses(c.head);
      } else if (slot && slot.paused) {
        const pi = pauseInfo(slot);
        c.mag.classList.remove("gap", "future", "off");
        clearPauseClasses(c.mag);
        addPauseClasses(c.mag, slot);
        setText(c.mag.querySelector(".cap"), pi.label.toLowerCase());
        setText(c.head, pi.label.toLowerCase());
        c.head.classList.remove("stale");
        clearPauseClasses(c.head);
        addPauseClasses(c.head, slot);
      } else if (slot && slot.beyond) {
        c.mag.classList.remove("gap", "future");
        clearPauseClasses(c.mag);
        c.mag.classList.add("off");
        setText(c.head, "");
        c.head.classList.remove("stale");
        clearPauseClasses(c.head);
      } else if (slot && slot.future) {
        const inFlight = slot.ts <= Date.now();
        const g = ghostFor(c.model.slots, slot);
        c.mag.classList.remove("gap", "off");
        clearPauseClasses(c.mag);
        c.mag.classList.add("future");
        if (g) {
          c.mag.classList.add("ghost");
          setSrc(c.mag.querySelector("img"), g.url);
        }
        const iv = c.model.intervalAt(slot.ts);
        const due = iv && iv.kind === "pending" ? iv.from : slot.ts;
        setText(c.mag.querySelector(".cap"), (inFlight ? "expected \u2014 " : "upcoming \u2014 ") + tt.short(due) + (g ? " \xB7 last frame " + tt.time(g.ts) : "") + tt.sfx(due));
        setText(c.head, inFlight ? "expected" : "upcoming");
        c.head.classList.remove("stale");
        clearPauseClasses(c.head);
      } else {
        c.mag.classList.add("gap");
        c.mag.classList.remove("future", "off");
        clearPauseClasses(c.mag);
        const i = slot ? c.model.slots.indexOf(slot) : c.model.slots.length - 1;
        let last = null;
        for (let j = i; j >= 0; j--) {
          if (c.model.slots[j].frame) {
            last = c.model.slots[j].frame;
            break;
          }
        }
        const nodata = !!(slot && !slot.paused && !slot.beyond && slot.nodata);
        const msg = last ? (nodata ? "no frame \u2014 last seen " : "offline \u2014 last seen ") + tt.time(last.ts) + tt.sfx(last.ts) : "no data in window";
        setText(c.mag.querySelector(".cap"), msg);
        setText(c.head, msg);
        c.head.classList.add("stale");
        c.mag.classList.toggle("nodata", nodata);
        c.head.classList.toggle("nodata", nodata);
        clearPauseClasses(c.head);
      }
    }
    if (!external && s.cfg.onHover) {
      s.cfg.onHover(s.cursorT);
    }
  }
  function shownKey(slot) {
    if (!slot) {
      return "g:none";
    }
    if (slot.frame) {
      return "f:" + slot.frame.ts + ":" + slot.frame.url;
    }
    if (slot.paused) {
      return "p:" + slot.ts + ":" + (slot.reason ?? "") + ":" + String(slot.intended);
    }
    if (slot.beyond) {
      return "b";
    }
    if (slot.future) {
      return null;
    }
    return "g:" + slot.ts;
  }
  function setText(el, text) {
    if (el.textContent !== text) {
      el.textContent = text;
    }
  }
  function setSrc(img, url) {
    if (img.getAttribute("src") !== url) {
      img.src = url;
    }
  }

  // src/vt/time/measure.ts
  function measureTickWidth(axis, text) {
    const probe = document.createElement("div");
    probe.className = "tick";
    probe.style.visibility = "hidden";
    probe.textContent = text;
    axis.appendChild(probe);
    const w = probe.getBoundingClientRect().width;
    probe.remove();
    return w;
  }

  // src/vt/timeline/axis.ts
  function buildAxis(s) {
    const axis = q(s.wrap, ".axis");
    const w = axis.clientWidth;
    const { from, to } = s.P;
    const host = s.cfg.axisFormat;
    const tickStep = pickTickStep(from, to, w, (text) => measureTickWidth(axis, text), s.TZ, host);
    const fmt = tickFormat(tickStep, to - from, s.TZ, host);
    axis.querySelectorAll(".tick").forEach((t) => t.remove());
    s.axisTickList.length = 0;
    s.axisLabels.length = 0;
    const placed = [];
    for (const ts of axisTicks(from, to, tickStep, s.TZ)) {
      s.axisTickList.push(ts);
      const el = document.createElement("div");
      el.className = "tick";
      const x = (ts - from) / s.SPAN * w;
      el.style.left = (x / w * 100).toFixed(3) + "%";
      el.textContent = fmt(ts);
      axis.appendChild(el);
      placed.push({ el, x });
    }
    const widths = placed.map((p) => p.el.getBoundingClientRect().width);
    placed.forEach((p, i) => {
      const half = widths[i] / 2;
      if (p.x - half < 0 || p.x + half > w) {
        p.el.classList.add("edge");
      } else {
        s.axisLabels.push({ el: p.el, frac: p.x / w, half });
      }
    });
  }
  function ruleBeyond(s, sl) {
    if (!sl || !sl.beyond || !sl.el) {
      return;
    }
    sl.el.querySelectorAll(".bt").forEach((t) => t.remove());
    for (const ts of s.axisTickList) {
      if (ts <= sl.ts || ts > sl.ts + sl.span) {
        continue;
      }
      const t = document.createElement("div");
      t.className = "bt";
      t.style.left = ((ts - sl.ts) / sl.span * 100).toFixed(3) + "%";
      sl.el.appendChild(t);
    }
  }
  function ruleAllBeyond(s) {
    for (const k of s.kiosks) {
      const c = s.cards[k.id];
      if (!c) {
        continue;
      }
      const last = c.model.slots[c.model.slots.length - 1];
      if (last && last.beyond) {
        ruleBeyond(s, last);
      }
    }
  }

  // src/vt/ui/ghost.ts
  function dressGhost(slots, sl) {
    if (!sl.el) {
      return;
    }
    const g = sl.future && !sl.frame ? ghostFor(slots, sl) : null;
    let img = sl.el.querySelector("img.ghost");
    if (!g) {
      if (img) {
        img.remove();
      }
      return;
    }
    if (!img) {
      img = document.createElement("img");
      img.className = "ghost";
      img.alt = "";
      sl.el.appendChild(img);
    }
    if (img.src !== g.url) {
      img.src = g.url;
    }
  }

  // src/vt/ui/playerContext.ts
  var PLAYER_BUCKETS = 800;
  function playerContext(backend, cfg, P, decl, model, tt, onTime) {
    return {
      window: { from: P.from, to: P.to },
      step: model.step,
      tt,
      fetch: (from, to) => backend.allFrames ? backend.allFrames(decl.site, decl.id, from, to) : backend.frames(decl.site, decl.id, from, to, Math.max(model.lastActive?.cadence ?? model.step, Math.ceil((to - from) / PLAYER_BUCKETS))),
      ...backend.detail ? { detail: (from, to) => backend.detail(decl.site, decl.id, from, to) } : {},
      intervals: (frames, range) => model.intervalsFor(frames, range, Date.now()),
      // the strip's own slots, so the player's slots are the ones on screen
      slotAt: (t) => {
        const sl = model.slotAt(t);
        return sl ? { from: sl.x0, to: sl.x0 + sl.span, ts: sl.ts, ...sl.frame ? { frameTs: sl.frame.ts } : {} } : null;
      },
      onTime,
      scrubber: cfg.playerScrubber === "thumbs" ? "thumbs" : cfg.playerScrubber === "ticks" ? "ticks" : void 0
    };
  }

  // src/vt/timeline/flipbook.ts
  var DWELL_MS = 3e3;
  var FLIP_FPS = 4;
  function makeFlipbook(target, anySlot = false) {
    let current = null;
    let dwell = null;
    let timer = null;
    let seq = 0;
    function halt() {
      seq++;
      if (dwell) {
        clearTimeout(dwell);
        dwell = null;
      }
      if (timer) {
        clearInterval(timer);
        timer = null;
        target.playingChanged(false);
      }
    }
    async function start(sl) {
      const mine = ++seq;
      let frames = [];
      try {
        frames = await target.frames(sl.x0, sl.x0 + sl.span);
      } catch {
        return;
      }
      if (mine !== seq || !current || current.x0 !== sl.x0) {
        return;
      }
      frames = frames.filter((f) => f.ts >= sl.x0 && f.ts < sl.x0 + sl.span).sort((a, b) => a.ts - b.ts);
      if (frames.length < 2) {
        return;
      }
      const preload = (i2) => {
        for (let k = 1; k <= 3; k++) {
          const p = new Image();
          p.src = frames[(i2 + k) % frames.length].url;
        }
      };
      let i = 0;
      target.playingChanged(true);
      target.show(frames[0], 0, frames.length);
      preload(0);
      timer = setInterval(() => {
        i = (i + 1) % frames.length;
        target.show(frames[i], i, frames.length);
        preload(i);
      }, 1e3 / FLIP_FPS);
    }
    return {
      hover(slot) {
        const sl = slot && !slot.paused && !slot.beyond && (slot.count > 1 || anySlot && slot.frame) ? slot : null;
        if (sl === current || sl && current && sl.x0 === current.x0 && sl.ts === current.ts) {
          return;
        }
        halt();
        current = sl;
        if (sl) {
          dwell = setTimeout(() => {
            dwell = null;
            void start(sl);
          }, DWELL_MS);
        }
      },
      stop() {
        halt();
        current = null;
      },
      playing: () => timer !== null
    };
  }

  // src/vt/timeline/card.ts
  function dressStrip(model) {
    for (const sl of model.slots) {
      if (!sl.el || sl.frame) {
        continue;
      }
      sl.el.style.backgroundPosition = -sl.el.offsetLeft + "px 0";
      if (sl.paused && sl.el.offsetWidth >= 90 && !sl.el.querySelector(".band-label")) {
        const lab = document.createElement("span");
        lab.className = "band-label";
        lab.textContent = pauseInfo(sl).label;
        sl.el.appendChild(lab);
      }
    }
  }
  function dressAll(s, tries) {
    const anySized = s.kiosks.some((k) => s.cards[k.id] && s.cards[k.id].strip.clientWidth > 0);
    if (!anySized) {
      if (tries > 0 && !s.destroyed) {
        setTimeout(() => dressAll(s, tries - 1), 500);
      }
      return;
    }
    for (const k of s.kiosks) {
      if (s.cards[k.id]) {
        dressStrip(s.cards[k.id].model);
      }
    }
  }
  function renderStrip(s, model, strip, kiosk, tt) {
    const cells = [];
    for (const sl of model.slots) {
      const key = sl.frame ? "f:" + sl.frame.ts + ":" + sl.frame.url : sl.paused ? "p:" + sl.x0 : sl.beyond ? "b" : (sl.future ? "u:" : sl.nodata ? "n:" : "g:") + sl.x0;
      const last = cells[cells.length - 1];
      if (sl.frame && last && last.key === key) {
        last.slots.push(sl);
      } else {
        cells.push({ key, slots: [sl] });
      }
    }
    const old = strip.__cells ??= /* @__PURE__ */ new Map();
    const next = /* @__PURE__ */ new Map();
    const before = strip.querySelector(".drops");
    for (const cell of cells) {
      const sl = cell.slots[0];
      let el = old.get(cell.key);
      const fresh = !el;
      if (!el) {
        el = document.createElement("div");
      }
      old.delete(cell.key);
      next.set(cell.key, el);
      const cls = "slot" + slotClass(sl) + (cell.slots.some((x) => !x.paused && !x.beyond && x.count > 1) ? " multi" : "");
      if (el.className !== cls) {
        el.className = cls;
      }
      const span = cell.slots.reduce((a, x) => a + x.span, 0);
      el.style.flexGrow = String(span / 1e3);
      if (sl.paused) {
        const pi = pauseInfo(sl);
        el.title = pi.label.toLowerCase();
        if (pi.color) {
          el.style.setProperty("--ktl-band", pi.color);
        }
      }
      if (sl.frame && fresh) {
        const img = document.createElement("img");
        img.alt = kiosk + " " + tt.time(sl.frame.ts) + tt.sfx(sl.frame.ts);
        el.appendChild(img);
        s.images.add(img, sl.frame.url, sl.frame.ts);
      }
      for (const x of cell.slots) {
        x.el = el;
      }
      strip.insertBefore(el, before);
    }
    for (const el of old.values()) {
      el.remove();
    }
    strip.__cells = next;
    strip.classList.toggle("sep", s.hostWidth / Math.max(1, cells.length) >= 12);
    for (const sl of model.slots) {
      if (sl.future) {
        dressGhost(model.slots, sl);
      }
    }
    let drops = strip.querySelector(".drops");
    if (model.drops.length && !drops) {
      drops = document.createElement("div");
      drops.className = "drops";
      strip.appendChild(drops);
    }
    if (drops) {
      drops.textContent = "";
      for (const d of model.drops) {
        const m = document.createElement("div");
        m.className = "drop";
        m.style.left = ((d.from - s.P.from) / s.SPAN * 100).toFixed(4) + "%";
        m.style.width = ((d.to - d.from) / s.SPAN * 100).toFixed(4) + "%";
        drops.appendChild(m);
      }
    }
    const tail = model.slots[model.slots.length - 1];
    if (tail && tail.beyond) {
      ruleBeyond(s, tail);
    }
  }
  function buildCard(s, decl, model) {
    const kiosk = decl.id;
    const zone = zoneFor(decl, s.TZ, s.cfg.thumbTimes, s.PANEL_TT), tt = zone.tt;
    const card = document.createElement("div");
    const inline = s.cfg.headerMode === "inline" || s.cfg.headerMode === "inline-gradient";
    card.className = "card" + (inline ? " inline-head" : "") + (s.cfg.headerMode === "inline-gradient" ? " inline-grad" : "");
    const la = model.lastActive;
    const cad = s.cfg.showDetails && la ? '<span class="cad" title="' + esc(model.promised ? "Promises a frame every " + fmtDur(la.cadence) + "; one slot per " + fmtDur(la.step) : "Promises no cadence: frames are typically " + fmtDur(la.cadence) + " apart; one slot per " + fmtDur(la.step)) + '">\u23F1 ' + (model.promised ? "" : "~") + fmtDur(la.cadence) + " \xB7 1/" + fmtDur(la.step) + (la.step > la.cadence ? " \u2193" : "") + (model.promised ? "" : " \xB7 no promise") + "</span>" : "";
    card.innerHTML = '<div class="card-head" title="' + esc(headTitle(decl)) + '"><span class="nm"' + filterAttrs("host", kiosk, !!s.cfg.onFilter) + ">" + esc(kiosk) + '</span><span class="inline-brk"></span>' + zoneChip(zone.srcTZ) + headChips(decl, s.cfg.chips, !!s.cfg.onFilter) + '<span class="ft"></span>' + cad + '</div><div class="strip"><div class="xh"></div><div class="sel"></div><div class="mag"><img alt=""><div class="cap"></div></div></div><div class="card-lane"></div>';
    const strip = card.querySelector(".strip");
    renderStrip(s, model, strip, kiosk, tt);
    dressStrip(model);
    let rec = null;
    const fetchAll = playerContext(s.backend, s.cfg, s.P, decl, model, tt, () => {
    }).fetch;
    const flip = makeFlipbook({
      // a slot's frames: asked again at full resolution where the backend can
      // (the panel re-runs its query), else the frames the model holds
      frames: (from, to) => s.backend.detail ? s.backend.detail(decl.site, decl.id, from, to) : model.frames.length && s.backend.allFrames ? Promise.resolve(model.frames.filter((f) => f.ts >= from && f.ts < to)) : fetchAll(from, to),
      show: (f, i, n) => {
        const m = rec?.mag;
        if (!m) {
          return;
        }
        const im = m.querySelector("img");
        if (im.getAttribute("src") !== f.url) {
          im.src = f.url;
        }
        m.querySelector(".cap").textContent = tt.time(f.ts) + tt.sfx(f.ts) + " \xB7 " + (i + 1) + "/" + n;
      },
      playingChanged: (on) => {
        if (!rec) {
          return;
        }
        rec.mag.classList.toggle("flip", on);
        if (!on && !s.destroyed) {
          rec.shown = null;
          setCursor(s, s.cursorT, null, true);
        }
      }
    }, !!s.backend.detail);
    const hoverAt = (e) => {
      const r = strip.getBoundingClientRect();
      if (!r.width) {
        return;
      }
      const t = s.P.from + s.SPAN * ((e.clientX - r.left) / r.width);
      setCursor(s, t, card, false);
      flip.hover(model.slotAt(s.cursorT));
    };
    strip.addEventListener("mousemove", hoverAt);
    strip.addEventListener("mouseenter", (e) => {
      s.wrap.classList.add("strip-hover");
      hoverAt(e);
    });
    strip.addEventListener("mouseleave", () => {
      flip.stop();
      s.wrap.classList.remove("strip-hover");
      if (s.cfg.onHoverClear) {
        s.cfg.onHoverClear();
      }
    });
    strip.addEventListener("click", (e) => {
      flip.stop();
      if (s.suppressClick) {
        s.suppressClick = false;
        return;
      }
      const sl = model.slotAt(s.cursorT);
      const f = sl && sl.frame;
      const g = !f && sl && sl.future ? ghostFor(model.slots, sl) : null;
      if (f) {
        const player = playerContext(s.backend, s.cfg, s.P, decl, model, tt, (t) => {
          if (!s.destroyed) {
            setCursor(s, t, null, false);
          }
        });
        s.pv.open(decl.site, kiosk, f, e.clientX, e.clientY, f.hi ?? null, null, tt, player);
      } else if (g) {
        s.pv.open(decl.site, kiosk, g, e.clientX, e.clientY, null, sl.ts, tt);
      }
    });
    const magEl = card.querySelector(".mag");
    const magImg = magEl.querySelector("img");
    magImg.addEventListener("load", () => {
      if (magImg.naturalWidth && magImg.naturalHeight) {
        magEl.style.aspectRatio = String(magImg.naturalWidth / magImg.naturalHeight);
      }
    });
    strip.addEventListener("mousedown", (e) => {
      if (e.button !== 0) {
        return;
      }
      flip.stop();
      e.preventDefault();
      const r = strip.getBoundingClientRect();
      const fracOf = (x) => Math.max(0, Math.min(1, (x - r.left) / r.width));
      const f0 = fracOf(e.clientX);
      let dragged = false;
      const move = (ev) => {
        if (s.destroyed) {
          return up(ev);
        }
        const f1 = fracOf(ev.clientX);
        if (Math.abs(f1 - f0) * r.width > 5) {
          dragged = true;
        }
        if (dragged) {
          showSelection(s, f0, f1);
          setCursor(s, s.P.from + s.SPAN * f1, card, false);
        }
      };
      const up = (ev) => {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
        hideSelection(s);
        if (dragged && !s.destroyed) {
          s.suppressClick = true;
          const f1 = fracOf(ev.clientX);
          const a = Math.min(f0, f1), b = Math.max(f0, f1);
          if (b > a && s.cfg.onZoom) {
            s.cfg.onZoom(Math.round(s.P.from + s.SPAN * a), Math.round(s.P.from + s.SPAN * b));
          }
        }
      };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    });
    q(s.wrap, ".cards").appendChild(card);
    attachZoneChip(zone, card);
    rec = {
      card,
      model,
      zone,
      tt,
      flip,
      head: card.querySelector(".ft"),
      strip,
      cross: card.querySelector(".xh"),
      sel: card.querySelector(".sel"),
      mag: card.querySelector(".mag"),
      lane: card.querySelector(".card-lane")
    };
    return rec;
  }

  // src/vt/timeline/annotations.ts
  function renderAnnotations(s, anns) {
    const tip = annTip();
    const fracOf = (t) => (Math.max(s.P.from, Math.min(s.P.to, t)) - s.P.from) / s.SPAN;
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
        if (g && (fracOf(a.ts) - fracOf(g[0].ts)) * s.hostWidth < 10) {
          g.push(a);
        } else {
          groups.push([a]);
        }
      }
      for (const g of groups) {
        const el = document.createElement("div");
        el.className = "ann" + (g.length > 1 ? " multi" : "");
        el.style.left = pct(fracOf(g[0].ts));
        if (g[0].color) {
          el.style.background = g[0].color;
        }
        el.title = "";
        if (g.length > 1) {
          const n = document.createElement("span");
          n.className = "n";
          n.textContent = String(g.length);
          el.appendChild(n);
        }
        el.addEventListener("mouseenter", () => {
          const r = el.getBoundingClientRect();
          tip.show(g, r.left + r.width / 2, r.top, el, s.TZ);
        });
        el.addEventListener("mouseleave", () => tip.hide());
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          const r = el.getBoundingClientRect();
          tip.pin(g, r.left + r.width / 2, r.top, el, s.TZ);
        });
        host.appendChild(el);
      }
    }
    const appliesTo = (a, k) => (!a.source || a.source === k.id) && (!a.siteScope || a.siteScope === k.site);
    const isGlobal = (a) => !a.source && !a.siteScope;
    if (s.cfg.annotationLanes === "per-source") {
      for (const k of s.kiosks) {
        const c = s.cards[k.id];
        const items = anns.filter((a) => appliesTo(a, k));
        if (!items.length) {
          continue;
        }
        c.card.classList.add("has-lane");
        for (const a of items) {
          if (a.timeEnd) {
            addRegion(c.strip, a);
            addRegion(c.lane, a);
          }
        }
        addMarkers(c.lane, items);
      }
      return;
    }
    const laneItems = [], perCard = {};
    for (const a of anns) {
      if (isGlobal(a)) {
        laneItems.push(a);
      } else {
        for (const k of s.kiosks) {
          if (appliesTo(a, k)) {
            (perCard[k.id] ||= []).push(a);
          }
        }
      }
      if (a.timeEnd) {
        const hosts = isGlobal(a) ? s.kiosks.map((k) => s.cards[k.id].strip).concat([q(s.wrap, ".ann-lane")]) : s.kiosks.filter((k) => appliesTo(a, k)).map((k) => s.cards[k.id].strip);
        for (const h of hosts) {
          addRegion(h, a);
        }
      }
    }
    for (const [id, items] of Object.entries(perCard)) {
      addMarkers(s.cards[id].strip, items);
    }
    if (laneItems.length) {
      addMarkers(q(s.wrap, ".ann-lane"), laneItems);
    }
    if (laneItems.length || anns.some((a) => a.timeEnd && isGlobal(a))) {
      q(s.wrap, ".ann-lane").style.display = "";
    }
  }

  // src/vt/timeline/poll.ts
  function startPoll(s) {
    const steps = s.kiosks.map((k) => s.cards[k.id]?.model.step).filter((x) => !!x);
    const minStep = steps.length ? Math.min(...steps) : 6e4;
    let busy = false;
    s.pollTimer = setInterval(async () => {
      if (busy) {
        return;
      }
      busy = true;
      try {
        await pollOnce(s);
      } finally {
        busy = false;
      }
    }, Math.min(minStep, 1e4));
  }
  async function pollOnce(s) {
    for (const k of s.kiosks) {
      const c = s.cards[k.id];
      if (!c) {
        continue;
      }
      const m = c.model;
      const last = m.frames.length ? m.frames[m.frames.length - 1].ts : s.P.from;
      let fresh;
      try {
        const from = Math.max(last, s.P.from) + 1, to = Math.min(s.P.to, Date.now());
        fresh = s.backend.allFrames ? await s.backend.allFrames(k.site, k.id, from, to) : await s.backend.frames(k.site, k.id, from, to, m.step);
      } catch (e) {
        console.warn("[visual-timeline] live poll failed for " + k.id + ":", e);
        continue;
      }
      if (s.destroyed) {
        return;
      }
      m.refresh(fresh, Date.now());
      renderStrip(s, m, c.strip, k.id, c.tt);
      if (c.strip.clientWidth > 0) {
        dressStrip(m);
      }
      c.shown = null;
    }
  }

  // src/vt/timeline/mount.ts
  function mountTimeline(root, cfg) {
    injectStyles();
    const P = { site: parseVar(cfg.site), source: parseVar(cfg.source), from: cfg.from, to: cfg.to };
    const TZ = resolveTimeZone(cfg.timeZone);
    const SPAN = Math.max(1, P.to - P.from);
    const LIVE = P.to > Date.now() - 2 * 60 * 1e3;
    const MIN_SLICE_PX = 7;
    const hostWidth = cfg.width || root.clientWidth || 800;
    const pxBudget = Math.max(10, Math.floor((hostWidth - 20) / MIN_SLICE_PX));
    const backend = cfg.backend ?? (cfg.apiUrl || cfg.apiFetch ? makeApiBackend(cfg.apiUrl, cfg.apiKey, cfg.apiFetch) : makeBackend(P, SPAN, TZ));
    const wrap = makeWrapper(root);
    wireFilters(wrap, cfg.onFilter);
    wrap.classList.toggle("fill", cfg.fit === "fill");
    wrap.innerHTML = '<div class="cards"></div><div class="ann-lane" style="display:none"></div><div class="axis"><div class="base"></div><div class="acur"></div></div>';
    const s = {
      root,
      cfg,
      P,
      TZ,
      SPAN,
      LIVE,
      hostWidth,
      pxBudget,
      backend,
      wrap,
      kiosks: [],
      cards: {},
      cursorT: restoreCursor(root, P),
      destroyed: false,
      pollTimer: null,
      axisTickList: [],
      // filled by buildAxis; consumed by ruleBeyond
      axisLabels: [],
      suppressClick: false,
      pv: makePreview(root, TZ),
      images: makeImageQueue(),
      PANEL_TT: zoneTexts(TZ, TZ, false)
    };
    (async function boot() {
      try {
        s.kiosks = (await backend.kiosks(P.site)).filter((k) => !P.source || P.source.includes(k.id)).filter((k) => matchesTags(k.tags, parseTagFilter(cfg.tagFilter)));
      } catch (e) {
        console.warn("[visual-timeline] sources fetch failed:", e);
        if (s.destroyed) {
          return;
        }
        const err = document.createElement("div");
        err.className = "boot-err";
        err.textContent = bootErrorText(e, cfg.authHint);
        q(s.wrap, ".cards").appendChild(err);
        await revealWrapper(root, wrap);
        return;
      }
      const models = limited(s.kiosks, MODEL_CONCURRENCY, (k) => s.destroyed ? Promise.resolve(null) : buildSourceModel(k, P, backend, pxBudget, { hold: s.cfg.hold, expected: s.cfg.expectedCadence }).catch((e) => {
        console.warn("[visual-timeline] model build failed for " + k.id + ":", e);
        return null;
      }));
      for (const [i, k] of s.kiosks.entries()) {
        const model = await models[i];
        if (s.destroyed) {
          return;
        }
        if (!model) {
          continue;
        }
        if (cfg.hideEmpty && !model.slots.some((sl) => sl.frame || sl.paused)) {
          continue;
        }
        s.cards[k.id] = buildCard(s, k, model);
      }
      s.kiosks = s.kiosks.filter((k) => s.cards[k.id]);
      buildAxis(s);
      ruleAllBeyond(s);
      const rawAnns = cfg.annotations && cfg.annotations.length ? cfg.annotations : backend.annotations ? backend.annotations() : [];
      if (cfg.showAnnotations !== false) {
        renderAnnotations(s, normAnnotations(rawAnns, P));
      }
      setCursor(s, s.cursorT, null, true);
      await revealWrapper(root, wrap, s.images.idle());
      if (s.destroyed) {
        return;
      }
      dressAll(s, 20);
      if (LIVE) {
        startPoll(s);
      }
    })();
    return {
      setExternalCursor(t) {
        if (!s.destroyed) {
          setCursor(s, t, null, true);
        }
      },
      isHovering() {
        return wrap.classList.contains("strip-hover");
      },
      destroy() {
        s.destroyed = true;
        s.images.stop();
        if (s.pollTimer) {
          clearInterval(s.pollTimer);
        }
        s.pv.retire();
        annTip().close();
        retireWrapper(wrap);
      }
    };
  }

  // src/vt/grid/tile.ts
  function buildTile(s, decl, model) {
    const el = document.createElement("div");
    const zone = zoneFor(decl, s.TZ, s.cfg.thumbTimes, s.PANEL_TT);
    const inline = s.cfg.headerMode === "inline" || s.cfg.headerMode === "inline-gradient";
    el.className = "tile" + (inline ? " inline-head" : "") + (s.cfg.headerMode === "inline-gradient" ? " inline-grad" : "");
    el.innerHTML = '<div class="t-head" title="' + esc(headTitle(decl)) + '"><span class="nm"' + filterAttrs("host", decl.id, !!s.cfg.onFilter) + ">" + esc(decl.id) + '</span><span class="inline-brk"></span>' + zoneChip(zone.srcTZ) + headChips(decl, s.cfg.chips, !!s.cfg.onFilter) + '</div><div class="t-img"><img alt="' + esc(decl.id) + '"><span class="t-ts"></span><div class="t-off"></div></div>';
    attachZoneChip(zone, el);
    const rec = {
      decl,
      model,
      el,
      shown: null,
      zone,
      tt: zone.tt,
      img: el.querySelector("img"),
      ts: el.querySelector(".t-ts"),
      off: el.querySelector(".t-off")
    };
    el.addEventListener("click", (e) => {
      if (rec.shown && rec.shownExpected) {
        s.pv.open(decl.site, decl.id, rec.shown, e.clientX, e.clientY, null, rec.shownExpected, rec.tt);
      } else if (rec.shown) {
        const player = playerContext(s.backend, s.cfg, s.P, decl, model, rec.tt, (t) => {
          if (!s.destroyed) {
            setShown(s, t);
          }
        });
        s.pv.open(decl.site, decl.id, rec.shown, e.clientX, e.clientY, rec.shown.hi ?? null, null, rec.tt, player);
      }
    });
    q(s.wrap, ".grid").appendChild(el);
    return rec;
  }
  function lastFrame(rec) {
    const f = rec.model.frames;
    return f.length ? f[f.length - 1] : null;
  }
  function frameBefore(rec, t) {
    const f = rec.model.frames;
    for (let i = f.length - 1; i >= 0; i--) {
      if (f[i].ts <= t) {
        return f[i];
      }
    }
    return null;
  }
  function setShown(s, t) {
    s.shownT = t;
    if (s.cfg.onShown) {
      s.cfg.onShown(t);
    }
    const live = Math.min(s.P.to, Date.now());
    const zoneAt = t == null ? live : t;
    for (const k of s.kiosks) {
      const rec = s.tiles[k.id];
      if (!rec) {
        continue;
      }
      if (rec.zone.el) {
        dressZoneChip(rec.zone, zoneAt);
      }
      const tt = rec.tt;
      let frame = null, offMsg = null, pausedMsg = null, pausedAt = null, expectedTs = null, nodata = false;
      const at = t == null ? live - 1 : t;
      const iv = rec.model.intervalAt(at);
      let kind = iv ? iv.kind : "nodata";
      const latest = t == null ? lastFrame(rec) : null;
      if (t == null && !s.LIVE && kind !== "paused") {
        kind = latest ? "frame" : "nodata";
      }
      if (t == null && kind === "frame" && latest) {
        frame = latest;
      } else if (kind === "frame") {
        frame = iv.frame;
      } else if (kind === "pending") {
        frame = iv.frame;
        expectedTs = iv.from;
      } else if (kind === "paused") {
        pausedAt = { paused: true, label: iv.pause.label, color: iv.pause.color };
        const last = t == null ? lastFrame(rec) : null;
        pausedMsg = pauseInfo(pausedAt).label + (last ? " \u2014 last frame " + tt.time(last.ts) + tt.sfx(last.ts) : "");
      } else if (kind === "beyond") {
        offMsg = "\u2014";
        nodata = true;
      } else {
        nodata = kind === "nodata";
        const last = frameBefore(rec, at);
        offMsg = last ? (nodata ? "NO FRAME" : "OFFLINE") + " \u2014 last seen " + tt.time(last.ts) + tt.sfx(last.ts) : t == null ? "no data in window" : "no data";
      }
      rec.el.classList.toggle("offline", !!offMsg);
      rec.el.classList.toggle("nodata", !!offMsg && nodata);
      clearPauseClasses(rec.el);
      if (pausedMsg && !offMsg) {
        addPauseClasses(rec.el, pausedAt);
      }
      rec.off.textContent = offMsg || pausedMsg || "";
      rec.el.classList.toggle("ghost", !!expectedTs);
      rec.shown = frame;
      rec.shownExpected = expectedTs;
      if (frame && !offMsg && !pausedMsg) {
        rec.img.src = frame.url;
        rec.ts.textContent = (expectedTs ? "expected " + tt.short(expectedTs) + " \xB7 last " + tt.time(frame.ts) : tt.time(frame.ts)) + tt.sfx(frame.ts);
      }
    }
  }

  // src/vt/grid/poll.ts
  function startPoll2(s) {
    let busy = false;
    s.pollTimer = setInterval(async () => {
      if (busy) {
        return;
      }
      busy = true;
      try {
        await pollOnce2(s);
      } finally {
        busy = false;
      }
    }, 1e4);
  }
  async function pollOnce2(s) {
    for (const k of s.kiosks) {
      const rec = s.tiles[k.id];
      if (!rec) {
        continue;
      }
      const last = lastFrame(rec);
      let fresh;
      try {
        const from = Math.max(last ? last.ts : s.P.from, s.P.from) + 1, to = Math.min(s.P.to, Date.now());
        fresh = s.backend.allFrames ? await s.backend.allFrames(k.site, k.id, from, to) : await s.backend.frames(k.site, k.id, from, to, rec.model.step);
      } catch (e) {
        console.warn("[visual-timeline] live poll failed for " + k.id + ":", e);
        continue;
      }
      if (s.destroyed) {
        return;
      }
      rec.model.refresh(fresh, Date.now());
    }
    setShown(s, s.shownT);
  }

  // src/vt/grid/mount.ts
  function mountGrid(root, cfg) {
    injectStyles();
    const P = { site: parseVar(cfg.site), source: parseVar(cfg.source), from: cfg.from, to: cfg.to };
    const TZ = resolveTimeZone(cfg.timeZone);
    const SPAN = Math.max(1, P.to - P.from);
    const LIVE = P.to > Date.now() - 2 * 60 * 1e3;
    const backend = cfg.backend ?? (cfg.apiUrl || cfg.apiFetch ? makeApiBackend(cfg.apiUrl, cfg.apiKey, cfg.apiFetch) : makeBackend(P, SPAN, TZ));
    const budget = 120;
    const wrap = makeWrapper(root);
    wireFilters(wrap, cfg.onFilter);
    wrap.classList.toggle("fill", cfg.fit === "fill");
    wrap.innerHTML = '<div class="grid"></div>';
    const s = {
      root,
      cfg,
      P,
      TZ,
      SPAN,
      LIVE,
      backend,
      wrap,
      kiosks: [],
      tiles: {},
      destroyed: false,
      pollTimer: null,
      shownT: null,
      pv: makePreview(root, TZ),
      PANEL_TT: zoneTexts(TZ, TZ, false)
    };
    (async function boot() {
      try {
        s.kiosks = (await backend.kiosks(P.site)).filter((k) => !P.source || P.source.includes(k.id)).filter((k) => matchesTags(k.tags, parseTagFilter(cfg.tagFilter)));
      } catch (e) {
        console.warn("[visual-timeline] sources fetch failed:", e);
        if (s.destroyed) {
          return;
        }
        const err = document.createElement("div");
        err.className = "boot-err";
        err.textContent = bootErrorText(e, cfg.authHint);
        q(s.wrap, ".grid").appendChild(err);
        await revealWrapper(root, wrap);
        return;
      }
      const models = limited(s.kiosks, MODEL_CONCURRENCY, (k) => s.destroyed ? Promise.resolve(null) : buildSourceModel(k, P, backend, budget, { hold: s.cfg.hold, expected: s.cfg.expectedCadence }).catch((e) => {
        console.warn("[visual-timeline] model build failed for " + k.id + ":", e);
        return null;
      }));
      for (const [i, k] of s.kiosks.entries()) {
        const model = await models[i];
        if (s.destroyed) {
          return;
        }
        if (!model) {
          continue;
        }
        if (cfg.hideEmpty && !model.slots.some((sl) => sl.frame || sl.paused)) {
          continue;
        }
        s.tiles[k.id] = buildTile(s, k, model);
      }
      s.kiosks = s.kiosks.filter((k) => s.tiles[k.id]);
      setShown(s, null);
      await revealWrapper(root, wrap);
      if (s.destroyed) {
        return;
      }
      if (LIVE) {
        startPoll2(s);
      }
    })();
    return {
      setExternalCursor(t) {
        if (!s.destroyed) {
          setShown(s, Math.max(P.from, Math.min(P.to, t)));
        }
      },
      clearExternal() {
        if (!s.destroyed) {
          setShown(s, null);
        }
      },
      destroy() {
        s.destroyed = true;
        if (s.pollTimer) {
          clearInterval(s.pollTimer);
        }
        s.pv.retire();
        retireWrapper(wrap);
      }
    };
  }
  return __toCommonJS(core_exports);
})();
