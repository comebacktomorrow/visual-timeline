// Scrub benchmark (#64): how much work one cursor move costs with N sources.
//
//   npm run bench:scrub                      # 20 sources, timeline, 1x and 4x CPU
//   node perf/scrub-bench.mjs --sources 40 --mode grid --cpu 1,4,6 --json out.json
//
// Loads perf/harness.html (the built web/vt-core.js plus a synthetic frames
// API) in Chromium and measures two paths:
//  - hover: real mouse moves across a strip, as a viewer scrubbing;
//  - sync:  setExternalCursor calls, as the shared crosshair from another panel.
// Reports per-move handler time (mean, p50, p95), layouts and style recalcs
// per move (forced reflows show up here), and long tasks. Uses the
// Playwright Chromium; set BENCH_CHROMIUM to point at another binary.
import { chromium } from '@playwright/test';
import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1]]] : a), [])
);
const SOURCES = Number(args.sources || 20);
const MODE = args.mode || 'timeline';
const CPU = String(args.cpu || '1,4')
  .split(',')
  .map(Number);
const MOVES = Number(args.moves || 240);
const RUNS = Number(args.runs || 3);

const here = dirname(fileURLToPath(import.meta.url));
const url = pathToFileURL(join(here, 'harness.html')).href + `?sources=${SOURCES}&mode=${MODE}`;

const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : 0;
};
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const round = (x, d = 3) => Number(x.toFixed(d));

async function metrics(cdp) {
  const { metrics } = await cdp.send('Performance.getMetrics');
  return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
}

async function once(browser, cpu) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1600 } });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  await page.goto(url);
  const sel = MODE === 'grid' ? '.ktl .tile img' : '.ktl .card .slot';
  await page.waitForFunction((s) => document.querySelectorAll(s).length > 0, sel, { timeout: 30000 });
  await page.waitForTimeout(500);
  const slots = await page.evaluate(() => document.querySelectorAll('.ktl .slot, .ktl .tile').length);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });

  // per-event handler time: a window capture listener runs first, a window
  // bubble listener runs after the strip's own mousemove handler
  await page.evaluate(() => {
    const b = (window.__benchMoves = []);
    let t0 = 0;
    window.addEventListener('mousemove', () => (t0 = performance.now()), true);
    window.addEventListener('mousemove', () => b.push(performance.now() - t0), false);
    window.__longTasks = [];
    new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__longTasks.push(e.duration))).observe({
      type: 'longtask',
      buffered: false,
    });
  });

  const result = { cpu };
  // hover: sweep across the first strip (timeline) or the grid area
  if (MODE === 'timeline') {
    const box = await page.locator('.ktl .card .strip').first().boundingBox();
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + 2, y);
    const m0 = await metrics(cdp);
    for (let i = 0; i < MOVES; i++) {
      const x = box.x + 2 + ((box.width - 4) * (i % 120)) / 119;
      await page.mouse.move(x, y);
    }
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const m1 = await metrics(cdp);
    const moves = await page.evaluate(() => window.__benchMoves.splice(0));
    result.hover = summarize(moves, m0, m1, MOVES);
    await page.mouse.move(1, 1);
  }

  // sync: external crosshair moves, each followed by a layout flush so the
  // DOM writes are paid for inside the measurement
  const m0 = await metrics(cdp);
  const times = await page.evaluate((n) => {
    const { inst, from, to } = window.__bench;
    const out = [];
    for (let i = 0; i < n; i++) {
      const t = from + ((to - from) * (i % 120)) / 119;
      const s = performance.now();
      inst.setExternalCursor(t);
      void document.body.offsetHeight;
      out.push(performance.now() - s);
    }
    return out;
  }, MOVES);
  const m1 = await metrics(cdp);
  result.sync = summarize(times, m0, m1, MOVES);
  result.longTasks = await page.evaluate(() => window.__longTasks.length);
  result.slots = slots;
  await page.close();
  return result;
}

function summarize(times, m0, m1, n) {
  const d = (k) => (m1[k] || 0) - (m0[k] || 0);
  return {
    meanMs: round(mean(times)),
    p50Ms: round(pct(times, 50)),
    p95Ms: round(pct(times, 95)),
    layoutsPerMove: round(d('LayoutCount') / n, 2),
    recalcsPerMove: round(d('RecalcStyleCount') / n, 2),
    layoutMsPerMove: round((d('LayoutDuration') * 1000) / n),
    scriptMsPerMove: round((d('ScriptDuration') * 1000) / n),
  };
}

// median of RUNS for each figure, per CPU rate
function median(rs, path) {
  const vals = rs.map((r) => path.reduce((o, k) => o?.[k], r)).filter((v) => v != null);
  return vals.length ? pct(vals, 50) : null;
}

const browser = await chromium.launch({ executablePath: process.env.BENCH_CHROMIUM || undefined });
const report = { sources: SOURCES, mode: MODE, moves: MOVES, runs: RUNS, chromium: browser.version(), results: [] };
for (const cpu of CPU) {
  const rs = [];
  for (let i = 0; i < RUNS; i++) {
    rs.push(await once(browser, cpu));
  }
  const row = { cpu, slots: rs[0].slots, longTasks: median(rs, ['longTasks']) };
  for (const path of ['hover', 'sync']) {
    if (!rs[0][path]) {
      continue;
    }
    row[path] = Object.fromEntries(Object.keys(rs[0][path]).map((k) => [k, median(rs, [path, k])]));
  }
  report.results.push(row);
}
await browser.close();

console.log(
  `Scrub benchmark: ${SOURCES} sources, ${MODE}, ${MOVES} moves, median of ${RUNS} runs, Chromium ${report.chromium}`
);
console.log(
  '| CPU | path | mean ms | p50 ms | p95 ms | layouts/move | recalcs/move | layout ms/move | script ms/move |'
);
console.log('|---|---|---|---|---|---|---|---|---|');
for (const r of report.results) {
  for (const path of ['hover', 'sync']) {
    const m = r[path];
    if (m) {
      // CDP's ScriptDuration only advances at task boundaries, so it can't see
      // script inside the single in-page sync loop: show it for hover only
      const script = path === 'sync' ? '—' : m.scriptMsPerMove;
      console.log(
        `| ${r.cpu}x | ${path} | ${m.meanMs} | ${m.p50Ms} | ${m.p95Ms} | ${m.layoutsPerMove} | ${m.recalcsPerMove} | ${m.layoutMsPerMove} | ${script} |`
      );
    }
  }
}
console.log(
  `slots in DOM: ${report.results[0]?.slots}; long tasks (median per run): ${report.results.map((r) => `${r.cpu}x=${r.longTasks}`).join(', ')}`
);
if (args.json) {
  writeFileSync(args.json, JSON.stringify(report, null, 2));
}
