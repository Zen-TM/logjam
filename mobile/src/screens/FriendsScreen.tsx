// Friends management (Stage 8): incoming requests (accept/decline), the friend
// list (remove), and username search to send new requests. Online-only —
// managing friendships is never a field use case (the mirror handles the
// offline propagation of the resulting shares/tombstones). Username-only
// throughout, mirroring the server.
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { messageFromError } from "@logjam/shared";

import {
  acceptFriendRequest,
  declineFriendRequest,
  getFriendRequests,
  getFriends,
  removeFriend,
  searchUsers,
  sendFriendRequest,
  type Friend,
  type FriendRequest,
  type UserSearchResult,
} from "../api/friends";
import { fontSize, radius, spacing, theme } from "../theme";
import { ErrorBanner } from "../ui/ErrorBanner";
import { ErrorState, LoadingState } from "../ui/ScreenStates";

const SEARCH_MIN_CHARS = 3;

export function FriendsScreen() {
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [nextFriends, nextRequests] = await Promise.all([
        getFriends(),
        getFriendRequests(),
      ]);
      setFriends(nextFriends);
      setRequests(nextRequests);
      setLoadError(null);
    } catch (err) {
      console.error(err);
      // Only surface a full-screen error when nothing has loaded yet; a later
      // refresh failure keeps the last-good lists on screen.
      if (friends === null) setLoadError(messageFromError(err, "Couldn't load friends."));
    }
  }, [friends]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const runAction = useCallback(
    async (id: string, action: () => Promise<unknown>, fallback: string) => {
      setBusyId(id);
      setActionError(null);
      try {
        await action();
        await load();
      } catch (err) {
        console.error(err);
        setActionError(messageFromError(err, fallback));
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  const confirmRemove = useCallback(
    (friend: Friend) => {
      Alert.alert(
        `Remove ${friend.username}?`,
        "This also revokes every canyon shared between you, both directions.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Remove",
            style: "destructive",
            onPress: () =>
              void runAction(
                friend.friendshipId,
                () => removeFriend(friend.friendshipId),
                "Couldn't remove friend.",
              ),
          },
        ],
      );
    },
    [runAction],
  );

  if (friends === null && loadError) {
    return <ErrorState message={loadError} onRetry={() => void load()} />;
  }
  if (friends === null) return <LoadingState />;

  return (
    <FlatList
      style={styles.root}
      contentContainerStyle={styles.content}
      data={friends}
      keyExtractor={(item) => item.friendshipId}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} />
      }
      ListHeaderComponent={
        <View style={styles.header}>
          {actionError ? <ErrorBanner message={actionError} /> : null}

          <AddFriendSection
            existingIds={friends.map((f) => f.id)}
            onSent={() => void load()}
          />

          {requests.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Requests</Text>
              {requests.map((request) => (
                <View key={request.id} style={styles.row}>
                  <Text style={styles.username}>{request.requester.username}</Text>
                  {busyId === request.id ? (
                    <ActivityIndicator color={theme.accent} />
                  ) : (
                    <View style={styles.rowActions}>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() =>
                          void runAction(
                            request.id,
                            () => acceptFriendRequest(request.id),
                            "Couldn't accept request.",
                          )
                        }
                        style={({ pressed }) => [styles.pill, pressed && styles.pillPressed]}
                      >
                        <Text style={styles.pillText}>Accept</Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() =>
                          void runAction(
                            request.id,
                            () => declineFriendRequest(request.id),
                            "Couldn't decline request.",
                          )
                        }
                        style={({ pressed }) => [styles.pillGhost, pressed && styles.pillPressed]}
                      >
                        <Text style={styles.pillGhostText}>Decline</Text>
                      </Pressable>
                    </View>
                  )}
                </View>
              ))}
            </View>
          ) : null}

          <Text style={styles.sectionLabel}>Friends</Text>
          {friends.length === 0 ? (
            <Text style={styles.emptyHint}>
              No friends yet. Search above to send a request.
            </Text>
          ) : null}
        </View>
      }
      renderItem={({ item }) => (
        <View style={styles.row}>
          <Text style={styles.username}>{item.username}</Text>
          {busyId === item.friendshipId ? (
            <ActivityIndicator color={theme.accent} />
          ) : (
            <Pressable
              accessibilityRole="button"
              onPress={() => confirmRemove(item)}
              style={({ pressed }) => [styles.pillGhost, pressed && styles.pillPressed]}
            >
              <Text style={styles.removeText}>Remove</Text>
            </Pressable>
          )}
        </View>
      )}
    />
  );
}

