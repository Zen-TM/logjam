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
// PRIVACY: rows show the server-resolved label (which may include a canyon NAME —
// user-supplied text, allowed) and a timestamp. Never a coordinate. Tapping
// through passes an opaque id and the detail screen fetches over the authed API,
// so a share revoked since the notification lands on the 404-not-403 path.
import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshControl, SectionList, StyleSheet, Text, View } from "react-native";
import { messageFromError } from "@logjam/shared";

import type { TNotification } from "../api/types";
import { fontSize, fontWeight, spacing, theme } from "../theme";
import { enqueueNotificationRead } from "../sync/outbox";
import {
  fetchAndCacheNotifications,
  patchCachedRead,
  readNotificationsCache,
} from "../sync/notificationsCache";
import { onMirrorChanged } from "../sync/syncDb";
import {
  Button,
  ErrorBanner,
  ErrorState,
  HeroHeader,
  LoadingState,
  Row,
  SegmentedControl,
  StatusPill,
  type SegmentOption,
} from "../ui";
import {
  groupNotificationsByDay,
  notificationCanyonId,
  notificationLabel,
  notificationMeta,
} from "./notificationLabel";

type NotificationsState = {
  notifications: TNotification[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
};

// Cache-first inbox load: render the cache immediately, then live-fetch. A
// failed fetch with a populated cache is silent (offline); only an empty
// cache surfaces the error.
function useNotifications(): NotificationsState {
  const [notifications, setNotifications] = useState<TNotification[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fetchCount, setFetchCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cache = await readNotificationsCache().catch(() => null);
      if (!cancelled && cache) setNotifications(cache.notifications);
      try {
        const fresh = await fetchAndCacheNotifications();
        if (!cancelled) {
          setNotifications(fresh.notifications);
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
  }, [fetchCount]);

  // markRead patches the cache and fires notifyMirrorChanged; re-read it.
  useEffect(() => {
    const unsubscribe = onMirrorChanged(() => {
      readNotificationsCache()
        .then((cache) => cache && setNotifications(cache.notifications))
        .catch(() => {});
    });
    return unsubscribe;
  }, []);

  const refetch = useCallback(() => setFetchCount((n) => n + 1), []);
  return {
    notifications: notifications ?? [],
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

export function NotificationsScreen({
  onBack,
  onUnreadChanged,
  onOpenCanyon,
}: {
  onBack: () => void;
  onUnreadChanged?: () => void;
  onOpenCanyon: (canyonId: string) => void;
}) {
  const query = useNotifications();
  const [actionError, setActionError] = useState<string | null>(null);
  const [bucket, setBucket] = useState<Bucket>("all");
  const notifications = query.notifications;

  const unreadCount = notifications.filter((n) => !n.read).length;
  const readCount = notifications.length - unreadCount;

  const visible = useMemo(
    () =>
      bucket === "all"
        ? notifications
        : notifications.filter((n) => (bucket === "unread" ? !n.read : n.read)),
    [bucket, notifications],
  );
  const sections = useMemo(() => groupNotificationsByDay(visible), [visible]);

  const markRead = useCallback(
    async (n: TNotification) => {
      if (n.read) return;
      setActionError(null);
      try {
        await patchCachedRead([n.id]);
        await enqueueNotificationRead([n.id]);
        onUnreadChanged?.();
      } catch (err) {
        console.error(err);
        setActionError(messageFromError(err, "Couldn't mark that as read."));
      }
    },
    [onUnreadChanged],
  );

  const markAll = useCallback(async () => {
    setActionError(null);
    const unreadIds = notifications.filter((n) => !n.read).map((n) => n.id);
    try {
      await patchCachedRead("all");
      await enqueueNotificationRead(unreadIds);
      onUnreadChanged?.();
    } catch (err) {
      console.error(err);
      setActionError(messageFromError(err, "Couldn't mark those as read."));
    }
  }, [notifications, onUnreadChanged]);

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

  const renderItem = useCallback(
    ({ item }: { item: TNotification }) => (
      <NotificationRow item={item} onPress={openNotification} />
    ),
    [openNotification],
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
    { value: "all", label: "All", count: notifications.length },
    { value: "unread", label: "Unread", count: unreadCount, disabled: unreadCount === 0 },
    { value: "read", label: "Read", count: readCount, disabled: readCount === 0 },
  ];

  if (query.loading && notifications.length === 0) return <LoadingState />;
  if (query.error && notifications.length === 0) {
    return <ErrorState message={query.error} onRetry={query.refetch} />;
  }

  return (
    <View style={styles.root}>
      <HeroHeader
        eyebrow="Inbox"
        title={unreadCount > 0 ? "Something new" : "All caught up"}
        onBack={onBack}
        value={unreadCount > 0 ? String(unreadCount) : String(notifications.length)}
        valueSuffix={unreadCount > 0 ? "unread" : "read"}
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

      {notifications.length > 0 ? (
        <View style={styles.rail}>
          <SegmentedControl options={buckets} value={bucket} onChange={setBucket} scroll />
        </View>
      ) : null}

      {actionError ? (
        <View style={styles.banner}>
          <ErrorBanner message={actionError} />
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
        ListEmptyComponent={<EmptyPanel bucket={bucket} onShowAll={() => setBucket("all")} />}
      />
    </View>
  );
}

function keyExtractor(item: TNotification): string {
  return item.id;
}

// Memoised, with a callback that takes the item rather than closing over it —
// §9, the whole reason the Logs list stopped re-rendering every mounted cell.
const NotificationRow = ({
  item,
  onPress,
}: {
  item: TNotification;
  onPress: (item: TNotification) => void;
}) => {
  const label = notificationLabel(item);
  const meta = notificationMeta(item);
  const subtitle = [label.warning, formatTime(item.createdAt)].filter(Boolean).join(" · ");
  return (
    <Row
      icon={meta.icon}
      hue={meta.hue}
      title={label.text}
      subtitle={subtitle}
      titleNumberOfLines={2}
      right={!item.read ? <StatusPill label="New" tone="accent" /> : undefined}
      onPress={() => onPress(item)}
      style={!item.read ? styles.rowUnread : undefined}
    />
  );
};

/** Per-bucket, and actionable where there is an action (§8). */
function EmptyPanel({
  bucket,
  onShowAll,
}: {
  bucket: Bucket;
  onShowAll: () => void;
}) {
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
        Shares, friend requests and finished map jobs land here.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.primary },
  rail: { paddingHorizontal: spacing(2), paddingTop: spacing(1.5), paddingBottom: spacing(1.5) },
  banner: { paddingHorizontal: spacing(2), paddingBottom: spacing(1) },
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
  rowUnread: { borderColor: theme.accent },
  empty: { alignItems: "center", gap: spacing(1), paddingVertical: spacing(6) },
  emptyTitle: { color: theme.textPrimary, fontSize: fontSize.base },
  emptyHint: {
    color: theme.textMuted,
    fontSize: fontSize.sm,
    textAlign: "center",
    paddingHorizontal: spacing(2),
  },
});
