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
    const sampled = (p) => {
      const s = input.sample && input.sample > p ? Math.ceil(input.sample / p - 1e-9) * p : p;
      return Math.max(s, input.step ?? 0);
    };
    const promiseAt = (t) => {
      const p = input.promiseOverride && input.promiseOverride > 0 ? input.promiseOverride : declared(t);
      return p && p > 0 ? sampled(p) : null;
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
      return typeof own === "number" && own > 0 ? sampled(own) : promiseAt(f.ts);
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
          push(t, firstTs, p && firstTs - W.from > (1 + tol) * p ? "dropped" : "nodata");
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
    const final = input.clips?.length ? coverWithClips(out, input.clips) : out;
    const inWindow = shown.filter((f) => f.ts <= W.to);
    return {
      intervals: final,
      frames: inWindow,
      at(t) {
        const out2 = final;
        if (!out2.length) {
          return null;
        }
        const x = Math.max(out2[0].from, Math.min(out2[out2.length - 1].to - 1e-6, t));
        let lo = 0, hi = out2.length - 1;
        while (lo < hi) {
          const mid = lo + hi + 1 >> 1;
          if (out2[mid].from <= x) {
            lo = mid;
          } else {
            hi = mid - 1;
          }
        }
        return out2[lo];
      }
    };
  }
  function coverWithClips(ivs, clips) {
    const cs = [...clips].sort((a, b) => a.from - b.from);
    const out = [];
    for (const iv of ivs) {
      if (iv.kind !== "nodata") {
        out.push(iv);
        continue;
      }
      const edges = /* @__PURE__ */ new Set([iv.from, iv.to]);
      for (const c of cs) {
        if (c.to <= iv.from || c.from >= iv.to) {
          continue;
        }
        edges.add(Math.max(c.from, iv.from));
        edges.add(Math.min(c.to, iv.to));
      }
      const xs = [...edges].sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k++) {
        const a = xs[k], b = xs[k + 1];
        const c = [...cs].reverse().find((x) => x.from <= a && x.to >= b);
        const last = out[out.length - 1];
        if (c && last && last.kind === "clip" && last.clip === c && last.to === a) {
          last.to = b;
          continue;
        }
        if (!c && last && last.kind === "nodata" && last.to === a) {
          last.to = b;
          continue;
        }
        out.push(c ? { from: a, to: b, kind: "clip", clip: c } : { from: a, to: b, kind: "nodata" });
      }
    }
    return out;
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
    const closedPaused = eras.slice(0, -1).filter((e) => e.paused).reduce((a, e) => a + (e.to - e.from), 0);
    const activeSpan = Math.max(1, P.to - P.from - closedPaused);
    const step = base * Math.max(1, Math.ceil(activeSpan / base / Math.max(4, budgetSlots)));
    const maxCadence = Math.max(...eras.map((e) => e.cadence));
    const wanted = promised ? 1.5 * maxCadence + step : typeof hold === "number" ? hold : LOOKBACK_UNPROMISED;
    const lookback = Math.min(wanted, LOOKBACK_STEPS * step);
    const now0 = opts.now ?? Date.now();
    const fetched = backend.allFrames ? await backend.allFrames(decl.site, decl.id, P.from - lookback, Math.min(P.to, now0)) : await backend.frames(decl.site, decl.id, P.from - lookback, Math.min(P.to, now0), step);
    const clips0 = backend.clips ? await backend.clips(decl.site, decl.id, P.from - lookback, Math.min(P.to, now0)) : [];
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
      clips: [],
      intervals: [],
      slots: [],
      drops: [],
      lastActive: null,
      slotAt: () => null,
      intervalAt: () => null,
      // frames for a span (the player's), judged at the interval they were
      // asked for at: the span's own (0: every frame), else the panel's
      intervalsFor: (frames, window2, now, sample2, clips) => buildIntervals({
        frames,
        promiseAt,
        pauses,
        hold,
        window: window2,
        now,
        promiseOverride: expected,
        sample: sample2 ?? opts.sample,
        clips: clips ?? model.clips
      }).intervals,
      refresh(fresh, now, clips) {
        if (clips) {
          const byFrom = new Map(model.clips.map((c) => [c.from, c]));
          for (const c of clips) {
            byFrom.set(c.from, c);
          }
          model.clips = [...byFrom.values()].sort((a, b) => a.from - b.from);
        }
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
          promiseOverride: expected,
          sample: opts.sample,
          clips: model.clips
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
    model.refresh(fetched, now0, clips0);
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
        if (!best && at && at.kind === "clip") {
          sl.clip = at.clip;
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
    return sl.paused ? " " + pauseInfo(sl).classes.join(" ") : sl.beyond ? " beyond" : sl.frame ? "" : sl.future ? " future" : sl.clip ? " clip" : sl.nodata ? " gap nodata" : " gap";
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
  function framesPath(site, host, from, to, step) {
    const q2 = new URLSearchParams();
    q2.set("site", site);
    q2.set("source", host);
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
      async frames(site, host, from, to, step) {
        const r = await get(framesPath(site, host, from, to, step));
        if (!r.ok) {
          throw await apiError("frames", r, !!apiFetch);
        }
        const rows = await r.json();
        const decl = decls.get(site + "/" + host);
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
/* cards share panel height equally (fewer hosts \u2192 taller strips), but
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
/* a strip has focus only from the keyboard (a press doesn't focus it) */
.ktl .strip:focus { outline:none; }
/* its keyboard focus ring, drawn over the slots (an outline is painted
 * under the slot images, out of sight) */
.ktl .strip:focus-visible::after { content:""; position:absolute; inset:0; border:2px solid var(--ktl-accent);
  pointer-events:none; z-index:5; }
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
/* video clips (M10c): a slot with no frame that a clip covers is a plain
 * band with a play mark, and a line along the strip's foot shows where the
 * host has video, over frames too */
.ktl .slot.clip { background:var(--ktl-pause-a); }
.ktl .slot.clip::before { content:'\u25B6'; position:absolute; top:50%; left:50%; transform:translate(-50%,-50%);
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
.ktl .mag.flip::after { content:'\u25B6'; position:absolute; top:3px; left:5px; font-size:9px; line-height:1;
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

  // src/vt/ui/frameWidth.ts
  var FRAME_WIDTH = 7;
  var FRAME_WIDTH_MIN = 3;
  var FRAME_WIDTH_MAX = 48;
  function frameWidthOf(cfg) {
    const w = Number(cfg.frameWidth);
    return Number.isFinite(w) && w > 0 ? Math.max(FRAME_WIDTH_MIN, Math.min(FRAME_WIDTH_MAX, Math.round(w))) : FRAME_WIDTH;
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
    function renderMockFrame(site, host, ts, step) {
      const dims = DIMS[host] || [384, 216];
      const w = dims[0], h = dims[1];
      const hue = HUES[host] != null ? HUES[host] : 130;
      const own = DEMO_ZONES[host];
      const phase = ts / step % 20 / 20;
      const big = Math.round(Math.min(w * 0.16, h * 0.18));
      const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'><rect width='${w}' height='${h}' fill='hsl(${hue},30%,14%)'/><rect width='${w}' height='${Math.round(h * 0.14)}' fill='hsl(${hue},60%,30%)'/><text x='8' y='${Math.round(h * 0.1)}' font-family='sans-serif' font-weight='bold' font-size='${Math.round(h * 0.06)}' fill='#fff'>${xml(site)} / ${xml(host)}</text><text x='${w / 2}' y='${Math.round(h * 0.55)}' text-anchor='middle' font-family='monospace' font-weight='bold' font-size='${big}' fill='hsl(${hue},70%,72%)'>${xml(fmtTime(ts, own || tz))}</text>` + (own ? `<text x='${w / 2}' y='${Math.round(h * 0.655)}' text-anchor='middle' font-family='sans-serif' font-size='${Math.round(Math.min(h * 0.055, w * 0.06))}' fill='hsl(${hue},70%,72%)'>${xml(zoneLabel(own))} local time</text>` : "") + `<rect x='${(w * 0.04 + phase * w * 0.8).toFixed(1)}' y='${(h * 0.72).toFixed(1)}' width='${(w * 0.13).toFixed(1)}' height='${(h * 0.16).toFixed(1)}' fill='hsl(${hue},80%,55%)'/></svg>`;
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
      frames(site, host, from, to, step) {
        const out = [];
        const gapA = P.from + SPAN * 0.35, gapB = P.from + SPAN * 0.55;
        const first = Math.ceil(from / step) * step;
        for (let ts = first; ts <= Math.min(to, Date.now()); ts += step) {
          if (host === "source-2" && ts > gapA && ts < gapB) {
            continue;
          }
          if (host === "source-4" && ts > P.from + SPAN * 0.2 && ts < P.from + SPAN * 0.45) {
            continue;
          }
          out.push({ source: host, ts, url: renderMockFrame(site, host, ts, step) });
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
        const shown = a.tags.filter((t) => !/^(?:host|source|kiosk|site):/.test(t));
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
  var IMAGE_CONCURRENCY = 6;
  var IMAGE_TIMEOUT_MS = 15e3;
  function makeImageQueue(concurrency = IMAGE_CONCURRENCY, timeoutMs = IMAGE_TIMEOUT_MS) {
    let pending = [];
    let sorted = true;
    let active = 0;
    let stopped = false;
    let scheduled = false;
    let pumping = false;
    let idleWaiters = [];
    const timers = /* @__PURE__ */ new Set();
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
        let timer = null;
        const done = () => {
          if (finished) {
            return;
          }
          finished = true;
          if (timer) {
            clearTimeout(timer);
            timers.delete(timer);
          }
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
        } else if (!finished) {
          timer = setTimeout(done, timeoutMs);
          timers.add(timer);
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
        for (const t of timers) {
          clearTimeout(t);
        }
        timers.clear();
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

  // src/vt/model/reel.ts
  function videoTime(clip, t, duration) {
    const f = (t - clip.from) / Math.max(1, clip.to - clip.from);
    return Math.max(0, Math.min(1, f)) * duration;
  }
  function playVideo(v) {
    try {
      return Promise.resolve(v.play());
    } catch (e) {
      return Promise.reject(e);
    }
  }
  function clipTime(clip, seconds, duration) {
    const f = duration > 0 ? seconds / duration : 0;
    return clip.from + Math.max(0, Math.min(1, f)) * (clip.to - clip.from);
  }
  var PLAY_TARGET_S = 10;
  var MAX_RATE = 16;
  var isGap = (k) => k === "dropped" || k === "nodata" || k === "paused";
  var Reel = class {
    /** `seed`: a frame to show until the reel loads (the one clicked); it's
     * not kept once the slot's own frames arrive */
    constructor(src, slot, seed) {
      this.src = src;
      this.slot = slot;
      /** the slot's frames, and the one in force at its start */
      this.frames = [];
      /** the stretches over the slot */
      this.intervals = [];
      /** the video clips over the slot */
      this.clips = [];
      /** seconds of video per ms of the time a clip covers (a host's clips are
       * alike: a timelapse's few, real time's a thousandth), once a clip's
       * length is known; null until then */
      this.ratio = null;
      /** the most items the view can tell apart (the player's ticks): video is
       * played only when every clip in the slot is one of them */
      this.capacity = Infinity;
      this.seq = 0;
      if (seed) {
        this.frames = [seed];
      }
    }
    /** Fetches the slot: at most `points` frames over it and the slot before
     * (for the frame in force at its start), judged at the interval they were
     * asked for at. False when another load started meanwhile. */
    async load(points) {
      const seq = ++this.seq;
      const { from, to } = this.slot;
      let got = [];
      let clips = [];
      let sample2;
      try {
        if (this.src.clips) {
          clips = await this.src.clips(from, to);
        }
        if (this.src.detail) {
          const n = Math.max(2, Math.floor(points));
          const all = await this.src.detail(from - this.src.step, to, n);
          sample2 = Math.ceil((to - from + this.src.step) / n);
          got = [...all.filter((f) => f.ts < from).slice(-1), ...all.filter((f) => f.ts >= from)];
        } else {
          const before = (await this.src.fetch(from - this.src.step * 2, from)).filter((f) => f.ts < from);
          got = [...before.slice(-1), ...await this.src.fetch(from, to)];
        }
      } catch (e) {
        console.warn("[visual-timeline] fetching a slot's frames failed:", e);
      }
      if (seq !== this.seq) {
        return false;
      }
      const byTs = /* @__PURE__ */ new Map();
      for (const f of got) {
        byTs.set(f.ts, f);
      }
      if (!byTs.size) {
        for (const f of this.frames) {
          byTs.set(f.ts, f);
        }
      }
      this.frames = [...byTs.values()].sort((a, z) => a.ts - z.ts);
      this.clips = clips.filter((c) => c.to > from && c.from < to).sort((a, z) => a.from - z.from);
      this.intervals = this.src.intervals(this.frames, { from, to }, sample2, this.clips);
      return true;
    }
    /** the clips' parts of the slot, in order, not overlapping (where two
     * overlap, the later one from its start) */
    clipSpans() {
      const out = [];
      const { from, to } = this.slot;
      this.clips.forEach((c, i) => {
        const next = this.clips[i + 1];
        const a = Math.max(c.from, from), b = Math.min(c.to, to, next ? Math.max(next.from, from) : Infinity);
        if (b > a) {
          out.push({ clip: c, from: a, to: b });
        }
      });
      return out;
    }
    /** how much video the slot holds (s), once a clip's length is known */
    videoSeconds() {
      if (this.ratio === null) {
        return null;
      }
      return this.clipSpans().reduce((a, c) => a + (c.to - c.from) * this.ratio, 0);
    }
    /** how fast the slot's video plays to be watched in PLAY_TARGET_S: 1, or
     * faster, up to MAX_RATE; null when it's longer than that, or holds more
     * clips than the view can show (zoomed out: the slot is sampled, as
     * frames are; leaving clips out would break the video's flow). Its length
     * unknown yet, 1. */
    videoRate() {
      if (this.clipSpans().length > this.capacity) {
        return null;
      }
      const v = this.videoSeconds();
      if (v === null || v <= PLAY_TARGET_S) {
        return 1;
      }
      return v <= PLAY_TARGET_S * MAX_RATE ? v / PLAY_TARGET_S : null;
    }
    /** the clips' parts that play over the stills: all, while the slot's
     * video is short enough to watch; none when it's sampled */
    watched() {
      return this.videoRate() === null ? [] : this.clipSpans();
    }
    /** the picture for a clip's part (the still nearest its start, within
     * it, else the one in force there): our thumbnails are the stills */
    stillFor(c) {
      const inside = this.frames.find((f) => f.ts >= c.from && f.ts < c.to);
      if (inside) {
        return inside;
      }
      const j = frameIndexAt(this.frames, c.from);
      return j >= 0 ? this.frames[j] : null;
    }
    /** the watched clip's part of the slot in force at t, if any */
    clipAt(t) {
      return this.watched().find((c) => c.from <= t && t < c.to) ?? null;
    }
    /** what plays: more than one stop, or a clip */
    playable(n) {
      return this.stops(n).length > 1 || this.watched().length > 0;
    }
    /** the frames taken within the slot, but for those a clip plays over */
    inSlot() {
      const spans = this.watched();
      return this.frames.filter((f) => f.ts >= this.slot.from && f.ts < this.slot.to && !spans.some((c) => c.from <= f.ts && f.ts < c.to));
    }
    /** the frame in force before the slot's first (from before it) */
    prior() {
      return this.frames.filter((f) => f.ts < this.slot.from).pop() ?? null;
    }
    /** how many frames the slot holds: more than it has when the source thinned
     * them (each kept frame's count) */
    total() {
      return this.inSlot().reduce((a, f) => a + (f.count && f.count > 1 ? f.count : 1), 0);
    }
    /** the slot's frames, at most n of them, evenly through it */
    shown(n) {
      const fs = this.inSlot();
      if (fs.length <= n) {
        return fs;
      }
      const out = [];
      for (let i = 0; i < n; i++) {
        out.push(fs[Math.floor(i * fs.length / n)]);
      }
      return out;
    }
    /** the stretches without a frame, within the slot (but where a clip plays
     * over them) */
    gaps() {
      const spans = this.watched();
      const out = [];
      for (const iv of this.intervals) {
        if (!isGap(iv.kind) || iv.to <= this.slot.from || iv.from >= this.slot.to) {
          continue;
        }
        let pieces = [[iv.from, iv.to]];
        for (const c of spans) {
          pieces = pieces.flatMap(([a, b]) => c.to <= a || c.from >= b ? [[a, b]] : [...c.from > a ? [[a, c.from]] : [], ...c.to < b ? [[c.to, b]] : []]);
        }
        for (const [a, b] of pieces) {
          out.push({ ...iv, from: a, to: b });
        }
      }
      return out;
    }
    /** the stops: each of the n frames shown, the start of each gap, and the
     * start of each watched clip's part; sampled, a share of n through each
     * stretch only a clip covers (the video's own frames) */
    stops(n) {
      const out = new Set(this.shown(n).map((f) => f.ts));
      for (const g of this.gaps()) {
        out.add(Math.max(g.from, this.slot.from));
      }
      for (const c of this.watched()) {
        out.add(c.from);
      }
      if (this.videoRate() === null) {
        const { from, to } = this.slot;
        for (const iv of this.intervals) {
          if (iv.kind !== "clip" || iv.to <= from || iv.from >= to) {
            continue;
          }
          const a = Math.max(iv.from, from), b = Math.min(iv.to, to);
          const k = Math.max(1, Math.round(n * (b - a) / (to - from)));
          for (let i = 0; i < k; i++) {
            out.add(a + (b - a) * i / k);
          }
        }
      }
      return [...out].sort((a, z) => a - z);
    }
    /** what's in force at t */
    at(t) {
      const j = frameIndexAt(this.frames, t);
      const frame = j >= 0 ? this.frames[j] : null;
      const span = this.clipAt(t);
      if (span) {
        return { frame, interval: null, kind: "clip", gap: false, span };
      }
      const interval = this.intervals.find((x) => x.from <= t && t < x.to) || null;
      if (interval?.kind === "clip") {
        const c = this.clipSpans().find((x) => x.from <= t && t < x.to);
        if (c) {
          return { frame, interval, kind: "clip", gap: false, span: c };
        }
      }
      const kind = interval ? interval.kind : frame ? "frame" : "nodata";
      return { frame, interval, kind, gap: isGap(kind) };
    }
    /** the stop `dir` on from t (null at either end) */
    step(t, dir, n) {
      const st = this.stops(n);
      const i = st.findIndex((x) => x > t);
      const cur = i < 0 ? st.length - 1 : i - 1;
      return st[dir > 0 ? cur + 1 : cur - 1] ?? null;
    }
    /** the next stop from t, round and round (null with fewer than two,
     * unless the one is a clip: it plays again) */
    cycle(t, n) {
      const st = this.stops(n);
      if (st.length < 2) {
        return st.length && this.watched().length ? st[0] : null;
      }
      const i = st.findIndex((x) => x > t);
      return st[i < 0 ? 0 : i];
    }
  };

  // src/vt/ui/media.ts
  function makeVideo(muted, preload) {
    const v = document.createElement("video");
    v.muted = muted;
    v.playsInline = true;
    if (preload !== void 0) {
      v.preload = preload;
    }
    return v;
  }
  function releaseVideo(v) {
    if (!v.paused) {
      v.pause();
    }
    v.removeAttribute("src");
    try {
      v.load();
    } catch {
    }
  }
  function loopClipSpan(v, span, rate, hooks = {}) {
    const from = () => videoTime(span.clip, span.from, v.duration);
    const to = () => videoTime(span.clip, span.to, v.duration);
    const again = () => {
      v.currentTime = from();
      v.playbackRate = rate;
      playVideo(v).catch(() => {
      });
    };
    v.onloadedmetadata = () => {
      hooks.metadata?.(v);
      again();
    };
    v.ontimeupdate = () => {
      hooks.time?.(clipTime(span.clip, v.currentTime, v.duration));
      if (v.currentTime >= to() - 0.05) {
        again();
      }
    };
    v.onended = again;
    v.src = span.clip.url;
    return () => {
      v.onloadedmetadata = v.ontimeupdate = v.onended = null;
    };
  }
  function loadImage(url, onload) {
    const p = new Image();
    p.referrerPolicy = "no-referrer";
    if (onload) {
      p.onload = onload;
    }
    p.src = url;
    return p;
  }
  function preloadAfter(frames, t, n = 3) {
    const j = Math.max(0, frames.findIndex((f) => f.ts > t));
    for (let k = 0; k < n && frames.length; k++) {
      loadImage(frames[(j + k) % frames.length].url);
    }
  }

  // src/vt/ui/clipLength.ts
  var PROBE_MS = 4e3;
  var REMEMBER_MAX = 500;
  var Recent = class {
    constructor() {
      this.m = /* @__PURE__ */ new Map();
    }
    get(k) {
      const v = this.m.get(k);
      if (v !== void 0) {
        this.m.delete(k);
        this.m.set(k, v);
      }
      return v;
    }
    set(k, v) {
      this.m.delete(k);
      this.m.set(k, v);
      if (this.m.size > REMEMBER_MAX) {
        this.m.delete(this.m.keys().next().value);
      }
    }
  };
  var lengths = new Recent();
  var ratios = new Recent();
  function noteClipLength(url, seconds) {
    if (Number.isFinite(seconds) && seconds > 0) {
      lengths.set(url, seconds);
    }
  }
  function clipLength(url) {
    const known = lengths.get(url);
    if (known) {
      return Promise.resolve(known);
    }
    return new Promise((resolve2) => {
      const v = makeVideo(true, "metadata");
      let timer = null;
      const done = (s) => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        } else {
          return;
        }
        v.onloadedmetadata = v.onerror = null;
        releaseVideo(v);
        resolve2(s);
      };
      v.onloadedmetadata = () => {
        noteClipLength(url, v.duration);
        done(lengths.get(url) ?? null);
      };
      v.onerror = () => done(null);
      timer = setTimeout(() => done(null), PROBE_MS);
      v.src = url;
    });
  }
  async function measureReel(reel, key) {
    if (reel.ratio !== null || !reel.clips.length) {
      return false;
    }
    const known = key ? ratios.get(key) : void 0;
    if (known) {
      reel.ratio = known;
      return true;
    }
    const c = reel.clips[0];
    const s = await clipLength(c.url);
    if (!s || reel.ratio !== null) {
      return false;
    }
    const r = s / Math.max(1, c.to - c.from);
    if (key) {
      ratios.set(key, r);
    }
    reel.ratio = r;
    return true;
  }

  // src/vt/ui/playerPrefs.ts
  var PREFS_KEY = "ktl-player";
  var FPS = [1, 2, 4, 8, 16];
  var SPEEDS = [0.25, 0.5, 1, 2, 4, 8, 16];
  var fmtRate = (r) => (r === 0.25 ? "\xBC" : r === 0.5 ? "\xBD" : String(Math.round(r * 10) / 10)) + "\xD7";
  function loadPrefs(style = "ticks") {
    const base = { style, fps: 4, hd: true, muted: true };
    try {
      const p = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
      return {
        style: p.style === "thumbs" || p.style === "ticks" ? p.style : base.style,
        fps: FPS.includes(p.fps) ? p.fps : base.fps,
        hd: typeof p.hd === "boolean" ? p.hd : base.hd,
        muted: typeof p.muted === "boolean" ? p.muted : base.muted
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

  // src/vt/ui/playerVideo.ts
  var LOADING_AFTER_MS = 600;
  function makePlayerVideo(host) {
    const { el, stateEl, prefs } = host;
    let video = makeVideo(prefs.muted, "metadata");
    let spare = makeVideo(prefs.muted, "metadata");
    spare.classList.add("spare");
    const elements = [video, spare];
    let vidClip = null;
    let vidSrc = "";
    let pendingT = null;
    let spareClip = null;
    let spareSrc = "";
    let spareT = null;
    const srcOf = (c) => prefs.hd && c.hi ? c.hi : c.url;
    function show(c, driving) {
      const t = host.t();
      const src = srcOf(c);
      if (src !== vidSrc) {
        if (src === spareSrc) {
          takeSpare();
        } else {
          vidClip = c;
          vidSrc = src;
          pendingT = t;
          video.src = src;
          return;
        }
      }
      if (driving) {
        return;
      }
      if (video.readyState >= 1 && video.duration > 0) {
        video.currentTime = videoTime(c, t, video.duration);
      } else {
        pendingT = t;
      }
    }
    function preload(c) {
      if (!c) {
        return;
      }
      const src = srcOf(c.clip);
      if (src === vidSrc || src === spareSrc) {
        return;
      }
      spareClip = c.clip;
      spareSrc = src;
      spareT = c.from;
      spare.preload = "auto";
      spare.src = src;
    }
    function takeSpare() {
      video.pause();
      video.classList.add("spare");
      spare.classList.remove("spare");
      [video, spare] = [spare, video];
      vidClip = spareClip;
      vidSrc = spareSrc;
      pendingT = null;
      spareClip = null;
      spareSrc = "";
      video.muted = prefs.muted;
      picture();
      waitFor(video.readyState < 3 && video.seeking);
    }
    function wire(v) {
      v.addEventListener("loadedmetadata", () => {
        if (host.gone()) {
          return;
        }
        if (v !== video) {
          if (spareClip) {
            noteClipLength(spareClip.url, v.duration);
          }
          if (spareClip && spareT !== null && v.duration > 0) {
            v.currentTime = videoTime(spareClip, spareT, v.duration);
          }
          return;
        }
        host.sized(v.videoWidth, v.videoHeight);
        if (vidClip) {
          noteClipLength(vidClip.url, v.duration);
        }
        if (vidClip && pendingT !== null && v.duration > 0) {
          v.currentTime = videoTime(vidClip, pendingT, v.duration);
        }
        pendingT = null;
      });
      v.addEventListener("loadstart", () => {
        delete v.dataset.pic;
      });
      v.addEventListener("loadeddata", () => {
        v.dataset.pic = "1";
      });
      for (const e of ["waiting", "seeking", "loadstart"]) {
        v.addEventListener(e, () => {
          if (v === video) {
            picture();
            waitFor(v.readyState < 3);
          }
        });
      }
      for (const e of ["loadeddata", "canplay", "playing", "seeked"]) {
        v.addEventListener(e, () => {
          if (v === video) {
            picture();
            waitFor(v.readyState < 3 && v.seeking);
          }
        });
      }
      v.addEventListener("error", () => {
        if (v !== video) {
          spareSrc = "";
          return;
        }
        if (host.gone() || !vidClip || !vidClip.hi || vidSrc !== vidClip.hi) {
          return;
        }
        vidSrc = vidClip.url;
        pendingT = host.t();
        v.src = vidClip.url;
      });
    }
    wire(video);
    wire(spare);
    function picture() {
      el.classList.toggle("no-picture", !video.dataset.pic);
    }
    let waitTimer = null;
    function waitFor(on) {
      if (!on) {
        if (waitTimer) {
          clearTimeout(waitTimer);
          waitTimer = null;
        }
        loading(false);
        return;
      }
      if (waitTimer || el.classList.contains("loading")) {
        return;
      }
      waitTimer = setTimeout(() => {
        waitTimer = null;
        if (!host.gone() && video.readyState < 3 && !buffered(video, video.currentTime)) {
          loading(true);
        }
      }, LOADING_AFTER_MS);
    }
    function loading(on) {
      if (el.classList.contains("loading") === on) {
        return;
      }
      el.classList.toggle("loading", on);
      if (el.classList.contains("video")) {
        stateEl.textContent = on ? "loading video\u2026" : "";
      }
    }
    return {
      get video() {
        return video;
      },
      elements,
      show,
      preload,
      ready: () => video.readyState >= 1 && pendingT === null,
      waitFor,
      release() {
        for (const v of [video, spare]) {
          releaseVideo(v);
        }
        if (waitTimer) {
          clearTimeout(waitTimer);
        }
      }
    };
  }
  function buffered(v, s) {
    for (let i = 0; i < v.buffered.length; i++) {
      if (v.buffered.start(i) <= s && s < v.buffered.end(i) - 0.1) {
        return true;
      }
    }
    return false;
  }

  // src/vt/ui/scrubber.ts
  var THUMB_PX = 48;
  var setAttr = (el, name, value) => {
    if (el.getAttribute(name) !== value) {
      el.setAttribute(name, value);
    }
  };
  function makeScrubber(scrub, host) {
    const lanes = scrub.querySelector(".lanes");
    const thumbs = scrub.querySelector(".thumbs");
    const ticks = scrub.querySelector(".ticks");
    const headEl = scrub.querySelector(".head");
    const width = () => scrub.clientWidth || 560;
    const slot = () => host.reel().slot;
    const span = () => Math.max(1, slot().to - slot().from);
    const xOf = (ts) => (ts - slot().from) / span() * 100;
    function draw() {
      const reel = host.reel();
      const most = host.most();
      reel.capacity = most;
      lanes.textContent = "";
      for (const iv of reel.gaps()) {
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
      for (const c of reel.clipSpans()) {
        const d = document.createElement("div");
        d.className = "lane clip";
        d.title = "video";
        d.style.left = Math.max(0, xOf(c.from)) + "%";
        d.style.width = Math.max(0, Math.min(100, xOf(c.to)) - Math.max(0, xOf(c.from))) + "%";
        lanes.appendChild(d);
      }
      ticks.textContent = "";
      for (const f of reel.shown(most)) {
        const k = document.createElement("div");
        k.className = "tick";
        k.style.left = xOf(f.ts) + "%";
        ticks.appendChild(k);
      }
      const watched = reel.watched();
      for (const c of watched) {
        const k = document.createElement("div");
        k.className = "tick clip-start";
        k.style.left = xOf(c.from) + "%";
        ticks.appendChild(k);
      }
      thumbs.textContent = "";
      if (host.style() !== "thumbs") {
        return;
      }
      const fs = reel.shown(Math.max(4, Math.floor(width() / THUMB_PX)));
      const gaps = [...reel.gaps(), ...reel.watched()].sort((a, z) => a.from - z.from);
      const cell = (f, from, to, prior2 = false, clip = false) => {
        const c = document.createElement("div");
        c.className = "thumb" + (prior2 ? " prior" : "") + (clip ? " clip" : "");
        c.style.left = xOf(from) + "%";
        c.style.width = Math.max(0, xOf(to) - xOf(from)) + "%";
        const ti = document.createElement("img");
        ti.alt = "";
        ti.referrerPolicy = "no-referrer";
        ti.src = f.url;
        c.appendChild(ti);
        thumbs.appendChild(c);
      };
      const prior = reel.prior();
      const firstTs = fs.length ? fs[0].ts : slot().to;
      const firstGap = gaps.find((g) => g.from <= slot().from);
      if (prior && firstTs > slot().from && !firstGap) {
        cell(prior, slot().from, firstTs, true);
      }
      fs.forEach((f, i) => {
        const next = i + 1 < fs.length ? fs[i + 1].ts : slot().to;
        const gap = gaps.find((g) => g.from >= f.ts && g.from < next);
        cell(f, f.ts, gap ? gap.from : next);
      });
      for (const c of watched) {
        const f = reel.stillFor(c);
        if (f) {
          cell(f, c.from, c.to, false, true);
        }
      }
    }
    const tAt = (clientX) => {
      const r = scrub.getBoundingClientRect();
      return slot().from + Math.max(0, Math.min(1, (clientX - r.left) / Math.max(1, r.width))) * span();
    };
    scrub.addEventListener("pointermove", (e) => host.seekTo(tAt(e.clientX)));
    scrub.addEventListener("pointerdown", (e) => {
      scrub.setPointerCapture?.(e.pointerId);
      host.seekTo(tAt(e.clientX));
    });
    scrub.addEventListener("keydown", (e) => {
      if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) {
        return;
      }
      const stops = host.reel().stops(host.most());
      switch (e.key) {
        case "ArrowLeft":
        case "ArrowDown":
          host.step(-1);
          break;
        case "ArrowRight":
        case "ArrowUp":
          host.step(1);
          break;
        case "Home":
          host.seekTo(stops.length ? stops[0] : slot().from);
          break;
        case "End":
          host.seekTo(stops.length ? stops[stops.length - 1] : slot().to - 1);
          break;
        default:
          return;
      }
      e.preventDefault();
    });
    return {
      draw,
      width,
      xOf,
      head(t) {
        headEl.style.left = xOf(t) + "%";
      },
      value(t, text) {
        setAttr(scrub, "aria-valuemin", String(Math.round(slot().from)));
        setAttr(scrub, "aria-valuemax", String(Math.round(slot().to - 1)));
        setAttr(scrub, "aria-valuenow", String(Math.round(t)));
        setAttr(scrub, "aria-valuetext", text);
      }
    };
  }

  // src/vt/ui/player.ts
  var MIN_CLIP_S = 0.25;
  var STAGE_H = 405;
  var MIN_W = 400;
  var MAX_W = 960;
  var ICON_TICKS = '<svg viewBox="0 0 16 12" width="16" height="12" aria-hidden="true"><path d="M2 2v8M5 4v6M8 1v9M11 5v5M14 3v7" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>';
  var ICON_THUMBS = '<svg viewBox="0 0 16 12" width="16" height="12" aria-hidden="true"><rect x="1" y="1" width="14" height="10" rx="1" stroke="currentColor" stroke-width="1.2" fill="none"/><circle cx="11" cy="4" r="1.3" fill="currentColor"/><path d="M2.5 9.5l3.5-4 2.5 2.5 1.5-1.5 3 3z" fill="currentColor"/></svg>';
  var ICON_MUTED = '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M2 6h3l4-3v10l-4-3H2z" fill="currentColor"/><path d="M11 6l4 4M15 6l-4 4" stroke="currentColor" stroke-width="1.5"/></svg>';
  var ICON_SOUND = '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M2 6h3l4-3v10l-4-3H2z" fill="currentColor"/><path d="M11 5.5c1.2 1.2 1.2 3.8 0 5M13 3.5c2.2 2.4 2.2 6.6 0 9" stroke="currentColor" stroke-width="1.3" fill="none"/></svg>';
  var ICON_ZOOM = '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" stroke-width="1.5" fill="none"/><path d="M10 10l4.5 4.5M4.5 6.5h4M6.5 4.5v4" stroke="currentColor" stroke-width="1.5"/></svg>';
  var typing = (target) => target instanceof Element && !!target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
  var btn = (a, label, title) => `<button type="button" data-a="${a}" title="${title}" aria-label="${title}">${label}</button>`;
  function mountPlayer(el, start, ctx, place, close = () => {
  }, startTs = start?.ts ?? 0) {
    const prefs = loadPrefs(ctx.scrubber);
    el.classList.add("player");
    el.innerHTML = '<div class="top">' + (ctx.onZoom ? btn("zoom", ICON_ZOOM, "Zoom the dashboard to this slot") : "<span></span>") + '<span class="title"></span>' + btn("close", "\u2715", "Close (Esc)") + '</div><div class="stage"><div class="state" aria-live="polite"></div>' + (ctx.onZoom ? '<button type="button" class="zoom-video" data-a="zoom-video">\u25B6 Zoom in for the video</button>' : '<span class="zoom-video">\u25B6 Video at a closer zoom</span>') + '</div><div class="scrub" role="slider" tabindex="0" aria-label="The frames in this slot"><div class="lanes"></div><div class="thumbs"></div><div class="ticks"></div><div class="head"></div></div><div class="bar"><span class="time"></span><span class="transport">' + btn("prev-slot", "\u2039\u2039", "Previous slot (Shift+\u2190)") + btn("prev", "\u2039", "Previous frame in this slot (\u2190)") + btn("play", "\u25B6", "Play the frames in this slot (Space)") + btn("next", "\u203A", "Next frame in this slot (\u2192)") + btn("next-slot", "\u203A\u203A", "Next slot (Shift+\u2192)") + '</span><span class="opts">' + btn("mute", "", "Sound") + btn("hd", "HD", "Video quality") + btn("style-ticks", ICON_TICKS, "Scrubber: a tick per frame") + btn("style-thumbs", ICON_THUMBS, "Scrubber: the frames as pictures") + btn("fps", "", "Speed") + "</span></div>";
    const img = document.createElement("img");
    img.alt = "frame";
    img.referrerPolicy = "no-referrer";
    if (start) {
      img.src = start.url;
    }
    const stateEl = el.querySelector(".stage .state");
    const media = makePlayerVideo({
      el,
      stateEl,
      prefs,
      t: () => t,
      gone: () => gone,
      sized: (w, h) => {
        size(w, h);
        place();
      }
    });
    el.querySelector(".stage").prepend(img, ...media.elements);
    const titleEl = el.querySelector(".title");
    const timeEl = el.querySelector(".time");
    const b = (a) => el.querySelector(`button[data-a="${a}"]`);
    const firstSlot = ctx.slotAt(startTs) ?? { from: startTs - ctx.step / 2, to: startTs + ctx.step / 2, ts: startTs };
    let reel = new Reel(ctx, firstSlot, start ?? void 0);
    let t = startTs;
    let playing = false;
    let timer = null;
    let driving = false;
    let raf = 0;
    let pendingGo = null;
    function cancelGo() {
      if (!pendingGo) {
        return;
      }
      pendingGo.v.removeEventListener("loadedmetadata", pendingGo.h);
      if (pendingGo.timer) {
        clearTimeout(pendingGo.timer);
      }
      pendingGo = null;
    }
    let speed = null;
    const videoMode = () => reel.watched().length > 0;
    const rateNow = () => speed ?? (ctx.autoSpeed ? reel.videoRate() ?? 1 : 1);
    let hiTimer = null;
    let gone = false;
    const scrubber = makeScrubber(el.querySelector(".scrub"), {
      reel: () => reel,
      most: () => most(),
      style: () => prefs.style,
      seekTo: (to) => {
        if (playing) {
          stop();
        }
        seek(to);
      },
      step: (dir) => act(dir > 0 ? "next" : "prev")
    });
    const tickPx = () => ctx.frameWidth && ctx.frameWidth > 0 ? ctx.frameWidth : FRAME_WIDTH;
    const most = () => Math.max(4, Math.floor(scrubber.width() / tickPx()));
    const slot = () => reel.slot;
    function labels() {
      if (videoMode()) {
        b("fps").textContent = fmtRate(rateNow());
        b("fps").title = "Video speed" + (speed === null && ctx.autoSpeed ? " (fits this slot's video into about ten seconds)" : "") + ": click for faster, round from \xBC\xD7";
      } else {
        b("fps").textContent = prefs.fps + " fps";
        b("fps").title = "Speed";
      }
      b("fps").setAttribute("aria-label", b("fps").title);
      b("style-ticks").setAttribute("aria-pressed", String(prefs.style === "ticks"));
      b("style-thumbs").setAttribute("aria-pressed", String(prefs.style === "thumbs"));
      b("play").textContent = playing ? "\u275A\u275A" : "\u25B6";
      const n = reel.stops(most()).length;
      const can = reel.playable(most());
      b("play").disabled = !can;
      b("play").title = !can ? "One frame in this slot: nothing to play" : playing ? "Pause (Space)" : "Play this slot (Space)";
      b("prev").disabled = b("next").disabled = n < 2;
      el.classList.toggle("thumbs", prefs.style === "thumbs");
      reel.capacity = most();
      const clips = reel.clipSpans();
      el.classList.toggle("no-stills", !reel.frames.length);
      el.classList.toggle("video-far", clips.length > 0 && reel.videoRate() === null);
      el.classList.toggle("has-clip", clips.length > 0);
      el.classList.toggle("has-hi", clips.some((c) => !!c.clip.hi));
      b("mute").innerHTML = prefs.muted ? ICON_MUTED : ICON_SOUND;
      b("mute").title = prefs.muted ? "Unmute the video" : "Mute the video";
      b("mute").setAttribute("aria-label", b("mute").title);
      b("hd").setAttribute("aria-pressed", String(prefs.hd));
      b("hd").title = prefs.hd ? "Playing the larger video: switch to the smaller" : "Playing the smaller video: switch to the larger";
    }
    function show() {
      scrubber.head(t);
      const at = reel.at(t);
      if (at.span) {
        el.classList.add("video");
        el.classList.remove("off");
        stateEl.textContent = el.classList.contains("loading") ? "loading video\u2026" : "";
        if (at.frame && img.getAttribute("src") !== at.frame.url && img.dataset.hiOf !== at.frame.url) {
          img.src = at.frame.url;
          delete img.dataset.hiOf;
        }
        media.show(at.span.clip, driving);
        caption(null);
        return;
      }
      if (el.classList.contains("video")) {
        el.classList.remove("video");
        media.waitFor(false);
        stopVideo();
      }
      const f = at.frame;
      el.classList.toggle("off", at.gap);
      stateEl.textContent = at.kind === "dropped" ? "offline" : at.kind === "nodata" ? "no frame" : at.kind === "paused" ? pauseInfo({ paused: true, label: at.interval?.pause?.label }).label.toLowerCase() : "";
      if (f && img.getAttribute("src") !== f.url && img.dataset.hiOf !== f.url) {
        img.src = f.url;
        delete img.dataset.hiOf;
      }
      caption(at.gap ? null : f);
      if (hiTimer) {
        clearTimeout(hiTimer);
      }
      if (f && f.hi && !playing) {
        const hi = f.hi, lo = f.url;
        hiTimer = setTimeout(() => {
          loadImage(hi, () => {
            if (!gone && reel.at(t).frame === f) {
              img.src = hi;
              img.dataset.hiOf = lo;
            }
          });
        }, 300);
      }
    }
    function caption(f) {
      const shown = reel.shown(most()).length;
      const total = reel.total();
      titleEl.textContent = (ctx.label ?? "") + (total > shown ? " (showing " + shown + " of " + total + ")" : "");
      titleEl.title = titleEl.textContent;
      const at = f ? f.ts : t;
      timeEl.textContent = ctx.tt.time(at) + ctx.tt.sfx(at);
      scrubber.value(t, timeEl.textContent);
      const sampled = reel.clips.length > 0 && reel.videoRate() === null;
      const zoom = el.querySelector('button[data-a="zoom"]');
      if (zoom) {
        zoom.classList.toggle("hint", total > shown || sampled);
        const tip = sampled ? "More video in this slot than plays here: zoom the dashboard to the slot to watch it" : total > shown ? total + " frames in this slot, " + shown + " shown: zoom the dashboard to the slot to see them all" : "Zoom the dashboard to this slot";
        zoom.title = tip;
        zoom.setAttribute("aria-label", tip);
      }
    }
    function seek(to) {
      t = Math.max(slot().from, Math.min(slot().to - 1, to));
      show();
    }
    async function load(at) {
      const r = reel;
      const ok = await r.load(2 * most());
      if (gone || !ok || r !== reel) {
        return;
      }
      scrubber.draw();
      labels();
      seek(at);
      if (await measureReel(r, ctx.key)) {
        if (gone || r !== reel) {
          return;
        }
        scrubber.draw();
        labels();
        show();
      }
    }
    function stopVideo() {
      driving = false;
      cancelGo();
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      if (!media.video.paused) {
        media.video.pause();
      }
    }
    function stop() {
      playing = false;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      stopVideo();
      labels();
    }
    function run() {
      if (!playing || gone) {
        return;
      }
      const span = reel.clipAt(t);
      const d = media.video.duration;
      if (span && !(d > 0 && videoTime(span.clip, span.to, d) - videoTime(span.clip, span.from, d) < MIN_CLIP_S)) {
        playSpan(span);
        return;
      }
      timer = setTimeout(() => {
        timer = null;
        advance();
      }, 1e3 / prefs.fps);
    }
    function advance() {
      const next = reel.cycle(t, most());
      if (next === null) {
        stop();
        return;
      }
      seek(next);
      preloadAfter(reel.shown(most()), t);
      run();
    }
    function playSpan(span) {
      driving = true;
      const follow = () => {
        raf = 0;
        if (!playing || gone || !driving) {
          return;
        }
        const video = media.video;
        const d = video.duration;
        if (d > 0) {
          t = Math.max(span.from, clipTime(span.clip, video.currentTime, d));
          scrubber.head(t);
          caption(null);
        }
        if (video.ended || t >= span.to - 1) {
          stopVideo();
          advance();
          return;
        }
        raf = requestAnimationFrame(follow);
      };
      const go = () => {
        pendingGo = null;
        if (!playing || gone || !driving) {
          return;
        }
        if (raf) {
          cancelAnimationFrame(raf);
          raf = 0;
        }
        const v2 = media.video;
        v2.muted = prefs.muted;
        v2.playbackRate = rateNow();
        playVideo(v2).catch(() => {
          v2.muted = true;
          return playVideo(v2);
        }).catch(() => stop());
        const ws = reel.watched();
        media.preload(ws.find((c) => c.from >= span.to - 1 && c.clip !== span.clip) ?? ws.find((c) => c.clip !== span.clip));
        raf = requestAnimationFrame(follow);
      };
      cancelGo();
      if (media.ready()) {
        go();
        return;
      }
      const v = media.video;
      const h = () => {
        v.removeEventListener("loadedmetadata", h);
        if (pendingGo) {
          pendingGo.timer = setTimeout(go, 0);
        }
      };
      pendingGo = { v, h, timer: null };
      v.addEventListener("loadedmetadata", h);
    }
    function play() {
      if (playing || !reel.playable(most())) {
        return;
      }
      playing = true;
      labels();
      run();
    }
    function toSlot(dir) {
      const next = ctx.slotAt(dir > 0 ? slot().to : slot().from - 1);
      if (!next || next.from === slot().from) {
        return;
      }
      reel = new Reel(ctx, next);
      if (ctx.autoSpeed) {
        speed = null;
      }
      const at = next.frameTs !== void 0 && next.frameTs >= next.from && next.frameTs < next.to ? next.frameTs : next.ts;
      scrubber.draw();
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
          const to = reel.step(t, a === "next" ? 1 : -1, most());
          if (to !== null) {
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
        case "mute":
          prefs.muted = !prefs.muted;
          savePrefs(prefs);
          media.video.muted = prefs.muted;
          labels();
          break;
        case "hd": {
          prefs.hd = !prefs.hd;
          savePrefs(prefs);
          const was = playing;
          stop();
          show();
          if (was) {
            play();
          }
          labels();
          break;
        }
        case "fps":
          if (videoMode()) {
            speed = SPEEDS.find((x) => x > rateNow() + 0.01) ?? SPEEDS[0];
            if (driving) {
              media.video.playbackRate = speed;
            }
            labels();
            break;
          }
          prefs.fps = FPS[(FPS.indexOf(prefs.fps) + 1) % FPS.length];
          savePrefs(prefs);
          if (playing) {
            stop();
            play();
          }
          labels();
          break;
        // the same frames either way: only how they're drawn changes
        case "style-ticks":
        case "style-thumbs": {
          const style = a === "style-ticks" ? "ticks" : "thumbs";
          if (style === prefs.style) {
            break;
          }
          prefs.style = style;
          savePrefs(prefs);
          labels();
          scrubber.draw();
          show();
          break;
        }
        // the bubble over video this scale can't show does what Zoom does
        case "zoom":
        case "zoom-video":
          stop();
          ctx.onZoom?.(slot().from, slot().to);
          close();
          break;
      }
    };
    el.addEventListener("click", (e) => {
      const a = e.target.closest("button")?.dataset.a;
      if (a && a !== "close") {
        act(a);
      }
    });
    const keyH = (e) => {
      if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey || typing(e.target)) {
        return;
      }
      const k = e.key;
      if (k === " ") {
        if (e.target instanceof Element && e.target.closest('button, a[href], [role="button"], summary')) {
          return;
        }
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
    let sized = false;
    const stage = el.querySelector(".stage");
    function size(nw, nh) {
      if (sized || !nw || !nh) {
        return;
      }
      sized = true;
      const aspect = nw / nh;
      const pad = 12 + 2;
      const maxW = Math.min(MAX_W, window.innerWidth * 0.92) - pad;
      let h = Math.min(STAGE_H, window.innerHeight * 0.55);
      let w = h * aspect;
      if (w > maxW) {
        w = maxW;
        h = w / aspect;
      }
      if (w < MIN_W) {
        h = Math.min(MIN_W / aspect, STAGE_H * 1.5, window.innerHeight * 0.7);
        w = h * aspect;
      }
      el.style.width = Math.round(Math.max(MIN_W, w) + pad) + "px";
      stage.style.height = Math.round(h) + "px";
      scrubber.draw();
      show();
    }
    img.onload = () => {
      size(img.naturalWidth, img.naturalHeight);
      place();
    };
    img.onerror = () => {
      if (img.dataset.hiOf) {
        img.src = img.dataset.hiOf;
        delete img.dataset.hiOf;
      }
    };
    if (start && img.complete) {
      size(img.naturalWidth, img.naturalHeight);
      place();
    }
    labels();
    caption(start);
    void load(startTs);
    const rebind = (next) => {
      if (gone) {
        return;
      }
      ctx = next;
      scrubber.draw();
      labels();
    };
    return Object.assign(() => {
      gone = true;
      stop();
      media.release();
      if (hiTimer) {
        clearTimeout(hiTimer);
      }
      document.removeEventListener("keydown", keyH);
    }, { rebind });
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
    const opener = popState.el?.contains(document.activeElement) ? popState.opener : null;
    if (popState.el) {
      popState.el.remove();
      popState.el = null;
    }
    popState.player = null;
    popState.opener = null;
    if (opener?.isConnected) {
      opener.focus({ preventScroll: true });
    }
    if (popState.keyH) {
      if (popState.keyCapture) {
        window.removeEventListener("keydown", popState.keyH, true);
      } else {
        document.removeEventListener("keydown", popState.keyH);
      }
      popState.keyH = null;
      popState.keyCapture = false;
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
    const label = (site, host) => site ? site + " / " + host : host;
    const pv = {
      // expectedTs set = frame is the pending slot's ghost: shown blurred and
      // captioned as the last frame, never as the expected one. tt: the
      // source's time text (zoneTexts), the panel's when omitted
      open(site, host, frame, x, y, hiUrl, expectedTs, tt, player) {
        tt = tt || panelTexts;
        closePreview();
        if (player && !expectedTs) {
          openPlayer(root, pv, site, host, frame, frame.ts, x, y, { ...player, tt, label: label(site, host) });
          return;
        }
        const el = document.createElement("div");
        el.className = "ktl-pop" + (expectedTs ? " ghost" : "");
        copyVars(root, el);
        el.innerHTML = '<img alt="frame"><div class="cap"></div>';
        const img = el.querySelector("img");
        img.referrerPolicy = "no-referrer";
        el.querySelector(".cap").textContent = (site ? site + " / " : "") + host + " \u2014 " + (expectedTs ? "expected " + tt.short(expectedTs) + " \xB7 last frame " + tt.time(frame.ts) : tt.time(frame.ts)) + tt.sfx(frame.ts);
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
      play(site, host, t, x, y, tt, player) {
        closePreview();
        openPlayer(root, pv, site, host, null, t, x, y, { ...player, tt: tt || panelTexts, label: label(site, host) });
      },
      close: closePreview,
      retire() {
        if (popState.el && !popState.retireTimer) {
          popState.retireTimer = setTimeout(closePreview, 1500);
        }
      },
      rebind(provide) {
        const p = popState.player;
        if (!p || p.root !== root || p.by === pv) {
          return;
        }
        const ctx = provide(p.site, p.host);
        if (!ctx) {
          closePreview();
          return;
        }
        p.by = pv;
        p.handle.rebind({ ...ctx, label: p.label });
      }
    };
    return pv;
  }
  function openPlayer(root, by, site, host, frame, t, x, y, ctx) {
    const el = document.createElement("div");
    el.className = "ktl-pop";
    copyVars(root, el);
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", site ? site + " / " + host : host);
    el.tabIndex = -1;
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    document.body.appendChild(el);
    let placedW = -1;
    const place = () => {
      if (!el.isConnected) {
        return;
      }
      const r = el.getBoundingClientRect();
      if (placedW === Math.round(r.width) && r.right <= window.innerWidth && r.bottom <= window.innerHeight) {
        return;
      }
      placedW = Math.round(r.width);
      el.style.left = Math.max(8, Math.min(window.innerWidth - r.width - 8, x - r.width / 2)) + "px";
      el.style.top = Math.max(8, Math.min(window.innerHeight - r.height - 8, y + 16)) + "px";
    };
    const handle = mountPlayer(el, frame, ctx, place, closePreview, t);
    popState.teardown = handle;
    popState.player = { root, by, site, host, label: ctx.label ?? host, handle };
    el.querySelector('button[data-a="close"]')?.addEventListener("click", closePreview);
    place();
    popState.el = el;
    popState.opener = opener;
    el.focus({ preventScroll: true });
    popState.keyH = (e) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        e.preventDefault();
        closePreview();
      }
    };
    window.addEventListener("keydown", popState.keyH, true);
    popState.keyCapture = true;
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
    const widths = s.hosts.map((k) => s.cards[k.id] ? s.cards[k.id].strip.clientWidth : 0);
    s.hosts.forEach((k, i) => {
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
    for (const k of s.hosts) {
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
    for (const k of s.hosts) {
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
    for (const k of s.hosts) {
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
      const key = shownKey(slot);
      if (key !== null && key === c.shown) {
        continue;
      }
      c.shown = key;
      c.mag.classList.remove("ghost", "clip");
      if (slot && slot.frame) {
        c.mag.classList.remove("gap", "future", "off");
        clearPauseClasses(c.mag);
        setSrc(c.mag.querySelector("img"), slot.frame.url);
        setText(c.mag.querySelector(".cap"), tt.time(slot.frame.ts) + tt.sfx(slot.frame.ts));
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
      } else if (slot && slot.clip) {
        c.mag.classList.remove("gap", "future", "off", "nodata");
        clearPauseClasses(c.mag);
        c.mag.classList.add("clip");
        setText(c.mag.querySelector(".cap"), "\u25B6 video " + tt.time(slot.clip.from) + "\u2013" + tt.time(slot.clip.to) + tt.sfx(slot.clip.from));
        setText(c.head, "");
        c.head.classList.remove("stale", "nodata");
        clearPauseClasses(c.head);
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
        const lastClip = last ? null : c.model.clips.filter((x2) => x2.to <= s.cursorT).pop();
        const msg = last ? (nodata ? "no frame \u2014 last seen " : "offline \u2014 last seen ") + tt.time(last.ts) + tt.sfx(last.ts) : lastClip ? (nodata ? "no video \u2014 last clip ended " : "offline \u2014 last clip ended ") + tt.time(lastClip.to) + tt.sfx(lastClip.to) : "no data in window";
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
    if (slot.clip) {
      return "c:" + slot.ts + ":" + slot.clip.url;
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
    for (const k of s.hosts) {
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
      img.referrerPolicy = "no-referrer";
      img.decoding = "async";
      sl.el.appendChild(img);
    }
    if (img.src !== g.url) {
      img.src = g.url;
    }
  }

  // src/vt/ui/playerContext.ts
  var PLAYER_BUCKETS = 800;
  function playerContext(backend, cfg, P, decl, model, tt, onTime, onZoom) {
    return {
      window: { from: P.from, to: P.to },
      key: decl.site + "/" + decl.id,
      step: model.step,
      tt,
      fetch: (from, to) => backend.allFrames ? backend.allFrames(decl.site, decl.id, from, to) : backend.frames(decl.site, decl.id, from, to, Math.max(model.lastActive?.cadence ?? model.step, Math.ceil((to - from) / PLAYER_BUCKETS))),
      ...backend.clips ? { clips: (from, to) => backend.clips(decl.site, decl.id, from, to) } : {},
      ...backend.detail ? { detail: (from, to, maxPoints) => backend.detail(decl.site, decl.id, from, to, maxPoints) } : {},
      // a slot fetched again at full resolution is judged exactly
      // a slot asked for again is judged at the interval it was asked at; one
      // from the panel's own frames, at the panel's
      intervals: (frames, range, sample2, clips) => model.intervalsFor(frames, range, Date.now(), backend.detail ? sample2 ?? 0 : void 0, clips),
      // the strip's own slots, so the player's slots are the ones on screen
      slotAt: (t) => {
        const sl = model.slotAt(t);
        return sl ? { from: sl.x0, to: sl.x0 + sl.span, ts: sl.ts, ...sl.frame ? { frameTs: sl.frame.ts } : {} } : null;
      },
      onTime,
      // the timeline's drag-zoom (the grid has none)
      ...onZoom ? { onZoom } : {},
      scrubber: cfg.playerScrubber === "thumbs" ? "thumbs" : cfg.playerScrubber === "ticks" ? "ticks" : void 0,
      frameWidth: frameWidthOf(cfg),
      autoSpeed: !!cfg.videoAutoSpeed
    };
  }

  // src/vt/timeline/flipbook.ts
  var DWELL_MS = 3e3;
  var FLIP_FPS = 4;
  var FLIP_MAX = 100;
  function makeFlipbook(target, anySlot = false, hasClip = (sl) => !!sl.clip, autoSpeed = false) {
    let current = null;
    let dwell = null;
    let timer = null;
    let clipOn = false;
    let seq = 0;
    const alive = () => target.alive?.() ?? true;
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
      if (clipOn) {
        clipOn = false;
        target.clip?.(null);
        target.playingChanged(false);
      }
    }
    async function start(sl) {
      const mine = ++seq;
      if (!alive()) {
        return;
      }
      const reel = target.reel({ from: sl.x0, to: sl.x0 + sl.span, ts: sl.ts });
      reel.capacity = FLIP_MAX;
      const ok = await reel.load(FLIP_MAX);
      if (!ok || mine !== seq || !current || current.x0 !== sl.x0 || !alive()) {
        return;
      }
      if (reel.clips.length) {
        await target.measure?.(reel);
      }
      if (mine !== seq || !current || current.x0 !== sl.x0 || !alive()) {
        return;
      }
      if (!reel.clips.some((c) => c.hi)) {
        reel.capacity = 0;
      }
      const rate = reel.videoRate();
      const all = reel.clipSpans();
      const spans = (rate === null ? all : reel.watched()).sort((a, z) => z.to - z.from - (a.to - a.from));
      const span = all.find((c) => c.from <= sl.ts && sl.ts < c.to) ?? spans[0];
      if (span && span.clip.hi && target.clip && (rate !== null || !reel.inSlot().length)) {
        clipOn = true;
        target.playingChanged(true);
        target.clip(span, rate === null ? MAX_RATE : autoSpeed ? rate : 1);
        return;
      }
      const stops = reel.stops(FLIP_MAX);
      if (stops.length < 2) {
        return;
      }
      const frames = reel.shown(FLIP_MAX);
      let i = 0;
      const showAt = () => {
        target.show(reel.at(stops[i]), stops[i], i, stops.length);
        preloadAfter(frames, stops[i]);
      };
      target.playingChanged(true);
      showAt();
      timer = setInterval(() => {
        if (!alive()) {
          halt();
          current = null;
          return;
        }
        i = (i + 1) % stops.length;
        showAt();
      }, 1e3 / FLIP_FPS);
    }
    return {
      hover(slot) {
        if (!alive()) {
          halt();
          current = null;
          return;
        }
        const sl = slot && !slot.paused && !slot.beyond && (slot.count > 1 || anySlot && slot.frame || hasClip(slot)) ? slot : null;
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
      playing: () => timer !== null || clipOn
    };
  }

  // src/vt/timeline/card.ts
  function dressStrip(model) {
    const todo = model.slots.filter((sl) => sl.el && !sl.frame);
    const at = todo.map((sl) => ({ left: sl.el.offsetLeft, width: sl.el.offsetWidth }));
    todo.forEach((sl, i) => {
      const el = sl.el;
      el.style.backgroundPosition = -at[i].left + "px 0";
      if (sl.paused && at[i].width >= 90 && !el.querySelector(".band-label")) {
        const lab = document.createElement("span");
        lab.className = "band-label";
        lab.textContent = pauseInfo(sl).label;
        el.appendChild(lab);
      }
    });
  }
  function dressAll(s, tries) {
    const anySized = s.hosts.some((k) => s.cards[k.id] && s.cards[k.id].strip.clientWidth > 0);
    if (!anySized) {
      if (tries > 0 && !s.destroyed) {
        setTimeout(() => dressAll(s, tries - 1), 500);
      }
      return;
    }
    for (const k of s.hosts) {
      if (s.cards[k.id]) {
        dressStrip(s.cards[k.id].model);
      }
    }
  }
  function renderStrip(s, model, strip, host, tt) {
    const cells = [];
    for (const sl of model.slots) {
      const key = sl.frame ? "f:" + sl.frame.ts + ":" + sl.frame.url : sl.paused ? "p:" + sl.x0 : sl.beyond ? "b" : sl.clip ? "c:" + sl.clip.from + ":" + sl.clip.url : (sl.future ? "u:" : sl.nodata ? "n:" : "g:") + sl.x0;
      const last = cells[cells.length - 1];
      if ((sl.frame || sl.clip) && last && last.key === key) {
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
        img.alt = host + " " + tt.time(sl.frame.ts) + tt.sfx(sl.frame.ts);
        img.decoding = "async";
        img.referrerPolicy = "no-referrer";
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
    let clipsEl = strip.querySelector(".clips");
    const inWindow = s.cfg.videoLine ? model.clips.filter((c) => c.to > s.P.from && c.from < s.P.to) : [];
    if (inWindow.length && !clipsEl) {
      clipsEl = document.createElement("div");
      clipsEl.className = "clips";
      strip.appendChild(clipsEl);
    }
    if (clipsEl) {
      clipsEl.textContent = "";
      for (const c of inWindow) {
        const a = Math.max(c.from, s.P.from), b = Math.min(c.to, s.P.to);
        const m = document.createElement("div");
        m.className = "cliplane";
        m.style.left = ((a - s.P.from) / s.SPAN * 100).toFixed(4) + "%";
        m.style.width = ((b - a) / s.SPAN * 100).toFixed(4) + "%";
        clipsEl.appendChild(m);
      }
    }
    const tail = model.slots[model.slots.length - 1];
    if (tail && tail.beyond) {
      ruleBeyond(s, tail);
    }
  }
  function buildCard(s, decl, model) {
    const host = decl.id;
    const zone = zoneFor(decl, s.TZ, s.cfg.thumbTimes, s.PANEL_TT), tt = zone.tt;
    const card = document.createElement("div");
    const inline = s.cfg.headerMode === "inline" || s.cfg.headerMode === "inline-gradient";
    card.className = "card" + (inline ? " inline-head" : "") + (s.cfg.headerMode === "inline-gradient" ? " inline-grad" : "");
    const la = model.lastActive;
    const cad = s.cfg.showDetails && la ? '<span class="cad" title="' + esc(model.promised ? "Promises a frame every " + fmtDur(la.cadence) + "; one slot per " + fmtDur(la.step) : "Promises no cadence: frames are typically " + fmtDur(la.cadence) + " apart; one slot per " + fmtDur(la.step)) + '">\u23F1 ' + (model.promised ? "" : "~") + fmtDur(la.cadence) + " \xB7 1/" + fmtDur(la.step) + (la.step > la.cadence ? " \u2193" : "") + (model.promised ? "" : " \xB7 no promise") + "</span>" : "";
    card.innerHTML = '<div class="card-head" title="' + esc(headTitle(decl)) + '"><span class="nm"' + filterAttrs("host", host, !!s.cfg.onFilter) + ">" + esc(host) + '</span><span class="inline-brk"></span>' + zoneChip(zone.srcTZ) + headChips(decl, s.cfg.chips, !!s.cfg.onFilter) + '<span class="ft"></span>' + cad + '</div><div class="strip" tabindex="0" role="group" aria-label="' + esc(host + ": \u2190 \u2192 move along the timeline, Enter opens the preview") + '"><div class="xh"></div><div class="sel"></div><div class="mag"><img alt="" referrerpolicy="no-referrer"><div class="cap"></div></div></div><div class="card-lane"></div>';
    const strip = card.querySelector(".strip");
    renderStrip(s, model, strip, host, tt);
    dressStrip(model);
    let rec = null;
    const source = playerContext(s.backend, s.cfg, s.P, decl, model, tt, () => {
    });
    let unloop = null;
    const dropVideo = (m) => {
      m.classList.remove("flip-video");
      unloop?.();
      unloop = null;
      const v = m.querySelector("video");
      if (!v) {
        return;
      }
      releaseVideo(v);
      v.remove();
    };
    const flip = makeFlipbook({
      alive: () => !s.destroyed,
      reel: (slot) => new Reel(source, slot),
      show: (at, t, i, n) => {
        const m = rec?.mag;
        if (!m) {
          return;
        }
        const im = m.querySelector("img");
        if (at.frame && im.getAttribute("src") !== at.frame.url) {
          im.src = at.frame.url;
        }
        m.classList.toggle("flip-gap", at.gap || at.kind === "clip");
        const reason = at.kind === "dropped" ? "offline" : at.kind === "nodata" ? "no frame" : at.kind === "clip" ? "video" : at.kind === "paused" ? pauseInfo({ paused: true, label: at.interval?.pause?.label }).label.toLowerCase() : "";
        const ts = at.gap || at.kind === "clip" || !at.frame ? t : at.frame.ts;
        m.querySelector(".cap").textContent = tt.time(ts) + tt.sfx(ts) + (reason ? " \xB7 " + reason : "") + " \xB7 " + (i + 1) + "/" + n;
      },
      measure: (r) => measureReel(r, source.key),
      // a clip's part of the slot, the smaller version, muted, round and round
      clip: (span, rate = 1) => {
        const m = rec?.mag;
        if (!m) {
          return;
        }
        if (!span || s.destroyed) {
          dropVideo(m);
          return;
        }
        let v = m.querySelector("video");
        if (!v) {
          v = makeVideo(true);
          m.insertBefore(v, m.querySelector(".cap"));
        }
        unloop?.();
        m.classList.add("flip-video");
        unloop = loopClipSpan(v, span, rate, {
          metadata: (vid) => {
            noteClipLength(span.clip.url, vid.duration);
            if (vid.videoWidth && vid.videoHeight) {
              m.style.aspectRatio = String(vid.videoWidth / vid.videoHeight);
            }
          },
          time: (at) => {
            m.querySelector(".cap").textContent = "\u25B6 " + tt.time(at) + tt.sfx(at) + " \xB7 video";
          }
        });
      },
      playingChanged: (on) => {
        if (!rec) {
          return;
        }
        rec.mag.classList.toggle("flip", on);
        if (!on) {
          rec.mag.classList.remove("flip-gap");
        }
        if (!on && !s.destroyed) {
          rec.shown = null;
          setCursor(s, s.cursorT, null, true);
        }
      }
    }, !!s.backend.detail, (sl) => model.clips.some((c) => c.to > sl.x0 && c.from < sl.x0 + sl.span), !!s.cfg.videoAutoSpeed);
    const player = () => playerContext(
      s.backend,
      s.cfg,
      s.P,
      decl,
      model,
      tt,
      (t) => {
        if (!s.destroyed) {
          setCursor(s, t, null, false);
        }
      },
      s.cfg.onZoom ? (from, to) => {
        if (!s.destroyed) {
          s.cfg.onZoom(Math.floor(from), Math.ceil(to));
        }
      } : void 0
    );
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
    const openAt = (x, y) => {
      const sl = model.slotAt(s.cursorT);
      const f = sl && sl.frame;
      const g = !f && sl && sl.future ? ghostFor(model.slots, sl) : null;
      if (f) {
        s.pv.open(decl.site, host, f, x, y, f.hi ?? null, null, tt, player());
      } else if (sl && !sl.paused && !sl.beyond && sl.clip) {
        s.pv.play(decl.site, host, sl.ts, x, y, tt, player());
      } else if (g) {
        s.pv.open(decl.site, host, g, x, y, null, sl.ts, tt);
      }
    };
    strip.addEventListener("click", (e) => {
      flip.stop();
      if (s.suppressClick) {
        s.suppressClick = false;
        return;
      }
      openAt(e.clientX, e.clientY);
    });
    strip.addEventListener("keydown", (e) => {
      if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) {
        return;
      }
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const r = strip.getBoundingClientRect();
        openAt(r.left + r.width * (s.cursorT - s.P.from) / s.SPAN, r.top + r.height / 2);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const sl = model.slotAt(s.cursorT);
        const next = sl && model.slotAt(e.key === "ArrowRight" ? sl.x0 + sl.span : sl.x0 - 1);
        if (next && next !== sl) {
          setCursor(s, Math.max(next.x0, Math.min(next.x0 + next.span - 1, next.ts)), card, false);
        }
      }
    });
    strip.addEventListener("blur", () => {
      if (!s.wrap.classList.contains("strip-hover") && s.cfg.onHoverClear) {
        s.cfg.onHoverClear();
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
      player,
      // the mount's teardown: no flipbook, no video, left running
      teardown: () => {
        flip.stop();
        dropVideo(magEl);
      },
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
      for (const k of s.hosts) {
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
        for (const k of s.hosts) {
          if (appliesTo(a, k)) {
            (perCard[k.id] ||= []).push(a);
          }
        }
      }
      if (a.timeEnd) {
        const hosts = isGlobal(a) ? s.hosts.map((k) => s.cards[k.id].strip).concat([q(s.wrap, ".ann-lane")]) : s.hosts.filter((k) => appliesTo(a, k)).map((k) => s.cards[k.id].strip);
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
    const steps = s.hosts.map((k) => s.cards[k.id]?.model.step).filter((x) => !!x);
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
    for (const k of s.hosts) {
      const c = s.cards[k.id];
      if (!c) {
        continue;
      }
      const m = c.model;
      const last = m.frames.length ? m.frames[m.frames.length - 1].ts : s.P.from;
      let fresh, clips;
      try {
        const from = Math.max(last, s.P.from) + 1, to = Math.min(s.P.to, Date.now());
        fresh = s.backend.allFrames ? await s.backend.allFrames(k.site, k.id, from, to) : await s.backend.frames(k.site, k.id, from, to, m.step);
        clips = s.backend.clips ? await s.backend.clips(k.site, k.id, from, to) : void 0;
      } catch (e) {
        console.warn("[visual-timeline] live poll failed for " + k.id + ":", e);
        continue;
      }
      if (s.destroyed) {
        return;
      }
      m.refresh(fresh, Date.now(), clips);
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
    const MIN_SLICE_PX = frameWidthOf(cfg);
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
      hosts: [],
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
        s.hosts = (await backend.kiosks(P.site)).filter((k) => !P.source || P.source.includes(k.id)).filter((k) => matchesTags(k.tags, parseTagFilter(cfg.tagFilter)));
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
      const models = limited(s.hosts, MODEL_CONCURRENCY, (k) => s.destroyed ? Promise.resolve(null) : buildSourceModel(k, P, backend, pxBudget, { hold: s.cfg.hold, expected: s.cfg.expectedCadence, sample: s.cfg.sampleInterval }).catch((e) => {
        console.warn("[visual-timeline] model build failed for " + k.id + ":", e);
        return null;
      }));
      for (const [i, k] of s.hosts.entries()) {
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
      s.hosts = s.hosts.filter((k) => s.cards[k.id]);
      s.pv.rebind((site, id) => {
        const k = s.hosts.find((d) => d.site === site && d.id === id);
        return k ? s.cards[k.id].player?.() ?? null : null;
      });
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
        for (const c of Object.values(s.cards)) {
          c.teardown?.();
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
    el.querySelector("img").referrerPolicy = "no-referrer";
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
      } else if (rec.shownClip != null) {
        const player = playerContext(s.backend, s.cfg, s.P, decl, model, rec.tt, (t) => {
          if (!s.destroyed) {
            setShown(s, t);
          }
        });
        s.pv.play(decl.site, decl.id, rec.shownClip, e.clientX, e.clientY, rec.tt, player);
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
    for (const k of s.hosts) {
      const rec = s.tiles[k.id];
      if (!rec) {
        continue;
      }
      if (rec.zone.el) {
        dressZoneChip(rec.zone, zoneAt);
      }
      const tt = rec.tt;
      let frame = null, offMsg = null, pausedMsg = null, pausedAt = null, expectedTs = null, nodata = false, clipAt = null;
      const at = t == null ? live - 1 : t;
      const iv = rec.model.intervalAt(at);
      let kind = iv ? iv.kind : "nodata";
      const latest = t == null ? lastFrame(rec) : null;
      const clips = rec.model.clips;
      const lastClip = clips.length ? clips[clips.length - 1] : null;
      if (t == null && !s.LIVE && kind !== "paused") {
        kind = latest ? "frame" : lastClip && lastClip.from < at ? "clip" : "nodata";
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
      } else if (kind === "clip") {
        clipAt = t == null && lastClip ? Math.max(lastClip.from, Math.min(at, lastClip.to - 1)) : at;
        offMsg = "\u25B6 video \u2014 " + tt.time(clipAt) + tt.sfx(clipAt);
        nodata = true;
      } else if (kind === "beyond") {
        offMsg = "\u2014";
        nodata = true;
      } else {
        nodata = kind === "nodata";
        const last = frameBefore(rec, at);
        const ended = last ? null : clips.filter((c) => c.to <= at).pop();
        offMsg = last ? (nodata ? "NO FRAME" : "OFFLINE") + " \u2014 last seen " + tt.time(last.ts) + tt.sfx(last.ts) : ended ? (nodata ? "NO VIDEO" : "OFFLINE") + " \u2014 last clip ended " + tt.time(ended.to) + tt.sfx(ended.to) : t == null ? "no data in window" : "no data";
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
      rec.shownClip = clipAt;
      rec.el.classList.toggle("clip", clipAt !== null);
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
    for (const k of s.hosts) {
      const rec = s.tiles[k.id];
      if (!rec) {
        continue;
      }
      const last = lastFrame(rec);
      let fresh, clips;
      try {
        const from = Math.max(last ? last.ts : s.P.from, s.P.from) + 1, to = Math.min(s.P.to, Date.now());
        fresh = s.backend.allFrames ? await s.backend.allFrames(k.site, k.id, from, to) : await s.backend.frames(k.site, k.id, from, to, rec.model.step);
        clips = s.backend.clips ? await s.backend.clips(k.site, k.id, from, to) : void 0;
      } catch (e) {
        console.warn("[visual-timeline] live poll failed for " + k.id + ":", e);
        continue;
      }
      if (s.destroyed) {
        return;
      }
      rec.model.refresh(fresh, Date.now(), clips);
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
      hosts: [],
      tiles: {},
      destroyed: false,
      pollTimer: null,
      shownT: null,
      pv: makePreview(root, TZ),
      PANEL_TT: zoneTexts(TZ, TZ, false)
    };
    (async function boot() {
      try {
        s.hosts = (await backend.kiosks(P.site)).filter((k) => !P.source || P.source.includes(k.id)).filter((k) => matchesTags(k.tags, parseTagFilter(cfg.tagFilter)));
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
      const models = limited(s.hosts, MODEL_CONCURRENCY, (k) => s.destroyed ? Promise.resolve(null) : buildSourceModel(k, P, backend, budget, { hold: s.cfg.hold, expected: s.cfg.expectedCadence, sample: s.cfg.sampleInterval }).catch((e) => {
        console.warn("[visual-timeline] model build failed for " + k.id + ":", e);
        return null;
      }));
      for (const [i, k] of s.hosts.entries()) {
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
      s.hosts = s.hosts.filter((k) => s.tiles[k.id]);
      s.pv.rebind((site, id) => {
        const t = s.hosts.find((d) => d.site === site && d.id === id) && s.tiles[id];
        return t ? playerContext(s.backend, s.cfg, s.P, t.decl, t.model, t.tt, (at) => {
          if (!s.destroyed) {
            setShown(s, at);
          }
        }) : null;
      });
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
