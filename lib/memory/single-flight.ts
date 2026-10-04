/**
 * One task per key at a time, in process.
 *
 * A key's concurrent callers share the first task's promise; the entry is
 * removed the moment it settles, so a later call starts a fresh task rather than
 * reading a cached result. That is the whole contract, and it is what makes a
 * nudge and a cron pass on one instance run one extraction instead of two.
 *
 * In-process only. Two app replicas have two maps and can still overlap; the
 * sweep is at-least-once, and `decideFactWrite`'s identical-object noop is what
 * absorbs the overlap that remains.
 */
export interface SingleFlight<T> {
  run(key: string, task: () => Promise<T>): Promise<T>;
}

export function createSingleFlight<T>(): SingleFlight<T> {
  const inFlight = new Map<string, Promise<T>>();

  return {
    run(key, task) {
      const existing = inFlight.get(key);
      if (existing) return existing;

      // An async IIFE so a synchronous throw becomes a rejected promise and the
      // entry below is set on both paths.
      const promise = (async () => task())();
      inFlight.set(key, promise);

      // `then(cleanup, cleanup)` rather than `finally`: `finally` re-raises, so
      // its derived promise would carry an unhandled rejection for every failed
      // sweep. The identity check keeps a stale settle from deleting a newer task.
      const settle = () => {
        if (inFlight.get(key) === promise) inFlight.delete(key);
      };
      promise.then(settle, settle);

      return promise;
    },
  };
}
