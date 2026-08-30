// The ONE decision about a canyon's single route slot: what is in it, what
// displacing that costs, and in which order the swap has to be written.
//
// A canyon holds AT MOST ONE route, and that slot has two possible occupants
// which nothing server-side knows about together:
//
//   - a drawn Route row (`Route.canyonId`, unique) — displaced by UNLINKING,
//     and the route survives standalone, so this is recoverable;
//   - an attached track MEDIA file (a .gpx/.kml uploaded against the canyon) —
//     displaced by DELETING it, which is not.
//
// Five sources now fill that slot (a route you drew, an import, a recorded
// track, a file off the phone, a line drawn on the map). Each of them deciding
// for itself what to warn about is how one ends up silently deleting a file,
// so they all read the occupant, the sentence and the write order from here.
// `fillRouteSlot.ts` is the runner that acts on them.
//
// PRIVACY: the canyon name and the attachment's filename appear only in a
// confirm the user opened for that canyon (DESIGN.md §11) — never in a log or
// an error string.
import { mediaCategory } from "@logjam/shared";

import type { DeleteConfirmCopy } from "./canyonDeleteConfirm";
import type { MirrorMedia } from "../sync/mirrorStore";

/** Where a new way comes from. The panel that offers all five is AddWaySheet. */
export type WaySource = "route" | "track" | "import" | "file" | "draw";

/**
 * What a source actually WRITES into the slot. A recorded track is converted
 * into a Route first (the recording is an immutable observation and is never
 * linked), so it writes a link like a drawn route does; an import and a picked
 * file are uploaded as canyon media.
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
  "A route is created from the recording and linked to the canyon. The recording itself is left alone.";
export const IMPORT_TO_CANYON_PROMISE =
  "A copy of the file is attached to the canyon, so anyone you share it with can see it. The import stays in Saved.";

export type RouteSlotOccupant =
  | { kind: "route"; id: string; name: string }
  | { kind: "file"; media: MirrorMedia }
  | null;

/**
 * What fills this canyon's route slot right now.
 *
 * @param routes every route the mirror holds (own + shared).
 * @param media canyon track attachments — one canyon's media or the whole
 *   account's; non-track rows and other canyons are filtered out here so no
 *   caller has to remember to.
 * @param ignoreRouteId the route being MOVED, when this is a re-link: it is
 *   its own incumbent otherwise, and would ask to displace itself.
 *
 * A drawn route wins a tie. Both occupants at once is a state neither the API
 * nor this app can produce deliberately, and the drawn route is the one the
 * canyon screen shows, so it is the one the user is being asked about.
 */
export function routeSlotOccupant(
  canyonId: string,
  routes: readonly { id: string; name: string; canyonId: string | null }[],
  media: readonly MirrorMedia[],
  ignoreRouteId?: string | null,
): RouteSlotOccupant {
  const route = routes.find(
    (candidate) => candidate.canyonId === canyonId && candidate.id !== ignoreRouteId,
  );
  if (route) return { kind: "route", id: route.id, name: route.name };
  const file = media.find(
    (item) =>
      item.linkedType === "canyon" &&
      item.linkedId === canyonId &&
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
  canyonName: string,
  occupant: RouteSlotOccupant,
): DeleteConfirmCopy | null {
  if (!occupant) return null;
  return {
    confirmTitle: `${canyonName} already has a route`,
    confirmBody:
      occupant.kind === "route"
        ? `“${occupant.name}” will be unlinked, but the route is kept.`
        : `The attached file “${occupant.media.filename ?? "route"}” will be deleted. That can't be undone.`,
  };
}

/**
 * Does the incumbent have to go BEFORE the new way is written?
 *
 * Normally no: the link is written first and the incumbent removed second, so
 * a failed removal leaves the canyon briefly showing both (visible, fixable)
 * where the other order can lose the file and not land the replacement.
 *
 * The ONE exception is file-over-file. `assertCanyonTrackSlotFree`
 * (api/src/routes/media.ts) answers a second track attachment on a canyon with
 * 409, so writing first doesn't leave two — it parks a dead upload in the
 * outbox and lands nothing at all.
 */
export function removeOccupantFirst(
  writes: "route" | "media",
  occupant: RouteSlotOccupant,
): boolean {
  return writes === "media" && occupant?.kind === "file";
}
