// Pure label derivation for the notifications inbox — mirrors the JSX branches
// in web NotificationsPanel.tsx (frontend). Kept as data (text + optional
// warning subline) so it's vitest-testable and reusable by Stage 3 push
// handling. If web adds a notification type, add it here too; unknown types
// fall back to a generic label rather than rendering nothing.
import type { TNotification } from "../api/types";

export type NotificationLabel = {
  text: string;
  warning?: string;
};

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function notificationLabel(n: TNotification): NotificationLabel {
  const p = n.payload;
  switch (n.type) {
    case "friend_request":
      return { text: `${str(p.requesterUsername) ?? "Someone"} sent you a friend request` };
    case "friend_request_accepted":
      return { text: `${str(p.acceptedByUsername) ?? "Someone"} accepted your friend request` };
    case "canyon_shared":
      return {
        text: `${str(p.sharedByUsername) ?? "Someone"} shared ${str(p.canyonName) ?? "a canyon"} with you`,
      };
    case "topo_complete":
      return {
        text: str(p.jobName) ? `${str(p.jobName)} topo complete` : "LiDAR topo processing complete",
        ...(p.osmFailed === true && {
          warning: "OSM features unavailable — Overpass API failed. Retry to fetch them.",
        }),
      };
    case "topo_failed":
      return {
        text: str(p.jobName) ? `${str(p.jobName)} topo failed` : "LiDAR topo processing failed",
      };
    case "topo_export_complete": {
      const format = String(p.format ?? "Topo").toUpperCase();
      if (p.status === "failed") {
        return {
          text: `${format} export failed`,
          ...(str(p.errorMessage) && { warning: str(p.errorMessage)! }),
        };
      }
      return {
        text: `${format} export${str(p.jobName) ? ` for ${str(p.jobName)}` : ""} ready`,
      };
    }
    case "topo_export_skipped":
      return {
        text: "Auto-export didn't run",
        ...(str(p.reason) && { warning: str(p.reason)! }),
      };
    case "geo_pdf_complete":
      if (p.status === "failed") {
        return {
          text: "GeoPDF generation failed",
          ...(str(p.errorMessage) && { warning: str(p.errorMessage)! }),
        };
      }
      return { text: "GeoPDF ready" };
    default:
      return { text: "Notification" };
  }
}
