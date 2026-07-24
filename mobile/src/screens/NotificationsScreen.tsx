// Notifications inbox — read + mark-seen (Stage 1 scope; actions like
// accept/decline arrive with their write surfaces in later stages).
// Cache-first (§4.7): the last fetch is cached so the inbox reads offline;
// a live fetch refreshes it. Mark-read is online-only (fails gracefully
// offline) but patches the cache optimistically so the read state sticks.
import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { messageFromError } from "@logjam/shared";

import { markAllNotificationsRead, markNotificationRead } from "../api/queries";
import type { TNotification } from "../api/types";
import { fontSize, radius, spacing, theme } from "../theme";
import {
  fetchAndCacheNotifications,
  patchCachedRead,
  readNotificationsCache,
} from "../sync/notificationsCache";
import { onMirrorChanged } from "../sync/syncDb";
import { Button } from "../ui/Button";
import { EmptyState, ErrorState, LoadingState } from "../ui/ScreenStates";
import { ErrorBanner } from "../ui/ErrorBanner";
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

  const handleMarkRead = async (n: TNotification) => {
    if (n.read) return;
    setActionError(null);
    // Optimistic: patch the cache first so the read state sticks even if the
    // network call fails.
    await patchCachedRead([n.id]);
    onUnreadChanged?.();
    try {
      await markNotificationRead(n.id);
    } catch (err) {
      console.error(err);
      setActionError(messageFromError(err, "Couldn't mark notification as read."));
    }
  };

  const handleMarkAll = async () => {
    setActionError(null);
    await patchCachedRead("all");
    onUnreadChanged?.();
    try {
      await markAllNotificationsRead();
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
        return (
          <Pressable
            accessibilityRole="button"
            onPress={() => handleMarkRead(item)}
            style={({ pressed }) => [
              styles.row,
              !item.read && styles.rowUnread,
              pressed && styles.rowPressed,
            ]}
          >
            <View style={styles.rowMain}>
              <Text style={styles.rowText}>{label.text}</Text>
              {label.warning ? <Text style={styles.rowWarning}>{label.warning}</Text> : null}
              <Text style={styles.rowTime}>{formatTimestamp(item.createdAt)}</Text>
            </View>
            {!item.read ? <View style={styles.unreadDot} /> : null}
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: theme.primary },
  listContent: { padding: spacing(2), gap: spacing(1) },
  header: { gap: spacing(1), paddingBottom: spacing(1) },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: radius.md,
    padding: spacing(1.5),
    gap: spacing(1),
  },
  rowUnread: { borderColor: theme.accent },
  rowPressed: { backgroundColor: "rgba(255,255,255,0.08)" },
  rowMain: { flex: 1, gap: spacing(0.25) },
  rowText: { color: theme.textPrimary, fontSize: fontSize.sm },
  rowWarning: { color: theme.warning, fontSize: fontSize.xs },
  rowTime: { color: theme.textMuted, fontSize: fontSize.xs },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.accent,
  },
});
