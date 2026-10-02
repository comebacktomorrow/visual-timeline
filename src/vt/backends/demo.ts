import { fmtTime } from '../time/zones';
import { zoneLabel } from '../zones/source';
import type { Backend, Frame, RawAnnotation, SourceDecl, TimeWindow } from '../types';

/* ================== built-in demo data (backend seam) ==================
 * Same contract as the frames API (docs/API.md): swap for GET /sources +
 * GET /frames via the apiUrl option. Cadence is DECLARED BY THE SOURCE.
 * source-2 has a synthetic outage. */
/* a demo source as listed below: the decl minus its site and location */
type DemoSource = Pick<SourceDecl, 'id' | 'cadence' | 'tags' | 'timezone'>;
const SITES: Record<string, DemoSource[]> = {
  'site-a': [
    { id: 'source-1', cadence: 60e3, tags: { env: 'prod' } },
    { id: 'source-2', cadence: 60e3 },
    // declared zones (#68): one with DST, one on a :45 offset, so the
    // header offset label shows from (almost) any viewer's zone
    { id: 'source-3', cadence: 120e3, timezone: 'Australia/Sydney' },
  ],
  'site-b': [
    { id: 'source-4', cadence: 60e3 },
    { id: 'source-5', cadence: 30e3, tags: { orient: 'portrait' }, timezone: 'Asia/Kathmandu' },
  ],
};
const DEMO_ZONES: Record<string, string> = {};
for (const ks of Object.values(SITES)) {for (const k of ks) {if (k.timezone) {DEMO_ZONES[k.id] = k.timezone;}}}
const HUES: Record<string, number> = { 'source-1': 205, 'source-2': 275, 'source-3': 25, 'source-4': 130, 'source-5': 340 };
/* demo screen shapes: source-3 is 4:3, source-5 is portrait 9:16 */
const DIMS: Record<string, [number, number]> = { 'source-3': [288, 216], 'source-5': [216, 384] };

/* the demo backend: synchronous kiosks(), canvas frames, and the mock
 * annotation seam */
export type DemoBackend = Backend & { annotations(): RawAnnotation[] };

/* demo frames draw a clock as the screen would: a source with a declared
 * zone shows its own local time (labelled with the city), the rest the
 * mount's zone, so they agree with their captions and the axis */
export function makeBackend(P: TimeWindow, SPAN: number, tz: string): DemoBackend {
  function renderMockFrame(site: string, kiosk: string, ts: number, step: number): string {
    const dims = DIMS[kiosk] || [384, 216];
    const w = dims[0], h = dims[1];
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d')!;   // a fresh canvas always has a 2d context
    const hue = HUES[kiosk] != null ? HUES[kiosk] : 130;
    g.fillStyle = 'hsl(' + hue + ' 30% 14%)'; g.fillRect(0, 0, w, h);
    g.fillStyle = 'hsl(' + hue + ' 60% 30%)'; g.fillRect(0, 0, w, Math.round(h * 0.14));
    g.fillStyle = '#fff'; g.font = 'bold ' + Math.round(h * 0.06) + 'px sans-serif';
    g.fillText(site + ' / ' + kiosk, 8, Math.round(h * 0.10));
    g.font = 'bold ' + Math.round(Math.min(w * 0.16, h * 0.18)) + 'px monospace';
    g.fillStyle = 'hsl(' + hue + ' 70% 72%)';
    g.textAlign = 'center';
    const own = DEMO_ZONES[kiosk];
    g.fillText(fmtTime(ts, own || tz), w / 2, h * 0.55);
    if (own) {
      g.font = Math.round(Math.min(h * 0.055, w * 0.06)) + 'px sans-serif';
      g.fillText(zoneLabel(own) + ' local time', w / 2, h * 0.655);
    }
    g.textAlign = 'left';
    const phase = (ts / step) % 20 / 20;
    g.fillStyle = 'hsl(' + hue + ' 80% 55%)';
    g.fillRect(w * 0.04 + phase * (w * 0.8), h * 0.72, w * 0.13, h * 0.16);
    return c.toDataURL('image/jpeg', 0.7);
  }
  return {
    kiosks(sites) {
      return Object.entries(SITES)
        .filter(([s]) => !sites || sites.includes(s))
        .flatMap(([s, ks]) => ks.map(k => {
          const decl: SourceDecl = Object.assign({}, k, { site: s, location: 'demo' });
          // demo cadence events: source-3 slows 120s→240s mid-window (pace
          // change era); source-4 declares a pause for 20%–45% of the window
          // (resume inferred from its frames). source-2 keeps its UNDECLARED
          // outage — the red-vs-neutral contrast is the point of the demo.
          if (k.id === 'source-3') {
            decl.history = [
              { since: P.from - 864e5, variant: 'lo', cadence: 120e3 },
              { since: P.from + SPAN * 0.5, variant: 'lo', cadence: 240e3 },
            ];
            decl.cadence = 240e3;
          }
          if (k.id === 'source-4') {
            decl.history = [
              { since: P.from - 864e5, variant: 'lo', cadence: 60e3 },
              // demo the reason+intent vocabulary: an UNINTENDED screen-off
              // (power-policy blank) renders amber, not neutral
              { since: P.from + SPAN * 0.2, variant: 'lo', paused: true, reason: 'screen-sleep', intended: false },
            ];
          }
          return decl;
        }));
    },
    frames(site, kiosk, from, to, step) {
      const out: Frame[] = [];
      const gapA = P.from + SPAN * 0.35, gapB = P.from + SPAN * 0.55;
      const first = Math.ceil(from / step) * step;
      for (let ts = first; ts <= Math.min(to, Date.now()); ts += step) {
        if (kiosk === 'source-2' && ts > gapA && ts < gapB) {continue;}
      if (kiosk === 'source-4' && ts > P.from + SPAN * 0.2 && ts < P.from + SPAN * 0.45) {continue;}
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
        { ts: P.from + SPAN * 0.30, title: 'deploy v2.4.1', text: 'rollout to site-a — https://example.com/releases/v2.4.1', tags: ['deploy'] },
        { ts: P.from + SPAN * 0.60, title: 'app restart', text: 'watchdog restarted the shell', tags: ['source:source-1'] },
        { ts: P.from + SPAN * 0.85, title: 'gateway reboot', text: 'site-b uplink flapped during carrier work', tags: ['site:site-b', 'network'] },
        { ts: P.from + SPAN * 0.68, timeEnd: P.from + SPAN * 0.78, title: 'content sync', text: 'nightly asset refresh', tags: ['maintenance'] },
        { ts: P.from + SPAN * 0.35, timeEnd: P.from + SPAN * 0.55, title: 'backend outage',
          text: 'upstream API down — source-2 dark', tags: ['source:source-2', 'incident'], color: '#ff9830' },
        { ts: P.from + SPAN * 0.520, title: 'alert: high CPU', text: 'firing', tags: ['alert'], color: '#f2495c' },
        { ts: P.from + SPAN * 0.522, title: 'alert: high CPU', text: 'still firing', tags: ['alert'], color: '#f2495c' },
        { ts: P.from + SPAN * 0.524, title: 'alert: high CPU', text: 'resolved', tags: ['alert'], color: '#f2495c' },
      ];
    },
  };
}
