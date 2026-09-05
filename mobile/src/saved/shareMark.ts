// How a Saved row says what sharing has happened to it. RN-free so the branch
// is testable — `SavedScreen` only renders what this decides.
//
// TWO facts, and they are not the same KIND of fact, which is why they get two
// different marks rather than two similar words:
//
//   RECEIVED  — a permission fact. The row is not yours, it is read-only here,
//               and someone else can take it away. It names that someone,
//               because "who can revoke this" is the thing worth knowing and
//               the bare word "Shared" never said it.
//   SHARED OUT — your own fan-out. A count you control, informational only. It
//               is a GLYPH, not a pill: same reasoning as the backed-up cloud
//               beside it — it sits on rows the user is not asking about most
//               of the time, and a repeated word down a list stops being read
//               while eating the width the title needs (DESIGN.md §5, and the
//               "a pill that costs the TITLE" note in §11).
//
// The old pair was `Shared` and `Shared with 3` — one word apart, same tone,
// same slot, opposite meanings.

export type ShareMark = {
  /** Trailing pill for a row shared WITH the viewer. Absent on owned rows. */
  pill?: { label: string; tone: "outline" };
  /** People an OWNED row is shared with. Absent when nobody, or not ours. */
  sharedWithCount?: number;
};

/**
 * `canyonIds` is every canyon the row hangs off (a route has at most one, a
 * waypoint can have several). The first that resolves to an incoming share
 * names the owner — a row visible through two shares is still one person's, and
 * whichever share is found says the same thing.
 */
export function shareMark(input: {
  syncRole: string | null;
  sharedCount: number | null;
  canyonIds: readonly (string | null)[];
  ownersByCanyon: Record<string, string>;
}): ShareMark {
  if (input.syncRole === "shared") {
    const owner = input.canyonIds
      .map((canyonId) => (canyonId ? input.ownersByCanyon[canyonId] : undefined))
      .find((username) => username != null);
    // No owner resolved (the share row hasn't reached the mirror yet, or the
    // asset outlived it) still says the whole phrase. Never the bare word
    // "Shared" — that is the ambiguity this file exists to remove.
    return { pill: { label: owner ? `From ${owner}` : "Shared with you", tone: "outline" } };
  }
  return input.sharedCount ? { sharedWithCount: input.sharedCount } : {};
}

/** Screen-reader text for the fan-out glyph — the count the pill used to say. */
export function sharedWithLabel(count: number): string {
  return `Shared with ${count} ${count === 1 ? "person" : "people"}`;
}
