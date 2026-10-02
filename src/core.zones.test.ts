import {
  fmtOffset,
  fmtTime,
  fmtShort,
  mountGrid,
  mountTimeline,
  sourceTimeZone as untypedSourceTimeZone,
  zoneHeadText,
  zoneLabel,
  zoneOffsetText,
} from './core';

/* Per-source time zones (#68): a source declares `timezone` in /sources;
 * its header names the zone and the offset from the panel's, and with
 * thumbTimes 'source' its own time text is in that zone, offset-marked. */

const sourceTimeZone = untypedSourceTimeZone as (decl: unknown) => string | null;
const at = (iso: string) => Date.parse(iso);
const MIN = 60e3;

describe('zone labels and offsets', () => {
  test('the label is the city: the last IANA segment, underscores as spaces', () => {
    expect(zoneLabel('America/New_York')).toBe('New York');
    expect(zoneLabel('America/Argentina/Buenos_Aires')).toBe('Buenos Aires');
    expect(zoneLabel('Australia/Sydney')).toBe('Sydney');
    expect(zoneLabel('UTC')).toBe('UTC');
    expect(zoneLabel('Etc/UTC')).toBe('UTC');
  });

  test('offsets: whole hours, :30, :45, negative with a real minus, zero as nothing', () => {
    expect(fmtOffset(3 * 3600e3)).toBe('+3h');
    expect(fmtOffset(5.5 * 3600e3)).toBe('+5h30m');
    expect(fmtOffset(5.75 * 3600e3)).toBe('+5h45m');
    expect(fmtOffset(-4 * 3600e3)).toBe('\u22124h');
    expect(fmtOffset(-9.5 * 3600e3)).toBe('\u22129h30m');
    expect(fmtOffset(30 * MIN)).toBe('+30m');
    expect(fmtOffset(0)).toBe('');
  });

  const JUL = at('2026-07-01T12:00:00Z');
  const JAN = at('2026-01-15T12:00:00Z');

  test('a zone against the panel zone', () => {
    expect(zoneOffsetText('Australia/Brisbane', 'UTC', JUL)).toBe('+10h');
    expect(zoneOffsetText('Asia/Kolkata', 'UTC', JUL)).toBe('+5h30m');
    expect(zoneOffsetText('Asia/Kathmandu', 'UTC', JUL)).toBe('+5h45m');
    expect(zoneOffsetText('America/New_York', 'UTC', JUL)).toBe('\u22124h');
    expect(zoneOffsetText('America/St_Johns', 'UTC', JAN)).toBe('\u22123h30m');
    expect(zoneOffsetText('UTC', 'Europe/London', JUL)).toBe('\u22121h');
    expect(zoneOffsetText('Europe/London', 'UTC', JAN)).toBe('');
    expect(zoneOffsetText('Asia/Kathmandu', 'Asia/Kolkata', JUL)).toBe('+15m');
  });

  test('the offset follows DST: it is computed at an instant', () => {
    // New York springs forward at 2026-03-08 07:00 UTC
    expect(zoneOffsetText('America/New_York', 'UTC', at('2026-03-08T06:59:59Z'))).toBe('\u22125h');
    expect(zoneOffsetText('America/New_York', 'UTC', at('2026-03-08T07:00:00Z'))).toBe('\u22124h');
    // two DST zones against each other: Sydney (AEDT until 5 April) vs New York
    expect(zoneOffsetText('Australia/Sydney', 'America/New_York', at('2026-03-07T12:00:00Z'))).toBe('+16h');
    expect(zoneOffsetText('Australia/Sydney', 'America/New_York', at('2026-03-09T12:00:00Z'))).toBe('+15h');
    expect(zoneOffsetText('Australia/Sydney', 'America/New_York', at('2026-04-06T12:00:00Z'))).toBe('+14h');
  });

  test('header text: city and offset, or the city alone when the clocks agree', () => {
    expect(zoneHeadText('Asia/Kathmandu', 'UTC', JUL)).toBe('Kathmandu · +5h45m');
    expect(zoneHeadText('America/New_York', 'UTC', JUL)).toBe('New York · \u22124h');
    expect(zoneHeadText('Europe/London', 'UTC', JAN)).toBe('London');
    expect(zoneHeadText('UTC', 'UTC', JUL)).toBe('UTC');
  });
});

