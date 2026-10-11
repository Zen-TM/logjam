// A PLACE'S VERBS, declared once for every surface that acts on one: its row
// in the list, its page, and (Logjam GPS) its pin on the map.
//
// A thing offers the same verbs wherever it appears (shared/DESIGN.md §9).
// The lists differ by exactly one verb each: Open, absent on the page you are
// already on, and (Logjam GPS only) Show on map, absent on the map. Ownership decides the rest:
// a place shared with you is somebody else's ground, so it is copied and let
// go of rather than edited and deleted.
import type { IconIdea } from "../icons.js";
import type { ContractPlatform } from "./types.js";

export type PlaceVerbSurface = "row" | "page" | "pin";

type VerbDeclaration = {
  id: string;
  /** The idea its glyph stands for, the same on both clients. */
  icon: IconIdea;
  /** One label, or one per client where what the verb opens differs. */
  label: string | Record<ContractPlatform, string>;
  /** Whose place offers it. */
  for: "owner" | "sharee" | "both";
  /** The one surface that leaves it out. */
  omitOn?: PlaceVerbSurface;
  /** Only this client has it, and `reason` says why. */
  on?: ContractPlatform;
  reason?: string;
  /** Destructive: the warning look, and a confirm that says what goes. */
  danger?: boolean;
  /** Below a rule, with the verbs that end the user's relationship with the
   *  place. Not the same as `danger`: Remove destroys nothing. */
  separated?: boolean;
};

const NO_MAP_FROM_A_PLACE =
  "Logjam GPS makes a map from an area framed on its map, not from a place.";

const OPENING_SHOWS_IT_ON_WEB =
  "On Logjam Web the map sits beside the page, and opening a place already flies it there.";

/** In menu order. */
export const PLACE_VERBS = [
  {
    id: "open",
    icon: "place",
    label: "Open place",
    for: "both",
    omitOn: "page",
  },
  {
    id: "show",
    icon: "map",
    label: "Show on map",
    for: "both",
    omitOn: "pin",
    on: "gps",
    reason: OPENING_SHOWS_IT_ON_WEB,
  },
  // Owner only: a trip links only its owner's places, and the API refuses the
  // rest.
  { id: "logTrip", icon: "trip", label: "Log a trip here", for: "owner" },
  { id: "edit", icon: "edit", label: "Edit place", for: "owner" },
  {
    id: "makeTopo",
    icon: "lidar",
    label: "Make a LiDAR topo here",
    for: "both",
    on: "web",
    reason: NO_MAP_FROM_A_PLACE,
  },
  {
    id: "makeGeoPdf",
    icon: "geoPdf",
    label: "Make a GeoPDF here",
    for: "both",
    on: "web",
    reason: NO_MAP_FROM_A_PLACE,
  },
  {
    id: "share",
    icon: "shareFriend",
    // Logjam Web's dialog also exports the place; Logjam GPS's panel shares.
    label: { web: "Share or export…", gps: "Share" },
    for: "owner",
    separated: true,
  },
  { id: "copy", icon: "copy", label: "Save a copy", for: "sharee" },
  // Keeping a copy and dropping the share is ONE decision, and it sits with
  // the parting verbs. Copy first, so a failure leaves the user with both
  // rather than neither.
  {
    id: "copyAndRemove",
    icon: "moveCopy",
    label: "Save a copy and remove",
    for: "sharee",
    separated: true,
  },
  {
    id: "remove",
    icon: "unshare",
    label: "Remove from my account",
    for: "sharee",
    separated: true,
  },
  {
    id: "delete",
    icon: "delete",
    label: "Delete place",
    for: "owner",
    danger: true,
    separated: true,
  },
] as const satisfies readonly VerbDeclaration[];

export type PlaceVerbId = (typeof PLACE_VERBS)[number]["id"];

/** The verbs one client has, on any surface, for either kind of place. */
export type PlaceVerbIdOn<P extends ContractPlatform> = Exclude<
  (typeof PLACE_VERBS)[number],
  { on: Exclude<ContractPlatform, P> }
>["id"];

export type PlaceVerb<P extends ContractPlatform = ContractPlatform> = {
  id: PlaceVerbIdOn<P>;
  icon: IconIdea;
  label: string;
  danger: boolean;
  separated: boolean;
};

/** Every verb id a client must be able to run. */
export function placeVerbIds<P extends ContractPlatform>(
  platform: P,
): PlaceVerbIdOn<P>[] {
  return (PLACE_VERBS as readonly VerbDeclaration[])
    .filter((verb) => verb.on == null || verb.on === platform)
    .map((verb) => verb.id as PlaceVerbIdOn<P>);
}

/** The verbs of one place on one surface, in order. */
export function placeVerbs<P extends ContractPlatform>(
  platform: P,
  surface: PlaceVerbSurface,
  owned: boolean,
): PlaceVerb<P>[] {
  return (PLACE_VERBS as readonly VerbDeclaration[])
    .filter(
      (verb) =>
        (verb.on == null || verb.on === platform) &&
        verb.omitOn !== surface &&
        (verb.for === "both" || verb.for === (owned ? "owner" : "sharee")),
    )
    .map((verb) => ({
      id: verb.id as PlaceVerbIdOn<P>,
      icon: verb.icon,
      label: typeof verb.label === "string" ? verb.label : verb.label[platform],
      danger: verb.danger ?? false,
      separated: verb.separated ?? false,
    }));
}

export type DeleteConfirmCopy = { confirmTitle: string; confirmBody: string };

/**
 * What deleting places costs, said once for every surface that offers Delete:
 * what goes, and what stays.
 *
 * PRIVACY: the place NAME is user-supplied text and belongs only in a confirm
 * the user opened for that place. Nothing here touches its position.
 *
 * @param target one place by name, or how many places a selection holds.
 * @param linkedTripCount trips that link to it and survive it, where the
 *   surface knows. Zero says nothing; unknown says it in general.
 */
export function placeDeleteConfirm(
  target: { name: string } | { count: number },
  linkedTripCount?: number,
): DeleteConfirmCopy {
  const one = "name" in target || target.count === 1;
  const trips =
    linkedTripCount == null
      ? `Trips that link to ${one ? "it" : "them"} stay in your logbook, unlinked.`
      : linkedTripCount === 0
        ? null
        : `${linkedTripCount} logged ${linkedTripCount === 1 ? "trip stays" : "trips stay"} in your logbook, unlinked.`;
  return {
    confirmTitle:
      "name" in target
        ? `Delete ${target.name}?`
        : one
          ? "Delete this place?"
          : `Delete ${target.count} places?`,
    confirmBody: [
      `${one ? "Its" : "Their"} notes, photos, tracks and shares go too.`,
      trips,
      "This can't be undone.",
    ]
      .filter(Boolean)
      .join(" "),
  };
}
