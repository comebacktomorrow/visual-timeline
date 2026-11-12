import { frameIndexAt } from '../model/playhead';
import { buildIntervals } from '../model/intervals';
import { thinWithCounts } from '../../shared/frameRecords';
import { mountPlayer, type PlayerContext } from './player';
import { noteClipLength } from './clipLength';
import type { Clip, Frame } from '../types';

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
    intervals: (frames, range, sample) => buildIntervals({ frames, window: range, now: at(999), promiseAt: () => MIN, sample }).intervals,
    slotAt: fiveMinuteSlots,
    onTime: (t) => times.push(t),
    tt: { time: (t: number) => new Date(t).toISOString().slice(11, 19), short: (t: number) => new Date(t).toISOString().slice(11, 16), sfx: () => '' } as never,
    label: 'site / cam',
    ...extra,
  });
  // the title on top, and the time of what's shown below
  const cap = () => el.querySelector('.title')!.textContent! + ' — ' + el.querySelector('.time')!.textContent!;
  const hhmm = () => el.querySelector('.time')!.textContent!.slice(0, 5);
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
    expect(cap()).toBe('site / cam — 10:30:00');
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
    expect(cap()).toBe('site / cam — 10:34:00');
    press('prev');
    expect(hhmm()).toBe('10:33');
    expect(times).toEqual([]);
  });

  test('next slot: the frame the strip shows for it, and the crosshair moves to it', async () => {
    teardown = mountPlayer(el, fr(30), ctx(), () => {});
    await flush();
    press('next-slot');
    await flush();
    expect(cap()).toBe('site / cam — 10:35:00');
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

  test('playing stops on a gap too, and shows its reason', async () => {
    // slot 10:25-10:30: dropped until 10:26, then 10:26 to 10:29
    teardown = mountPlayer(el, fr(26), ctx(), () => {});
    await flush();
    jest.useFakeTimers();
    press('play');
    const seen: string[] = [];
    for (let i = 0; i < 5; i++) {
      jest.advanceTimersByTime(250);
      seen.push(hhmm() + ' ' + el.querySelector('.stage .state')!.textContent);
    }
    expect(seen).toEqual(['10:27 ', '10:28 ', '10:29 ', '10:25 offline', '10:26 ']);
    expect(times).toEqual([]);
  });

  test('a thumbnail ends where its frame stops being shown, so a gap after it shows', async () => {
    // 10:30 and 10:31, then nothing until 10:34: 10:31's promise breaks at 10:32
    const sparse = [...all.filter((f) => f.ts < at(30) || f.ts > at(33)), fr(30), fr(31)].sort((a, z) => a.ts - z.ts);
    teardown = mountPlayer(el, fr(30), ctx({ fetch: async (from, to) => sparse.filter((f) => f.ts >= from && f.ts <= to) }), () => {});
    await flush();
    press('style-thumbs');
    const widths = [...el.querySelectorAll<HTMLElement>('.thumb')].map((c) => c.style.width);
    expect(widths).toEqual(['20%', '20%', '20%']);
    expect(el.querySelectorAll('.lane.dropped')).toHaveLength(1);
  });

  test('the scrubber follows the mouse, within the slot, and pauses playing', async () => {
    teardown = mountPlayer(el, fr(32), ctx(), () => {});
    await flush();
    const scrub = el.querySelector('.scrub') as HTMLElement;
    scrub.getBoundingClientRect = () => ({ left: 0, width: 500, top: 0, height: 20, right: 500, bottom: 20, x: 0, y: 0, toJSON: () => ({}) });
    press('play');
    scrub.dispatchEvent(new MouseEvent('pointermove', { clientX: 120 }));
    expect(hhmm()).toBe('10:31');
    expect(el.querySelector('button[data-a="play"]')!.textContent).toBe('▶');
    scrub.dispatchEvent(new MouseEvent('pointermove', { clientX: 499 }));
    expect(hhmm()).toBe('10:34');
    expect(times).toEqual([]);
  });

  test('more frames than the slot\'s timeline can tell apart: it draws some, evenly, and says how many there are', async () => {
    // a frame every second for the slot 10:30-10:35: 300
    const dense = Array.from({ length: 300 }, (_, i) => ({ ts: at(30) + i * 1000, url: `d${i}.jpg` }));
    teardown = mountPlayer(el, dense[0], ctx({ fetch: async (from, to) => dense.filter((f) => f.ts >= from && f.ts <= to) }), () => {});
    await flush();
    // 560 px wide (unlaid out), a tick per 7 px (the default Frame width)
    expect(el.querySelectorAll('.tick')).toHaveLength(80);
    expect(cap()).toBe('site / cam (showing 80 of 300) — 10:30:00');
    expect(el.querySelector('button[data-a="zoom"]')).toBeNull();
    press('style-thumbs');
    expect(el.querySelectorAll('.thumb')).toHaveLength(11);
    // and they tile the slot: no blank space between the frames drawn
    const total = [...el.querySelectorAll<HTMLElement>('.thumb')].reduce((a, c) => a + parseFloat(c.style.width), 0);
    expect(total).toBeCloseTo(100, 5);
  });

  test('the slot is asked for no more frames than its timeline draws; a thinned answer\'s counts say how many it holds', async () => {
    const asked: number[] = [];
    // five rows, each standing for 60 frames
    const thinned = [30, 31, 32, 33, 34].map((m) => ({ ...fr(m), count: 60 }));
    teardown = mountPlayer(el, thinned[0], ctx({
      detail: async (from, to, maxPoints) => { asked.push(maxPoints!); return thinned.filter((f) => f.ts >= from && f.ts < to); },
      onZoom: () => {},
    }), () => {});
    await flush();
    // a tick per 7 px of 560, for the slot and the one before it
    expect(asked).toEqual([160]);
    expect(cap()).toBe('site / cam (showing 5 of 300) — 10:30:00');
    expect(el.querySelector('button[data-a="zoom"]')!.classList.contains('hint')).toBe(true);
    // thumbnails show the same frames, as pictures: nothing asked again
    press('style-thumbs');
    await flush();
    expect(asked).toEqual([160]);
  });

  test('a thinned slot is judged at the interval it was asked for at, not drawn offline between its rows', async () => {
    // a frame a second promised and taken; the source thins to the points
    // asked for, as ours does (each kept row counting its bucket)
    const every = Array.from({ length: 600 }, (_, i) => ({ ts: at(25) + i * 1000, url: `s${i}.jpg` }));
    teardown = mountPlayer(el, every[300], ctx({
      intervals: (frames, range, sample) => buildIntervals({ frames, window: range, now: at(999), promiseAt: () => 1000, sample }).intervals,
      detail: async (from, to, maxPoints) => thinWithCounts(every, from, to, Math.ceil((to - from) / maxPoints!)).filter((f) => f.ts >= from && f.ts < to),
    }), () => {});
    await flush();
    expect(el.querySelectorAll('.lane.dropped')).toHaveLength(0);
    // thinned: the title says how many of the slot's frames are shown
    expect(el.querySelector('.title')!.textContent).toMatch(/^site \/ cam \(showing 80 of (29\d|30\d)\)$/);
  });

  test('the panel\'s Frame width sets the ticks\' spacing', async () => {
    const dense = Array.from({ length: 300 }, (_, i) => ({ ts: at(30) + i * 1000, url: `d${i}.jpg` }));
    teardown = mountPlayer(el, dense[0], ctx({ frameWidth: 20, fetch: async (from, to) => dense.filter((f) => f.ts >= from && f.ts <= to) }), () => {});
    await flush();
    expect(el.querySelectorAll('.tick')).toHaveLength(28);
  });

  test('more frames than drawn: Zoom is highlighted, and says why', async () => {
    const dense = Array.from({ length: 300 }, (_, i) => ({ ts: at(30) + i * 1000, url: `d${i}.jpg` }));
    teardown = mountPlayer(el, dense[0], ctx({ fetch: async (from, to) => dense.filter((f) => f.ts >= from && f.ts <= to), onZoom: () => {} }), () => {});
    await flush();
    const zoom = el.querySelector('button[data-a="zoom"]') as HTMLButtonElement;
    expect(zoom.classList.contains('hint')).toBe(true);
    expect(zoom.title).toBe('300 frames in this slot, 80 shown: zoom the dashboard to the slot to see them all');
  });

  test('Zoom sets the dashboard\'s range to the slot, and closes the player', async () => {
    const zooms: Array<[number, number]> = [];
    let closed = 0;
    teardown = mountPlayer(el, fr(30), ctx({ onZoom: (from, to) => zooms.push([from, to]) }), () => {}, () => { closed++; });
    await flush();
    press('zoom');
    expect(zooms).toEqual([[at(30), at(35)]]);
    expect(closed).toBe(1);
  });

  test('no Zoom where the mount can\'t zoom (the grid)', async () => {
    teardown = mountPlayer(el, fr(30), ctx(), () => {});
    expect(el.querySelector('button[data-a="zoom"]')).toBeNull();
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
    expect(asked).toEqual([[at(25), at(35)]]);
    expect(el.querySelectorAll('.tick')).toHaveLength(5);
    expect((el.querySelector('button[data-a="play"]') as HTMLButtonElement).disabled).toBe(false);
    press('next-slot');
    await flush();
    expect(asked).toEqual([[at(25), at(35)], [at(30), at(40)]]);
  });

  test('thumbnails are the slot\'s frames, each as wide as it stands; the choice is remembered', async () => {
    teardown = mountPlayer(el, fr(30), ctx(), () => {});
    await flush();
    press('style-thumbs');
    expect(el.classList.contains('thumbs')).toBe(true);
    expect([...el.querySelectorAll('.thumb img')].map((i) => i.getAttribute('src'))).toEqual(['f30.jpg', 'f31.jpg', 'f32.jpg', 'f33.jpg', 'f34.jpg']);
    expect((el.querySelector('.thumb') as HTMLElement).style.width).toBe('20%');
    expect(JSON.parse(localStorage.getItem('ktl-player')!)).toMatchObject({ style: 'thumbs' });
    teardown();
    el.textContent = '';
    teardown = mountPlayer(el, fr(30), ctx(), () => {});
    expect(el.classList.contains('thumbs')).toBe(true);
  });

  describe('a video clip in the slot (M10c)', () => {
    // 10:31 to 10:34 recorded as a clip, with a larger version
    const clip = { from: at(31), to: at(34), url: 'c.webm', hi: 'c-hi.webm' };
    const clipCtx = (clips: Clip[] = [clip]) => ctx({ clips: async (from, to) => clips.filter((c) => c.to > from && c.from < to) });
    let played: number;
    beforeEach(() => {
      played = 0;
      // how long each clip plays, as its metadata would say (jsdom loads no video)
      noteClipLength('c.webm', 30);      // 3 minutes in 30 s: sped up 3×
      noteClipLength('w.webm', 7);       // 7 minutes in 7 s
      noteClipLength('long.webm', 180);  // real time: zoomed out, too long to watch
      noteClipLength('fast.webm', 60);   // 3 minutes in a minute: 6×
      jest.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => { played++; return Promise.resolve(); });
      jest.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
      jest.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    });
    /* the video says how long it is, as a browser does once it has the metadata */
    const metadata = (v: HTMLVideoElement, duration: number) => {
      Object.defineProperty(v, 'duration', { configurable: true, value: duration });
      Object.defineProperty(v, 'readyState', { configurable: true, value: 1 });
      v.dispatchEvent(new Event('loadedmetadata'));
    };

    test('Play toggled before the video\'s metadata arrives starts it once, not once per press (L3)', async () => {
      const rafs = jest.spyOn(window, 'requestAnimationFrame');
      teardown = mountPlayer(el, fr(30), clipCtx(), () => {});
      await flush();
      press('next');   // 10:31: in the clip, its video not loaded yet
      const v = el.querySelector('.stage video:not(.spare)') as HTMLVideoElement;
      press('play'); press('play'); press('play');   // play, pause, play
      metadata(v, 30);
      await flush();
      expect(played).toBe(1);
      expect(rafs).toHaveBeenCalledTimes(1);
      // paused before it arrives: nothing starts when it does
      press('play');
      Object.defineProperty(v, 'readyState', { configurable: true, value: 0 });
      press('play');
      press('play');
      v.dispatchEvent(new Event('loadedmetadata'));
      await flush();
      expect(el.querySelector('button[data-a="play"]')!.textContent).toBe('▶');
      expect(played).toBe(1);
    });

    test('it plays over the stills: a plain bar on the scrubber, no ticks under it', async () => {
      teardown = mountPlayer(el, fr(30), clipCtx(), () => {});
      await flush();
      expect(el.querySelectorAll('.lane.clip')).toHaveLength(1);
      // the stills outside it, and a tick where the clip starts
      expect(el.querySelectorAll('.tick:not(.clip-start)')).toHaveLength(2);
      expect(el.querySelectorAll('.tick.clip-start')).toHaveLength(1);
      expect(el.classList.contains('has-clip')).toBe(true);
      expect(el.classList.contains('has-hi')).toBe(true);
      expect(el.classList.contains('video')).toBe(false);
      press('next');
      expect(hhmm()).toBe('10:31');
      expect(el.classList.contains('video')).toBe(true);
      expect(el.querySelector('video')!.getAttribute('src')).toBe('c-hi.webm');
    });

    test('the scrubber seeks the video by the time\'s fraction of the clip; HD and sound are switched and remembered', async () => {
      teardown = mountPlayer(el, fr(30), clipCtx(), () => {});
      await flush();
      const scrub = el.querySelector('.scrub') as HTMLElement;
      scrub.getBoundingClientRect = () => ({ left: 0, width: 500, top: 0, height: 20, right: 500, bottom: 20, x: 0, y: 0, toJSON: () => ({}) });
      scrub.dispatchEvent(new MouseEvent('pointermove', { clientX: 150 }));   // 10:31:30
      const v = el.querySelector('video')!;
      metadata(v, 30);
      expect(v.currentTime).toBeCloseTo(5);
      scrub.dispatchEvent(new MouseEvent('pointermove', { clientX: 250 }));   // 10:32:30
      expect(v.currentTime).toBeCloseTo(15);
      expect(v.muted).toBe(true);
      press('mute');
      expect(v.muted).toBe(false);
      press('hd');
      expect(v.getAttribute('src')).toBe('c.webm');
      expect(JSON.parse(localStorage.getItem('ktl-player')!)).toMatchObject({ hd: false, muted: false });
    });

    test('a clip\'s slot opens with no frame; Play plays the video; the crosshair stays still', async () => {
      const whole = { from: at(29), to: at(36), url: 'w.webm' };
      teardown = mountPlayer(el, null, clipCtx([whole]), () => {}, () => {}, at(32));
      await flush();
      expect(el.classList.contains('video')).toBe(true);
      expect(el.classList.contains('has-hi')).toBe(false);
      expect((el.querySelector('button[data-a="play"]') as HTMLButtonElement).disabled).toBe(false);
      metadata(el.querySelector('video')!, 7);
      press('play');
      await flush();
      expect(played).toBe(1);
      expect(el.querySelector('button[data-a="play"]')!.textContent).toBe('❚❚');
      expect(times).toEqual([]);
    });

    test('the speed button is the video\'s speed: 1x to start, stepping up to 16x and round from 1/4x', async () => {
      // a clip on into the next slot
      noteClipLength('on.webm', 90);
      teardown = mountPlayer(el, fr(30), clipCtx([{ from: at(31), to: at(40), url: 'on.webm' }]), () => {});
      await flush();
      const fps = el.querySelector('button[data-a="fps"]')!;
      expect(fps.textContent).toBe('1×');
      press('fps');
      expect(fps.textContent).toBe('2×');
      for (let i = 0; i < 4; i++) {press('fps');}
      expect(fps.textContent).toBe('¼×');
      press('fps');
      expect(fps.textContent).toBe('½×');
      press('next');
      metadata(el.querySelector('.stage video:not(.spare)')!, 90);
      press('play');
      await flush();
      expect((el.querySelector('.stage video:not(.spare)') as HTMLVideoElement).playbackRate).toBe(0.5);
      // the viewer's speed stays as the player moves on
      press('next-slot');
      await flush();
      expect(fps.textContent).toBe('½×');
    });

    test('with Speed up video to fit: what plays the slot\'s video in about ten seconds, refitted per slot', async () => {
      teardown = mountPlayer(el, fr(30), { ...clipCtx([{ from: at(31), to: at(34), url: 'fast.webm' }]), autoSpeed: true }, () => {});
      await flush();
      const fps = el.querySelector('button[data-a="fps"]')!;
      expect(fps.textContent).toBe('6×');
      press('fps');
      expect(fps.textContent).toBe('8×');
    });

    test('several clips in a slot play one after another, the next loading meanwhile; each a tick and a picture', async () => {
      noteClipLength('s1.webm', 2);
      noteClipLength('s2.webm', 2);
      const two = [{ from: at(30), to: at(32), url: 's1.webm' }, { from: at(32), to: at(35), url: 's2.webm' }];
      teardown = mountPlayer(el, fr(30), clipCtx(two), () => {});
      await flush();
      expect(el.querySelectorAll('.tick.clip-start')).toHaveLength(2);
      press('style-thumbs');
      expect([...el.querySelectorAll('.thumb.clip img')].map((i) => i.getAttribute('src'))).toEqual(['f30.jpg', 'f32.jpg']);
      const [shown, spare] = [...el.querySelectorAll('.stage video')] as HTMLVideoElement[];
      metadata(shown, 2);
      press('play');
      await flush();
      // the second clip loads in the spare while the first plays
      expect(spare.classList.contains('spare')).toBe(true);
      expect(spare.getAttribute('src')).toBe('s2.webm');
      expect(spare.preload).toBe('auto');
    });

    test('stepping slot to slot through video: each slot\'s clips, at its place in them', async () => {
      noteClipLength('d1.webm', 7);
      noteClipLength('d2.webm', 7);
      // two clips, the second starting mid-slot (10:37)
      const days = [{ from: at(20), to: at(37), url: 'd1.webm' }, { from: at(37), to: at(60), url: 'd2.webm' }];
      teardown = mountPlayer(el, fr(30), clipCtx(days), () => {});
      await flush();
      const src = () => (el.querySelector('.stage video:not(.spare)') as HTMLVideoElement).getAttribute('src');
      expect(src()).toBe('d1.webm');
      expect(el.querySelectorAll('.lane.clip')).toHaveLength(1);
      press('next-slot');
      await flush();
      // 10:35 to 10:40: the end of the first and the start of the second
      expect(el.querySelectorAll('.lane.clip')).toHaveLength(2);
      expect(el.querySelectorAll('.tick.clip-start')).toHaveLength(2);
      expect(src()).toBe('d1.webm');
      press('next-slot');
      await flush();
      expect(el.querySelectorAll('.lane.clip')).toHaveLength(1);
      expect(src()).toBe('d2.webm');
      expect(times).toEqual([at(35), at(40)]);
      press('prev-slot');
      press('prev-slot');
      await flush();
      expect(src()).toBe('d1.webm');
    });

    test('video it can\'t show at this scale: a bubble over the picture, which zooms to the slot', async () => {
      const zoomed: Array<[number, number]> = [];
      const long = [{ from: at(31), to: at(34), url: 'long.webm' }];
      teardown = mountPlayer(el, fr(30), { ...clipCtx(long), onZoom: (a, z) => zoomed.push([a, z]) }, () => {});
      await flush();
      expect(el.classList.contains('video-far')).toBe(true);
      (el.querySelector('.zoom-video') as HTMLButtonElement).click();
      expect(zoomed).toEqual([[at(30), at(35)]]);
    });

    test('a slot of video with no stills: no ticks-or-pictures choice', async () => {
      const whole = [{ from: at(29), to: at(36), url: 'w.webm' }];
      teardown = mountPlayer(el, null, { ...clipCtx(whole), fetch: async () => [] }, () => {}, () => {}, at(32));
      await flush();
      expect(el.classList.contains('no-stills')).toBe(true);
      expect(el.classList.contains('video')).toBe(true);
    });

    test('zoomed out, more video than plays in a few seconds: the slot\'s stills, as frames are; Zoom to watch it', async () => {
      const long = [{ from: at(31), to: at(34), url: 'long.webm' }];
      teardown = mountPlayer(el, fr(30), { ...clipCtx(long), onZoom: () => {} }, () => {});
      await flush();
      // the stills under the clip are its ticks again; the clip a bar under them
      expect(el.querySelectorAll('.tick')).toHaveLength(5);
      expect(el.querySelectorAll('.lane.clip')).toHaveLength(1);
      expect(el.querySelector('button[data-a="zoom"]')!.classList.contains('hint')).toBe(true);
      expect(el.querySelector('button[data-a="fps"]')!.textContent).toBe('4 fps');
      press('next');
      press('next');
      expect(hhmm()).toBe('10:32');
      expect(el.classList.contains('video')).toBe(false);
      expect(el.querySelector('.stage img')!.getAttribute('src')).toBe('f32.jpg');
    });
  });
});
