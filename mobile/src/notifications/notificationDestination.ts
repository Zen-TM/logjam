// "View in Saved" / "View in Friends" — where a notification's SUBJECT lives,
// as data.
//
// A notification is a report about something that now exists somewhere else in
// the app, and until now only one kind said where: a canyon share opened the
// canyon. Everything else — a finished topo, a GeoPDF, a file a friend sent and
// you kept, a waypoint someone shared — left the user to go and find the thing
// themselves, in a tab with seven filters.
//
// So each row's ⋯ sheet offers one more verb: go to the tab, on the right
// filter, with the row it is about pulsed so the eye lands on it. Which is a
// pure mapping, and it lives here rather than in the sheet for the same reason
// `notificationActions.ts` does — mobile's vitest cannot parse React Native's
// Flow sources, so anything imported by a screen is untestable.
//
// NOT EVERY NOTIFICATION HAS ONE. A failed job, a skipped export and a file
// send still waiting to be answered are about something that does not exist to
// be looked at; a canyon share already has "Open" in the same sheet, and two
// rows going to the same place is how one of them goes stale.
//
// PRIVACY: ids and a category, both already in the payload the row renders.
// Nothing new is read, resolved or logged.
import { isSharableEntityType } from "@logjam/shared";

import type { TNotification } from "../api/types";
import {
  SHARED_ENTITY_LOCATION,
  savedOverlayKey,
  type SavedCategory,
} from "../saved/savedKeys";

export type NotificationDestination =
  | {
      tab: "saved";
      label: string;
      filter: SavedCategory;
      /**
       * The Saved row to pulse on arrival, or null when the notification names
       * the thing but not the row — a file send says WHAT was accepted but the
       * import it became has an id of its own, minted on this device.
       */
      highlightKey: string | null;
    }
  | { tab: "friends"; label: string };

function str(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function saved(filter: SavedCategory, highlightKey: string | null): NotificationDestination {
  return { tab: "saved", label: "View in Saved", filter, highlightKey };
}

/**
 * Where this notification's subject can be looked at, or null when there is
 * nowhere to go.
 */
export function notificationDestination(
  n: TNotification,
): NotificationDestination | null {
  const payload = n.payload;
  const failed = payload.status === "failed";

  switch (n.type) {
    // Both sides of a friendship land on the same screen: the pending request
    // to see who is asking, the accepted one to see the friend you now have.
    case "friend_request":
    case "friend_request_accepted":
      return { tab: "friends", label: "View in Friends" };

    case "item_shared": {
      const entityType = str(payload, "entityType");
      const entityId = str(payload, "entityId");
      if (!entityId || !isSharableEntityType(entityType)) return null;
      const location = SHARED_ENTITY_LOCATION[entityType];
      return saved(location.category, location.key(entityId));
    }

    case "topo_complete": {
      const jobId = str(payload, "jobId");
      // The job may be on the device (the main list) or still only in the
      // account ("Available to download"); both rows answer to this key.
      return saved("overlay", jobId ? savedOverlayKey(jobId) : null);
    }

    case "geo_pdf_complete": {
      // A failed render produced no PDF — Saved has nothing to show.
      if (failed) return null;
      return saved("geoPdf", str(payload, "geoPdfJobId"));
    }

    // Only once it has been KEPT. A send still waiting to be answered is not in
    // Saved, and pointing at the tab would be pointing at nothing; the row's own
    // Save a copy is the way in.
    case "file_sent": {
      if (payload.fileSendStatus !== "accepted") return null;
      const filename = str(payload, "filename") ?? "";
      // The same fork `imports/acceptReceivedFile.ts` takes on the way in: a PDF
      // goes through the GeoPDF pipeline, everything else becomes a vector
      // import. The id it was given on this device is not in the payload, so the
      // filter is as far as this can point.
      return saved(filename.toLowerCase().endsWith(".pdf") ? "geoPdf" : "import", null);
    }

    // canyon_shared already has "Open" in the same sheet.
    // topo_failed / topo_export_* / a failed GeoPDF are about something that
    // does not exist to be looked at.
    default:
      return null;
  }
}
