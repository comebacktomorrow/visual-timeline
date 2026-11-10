// Pushes the fixture's log lines into the dev stack's Loki (M5), moved to the
// last half hour: Loki holds live data, and a line pushed with a months-old
// time isn't queryable until it's flushed. The spacing between lines, and
// cam-b's gap, are kept; the newest line is 3 minutes old.
import { readFileSync } from 'fs';

const LOKI = process.env.LOKI || 'http://vt-loki:3100';
const push = JSON.parse(readFileSync(new URL('./loki-push.json', import.meta.url), 'utf8'));
const newest = Math.max(...push.streams.flatMap((s) => s.values.map(([ns]) => Number(BigInt(ns) / 1000000n))));
const shift = Date.now() - 3 * 60_000 - newest;
for (const s of push.streams) {
  s.values = s.values.map(([ns, line]) => [String((BigInt(ns) / 1000000n + BigInt(shift)) * 1000000n), line]);
}
for (let i = 0; ; i++) {
  try { if ((await fetch(LOKI + '/ready')).ok) {break;} } catch { /* not up yet */ }
  if (i > 120) {throw new Error('Loki never became ready');}
  await new Promise((r) => setTimeout(r, 1000));
}
const r = await fetch(LOKI + '/loki/api/v1/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(push) });
if (!r.ok) {throw new Error(`Loki refused the push: ${r.status} ${await r.text()}`);}
console.log('pushed', push.streams.reduce((n, s) => n + s.values.length, 0), 'lines');
