import { mountTimeline } from './core';

/* The live poll (src/vt/timeline/poll.ts) over a fake frames API and a fake
 * clock. jsdom has no layout, so the strip is given a width and each slot an
 * offset (10px per slot) for dressStrip to read. */

const CAD = 20e3;
const T = Date.UTC(2026, 8, 15, 12, 0, 0);
const STOP = T + 40e3; // the source goes silent just after mount

describe('live poll', () => {
  let root: HTMLElement;
  const restore: Array<() => void> = [];

  function stubGetter(proto: object, key: string, get: (this: HTMLElement) => number) {
    const prev = Object.getOwnPropertyDescriptor(proto, key);
    Object.defineProperty(proto, key, { configurable: true, get });
    restore.push(() => (prev ? Object.defineProperty(proto, key, prev) : delete (proto as any)[key]));
  }

  beforeEach(() => {
    jest.useFakeTimers({ now: T });
    // jsdom has no canvas; the axis only needs text metrics
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = (() => ({ font: '', measureText: () => ({ width: 30 }) })) as never;
    restore.push(() => (HTMLCanvasElement.prototype.getContext = getContext));
    stubGetter(HTMLElement.prototype, 'clientWidth', () => 800);
    stubGetter(HTMLElement.prototype, 'offsetLeft', function () {
      return this.parentElement ? Array.prototype.indexOf.call(this.parentElement.children, this) * 10 : 0;
    });
    root = document.createElement('div');
    document.body.appendChild(root);
  });
  afterEach(() => {
    restore.splice(0).reverse().forEach((r) => r());
    document.body.innerHTML = '';
    jest.useRealTimers();
  });

  test('slots the poll adds get the hatch alignment built slots get (#77)', async () => {
    const decl = { id: 'src-a', site: 'lab', cadence: CAD, history: [{ since: T - 864e5, variant: 'lo', cadence: CAD }] };
    const ok = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: async () => body });
    const apiFetch = (path: string) => {
      const u = new URL(path, 'https://fake.example');
      if (u.pathname === '/sources') {
        return ok([decl]);
      }
      const from = Number(u.searchParams.get('from'));
      const to = Math.min(Number(u.searchParams.get('to')), Date.now(), STOP);
      const out = [];
      for (let t = Math.ceil(from / CAD) * CAD; t <= to; t += CAD) {
        out.push({ ts: t, url: `frame/${t}` });
      }
      return ok(out);
    };
    const inst = mountTimeline(root, {
      from: T - 10 * 60e3, to: T + 10 * 60e3, width: 800, timeZone: 'UTC', apiUrl: 'https://fake.example', apiFetch,
    });
    await jest.advanceTimersByTimeAsync(2000); // build and reveal
    const strip = root.querySelector('.card .strip')!;
    const slotsAtMount = strip.querySelectorAll('.slot').length;
    expect(strip.querySelectorAll('.slot.gap')).toHaveLength(0);

    await jest.advanceTimersByTimeAsync(3 * 60e3); // 18 polls, every 10 s
    const slots = Array.from(strip.querySelectorAll<HTMLElement>('.slot'));
    expect(slots.length).toBeGreaterThan(slotsAtMount);
    const gaps = slots.filter((el) => el.classList.contains('gap'));
    expect(gaps.length).toBeGreaterThan(3);
    for (const el of gaps) {
      expect(el.style.backgroundPosition).toBe(-el.offsetLeft + 'px 0px');
    }
    inst.destroy();
  });

  /* A fake API for several sources: every /frames call is recorded, held
   * `delay` ms, and fails for the ids in `failing`. */
  function fleet(n: number, opts: { delay?: number; failing?: Set<string> } = {}) {
    const decls = Array.from({ length: n }, (_, i) => ({
      id: `src-${i}`, site: 'lab', cadence: CAD, history: [{ since: T - 864e5, variant: 'lo', cadence: CAD }],
    }));
    const calls: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const apiFetch = async (path: string) => {
      const u = new URL(path, 'https://fake.example');
      if (u.pathname === '/sources') {
        return { ok: true, status: 200, json: async () => decls };
      }
      const id = u.searchParams.get('source')!;
      calls.push(id);
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, opts.delay ?? 0));
      inFlight--;
      if (opts.failing?.has(id)) {
        return { ok: false, status: 500, json: async () => ({ error: 'boom' }) };
      }
      const from = Number(u.searchParams.get('from'));
      const to = Math.min(Number(u.searchParams.get('to')), Date.now());
      const out: Array<{ ts: number; url: string }> = [];
      for (let t = Math.ceil(from / CAD) * CAD; t <= to; t += CAD) {
        out.push({ ts: t, url: `frame/${id}/${t}` });
      }
      return { ok: true, status: 200, json: async () => out };
    };
    const mount = () => mountTimeline(root, {
      from: T - 10 * 60e3, to: T + 10 * 60e3, width: 800, timeZone: 'UTC', apiUrl: 'https://fake.example', apiFetch,
    });
    return { calls, mount, maxInFlight: () => maxInFlight };
  }

  test('sources build a few at a time, in declared order', async () => {
    const f = fleet(12, { delay: 100 });
    const inst = f.mount();
    await jest.advanceTimersByTimeAsync(2000);
    expect(f.maxInFlight()).toBeGreaterThan(1);
    expect(f.maxInFlight()).toBeLessThanOrEqual(6);
    const ids = Array.from(root.querySelectorAll('.card'), (el) => el.querySelector('.nm')?.textContent);
    expect(ids).toEqual(Array.from({ length: 12 }, (_, i) => `src-${i}`));
    inst.destroy();
  });

  test('a mount torn down while it reveals never starts its poll', async () => {
    const f = fleet(2);
    const inst = f.mount();
    await jest.advanceTimersByTimeAsync(100); // models built, waiting on the reveal
    expect(root.querySelectorAll('.card')).toHaveLength(2);
    inst.destroy();
    await jest.advanceTimersByTimeAsync(2000);
    const settled = f.calls.length;
    await jest.advanceTimersByTimeAsync(60e3);
    expect(f.calls.length).toBe(settled);
  });

  test('one failing source does not stop the others\' polls', async () => {
    const failing = new Set<string>();
    const f = fleet(3, { failing });
    const inst = f.mount();
    await jest.advanceTimersByTimeAsync(2000);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      failing.add('src-0'); // from now on the first source's API calls fail
      f.calls.length = 0;
      await jest.advanceTimersByTimeAsync(30e3); // three polls
      expect(f.calls.filter((id) => id === 'src-0')).toHaveLength(3);
      expect(f.calls.filter((id) => id === 'src-2')).toHaveLength(3);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('live poll failed for src-0'), expect.anything());
    } finally {
      warn.mockRestore();
    }
    inst.destroy();
  });
});
