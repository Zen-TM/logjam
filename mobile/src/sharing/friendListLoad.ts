// When the friend list asks the server for friends — and when it asks again.
//
// Its own module, free of React Native imports, so it can be unit-tested:
// SharePanel pulls in the RN runtime and vitest cannot parse React Native's
// Flow sources. Same split, and the same reason, as `shareRowSubtitle.ts`.

/**
 * A key identifying the load the friend list should be running right now, or
 * null for "issue no request".
 *
 * A KEY rather than a boolean, because the retry depends on identity change: a
 * failed load leaves the list null and changes none of the other inputs, so a
 * boolean predicate reads identically before and after the user taps Retry and
 * the load would never run a second time (leaving the panel stuck on "Couldn't
 * load friends." until the whole sheet is closed and reopened). Bumping
 * `attempt` changes the key, and a changed key triggers the retry.
 *
 * Null covers the three states that must not reach the network: a sheet that
 * is closed (nothing on screen is waiting for an answer), a caller without the
 * sharing capability (a guest has no friends and no endpoint that would answer
 * them), and a list already loaded — nothing here re-fetches on its own.
 */
export function friendListLoadKey(args: {
  active: boolean;
  available: boolean;
  loaded: boolean;
  attempt: number;
}): string | null {
  if (!args.active || !args.available || args.loaded) return null;
  return `attempt:${args.attempt}`;
}
