import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Bell,
  CheckCheck,
  Circle,
  CircleCheck,
  Download,
  EllipsisVertical,
  Eye,
  EyeOff,
  FilePlus,
  FileText,
  Layers,
  MapPin,
  Search,
  Share2,
  Trash2,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import classes from "./NotificationsPanel.module.css";
import { useToast } from "../../feedback/ToastProvider";
import { messageFromError } from "../../../errors/messageFromError";
import ConfirmDialog from "../../dialogs/ConfirmDialog";
import {
  Button,
  ChipRail,
  EmptyState,
  Hero,
  IconButton,
  IconTile,
  Menu,
  Row,
  SearchField,
  SelectionBar,
  StatusPill,
} from "../../../ui";
import {
  bulkReadAction,
  idRange,
  isResolvedElsewhereError,
  notificationHaystack,
  notificationKind,
  notificationLabel,
  notificationPlaceId,
  selectionCountLabel,
  type NotificationKind,
} from "@logjam/shared";
import type { TNotification } from "../../../placeUtils";
import type { PanelId } from "../panels";
import type { GeoJsonPolygonal } from "../../dialogs/TopoDialog";
import {
  acceptFriendRequest,
  clearReadNotifications,
  declineFriendRequest,
  deleteNotification,
  getGeoPdfJob,
  getTopoExport,
  markAllNotificationsRead,
  markNotificationRead,
} from "../../../placeUtils";

const plural = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

const KIND_CONFIG: Record<NotificationKind, { icon: LucideIcon; hue: string }> = {
  share: { icon: Share2, hue: "var(--hue-shared)" },
  file: { icon: FilePlus, hue: "var(--hue-import)" },
  people: { icon: Users, hue: "var(--theme-accent)" },
  topo: { icon: Layers, hue: "var(--hue-overlay)" },
  export: { icon: Download, hue: "var(--hue-import)" },
  geoPdf: { icon: FileText, hue: "var(--hue-geoPdf)" },
  problem: { icon: AlertTriangle, hue: "var(--theme-warning)" },
};

function triggerDownload(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const isToday =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();

  const timeStr = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (isToday) {
    return `Today, ${timeStr}`;
  }
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday =
    d.getDate() === yesterday.getDate() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getFullYear() === yesterday.getFullYear();
  if (isYesterday) {
    return `Yesterday, ${timeStr}`;
  }
  return `${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })}, ${timeStr}`;
}

type FilterValue = "all" | "unread" | "read";