describe('sourceTimeZone', () => {
  test('a declared, known zone is used as declared', () => {
    expect(sourceTimeZone({ timezone: 'Asia/Kolkata' })).toBe('Asia/Kolkata');
    expect(sourceTimeZone({ timezone: ' Australia/Sydney ' })).toBe('Australia/Sydney');
    expect(sourceTimeZone({ timezone: 'utc' })).toBe('UTC');
    expect(sourceTimeZone({ timezone: 'Etc/UTC' })).toBe('UTC');
  });

  test('missing, blank, browser-relative or unknown zones mean none', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(sourceTimeZone({})).toBeNull();
      expect(sourceTimeZone(null)).toBeNull();
      expect(sourceTimeZone({ timezone: '' })).toBeNull();
      expect(sourceTimeZone({ timezone: '  ' })).toBeNull();
      expect(sourceTimeZone({ timezone: 'browser' })).toBeNull();
      expect(sourceTimeZone({ timezone: 10 })).toBeNull();
      expect(sourceTimeZone({ timezone: 'Mars/Olympus_Mons' })).toBeNull();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('Mars/Olympus_Mons'));
    } finally {
      warn.mockRestore();
    }
  });
});

/* ---- mounted: the real mountTimeline / mountGrid over a mocked API ---- */

const API = 'https://frames.example.com';
type Decl = { id: string; site: string; cadence: number; timezone?: string };

