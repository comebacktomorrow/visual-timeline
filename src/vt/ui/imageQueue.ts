/* Strip images load newest first, a few at a time, across every source in
 * the panel. A strip holds one image per slot (hundreds per source), and
 * setting them all at once let the browser fetch them in DOM order, oldest
 * first, so on a slow link the live edge (what a viewer looks at) arrived
 * last. Now each card's images are queued by frame time and the queue keeps
 * IMAGE_CONCURRENCY requests in flight, always taking the newest waiting
 * image, so every card fills in from the right.
 *
 * Images the viewer asks for directly don't queue: the magnifier and the
 * preview set their own src, and the live poll's new frames are the newest
 * anyway.
 *
 * An image whose host takes the connection and never answers would hold its
 * slot until the browser gave up (minutes), and a few of them would stop
 * every other host's images: a slot is let go after IMAGE_TIMEOUT_MS, and
 * the image left to finish on its own. */
export const IMAGE_CONCURRENCY = 6;
/** How long an image holds its place in the queue (ms). */
export const IMAGE_TIMEOUT_MS = 15_000;

export interface ImageQueue {
  add(img: HTMLImageElement, url: string, ts: number): void;
  /** resolves once nothing is waiting or loading */
  idle(): Promise<void>;
  /** drop everything still waiting (the mount was torn down) */
  stop(): void;
}

interface Job { img: HTMLImageElement; url: string; ts: number }

export function makeImageQueue(concurrency = IMAGE_CONCURRENCY, timeoutMs = IMAGE_TIMEOUT_MS): ImageQueue {
  let pending: Job[] = [];   // kept sorted oldest → newest, so pop() takes the newest
  let sorted = true;
  let active = 0;
  let stopped = false;
  let scheduled = false;
  let pumping = false;
  let idleWaiters: Array<() => void> = [];
  // the in-flight images' timeouts, cleared on stop()
  const timers = new Set<ReturnType<typeof setTimeout>>();

  function settleIdle() {
    if (active === 0 && pending.length === 0) {
      const w = idleWaiters;
      idleWaiters = [];
      w.forEach((r) => r());
    }
  }

  /* An image already in the browser's cache can complete synchronously, and
   * its done() calls pump() again. Re-entering would recurse once per cached
   * image (a rebuild of a big panel overflowed the stack), so a nested call
   * returns and the running loop takes the freed slot instead. */
  function pump() {
    scheduled = false;
    if (stopped || pumping) {return;}
    pumping = true;
    if (!sorted) {
      pending.sort((a, b) => a.ts - b.ts);
      sorted = true;
    }
    while (active < concurrency && pending.length) {
      const job = pending.pop()!;
      active++;
      let finished = false;
      // a hung image lets go of its slot; it may still load later
      let timer: ReturnType<typeof setTimeout> | null = null;
      const done = () => {
        if (finished) {return;}
        finished = true;
        if (timer) { clearTimeout(timer); timers.delete(timer); }
        job.img.removeEventListener('load', done);
        job.img.removeEventListener('error', done);
        active--;
        pump();
      };
      job.img.addEventListener('load', done);
      job.img.addEventListener('error', done);
      job.img.src = job.url;
      // already in the browser's cache: some engines complete synchronously
      if (job.img.complete && job.img.naturalWidth) {done();}
      else if (!finished) { timer = setTimeout(done, timeoutMs); timers.add(timer); }
    }
    pumping = false;
    settleIdle();
  }

  return {
    add(img, url, ts) {
      if (stopped) {return;}
      pending.push({ img, url, ts });
      sorted = false;
      // a card adds all its images at once: sort and start them together
      if (!scheduled) {
        scheduled = true;
        queueMicrotask(pump);
      }
    },
    idle() {
      if (stopped || (active === 0 && pending.length === 0 && !scheduled)) {return Promise.resolve();}
      return new Promise<void>((resolve) => idleWaiters.push(resolve));
    },
    stop() {
      stopped = true;
      pending = [];
      // torn down: no timer left behind (the images finish or not on their own)
      for (const t of timers) {clearTimeout(t);}
      timers.clear();
      const w = idleWaiters;
      idleWaiters = [];
      w.forEach((r) => r());
    },
  };
}
