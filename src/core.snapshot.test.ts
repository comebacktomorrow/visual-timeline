/// <reference types="node" />
import { readFileSync } from 'fs';
import { join } from 'path';
import * as core from './core';

/* Safety net for splitting src/core.ts (#64): the public surface and the
 * rendered DOM must not change while code moves between modules. A
 * deliberate change to either updates the snapshot in the same PR, so the
 * diff shows it. */

describe('public surface', () => {
  test('core.ts exports', () => {
    expect(Object.keys(core).sort()).toMatchSnapshot();
  });

  test('the VTCore global built into web/vt-core.js', () => {
    // the standalone app and the embed only see this bundle (npm run build:web)
    const src = readFileSync(join(__dirname, '..', 'web', 'vt-core.js'), 'utf8');
    const VTCore = new Function(`${src}\nreturn VTCore;`)();
    expect(Object.keys(VTCore).sort()).toMatchSnapshot();
  });
});

describe('rendered DOM (demo data)', () => {
  // a fixed clock and a past window: deterministic demo frames, no live poll
  const NOW = Date.UTC(2026, 8, 15, 12, 0, 0);
  const P = { from: NOW - 3 * 3600e3, to: NOW - 3600e3 };
  let root: HTMLElement;
  let restore: Array<() => void>;

  beforeEach(() => {
    restore = [];
    const now = jest.spyOn(Date, 'now').mockReturnValue(NOW);
    restore.push(() => now.mockRestore());
    // jsdom has no canvas: the demo backend draws frames and the axis measures text
    const proto = HTMLCanvasElement.prototype;
    const getContext = proto.getContext;
    const toDataURL = proto.toDataURL;
    proto.getContext = function () {
      return new Proxy(
        { measureText: (t: string) => ({ width: String(t).length * 6 }) },
        { get: (o: any, k) => (k in o ? o[k] : () => undefined), set: () => true }
      );
    } as never;
    proto.toDataURL = function (this: HTMLCanvasElement) {
      return `data:stub/${this.width}x${this.height}`;
    };
    restore.push(() => {
      proto.getContext = getContext;
      proto.toDataURL = toDataURL;
    });
    // jsdom never loads images, so no load event ever fires: fire one when
    // a src is set, as a browser would once the image arrives. The strip
    // images load through a newest-first queue that waits for those events
    // (ui/imageQueue.ts), and the snapshots must show every one loaded.
    const imgProto = window.HTMLImageElement.prototype;
    const srcDesc = Object.getOwnPropertyDescriptor(imgProto, 'src')!;
    Object.defineProperty(imgProto, 'src', {
      ...srcDesc,
      set(this: HTMLImageElement, v: string) {
        srcDesc.set!.call(this, v);
        setTimeout(() => this.dispatchEvent(new window.Event('load')), 0);
      },
    });
    restore.push(() => Object.defineProperty(imgProto, 'src', srcDesc));
    root = document.createElement('div');
    document.body.appendChild(root);
  });
  afterEach(() => {
    restore.reverse().forEach((r) => r());
    document.body.innerHTML = '';
  });

  // wait until the mount has built everything and two reads agree
  async function settled(sel: string, count: number) {
    let prev = '';
    for (let i = 0; i < 200; i++) {
      await new Promise((r) => setTimeout(r, 10));
      if (root.querySelectorAll(sel).length >= count) {
        const html = root.innerHTML;
        if (html === prev) {
          return html;
        }
        prev = html;
      }
    }
    throw new Error(`not settled: ${sel}`);
  }

  const modes = ['bar', 'inline', 'inline-gradient'];

  test.each(modes)('timeline, %s header', async (headerMode) => {
    const inst = core.mountTimeline(root, { ...P, width: 800, headerMode, timeZone: 'UTC', showDetails: true });
    expect(await settled('.card', 5)).toMatchSnapshot('at rest');
    inst.setExternalCursor(P.from + 50 * 60e3);
    expect(root.innerHTML).toMatchSnapshot('cursor at +50m');
    inst.destroy();
  });

  test('timeline, source-local thumbnail times', async () => {
    const inst = core.mountTimeline(root, { ...P, width: 800, timeZone: 'UTC', thumbTimes: 'source' });
    await settled('.card', 5);
    inst.setExternalCursor(P.from + 50 * 60e3);
    expect(root.innerHTML).toMatchSnapshot();
    inst.destroy();
  });

  test.each(modes)('grid, %s header', async (headerMode) => {
    const inst = core.mountGrid(root, { ...P, width: 800, headerMode, timeZone: 'UTC' });
    expect(await settled('.tile', 5)).toMatchSnapshot('at rest');
    inst.setExternalCursor(P.from + 50 * 60e3);
    expect(root.innerHTML).toMatchSnapshot('cursor at +50m');
    inst.destroy();
  });
});
