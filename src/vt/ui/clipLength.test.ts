import { clipLength, measureReel, noteClipLength, REMEMBER_MAX } from './clipLength';
import type { Reel } from '../model/reel';

/* The lengths and ratios learned are capped (L7): the least recently used
 * go first. */
describe('remembered clip lengths', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });
  const settle = async () => { for (let i = 0; i < 4; i++) {await Promise.resolve();} };
  // known: answered at once; forgotten: asked of a video again (which, in
  // jsdom, never answers: given up on after the probe's time)
  const known = async (url: string) => {
    let got: number | null | undefined;
    void clipLength(url).then((s) => { got = s; });
    await settle();
    jest.advanceTimersByTime(10_000);
    await settle();
    return got;
  };

  test('lengths: at most REMEMBER_MAX, the least recently used forgotten first', async () => {
    for (let i = 0; i < REMEMBER_MAX; i++) {noteClipLength(`u${i}.webm`, i + 1);}
    expect(await known('u0.webm')).toBe(1);   // used: now the most recent
    noteClipLength('new.webm', 9);            // one over: u1 goes
    expect(await known('new.webm')).toBe(9);
    expect(await known('u0.webm')).toBe(1);
    expect(await known('u1.webm')).toBeNull();
    expect(await known(`u${REMEMBER_MAX - 1}.webm`)).toBe(REMEMBER_MAX);
  });

  test('hosts\' ratios: capped the same way', async () => {
    const reel = (url: string) => ({ ratio: null, clips: [{ from: 0, to: 1000, url }] }) as unknown as Reel;
    // each host learns its ratio from its first clip, whose length is known
    for (let i = 0; i <= REMEMBER_MAX; i++) {
      noteClipLength(`h${i}.webm`, 2);
      await measureReel(reel(`h${i}.webm`), `host${i}`);
    }
    // host0 was pushed out: its next reel asks a clip again (an unknown one here)
    const r0 = reel('unknown0.webm');
    const p0 = measureReel(r0, 'host0');
    await settle();
    jest.advanceTimersByTime(10_000);
    expect(await p0).toBe(false);
    expect(r0.ratio).toBeNull();
    // host1 is still remembered: no clip asked
    const r1 = reel('unknown1.webm');
    expect(await measureReel(r1, 'host1')).toBe(true);
    expect(r1.ratio).toBe(2 / 1000);
  });
});
