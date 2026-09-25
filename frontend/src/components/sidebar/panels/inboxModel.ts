import { notificationPlaceId, type TNotification } from "@logjam/shared";
import type { MapsView, PanelId } from "../panels";

/**
 * Where a notification's SUBJECT lives on Logjam Web, for its ⋯ menu: the web
 * counterpart of Logjam GPS's `notificationDestination` ("View in Saved").
 * A notification is a report about something that now exists somewhere else,
 * and only a place share used to say where.
 *
 * Null when there is nowhere to go: a failed job produced nothing to look at,
 * a file send is answered in the row itself, and a kind this build has never
 * heard of stays where it is.
 */
export type InboxDestination =
  | { kind: "place"; label: string; placeId: string }
  | { kind: "page"; label: string; panel: PanelId; mapsView?: MapsView };

const LIDAR: InboxDestination = { kind: "page", label: "View in Maps", panel: "maps", mapsView: "lidar" };
const GEOPDFS: InboxDestination = { kind: "page", label: "View in Maps", panel: "maps", mapsView: "geopdfs" };

export function inboxDestination(n: TNotification): InboxDestination | null {
  const placeId = notificationPlaceId(n);
  if (placeId) return { kind: "place", label: "Open place", placeId };
  const failed = n.payload.status === "failed";
  switch (n.type) {
    case "friend_request":
    case "friend_request_accepted":
      return { kind: "page", label: "View in Friends", panel: "friends" };
    case "topo_complete":
    case "topo_export_complete":
      return failed ? null : LIDAR;
    case "geo_pdf_complete":
      return failed ? null : GEOPDFS;
    case "item_shared":
      switch (n.payload.entityType) {
        case "route":
          return { kind: "page", label: "View in Ways", panel: "ways" };
        case "topoJob":
          return LIDAR;
        case "geoPdfJob":
          return GEOPDFS;
        default:
          return null;
      }
    default:
      return null;
  }
}
