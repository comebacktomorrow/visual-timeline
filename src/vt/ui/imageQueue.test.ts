import { IMAGE_CONCURRENCY, makeImageQueue } from './imageQueue';

/* jsdom never loads images: the tests fire load/error themselves. */
const flush = () => new Promise((r) => setTimeout(r, 0));
const img = () => document.createElement('img');

describe('makeImageQueue', () => {
  test('loads newest first, a few at a time, across everything added', async () => {
    const q = makeImageQueue();
    const imgs = new Map<number, HTMLImageElement>();
    // two "cards" added separately, interleaved in time
    for (const ts of [1, 3, 5, 7, 9, 11]) {
      const i = img();
      imgs.set(ts, i);
      q.add(i, `https://x/${ts}.jpg`, ts);
    }
    for (const ts of [2, 4, 6, 8, 10, 12]) {
      const i = img();
      imgs.set(ts, i);
      q.add(i, `https://x/${ts}.jpg`, ts);
    }
    const loading = () => [...imgs].filter(([, i]) => i.getAttribute('src')).map(([ts]) => ts);
    await flush();
    expect(loading().sort((a, b) => b - a)).toEqual([12, 11, 10, 9].slice(0, IMAGE_CONCURRENCY));
    // each finished image starts the newest one still waiting
    for (const ts of [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]) {
      imgs.get(ts)!.dispatchEvent(new Event(ts % 3 ? 'load' : 'error'));   // errors free a slot too
      await flush();
    }
    expect(loading().length).toBe(12);
    await expect(q.idle()).resolves.toBeUndefined();
  });

  test('never has more than IMAGE_CONCURRENCY in flight', async () => {
    const q = makeImageQueue();
    const all = Array.from({ length: 20 }, (_, n) => {
      const i = img();
      q.add(i, `https://x/${n}.jpg`, n);
      return i;
    });
    await flush();
    expect(all.filter((i) => i.getAttribute('src')).length).toBe(IMAGE_CONCURRENCY);
    all[19].dispatchEvent(new Event('load'));
    all[19].dispatchEvent(new Event('load'));   // a duplicate event must not free two slots
    await flush();
    expect(all.filter((i) => i.getAttribute('src')).length).toBe(IMAGE_CONCURRENCY + 1);
  });

  test('stop() drops what is still waiting and releases idle()', async () => {
    const q = makeImageQueue();
    const all = Array.from({ length: 10 }, (_, n) => {
      const i = img();
      q.add(i, `https://x/${n}.jpg`, n);
      return i;
    });
    await flush();
    const idle = q.idle();
    q.stop();
    await expect(idle).resolves.toBeUndefined();
    all[9].dispatchEvent(new Event('load'));
    await flush();
    expect(all.filter((i) => i.getAttribute('src')).length).toBe(IMAGE_CONCURRENCY);
  });
});
