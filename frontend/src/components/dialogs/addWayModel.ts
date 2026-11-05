// What Logjam Web's "Add a way" dialog decides, away from the DOM: who is in a
// place's one route slot, which ways can fill it, and what order the swap is
// written in. Logjam GPS's `places/routeSlot.ts` is the same decision over its
// own mirror; the words are `ADD_WAY`'s.
import {
  ApiError,
  attachableRoutes,
  routeSlotDisplaceConfirm,
  type ConfirmCopy,
  mediaCategory,
  mediaDisplayName,
  placeRoute,
  type MediaItem,
  type RouteSlotIncumbent,
  type StandaloneFile,
  type WaySource,
  WayRemovalError,
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
 * safe. DELETING an uploaded file is destructive, and a failed write after it
 * leaves the place with no route and the upload gone: `preflight` runs before
 * anything is removed, and is where every check that can be made without
 * writing belongs (extension, size, reading the file). A rejection from the
 * write itself after that (network, the storage quota, which only the API
 * knows) is still unrecoverable; an API swap (a `replaces` id on the media
 * confirm) is the fix for that.
 */
export async function fillWaySlot({
  incumbent,
  source,
  write,
  preflight,
}: {
  incumbent: SlotIncumbent | null;
  source: WaySource;
  write: () => Promise<unknown>;
  preflight?: () => Promise<void>;
}): Promise<void> {
  await preflight?.();
  const remove = incumbent ? () => removeIncumbent(incumbent) : null;
  const fileOverFile =
    (source === "import" || source === "track" || source === "file") &&
    incumbent !== null &&
    incumbent.kind !== "route";
  if (remove && fileOverFile) await remove();
  await write();
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

/** The place a drawing fills the route slot of; an edit never links. */
export function drawTarget(
  editingRouteId: string | null,
  drawPlaceId: string | null,
): string | null {
  return editingRouteId ? null : drawPlaceId;
}

/** Where leaving the Route tool goes: back to the place it was armed from,
 *  to the way being edited, or to the list a new route came from. */
export function drawExitPanel({
  drawPlaceId,
  editingRouteId,
  selectedWayId,
}: {
  drawPlaceId: string | null;
  editingRouteId: string | null;
  selectedWayId: string | null;
}): "place-detail" | "way-detail" | "ways" {
  if (drawPlaceId) return "place-detail";
  return editingRouteId && selectedWayId === editingRouteId
    ? "way-detail"
    : "ways";
}

/** A place that was deleted, or unshared from the user, while the pen was out. */
export function placeIsGone(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 404 || err.status === 403);
}

export type DrawnSave =
  | { kind: "standalone" }
  | {
      kind: "place";
      incumbent: SlotIncumbent | null;
      /** Null when the slot is free. */
      confirm: ConfirmCopy | null;
    };

/**
 * What saving a drawing armed for `placeId` should do, read at the moment of
 * the save: the slot may have filled since the pen was armed, or the place may
 * be gone, in which case the drawing is kept as a route of its own rather than
 * lost. Any other failure is the caller's to show.
 */
export async function planDrawnSave(
  placeId: string,
  routes: readonly TRoute[],
  getDetail: (id: string) => Promise<{ name: string; media: MediaItem[] }>,
): Promise<DrawnSave> {
  try {
    const detail = await getDetail(placeId);
    const incumbent = slotIncumbent(placeId, routes, detail.media);
    return {
      kind: "place",
      incumbent,
      confirm: routeSlotDisplaceConfirm("web", detail.name, incumbent),
    };
  } catch (err) {
    if (placeIsGone(err)) return { kind: "standalone" };
    throw err;
  }
}
