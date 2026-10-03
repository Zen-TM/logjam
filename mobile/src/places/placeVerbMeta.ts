// The glyph Logjam GPS draws each of a place's verbs with. Which verbs a place
// has, their order and their words are `PLACE_VERBS` in `@logjam/shared`, the
// declaration Logjam Web's menus render from too.
//
// RN-free on purpose, so `placesContracts.test.ts` can import it.
import type { Feather } from "@expo/vector-icons";
import type { PLACES_ADD, PlaceVerbIdOn, SectionKeysOn } from "@logjam/shared";

export type GpsPlaceVerbId = PlaceVerbIdOn<"gps">;

/** Exhaustive by type: a verb the contract gives Logjam GPS cannot go undrawn.
 *  The test checks it names no other. */
export const PLACE_VERB_ICON: Record<
  GpsPlaceVerbId,
  React.ComponentProps<typeof Feather>["name"]
> = {
  open: "book-open",
  show: "map",
  logTrip: "edit-3",
  edit: "edit-2",
  share: "share-2",
  copy: "copy",
  copyAndRemove: "archive",
  remove: "x-circle",
  delete: "trash-2",
};

/** The verbs that reach the server, so they dim with the reason offline. */
export const PLACE_VERB_NEEDS_CONNECTION: ReadonlySet<GpsPlaceVerbId> = new Set(
  ["share", "copy", "copyAndRemove", "remove"],
);

/** The glyph each way of adding places is drawn with. Logjam GPS has one. */
export const ADD_ENTRY_ICON: Record<
  SectionKeysOn<typeof PLACES_ADD, "gps">,
  React.ComponentProps<typeof Feather>["name"]
> = {
  add: "plus",
};
