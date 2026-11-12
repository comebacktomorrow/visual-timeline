import { loopClipSpan, makeVideo, preloadAfter, releaseVideo } from './media';

describe('shared media helpers', () => {
  afterEach(() => jest.restoreAllMocks());

  test('loopClipSpan plays the part round and round at its rate; its stop clears the handlers', () => {
    const play = jest.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    const v = makeVideo(true);
    const times: number[] = [];
    let meta = 0;
    // a 100 s clip of 1000 s of time; the part from 250 to 500
    const stop = loopClipSpan(v, { clip: { from: 0, to: 1000, url: 'c.webm' }, from: 250, to: 500 }, 4, { metadata: () => meta++, time: (t) => times.push(t) });
    expect(v.getAttribute('src')).toBe('c.webm');
    Object.defineProperty(v, 'duration', { configurable: true, value: 100 });
    v.dispatchEvent(new Event('loadedmetadata'));
    expect(meta).toBe(1);
    expect(v.currentTime).toBe(25);
    expect(v.playbackRate).toBe(4);
    expect(play).toHaveBeenCalledTimes(1);
    v.currentTime = 40;
    v.dispatchEvent(new Event('timeupdate'));
    expect(times).toEqual([400]);
    expect(play).toHaveBeenCalledTimes(1);
    v.currentTime = 50;   // the part's end: round again
    v.dispatchEvent(new Event('timeupdate'));
    expect(v.currentTime).toBe(25);
    expect(play).toHaveBeenCalledTimes(2);
    stop();
    v.dispatchEvent(new Event('ended'));
    expect(play).toHaveBeenCalledTimes(2);
  });

  test('releaseVideo lets go of the download', () => {
    const load = jest.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    const v = makeVideo(false, 'metadata');
    v.src = 'c.webm';
    releaseVideo(v);
    expect(v.hasAttribute('src')).toBe(false);
    expect(load).toHaveBeenCalled();
  });

  test('preloadAfter loads the next frames after a time, round to the first, sending no Referer', () => {
    const made: HTMLImageElement[] = [];
    const Real = window.Image;
    jest.spyOn(window, 'Image').mockImplementation(() => { const i = new Real(); made.push(i); return i; });
    const frames = [10, 20, 30, 40].map((ts) => ({ ts, url: `f${ts}` }));
    preloadAfter(frames, 25);
    expect(made.map((i) => i.getAttribute('src'))).toEqual(['f30', 'f40', 'f10']);
    expect(made.every((i) => i.referrerPolicy === 'no-referrer')).toBe(true);
  });
});
