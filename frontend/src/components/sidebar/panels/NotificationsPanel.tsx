import { Typography } from "@mui/material";
import classes from "../Sidebar.module.css";
import type { TNotification } from "../../../canyonUtils";
import type { PanelId } from "../panels";
import {
  markNotificationRead,
  markAllNotificationsRead,
  clearReadNotifications,
  acceptFriendRequest,
  declineFriendRequest,
} from "../../../canyonUtils";

function NotificationsPanel({
  notifications,
  onRefetchNotifications,
  onRefetchFriends,
  setSelectedCanyonID,
  setActivePanel,
}: {
  notifications: TNotification[];
  onRefetchNotifications: () => void;
  onRefetchFriends: () => void;
  setSelectedCanyonID: (id: string | null) => void;
  setActivePanel: (panel: PanelId | null) => void;
}) {
  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "0.5em" }}>
        <button
          className={classes.addFriendButton}
          onClick={async () => {
            await markAllNotificationsRead();
            onRefetchNotifications();
          }}
        >
          Mark all read
        </button>
      </div>

      <div className={classes.notificationList} style={{ padding: 0 }}>
        {notifications.length === 0 ? (
          <Typography
            variant="caption"
            sx={{ opacity: 0.6, padding: "0.5em 0" }}
          >
            No notifications.
          </Typography>
        ) : (
          notifications.map((n) => (
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
              </div>
              <div className={classes.notificationTime}>
                {new Date(n.createdAt).toLocaleDateString()}
              </div>
              {n.type === "friend_request" && (
                <div className={classes.notificationActions}>
                  <button
                    className={classes.acceptButton}
                    onClick={async (e) => {
                      e.stopPropagation();
                      await acceptFriendRequest(
                        n.payload.friendshipId as string,
                      );
                      onRefetchFriends();
                      onRefetchNotifications();
                    }}
                  >
                    Accept
                  </button>
                  <button
                    className={classes.declineButton}
                    onClick={async (e) => {
                      e.stopPropagation();
                      await declineFriendRequest(
                        n.payload.friendshipId as string,
                      );
                      onRefetchFriends();
                      onRefetchNotifications();
                    }}
                  >
                    Decline
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {notifications.some((n) => n.read) && (
        <button
          className={classes.clearAllButton}
          style={{ margin: "0.5em 0", width: "100%" }}
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
