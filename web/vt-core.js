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
    KTL_VAR_DEFAULTS: () => KTL_VAR_DEFAULTS,
    PAUSE_CLASSES: () => PAUSE_CLASSES,
    TICK_STEPS: () => TICK_STEPS,
    alignedStart: () => alignedStart,
    axisTicks: () => axisTicks,
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
    makeApiBackend: () => makeApiBackend,
    matchesTags: () => matchesTags,
    missedHeartbeat: () => missedHeartbeat,
    mountGrid: () => mountGrid,
    mountTimeline: () => mountTimeline,
    nextTick: () => nextTick,
    parseTagFilter: () => parseTagFilter,
    pauseInfo: () => pauseInfo,
    resolveFrameUrl: () => resolveFrameUrl,
    resolveTimeZone: () => resolveTimeZone,
    slotClass: () => slotClass,
    sourceTimeZone: () => sourceTimeZone,
    sourcesPath: () => sourcesPath,
    tagChips: () => tagChips,
    tickFormat: () => tickFormat,
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
  var zoneWarned = /* @__PURE__ */ new Set();
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
    if (!zoneWarned.has(s)) {
      zoneWarned.add(s);
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
  function tickFormat(stepMs, tz) {
    const z = zoneOf(tz);
    if (stepMs < 36e5) {
      const f = z.fmt("short", F_SHORT);
      return (ts) => f.format(ts);
    }
    if (stepMs < 24 * 36e5) {
      const f = z.fmt("dayhm", F_DAY_HM);
      return (ts) => f.format(ts);
    }
    if (stepMs < 365 * 864e5) {
      const f = z.fmt("day", F_DAY);
      return (ts) => f.format(ts);
    }
    return (ts) => String(new Date(wallOf(ts, z)).getUTCFullYear());
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
      evts.push({ since: h.since, cadence: h.cadence, paused: !!h.paused, reason: h.reason, intended: h.intended });
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
      if (prev && prev.paused === !!e.paused && prev.cadence === runCad && prev.reason === e.reason && prev.intended === e.intended) {
        prev.to = to;
        continue;
      }
      eras.push({ from, to, cadence: runCad, paused: !!e.paused, reason: e.reason, intended: e.intended });
    }
    if (!eras.length) {
      eras.push({ from: P.from, to: P.to, cadence: runCad, paused: false });
    }
    return eras;
  }
  var PAUSE_CLASSES = ["paused", "unintended", "r-quiet", "r-screen-sleep", "r-app-stopped", "r-system-down"];
  function clearPauseClasses(el) {
    el.classList.remove(...PAUSE_CLASSES);
    for (const c of Array.from(el.classList)) {
      if (c.startsWith("r-")) {
        el.classList.remove(c);
      }
    }
  }
  function pauseInfo(x) {
    const r = x && x.reason;
    const unintended = !!x && x.intended === false;
    const label = r === "screen-sleep" ? unintended ? "SCREEN DARK (UNEXPECTED)" : "SCREEN ASLEEP" : r === "system-down" ? "SYSTEM DOWN (PLANNED)" : r === "app-stopped" ? "APP STOPPED" : r === "quiet" ? "QUIET HOURS" : "PAUSED";
    const classes = ["paused"];
    if (r) {
      classes.push("r-" + String(r).replace(/[^\w-]/g, ""));
    }
    if (unintended) {
      classes.push("unintended");
    }
    return { label, classes };
  }

  // src/vt/model/slots.ts
  async function buildSourceModel(decl, P, backend, budgetSlots) {
    const eras = erasFor(decl, P);
    const slots = [];
    const totalActive = eras.filter((e) => !e.paused).reduce((a, e) => a + (e.to - e.from), 0) || 1;
    function shortEraSlot(era, frame, nowMs) {
      return {
        ts: era.from,
        span: era.to - era.from,
        frame,
        cadence: era.cadence,
        step: era.cadence,
        future: era.from + era.cadence >= nowMs
      };
    }
    function resolveBoundary(prev, firstIdx) {
      if (!prev || firstIdx <= prev.startIdx || firstIdx >= slots.length) {
        return;
      }
      const p = slots[firstIdx - 1];
      const first = slots[firstIdx];
      if (p.paused || p.beyond || p.ts !== prev.to) {
        return;
      }
      const laterDrawsIt = !first.paused && !first.beyond && first.ts === p.ts;
      if (!laterDrawsIt && !(first.paused && !p.frame)) {
        return;
      }
      if (laterDrawsIt && !first.frame && p.frame) {
        first.frame = p.frame;
      }
      slots.splice(firstIdx - 1, 1);
      if (firstIdx - 1 === prev.startIdx) {
        slots.splice(prev.startIdx, 0, shortEraSlot(prev, null, Date.now()));
      }
    }
    async function pushActive(era) {
      if (era.to - era.from <= 0) {
        return;
      }
      const eraSpan = era.to - era.from;
      const share = Math.max(4, Math.round(budgetSlots * (eraSpan / totalActive)));
      const raw = Math.max(1, Math.ceil(eraSpan / era.cadence));
      const step = Math.ceil(raw / Math.min(share, raw)) * era.cadence;
      const start = Math.ceil(era.from / step) * step;
      const n = era.to >= start ? Math.floor((era.to - start) / step) + 1 : 0;
      const nowMs = Date.now();
      if (n === 0) {
        const half = era.cadence / 2;
        const near = await backend.frames(decl.site, decl.id, era.from - half, era.to + half, era.cadence);
        const frame = near.filter((f) => f.ts >= era.from - half && f.ts <= era.to + half).sort((a, b) => Math.abs(a.ts - era.from) - Math.abs(b.ts - era.from))[0] || null;
        slots.push(shortEraSlot(era, frame, nowMs));
        return;
      }
      const frames = await backend.frames(decl.site, decl.id, era.from, era.to, step);
      const by = new Map(frames.map((f) => [Math.round((f.ts - start) / step), f]));
      for (let i = 0; i < n; i++) {
        const ts = start + i * step;
        slots.push({ ts, span: step, frame: by.get(i) || null, cadence: era.cadence, step, future: ts + step >= nowMs });
      }
    }
    const nowAtBuild = Date.now();
    const horizon = Math.min(P.to, nowAtBuild);
    let prevActive = null;
    for (const era of eras) {
      const eFrom = era.from;
      const eTo = Math.min(era.to, horizon);
      const isTail = era === eras[eras.length - 1];
      const firstIdx = slots.length;
      const prev = prevActive;
      prevActive = null;
      if (!era.paused) {
        if (eTo > eFrom) {
          const span = { from: eFrom, to: eTo, cadence: era.cadence };
          await pushActive(span);
          resolveBoundary(prev, firstIdx);
          prevActive = { ...span, startIdx: firstIdx };
        }
        continue;
      }
      if (!isTail) {
        if (eTo > eFrom) {
          slots.push({ ts: eFrom, span: eTo - eFrom, paused: true, reason: era.reason, intended: era.intended });
          resolveBoundary(prev, firstIdx);
        }
        continue;
      }
      if (eTo <= eFrom) {
        continue;
      }
      const probe = await backend.frames(decl.site, decl.id, eFrom, eTo, era.cadence);
      const tailIdx = slots.length;
      const resume = probe.find((f) => f.ts >= eFrom + era.cadence && f.ts < eTo);
      if (resume) {
        const resumeTs = resume.ts;
        slots.push({ ts: eFrom, span: resumeTs - eFrom, paused: true, reason: era.reason, intended: era.intended });
        if (eTo > resumeTs) {
          await pushActive({ from: resumeTs, to: eTo, cadence: era.cadence });
        }
      } else {
        slots.push({ ts: eFrom, span: eTo - eFrom, paused: true, reason: era.reason, intended: era.intended });
      }
      resolveBoundary(prev, tailIdx);
    }
    if (P.to > horizon) {
      const last = slots[slots.length - 1];
      const covered = !last ? horizon : last.paused || last.beyond ? last.ts + last.span : last.ts + last.step / 2;
      const fillerFrom = Math.min(Math.max(covered, horizon - 1), P.to);
      if (P.to - fillerFrom > 0) {
        slots.push({ ts: fillerFrom, span: P.to - fillerFrom, beyond: true });
      }
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
            if (prev && !prev.beyond && t < sl.ts + (prev.step || 0) / 2) {
              return prev;
            }
          }
          return t >= from || sl === slots[0] ? sl : sl;
        }
      }
      return slots[slots.length - 1] || null;
    }
    const lastActive = [...slots].reverse().find((sl) => !sl.paused && !sl.beyond) || null;
    return { eras, slots, slotAt, lastActive };
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
    return sl.paused ? " " + pauseInfo(sl).classes.join(" ") : sl.beyond ? " beyond" : sl.frame ? "" : sl.future ? " future" : " gap";
  }
  function missedHeartbeat(sl, now) {
    return sl.future && !sl.frame && sl.ts + sl.step < now;
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
    if (!zoneWarned.has(s)) {
      zoneWarned.add(s);
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
  function makeApiBackend(apiUrl, apiKey, apiFetch) {
    const base = (apiUrl || "").replace(/\/+$/, "");
    const key = apiFetch ? "" : apiKey;
    const opts = () => ({
      headers: key ? { authorization: "Bearer " + key } : void 0,
      signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(15e3) : void 0
    });
    const get = apiFetch ? (path) => apiFetch(path) : (path) => fetch(base + path, opts());
    return {
      async kiosks(sites) {
        const r = await get(sourcesPath(sites));
        if (!r.ok) {
          throw new Error("kiosks " + r.status);
        }
        return r.json();
      },
      async frames(site, kiosk, from, to, step) {
        const r = await get(framesPath(site, kiosk, from, to, step));
        if (!r.ok) {
          throw new Error("frames " + r.status);
        }
        const frames = await r.json();
        for (const f of frames) {
          f.url = apiFetch ? resolveFrameUrl(f.url, base) : imageUrlWithKey(f.url, base, key);
        }
        return frames;
      }
    };
  }
  function hiUrlFor(frame, decl, apiUrl, apiKey) {
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
    const q2 = qAt >= 0 ? url.slice(qAt) : apiKey ? "?k=" + encodeURIComponent(apiKey) : "";
    const hiTs = Math.round(frame.ts / decl.hiCadence) * decl.hiCadence;
    return base + "/frame/hi/" + encodeURIComponent(decl.site) + "/" + encodeURIComponent(decl.id) + "/" + hiTs + ".jpg" + q2;
  }

  // src/vt/dom/html.ts
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => "&#" + c.charCodeAt(0) + ";");
  }
  function tagChips(decl) {
    if (!decl.tags) {
      return "";
    }
    const chips = Object.entries(decl.tags).map(([k, v]) => '<span class="st">' + esc(k) + ":" + esc(v) + "</span>").join("");
    return '<span class="tags">' + chips + "</span>";
  }
  function headTitle(decl) {
    const parts = [decl.site];
    if (decl.location) {
      parts.push(decl.location);
    }
    if (decl.tags) {
      for (const [k, v] of Object.entries(decl.tags)) {
        parts.push(k + ":" + v);
      }
    }
    return parts.join(" \xB7 ");
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
    "--ktl-sleep-a": "#182a4e",
    "--ktl-sleep-b": "#223c6e",
    "--ktl-sleep": "#8fb0e8",
    "--ktl-down-a": "#28204a",
    "--ktl-down-b": "#372c66",
    "--ktl-down": "#a897e0",
    "--ktl-stopped-a": "#123832",
    "--ktl-stopped-b": "#1a4c44",
    "--ktl-stopped": "#6fc4b4",
    "--ktl-unint-a": "#4a350e",
    "--ktl-unint-b": "#614614",
    "--ktl-unint": "#e8b155",
    "--ktl-ann": "#5794F2",
    "--ktl-ann-edge": "#0b0c0e",
    "--ktl-ann-region": "rgba(87,148,242,.12)",
    "--ktl-ann-region-edge": "rgba(87,148,242,.55)"
  };
  var KTL_VARS = Object.keys(KTL_VAR_DEFAULTS);
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
.ktl .slot.gap { background:repeating-linear-gradient(45deg,var(--ktl-gap-a),var(--ktl-gap-a) 5px,var(--ktl-gap-b) 5px,var(--ktl-gap-b) 10px); }
.ktl .slot.paused { background:repeating-linear-gradient(45deg,var(--ktl-pause-a),var(--ktl-pause-a) 7px,var(--ktl-pause-b) 7px,var(--ktl-pause-b) 14px); }
/* pause REASONS: one color grammar with the dashboards \u2014 planned = distinct
 * cool hues (indigo = screen asleep, violet-slate = system down, teal = app
 * stopped), unintended = amber, undeclared silence stays the red .gap.
 * Reason classes replace the hatch; .unintended overrides them all. */
