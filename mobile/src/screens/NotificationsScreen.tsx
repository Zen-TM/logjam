// Inbox — "what happened while I was away?"
//
// LAYOUT (DESIGN.md §1, §2): hero answers the question with a count and carries
// the one bulk action; a pinned rail partitions into Unread / Read; the list is a
// `SectionList` grouped by local calendar day with sticky headers, because a
// notification list is chronological and dates are an ordering aid, not a second
// filter.
//
// Cache-first (§4.7): the last fetch is cached so the inbox reads offline; a live
// fetch refreshes it. Mark-read goes through the outbox like every other mutation
// so it survives offline, patching the cache first for an immediate read state.
//
// A notification that REFERS to something is a way in to that thing: tapping a
// canyon share opens the canyon. Previously every tap did nothing but mark the
// row read, which made the inbox a dead end you had to navigate out of by hand.
//
// A notification that ASKS something is answered HERE, in the row (§5's inline
// action slot): a friend request and a file a friend sent both carry accept /
// decline under the row. Which pair a notification carries, and every word of
// the copy, is `notifications/notificationActions.ts` — the screen renders what
// that returns and knows nothing about friendships or sends. This is what
// replaced the standalone "Received files" screen (deleted 2026-08-30): an
// accepted file becomes an ordinary Saved import through the same pipeline any
// picked file goes through, so it never needed a page of its own.
//
// PRIVACY: rows show the server-resolved label (which may include a canyon NAME —
// user-supplied text, allowed) and a timestamp. Never a coordinate. Tapping
// through passes an opaque id and the detail screen fetches over the authed API,
// so a share revoked since the notification lands on the 404-not-403 path.
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Alert, RefreshControl, SectionList, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { messageFromError } from "@logjam/shared";

import { acceptFriendRequest, declineFriendRequest } from "../api/friends";
import { declineFileSend } from "../api/fileSends";
import type { TNotification } from "../api/types";
import { useAccountState } from "../auth/AccountStateContext";
import { capabilityScreenBlock } from "../auth/capabilities";
import { acceptReceivedFile } from "../imports/acceptReceivedFile";
import { useConnectivity } from "../map/connectivity";
import {
  isResolvedElsewhereError,
  notificationActions,
  type NotificationActionKind,
  type NotificationActions,
  type NotificationInlineAction,
} from "../notifications/notificationActions";
import { bulkReadAction, selectionCountLabel } from "../notifications/bulkReadAction";
import {
  batchFileActionMessage,
  runBatchFileAction,
  type BatchFileActionKind,
  type BatchFileActionProgress,
} from "../notifications/batchFileAction";
import {
  batchKeyFromRowId,
  batchKeyOf,
  batchLabel,
  batchPendingFileSends,
  collapseBatches,
  findNotificationBatches,
  type NotificationBatch,
} from "../notifications/notificationBatches";
import { NotificationOptionsSheet } from "../notifications/NotificationOptionsSheet";
import { fontSize, fontWeight, spacing, surface, theme } from "../theme";
import { enqueueNotificationDelete, enqueueNotificationRead } from "../sync/outbox";
import {
  fetchAndCacheNotifications,
  patchCachedPayload,
  patchCachedRead,
  readNotificationsCache,
  removeCachedNotifications,
} from "../sync/notificationsCache";
import { onMirrorChanged } from "../sync/syncDb";
import {
  Button,
  EmptyState,
  ErrorState,
  HeroHeader,
  IconButton,
  LoadingState,
  Row,
  SegmentedControl,
  SelectionBar,
  StatusPill,
  TextField,
  Toast,
  useBulkSelection,
  type SegmentOption,
  type ToastMessage,
} from "../ui";
import {
  groupNotificationsByDay,
  notificationCanyonId,
  notificationHaystack,
  notificationLabel,
  notificationMeta,
} from "./notificationLabel";

type NotificationsState = {
  notifications: TNotification[];
  /**
   * The server's count of EVERYTHING, which can exceed the list: the endpoint
   * caps its response (500 rows) and reports the true total beside it. Null
   * when nothing has been fetched yet.
   */
  total: number | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
};

