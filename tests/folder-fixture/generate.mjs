// Writes the HTTP folder fixture (#125) that nginx serves in the dev stack
// and e2e: tests/folder-fixture/frames/{host}/{YYYY}-{MM}-{DD}/{HH}{mm}{ss}_{variant}.svg
// Two hosts, a frame about every 3 minutes from 10:00 to 10:27 UTC on
// 2026-01-01, in a small (lo) and a large (hi) size. Seconds drift, as real
// uploads' do; cam-b misses 10:12 and 10:15. Run: node tests/folder-fixture/generate.mjs
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), 'frames');
rmSync(root, { recursive: true, force: true });
const drift = [0, 7, 13, 4, 11, 2, 9, 15, 6, 1];
const hue = { 'cam-a': 160, 'cam-b': 10 };
for (const host of ['cam-a', 'cam-b']) {
  for (let k = 0; k < 10; k++) {
    if (host === 'cam-b' && (k === 4 || k === 5)) {continue;}
    const t = new Date(Date.UTC(2026, 0, 1, 10, k * 3, drift[k]));
    const hhmmss = t.toISOString().slice(11, 19).replace(/:/g, '');
    const dir = join(root, host, '2026-01-01');
    mkdirSync(dir, { recursive: true });
    for (const [variant, w, h] of [['lo', 160, 90], ['hi', 640, 360]]) {
      const label = `${host} ${t.toISOString().slice(11, 19)}`;
      writeFileSync(join(dir, `${hhmmss}_${variant}.svg`),
        `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 160 90">` +
        `<rect width="160" height="90" fill="hsl(${hue[host]},45%,30%)"/>` +
        `<text x="80" y="52" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#fff">${label}</text></svg>\n`);
    }
  }
}
