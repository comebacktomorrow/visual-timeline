/* Source models build a few at a time: one at a time, a 50-source panel
 * waited for 50 /frames round trips in a row before anything showed. */
export const MODEL_CONCURRENCY = 6;

/** Runs fn on each item, at most `limit` at once, and returns one promise per
 * item in item order, so a caller can take the results in order as they
 * arrive without waiting for the slowest. fn should not throw: a rejection
 * the caller never awaits (it stopped early) would go unhandled. */
export function limited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Array<Promise<R>> {
  let running = 0;
  const waiting: Array<() => void> = [];
  const next = () => {
    running--;
    waiting.shift()?.();
  };
  return items.map((item) => new Promise<R>((resolve, reject) => {
    const run = () => {
      running++;
      Promise.resolve().then(() => fn(item)).then(resolve, reject).finally(next);
    };
    if (running < limit) {run();}
    else {waiting.push(run);}
  }));
}
