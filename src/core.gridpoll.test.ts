import { mountGrid } from './core';
import type { Backend, Frame } from './vt/types';

/* The grid's live poll (src/vt/grid/poll.ts) over an in-memory backend and
 * a fake clock: every 10 s it fetches each tile's frames since its latest
 * and shows the newest, and one host's failure doesn't stop the others. */

const MIN = 60e3;
const T = Date.UTC(2026, 8, 15, 12, 0, 0);

describe('the grid\'s live poll', () => {
  let root: HTMLElement;
  beforeEach(() => {
    jest.useFakeTimers({ now: T });
    root = document.createElement('div');
    document.body.appendChild(root);
  });
  afterEach(() => {
    document.body.innerHTML = '';
    jest.useRealTimers();
  });

  /* two hosts taking a frame a minute; `broken` throws on every poll */
  function backendFor(broken: string | null): Backend & { asked: string[] } {
    const asked: string[] = [];
    const framesOf = (id: string, from: number, to: number): Frame[] => {
      const out: Frame[] = [];
      for (let t = Math.ceil(from / MIN) * MIN; t <= Math.min(to, Date.now()); t += MIN) {out.push({ ts: t, url: `${id}/${t}.jpg` });}
      return out;
    };
    let built = false;
    return {
      asked,
      kiosks: () => [{ id: 'cam-a', site: '', cadence: MIN }, { id: 'cam-b', site: '', cadence: MIN }],
      frames: async (_s, id, from, to) => framesOf(id, from, to),
      allFrames: async (_s, id, from, to) => {
        asked.push(id);
        if (built && id === broken) {throw new Error('down');}
        return framesOf(id, from, to);
      },
      // the first build fetches every host; later calls are the polls
      get __built() { return built; },
      set __built(v: boolean) { built = v; },
    } as Backend & { asked: string[] };
  }
  const shownSrc = (id: string) => [...root.querySelectorAll('.tile')]
    .find((t) => t.querySelector('.nm')?.textContent === id)?.querySelector('img')?.getAttribute('src');

  test('every 10 s, the newest frame each host took since its last', async () => {
    const backend = backendFor(null);
    const inst = mountGrid(root, { from: T - 30 * MIN, to: T + 10 * MIN, width: 800, timeZone: 'UTC', backend });
    await jest.advanceTimersByTimeAsync(2000);
    expect(shownSrc('cam-a')).toBe(`cam-a/${T}.jpg`);
    // a minute on: the next frame, from a poll that asks from after the last one
    await jest.advanceTimersByTimeAsync(MIN);
    expect(shownSrc('cam-a')).toBe(`cam-a/${T + MIN}.jpg`);
    expect(shownSrc('cam-b')).toBe(`cam-b/${T + MIN}.jpg`);
    inst.destroy();
    const n = backend.asked.length;
    await jest.advanceTimersByTimeAsync(MIN);
    // torn down: no more polls
    expect(backend.asked.length).toBe(n);
  });

  test('one host whose fetch fails doesn\'t stop the others\' polls', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const backend = backendFor('cam-a');
    const inst = mountGrid(root, { from: T - 30 * MIN, to: T + 10 * MIN, width: 800, timeZone: 'UTC', backend });
    await jest.advanceTimersByTimeAsync(2000);
    (backend as unknown as { __built: boolean }).__built = true;
    await jest.advanceTimersByTimeAsync(MIN);
    expect(shownSrc('cam-a')).toBe(`cam-a/${T}.jpg`);
    expect(shownSrc('cam-b')).toBe(`cam-b/${T + MIN}.jpg`);
    expect(warn).toHaveBeenCalled();
    inst.destroy();
    warn.mockRestore();
  });

  test('a past window starts no poll', async () => {
    const backend = backendFor(null);
    const inst = mountGrid(root, { from: T - 120 * MIN, to: T - 60 * MIN, width: 800, timeZone: 'UTC', backend });
    await jest.advanceTimersByTimeAsync(2000);
    const n = backend.asked.length;
    await jest.advanceTimersByTimeAsync(MIN);
    expect(backend.asked.length).toBe(n);
    inst.destroy();
  });
});
