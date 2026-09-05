// Whether the position under the location arrow is still worth trusting.
//
// The arrow is the one thing on this map a person acts on directly, and until
// this existed it looked exactly the same whether the fix behind it was two
// seconds old or two hours: walking into a slot canyon takes the sky away, the
// watcher simply stops being called, and the last fix stays drawn — confident,
// coloured, and increasingly a lie. Losing a signal is the ABSENCE of an event,
// so nothing but a clock can notice it; this module is the rule, and the ticker
// that runs it lives in MapScreen next to the watcher it judges.
//
// RN-free and pure so the rule is testable, because the fault it exists to
// catch cannot be reproduced at a desk: you have to lose the sky to see it.
//
// PRIVACY: takes a timestamp and an accuracy RADIUS. No coordinate enters this
// module and none is published from it.

/**
 * How long a fix goes on speaking for the present.
 *
 * The map's watcher asks for 3 s, so this is six missed deliveries — long
 * enough that an ordinary skipped fix (a tree, a turn under an overhang)
 * doesn't flicker the arrow grey, short enough that walking into a canyon shows
 * up while the person is still near where the arrow says they are.
 *
 * This is only answerable because the watcher no longer carries a
 * `distanceInterval`: Android ANDs it with `timeInterval`, so with one set a
 * phone standing still produces NO callbacks at all, and "standing still" and
 * "no signal" would be the same observation. The 5 m displacement filter moved
 * into JS (see the watcher) so the dot and camera behave as they always did.
 */
export const FIX_STALE_MS = 20_000;

/**
 * The accuracy radius past which the fix is a guess about a suburb.
 *
 * The other way a signal goes without going: with GNSS blocked but cell or wifi
 * in range, Android's fused provider keeps answering — from towers, hundreds to
 * thousands of metres out — and those fixes arrive on time, so the staleness
 * rule above never fires. A real GNSS fix is a few metres and a bad one is
 * tens; nothing that saw a satellite reports 100 m. Deliberately generous: this
 * must never grey an arrow that is merely having a mediocre day.
 */
export const FIX_COARSE_M = 100;

/**
 * The displacement filter the OS used to apply, now applied here.
 *
 * Same 5 m as the `distanceInterval` it replaces, and for the same reason: GPS
 * wander alone would otherwise walk the dot around a stationary user and, in a
 * follow mode, drag the camera with it.
 */
export const FIX_MOVE_MIN_M = 5;

export type FixQuality =
  /** Recent and precise: draw the arrow in the user's colour. */
  | "live"
  /** Nothing has arrived in FIX_STALE_MS. The arrow is where they last were. */
  | "stale"
  /** Arriving, but from towers rather than satellites. */
  | "coarse";

export type FixLiveness = {
  /** The platform's own timestamp, not our arrival time — a cached fix replayed
   *  by the OS has to read as the age it actually is (the first thing the
   *  watcher does is apply `getLastKnownPositionAsync`, which indoors or after a
   *  drive with location off can be hours old and hundreds of km away). */
  atMs: number;
  /** Metres, 68% confidence. Null when the platform didn't say. */
  accuracyM: number | null;
};

/**
 * How much to trust the last fix, as of `nowMs`.
 *
 * Staleness outranks coarseness: an old tower fix is not "coarse but current".
 * An unknown accuracy is NOT treated as coarse — it's a platform quirk, not
 * evidence about the sky, and greying on it would spend the signal on noise.
 */
export function fixQuality(fix: FixLiveness | null, nowMs: number): FixQuality {
  if (fix == null) return "stale";
  if (nowMs - fix.atMs > FIX_STALE_MS) return "stale";
  if (fix.accuracyM != null && fix.accuracyM > FIX_COARSE_M) return "coarse";
  return "live";
}
