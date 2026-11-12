// The ONE decision about a place's single route slot: what is in it, what
// displacing that costs, and in which order the swap has to be written.
//
// A place holds AT MOST ONE route, and that slot has two possible occupants
// which nothing server-side knows about together:
//
//   - a drawn Route row (`Route.placeId`, unique);
//   - a standalone FILE linked as the place's way (`Media.linkedId`) — an
//     import the user brought in, or a recording.
//
// Both are displaced by unlinking, and both survive it. A file is linked (not
// copied), so replacing a way costs nothing and destroys nothing — the same
// promise `Route.placeId`'s SetNull makes.
//
// Five sources fill that slot (a route you drew, an import, a recorded track, a
// file off the phone, a line drawn on the map). All read the occupant, the
// confirmation copy and the write order from here to keep slot-replacement
// semantics consistent. `fillRouteSlot.ts` is the runner that acts on them.
//
// PRIVACY: the place name and the attachment's filename appear only in a
// confirm the user opened for that place — never in a log or an error string.
import {
  IMPORT_TO_PLACE_PROMISE,
  mediaCategory,
  mediaDisplayName,
  routeSlotDisplaceConfirm as sharedDisplaceConfirm,
  type ConfirmCopy,
  type WaySource,
} from "@logjam/shared";
import type { MirrorMedia } from "../sync/mirrorStore";

export { IMPORT_TO_PLACE_PROMISE, type WaySource };

/**
 * What a source actually WRITES into the slot. A recorded track is converted
 * into a Route first (the recording is an immutable observation and is never
 * linked), so it writes a route link; an import and a picked file link the
 * media row itself.
 *
 * Both are links. The distinction exists only because the two live in
 * different tables and the swap has to know which one to unlink.
 */
export function waySourceWrites(source: WaySource): "route" | "media" {
  return source === "import" || source === "file" ? "media" : "route";
}

/**
 * The sentence a recorded track says BEFORE the fact, because what it does is
 * not what its verb sounds like. The import's is shared with Logjam Web.
 */
export const TRACK_TO_ROUTE_PROMISE =
  "A route is created from the recording and linked to the place. The recording itself is left alone.";

export type RouteSlotOccupant =
  | { kind: "route"; id: string; name: string }
  | { kind: "file"; media: MirrorMedia }
  | null;

/**
 * What fills this place's route slot right now.
 *
 * @param routes every route the mirror holds (own + shared).
 * @param media place track attachments — one place's media or the whole
 *   account's; non-track rows and other places are filtered out here so no
 *   caller has to remember to.
 * @param ignoreRouteId the route being MOVED, when this is a re-link: it is
 *   its own incumbent otherwise, and would ask to displace itself.
 *
 * A drawn route wins a tie. Both occupants at once is a state neither the API
 * nor Logjam GPS can produce deliberately, and the drawn route is the one the
 * place screen shows, so it is the one the user is being asked about.
 */
export function routeSlotOccupant(
  placeId: string,
  routes: readonly { id: string; name: string; placeId: string | null }[],
  media: readonly MirrorMedia[],
  ignoreRouteId?: string | null,
): RouteSlotOccupant {
  const route = routes.find(
    (candidate) =>
      candidate.placeId === placeId && candidate.id !== ignoreRouteId,
  );
  if (route) return { kind: "route", id: route.id, name: route.name };
  const file = media.find(
    (item) =>
      item.linkedType === "place" &&
      item.linkedId === placeId &&
      mediaCategory(item.mediaType) === "track",
  );
  if (file) return { kind: "file", media: file };
  return null;
}

/**
 * What the user is agreeing to. Null when the slot is free — nothing to ask.
 *
 * The incoming way is deliberately NOT named: three of the five sources have
 * not chosen a file yet at the moment this is asked, and a sentence that can
 * only sometimes name the replacement is a sentence that reads differently
 * depending on how you got here.
 */
export function routeSlotDisplaceConfirm(
  placeName: string,
  occupant: RouteSlotOccupant,
): ConfirmCopy | null {
  if (!occupant) return null;
  return sharedDisplaceConfirm("gps", placeName, {
    kind: occupantKind(occupant),
    name:
      occupant.kind === "route"
        ? occupant.name
        : mediaDisplayName(occupant.media),
  });
}

/**
 * A file with no `origin` was uploaded onto the place (from Logjam Web) and has
 * no life apart from it: the API refuses to unlink one (400), so replacing it
 * deletes it, in the same step as the write that replaces it (shared `replacedUploadId`). An import or recording is unlinked and kept.
 */
export function occupantKind(
  occupant: NonNullable<RouteSlotOccupant>,
): "route" | "file" | "upload" {
  if (occupant.kind === "route") return "route";
  return occupant.media.origin === null ? "upload" : "file";
}

/**
 * Does the incumbent have to go BEFORE the new way is written?
 *
 * Normally no: the link is written first and the incumbent removed second, so
 * a failed removal leaves the place briefly showing both (visible, fixable)
 * rather than neither.
 *
 * The ONE exception is file-over-file. `assertPlaceTrackSlotFree`
 * (api/src/routes/media.ts) answers a second track on a place with 409, so
 * writing first doesn't leave two — it parks the link op and lands nothing at
 * all. Unlinking first is cheap and reversible since it destroys nothing,
 * which is what makes this ordering safe rather than merely necessary.
 */
export function removeOccupantFirst(
  writes: "route" | "media",
  occupant: RouteSlotOccupant,
): boolean {
  return writes === "media" && occupant?.kind === "file";
}
