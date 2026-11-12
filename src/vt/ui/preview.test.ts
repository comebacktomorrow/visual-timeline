import { buildIntervals } from '../model/intervals';
import { makePreview } from './preview';
import type { PlayerContext } from './player';
import type { Frame } from '../types';

const MIN = 60e3;
const T0 = Date.UTC(2026, 0, 1, 10, 0, 0);
const at = (m: number) => T0 + m * MIN;
const fr = (m: number): Frame => ({ ts: at(m), url: `f${m}.jpg` });
const all = Array.from({ length: 121 }, (_, i) => fr(i));
const flush = async () => { for (let i = 0; i < 4; i++) {await new Promise((r) => setTimeout(r, 0));} };
const tt = { time: (t: number) => new Date(t).toISOString().slice(11, 19), short: (t: number) => new Date(t).toISOString().slice(11, 16), sfx: () => '' } as never;

/* a mount's player context: five-minute slots, its crosshair moves logged */
function ctxFor(times: number[]): PlayerContext {
  const slotMin = 5;
  return {
    window: { from: at(0), to: at(120) },
    step: slotMin * MIN,
    fetch: async (from, to) => all.filter((f) => f.ts >= from && f.ts <= to),
    intervals: (frames, range, sample) => buildIntervals({ frames, window: range, now: at(999), promiseAt: () => MIN, sample }).intervals,
    slotAt: (t) => { const from = Math.floor((t - T0) / (slotMin * MIN)) * slotMin * MIN + T0; return { from, to: from + slotMin * MIN, ts: from, frameTs: from }; },
    onTime: (t) => times.push(t),
    tt,
  };
}

/* An open player survives a refresh (the successor mount adopts the
 * preview); the successor hands it its own context (L6). */
describe('a player adopted by a refresh remount', () => {
  let root: HTMLElement;
  const pop = () => document.querySelector<HTMLElement>('.ktl-pop');
  const press = (a: string) => pop()!.querySelector<HTMLButtonElement>(`button[data-a="${a}"]`)!.click();

  beforeEach(() => {
    localStorage.clear();
    jest.spyOn(Date, 'now').mockReturnValue(at(999));
    jest.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    root = document.createElement('div');
    document.body.appendChild(root);
  });
  afterEach(() => {
    makePreview(root, 'UTC').close();
    document.body.innerHTML = '';
    jest.restoreAllMocks();
  });

  test('steps the new mount\'s slots, and moves its crosshair, not the old one\'s', async () => {
    const oldTimes: number[] = [], newTimes: number[] = [];
    const first = makePreview(root, 'UTC');
    first.open('lab', 'cam', fr(30), 10, 10, null, null, tt, ctxFor(oldTimes));
    await flush();
    first.retire();   // the old mount's destroy()
    const next = makePreview(root, 'UTC');
    const asked: string[] = [];
    next.rebind((site, kiosk) => { asked.push(site + '/' + kiosk); return ctxFor(newTimes); });
    expect(asked).toEqual(['lab/cam']);
    press('next-slot');
    await flush();
    expect(newTimes).toEqual([at(35)]);
    expect(oldTimes).toEqual([]);
    expect(pop()!.querySelector('.title')!.textContent).toBe('lab / cam');
    // the same mount again (a later boot step): nothing changes
    next.rebind(() => { asked.push('again'); return null; });
    expect(asked).toEqual(['lab/cam']);
    expect(pop()).not.toBeNull();
  });

  test('a host the new mount no longer shows: the player closes', async () => {
    const first = makePreview(root, 'UTC');
    first.open('lab', 'cam', fr(30), 10, 10, null, null, tt, ctxFor([]));
    first.retire();
    makePreview(root, 'UTC').rebind(() => null);
    expect(pop()).toBeNull();
  });

  test('another panel\'s mount leaves it alone', async () => {
    const times: number[] = [];
    makePreview(root, 'UTC').open('lab', 'cam', fr(30), 10, 10, null, null, tt, ctxFor(times));
    const other = document.createElement('div');
    document.body.appendChild(other);
    let asked = 0;
    makePreview(other, 'UTC').rebind(() => { asked++; return null; });
    expect(asked).toBe(0);
    expect(pop()).not.toBeNull();
    press('next-slot');
    expect(times).toEqual([at(35)]);
  });
});

/* The player is a modal dialog: focus goes into it, and back (M6). */
describe('the player as a dialog', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(at(999));
    jest.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  });
  afterEach(() => {
    document.body.innerHTML = '';
    jest.restoreAllMocks();
  });

  test('aria-modal; focus moves into it on open and back to what had it on close', () => {
    const root = document.createElement('div');
    const opener = document.createElement('button');
    document.body.append(root, opener);
    opener.focus();
    const pv = makePreview(root, 'UTC');
    pv.open('lab', 'cam', fr(30), 10, 10, null, null, tt, ctxFor([]));
    const dlg = document.querySelector<HTMLElement>('.ktl-pop')!;
    expect(dlg.getAttribute('role')).toBe('dialog');
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(dlg);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('.ktl-pop')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  test('closed while focus is elsewhere: focus stays where it is', () => {
    const root = document.createElement('div');
    const opener = document.createElement('button'), other = document.createElement('input');
    document.body.append(root, opener, other);
    opener.focus();
    const pv = makePreview(root, 'UTC');
    pv.open('lab', 'cam', fr(30), 10, 10, null, null, tt, ctxFor([]));
    other.focus();
    pv.close();
    expect(document.activeElement).toBe(other);
  });
});
