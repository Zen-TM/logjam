import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  Bell,
  CheckCheck,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Download,
  EllipsisVertical,
  Eye,
  EyeOff,
  FilePlus,
  FileText,
  Layers,
  LocateFixed,
  Search,
  Share2,
  Trash2,
  TriangleAlert,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  batchKeyFromRowId,
  batchKeyOf,
  batchLabel,
  batchPendingFileSends,
  bulkReadAction,
  collapseBatches,
  countBatchRows,
  expandBatchSelection,
  findNotificationBatches,
  groupNotificationsByDay,
  isResolvedElsewhereError,
  newestNotificationsFirst,
  notificationActions,
  notificationHaystack,
  notificationKind,
  notificationLabel,
  notificationPlaceId,
  notificationsTruncated,
  selectionCountLabel,
  tallyNotifications,
  type NotificationActions,
  type NotificationBatch,
  type NotificationInlineAction,
  type NotificationKind,
} from "@logjam/shared";
import type { TNotification } from "../../../placeUtils";
import {
  acceptFileSend,
  acceptFriendRequest,
  clearReadNotifications,
  declineFileSend,
  declineFriendRequest,
  deleteNotification,
  getGeoPdfJob,
  getTopoExport,
  markAllNotificationsRead,
  markNotificationRead,
} from "../../../placeUtils";
import { triggerDownload } from "../../../download";
import type { MapsView, PanelId } from "../panels";
import type { GeoJsonPolygonal } from "../../dialogs/TopoDialog";
import ConfirmDialog from "../../dialogs/ConfirmDialog";
import { useToast } from "../../feedback/ToastProvider";
import { messageFromError } from "../../../errors/messageFromError";
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
  SectionHeader,
  SelectionBar,
  TileCheckbox,
  type MenuEntry,
} from "../../../ui";
import { idRange } from "./placesModel";
import { inboxDestination, type InboxDestination } from "./inboxModel";
import classes from "./NotificationsPanel.module.css";

// Glyphs match Logjam GPS's Feather set, drawn in lucide.
const KIND_GLYPH: Record<NotificationKind, LucideIcon> = {
  share: Share2,
  file: FilePlus,
  people: Users,
  topo: Layers,
  export: Download,
  geoPdf: FileText,
  problem: TriangleAlert,
};

// Borrowed, not invented (DESIGN.md §3): each kind wears the hue of the thing it
// is about, where that thing lives. A file you accept becomes an import, so it
// wears the import blue; a failure takes the one hue that means "look".
const KIND_HUE: Record<NotificationKind, string> = {
  share: "var(--hue-shared)",
  file: "var(--hue-import)",
  people: "var(--theme-accent)",
  topo: "var(--hue-overlay)",
  export: "var(--hue-import)",
  geoPdf: "var(--hue-geoPdf)",
  problem: "var(--theme-warning)",
};

type Bucket = "all" | "unread" | "read";

type PendingConfirm = { title: string; message: string; confirmLabel: string; run: () => Promise<void> };

const NO_KEYS: ReadonlySet<string> = new Set<string>();