function NotificationsPanel({
  notifications,
  notificationsTotal,
  onRefetchNotifications,
  onRefetchFriends,
  setSelectedPlaceID,
  setActivePanel,
  onTopoFlyTarget,
}: {
  notifications: TNotification[];
  notificationsTotal: number | null;
  onRefetchNotifications: () => void;
  onRefetchFriends: () => void;
  setSelectedPlaceID: (id: string | null) => void;
  setActivePanel: (panel: PanelId | null) => void;
  onTopoFlyTarget: (footprint: GeoJsonPolygonal) => void;
}) {
  const toast = useToast();

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterValue>("all");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectionAnchor = useRef<string | null>(null);

  // Optimistic hiding for actioned notifications
  const [actionedIds, setActionedIds] = useState<Set<string>>(new Set());

  // Confirm dialogs
  const [confirmDecline, setConfirmDecline] = useState<{
    notificationId: string;
    friendshipId: string;
    name: string;
  } | null>(null);
  const [confirmSingleDelete, setConfirmSingleDelete] = useState<{ id: string } | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [confirmClearRead, setConfirmClearRead] = useState(false);
  const [dialogBusy, setDialogBusy] = useState(false);

  // Initial refetch on mount
  useEffect(() => {
    onRefetchNotifications();
  }, [onRefetchNotifications]);

  // Global escape and select-all handling
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (selectedIds.length > 0) {
          event.preventDefault();
          setSelectedIds([]);
          selectionAnchor.current = null;
        } else if (searchOpen) {
          event.preventDefault();
          setSearchOpen(false);
          setQuery("");
        }
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
        // If an input is focused, let default select-all work
        if (
          document.activeElement instanceof HTMLInputElement ||
          document.activeElement instanceof HTMLTextAreaElement
        ) {
          return;
        }
        event.preventDefault();
        setSelectedIds(visibleRows.map((n) => n.id));
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  const liveNotifications = useMemo(
    () => notifications.filter((n) => !actionedIds.has(n.id)),
    [notifications, actionedIds],
  );

  const totalCount = liveNotifications.length;
  const unreadCount = useMemo(
    () => liveNotifications.filter((n) => !n.read).length,
    [liveNotifications],
  );
  const readCount = totalCount - unreadCount;

  // Filter by search query
  const queryFiltered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return liveNotifications;
    return liveNotifications.filter((n) => notificationHaystack(n).includes(q));
  }, [liveNotifications, query]);

  // Filter by chip rail
  const visibleRows = useMemo(() => {
    if (filter === "unread") return queryFiltered.filter((n) => !n.read);
    if (filter === "read") return queryFiltered.filter((n) => n.read);
    return queryFiltered;
  }, [queryFiltered, filter]);

  const selectableIds = useMemo(() => visibleRows.map((n) => n.id), [visibleRows]);
  const selected = useMemo(
    () => visibleRows.filter((n) => selectedIds.includes(n.id)),
    [visibleRows, selectedIds],
  );
  const selecting = selected.length > 0;
  const bulkAction = useMemo(() => bulkReadAction(selected), [selected]);

  const toggleSelected = useCallback(
    (id: string, shift: boolean) => {
      setSelectedIds((current) => {
        const has = current.includes(id);
        if (shift && selectionAnchor.current && selectionAnchor.current !== id) {
          const range = idRange(selectableIds, selectionAnchor.current, id);
          return has
            ? current.filter((x) => !range.includes(x))
            : [...new Set([...current, ...range])];
        }
        selectionAnchor.current = id;
        return has ? current.filter((x) => x !== id) : [...current, id];
      });
    },
    [selectableIds],
  );

  const clearSelection = useCallback(() => {
    setSelectedIds([]);
    selectionAnchor.current = null;
  }, []);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setQuery("");
  }, []);

  // ── Action Handlers ────────────────────────────────────────────────────────

  const handleNotificationActivate = useCallback(
    async (n: TNotification) => {
      if (!n.read) {
        try {
          await markNotificationRead(n.id, true);
          onRefetchNotifications();
        } catch (err) {
          console.error(err);
        }
      }
      const placeId = notificationPlaceId(n);
      if (n.type === "place_shared" && placeId) {
        setSelectedPlaceID(placeId);
        setActivePanel("place-detail");
      }
    },
    [onRefetchNotifications, setSelectedPlaceID, setActivePanel],
  );

  const handleAccept = useCallback(
    async (notificationId: string, friendshipId: string) => {
      setActionedIds((prev) => new Set([...prev, notificationId]));
      try {
        await acceptFriendRequest(friendshipId);
        onRefetchFriends();
        onRefetchNotifications();
      } catch (err) {
        console.error(err);
        toast.error(messageFromError(err, "Couldn't accept friend request."));
        if (isResolvedElsewhereError(err)) {
          markNotificationRead(notificationId, true).catch(console.error);
          deleteNotification(notificationId).catch(console.error);
          onRefetchFriends();
          onRefetchNotifications();
          return;
        }
        setActionedIds((prev) => {
          const next = new Set(prev);
          next.delete(notificationId);
          return next;
        });
      }
    },
    [onRefetchFriends, onRefetchNotifications, toast],
  );

  const handleDecline = useCallback(
    async (notificationId: string, friendshipId: string) => {
      setDialogBusy(true);
      setActionedIds((prev) => new Set([...prev, notificationId]));
      try {
        await declineFriendRequest(friendshipId);
        setConfirmDecline(null);
        onRefetchNotifications();
      } catch (err) {
        console.error(err);
        toast.error(messageFromError(err, "Couldn't decline friend request."));
        if (isResolvedElsewhereError(err)) {
          markNotificationRead(notificationId, true).catch(console.error);
          deleteNotification(notificationId).catch(console.error);
          onRefetchNotifications();
          setConfirmDecline(null);
          return;
        }
        setActionedIds((prev) => {
          const next = new Set(prev);
          next.delete(notificationId);
          return next;
        });
      } finally {
        setDialogBusy(false);
      }
    },
    [onRefetchNotifications, toast],
  );

  const handleDownloadExport = useCallback(
    async (n: TNotification) => {
      try {
        const view = await getTopoExport(n.payload.exportJobId as string);
        if (view.downloadUrl) {
          triggerDownload(view.downloadUrl);
        } else {
          toast.error("Export download expired.");
        }
        if (!n.read) {
          await markNotificationRead(n.id, true);
          onRefetchNotifications();
        }
      } catch (err) {
        console.error(err);
        toast.error(messageFromError(err, "Couldn't download export."));
      }
    },
    [onRefetchNotifications, toast],
  );

  const handleDownloadGeoPdf = useCallback(
    async (n: TNotification) => {
      try {
        const job = await getGeoPdfJob(n.payload.geoPdfJobId as string);
        if (job.downloadUrl) {
          triggerDownload(job.downloadUrl);
        } else {
          toast.error("GeoPDF download expired.");
        }
        if (!n.read) {
          await markNotificationRead(n.id, true);
          onRefetchNotifications();
        }
      } catch (err) {
        console.error(err);
        toast.error(messageFromError(err, "Couldn't download GeoPDF."));
      }
    },
    [onRefetchNotifications, toast],
  );

  const handleZoomToMap = useCallback(
    async (n: TNotification) => {
      if (n.payload.footprint) {
        onTopoFlyTarget(n.payload.footprint as GeoJsonPolygonal);
      }
      if (!n.read) {
        try {
          await markNotificationRead(n.id, true);
          onRefetchNotifications();
        } catch (err) {
          console.error(err);
          toast.error(messageFromError(err, "Couldn't mark notification read."));
        }
      }
    },
    [onTopoFlyTarget, onRefetchNotifications, toast],
  );

  const handleToggleSingleRead = useCallback(
    async (id: string, read: boolean) => {
      try {
        await markNotificationRead(id, read);
        onRefetchNotifications();
      } catch (err) {
        console.error(err);
        toast.error(messageFromError(err, "Couldn't update alert."));
      }
    },
    [onRefetchNotifications, toast],
  );

  const handleBulkRead = useCallback(async () => {
    if (!bulkAction) return;
    try {
      await Promise.all(bulkAction.ids.map((id) => markNotificationRead(id, bulkAction.read)));
      toast.success(bulkAction.success);
      onRefetchNotifications();
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, "Couldn't update alerts."));
    }
  }, [bulkAction, onRefetchNotifications, toast]);

  const handleSingleDelete = useCallback(
    async (id: string) => {
      setDialogBusy(true);
      try {
        await deleteNotification(id);
        setSelectedIds((curr) => curr.filter((other) => other !== id));
        setConfirmSingleDelete(null);
        toast.success("Notification deleted.");
        onRefetchNotifications();
      } catch (err) {
        console.error(err);
        toast.error(messageFromError(err, "Couldn't delete notification."));
      } finally {
        setDialogBusy(false);
      }
    },
    [onRefetchNotifications, toast],
  );

  const handleBulkDelete = useCallback(async () => {
    setDialogBusy(true);
    try {
      await Promise.all(selected.map((n) => deleteNotification(n.id)));
      clearSelection();
      setConfirmBulkDelete(false);
      toast.success(`Deleted ${plural(selected.length, "notification")}.`);
      onRefetchNotifications();
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, "Couldn't delete notifications."));
    } finally {
      setDialogBusy(false);
    }
  }, [selected, clearSelection, onRefetchNotifications, toast]);

  const handleClearRead = useCallback(async () => {
    setDialogBusy(true);
    try {
      await clearReadNotifications();
      clearSelection();
      setConfirmClearRead(false);
      toast.success("Cleared read notifications.");
      onRefetchNotifications();
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, "Couldn't clear read notifications."));
    } finally {
      setDialogBusy(false);
    }
  }, [clearSelection, onRefetchNotifications, toast]);

  const handleMarkAllRead = useCallback(async () => {
    try {
      await markAllNotificationsRead();
      toast.success("Marked all alerts as read.");
      onRefetchNotifications();
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, "Couldn't mark all alerts read."));
    }
  }, [onRefetchNotifications, toast]);

  // ── Render ─────────────────────────────────────────────────────────────────

  const heroTitle =
    totalCount === 0 ? "Nothing yet" : unreadCount === 0 ? "All caught up" : `${unreadCount} unread`;

  const heroActions = searchOpen ? (
    <IconButton icon={X} label="Close search (Esc)" onClick={closeSearch} />
  ) : (
    <>
      <IconButton
        icon={Search}
        label="Search inbox"
        tone={query ? "filled" : "default"}
        onClick={() => setSearchOpen(true)}
      />
      <Menu
        label="Inbox actions"
        placement="bottom-end"
        entries={[
          {
            id: "mark-all-read",
            label: "Mark all as read",
            icon: CheckCheck,
            disabled: unreadCount === 0,
            onSelect: handleMarkAllRead,
          },
          {
            id: "clear-read",
            label: "Clear read notifications",
            icon: Trash2,
            disabled: readCount === 0,
            onSelect: () => setConfirmClearRead(true),
          },
        ]}
        trigger={(props) => (
          <IconButton {...props} icon={EllipsisVertical} label="Inbox actions" />
        )}
      />
    </>
  );

  return (
    <section className={classes.panel} aria-label="Inbox">
      <Hero title={heroTitle} actions={heroActions}>
        {searchOpen && (
          <SearchField
            label="Search inbox"
            value={query}
            autoFocus
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.stopPropagation();
              closeSearch();
            }}
          />
        )}
      </Hero>

      <div className={classes.rails}>
        {selecting ? (
          <SelectionBar countLabel={selectionCountLabel(selected)} onClear={clearSelection}>
            {bulkAction && (
              <IconButton
                icon={bulkAction.icon === "eye" ? Eye : EyeOff}
                label={bulkAction.label}
                onClick={handleBulkRead}
              />
            )}
            <IconButton
              icon={Trash2}
              label="Delete selected"
              tone="danger"
              onClick={() => setConfirmBulkDelete(true)}
            />
          </SelectionBar>
        ) : (
          <ChipRail
            label="Inbox filter"
            value={filter}
            onChange={(val) => setFilter(val as FilterValue)}
            options={[
              { value: "all", label: "All", count: totalCount },
              { value: "unread", label: "Unread", count: unreadCount },
              { value: "read", label: "Read", count: readCount },
            ]}
          />
        )}
      </div>

      {notificationsTotal != null && notificationsTotal > notifications.length && (
        <div className={classes.truncationBanner} role="status">
          <AlertTriangle size={16} aria-hidden />
          <span>
            Showing {notifications.length} of {notificationsTotal} alerts. Older ones aren&apos;t loaded.
          </span>
        </div>
      )}

      <div className={classes.list}>
        {visibleRows.length === 0 ? (
          query.trim() ? (
            <EmptyState
              icon={Search}
              title="No alerts match your search"
              body="Try different words or clear the search box."
              actions={
                <Button variant="outline" compact onClick={() => setQuery("")}>
                  Clear search
                </Button>
              }
            />
          ) : filter === "unread" ? (
            <EmptyState
              icon={Bell}
              title="No unread alerts"
              body="You're all caught up."
              actions={
                <Button variant="outline" compact onClick={() => setFilter("all")}>
                  Show all alerts
                </Button>
              }
            />
          ) : filter === "read" ? (
            <EmptyState
              icon={Bell}
              title="No read alerts"
              body="Alerts you read will show here."
              actions={
                <Button variant="outline" compact onClick={() => setFilter("all")}>
                  Show all alerts
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={Bell}
              title="Nothing yet"
              body="When a friend shares a place or your map finishes exporting, it shows here."
            />
          )
        ) : (
          visibleRows.map((n) => {
            const label = notificationLabel(n);
            const kind = notificationKind(n);
            const meta = KIND_CONFIG[kind];
            const isSelected = selectedIds.includes(n.id);
            const placeId = notificationPlaceId(n);

            let footer: React.ReactNode = null;
            if (n.type === "friend_request") {
              footer = (
                <div className={classes.actions}>
                  <Button
                    variant="filled"
                    compact
                    onClick={() => handleAccept(n.id, n.payload.friendshipId as string)}
                  >
                    Accept
                  </Button>
                  <Button
                    variant="outline"
                    compact
                    onClick={() =>
                      setConfirmDecline({
                        notificationId: n.id,
                        friendshipId: n.payload.friendshipId as string,
                        name: String(n.payload.requesterUsername ?? "Friend"),
                      })
                    }
                  >
                    Decline
                  </Button>
                </div>
              );
            } else if (n.type === "topo_complete" && n.payload.footprint) {
              footer = (
                <div className={classes.actions}>
                  <Button
                    variant="outline"
                    compact
                    icon={MapPin}
                    onClick={() => handleZoomToMap(n)}
                  >
                    Zoom to map
                  </Button>
                </div>
              );
            } else if (n.type === "topo_export_complete" && n.payload.status === "completed") {
              footer = (
                <div className={classes.actions}>
                  <Button
                    variant="outline"
                    compact
                    icon={Download}
                    onClick={() => handleDownloadExport(n)}
                  >
                    Download
                  </Button>
                </div>
              );
            } else if (n.type === "geo_pdf_complete" && n.payload.status === "completed") {
              footer = (
                <div className={classes.actions}>
                  <Button
                    variant="outline"
                    compact
                    icon={Download}
                    onClick={() => handleDownloadGeoPdf(n)}
                  >
                    Download
                  </Button>
                </div>
              );
            }

            const menuEntries = [
              ...(n.type === "place_shared" || placeId
                ? [
                    {
                      id: "open-place",
                      label: "Open place",
                      icon: MapPin,
                      onSelect: () => handleNotificationActivate(n),
                    },
                  ]
                : []),
              n.read
                ? {
                    id: "mark-unread",
                    label: "Mark as unread",
                    icon: EyeOff,
                    onSelect: () => handleToggleSingleRead(n.id, false),
                  }
                : {
                    id: "mark-read",
                    label: "Mark as read",
                    icon: Eye,
                    onSelect: () => handleToggleSingleRead(n.id, true),
                  },
              {
                id: "delete",
                label: "Delete notification",
                icon: Trash2,
                danger: true,
                onSelect: () => setConfirmSingleDelete({ id: n.id }),
              },
            ];

            return (
              <Row
                key={n.id}
                className={classes.row}
                title={label.text}
                subtitle={`${formatDate(n.createdAt)}${label.warning ? ` · ${label.warning}` : ""}`}
                unread={!n.read}
                selected={isSelected}
                onOpen={() => handleNotificationActivate(n)}
                leading={
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={isSelected}
                    aria-label={`${isSelected ? "Deselect" : "Select"} alert`}
                    title="Select (shift-click for range)"
                    className={classes.pick}
                    data-selecting={selecting}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleSelected(n.id, e.shiftKey);
                    }}
                  >
                    <span className={classes.pickTile}>
                      <IconTile icon={meta.icon} hue={meta.hue} />
                    </span>
                    <span className={classes.pickMark} aria-hidden>
                      {isSelected ? <CircleCheck size={20} /> : <Circle size={20} />}
                    </span>
                  </button>
                }
                trailing={
                  <>
                    {!n.read && <StatusPill label="New" tone="accent" />}
                    <Menu
                      label="Alert actions"
                      placement="bottom-end"
                      entries={menuEntries}
                      trigger={(props) => (
                        <IconButton
                          {...props}
                          icon={EllipsisVertical}
                          label={`Actions for ${label.text}`}
                        />
                      )}
                    />
                  </>
                }
                footer={footer}
              />
            );
          })
        )}
      </div>

      {confirmDecline && (
        <ConfirmDialog
          open
          busy={dialogBusy}
          title="Decline friend request?"
          message={`${confirmDecline.name} will not be notified.`}
          confirmLabel="Decline"
          confirmColor="error"
          onConfirm={() =>
            handleDecline(confirmDecline.notificationId, confirmDecline.friendshipId)
          }
          onClose={() => !dialogBusy && setConfirmDecline(null)}
        />
      )}

      {confirmSingleDelete && (
        <ConfirmDialog
          open
          busy={dialogBusy}
          title="Delete notification?"
          message="It goes from every device on your account. This can't be undone."
          confirmLabel="Delete"
          confirmColor="error"
          onConfirm={() => handleSingleDelete(confirmSingleDelete.id)}
          onClose={() => !dialogBusy && setConfirmSingleDelete(null)}
        />
      )}

      {confirmBulkDelete && (
        <ConfirmDialog
          open
          busy={dialogBusy}
          title={`Delete ${plural(selected.length, "notification")}?`}
          message="It goes from every device on your account. This can't be undone."
          confirmLabel="Delete"
          confirmColor="error"
          onConfirm={handleBulkDelete}
          onClose={() => !dialogBusy && setConfirmBulkDelete(false)}
        />
      )}

      {confirmClearRead && (
        <ConfirmDialog
          open
          busy={dialogBusy}
          title="Clear read notifications?"
          message="Every notification marked as read will be removed from your account."
          confirmLabel="Clear"
          confirmColor="error"
          onConfirm={handleClearRead}
          onClose={() => !dialogBusy && setConfirmClearRead(false)}
        />
      )}
    </section>
  );
}

export default NotificationsPanel;
