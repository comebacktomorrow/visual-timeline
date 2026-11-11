import { frameIndexAt } from '../model/playhead';
import { buildIntervals } from '../model/intervals';
import { mountPlayer, type PlayerContext } from './player';
import type { Frame } from '../types';

const MIN = 60e3;
const T0 = Date.UTC(2026, 0, 1, 10, 0, 0);
const at = (m: number) => T0 + m * MIN;
const fr = (m: number): Frame => ({ ts: at(m), url: `f${m}.jpg` });

test('the frame in force at a time', () => {
  const frames = [fr(0), fr(3), fr(7)];
  expect(frameIndexAt(frames, at(5))).toBe(1);
  expect(frameIndexAt(frames, at(-1))).toBe(-1);
  expect(frameIndexAt(frames, at(7))).toBe(2);
});

/* The player shows the frames a slot holds but can't show: its scrubber is
 * the slot's own timeline, and only ‹‹ ›› leave the slot. A frame a minute,
 * in five-minute slots; 20 to 25 missing; the host promises a minute. */
describe('the preview player', () => {
  const all = Array.from({ length: 121 }, (_, i) => i).filter((m) => m < 20 || m > 25).map(fr);
  let el: HTMLElement;
  let teardown: () => void;
  let times: number[];
  let fetches: Array<[number, number]>;
  const fiveMinuteSlots = (t: number) => { const from = Math.floor((t - T0) / (5 * MIN)) * 5 * MIN + T0; return { from, to: from + 5 * MIN, ts: from, frameTs: from }; };
  const ctx = (extra: Partial<PlayerContext> = {}): PlayerContext => ({
    window: { from: at(0), to: at(120) },
    step: 5 * MIN,
    fetch: async (from, to) => { fetches.push([from, to]); return all.filter((f) => f.ts >= from && f.ts <= to); },
    intervals: (frames, range) => buildIntervals({ frames, window: range, now: at(999), promiseAt: () => MIN }).intervals,
    slotAt: fiveMinuteSlots,
    onTime: (t) => times.push(t),
    tt: { time: (t: number) => new Date(t).toISOString().slice(11, 19), short: (t: number) => new Date(t).toISOString().slice(11, 16), sfx: () => '' } as never,
    label: 'site / cam',
    ...extra,
  });
  const cap = () => el.querySelector('.cap')!.textContent!;
  const hhmm = () => cap().match(/— (\d\d:\d\d)/)![1];
  const press = (a: string) => (el.querySelector(`button[data-a="${a}"]`) as HTMLButtonElement).click();
  const flush = async () => { for (let i = 0; i < 4; i++) {await new Promise((r) => setTimeout(r, 0));} };

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

  test('opens on the clicked frame; the scrubber is the slot: a tick per frame it holds', async () => {
    teardown = mountPlayer(el, fr(30), ctx(), () => {});
    expect(cap()).toBe('site / cam — 10:30:00');
    await flush();
    expect(el.querySelectorAll('.tick')).toHaveLength(5);
    expect(cap()).toBe('site / cam — 10:30:00 · 1/5 in slot');
    expect(el.querySelector('.stage img')!.getAttribute('src')).toBe('f30.jpg');
    expect(times).toEqual([]);
  });

  test('dropped time within the slot is drawn on its scrubber', async () => {
    // slot 10:25-10:30: nothing from 10:20 (due) until 10:26
    teardown = mountPlayer(el, fr(26), ctx(), () => {});
    await flush();
    expect(el.querySelectorAll('.lane.dropped')).toHaveLength(1);
    expect(el.querySelectorAll('.tick')).toHaveLength(4);
  });

  test('previous and next frame stay within the slot, and the crosshair stays still', async () => {
    teardown = mountPlayer(el, fr(30), ctx(), () => {});
    await flush();
    for (let i = 0; i < 6; i++) {press('next');}
    expect(cap()).toBe('site / cam — 10:34:00 · 5/5 in slot');
    press('prev');
    expect(hhmm()).toBe('10:33');
    expect(times).toEqual([]);
  });

  test('next slot: the frame the strip shows for it, and the crosshair moves to it', async () => {
    teardown = mountPlayer(el, fr(30), ctx(), () => {});
    await flush();
    press('next-slot');
    await flush();
    expect(cap()).toBe('site / cam — 10:35:00 · 1/5 in slot');
    expect(times).toEqual([at(35)]);
    press('prev-slot'); press('prev-slot');
    await flush();
    expect(hhmm()).toBe('10:25');
    expect(times).toEqual([at(35), at(30), at(25)]);
  });

  test('play loops the slot\'s frames; the crosshair stays still', async () => {
    teardown = mountPlayer(el, fr(30), ctx(), () => {});
    await flush();
    jest.useFakeTimers();
    press('play');
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) { jest.advanceTimersByTime(250); seen.push(hhmm()); }
    expect(seen).toEqual(['10:31', '10:32', '10:33', '10:34', '10:30', '10:31']);
    expect(times).toEqual([]);
    press('play');
    jest.advanceTimersByTime(1000);
    expect(hhmm()).toBe('10:31');
  });

  test('a slot of one frame has nothing to play or step through', async () => {
    const minuteSlots = (t: number) => { const from = Math.floor(t / MIN) * MIN; return { from, to: from + MIN, ts: from, frameTs: from }; };
    teardown = mountPlayer(el, fr(30), ctx({ slotAt: minuteSlots, step: MIN }), () => {});
    await flush();
    for (const a of ['play', 'prev', 'next']) {
      expect((el.querySelector(`button[data-a="${a}"]`) as HTMLButtonElement).disabled).toBe(true);
    }
  });

  test('a thinned answer: the slot\'s frames are fetched again at full resolution', async () => {
    const thinned = all.filter((f) => (f.ts - T0) % (5 * MIN) === 0);
    const asked: Array<[number, number]> = [];
    teardown = mountPlayer(el, fr(30), ctx({
      fetch: async (from, to) => thinned.filter((f) => f.ts >= from && f.ts <= to),
      detail: async (from, to) => { asked.push([from, to]); return all.filter((f) => f.ts >= from && f.ts < to); },
    }), () => {});
    await flush();
    expect(asked).toEqual([[at(30), at(35)]]);
    expect(el.querySelectorAll('.tick')).toHaveLength(5);
    expect((el.querySelector('button[data-a="play"]') as HTMLButtonElement).disabled).toBe(false);
    press('next-slot');
    await flush();
    expect(asked).toEqual([[at(30), at(35)], [at(35), at(40)]]);
  });

  test('thumbnails are the slot\'s frames, each as wide as it stands; the choice is remembered', async () => {
    teardown = mountPlayer(el, fr(30), ctx(), () => {});
    await flush();
    press('style');
    expect(el.classList.contains('thumbs')).toBe(true);
    expect([...el.querySelectorAll('.thumb img')].map((i) => i.getAttribute('src'))).toEqual(['f30.jpg', 'f31.jpg', 'f32.jpg', 'f33.jpg', 'f34.jpg']);
    expect((el.querySelector('.thumb') as HTMLElement).style.width).toBe('20%');
    expect(JSON.parse(localStorage.getItem('ktl-player')!)).toMatchObject({ style: 'thumbs' });
    teardown();
    el.textContent = '';
    teardown = mountPlayer(el, fr(30), ctx(), () => {});
    expect(el.classList.contains('thumbs')).toBe(true);
  });
});