function payloadString(n: TNotification, key: string): string | null {
  const value = n.payload[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** The day is the section heading, so a row only needs the clock. */
function formatTime(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "" : at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/**
 * Inbox: "what happened while I was away?" The hero answers with what is
 * unread; one rail splits All / Unread / Read; the list runs newest first in
 * day sections, with a bulk share collapsed to one row. A notification that
 * ASKS something (a friend request, a file a friend sent) is answered in its
 * row; one that reports something opens it, and its ⋯ says where that thing
 * lives. Logjam GPS's inbox (`NotificationsScreen`) is the counterpart, and
 * every rule the two share is in @logjam/shared.
 */
function NotificationsPanel({
  notifications,
  notificationsLoaded,
  notificationsError,
  notificationsTotal,
  onRefetchNotifications,
  onOverrideRead,
  onRefetchFriends,
  setSelectedPlaceID,
  setActivePanel,
  onMapsViewChange,
  onTopoFlyTarget,
}: {
  notifications: TNotification[];
  notificationsLoaded: boolean;
  notificationsError: string | null;
  /** The server's count before its list cap; null until known. */
  notificationsTotal: number | null;
  onRefetchNotifications: () => void;
  /** Show a read state now, ahead of its write (`null` takes it back). */
  onOverrideRead: (ids: string[], read: boolean | null) => void;
  onRefetchFriends: () => void;
  setSelectedPlaceID: (id: string | null) => void;
  setActivePanel: (panel: PanelId | null) => void;
  onMapsViewChange: (view: MapsView) => void;
  onTopoFlyTarget: (footprint: GeoJsonPolygonal) => void;
}) {
  const toast = useToast();
  const dayIdPrefix = useId();
  const [bucket, setBucket] = useState<Bucket>("all");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [expandedBatches, setExpandedBatches] = useState<ReadonlySet<string>>(NO_KEYS);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectionAnchor = useRef<string | null>(null);
  // Rows answered or deleted here, hidden before the refetch lands, so a row
  // does not sit with live buttons until the server says it has gone.
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(NO_KEYS);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [confirming, setConfirming] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Refetch on every open — notifications are otherwise only fetched at boot, so
  // ones received mid-session (or resolved elsewhere, NOTIF-1) stay stale until
  // a full reload.
  useEffect(() => {
    onRefetchNotifications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── The list ─────────────────────────────────────────────────────────
  const live = useMemo(
    () => newestNotificationsFirst(notifications.filter((n) => !hiddenIds.has(n.id))),
    [notifications, hiddenIds],
  );
  // Every count collapses batches, because the list does: a friend sharing
  // twelve items leaves one row, and "12 unread" over one row disagrees with it.
  const tally = useMemo(() => tallyNotifications(live), [live]);
  const readCount = live.length - live.filter((n) => !n.read).length;

  const needle = query.trim().toLowerCase();
  const searched = useMemo(
    () => (needle ? live.filter((n) => notificationHaystack(n).includes(needle)) : live),
    [live, needle],
  );
  // A chip's count applies the search but not its own axis: "how many would I
  // get if I pressed this".
  const bucketCounts = useMemo(
    () => ({
      all: tallyNotifications(searched).total,
      unread: tallyNotifications(searched.filter((n) => !n.read)).total,
      read: tallyNotifications(searched.filter((n) => n.read)).total,
    }),
    [searched],
  );
  const visible = useMemo(
    () => (bucket === "all" ? searched : searched.filter((n) => (bucket === "unread" ? !n.read : n.read))),
    [searched, bucket],
  );
  // Gathered over the FILTERED list, so a header counts the rows it opens onto.
  const batches = useMemo(() => findNotificationBatches(visible), [visible]);
  const rows = useMemo(() => collapseBatches(visible, batches, expandedBatches), [visible, batches, expandedBatches]);
  const sections = useMemo(() => groupNotificationsByDay(rows), [rows]);

  // ── Selection ────────────────────────────────────────────────────────
  // Every notification is selectable: both group verbs act on any of them.
  const rowIds = useMemo(() => rows.map((row) => row.id), [rows]);
  const pickedRows = useMemo(() => {
    const picked = new Set(selectedIds);
    return rows.filter((row) => picked.has(row.id));
  }, [rows, selectedIds]);
  // A picked batch header stands for every notification under it.
  const selected = useMemo(() => expandBatchSelection(pickedRows, batches), [pickedRows, batches]);
  const selecting = pickedRows.length > 0;
  const readAction = useMemo(() => bulkReadAction(selected), [selected]);

  const clearSelection = useCallback(() => {
    setSelectedIds([]);
    selectionAnchor.current = null;
  }, []);

  const toggleSelected = (id: string, extendRange: boolean) => {
    if (extendRange && selectionAnchor.current) {
      const range = idRange(rowIds, selectionAnchor.current, id);
      setSelectedIds((current) => [...new Set([...current, ...range])]);
    } else {
      setSelectedIds((current) => (current.includes(id) ? current.filter((other) => other !== id) : [...current, id]));
    }
    selectionAnchor.current = id;
  };

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !selecting) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, [role='menu']")) return;
      if (event.key === "Escape") {
        event.preventDefault();
        clearSelection();
      } else if (event.key.toLowerCase() === "a" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        setSelectedIds(rowIds);
      }
    };
    root.addEventListener("keydown", onKeyDown);
    return () => root.removeEventListener("keydown", onKeyDown);
  }, [selecting, rowIds, clearSelection]);

  // A bucket change can narrow a picked row out of view, and a group verb must
  // not reach rows the user can no longer see.
  const changeBucket = (next: Bucket) => {
    clearSelection();
    setBucket(next);
  };

  // ── Verbs ────────────────────────────────────────────────────────────
  const hide = useCallback((ids: string[]) => setHiddenIds((prev) => new Set([...prev, ...ids])), []);
  const unhide = useCallback(
    (ids: string[]) =>
      setHiddenIds((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      }),
    [],
  );

  // ONE read-state writer, for a row, a batch and a selection, in both
  // directions. The rows change at once; the refetch confirms, and a failed
  // write takes the change back.
  const setRead = useCallback(
    async (ids: string[], read: boolean): Promise<boolean> => {
      if (ids.length === 0) return true;
      onOverrideRead(ids, read);
      try {
        // ponytail: one PATCH per notification — a selection is a screenful. A
        // bulk endpoint when marking hundreds at once is normal.
        await Promise.all(ids.map((id) => markNotificationRead(id, read)));
        return true;
      } catch (err) {
        console.error(err);
        toast.error(messageFromError(err, read ? "Couldn't mark that as read." : "Couldn't mark that as unread."));
        onOverrideRead(ids, null);
        return false;
      } finally {
        onRefetchNotifications();
      }
    },
    [onOverrideRead, onRefetchNotifications, toast],
  );

  // Reading it is what marks it read; a place it is about opens on top.
  const openNotification = (n: TNotification) => {
    if (!n.read) void setRead([n.id], true);
    const placeId = notificationPlaceId(n);
    if (placeId) {
      setSelectedPlaceID(placeId);
      setActivePanel("place-detail");
    }
  };

  // Following a notification through to its subject reads it, as opening does.
  const goTo = (n: TNotification, destination: InboxDestination) => {
    if (!n.read) void setRead([n.id], true);
    if (destination.kind === "place") {
      setSelectedPlaceID(destination.placeId);
      setActivePanel("place-detail");
      return;
    }
    if (destination.mapsView) onMapsViewChange(destination.mapsView);
    setActivePanel(destination.panel);
  };

  // Opening a batch reads it, as opening a row does — except in the Unread
  // bucket, where marking would take the rows away as they opened (Logjam GPS's
  // `toggleBatch` has the whole reasoning). Shutting one marks nothing.
  const toggleBatch = (batch: NotificationBatch) => {
    const expanding = !expandedBatches.has(batch.key);
    setExpandedBatches((prev) => {
      const next = new Set(prev);
      if (expanding) next.add(batch.key);
      else next.delete(batch.key);
      return next;
    });
    if (!expanding || bucket === "unread") return;
    void setRead(batch.items.filter((item) => !item.read).map((item) => item.id), true);
  };

  const deleteNotifications = async (ids: string[]) => {
    hide(ids);
    try {
      await Promise.all(ids.map((id) => deleteNotification(id)));
      toast.success(ids.length === 1 ? "Notification deleted." : `Deleted ${ids.length} notifications.`);
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, "Couldn't delete that."));
      // The refetch says which went; show the rest again.
      unhide(ids);
    } finally {
      onRefetchNotifications();
    }
  };

  const confirmDelete = (ids: string[]) =>
    setPendingConfirm({
      title: ids.length === 1 ? "Delete this notification?" : `Delete ${ids.length} notifications?`,
      message:
        ids.length === 1
          ? "It goes from every device on your account. This can't be undone."
          : "They go from every device on your account. This can't be undone.",
      confirmLabel: "Delete",
      run: async () => {
        await deleteNotifications(ids);
        clearSelection();
      },
    });

  // The selection survives: marking is not destructive and the rows are all
  // still there, so the obvious follow-up (mark these, now delete them) needs
  // no second selection.
  const applyReadAction = async () => {
    if (!readAction) return;
    if (await setRead(readAction.ids, readAction.read)) toast.success(readAction.success);
  };

  const markAllRead = async () => {
    const unreadIds = live.filter((n) => !n.read).map((n) => n.id);
    onOverrideRead(unreadIds, true);
    try {
      await markAllNotificationsRead();
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, "Couldn't mark notifications read."));
      onOverrideRead(unreadIds, null);
    } finally {
      onRefetchNotifications();
    }
  };

  const confirmClearRead = () =>
    setPendingConfirm({
      title: "Clear read notifications?",
      message: "Every notification you've read goes, from every device on your account. Unread ones stay.",
      confirmLabel: "Clear",
      run: async () => {
        try {
          await clearReadNotifications();
          clearSelection();
        } catch (err) {
          console.error(err);
          toast.error(messageFromError(err, "Couldn't clear read notifications."));
        } finally {
          onRefetchNotifications();
        }
      },
    });

  // Answer a notification's question. Which calls run is the descriptor's
  // `type`; the words are all `notificationActions`'.
  const answer = (n: TNotification, target: NotificationActions, action: NotificationInlineAction) => {
    const run = async () => {
      setBusyId(n.id);
      // Only a file ACCEPT leaves the notification alive (as "Download again");
      // the server purges the notification on the other three.
      const survives = target.type === "file_sent" && action.kind === "accept";
      try {
        if (target.type === "friend_request") {
          await (action.kind === "accept" ? acceptFriendRequest : declineFriendRequest)(target.targetId);
          onRefetchFriends();
        } else if (action.kind === "accept") {
          const { downloadUrl, filename } = await acceptFileSend(target.targetId);
          triggerDownload(downloadUrl);
          // Logjam Web has no Saved: accepting a copy here IS the download, so
          // the phone's "find it in Saved" would send the user looking for nothing.
          toast.success(`Downloading ${filename}.`);
        } else {
          await declineFileSend(target.targetId);
        }
        if (survives) {
          // Answering it is reading it.
          if (!n.read) void setRead([n.id], true);
        } else {
          hide([n.id]);
          toast.success(action.success);
        }
      } catch (err) {
        console.error(err);
        toast.error(messageFromError(err, action.failure));
        if (isResolvedElsewhereError(err)) {
          // Answered somewhere else (Friends, Logjam GPS, another tab), or the
          // send is gone: the buttons are dead, not retryable, so clear the row
          // as a success would rather than bring them back (NOTIF-1).
          hide([n.id]);
          // Best-effort: the server has usually purged it already, which is a 404.
          deleteNotification(n.id).catch((deleteErr) => console.error(deleteErr));
        }
      } finally {
        setBusyId(null);
        onRefetchNotifications();
      }
    };
    if (action.confirm) {
      setPendingConfirm({
        title: action.confirm.title,
        message: action.confirm.body,
        confirmLabel: action.confirm.confirmLabel,
        run,
      });
    } else {
      void run();
    }
  };

  const downloadJobFile = async (n: TNotification, presign: () => Promise<string | null | undefined>, failure: string) => {
    try {
      const url = await presign();
      if (!url) throw new Error("The job has no download URL");
      triggerDownload(url);
      if (!n.read) void setRead([n.id], true);
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, failure));
    }
  };

  const zoomToMap = (n: TNotification, footprint: GeoJsonPolygonal) => {
    onTopoFlyTarget(footprint);
    if (!n.read) void setRead([n.id], true);
  };

  // ── Render ───────────────────────────────────────────────────────────
  const rowEntries = (n: TNotification): MenuEntry[] => {
    const destination = inboxDestination(n);
    const entries: MenuEntry[] = [];
    if (destination) {
      entries.push(
        { id: "go", label: destination.label, icon: ArrowRight, onSelect: () => goTo(n, destination) },
        { id: "sep-go", separator: true },
      );
    }
    entries.push(
      n.read
        ? { id: "unread", label: "Mark as unread", icon: EyeOff, onSelect: () => void setRead([n.id], false) }
        : { id: "read", label: "Mark as read", icon: Eye, onSelect: () => void setRead([n.id], true) },
      { id: "sep-delete", separator: true },
      { id: "delete", label: "Delete", icon: Trash2, danger: true, onSelect: () => confirmDelete([n.id]) },
    );
    return entries;
  };

  // The row's own answer, inside the card. Inert while a selection runs: a
  // press meant for a checkbox must not accept a friend request.
  const rowFooter = (n: TNotification): ReactNode => {
    const target = notificationActions(n);
    if (target) {
      return target.actions.map((action) => (
        <Button
          key={action.kind}
          compact
          // Decline is the outline: two filled buttons side by side make "no"
          // look like the thing to press.
          variant={action.kind === "decline" ? "outline" : "filled"}
          disabled={selecting || busyId !== null}
          onClick={() => answer(n, target, action)}
        >
          {action.label}
        </Button>
      ));
    }
    const footprint = n.payload.footprint as GeoJsonPolygonal | undefined;
    if (n.type === "topo_complete" && footprint) {
      return (
        <Button compact variant="outline" icon={LocateFixed} disabled={selecting} onClick={() => zoomToMap(n, footprint)}>
          Zoom to map
        </Button>
      );
    }
    const exportJobId = payloadString(n, "exportJobId");
    if (n.type === "topo_export_complete" && n.payload.status === "completed" && exportJobId) {
      return (
        <Button
          compact
          variant="outline"
          icon={Download}
          disabled={selecting}
          onClick={() =>
            void downloadJobFile(n, async () => (await getTopoExport(exportJobId)).downloadUrl, "Couldn't download the export.")
          }
        >
          Download
        </Button>
      );
    }
    const geoPdfJobId = payloadString(n, "geoPdfJobId");
    if (n.type === "geo_pdf_complete" && n.payload.status === "completed" && geoPdfJobId) {
      return (
        <Button
          compact
          variant="outline"
          icon={Download}
          disabled={selecting}
          onClick={() =>
            void downloadJobFile(n, async () => (await getGeoPdfJob(geoPdfJobId)).downloadUrl, "Couldn't download the GeoPDF.")
          }
        >
          Download
        </Button>
      );
    }
    return null;
  };

  const renderRow = (row: TNotification) => {
    const headerKey = batchKeyFromRowId(row.id);
    const batch = headerKey ? (batches.get(headerKey) ?? null) : null;
    const memberKey = batch ? null : batchKeyOf(row);
    const member = memberKey != null && batches.has(memberKey);
    const kind = notificationKind(batch ? batch.representative : row);
    const unread = batch ? batch.unreadCount > 0 : !row.read;
    const isSelected = selectedIds.includes(row.id);
    const expanded = batch != null && expandedBatches.has(batch.key);

    let title: string;
    let subtitle: string;
    if (batch) {
      const pending = batchPendingFileSends(batch);
      title = batchLabel(batch);
      subtitle = [
        batch.unreadCount > 0 ? `${batch.unreadCount} unread` : null,
        // Named, because a partly answered batch otherwise hides what is left.
        batch.group === "files" && pending.length !== batch.items.length ? `${pending.length} still to answer` : null,
        formatTime(batch.representative.createdAt),
      ]
        .filter(Boolean)
        .join(" · ");
    } else {
      const label = notificationLabel(row);
      title = label.text;
      subtitle = [label.warning, notificationActions(row)?.pill, formatTime(row.createdAt)].filter(Boolean).join(" · ");
    }

    return (
      <Row
        key={row.id}
        className={member ? `${classes.row} ${classes.member}` : classes.row}
        title={title}
        subtitle={subtitle || undefined}
        description={unread ? "Unread" : undefined}
        accentEdge={unread}
        selected={isSelected}
        onOpen={() => (batch ? toggleBatch(batch) : openNotification(row))}
        leading={
          <TileCheckbox
            tile={<IconTile icon={KIND_GLYPH[kind]} hue={KIND_HUE[kind]} />}
            label={`Select ${title}`}
            checked={isSelected}
            selecting={selecting}
            onToggle={(extendRange) => toggleSelected(row.id, extendRange)}
          />
        }
        trailing={
          batch ? (
            // No ⋯ on a batch: its verbs act on one notification, and the
            // selection bar already acts on all of them through the header.
            <IconButton
              icon={expanded ? ChevronUp : ChevronDown}
              label={expanded ? "Collapse this group" : "Show each one"}
              aria-expanded={expanded}
              onClick={() => toggleBatch(batch)}
            />
          ) : selecting ? undefined : (
            <Menu
              label={`Actions for ${title}`}
              title={title}
              placement="right-start"
              entries={rowEntries(row)}
              trigger={(props) => <IconButton {...props} icon={EllipsisVertical} label={`Actions for ${title}`} />}
            />
          )
        }
        footer={batch ? undefined : rowFooter(row)}
      />
    );
  };

  const closeSearch = () => {
    setQuery("");
    setSearchOpen(false);
  };

  const hero = (
    <Hero
      title={
        !notificationsLoaded ? "Inbox" : tally.unread > 0 ? `${tally.unread} unread` : tally.total > 0 ? "All caught up" : "Nothing yet"
      }
      actions={
        searchOpen ? (
          <IconButton icon={X} label="Close search" onClick={closeSearch} />
        ) : (
          <>
            <IconButton
              icon={Search}
              label="Search notifications"
              tone={query ? "filled" : "default"}
              aria-expanded={false}
              onClick={() => setSearchOpen(true)}
            />
            <Menu
              label="Inbox actions"
              placement="bottom-end"
              entries={[
                {
                  id: "read-all",
                  label: "Mark all as read",
                  icon: CheckCheck,
                  disabled: tally.unread === 0,
                  onSelect: () => void markAllRead(),
                },
                {
                  id: "clear-read",
                  label: "Clear read notifications…",
                  icon: Trash2,
                  danger: true,
                  disabled: readCount === 0,
                  onSelect: confirmClearRead,
                },
              ]}
              trigger={(props) => <IconButton {...props} icon={EllipsisVertical} label="Inbox actions" />}
            />
          </>
        )
      }
    >
      {/* The search box takes the title's place on the same line, so opening it moves nothing. */}
      {searchOpen && (
        <SearchField
          label="Search notifications"
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
  );

  const emptyArea = (children: ReactNode) => <div className={classes.emptyArea}>{children}</div>;
  const showEverything = (
    <Button compact variant="outline" onClick={() => changeBucket("all")}>
      Show everything
    </Button>
  );

  const list = !notificationsLoaded ? (
    <div className={classes.emptyArea} role="status">
      <p className={classes.loading}>Loading your inbox…</p>
    </div>
  ) : notificationsError && live.length === 0 ? (
    emptyArea(
      <EmptyState
        icon={CircleAlert}
        title="Couldn't load your inbox"
        body={notificationsError}
        actions={
          <Button compact variant="outline" onClick={onRefetchNotifications}>
            Try again
          </Button>
        }
      />,
    )
  ) : live.length === 0 ? (
    emptyArea(<EmptyState icon={Bell} title="Nothing yet" body="Shares, friend requests and finished maps appear here." />)
  ) : rows.length === 0 ? (
    emptyArea(
      needle ? (
        <EmptyState
          icon={Search}
          title="Nothing matches"
          body="The search runs over what a row says — a name, a place, a filename."
          actions={
            <Button compact variant="outline" onClick={() => setQuery("")}>
              Clear search
            </Button>
          }
        />
      ) : bucket === "unread" ? (
        <EmptyState icon={CheckCheck} title="Nothing unread" actions={showEverything} />
      ) : (
        <EmptyState icon={Bell} title="Nothing read yet" actions={showEverything} />
      ),
    )
  ) : (
    <div className={classes.list}>
      {sections.map((section) => {
        const headingId = `${dayIdPrefix}-${section.key}`;
        return (
          <section key={section.key} className={classes.day} aria-labelledby={headingId}>
            {/* A batch counts as the one thing that happened, so opening a
                group does not make the day's count jump. */}
            <SectionHeader
              id={headingId}
              title={section.title}
              count={countBatchRows(section.data, batches)}
              className={classes.dayHead}
            />
            {section.data.map(renderRow)}
          </section>
        );
      })}
    </div>
  );

  return (
    <div ref={rootRef} className={classes.root}>
      {hero}
      {live.length > 0 && (
        <>
          {/* The selection bar takes the rail's slot at the rail's height, so
              the list does not move when a selection starts (DESIGN.md §7). */}
          <div className={classes.rails}>
            {selecting ? (
              <SelectionBar countLabel={selectionCountLabel(selected)} onClear={clearSelection}>
                {/* ONE read/unread button: which way it goes follows the
                    selection, and the count line says the unread tally that
                    decides it. */}
                {readAction && (
                  <IconButton
                    icon={readAction.icon === "eye" ? Eye : EyeOff}
                    label={readAction.label}
                    onClick={() => void applyReadAction()}
                  />
                )}
                <IconButton
                  icon={Trash2}
                  label="Delete"
                  tone="danger"
                  onClick={() => confirmDelete(selected.map((n) => n.id))}
                />
              </SelectionBar>
            ) : (
              <ChipRail
                label="Show"
                options={[
                  { value: "all", label: "All", count: bucketCounts.all },
                  // A bucket the search has emptied stays in place, disabled.
                  { value: "unread", label: "Unread", count: bucketCounts.unread, disabled: bucketCounts.unread === 0 && bucket !== "unread" },
                  { value: "read", label: "Read", count: bucketCounts.read, disabled: bucketCounts.read === 0 && bucket !== "read" },
                ]}
                value={bucket}
                onChange={changeBucket}
              />
            )}
          </div>
        </>
      )}
      {/* The server caps the list; say so rather than let the oldest go missing
          without a word (UX-002). */}
      {notificationsTruncated(notificationsTotal) && (
        <p className={classes.note}>
          Showing the {notifications.length} most recent of {notificationsTotal}. Older ones aren&rsquo;t listed.
        </p>
      )}
      {list}

      <ConfirmDialog
        open={pendingConfirm != null}
        title={pendingConfirm?.title ?? ""}
        message={pendingConfirm?.message ?? ""}
        confirmLabel={pendingConfirm?.confirmLabel}
        confirmColor="error"
        busy={confirming}
        onConfirm={() => {
          if (!pendingConfirm) return;
          setConfirming(true);
          void pendingConfirm.run().finally(() => {
            setConfirming(false);
            setPendingConfirm(null);
          });
        }}
        onClose={() => setPendingConfirm(null)}
      />
    </div>
  );
}

export default NotificationsPanel;
