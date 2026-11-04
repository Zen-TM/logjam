// Takes each notification tap exactly once, and holds it until the navigator can
// act on it.
//
// A tap that STARTS the app arrives before there is a navigator to send it to
// (and, behind the consent gate, long before there is a screen): it is read off
// the last-response slot when the shell mounts, which can happen again on a
// sign-in change, so the same tap is offered more than once. Its own module,
// free of React Native imports, so it can be unit-tested: AppShell cannot be
// loaded by vitest. Guard: `tapIntake.test.ts`.

export type TapIntake<T> = {
  /** A tap, from the live listener or the cold-start slot. */
  offer: (id: string, tap: T) => void;
  /** The navigator became ready: release the tap that was waiting. */
  flush: () => void;
};

export function createTapIntake<T>(
  isReady: () => boolean,
  go: (tap: T) => void,
): TapIntake<T> {
  const seen = new Set<string>();
  let waiting: T | null = null;
  const flush = () => {
    if (waiting === null || !isReady()) return;
    const tap = waiting;
    waiting = null;
    go(tap);
  };
  return {
    offer(id, tap) {
      if (seen.has(id)) return;
      seen.add(id);
      // Only the newest waits: two taps before the navigator is up means the
      // user tapped again, and the second is the one they meant.
      waiting = tap;
      flush();
    },
    flush,
  };
}
