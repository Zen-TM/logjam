// What you can DO with a way, in one place.
//
// Logjam GPS learned this the hard way (`mobile/src/saved/assetActions.ts`): a
// verb list written per surface drifts, and a verb wired into only one of them
// ships invisible. Ways had three surfaces disagreeing — a row's ⋯, a detail
// page's ⋯, and controls inline in the detail body — with no rule saying which
// belonged where (operator, 2026-09-17). The rule now:
//
//   * A PROPERTY you change in place is inline in the detail body: the colour,
//     whether it is drawn on the map, which place it belongs to. Not a verb,
//     never in a menu.
//   * A VERB is in ⋯, and nowhere else.
//   * BOTH ⋯ surfaces render THIS list. They may differ by exactly one verb:
//     "Open", which the detail page omits because you are already looking at
//     the thing. That is the same single exception the phone allows.
//
// A verb is ABSENT when it cannot exist for this way (a file has no direction
// to reverse), never present-and-refused — the API answers 403 or 404 for the
// ones the user may not have, so offering them would be a lie (DESIGN.md §7).
import type { WayItem, WayKind } from "./waysModel";

export type WayVerbId =
  | "open"
  | "openPlace"
  | "edit"
  | "reverse"
  | "share"
  | "exportGpx"
  | "exportKml"
  | "rename"
  | "delete";

export type WayVerb = {
  id: WayVerbId;
  label: string;
  /** The last step of losing something: rendered in the warning tone. */
  danger?: boolean;
};

/** Which surface is asking. The two differ by one verb, and only one. */
export type WaySurface = "row" | "detail";

const LABELS: Record<WayVerbId, string> = {
  open: "Open",
  openPlace: "Open its place",
  edit: "Edit points",
  reverse: "Reverse direction",
  share: "Share…",
  exportGpx: "Export as GPX",
  exportKml: "Export as KML",
  rename: "Rename…",
  delete: "Delete",
};

/** A route's geometry is inline, so the browser can write it out itself. A
 *  file's is an object in S3 that the page has not downloaded. */
const EXPORTABLE_KINDS: readonly WayKind[] = ["route"];

/**
 * The verbs for one way, in menu order.
 *
 * `owned` is the whole permission model here: every write verb belongs to the
 * owner, and a way shared with you offers only what reading allows.
 */
export function wayVerbs(
  way: Pick<WayItem, "kind" | "shared" | "placeId">,
  surface: WaySurface,
): WayVerb[] {
  const owned = !way.shared;
  const verb = (id: WayVerbId, danger?: boolean): WayVerb => ({
    id,
    label: LABELS[id],
    ...(danger ? { danger: true } : {}),
  });

  const verbs: WayVerb[] = [];
  // The one verb the two surfaces differ by: on the detail page you are
  // already looking at it.
  if (surface === "row") verbs.push(verb("open"));
  if (way.placeId) verbs.push(verb("openPlace"));

  if (owned && way.kind === "route") {
    verbs.push(verb("edit"), verb("reverse"));
  }
  if (owned) verbs.push(verb("share"));
  if (EXPORTABLE_KINDS.includes(way.kind)) {
    verbs.push(verb("exportGpx"), verb("exportKml"));
  }
  // A route is renamed by the form that named it; a file is renamed in place.
  if (owned && way.kind !== "route") verbs.push(verb("rename"));
  if (owned) verbs.push(verb("delete", true));
  return verbs;
}

/**
 * Which PROPERTIES this way shows inline on its detail page.
 *
 * Declared beside the verbs so the split is visible in one file rather than
 * being a habit each panel follows differently.
 */
export function wayProperties(
  way: Pick<WayItem, "kind" | "shared" | "placeId">,
): { colour: boolean; visibility: boolean; place: boolean } {
  const owned = !way.shared;
  return {
    // The colour IS the way's identity on the map — but only a ROUTE's can be
    // changed from here. `PATCH /media/:id` takes a display name and nothing
    // else (it 400s without one), so a file's colour is set by whatever made
    // the file. Offering a picker that silently did nothing would be worse
    // than not offering one.
    colour: owned && way.kind === "route",
    // Map visibility belongs to a file that has no Layers row of its own. A
    // route has one (the Routes layer), and a file on a place is drawn by the
    // place-tracks layer, so neither gets a switch that would do nothing.
    visibility: owned && way.kind !== "route" && way.placeId === null,
    // Which place it belongs to: shown always, changeable by the owner.
    place: true,
  };
}
