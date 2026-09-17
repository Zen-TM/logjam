// What you can DO with a way, in one place.
//
// Logjam GPS learned this the hard way (`mobile/src/saved/assetActions.ts`): a
// verb list written per surface drifts, and a verb wired into only one of them
// ships invisible. Ways had three surfaces disagreeing — a row's ⋯, a detail
// page's ⋯, and controls inline in the detail body — with no rule saying which
// belonged where (operator, 2026-09-17). The rule now:
//
//   * A PROPERTY you change in place is inline in the detail body: the colour,
//     which place it belongs to. Not a verb, never in a menu.
//   * A VERB is in ⋯, and nowhere else.
//   * BOTH ⋯ surfaces render THIS list. They may differ by exactly one verb:
//     "Open", which the detail page omits because you are already looking at
//     the thing. That is the same single exception the phone allows.
//
// A verb is ABSENT when it cannot exist for this way (a file has no direction
// to reverse), never present-and-refused — the API answers 403 or 404 for the
// ones the user may not have, so offering them would be a lie (DESIGN.md §7).
//
// A verb that ENDS the user's relationship with the way sits below a rule
// (`separated`), whether or not it destroys anything. There are three, and only
// one of them is a delete: Remove drops the caller's own share and the owner
// keeps their row; "Save to my Ways and remove" is the same thing with a copy
// kept first, offered as ONE verb because it is one decision — as two steps it
// asks the user to guess whether the copy survives the removal. Remove arrived
// here on 2026-09-17 from a button in the detail body, which is the one place a
// verb may not be, and where it read as a leftover from another app.
//
// Two things left this list the same day, both because a menu was the wrong
// home for them:
//   * REVERSE is a button in the draw tool while a route is open for editing.
//     It changes the geometry you are looking at, so it belongs beside the
//     other edits to that geometry rather than behind a menu that closes.
//   * VISIBILITY was a per-file switch on a detail page, which is a control the
//     user had to open a page to find. The Layers overlays draw these files
//     now, so the switch has nowhere left to be and nothing left to do.
import type { WayItem, WayKind } from "./waysModel";

export type WayVerbId =
  | "open"
  | "openPlace"
  | "edit"
  | "copy"
  | "copyAndRemove"
  | "share"
  | "exportGpx"
  | "exportKml"
  | "rename"
  | "removeShare"
  | "delete";

export type WayVerb = {
  id: WayVerbId;
  label: string;
  /** The last step of losing something: rendered in the warning tone. */
  danger?: boolean;
  /**
   * A rule goes above this verb — it ends the user's relationship with the way
   * (it leaves the account, one way or another), so it never sits flush against
   * an ordinary one.
   *
   * SEPARATE FROM `danger`, because the two are not the same claim: Remove
   * destroys nothing (the owner keeps their copy) and must never be styled or
   * worded as a delete, but it still belongs below the rule.
   */
  separated?: boolean;
};

/** Which surface is asking. The two differ by one verb, and only one. */
export type WaySurface = "row" | "detail";

const LABELS: Record<WayVerbId, string> = {
  open: "Open",
  openPlace: "Open its place",
  edit: "Edit points",
  // Not "Copy": the promise is that it becomes YOURS — editable, permanent, and
  // unaffected by the owner later unsharing it. Logjam GPS draws the same
  // distinction between a live share and a copy you keep.
  copy: "Save to my Ways",
  // The two halves said in the order they happen. Someone who has decided they
  // want to keep a friend's route and stop carrying the share should not have
  // to do it as two steps and guess whether the first survives the second.
  copyAndRemove: "Save to my Ways and remove",
  share: "Share…",
  exportGpx: "Export as GPX",
  exportKml: "Export as KML",
  rename: "Rename…",
  // "Remove", not "Remove share" or "Delete": it drops the caller's own share
  // (`DELETE .../me`) and the owner keeps their row. The wording is the one
  // `removeShareConfirm` in shared/src/sharing.ts promises.
  removeShare: "Remove",
  delete: "Delete",
};

/** A route's geometry is inline, so the browser can write it out itself. A
 *  file's is an object in S3 that the page has not downloaded. */
const EXPORTABLE_KINDS: readonly WayKind[] = ["route"];

/**
 * The verbs for one way, in menu order.
 *
 * `owned` is the whole permission model here: every write verb belongs to the
 * owner, and a way shared with you offers only what reading allows — plus the
 * one verb that makes a copy of its own.
 */
export function wayVerbs(
  way: Pick<WayItem, "kind" | "shared" | "placeId" | "viaPlace">,
  surface: WaySurface,
): WayVerb[] {
  const owned = !way.shared;
  // Shared WITH a share row of its own, so the user can drop it. A way reached
  // through someone's place has none: the place's share is the only thing
  // holding it, and every verb that acts on "my share of this" is absent
  // rather than present-and-refused.
  const direct = !owned && !way.viaPlace;
  const verb = (id: WayVerbId, extra?: Partial<WayVerb>): WayVerb => ({
    id,
    label: LABELS[id],
    ...extra,
  });

  const verbs: WayVerb[] = [];
  // The one verb the two surfaces differ by: on the detail page you are
  // already looking at it.
  if (surface === "row") verbs.push(verb("open"));
  if (way.placeId) verbs.push(verb("openPlace"));

  if (owned && way.kind === "route") verbs.push(verb("edit"));
  // Taking your own copy of someone else's route. `POST /routes/:id/copy` has
  // existed since sharing shipped and nothing on the web ever offered it
  // (operator, 2026-09-17), so a sharee's only way to keep a route was to
  // export it and import it back. Routes only: a file on a shared place is
  // media, and no copy endpoint takes one.
  if (direct && way.kind === "route") verbs.push(verb("copy"));
  if (owned) verbs.push(verb("share"));
  if (EXPORTABLE_KINDS.includes(way.kind)) {
    verbs.push(verb("exportGpx"), verb("exportKml"));
  }
  // A route is renamed by the form that named it; a file is renamed in place.
  if (owned && way.kind !== "route") verbs.push(verb("rename"));

  // Below the rule: the ways this stops being something the user carries.
  // "Save to my Ways and remove" sits with Remove rather than with Copy because
  // what it ENDS is the share — the copy is how it ends well.
  if (direct && way.kind === "route") {
    verbs.push(verb("copyAndRemove", { separated: true }));
  }
  if (direct) verbs.push(verb("removeShare", { separated: true }));
  if (owned) verbs.push(verb("delete", { danger: true, separated: true }));
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
): { colour: boolean; place: boolean } {
  const owned = !way.shared;
  return {
    // The colour IS the way's identity on the map — but only a ROUTE's can be
    // changed from here. `PATCH /media/:id` takes a display name and nothing
    // else (it 400s without one), so a file's colour is set by whatever made
    // the file. Offering a picker that silently did nothing would be worse
    // than not offering one.
    colour: owned && way.kind === "route",
    // Which place it belongs to: shown always, changeable by the owner.
    place: true,
  };
}
