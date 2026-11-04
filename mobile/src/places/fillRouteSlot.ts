// Writing a new way into a place's one route slot — the confirm and the swap,
// in one place, for all five sources.
//
// Split from `routeSlot.ts` (which is pure and tested) only because this half
// reaches the confirm, the mirror and the outbox. The DECISIONS still live there;
// nothing here re-derives an occupant or re-words a sentence.
import { WayRemovalError } from "@logjam/shared";
import { confirm } from "../ui";

import {
  occupantKind,
  removeOccupantFirst,
  routeSlotDisplaceConfirm,
  waySourceWrites,
  type RouteSlotOccupant,
  type WaySource,
} from "./routeSlot";
import {
  deleteMediaLocal,
  linkStandaloneMediaLocal,
} from "../sync/mediaUpload";
import { updateRouteLocal } from "../sync/outbox";

/**
 * Confirm the displacement, then write the new way and remove the incumbent in
 * the order `removeOccupantFirst` gives.
 *
 * Resolves TRUE when the slot was filled and FALSE when the user cancelled the
 * confirm — never swallows a failure, which is the caller's to report.
 *
 * `write` is whatever the source does: link a Route row, create one from a
 * recording, or upload a copy of a file as place media. It is called at most
 * once.
 */
export async function fillRouteSlot({
  placeName,
  source,
  occupant,
  write,
}: {
  placeName: string;
  source: WaySource;
  occupant: RouteSlotOccupant;
  write: () => Promise<unknown>;
}): Promise<boolean> {
  const displace = routeSlotDisplaceConfirm(placeName, occupant);
  if (displace && !(await confirm(displace))) return false;

  const remove = occupant
    ? () =>
        occupant.kind === "route"
          ? // Written explicitly rather than left to the server's own
            // routeLink rule: the mirror is what this device renders from, and
            // until the next delta pull it would otherwise show two routes on
            // the one place — the state the confirm just said would not exist.
            updateRouteLocal(occupant.id, { placeId: null })
          : occupantKind(occupant) === "upload"
            ? // Uploaded onto the place (no origin): there is nothing to unlink
              // to, and the confirm said it would be deleted.
              deleteMediaLocal(occupant.media)
            : // UNLINK, never delete: an import or recording lives on in Saved.
              linkStandaloneMediaLocal(occupant.media.id, null)
    : null;

  const writes = waySourceWrites(source);
  if (remove && removeOccupantFirst(writes, occupant)) await remove();
  await write();
  if (remove && !removeOccupantFirst(writes, occupant)) {
    // The new way is in: say that, not that nothing happened.
    await remove().catch((err: unknown) => {
      throw new WayRemovalError(err);
    });
  }
  return true;
}