// Cache-first inbox load: render the cache immediately, then live-fetch. A
// failed fetch with a populated cache is silent (offline); only an empty
// cache surfaces the error.
//
// `blocked` is the guest gate: a guest has no inbox to fetch, and neither the
// cache read nor the fetch may fire (mobile/CLAUDE.md — a guaranteed 401 per
// screen open). It is a parameter rather than a hook read so this stays one
// decision made by the screen.
function useNotifications(blocked: boolean): NotificationsState {
  const [notifications, setNotifications] = useState<TNotification[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fetchCount, setFetchCount] = useState(0);

  useEffect(() => {
    if (blocked) return;
    let cancelled = false;
    (async () => {
      const cache = await readNotificationsCache().catch(() => null);
      if (!cancelled && cache) {
        setNotifications(cache.notifications);
        setTotal(cache.total);
      }
      try {
        const fresh = await fetchAndCacheNotifications();
        if (!cancelled) {
          setNotifications(fresh.notifications);
          setTotal(fresh.total);
          setError(null);
        }
      } catch (err) {
        if (!cancelled && !cache) {
          setError(messageFromError(err, "Couldn't load notifications."));
          setNotifications([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [blocked, fetchCount]);

  // markRead patches the cache and fires notifyMirrorChanged; re-read it.
  useEffect(() => {
    if (blocked) return;
    const unsubscribe = onMirrorChanged(() => {
      readNotificationsCache()
        .then((cache) => {
          if (!cache) return;
          setNotifications(cache.notifications);
          setTotal(cache.total);
        })
        // A failed cache read leaves a stale list on screen; say so somewhere
        // rather than losing the only trace of it.
        .catch(console.error);
    });
    return unsubscribe;
  }, [blocked]);

  const refetch = useCallback(() => setFetchCount((n) => n + 1), []);
  return {
    notifications: notifications ?? [],
    total,
    loading: notifications === null,
    error,
    refetch,
  };
}

function formatTime(iso: string): string {
  // True timestamp (not date-only), and the day is already the section header —
  // so the row only needs the clock.
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

type Bucket = "all" | "unread" | "read";

// Stable identities for the selection hook — an inline arrow rebuilds its
// memos on every render of the screen.
const notificationKey = (n: TNotification): string => n.id;
/** Every notification can be picked: both group verbs act on any of them. */
const alwaysSelectable = (): boolean => true;

const EMPTY_BATCH_KEYS: ReadonlySet<string> = new Set<string>();

/**
 * Replace every picked BATCH HEADER with the rows it stands for.
 *
 * The header is not a row of its own — it is one member of the batch wearing
 * the batch's words — so a group verb that acted only on it would mark one of
 * twelve read, or delete one of twelve and strand the rest. Deduped by id
 * because an EXPANDED batch can have its header and its members picked
 * separately.
 */
function expandBatchSelection(
  selected: TNotification[],
  batches: Map<string, NotificationBatch>,
): TNotification[] {
  const byId = new Map<string, TNotification>();
  for (const notification of selected) {
    const batch = batches.get(batchKeyFromRowId(notification.id) ?? "");
    if (batch) {
      for (const member of batch.items) byId.set(member.id, member);
    } else {
      byId.set(notification.id, notification);
    }
  }
  return [...byId.values()];
}

export function NotificationsScreen({
  onBack,
  onUnreadChanged,
  onOpenCanyon,
}: {
  onBack: () => void;
  onUnreadChanged?: () => void;
  onOpenCanyon: (canyonId: string) => void;
}) {
  const { accountState } = useAccountState();
  const guestBlock = useMemo(
    () => capabilityScreenBlock("inbox", accountState),
    [accountState],
  );
  const query = useNotifications(guestBlock !== null);
  const refetch = query.refetch;
  // ONE toast channel for every action outcome (DESIGN.md §6): an inline banner
  // reflows the list under the user's thumb and then lingers with no owner, and
  // on a scrolled list it lands off screen entirely — which is how accepting a
  // file came to look like it did nothing.
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const notify = useCallback((text: string, tone: ToastMessage["tone"] = "info") => {
    setToast({ text, tone, nonce: Date.now() });
  }, []);
  const [bucket, setBucket] = useState<Bucket>("all");
  const [search, setSearch] = useState("");
  /** Which row's ⋯ sheet is open, by id — the row itself is looked up from the
   *  live list, so a refetch can't leave the sheet holding a stale copy. */
  const [menuId, setMenuId] = useState<string | null>(null);
  // Accept / decline are ONLINE-ONLY and dimmed rather than hidden (§10): the
  // list itself reads from the cache offline, so the row is there either way
  // and a vanishing button would read as "this one can't be answered".
  const online = useConnectivity() === "online";
  const [busy, setBusy] = useState<{ id: string; kind: NotificationActionKind } | null>(
    null,
  );
  // Rows whose question is answered, hidden before the refetch lands. Every
  // action here except a file ACCEPT deletes the notification server-side, so
  // without this the row sits with live buttons until the fetch returns.
  const [actionedIds, setActionedIds] = useState<Set<string>>(new Set());
  // NEWEST FIRST, and never re-sorted by read state. The server returns
  // `read: asc` then `createdAt: desc`, which made acting on a row teleport it
  // to the bottom of the list mid-gesture — and, because the day grouping runs
  // over whatever order it is handed, it could also emit "Today" twice with a
  // week in between. A list ordered by time stays put while you work down it.
  const notifications = useMemo(
    () =>
      query.notifications
        .filter((n) => !actionedIds.has(n.id))
        .slice()
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
    [actionedIds, query.notifications],
  );

  const needle = search.trim().toLowerCase();
  const unreadCount = notifications.filter((n) => !n.read).length;

  // The rail's tallies come from the OTHER axis only (the search), so a chip
  // answers "how many would I get if I tapped this" rather than restating the
  // bucket already showing — the rule the Canyons rail follows. The HERO keeps
  // counting the whole inbox: it answers a question about the inbox, not about
  // the filter being held.
  const searched = useMemo(
    () =>
      needle === ""
        ? notifications
        : notifications.filter((n) => notificationHaystack(n).includes(needle)),
    [needle, notifications],
  );
  const searchedUnread = searched.filter((n) => !n.read).length;

  const visible = useMemo(
    () =>
      bucket === "all"
        ? searched
        : searched.filter((n) => (bucket === "unread" ? !n.read : n.read)),
    [bucket, searched],
  );
  // --- Bulk-share batches ---------------------------------------------------
  // A friend who shares 23 things in one gesture creates 23 notifications, and
  // they stay 23 notifications — each is separately answerable and separately
  // dropped when its share is revoked (see notifications/notificationBatches.ts
  // for why an aggregate ROW server-side would break both). The collapse is
  // here, over the ALREADY-FILTERED list, so a batch header counts the rows the
  // user can actually see under it rather than promising twelve and opening on
  // four.
  const [expandedBatches, setExpandedBatches] = useState<ReadonlySet<string>>(
    EMPTY_BATCH_KEYS,
  );
  const batches = useMemo(() => findNotificationBatches(visible), [visible]);
  const rows = useMemo(
    () => collapseBatches(visible, batches, expandedBatches),
    [batches, expandedBatches, visible],
  );
  const toggleBatch = useCallback((key: string) => {
    setExpandedBatches((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const sections = useMemo(() => groupNotificationsByDay(rows), [rows]);

  // --- Multi-select (DESIGN.md §7) -----------------------------------------
  // The same hook and the same bar as Canyons, Logs and Saved: press and hold a
  // row to start, tap to toggle, the last row deselected leaves the mode. Every
  // notification is selectable — unlike a shared canyon, there is no row the
  // group verbs cannot act on.
  const {
    selectedKeys,
    clearSelection,
    selectItem,
    selectAll,
    selectedItems,
    selectableItems,
    selecting,
  } = useBulkSelection({
    items: rows,
    keyOf: notificationKey,
    isDeletable: alwaysSelectable,
  });
  /**
   * The selection as the group verbs act on it: a picked BATCH HEADER stands
   * for every row under it, collapsed or not.
   *
   * Selecting a row that says "bob shared 12 items with you" and then deleting
   * one notification would leave eleven orphans in the list with nothing left
   * to group them — the header IS the twelve rows, so it has to select as them.
   */
  const selectedNotifications = useMemo(
    () => expandBatchSelection(selectedItems, batches),
    [batches, selectedItems],
  );
  // A selection is a transient mode over rows you can see (§7). Also drops the
  // per-row sheet: a sheet does not outlive the tab.
  useFocusEffect(
    useCallback(() => {
      clearSelection();
      setMenuId(null);
    }, [clearSelection]),
  );
  // A bucket change can narrow a selected row out of the list, which would let
  // a bulk verb reach rows the user can no longer see — the same rule the other
  // screens apply to a filter change.
  const changeBucket = useCallback(
    (next: Bucket) => {
      clearSelection();
      setBucket(next);
    },
    [clearSelection],
  );

  /**
   * The server caps its list (500 rows) and reports the true total beside it,
   * so an inbox past the cap is showing a WINDOW. Say so at the bottom of the
   * list rather than letting the count in the hero quietly disagree with the
   * rows — and compare against the fetched list, not the filtered one, or every
   * search would claim to be truncated.
   */
  const truncated =
    query.total !== null && query.total > query.notifications.length;

  /** Which way the bar's single read/unread button goes for this selection. */
  const readAction = useMemo(
    () => bulkReadAction(selectedNotifications),
    [selectedNotifications],
  );

  // ONE read-state writer, in both directions and for any number of rows: the
  // cache patch and the outbox op have to agree about which ids and which
  // value, and a second copy of that pairing is how the badge and the list end
  // up disagreeing. Marking is offline-safe — the op flushes later, and the
  // next fetch replays the queue over the response rather than undoing it
  // (`pendingInboxOps` in notificationsCache).
  const setRead = useCallback(
    async (ids: string[], read: boolean) => {
      if (ids.length === 0) return;
      try {
        await patchCachedRead(ids, read);
        await enqueueNotificationRead(ids, read);
        onUnreadChanged?.();
      } catch (err) {
        console.error(err);
        notify(
          messageFromError(
            err,
            read ? "Couldn't mark that as read." : "Couldn't mark that as unread.",
          ),
          "error",
        );
      }
    },
    [notify, onUnreadChanged],
  );

  const markRead = useCallback(
    async (n: TNotification) => {
      if (n.read) return;
      await setRead([n.id], true);
    },
    [setRead],
  );

  /**
   * Delete, for one row or a selection. The cache drops them first so the list
   * answers the tap immediately, then the ops queue; nothing refetches, because
   * the fetch is the authority on what exists and would simply hand the rows
   * back until the queue flushes.
   */
  const deleteNotifications = useCallback(
    async (targets: TNotification[]) => {
      const ids = targets.map((n) => n.id);
      if (ids.length === 0) return;
      try {
        await removeCachedNotifications(ids);
        await enqueueNotificationDelete(ids);
        onUnreadChanged?.();
        notify(
          ids.length === 1 ? "Notification deleted." : `Deleted ${ids.length} notifications.`,
        );
      } catch (err) {
        console.error(err);
        notify(messageFromError(err, "Couldn't delete that."), "error");
      }
    },
    [notify, onUnreadChanged],
  );

  // --- The two group verbs, over the current selection ----------------------

  // The selection SURVIVES this one. Marking is not destructive and the rows
  // are all still there, so dropping the picks made the button feel like it had
  // done something more than it had — and left the obvious follow-up (mark
  // these, now delete them) needing the whole selection built again. Delete
  // still clears, because those rows are gone.
  const applyReadAction = useCallback(() => {
    if (!readAction) return;
    void (async () => {
      await setRead(readAction.ids, readAction.read);
      notify(readAction.success);
    })();
  }, [notify, readAction, setRead]);

  const deleteSelected = useCallback(() => {
    const targets = selectedNotifications;
    const count = targets.length;
    Alert.alert(
      count === 1 ? "Delete this notification?" : `Delete ${count} notifications?`,
      count === 1
        ? "It goes from every device on your account. This can't be undone."
        : "They go from every device on your account. This can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void (async () => {
              await deleteNotifications(targets);
              clearSelection();
            })();
          },
        },
      ],
    );
  }, [clearSelection, deleteNotifications, selectedNotifications]);

  const markAll = useCallback(async () => {
    const unreadIds = notifications.filter((n) => !n.read).map((n) => n.id);
    try {
      await patchCachedRead("all");
      await enqueueNotificationRead(unreadIds);
      onUnreadChanged?.();
    } catch (err) {
      console.error(err);
      notify(messageFromError(err, "Couldn't mark those as read."), "error");
    }
  }, [notifications, notify, onUnreadChanged]);

  /**
   * Answer a notification's question, then let the refetch settle the row.
   *
   * Which call runs is the descriptor's `type`; nothing here knows what a
   * friendship or a send IS beyond the id to pass. Only a file accept leaves
   * the notification alive (as the "Download again" retry — the download URL
   * is issued before the bytes land); the other three are purged server-side,
   * so the row is hidden the moment the call succeeds.
   *
   * `silent` is for a batch run, which answers eight rows through this same
   * path: eight toasts and eight refetches for one tap is noise, and the
   * partial-run sentence can only be written once the whole queue has finished
   * (`batchFileAction.ts`). It suppresses the REPORTING, never the cache
   * patching or the read state — those are per row and must still happen — and
   * it re-throws so the queue can count the failure.
   */
  const runAction = useCallback(
    async (
      n: TNotification,
      target: NotificationActions,
      action: NotificationInlineAction,
      { silent = false }: { silent?: boolean } = {},
    ) => {
      setBusy({ id: n.id, kind: action.kind });
      const survives = target.type === "file_sent" && action.kind === "accept";
      const clear = () => setActionedIds((prev) => new Set([...prev, n.id]));
      try {
        if (target.type === "friend_request") {
          await (action.kind === "accept" ? acceptFriendRequest : declineFriendRequest)(
            target.targetId,
          );
        } else if (action.kind === "accept") {
          await acceptReceivedFile(target.targetId, target.sender);
        } else {
          await declineFileSend(target.targetId);
        }
        if (survives) {
          // Answering a notification IS reading it. Both patches go to the
          // CACHE and there is deliberately no refetch: `GET /notifications` is
          // the authority on `read`, so re-fetching here raced the outbox push
          // and wrote `read: false` straight back over the mark-read. The row
          // now settles in place — same position, "Saved", no longer New.
          await patchCachedPayload(n.id, { fileSendStatus: "accepted" });
          await markRead(n);
        } else {
          // The other three are purged server-side, so there is no row left to
          // mark read — and queueing one for a deleted notification would park
          // a 404 on the sync issues screen. Hiding it drops it out of the
          // unread count immediately, which is the visible half anyway.
          clear();
          onUnreadChanged?.();
          if (!silent) refetch();
        }
        if (!silent) notify(action.success);
      } catch (err) {
        console.error(err);
        if (!silent) notify(messageFromError(err, action.failure), "error");
        if (isResolvedElsewhereError(err)) {
          // Answered somewhere else (the Friends screen, the web, another
          // device), or the send is gone. The buttons are dead rather than
          // retryable, so clear the row like a success would instead of
          // restoring live buttons that will only fail again.
          clear();
          onUnreadChanged?.();
          if (!silent) refetch();
        }
        // A batch run counts what failed and reports once at the end, so the
        // failure has to reach it rather than being swallowed here.
        if (silent) throw err;
      } finally {
        setBusy(null);
      }
    },
    [markRead, notify, onUnreadChanged, refetch],
  );

  /** A destructive action is a dialog first, and the dialog carries the why (§7). */
  const requestAction = useCallback(
    (n: TNotification, target: NotificationActions, action: NotificationInlineAction) => {
      if (!action.confirm) {
        void runAction(n, target, action);
        return;
      }
      Alert.alert(action.confirm.title, action.confirm.body, [
        { text: "Cancel", style: "cancel" },
        {
          text: action.confirm.confirmLabel,
          style: "destructive",
          onPress: () => void runAction(n, target, action),
        },
      ]);
    },
    [runAction],
  );

  // --- Answering a whole batch of sent files --------------------------------
  //
  // The other half of collapsing eight sends into one row: a grouped row that
  // cannot be answered as a group just moves the tedium, and the recipient
  // still opens eight rows and taps sixteen times.
  //
  // It runs through `runAction` per member (silently), so nothing about what an
  // accept IS lives twice — only the queueing, the progress and the one
  // sentence at the end are new.
  const [batchBusy, setBatchBusy] = useState<{
    key: string;
    kind: BatchFileActionKind;
    progress: BatchFileActionProgress;
  } | null>(null);

  const runBatch = useCallback(
    async (batch: NotificationBatch, kind: BatchFileActionKind) => {
      const pending = batchPendingFileSends(batch);
      if (pending.length === 0) return;
      setBatchBusy({ key: batch.key, kind, progress: { done: 0, total: pending.length } });
      try {
        const result = await runBatchFileAction({
          items: pending,
          onProgress: (progress) =>
            setBatchBusy((prev) => (prev ? { ...prev, progress } : prev)),
          run: async (notification) => {
            const target = notificationActions(notification);
            // No target means the row is not answerable any more (expired, or
            // already taken) — nothing to do, and not a failure either.
            if (!target) return;
            const action = target.actions.find((candidate) => candidate.kind === kind);
            if (!action) return;
            await runAction(notification, target, action, { silent: true });
          },
        });
        const report = batchFileActionMessage({ kind, ...result });
        notify(report.text, report.tone === "error" ? "error" : undefined);
      } finally {
        setBatchBusy(null);
        // ONE refetch for the whole run rather than one per file: the fetch is
        // the authority on what still exists, and declines purge their rows
        // server-side.
        onUnreadChanged?.();
        refetch();
      }
    },
    [notify, onUnreadChanged, refetch, runAction],
  );

  /**
   * Turning a whole batch down confirms; accepting does not.
   *
   * Same asymmetry every single send already has, and for the same reason —
   * a decline cannot be undone and there is no way back but asking the sender
   * again — except that here it is eight files at once, so the dialog says how
   * many rather than which.
   */
  const requestBatchAction = useCallback(
    (batch: NotificationBatch, kind: BatchFileActionKind) => {
      const pending = batchPendingFileSends(batch);
      if (pending.length === 0) return;
      if (kind === "accept") {
        void runBatch(batch, kind);
        return;
      }
      const who = batch.sender ?? "them";
      Alert.alert(
        `Turn down ${pending.length} files?`,
        `You won't get copies of any of them. If you want them, you'd have to ask ${who} to send them again.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Turn down",
            style: "destructive",
            onPress: () => void runBatch(batch, kind),
          },
        ],
      );
    },
    [runBatch],
  );

  // Reading it is what marks it read, so both happen on one tap; the canyon
  // then opens on top.
  const openNotification = useCallback(
    (n: TNotification) => {
      void markRead(n);
      const canyonId = notificationCanyonId(n);
      if (canyonId) onOpenCanyon(canyonId);
    },
    [markRead, onOpenCanyon],
  );

  const openMenu = useCallback((n: TNotification) => setMenuId(n.id), []);

  const renderItem = useCallback(
    ({ item }: { item: TNotification }) => {
      // Three shapes from one component: the HEADER of a batch (a synthetic
      // row standing for the group), a MEMBER of an expanded one (indented,
      // otherwise an ordinary row), and an ordinary row.
      const headerKey = batchKeyFromRowId(item.id);
      const batch = headerKey ? (batches.get(headerKey) ?? null) : null;
      const memberKey = headerKey ? null : batchKeyOf(item);
      return (
        <NotificationRow
          item={item}
          batch={batch}
          expanded={batch != null && expandedBatches.has(batch.key)}
          member={memberKey != null && batches.has(memberKey)}
          onToggleBatch={toggleBatch}
          onBatchAction={requestBatchAction}
          batchBusy={batch != null && batchBusy?.key === batch.key ? batchBusy : null}
          onPress={openNotification}
          onAction={requestAction}
          onMenu={openMenu}
          selecting={selecting}
          selected={selectedKeys.includes(item.id)}
          onToggle={selectItem}
          busyKind={busy?.id === item.id ? busy.kind : null}
          // The row's own accept / decline go inert while a selection is running:
          // a tap meant for a checkbox must not answer a friend request, and the
          // pair stays mounted (dimmed) so the row cannot change height mid-mode.
          // A batch run disables every row's buttons for the same reason it
          // disables the header's: one queue at a time.
          actionsDisabled={busy !== null || batchBusy !== null || !online || selecting}
          online={online}
        />
      );
    },
    [
      batchBusy,
      batches,
      busy,
      expandedBatches,
      online,
      openMenu,
      openNotification,
      requestAction,
      requestBatchAction,
      selectItem,
      selecting,
      selectedKeys,
      toggleBatch,
    ],
  );

  const renderSectionHeader = useCallback(
    ({ section }: { section: { title: string; data: TNotification[] } }) => (
      <View style={styles.dayHeader}>
        <Text style={styles.dayLabel}>{section.title}</Text>
        <Text style={styles.dayCount}>{section.data.length}</Text>
      </View>
    ),
    [],
  );

  const buckets: SegmentOption<Bucket>[] = [
    { value: "all", label: "All", count: searched.length },
    {
      value: "unread",
      label: "Unread",
      count: searchedUnread,
      // A bucket the search has emptied stays in place but is not a tap into a
      // dead end — a rail that reshuffles on every keystroke is worse.
      disabled: searchedUnread === 0 && bucket !== "unread",
    },
    {
      value: "read",
      label: "Read",
      count: searched.length - searchedUnread,
      disabled: searched.length - searchedUnread === 0 && bucket !== "read",
    },
  ];

  // Before the loading branch: with both effects gated off nothing ever
  // resolves, so a guest would sit on a spinner. The hero keeps the back
  // affordance.
  if (guestBlock) {
    return (
      <View style={styles.root}>
        <HeroHeader eyebrow="Inbox" title="Inbox" onBack={onBack} />
        <EmptyState title={guestBlock.title} hint={guestBlock.hint} />
      </View>
    );
  }
  if (query.loading && notifications.length === 0) return <LoadingState />;
  if (query.error && notifications.length === 0) {
    return <ErrorState message={query.error} onRetry={query.refetch} />;
  }

  return (
    <View style={styles.root}>
      <HeroHeader
        eyebrow="Inbox"
        // The answer to "what happened while I was away?" is a NUMBER of things
        // that did (§1). "Something new" was that answer rounded to a boolean —
        // it said the same words for one notification and for forty, and read as
        // a marketing line rather than a count. The tally below it stays the
        // whole inbox, so the two lines never restate each other.
        title={
          unreadCount > 0
            ? `${unreadCount} unread`
            : notifications.length > 0
              ? "All caught up"
              : "Nothing yet"
        }
        onBack={onBack}
        value={String(notifications.length)}
        valueSuffix={notifications.length === 1 ? "notification" : "notifications"}
        action={
          unreadCount > 0 ? (
            <Button
              label="Mark all read"
              variant="outlineAccent"
              compact
              onPress={() => void markAll()}
            />
          ) : undefined
        }
      />

      {/* The bulk bar takes the SegmentedControl's slot and only that slot, so
          the rail's height cannot change when a selection starts (§7). */}
      {notifications.length > 0 ? (
        <View style={styles.rail}>
          {selecting && readAction ? (
            <SelectionBar
              countLabel={selectionCountLabel(selectedNotifications)}
              showSelectAll={selectedItems.length < selectableItems.length}
              // ONE read/unread button, not a pair: which way it goes follows the
              // selection (all read → unread, anything unread → read), and the
              // bar's count line states the unread tally so the direction can be
              // read off the screen rather than remembered.
              extra={
                <IconButton
                  icon={readAction.icon}
                  accessibilityLabel={readAction.label}
                  color={theme.accent}
                  onPress={applyReadAction}
                />
              }
              onClear={clearSelection}
              onSelectAll={selectAll}
              onDelete={deleteSelected}
            />
          ) : (
            <SegmentedControl options={buckets} value={bucket} onChange={changeBucket} scroll />
          )}
          {/* The name search, in the SAME place in both states so the rail's
              height cannot differ between them (§7). It goes inert rather than
              unmounting while picking — a keystroke could narrow a selected row
              out of the list — and dims to say so, the treatment Saved's field
              and the waypoint tag rail already use. */}
          <View style={styles.searchField}>
            <TextField
              label="Search notifications"
              value={search}
              onChangeText={setSearch}
              editable={!selecting}
            />
          </View>
        </View>
      ) : null}

      <SectionList
        style={styles.list}
        contentContainerStyle={styles.listContent}
        sections={sections}
        keyExtractor={keyExtractor}
        initialNumToRender={12}
        maxToRenderPerBatch={8}
        windowSize={5}
        removeClippedSubviews
        refreshControl={
          <RefreshControl refreshing={false} onRefresh={query.refetch} tintColor={theme.accent} />
        }
        renderSectionHeader={renderSectionHeader}
        renderItem={renderItem}
        ListEmptyComponent={
          <EmptyPanel
            bucket={bucket}
            searching={needle !== ""}
            onShowAll={() => {
              setSearch("");
              setBucket("all");
            }}
          />
        }
        ListFooterComponent={
          truncated ? (
            <Text style={styles.truncation}>
              {`Showing the ${query.notifications.length} most recent of ${query.total}. Older ones aren't listed.`}
            </Text>
          ) : null
        }
      />

      {/* Per-row verbs. Looked up from the live list, so a refetch that drops
          or restyles the row cannot leave the sheet acting on a stale copy. */}
      <NotificationOptionsSheet
        notification={notifications.find((n) => n.id === menuId) ?? null}
        visible={menuId !== null}
        onClose={() => setMenuId(null)}
        onOpen={openNotification}
        onSetRead={(n, read) => void setRead([n.id], read)}
        onDelete={(n) => void deleteNotifications([n])}
      />

      <Toast message={toast} onDismissed={() => setToast(null)} />
    </View>
  );
}

function keyExtractor(item: TNotification): string {
  return item.id;
}

// Memoised, with a callback that takes the item rather than closing over it —
// §9, the whole reason the Logs list stopped re-rendering every mounted cell.
const NotificationRow = memo(function NotificationRow({
  item,
  batch,
  expanded,
  member,
  onToggleBatch,
  onBatchAction,
  batchBusy,
  onPress,
  onAction,
  onMenu,
  selecting,
  selected,
  onToggle,
  busyKind,
  actionsDisabled,
  online,
}: {
  item: TNotification;
  /**
   * Non-null when this row IS a batch — it stands for every notification one
   * bulk share created, and wears the batch's words instead of its own.
   */
  batch: NotificationBatch | null;
  expanded: boolean;
  /** This row is one of an expanded batch's members: indented, otherwise itself. */
  member: boolean;
  onToggleBatch: (key: string) => void;
  onBatchAction: (batch: NotificationBatch, kind: BatchFileActionKind) => void;
  /** This batch's run, while one is going. */
  batchBusy: { kind: BatchFileActionKind; progress: BatchFileActionProgress } | null;
  onPress: (item: TNotification) => void;
  onAction: (
    item: TNotification,
    target: NotificationActions,
    action: NotificationInlineAction,
  ) => void;
  /** Open this row's ⋯ sheet. */
  onMenu: (item: TNotification) => void;
  /** A selection is running somewhere in the list. */
  selecting: boolean;
  selected: boolean;
  onToggle: (item: TNotification) => void;
  /** Which of this row's actions is in flight, if any. */
  busyKind: NotificationActionKind | null;
  /** Any action anywhere in the list is running, or there is no connection. */
  actionsDisabled: boolean;
  online: boolean;
}) {
  if (batch) {
    return (
      <BatchRow
        item={item}
        batch={batch}
        expanded={expanded}
        onToggleBatch={onToggleBatch}
        onBatchAction={onBatchAction}
        batchBusy={batchBusy}
        selecting={selecting}
        selected={selected}
        onToggle={onToggle}
        actionsDisabled={actionsDisabled}
        online={online}
      />
    );
  }
  const label = notificationLabel(item);
  const meta = notificationMeta(item);
  const target = notificationActions(item);
  const subtitle = [label.warning, formatTime(item.createdAt)].filter(Boolean).join(" · ");
  // The row's own STATE beats the unread flag in the one trailing slot: unread
  // is already carried by the accent EDGE, "Saved" is carried by nothing else.
  const pill = target?.pill
    ? <StatusPill label={target.pill} tone="muted" />
    : !item.read
      ? <StatusPill label="New" tone="accent" />
      : undefined;
  return (
    <Row
      icon={meta.icon}
      hue={meta.hue}
      title={label.text}
      subtitle={subtitle}
      titleNumberOfLines={2}
      right={
        <View style={styles.rowTrailing}>
          {pill}
          {selecting ? (
            // Exactly the ⋯ button's box, so the row cannot resize when a
            // selection starts.
            <View style={styles.selectBox}>
              <Feather
                name={selected ? "check-circle" : "circle"}
                size={22}
                color={selected ? theme.accent : theme.textMuted}
              />
            </View>
          ) : (
            <IconButton
              icon="more-vertical"
              accessibilityLabel="Notification actions"
              onPress={() => onMenu(item)}
            />
          )}
        </View>
      }
      selected={selected}
      onPress={() => (selecting ? onToggle(item) : onPress(item))}
      onLongPress={() => onToggle(item)}
      // EVERY row carries the 3pt left edge; only its COLOUR says unread. The
      // width is deliberately constant: a row whose border width changed as it
      // was marked read rendered as an empty card — frame, no content — until
      // something else forced it to redraw (Fabric on Android re-derives the
      // clip bounds of a rounded, `overflow: hidden` card from its border box,
      // and drops the children when it does). Colour changes are free; widths
      // are not. A selected row lights the edge too, so it never looks like the
      // selection has un-marked it.
      // A member of an expanded batch is INDENTED, so the header above it reads
      // as what the indented rows belong to. Under unread-first sorting the
      // members were pulled out of wherever they had drifted to and re-inserted
      // beneath the header (`collapseBatches`), and without the indent there is
      // nothing on screen saying that is what happened.
      style={[
        !item.read || selected ? styles.rowEdgeAccent : styles.rowEdgeIdle,
        ...(member ? [styles.batchMember] : []),
      ]}
      // INSIDE the card. Sitting below it, the pair read as a caption for the
      // next notification down — which is how a "Download again" got pressed
      // for a file the user had just turned down.
      footer={
        target ? (
          <>
            <View style={styles.actions}>
              {target.actions.map((action) => (
                <Button
                  key={action.kind}
                  label={action.label}
                  // Decline is the outline: two filled buttons side by side
                  // make "no" look like the thing to press.
                  variant={action.kind === "decline" ? "outlineAccent" : undefined}
                  compact
                  // Split the card's width rather than shrink-wrapping the
                  // label: a full-width target is the one that survives being
                  // tapped with cold hands, and it belongs to the card it fills.
                  grow
                  disabled={actionsDisabled}
                  loading={busyKind === action.kind}
                  onPress={() => onAction(item, target, action)}
                />
              ))}
            </View>
            {/* The reason on the thing that is dimmed, not on the screen (§10). */}
            {!online ? <Text style={styles.actionHint}>Needs a connection</Text> : null}
          </>
        ) : null
      }
    />
  );
});

/**
 * The header of a collapsed bulk share — "bob sent you 8 files" — with the
 * whole batch's answer under it.
 *
 * IT EXPANDS IN PLACE rather than opening a page of its own. The per-file rows
 * already exist, complete with their own accept/decline, their "Saved" pill and
 * their expired-with-a-reason state; a separate screen would have to
 * re-implement all of that, and would then have to answer "what does the header
 * say now?" for a batch where three are saved, two turned down and three still
 * waiting. Expanded rows just show it.
 *
 * NO ⋯ MENU. That sheet's verbs (mark read, delete) act on one notification,
 * and offering them from a row that stands for twelve would mean either a lie
 * or a second set of copy. The bulk bar already does both over a selection, and
 * a picked header selects as its whole batch.
 */
const BatchRow = memo(function BatchRow({
  item,
  batch,
  expanded,
  onToggleBatch,
  onBatchAction,
  batchBusy,
  selecting,
  selected,
  onToggle,
  actionsDisabled,
  online,
}: {
  /** The SYNTHETIC header row — what the list and the selection key on. */
  item: TNotification;
  batch: NotificationBatch;
  expanded: boolean;
  onToggleBatch: (key: string) => void;
  onBatchAction: (batch: NotificationBatch, kind: BatchFileActionKind) => void;
  batchBusy: { kind: BatchFileActionKind; progress: BatchFileActionProgress } | null;
  selecting: boolean;
  selected: boolean;
  onToggle: (item: TNotification) => void;
  actionsDisabled: boolean;
  online: boolean;
}) {
  const meta = notificationMeta(batch.representative);
  const pending = batchPendingFileSends(batch);
  const subtitle = [
    batch.unreadCount > 0 ? `${batch.unreadCount} unread` : null,
    // Named, because a batch of files whose members are partly answered is
    // otherwise a row whose buttons act on a number the user cannot see.
    batch.group === "files" && pending.length !== batch.items.length
      ? `${pending.length} still to answer`
      : null,
    formatTime(batch.representative.createdAt),
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Row
      icon={meta.icon}
      hue={meta.hue}
      title={batchLabel(batch)}
      subtitle={subtitle}
      titleNumberOfLines={2}
      right={
        <View style={styles.rowTrailing}>
          {batch.unreadCount > 0 ? <StatusPill label="New" tone="accent" /> : undefined}
          {selecting ? (
            <View style={styles.selectBox}>
              <Feather
                name={selected ? "check-circle" : "circle"}
                size={22}
                color={selected ? theme.accent : theme.textMuted}
              />
            </View>
          ) : (
            <IconButton
              icon={expanded ? "chevron-up" : "chevron-down"}
              accessibilityLabel={expanded ? "Collapse this group" : "Show each one"}
              onPress={() => onToggleBatch(batch.key)}
            />
          )}
        </View>
      }
      selected={selected}
      onPress={() =>
        selecting ? onToggle(item) : onToggleBatch(batch.key)
      }
      onLongPress={() => onToggle(item)}
      style={batch.unreadCount > 0 || selected ? styles.rowEdgeAccent : styles.rowEdgeIdle}
      footer={
        // Shares have nothing to answer — a grant simply IS — so only a batch of
        // sent files gets buttons, and only while some are still unanswered.
        batch.group === "files" && pending.length > 0 ? (
          <>
            <View style={styles.actions}>
              {/* THE COUNT IS THE PROGRESS INDICATOR, so neither of these
                  passes `loading`: `Button` swaps the whole label out for a
                  spinner, which threw away the one thing worth showing — a
                  batch accept is a download queue, and "Saving 2 of 3" is the
                  difference between waiting and wondering whether it hung.
                  `actionsDisabled` covers the run, so the pair still dims and
                  refuses taps. */}
              <Button
                label={
                  batchBusy?.kind === "accept"
                    ? `Saving ${batchBusy.progress.done + 1} of ${batchBusy.progress.total}`
                    : `Save all ${pending.length}`
                }
                compact
                grow
                disabled={actionsDisabled}
                onPress={() => onBatchAction(batch, "accept")}
              />
              <Button
                label={batchBusy?.kind === "decline" ? "Turning down…" : "Turn all down"}
                variant="outlineAccent"
                compact
                grow
                disabled={actionsDisabled}
                onPress={() => onBatchAction(batch, "decline")}
              />
            </View>
            {/* Accepting a batch is a DOWNLOAD QUEUE — each one presigns, pulls
                the bytes and runs the import — so the row says so rather than
                spinning silently for a minute on trail signal. */}
            {!online ? <Text style={styles.actionHint}>Needs a connection</Text> : null}
          </>
        ) : null
      }
    />
  );
});

/** Per-bucket, and actionable where there is an action (§8). */
function EmptyPanel({
  bucket,
  searching,
  onShowAll,
}: {
  bucket: Bucket;
  /** Emptied by the search rather than by the bucket — a different problem
   *  with a different way out, so it gets its own panel. */
  searching: boolean;
  onShowAll: () => void;
}) {
  if (searching) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>Nothing matches</Text>
        <Text style={styles.emptyHint}>
          The search runs over what a row says — a name, a canyon, a filename.
        </Text>
        <Button label="Clear search" variant="ghost" onPress={onShowAll} />
      </View>
    );
  }
  if (bucket === "unread") {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>Nothing unread</Text>
        <Button label="Show everything" variant="ghost" onPress={onShowAll} />
      </View>
    );
  }
  if (bucket === "read") {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>Nothing read yet</Text>
        <Button label="Show everything" variant="ghost" onPress={onShowAll} />
      </View>
    );
  }
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>No notifications</Text>
      <Text style={styles.emptyHint}>
        Shares, friend requests and finished maps appear here.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.primary },
  rail: { paddingHorizontal: spacing(2), paddingTop: spacing(1.5), paddingBottom: spacing(1.5) },
  list: { flex: 1 },
  listContent: { paddingHorizontal: spacing(2), gap: spacing(1), paddingBottom: spacing(4) },
  // The page colour, so rows don't ghost through the sticky header.
  dayHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: theme.primary,
    paddingVertical: spacing(0.75),
  },
  dayLabel: {
    color: theme.textMuted,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  dayCount: { color: theme.textMuted, fontSize: fontSize.xs },
  // The field carries its own right pad because the rail has none — the bucket
  // chips are meant to scroll off the edge; an input running into it just looks
  // clipped. Same treatment as Saved's search.
  searchField: { paddingTop: spacing(1.5), paddingRight: spacing(2) },
  truncation: {
    color: theme.textMuted,
    fontSize: fontSize.xs,
    textAlign: "center",
    paddingTop: spacing(1.5),
  },
  // Unread is an accent EDGE, not an accent border all round — that border is
  // `Row`'s `selected` treatment, and while a multi-select is running the two
  // states were drawn the same way on the same card. A left edge reads as a
  // property of the row (and survives a row that is BOTH unread and picked,
  // which is most of them), the way an unread marker does in any inbox. Both
  // states declare the same WIDTH — see the note at the call site.
  rowEdgeAccent: { borderLeftWidth: 3, borderLeftColor: theme.accent },
  rowEdgeIdle: { borderLeftWidth: 3, borderLeftColor: surface.border },
  // One step in, so an expanded batch's rows read as belonging to the header
  // above them. Margin, never a border width change — the row's left edge is
  // 3pt in EVERY state for the Fabric clip-bounds reason at `rowEdgeIdle`.
  batchMember: { marginLeft: spacing(2) },
  rowTrailing: { flexDirection: "row", alignItems: "center", gap: spacing(0.75) },
  // `IconButton`'s own box, so the checkbox standing in for ⋯ occupies exactly
  // what it replaced.
  selectBox: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  actions: { flexDirection: "row", gap: spacing(1) },
  actionHint: {
    color: theme.textMuted,
    fontSize: fontSize.xs,
    textAlign: "center",
    paddingTop: spacing(0.75),
  },
  empty: { alignItems: "center", gap: spacing(1), paddingVertical: spacing(6) },
  emptyTitle: { color: theme.textPrimary, fontSize: fontSize.base },
  emptyHint: {
    color: theme.textMuted,
    fontSize: fontSize.sm,
    textAlign: "center",
    paddingHorizontal: spacing(2),
  },
});
