import { useState } from "react";
import classes from "./NotificationsPanel.module.css";
import { useToast } from "../../feedback/ToastProvider";
import { messageFromError } from "../../../errors/messageFromError";
import type { TNotification } from "../../../canyonUtils";
import type { PanelId } from "../panels";
import type { GeoJsonPolygonal } from "../../dialogs/TopoDialog";
import {
  markNotificationRead,
  markAllNotificationsRead,
  clearReadNotifications,
  deleteNotification,
  acceptFriendRequest,
  declineFriendRequest,
  getTopoExport,
  getGeoPdfJob,
} from "../../../canyonUtils";

function NotificationsPanel({
  notifications,
  onRefetchNotifications,
  onRefetchFriends,
  setSelectedCanyonID,
  setActivePanel,
  onTopoFlyTarget,
}: {
  notifications: TNotification[];
  onRefetchNotifications: () => void;
  onRefetchFriends: () => void;
  setSelectedCanyonID: (id: string | null) => void;
  setActivePanel: (panel: PanelId | null) => void;
  onTopoFlyTarget: (footprint: GeoJsonPolygonal) => void;
}) {
  const [actionedIds, setActionedIds] = useState<Set<string>>(new Set());
  const toast = useToast();

  async function handleAccept(notificationId: string, friendshipId: string) {
    setActionedIds((prev) => new Set([...prev, notificationId]));
    try {
      await acceptFriendRequest(friendshipId);
      // Best-effort: the friend request itself succeeded; failing to mark/clear
      // this notification just leaves it visible until the next refetch.
      markNotificationRead(notificationId).catch((err) => { console.error(err); });
      deleteNotification(notificationId).catch((err) => { console.error(err); });
      onRefetchFriends();
      onRefetchNotifications();
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, "Couldn't accept friend request."));
      setActionedIds((prev) => {
        const next = new Set(prev);
        next.delete(notificationId);
        return next;
      });
    }
  }

  async function handleDecline(notificationId: string, friendshipId: string) {
    setActionedIds((prev) => new Set([...prev, notificationId]));
    try {
      await declineFriendRequest(friendshipId);
      // Best-effort: the decline itself succeeded; failing to mark/clear this
      // notification just leaves it visible until the next refetch.
      markNotificationRead(notificationId).catch((err) => { console.error(err); });
      deleteNotification(notificationId).catch((err) => { console.error(err); });
      onRefetchNotifications();
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, "Couldn't decline friend request."));
      setActionedIds((prev) => {
        const next = new Set(prev);
        next.delete(notificationId);
        return next;
      });
    }
  }

  async function handleDownloadExport(n: TNotification) {
    try {
      const view = await getTopoExport(n.payload.exportJobId as string);
      if (!view.downloadUrl) throw new Error("Export has no download URL");
      const a = document.createElement("a");
      a.href = view.downloadUrl;
      a.download = "";
      document.body.appendChild(a);
      a.click();
      a.remove();
      if (!n.read) {
        // Best-effort: the download already started; failing to mark this
        // notification read just leaves it unread until the next refetch.
        markNotificationRead(n.id).catch((err) => { console.error(err); });
        onRefetchNotifications();
      }
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, "Couldn't download the export."));
    }
  }

  async function handleDownloadGeoPdf(n: TNotification) {
    try {
      const job = await getGeoPdfJob(n.payload.geoPdfJobId as string);
      if (!job.downloadUrl) throw new Error("GeoPDF has no download URL");
      const a = document.createElement("a");
      a.href = job.downloadUrl;
      a.download = "";
      document.body.appendChild(a);
      a.click();
      a.remove();
      if (!n.read) {
        markNotificationRead(n.id).catch((err) => { console.error(err); });
        onRefetchNotifications();
      }
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, "Couldn't download the GeoPDF."));
    }
  }

  async function handleNotificationActivate(n: TNotification) {
    if (!n.read) {
      await markNotificationRead(n.id);
      onRefetchNotifications();
    }
    if (n.type === "canyon_shared" && n.payload.canyonId) {
      setSelectedCanyonID(n.payload.canyonId as string);
      setActivePanel("canyon-detail");
    }
  }

  const visibleNotifications = notifications.filter(
    (n) => !actionedIds.has(n.id),
  );

  return (
    <div className={classes.root}>
      <div className={classes.notificationList}>
        {visibleNotifications.length === 0 ? (
          <span className={classes.emptyText}>No notifications.</span>
        ) : (
          visibleNotifications.map((n) => (
            <div
              key={n.id}
              className={`${classes.notificationItem} ${!n.read ? classes.notificationUnread : ""}`}
              role="button"
              tabIndex={0}
              onClick={() => handleNotificationActivate(n)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleNotificationActivate(n);
                }
              }}
            >
              <div className={classes.notificationText}>
                {n.type === "friend_request" &&
                  `${n.payload.requesterUsername} sent you a friend request`}
                {n.type === "friend_request_accepted" &&
                  `${n.payload.acceptedByUsername} accepted your friend request`}
                {n.type === "canyon_shared" &&
                  `${n.payload.sharedByUsername} shared ${n.payload.canyonName} with you`}
                {n.type === "topo_complete" && (
                  <>
                    {n.payload.jobName
                      ? `${n.payload.jobName} topo complete`
                      : "LiDAR topo processing complete"}
                    {n.payload.osmFailed === true && (
                      <div className={classes.notificationWarning}>
                        OSM features unavailable — Overpass API failed. Retry to fetch them.
                      </div>
                    )}
                  </>
                )}
                {n.type === "topo_failed" &&
                  (n.payload.jobName
                    ? `${n.payload.jobName} topo failed`
                    : "LiDAR topo processing failed")}
                {n.type === "topo_export_complete" && (
                  n.payload.status === "failed" ? (
                    <>
                      {`${String(n.payload.format ?? "Topo").toUpperCase()} export failed`}
                      {typeof n.payload.errorMessage === "string" && (
                        <div className={classes.notificationWarning}>
                          {n.payload.errorMessage}
                        </div>
                      )}
                    </>
                  ) : (
                    `${String(n.payload.format ?? "Topo").toUpperCase()} export${
                      n.payload.jobName ? ` for ${n.payload.jobName}` : ""
                    } ready — view exports in the LiDAR panel`
                  )
                )}
                {n.type === "topo_export_skipped" && (
                  <>
                    Auto-export didn&apos;t run
                    {typeof n.payload.reason === "string" && (
                      <div className={classes.notificationWarning}>
                        {n.payload.reason}
                      </div>
                    )}
                  </>
                )}
                {n.type === "geo_pdf_complete" && (
                  n.payload.status === "failed" ? (
                    <>
                      GeoPDF generation failed
                      {typeof n.payload.errorMessage === "string" && (
                        <div className={classes.notificationWarning}>
                          {n.payload.errorMessage}
                        </div>
                      )}
                    </>
                  ) : (
                    "GeoPDF ready — view in the GeoPDF panel"
                  )
                )}
              </div>
              <div className={classes.notificationTime}>
                {new Date(n.createdAt).toLocaleDateString()}
              </div>
              {n.type === "friend_request" && (
                <div className={classes.notificationActions}>
                  <button
                    className={classes.acceptButton}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleAccept(n.id, n.payload.friendshipId as string);
                    }}
                  >
                    Accept
                  </button>
                  <button
                    className={classes.declineButton}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDecline(n.id, n.payload.friendshipId as string);
                    }}
                  >
                    Decline
                  </button>
                </div>
              )}
              {n.type === "topo_complete" && !!n.payload.footprint && (
                <div className={classes.notificationActions}>
                  <button
                    className={classes.acceptButton}
                    onClick={async (e) => {
                      e.stopPropagation();
                      onTopoFlyTarget(n.payload.footprint as GeoJsonPolygonal);
                      if (!n.read) {
                        await markNotificationRead(n.id);
                        onRefetchNotifications();
                      }
                    }}
                  >
                    Zoom to map
                  </button>
                </div>
              )}
              {n.type === "topo_export_complete" && n.payload.status === "completed" && (
                <div className={classes.notificationActions}>
                  <button
                    className={classes.acceptButton}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDownloadExport(n);
                    }}
                  >
                    Download
                  </button>
                </div>
              )}
              {n.type === "geo_pdf_complete" && n.payload.status === "completed" && (
                <div className={classes.notificationActions}>
                  <button
                    className={classes.acceptButton}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDownloadGeoPdf(n);
                    }}
                  >
                    Download
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Low-frequency actions */}
      <div className={classes.footerActions}>
        <div className={classes.divider} />
        <button
          className={classes.markAllReadButton}
          onClick={async () => {
            await markAllNotificationsRead();
            onRefetchNotifications();
          }}
        >
          Mark all read
        </button>
        {visibleNotifications.some((n) => n.read) && (
          <button
            className={classes.clearAllButton}
            onClick={async () => {
              await clearReadNotifications();
              onRefetchNotifications();
            }}
          >
            Clear read notifications
          </button>
        )}
      </div>
    </div>
  );
}

export default NotificationsPanel;
