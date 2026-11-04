// What Logjam Web's "Add a way" dialog decides, away from the DOM: who is in a
// place's one route slot, which ways can fill it, and what order the swap is
// written in. Logjam GPS's `places/routeSlot.ts` is the same decision over its
// own mirror; the words are `ADD_WAY`'s.
import {
  attachableRoutes,
  mediaCategory,
  mediaDisplayName,
  placeRoute,
  type MediaItem,
  type RouteSlotIncumbent,
  type StandaloneFile,
  type WaySource,
  WayRemovalError,
  replacedUploadId,
} from "@logjam/shared";
import {
  deleteMedia,
  linkMediaToPlace,
  updateRoute,
  type TRoute,
} from "../../placeUtils";

export type SlotIncumbent = RouteSlotIncumbent & { id: string };

/**
 * Who is in the slot now. A drawn route wins a tie, as `placeRoute` says on
 * both clients. A file with an `origin` is an import or a recording the user
 * keeps elsewhere, so it is unlinked; one without was uploaded onto the place
 * and goes with it.
 */
export function slotIncumbent(
  placeId: string,
  routes: readonly TRoute[],
  media: readonly MediaItem[],
): SlotIncumbent | null {
  const held = placeRoute(placeId, routes, media);
  if (!held) return null;
  if (held.kind === "drawn") {
    return { kind: "route", id: held.route.id, name: held.route.name };
  }
  return {
    kind: held.file.origin === null ? "upload" : "file",
    id: held.file.id,
    name: mediaDisplayName(held.file),
  };
}

/** The user's own routes the panel offers (`attachableRoutes` decides which). */
export function ownAttachableRoutes(
  routes: readonly TRoute[],
  currentUserId: string | null,
  placeId: string,
  query: string,
): TRoute[] {
  return attachableRoutes(
    routes.filter((route) => route.ownerId === currentUserId),
    placeId,
    query,
  );
}

/**
 * The imports or recordings that can take this place: any not yet on a place,
 * and this one's own (shown as done). Moving a file off another place would
 * quietly change what that place's sharees see, so those are left out.
 */
export function attachableFiles(
  files: readonly StandaloneFile[],
  origin: StandaloneFile["origin"],
  placeId: string,
): StandaloneFile[] {
  return files.filter(
    (file) =>
      file.origin === origin &&
      mediaCategory(file.mediaType) === "track" &&
      (file.linkedPlaceId === null || file.linkedPlaceId === placeId),
  );
}

/**
 * Write a way into the slot and take the incumbent out, in the safe order.
 *
 * Normally the new way goes in first, so a failed removal leaves the place
 * showing both rather than neither; that failure is a `WayRemovalError`, since
 * the new way did land. A file over a file is the exception: the API refuses a
 * second track on a place (409), so the first has to go before the second is
 * written. Unlinking an import or recording destroys nothing, so going first is
 * safe.
 *
 * An UPLOADED file in the slot is never removed here: its id goes to `write`
 * as `replaces`, and the API deletes it in the same step that lands the new
 * file, so a write that fails (network, quota, validation) leaves it where it
 * was. `preflight` still runs first for the checks that cost nothing.
 */
export async function fillWaySlot({
  incumbent,
  source,
  write,
  preflight,
}: {
  incumbent: SlotIncumbent | null;
  source: WaySource;
  write: (replaces?: string) => Promise<unknown>;
  preflight?: () => Promise<void>;
}): Promise<void> {
  await preflight?.();
  const fileWay =
    source === "import" || source === "track" || source === "file";
  const replaces = replacedUploadId(fileWay ? "media" : "route", incumbent);
  const remove =
    incumbent && !replaces ? () => removeIncumbent(incumbent) : null;
  const fileOverFile =
    fileWay && incumbent !== null && incumbent.kind !== "route";
  if (remove && fileOverFile) await remove();
  await write(replaces);
  if (remove && !fileOverFile) {
    await remove().catch((err: unknown) => {
      throw new WayRemovalError(err);
    });
  }
}

function removeIncumbent(incumbent: SlotIncumbent): Promise<unknown> {
  switch (incumbent.kind) {
    case "route":
      return updateRoute(incumbent.id, { placeId: null });
    case "file":
      return linkMediaToPlace(incumbent.id, null);
    case "upload":
      return deleteMedia(incumbent.id);
  }
}
