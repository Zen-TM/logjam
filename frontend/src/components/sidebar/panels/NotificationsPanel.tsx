import { useState } from "react";
import classes from "./NotificationsPanel.module.css";
import { useToast } from "../../feedback/ToastProvider";
import { messageFromError } from "../../../errors/messageFromError";
import type { TNotification } from "../../../canyonUtils";
import type { PanelId } from "../panels";
import type { GeoJsonPolygon } from "../../dialogs/TopoDialog";
import {
  markNotificationRead,
  markAllNotificationsRead,
  clearReadNotifications,
  deleteNotification,
  acceptFriendRequest,
  declineFriendRequest,
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
  onTopoFlyTarget: (footprint: GeoJsonPolygon) => void;
}) {
  const [actionedIds, setActionedIds] = useState<Set<string>>(new Set());
  const toast = useToast();

  async function handleAccept(notificationId: string, friendshipId: string) {
    setActionedIds((prev) => new Set([...prev, notificationId]));
    try {
      await acceptFriendRequest(friendshipId);
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

  const visibleNotifications = notifications.filter(
    (n) => !actionedIds.has(n.id),
  );

  return (
    <>
      <div className={classes.header}>
        <button
          className={classes.markAllReadButton}
          onClick={async () => {
            await markAllNotificationsRead();
            onRefetchNotifications();
          }}
        >
          Mark all read
        </button>
      </div>

      <div className={classes.notificationList}>
        {visibleNotifications.length === 0 ? (
          <span className={classes.emptyText}>No notifications.</span>
        ) : (
          visibleNotifications.map((n) => (
            <div
              key={n.id}
              className={`${classes.notificationItem} ${!n.read ? classes.notificationUnread : ""}`}
              onClick={async () => {
                if (!n.read) {
                  await markNotificationRead(n.id);
                  onRefetchNotifications();
                }
                if (n.type === "canyon_shared" && n.payload.canyonId) {
                  setSelectedCanyonID(n.payload.canyonId as string);
                  setActivePanel("canyon-detail");
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
                    onClick={(e) => {
                      e.stopPropagation();
                      onTopoFlyTarget(n.payload.footprint as GeoJsonPolygon);
                      if (!n.read) {
                        markNotificationRead(n.id).catch((err) => { console.error(err); });
                        onRefetchNotifications();
                      }
                    }}
                  >
                    Zoom to map
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>

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
    </>
  );
}

export default NotificationsPanel;
