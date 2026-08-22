// Writing a new way into a canyon's one route slot — the confirm and the swap,
// in one place, for all five sources.
//
// Split from `routeSlot.ts` (which is pure and tested) only because this half
// reaches the Alert, the mirror and the outbox. The DECISIONS still live there;
// nothing here re-derives an occupant or re-words a sentence.
import { Alert } from "react-native";

import {
  removeOccupantFirst,
  routeSlotDisplaceConfirm,
  waySourceWrites,
  type RouteSlotOccupant,
  type WaySource,
} from "./routeSlot";
import { deleteMediaLocal } from "../sync/mediaUpload";
import { updateRouteLocal } from "../sync/outbox";

/** The user's answer to "this canyon already has a route". */
function confirmDisplacement(
  canyonName: string,
  occupant: RouteSlotOccupant,
): Promise<boolean> {
  const confirm = routeSlotDisplaceConfirm(canyonName, occupant);
  if (!confirm) return Promise.resolve(true);
  return new Promise((resolve) => {
    Alert.alert(confirm.confirmTitle, confirm.confirmBody, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      {
        text: "Replace",
        // Only the file case destroys something; an unlinked route is still
        // there afterwards, and a red button would say otherwise.
        style: occupant?.kind === "file" ? "destructive" : "default",
        onPress: () => resolve(true),
      },
    ]);
  });
}

/**
 * Confirm the displacement, then write the new way and remove the incumbent in
 * the order `removeOccupantFirst` gives.
 *
 * Resolves TRUE when the slot was filled and FALSE when the user cancelled the
 * confirm — never swallows a failure, which is the caller's to report.
 *
 * `write` is whatever the source does: link a Route row, create one from a
 * recording, or upload a copy of a file as canyon media. It is called at most
 * once.
 */
export async function fillRouteSlot({
  canyonName,
  source,
  occupant,
  write,
}: {
  canyonName: string;
  source: WaySource;
  occupant: RouteSlotOccupant;
  write: () => Promise<unknown>;
}): Promise<boolean> {
  if (!(await confirmDisplacement(canyonName, occupant))) return false;

  const remove = occupant
    ? () =>
        occupant.kind === "route"
          ? // Written explicitly rather than left to the server's own
            // routeLink rule: the mirror is what this device renders from, and
            // until the next delta pull it would otherwise show two routes on
            // the one canyon — the state the confirm just said would not exist.
            updateRouteLocal(occupant.id, { canyonId: null })
          : deleteMediaLocal(occupant.media)
    : null;

  const writes = waySourceWrites(source);
  if (remove && removeOccupantFirst(writes, occupant)) await remove();
  await write();
  if (remove && !removeOccupantFirst(writes, occupant)) await remove();
  return true;
}
