// Notifications inbox — read + mark-seen (Stage 1 scope; actions like
// accept/decline arrive with their write surfaces in later stages).
// Cache-first (§4.7): the last fetch is cached so the inbox reads offline;
// a live fetch refreshes it. Mark-read is online-only (fails gracefully
// offline) but patches the cache optimistically so the read state sticks.
import { useCallback, useEffect, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { messageFromError } from "@logjam/shared";

import type { TNotification } from "../api/types";
import { spacing, theme } from "../theme";
import { enqueueNotificationRead } from "../sync/outbox";
import {
  fetchAndCacheNotifications,
  patchCachedRead,
  readNotificationsCache,
} from "../sync/notificationsCache";
import { onMirrorChanged } from "../sync/syncDb";
import { Button, EmptyState, ErrorBanner, ErrorState, LoadingState, Row, StatusPill } from "../ui";
import { notificationLabel } from "./notificationLabel";

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

function formatTimestamp(iso: string): string {
  // True timestamp (not date-only) — local timezone is correct here.
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function NotificationsScreen({ onUnreadChanged }: { onUnreadChanged?: () => void }) {
  const query = useNotifications();
  const [actionError, setActionError] = useState<string | null>(null);

  const notifications = query.notifications;
  if (query.loading && notifications.length === 0) return <LoadingState />;
  if (query.error && notifications.length === 0) {
    return <ErrorState message={query.error} onRetry={query.refetch} />;
  }
  if (notifications.length === 0) {
    return <EmptyState title="No notifications" hint="You're all caught up." />;
  }

  const hasUnread = notifications.some((n) => !n.read);

  // Mark-read goes through the outbox (like every other mutation) so it
  // survives offline: patch the cache for an immediate read state, enqueue a
  // markRead op that flushes on the next sync cycle. No REST fallback — the
  // op IS the write path.
  const handleMarkRead = async (n: TNotification) => {
    if (n.read) return;
    setActionError(null);
    try {
      await patchCachedRead([n.id]);
      await enqueueNotificationRead([n.id]);
      onUnreadChanged?.();
    } catch (err) {
      console.error(err);
      setActionError(messageFromError(err, "Couldn't mark notification as read."));
    }
  };

  const handleMarkAll = async () => {
    setActionError(null);
    const unreadIds = notifications.filter((n) => !n.read).map((n) => n.id);
    try {
      await patchCachedRead("all");
      await enqueueNotificationRead(unreadIds);
      onUnreadChanged?.();
    } catch (err) {
      console.error(err);
      setActionError(messageFromError(err, "Couldn't mark notifications as read."));
    }
  };

  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={styles.listContent}
      data={notifications}
      keyExtractor={(item) => item.id}
      refreshControl={
        <RefreshControl
          refreshing={false}
          onRefresh={query.refetch}
          tintColor={theme.accent}
        />
      }
      ListHeaderComponent={
        <View style={styles.header}>
          {actionError ? <ErrorBanner message={actionError} /> : null}
          {hasUnread ? (
            <Button label="Mark all as read" variant="outlineAccent" onPress={handleMarkAll} />
          ) : null}
        </View>
      }
      renderItem={({ item }) => {
        const label = notificationLabel(item);
        const subtitle = [label.warning, formatTimestamp(item.createdAt)]
          .filter(Boolean)
          .join(" · ");
        return (
          <Row
            title={label.text}
            subtitle={subtitle}
            titleNumberOfLines={2}
            leading={
              <Feather
                name="bell"
                size={20}
                color={item.read ? theme.textMuted : theme.accent}
              />
            }
            right={!item.read ? <StatusPill label="New" tone="accent" /> : undefined}
            onPress={() => handleMarkRead(item)}
            style={!item.read ? styles.rowUnread : undefined}
          />
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: theme.primary },
  listContent: { padding: spacing(2), gap: spacing(1) },
  header: { gap: spacing(1), paddingBottom: spacing(1) },
  rowUnread: { borderColor: theme.accent },
});
