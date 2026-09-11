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
// BOTH are displaced by UNLINKING now, and both survive it. That is the change
// that made this file smaller: a file used to be COPIED into the place, so
// displacing one deleted the copy and the confirm had to say so. A file is
// linked, so replacing a way costs nothing and destroys nothing — the same
// promise `Route.placeId`'s SetNull always made.
//
// Five sources fill that slot (a route you drew, an import, a recorded track, a
// file off the phone, a line drawn on the map). Each of them deciding for
// itself what to warn about is how one ended up silently deleting a file, so
// they all read the occupant, the sentence and the write order from here.
// `fillRouteSlot.ts` is the runner that acts on them.
//
// PRIVACY: the place name and the attachment's filename appear only in a
// confirm the user opened for that place (DESIGN.md §11) — never in a log or
// an error string.
import { mediaCategory, mediaDisplayName } from "@logjam/shared";

import type { DeleteConfirmCopy } from "./placeDeleteConfirm";
import type { MirrorMedia } from "../sync/mirrorStore";

/** Where a new way comes from. The panel that offers all five is AddWaySheet. */
export type WaySource = "route" | "track" | "import" | "file" | "draw";

/**
 * What a source actually WRITES into the slot. A recorded track is converted
 * into a Route first (the recording is an immutable observation and is never
 * linked), so it writes a route link; an import and a picked file link the
 * media row itself.
 *
 * Both are links now. The distinction survives only because the two live in
 * different tables and the swap has to know which one to unlink.
 */
export function waySourceWrites(source: WaySource): "route" | "media" {
  return source === "import" || source === "file" ? "media" : "route";
}

/**
 * The two sentences a source has to say BEFORE the fact, because what it does
 * is not what its verb sounds like. Written once, on the SharePanel rule: a
 * promise argued at each call site is a promise that drifts.
 */
export const TRACK_TO_ROUTE_PROMISE =
  "A route is created from the recording and linked to the place. The recording itself is left alone.";
export const IMPORT_TO_PLACE_PROMISE =
  "The file is linked to the place, so anyone you share it with can see it. It stays in Saved, and unlinking it later leaves it there.";

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
 * nor this app can produce deliberately, and the drawn route is the one the
 * place screen shows, so it is the one the user is being asked about.
 */
export function routeSlotOccupant(
  placeId: string,
  routes: readonly { id: string; name: string; placeId: string | null }[],
  media: readonly MirrorMedia[],
  ignoreRouteId?: string | null,
): RouteSlotOccupant {
  const route = routes.find(
    (candidate) => candidate.placeId === placeId && candidate.id !== ignoreRouteId,
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
): DeleteConfirmCopy | null {
  if (!occupant) return null;
  return {
    confirmTitle: `${placeName} already has a route`,
    confirmBody:
      occupant.kind === "route"
        ? `“${occupant.name}” will be unlinked, but the route is kept.`
        : `“${mediaDisplayName(occupant.media)}” will be unlinked, but the file is kept in Saved.`,
  };
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
 * all. Unlinking first is cheap and reversible now that it destroys nothing,
 * which is what makes this ordering safe rather than merely necessary.
 */
export function removeOccupantFirst(
  writes: "route" | "media",
  occupant: RouteSlotOccupant,
): boolean {
  return writes === "media" && occupant?.kind === "file";
}
