import {
  notificationPlaceId,
  notificationPlanTarget,
  notificationVerb,
  type NotificationPlanTarget,
  type TNotification,
} from "@logjam/shared";
import type { PanelId } from "../panels";

/**
 * Where a notification's SUBJECT lives on Logjam Web, for its ⋯ menu: the web
 * counterpart of Logjam GPS's `notificationDestination` ("View in Saved").
 * A notification reports something that exists elsewhere in Logjam Web.
 *
 * Null when there is nowhere to go: a failed job produced nothing to look at,
 * a file send is answered in the row itself, and a kind this build has never
 * heard of stays where it is.
 */
export type InboxDestination =
  | { kind: "place"; label: string; placeId: string }
  | { kind: "plan"; label: string; target: NotificationPlanTarget }
  | { kind: "page"; label: string; panel: PanelId }
  /** Layers → Terrain → Sharpened areas, over the map. */
  | { kind: "sharpened"; label: string };

const SHARPENED: InboxDestination = { kind: "sharpened", label: "Show" };

export function inboxDestination(n: TNotification): InboxDestination | null {
  const placeId = notificationPlaceId(n);
  if (placeId)
    return { kind: "place", label: notificationVerb("open").label, placeId };
  const plan = notificationPlanTarget(n);
  if (plan)
    return {
      kind: "plan",
      label: notificationVerb("openPlan").label,
      target: plan,
    };
  const failed = n.payload.status === "failed";
  switch (n.type) {
    case "friend_request":
    case "friend_request_accepted":
      return { kind: "page", label: "View in Friends", panel: "friends" };
    case "topo_complete":
      return failed ? null : SHARPENED;
    case "topo_export_complete":
      // A file, not a place in Logjam Web: the row's Download is the answer.
      return null;
    case "item_shared":
      switch (n.payload.entityType) {
        case "route":
          return { kind: "page", label: "View in Ways", panel: "ways" };
        case "topoJob":
          return SHARPENED;
        default:
          return null;
      }
    default:
      return null;
  }
}
