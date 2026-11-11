import { frameIndexAt, reachRange, stepFrame } from '../model/playhead';
import { buildIntervals } from '../model/intervals';
import { mountPlayer, type PlayerContext } from './player';
import type { Frame } from '../types';

const MIN = 60e3;
const T0 = Date.UTC(2026, 0, 1, 10, 0, 0);
const at = (m: number) => T0 + m * MIN;
const fr = (m: number): Frame => ({ ts: at(m), url: `f${m}.jpg` });

describe('playhead arithmetic', () => {
  const P = { from: at(0), to: at(120) };
  test('near: the slot and ten either side, slid to fit the window', () => {
    expect(reachRange('near', at(60), MIN, P, at(999))).toEqual({ from: at(49.5), to: at(70.5) });
    expect(reachRange('near', at(2), MIN, P, at(999))).toEqual({ from: at(0), to: at(21) });
    // never past now
    expect(reachRange('near', at(60), MIN, P, at(65)).to).toBe(at(65));
  });
  test('all: the whole window, up to now', () => {
    expect(reachRange('all', at(60), MIN, P, at(90))).toEqual({ from: at(0), to: at(90) });
  });
  test('the frame in force, and stepping through frames within a range', () => {
    const frames = [fr(0), fr(3), fr(7)];
    expect(frameIndexAt(frames, at(5))).toBe(1);
    expect(frameIndexAt(frames, at(-1))).toBe(-1);
    expect(stepFrame(frames, at(5), 1, P)!.ts).toBe(at(7));
    expect(stepFrame(frames, at(5), -1, P)!.ts).toBe(at(0));
    expect(stepFrame(frames, at(7), 1, P)).toBeNull();
    expect(stepFrame(frames, at(3), 1, { from: at(0), to: at(5) })).toBeNull();
  });
});

describe('the preview player', () => {
  // a frame a minute, with 20 to 25 missing; the host promises a minute
  const all = Array.from({ length: 121 }, (_, i) => i).filter((m) => m < 20 || m > 25).map(fr);
  let el: HTMLElement;
  let teardown: () => void;
  let times: number[];
  let fetches: Array<[number, number]>;
  const ctx = (extra: Partial<PlayerContext> = {}): PlayerContext => ({
    window: { from: at(0), to: at(120) },
    step: 5 * MIN,
    fetch: async (from, to) => { fetches.push([from, to]); return all.filter((f) => f.ts >= from && f.ts <= to); },
    intervals: (frames, range) => buildIntervals({ frames, window: range, now: at(999), promiseAt: () => MIN }).intervals,
    // slots of five minutes, as the strip would draw a minute feed zoomed out
    slotAt: (t) => { const from = Math.floor((t - T0) / (5 * MIN)) * 5 * MIN + T0; return { from, to: from + 5 * MIN, ts: from, frameTs: from }; },
    onTime: (t) => times.push(t),
    tt: { time: (t: number) => new Date(t).toISOString().slice(11, 19), short: (t: number) => new Date(t).toISOString().slice(11, 16), sfx: () => '' } as never,
    label: 'site / cam',
    ...extra,
  });
  const cap = () => el.querySelector('.cap')!.textContent;
  const press = (a: string) => (el.querySelector(`button[data-a="${a}"]`) as HTMLButtonElement).click();
  const flush = () => new Promise((r) => setTimeout(r, 0));

  beforeEach(() => {
    localStorage.clear();
    jest.spyOn(Date, 'now').mockReturnValue(at(999));
    el = document.createElement('div');
    document.body.appendChild(el);
    times = [];
    fetches = [];
  });
  afterEach(() => {
    teardown?.();
    el.remove();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('opens on the clicked frame: its caption at once, then the scrubber over the slots around it', async () => {
    teardown = mountPlayer(el, fr(30), ctx(), () => {});
    expect(cap()).toBe('site / cam — 10:30:00');
    await flush();
    expect(fetches).toHaveLength(1);
    // 10 five-minute slots either side (from the window's start to 11:45), a
    // tick per frame: 10:20 to 10:25 are missing
    expect(el.querySelectorAll('.tick')).toHaveLength(106 - 6);
    expect(el.querySelector('.stage img')!.getAttribute('src')).toBe('f30.jpg');
    // the slot's frames, and which one this is
    expect(cap()).toBe('site / cam — 10:30:00 · 1/5 in slot');
  });

  test('the missing frames are drawn as dropped on the scrubber', async () => {
    teardown = mountPlayer(el, fr(30), ctx(), () => {});
    await flush();
    expect(el.querySelectorAll('.lane.dropped')).toHaveLength(1);
  });

  test('previous and next frame; the crosshair moves only to another slot', async () => {
    teardown = mountPlayer(el, fr(30), ctx(), () => {});
    await flush();
    for (let i = 0; i < 4; i++) {press('next');}
    expect(cap()).toBe('site / cam — 10:34:00 · 5/5 in slot');
    expect(times).toEqual([]);
    press('next');
    expect(cap()).toBe('site / cam — 10:35:00 · 1/5 in slot');
    press('prev');
    expect(times).toEqual([at(35), at(30)]);
  });

  test('next slot: the frame the strip shows for it; past the scrubber, its range moves', async () => {
    teardown = mountPlayer(el, fr(30), ctx(), () => {});
    await flush();
    press('next-slot');
    expect(cap()).toBe('site / cam — 10:35:00 · 1/5 in slot');
    expect(times).toEqual([at(35)]);
    for (let i = 0; i < 15; i++) {press('next-slot');}
    await flush();
    expect(fetches.length).toBeGreaterThan(1);
    expect(cap()).toBe('site / cam — 11:50:00 · 1/5 in slot');
  });

  test('play loops the frames within the slot, and the crosshair stays still', async () => {
    teardown = mountPlayer(el, fr(30), ctx(), () => {});
    await flush();
    jest.useFakeTimers();
    press('play');
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) { jest.advanceTimersByTime(250); seen.push(cap()!.match(/— (\d\d:\d\d)/)![1]); }
    expect(seen).toEqual(['10:31', '10:32', '10:33', '10:34', '10:30', '10:31']);
    expect(times).toEqual([]);
    press('play');
    jest.advanceTimersByTime(1000);
    expect(cap()!.match(/— (\d\d:\d\d)/)![1]).toBe('10:31');
  });

  test('a slot of one frame has nothing to play', async () => {
    const minuteSlots = (t: number) => { const from = Math.floor(t / MIN) * MIN; return { from, to: from + MIN, ts: from, frameTs: from }; };
    teardown = mountPlayer(el, fr(30), ctx({ slotAt: minuteSlots }), () => {});
    await flush();
    expect((el.querySelector('button[data-a="play"]') as HTMLButtonElement).disabled).toBe(true);
  });

  test('the viewer\'s choices are remembered: whole range, thumbnails', async () => {
    teardown = mountPlayer(el, fr(30), ctx(), () => {});
    await flush();
    press('reach');
    await flush();
    expect(el.querySelectorAll('.tick')).toHaveLength(all.length);
    press('style');
    expect(el.classList.contains('thumbs')).toBe(true);
    expect(el.querySelectorAll('.thumb').length).toBeGreaterThan(0);
    expect(JSON.parse(localStorage.getItem('ktl-player')!)).toMatchObject({ reach: 'all', style: 'thumbs' });
    teardown();
    el.textContent = '';
    teardown = mountPlayer(el, fr(30), ctx(), () => {});
    expect(el.classList.contains('thumbs')).toBe(true);
  });
});