describe('mounted panels', () => {
  const realFetch = globalThis.fetch;
  let root: HTMLElement;
  let mounts: Array<{ destroy(): void }>;

  /* frames on the minute for every source, except: none at or after
   * `lastAt[id]` (an outage running into the window end) */
  function serve(decls: Decl[], lastAt: Record<string, number> = {}) {
    globalThis.fetch = jest.fn(async (u) => {
      const url = new URL(String(u));
      if (url.pathname === '/sources') {
        return { ok: true, json: async () => decls };
      }
      const q = url.searchParams;
      const source = q.get('source')!;
      const from = Number(q.get('from')), to = Number(q.get('to')), step = Number(q.get('step'));
      const out: Array<{ source: string; ts: number; url: string }> = [];
      for (let ts = Math.ceil(from / step) * step; ts <= to; ts += step) {
        if (lastAt[source] != null && ts >= lastAt[source]) {
          continue;
        }
        out.push({ source, ts, url: `${API}/frame/lo/site-a/${source}/${ts}.jpg` });
      }
      return { ok: true, json: async () => out };
    }) as unknown as typeof fetch;
  }

  beforeEach(() => {
    HTMLCanvasElement.prototype.getContext = (() => ({ font: '', measureText: () => ({ width: 30 }) })) as never;
    root = document.createElement('div');
    document.body.appendChild(root);
    mounts = [];
  });
  afterEach(() => {
    for (const m of mounts) {
      m.destroy();
    }
    globalThis.fetch = realFetch;
    document.body.innerHTML = '';
  });

  async function until(fn: () => unknown) {
    for (let i = 0; i < 150 && !fn(); i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(fn()).toBeTruthy();
  }
  const text = (sel: string) => Array.from(root.querySelectorAll(sel)).map((e) => e.textContent);
  function mount(kind: 'timeline' | 'grid', cfg: { from: number; to: number; thumbTimes?: string }) {
    const m = (kind === 'grid' ? mountGrid : mountTimeline)(root, { apiUrl: API, width: 600, timeZone: 'UTC', ...cfg });
    mounts.push(m);
    return m as { setExternalCursor(t: number): void; destroy(): void };
  }

  const FROM = at('2026-06-15T10:00:00Z');
  const TO = at('2026-06-15T11:00:00Z');
  const OUTAGE = at('2026-06-15T10:40:00Z');
  const DECLS: Decl[] = [
    { id: 'zoned', site: 'site-a', cadence: MIN, timezone: 'Asia/Kathmandu' },
    { id: 'plain', site: 'site-a', cadence: MIN },
  ];
  const KTM = (ts: number) => fmtTime(ts, 'Asia/Kathmandu') + ' (+5h45m)';

  test('timeline headers name a declared zone; a source without one has no chip', async () => {
    serve(DECLS);
    mount('timeline', { from: FROM, to: TO });
    await until(() => root.querySelectorAll('.card .mag .cap').length === 2 && text('.mag .cap')[0]);
    const [zoned, plain] = Array.from(root.querySelectorAll('.card-head'));
    expect(zoned.querySelector('.tz')!.textContent).toBe('Kathmandu · +5h45m');
    expect(zoned.querySelector('.tz')!.getAttribute('title')).toContain('Asia/Kathmandu');
    expect(plain.querySelector('.tz')).toBeNull();
    // the site chip is still the first .st that names the site
    expect(zoned.querySelector('.st:not(.tz)')!.textContent).toBe('site-a');
  });

  test("thumbTimes 'panel' (default): captions in panel time, unmarked", async () => {
    serve(DECLS);
    const m = mount('timeline', { from: FROM, to: TO });
    await until(() => text('.mag .cap')[1]);
    const t = at('2026-06-15T10:20:00Z');
    m.setExternalCursor(t);
    expect(text('.mag .cap')).toEqual([fmtTime(t, 'UTC'), fmtTime(t, 'UTC')]);
    expect(root.querySelector('.acur')!.textContent).toBe('10:20:00');
  });

  test("thumbTimes 'source': a zoned source's captions, alt text and last-seen are its own time", async () => {
    serve(DECLS, { zoned: OUTAGE });
    const m = mount('timeline', { from: FROM, to: TO, thumbTimes: 'source' });
    await until(() => text('.mag .cap')[1]);
    // rest cursor at the window end: the zoned source is in its outage
    const last = OUTAGE - MIN;
    expect(text('.mag .cap')[0]).toBe('offline — last seen ' + KTM(last));
    expect(text('.card-head .ft')[0]).toBe('offline — last seen ' + KTM(last));
    const t = at('2026-06-15T10:20:00Z');
    m.setExternalCursor(t);
    expect(text('.mag .cap')).toEqual([KTM(t), fmtTime(t, 'UTC')]);
    // the axis cursor stays in the panel zone
    expect(root.querySelector('.acur')!.textContent).toBe('10:20:00');
    const alt = root.querySelector('.card .slot img')!.getAttribute('alt')!;
    expect(alt).toMatch(/^zoned \d\d:\d\d:\d\d \(\+5h45m\)$/);
    expect(root.querySelectorAll('.card')[1].querySelector('.slot img')!.getAttribute('alt')).toMatch(/^plain \d\d:\d\d:\d\d$/);
  });

  test("thumbTimes 'source': the expected text and the ghost's last frame", async () => {
    const slotTs = Math.floor(Date.now() / MIN) * MIN;
    serve(DECLS, { zoned: slotTs, plain: slotTs });
    const m = mount('timeline', { from: slotTs - 10 * MIN, to: slotTs + 10 * MIN, thumbTimes: 'source' });
    await until(() => text('.mag .cap')[1]);
    m.setExternalCursor(slotTs);
    expect(text('.mag .cap')[0]).toBe(
      'expected — ' + fmtShort(slotTs, 'Asia/Kathmandu') + ' · last frame ' + fmtTime(slotTs - MIN, 'Asia/Kathmandu') + ' (+5h45m)'
    );
    expect(text('.mag .cap')[1]).toBe(
      'expected — ' + fmtShort(slotTs, 'UTC') + ' · last frame ' + fmtTime(slotTs - MIN, 'UTC')
    );
  });

  test("grid: tile time, header and click-in preview with thumbTimes 'source'", async () => {
    serve(DECLS, { zoned: OUTAGE });
    const m = mount('grid', { from: FROM, to: TO, thumbTimes: 'source' });
    await until(() => text('.t-ts')[1]);
    expect(text('.t-head .tz')).toEqual(['Kathmandu · +5h45m']);
    // a past window: the latest frame, no offline call
    expect(text('.t-ts')).toEqual([KTM(OUTAGE - MIN), fmtTime(TO, 'UTC')]);
    const t = at('2026-06-15T10:20:00Z');
    m.setExternalCursor(t);
    expect(text('.t-ts')).toEqual([KTM(t), fmtTime(t, 'UTC')]);
    // in the outage: last seen, in the source's zone
    m.setExternalCursor(at('2026-06-15T10:50:00Z'));
    expect(text('.t-off')[0]).toBe('OFFLINE — last seen ' + KTM(OUTAGE - MIN));
    m.setExternalCursor(t);
    (root.querySelector('.tile') as HTMLElement).click();
    expect(document.querySelector('.ktl-pop .cap')!.textContent).toBe('site-a / zoned — ' + KTM(t));
    (root.querySelectorAll('.tile')[1] as HTMLElement).click();
    expect(document.querySelector('.ktl-pop .cap')!.textContent).toBe('site-a / plain — ' + fmtTime(t, 'UTC'));
  });

  test("grid with thumbTimes 'panel': tile times stay in panel time", async () => {
    serve(DECLS);
    mount('grid', { from: FROM, to: TO });
    await until(() => text('.t-ts')[1]);
    expect(text('.t-ts')).toEqual([fmtTime(TO, 'UTC'), fmtTime(TO, 'UTC')]);
    expect(text('.t-head .tz')).toEqual(['Kathmandu · +5h45m']);
  });

  test('a zone that is the panel zone shows its name alone, and no suffix', async () => {
    serve([{ id: 'utc', site: 'site-a', cadence: MIN, timezone: 'Etc/UTC' }]);
    mount('grid', { from: FROM, to: TO, thumbTimes: 'source' });
    await until(() => text('.t-ts')[0]);
    expect(text('.t-head .tz')).toEqual(['UTC']);
    expect(text('.t-ts')).toEqual([fmtTime(TO, 'UTC')]);
  });

  test('an unknown or hostile zone renders no chip and no markup', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      serve([{ id: 'x', site: 'site-a', cadence: MIN, timezone: '<img src=x onerror=alert(1)>' }]);
      mount('timeline', { from: FROM, to: TO, thumbTimes: 'source' });
      await until(() => text('.mag .cap')[0]);
      expect(root.querySelector('.tz')).toBeNull();
      expect(root.querySelectorAll('[onerror]')).toHaveLength(0);
      expect(text('.mag .cap')[0]).toBe(fmtTime(TO, 'UTC'));
    } finally {
      warn.mockRestore();
    }
  });

  test('scrubbing touches the zone chip only when its offset changes (a DST edge)', async () => {
    // New York springs forward at 07:00 UTC
    const from = at('2026-03-08T05:00:00Z'), to = at('2026-03-08T09:00:00Z');
    serve([{ id: 'ny', site: 'site-a', cadence: MIN, timezone: 'America/New_York' }]);
    const m = mount('timeline', { from, to });
    await until(() => text('.mag .cap')[0]);
    const chip = root.querySelector('.tz')!;
    expect(chip.textContent).toBe('New York · \u22124h');   // rest cursor: the window end
    const obs = new MutationObserver(() => {});
    obs.observe(chip, { childList: true, characterData: true, subtree: true });
    const writes = (t: number) => {
      m.setExternalCursor(t);
      return obs.takeRecords().length;
    };

    expect(writes(at('2026-03-08T05:30:00Z'))).toBeGreaterThan(0);
    expect(chip.textContent).toBe('New York · \u22125h');
    for (const t of ['05:31:10', '06:00:00', '06:30:00', '06:59:00']) {
      expect(writes(at(`2026-03-08T${t}Z`))).toBe(0);
    }
    expect(writes(at('2026-03-08T07:00:00Z'))).toBeGreaterThan(0);
    expect(chip.textContent).toBe('New York · \u22124h');
    for (const t of ['07:30:00', '08:00:00', '08:59:00']) {
      expect(writes(at(`2026-03-08T${t}Z`))).toBe(0);
    }
    obs.disconnect();
  });
});
