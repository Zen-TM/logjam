// The kinds of line a user keeps: Logjam Web's Ways page rail and Logjam GPS's
// Saved tab. Guard: `ways.test.ts`.
import type { IconIdea } from "../icons.js";

/** In the order Logjam Web's rail offers them. Routes first: the only kind
 *  authored there. */
export const WAY_KINDS = ["route", "track", "import"] as const;

export type WayKind = (typeof WAY_KINDS)[number];

/**
 * What each kind IS, never where it lives. `label` is one of them, `plural`
 * a chip that labels the group.
 */
export const WAY_KIND_WORDS: Record<
  WayKind,
  { label: string; plural: string; icon: IconIdea }
> = {
  route: { label: "Route", plural: "Routes", icon: "route" },
  // Not named for a format ("GPX & KML"), and not for lines ("Ways"): a row is
  // a whole file the user brought in, and may hold points and polygons as
  // readily as lines.
  import: { label: "Import", plural: "Imports", icon: "importedFile" },
  track: { label: "Track", plural: "Tracks", icon: "track" },
};