.ktl .slot.paused.r-screen-sleep { background:repeating-linear-gradient(45deg,var(--ktl-sleep-a),var(--ktl-sleep-a) 7px,var(--ktl-sleep-b) 7px,var(--ktl-sleep-b) 14px); }
.ktl .slot.paused.r-system-down { background:repeating-linear-gradient(45deg,var(--ktl-down-a),var(--ktl-down-a) 7px,var(--ktl-down-b) 7px,var(--ktl-down-b) 14px); }
.ktl .slot.paused.r-app-stopped { background:repeating-linear-gradient(45deg,var(--ktl-stopped-a),var(--ktl-stopped-a) 7px,var(--ktl-stopped-b) 7px,var(--ktl-stopped-b) 14px); }
.ktl .slot.paused.unintended { background:repeating-linear-gradient(45deg,var(--ktl-unint-a),var(--ktl-unint-a) 7px,var(--ktl-unint-b) 7px,var(--ktl-unint-b) 14px); }
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
.ktl .slot.r-screen-sleep .band-label { color:var(--ktl-sleep); }
.ktl .slot.r-system-down .band-label { color:var(--ktl-down); }
.ktl .slot.r-app-stopped .band-label { color:var(--ktl-stopped); }
.ktl .slot.unintended .band-label { color:var(--ktl-unint); }
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
  function makeBackend(P, SPAN, tz) {
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
      const own = DEMO_ZONES[kiosk];
      g.fillText(fmtTime(ts, own || tz), w / 2, h * 0.55);
      if (own) {
        g.font = Math.round(Math.min(h * 0.055, w * 0.06)) + "px sans-serif";
        g.fillText(zoneLabel(own) + " local time", w / 2, h * 0.655);
      }
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
        const m = /^(?:source|kiosk):(.+)$/.exec(t);
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

  // src/vt/ui/preview.ts
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
      open(site, kiosk, frame, x, y, hiUrl, expectedTs, tt) {
        tt = tt || panelTexts;
        closePreview();
        const el = document.createElement("div");
        el.className = "ktl-pop" + (expectedTs ? " ghost" : "");
        copyVars(root, el);
        el.innerHTML = '<img alt="frame"><div class="cap"></div>';
        const img = el.querySelector("img");
        el.querySelector(".cap").textContent = site + " / " + kiosk + " \u2014 " + (expectedTs ? "expected " + tt.short(expectedTs) + " \xB7 last frame " + tt.time(frame.ts) : tt.time(frame.ts)) + tt.sfx(frame.ts);
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
  async function revealWrapper(root, wrap) {
    const imgs = [...wrap.querySelectorAll("img")];
    await Promise.race([
      Promise.allSettled(imgs.map((i) => i.decode ? i.decode().catch(() => {
      }) : Promise.resolve())),
      new Promise((res) => setTimeout(res, 900))
    ]);
    if (!wrap.isConnected) {
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
    ac.style.left = Math.max(acW / 2, Math.min(axisW - acW / 2, frac * axisW)) + "px";
    for (const k of s.kiosks) {
      const c = s.cards[k.id];
      if (!c) {
        continue;
      }
      const { w, magW } = widths.get(k.id);
      if (!external) {
        c.card.classList.toggle("hovered", hoveredCard === c.card);
      }
      const x = frac * w;
      c.cross.style.left = x + "px";
      const slot = c.model.slotAt(s.cursorT);
      const tt = c.tt;
      if (c.zone.el) {
        dressZoneChip(c.zone, s.cursorT);
      }
      c.mag.style.left = Math.max(0, Math.min(w - magW, x - magW / 2)) + "px";
      c.mag.classList.remove("ghost");
      if (slot && slot.frame) {
        c.mag.classList.remove("gap", "future", "off");
        clearPauseClasses(c.mag);
        c.mag.querySelector("img").src = slot.frame.url;
        c.mag.querySelector(".cap").textContent = tt.time(slot.frame.ts) + tt.sfx(slot.frame.ts);
        c.head.textContent = "";
        c.head.classList.remove("stale");
        clearPauseClasses(c.head);
      } else if (slot && slot.paused) {
        const pi = pauseInfo(slot);
        c.mag.classList.remove("gap", "future", "off");
        clearPauseClasses(c.mag);
        c.mag.classList.add(...pi.classes);
        c.mag.querySelector(".cap").textContent = pi.label.toLowerCase();
        c.head.textContent = pi.label.toLowerCase();
        c.head.classList.remove("stale");
        clearPauseClasses(c.head);
        c.head.classList.add(...pi.classes);
      } else if (slot && slot.beyond) {
        c.mag.classList.remove("gap", "future");
        clearPauseClasses(c.mag);
        c.mag.classList.add("off");
        c.head.textContent = "";
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
          c.mag.querySelector("img").src = g.url;
        }
        c.mag.querySelector(".cap").textContent = (inFlight ? "expected \u2014 " : "upcoming \u2014 ") + tt.short(slot.ts) + (g ? " \xB7 last frame " + tt.time(g.ts) : "") + tt.sfx(slot.ts);
        c.head.textContent = inFlight ? "expected" : "upcoming";
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
        const msg = last ? "offline \u2014 last seen " + tt.time(last.ts) + tt.sfx(last.ts) : "no data in window";
        c.mag.querySelector(".cap").textContent = msg;
        c.head.textContent = msg;
        c.head.classList.add("stale");
        clearPauseClasses(c.head);
      }
    }
    if (!external && s.cfg.onHover) {
      s.cfg.onHover(s.cursorT);
    }
  }

  // src/vt/time/measure.ts
  var TICK_FONT = '10px -apple-system, "Segoe UI", Roboto, sans-serif';
  var TICK_LABEL_GAP = 14;
  var measureCtx;
  function measureTickWidth(text) {
    if (!measureCtx) {
      measureCtx = document.createElement("canvas").getContext("2d");
    }
    measureCtx.font = TICK_FONT;
    return measureCtx.measureText(text).width;
  }

  // src/vt/timeline/axis.ts
  function buildAxis(s) {
    const axis = q(s.wrap, ".axis");
    const w = axis.clientWidth;
    const roughMaxTicks = Math.max(3, Math.floor(w / 90));
    const roughStep = TICK_STEPS.find((st) => s.SPAN / st <= roughMaxTicks) || TICK_STEPS[TICK_STEPS.length - 1];
    const sampleWidth = measureTickWidth(tickFormat(roughStep, s.TZ)(s.P.to));
    const maxTicks = Math.max(3, Math.floor(w / (sampleWidth + TICK_LABEL_GAP)));
    const tickStep = TICK_STEPS.find((st) => s.SPAN / st <= maxTicks) || TICK_STEPS[TICK_STEPS.length - 1];
    const fmt = tickFormat(tickStep, s.TZ);
    axis.querySelectorAll(".tick").forEach((t) => t.remove());
    s.axisTickList.length = 0;
    for (const ts of axisTicks(s.P.from, s.P.to, tickStep, s.TZ)) {
      s.axisTickList.push(ts);
      const el = document.createElement("div");
      el.className = "tick";
      el.style.left = (ts - s.P.from) / s.SPAN * w + "px";
      el.textContent = fmt(ts);
      axis.appendChild(el);
    }
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
  function buildCard(s, decl, model) {
    const kiosk = decl.id;
    const zone = zoneFor(decl, s.TZ, s.cfg.thumbTimes, s.PANEL_TT), tt = zone.tt;
    const card = document.createElement("div");
    const inline = s.cfg.headerMode === "inline" || s.cfg.headerMode === "inline-gradient";
    card.className = "card" + (inline ? " inline-head" : "") + (s.cfg.headerMode === "inline-gradient" ? " inline-grad" : "");
    const la = model.lastActive;
    const cad = s.cfg.showDetails && la ? '<span class="cad">\u23F1 ' + fmtDur(la.cadence) + " \xB7 1/" + fmtDur(la.step) + (la.step > la.cadence ? " \u2193" : "") + "</span>" : "";
    card.innerHTML = '<div class="card-head" title="' + esc(headTitle(decl)) + '"><span class="nm">' + esc(kiosk) + '</span><span class="inline-brk"></span>' + zoneChip(zone.srcTZ) + '<span class="st">' + esc(decl.site) + (decl.location ? " \xB7 " + esc(decl.location) : "") + "</span>" + tagChips(decl) + '<span class="ft"></span>' + cad + '</div><div class="strip"><div class="xh"></div><div class="sel"></div><div class="mag"><img alt=""><div class="cap"></div></div></div><div class="card-lane"></div>';
    const strip = card.querySelector(".strip");
    if (s.hostWidth / model.slots.length >= 12) {
      strip.classList.add("sep");
    }
    const slots = model.slots;
    for (const sl of slots) {
      const el = document.createElement("div");
      el.className = "slot" + slotClass(sl);
      if (sl.paused) {
        el.title = pauseInfo(sl).label.toLowerCase();
      }
      el.style.flexGrow = String(sl.span / 1e3);
      if (sl.frame) {
        const img = document.createElement("img");
        img.src = sl.frame.url;
        img.alt = kiosk + " " + tt.time(sl.ts) + tt.sfx(sl.ts);
        el.appendChild(img);
      }
      strip.appendChild(el);
      sl.el = el;
    }
    for (const sl of slots) {
      if (sl.future) {
        dressGhost(slots, sl);
      }
    }
    dressStrip(model);
    const hoverAt = (e) => {
      const r = strip.getBoundingClientRect();
      if (!r.width) {
        return;
      }
      const t = s.P.from + s.SPAN * ((e.clientX - r.left) / r.width);
      setCursor(s, t, card, false);
    };
    strip.addEventListener("mousemove", hoverAt);
    strip.addEventListener("mouseenter", (e) => {
      s.wrap.classList.add("strip-hover");
      hoverAt(e);
    });
    strip.addEventListener("mouseleave", () => {
      s.wrap.classList.remove("strip-hover");
      if (s.cfg.onHoverClear) {
        s.cfg.onHoverClear();
      }
    });
    strip.addEventListener("click", (e) => {
      if (s.suppressClick) {
        s.suppressClick = false;
        return;
      }
      const sl = model.slotAt(s.cursorT);
      const f = sl && sl.frame;
      const g = !f && sl && sl.future ? ghostFor(model.slots, sl) : null;
      if (f) {
        s.pv.open(decl.site, kiosk, f, e.clientX, e.clientY, hiUrlFor(f, decl, s.cfg.apiUrl, s.cfg.apiKey), null, tt);
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
    return {
      card,
      model,
      zone,
      tt,
      head: card.querySelector(".ft"),
      strip,
      cross: card.querySelector(".xh"),
      sel: card.querySelector(".sel"),
      mag: card.querySelector(".mag"),
      lane: card.querySelector(".card-lane")
    };
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
    const steps = s.kiosks.map((k) => s.cards[k.id].model.lastActive && s.cards[k.id].model.lastActive.step).filter(Boolean);
    const minStep = steps.length ? Math.min.apply(null, steps) : 6e4;
    s.pollTimer = setInterval(async () => {
      for (const k of s.kiosks) {
        const c = s.cards[k.id];
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
              if (prev.el) {
                prev.el.style.flexGrow = String(prev.span / 1e3);
              }
              if (filler.span <= 0) {
                if (filler.el) {
                  filler.el.remove();
                }
                mSlots.pop();
              } else {
                if (filler.el) {
                  filler.el.style.flexGrow = String(filler.span / 1e3);
                }
                ruleBeyond(s, filler);
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
              if (f.el && f.el.parentNode) {
                f.el.parentNode.insertBefore(el, f.el);
              }
              sl.el = el;
              mSlots.splice(mSlots.length - 1, 0, sl);
              f.span -= sl.span;
              f.ts += sl.span;
              if (f.span <= 0) {
                if (f.el) {
                  f.el.remove();
                }
                mSlots.pop();
              } else {
                if (f.el) {
                  f.el.style.flexGrow = String(f.span / 1e3);
                }
                ruleBeyond(s, f);
              }
              nextTs += prev.step;
            }
          }
        }
        const la = c.model.lastActive;
        if (!la) {
          continue;
        }
        let lastTs = s.P.from;
        for (let i = c.model.slots.length - 1; i >= 0; i--) {
          if (c.model.slots[i].frame) {
            lastTs = c.model.slots[i].ts;
            break;
          }
        }
        const fresh = await s.backend.frames(k.site, k.id, lastTs + 1, Date.now(), la.step);
        if (s.destroyed) {
          return;
        }
        for (const f of fresh) {
          const slot = c.model.slotAt(f.ts);
          if (!slot || slot.paused || slot.beyond) {
            continue;
          }
          if (slot.frame && f.ts <= slot.frame.ts) {
            continue;
          }
          slot.frame = f;
          slot.future = false;
          slot.el.classList.remove("gap", "future");
          let img = slot.el.querySelector("img");
          if (!img) {
            img = document.createElement("img");
            slot.el.appendChild(img);
          }
          img.classList.remove("ghost");
          img.src = f.url;
          img.alt = k.id + " " + c.tt.time(f.ts) + c.tt.sfx(f.ts);
        }
        const overdue = Date.now();
        for (const sl of c.model.slots) {
          if (missedHeartbeat(sl, overdue)) {
            sl.future = false;
            if (sl.el) {
              sl.el.classList.remove("future");
              sl.el.classList.add("gap");
            }
          }
        }
        for (const sl of c.model.slots) {
          dressGhost(c.model.slots, sl);
        }
      }
    }, Math.min(minStep, 1e4));
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
    const backend = cfg.apiUrl || cfg.apiFetch ? makeApiBackend(cfg.apiUrl, cfg.apiKey, cfg.apiFetch) : makeBackend(P, SPAN, TZ);
    const wrap = makeWrapper(root);
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
      suppressClick: false,
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
        err.textContent = "frames API unreachable \u2014 " + (e && e.message ? e.message : e);
        q(s.wrap, ".cards").appendChild(err);
        await revealWrapper(root, wrap);
        return;
      }
      for (const k of s.kiosks) {
        if (s.destroyed) {
          return;
        }
        let model;
        try {
          model = await buildSourceModel(k, P, backend, pxBudget);
        } catch (e) {
          console.warn("[visual-timeline] model build failed for " + k.id + ":", e);
          continue;
        }
        if (s.destroyed) {
          return;
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
      await revealWrapper(root, wrap);
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
    el.innerHTML = '<div class="t-head" title="' + esc(headTitle(decl)) + '"><span class="nm">' + esc(decl.id) + '</span><span class="inline-brk"></span>' + zoneChip(zone.srcTZ) + '<span class="st">' + esc(decl.site) + (decl.location ? " \xB7 " + esc(decl.location) : "") + "</span>" + tagChips(decl) + '</div><div class="t-img"><img alt="' + esc(decl.id) + '"><span class="t-ts"></span><div class="t-off"></div></div>';
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
        s.pv.open(decl.site, decl.id, rec.shown, e.clientX, e.clientY, hiUrlFor(rec.shown, decl, s.cfg.apiUrl, s.cfg.apiKey), null, rec.tt);
      }
    });
    q(s.wrap, ".grid").appendChild(el);
    return rec;
  }
  function lastFrame(rec) {
    for (let i = rec.model.slots.length - 1; i >= 0; i--) {
      if (rec.model.slots[i].frame) {
        return rec.model.slots[i].frame;
      }
    }
    return null;
  }
  function setShown(s, t) {
    s.shownT = t;
    if (s.cfg.onShown) {
      s.cfg.onShown(t);
    }
    const zoneAt = t == null ? Math.min(s.P.to, Date.now()) : t;
    for (const k of s.kiosks) {
      const rec = s.tiles[k.id];
      if (!rec) {
        continue;
      }
      if (rec.zone.el) {
        dressZoneChip(rec.zone, zoneAt);
      }
      const tt = rec.tt;
      let frame = null, offMsg = null, pausedMsg = null, pausedSlot = null, expectedTs = null;
      const la = rec.model.lastActive;
      if (t == null) {
        const tail = rec.model.slots.length ? rec.model.slots[rec.model.slots.length - 1] : null;
        const tailPaused = tail && tail.paused;
        frame = lastFrame(rec);
        if (tailPaused) {
          pausedSlot = tail;
          pausedMsg = pauseInfo(tail).label + (frame ? " \u2014 last frame " + tt.time(frame.ts) + tt.sfx(frame.ts) : "");
        } else if (!frame) {
          offMsg = "no data in window";
        } else if (s.LIVE && la && Date.now() - frame.ts > 2 * la.step) {
          offMsg = "OFFLINE \u2014 last seen " + tt.time(frame.ts) + tt.sfx(frame.ts);
        }
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
              frame = ghostFor(rec.model.slots, slot);
              if (frame) {
                expectedTs = slot.ts;
              } else {
                offMsg = "EXPECTED \u2014 " + tt.short(slot.ts) + tt.sfx(slot.ts);
              }
            } else {
              const i = slot ? rec.model.slots.indexOf(slot) : rec.model.slots.length - 1;
              let last = null;
              for (let j = i; j >= 0; j--) {
                if (rec.model.slots[j].frame) {
                  last = rec.model.slots[j].frame;
                  break;
                }
              }
              offMsg = last ? "OFFLINE \u2014 last seen " + tt.time(last.ts) + tt.sfx(last.ts) : "no data";
            }
          }
        }
      }
      rec.el.classList.toggle("offline", !!offMsg);
      clearPauseClasses(rec.el);
      if (pausedMsg && !offMsg) {
        rec.el.classList.add(...pauseInfo(pausedSlot).classes);
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
    s.pollTimer = setInterval(async () => {
      for (const k of s.kiosks) {
        const rec = s.tiles[k.id];
        const la = rec.model.lastActive;
        if (!la) {
          continue;
        }
        const last = lastFrame(rec);
        const fresh = await s.backend.frames(k.site, k.id, (last ? last.ts : s.P.from) + 1, Date.now(), la.step);
        if (s.destroyed) {
          return;
        }
        for (const f of fresh) {
          const slot = rec.model.slotAt(f.ts);
          if (!slot || slot.paused || slot.beyond) {
            continue;
          }
          if (!slot.frame || f.ts > slot.frame.ts) {
            slot.frame = f;
          }
        }
      }
      if (s.shownT == null) {
        setShown(s, null);
      }
    }, 1e4);
  }

  // src/vt/grid/mount.ts
  function mountGrid(root, cfg) {
    injectStyles();
    const P = { site: parseVar(cfg.site), source: parseVar(cfg.source), from: cfg.from, to: cfg.to };
    const TZ = resolveTimeZone(cfg.timeZone);
    const SPAN = Math.max(1, P.to - P.from);
    const LIVE = P.to > Date.now() - 2 * 60 * 1e3;
    const backend = cfg.apiUrl || cfg.apiFetch ? makeApiBackend(cfg.apiUrl, cfg.apiKey, cfg.apiFetch) : makeBackend(P, SPAN, TZ);
    const budget = 120;
    const wrap = makeWrapper(root);
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
        err.textContent = "frames API unreachable \u2014 " + (e && e.message ? e.message : e);
        q(s.wrap, ".grid").appendChild(err);
        await revealWrapper(root, wrap);
        return;
      }
      for (const k of s.kiosks) {
        if (s.destroyed) {
          return;
        }
        let model;
        try {
          model = await buildSourceModel(k, P, backend, budget);
        } catch (e) {
          console.warn("[visual-timeline] model build failed for " + k.id + ":", e);
          continue;
        }
        if (s.destroyed) {
          return;
        }
        if (cfg.hideEmpty && !model.slots.some((sl) => sl.frame || sl.paused)) {
          continue;
        }
        s.tiles[k.id] = buildTile(s, k, model);
      }
      s.kiosks = s.kiosks.filter((k) => s.tiles[k.id]);
      setShown(s, null);
      await revealWrapper(root, wrap);
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