// Username search → send request. Requests already-friend/pending targets are
// rejected server-side (409); the error surfaces in the banner. Sent targets
// are locally marked so the button reflects the pending state without a reload.
function AddFriendSection({
  existingIds,
  onSent,
}: {
  existingIds: string[];
  onSent: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [sentIds, setSentIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < SEARCH_MIN_CHARS) {
      setResults([]);
      setError(null);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      searchUsers(trimmed)
        .then((users) => {
          if (!cancelled) {
            setResults(users);
            setError(null);
          }
        })
        .catch((err: unknown) => {
          if (!cancelled) setError(messageFromError(err, "Search failed."));
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const send = useCallback(
    async (user: UserSearchResult) => {
      setError(null);
      try {
        await sendFriendRequest(user.id);
        setSentIds((prev) => [...prev, user.id]);
        onSent();
      } catch (err) {
        setError(messageFromError(err, "Couldn't send request."));
      }
    },
    [onSent],
  );

  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>Add a friend</Text>
      <TextInput
        style={styles.input}
        value={query}
        onChangeText={setQuery}
        placeholder="Search by username"
        placeholderTextColor={theme.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
      />
      {error ? <ErrorBanner message={error} /> : null}
      {searching ? <ActivityIndicator color={theme.accent} style={styles.searchSpinner} /> : null}
      {results.map((user) => {
        const alreadyFriend = existingIds.includes(user.id);
        const sent = sentIds.includes(user.id);
        return (
          <View key={user.id} style={styles.row}>
            <Text style={styles.username}>{user.username}</Text>
            {alreadyFriend ? (
              <Text style={styles.mutedTag}>Friend</Text>
            ) : sent ? (
              <Text style={styles.mutedTag}>Requested</Text>
            ) : (
              <Pressable
                accessibilityRole="button"
                onPress={() => void send(user)}
                style={({ pressed }) => [styles.pill, pressed && styles.pillPressed]}
              >
                <Text style={styles.pillText}>Add</Text>
              </Pressable>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.primary },
  content: { padding: spacing(2), gap: spacing(1) },
  header: { gap: spacing(2) },
  section: { gap: spacing(1) },
  sectionLabel: {
    fontSize: fontSize.xs,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    color: theme.textMuted,
  },
  emptyHint: { fontSize: fontSize.sm, color: theme.textMuted },
  input: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: radius.md,
    paddingHorizontal: spacing(1.5),
    paddingVertical: spacing(1.25),
    color: theme.textPrimary,
    fontSize: fontSize.base,
  },
  searchSpinner: { alignSelf: "flex-start" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: radius.md,
    padding: spacing(1.5),
    gap: spacing(1),
    marginBottom: spacing(1),
  },
  username: { flex: 1, color: theme.textPrimary, fontSize: fontSize.base },
  rowActions: { flexDirection: "row", gap: spacing(1) },
  pill: {
    backgroundColor: theme.accent,
    borderRadius: radius.sm,
    paddingHorizontal: spacing(1.5),
    paddingVertical: spacing(0.75),
  },
  pillPressed: { opacity: 0.75 },
  pillText: { color: theme.primary, fontSize: fontSize.sm, fontWeight: "700" },
  pillGhost: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    borderRadius: radius.sm,
    paddingHorizontal: spacing(1.5),
    paddingVertical: spacing(0.75),
  },
  pillGhostText: { color: theme.textPrimary, fontSize: fontSize.sm, fontWeight: "600" },
  removeText: { color: theme.warning, fontSize: fontSize.sm, fontWeight: "600" },
  mutedTag: { color: theme.textMuted, fontSize: fontSize.sm },
});
