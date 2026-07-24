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
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
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
import { fontSize, spacing, theme } from "../theme";
import {
  ErrorBanner,
  ErrorState,
  LoadingState,
  Row,
  SectionHeader,
  StatusPill,
  TextField,
} from "../ui";

const SEARCH_MIN_CHARS = 3;

// Compact pill-style action used for Accept/Decline/Add/Remove — fits the
// trailing slot of a Row without the full Button footprint.
function ActionPill({
  label,
  tone,
  onPress,
}: {
  label: string;
  tone: "accent" | "outline" | "warning";
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} hitSlop={8}>
      <StatusPill label={label} tone={tone} />
    </Pressable>
  );
}

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
              <SectionHeader label="Requests" />
              {requests.map((request) => (
                <Row
                  key={request.id}
                  title={request.requester.username}
                  leading={<Feather name="user" size={20} color={theme.accent} />}
                  right={
                    busyId === request.id ? (
                      <ActivityIndicator color={theme.accent} />
                    ) : (
                      <View style={styles.rowActions}>
                        <ActionPill
                          label="Accept"
                          tone="accent"
                          onPress={() =>
                            void runAction(
                              request.id,
                              () => acceptFriendRequest(request.id),
                              "Couldn't accept request.",
                            )
                          }
                        />
                        <ActionPill
                          label="Decline"
                          tone="outline"
                          onPress={() =>
                            void runAction(
                              request.id,
                              () => declineFriendRequest(request.id),
                              "Couldn't decline request.",
                            )
                          }
                        />
                      </View>
                    )
                  }
                />
              ))}
            </View>
          ) : null}

          <SectionHeader label="Friends" />
          {friends.length === 0 ? (
            <Text style={styles.emptyHint}>
              No friends yet. Search above to send a request.
            </Text>
          ) : null}
        </View>
      }
      renderItem={({ item }) => (
        <Row
          title={item.username}
          leading={<Feather name="user" size={20} color={theme.accent} />}
          right={
            busyId === item.friendshipId ? (
              <ActivityIndicator color={theme.accent} />
            ) : (
              <ActionPill label="Remove" tone="warning" onPress={() => confirmRemove(item)} />
            )
          }
        />
      )}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
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
      <SectionHeader label="Add a friend" />
      <TextField
        label="Search by username"
        value={query}
        onChangeText={setQuery}
        autoCapitalize="none"
      />
      {error ? <ErrorBanner message={error} /> : null}
      {searching ? <ActivityIndicator color={theme.accent} style={styles.searchSpinner} /> : null}
      {results.map((user) => {
        const alreadyFriend = existingIds.includes(user.id);
        const sent = sentIds.includes(user.id);
        return (
          <Row
            key={user.id}
            title={user.username}
            leading={<Feather name="user" size={20} color={theme.accent} />}
            right={
              alreadyFriend ? (
                <StatusPill label="Friend" tone="outline" />
              ) : sent ? (
                <StatusPill label="Requested" tone="outline" />
              ) : (
                <ActionPill label="Add" tone="accent" onPress={() => void send(user)} />
              )
            }
          />
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
  emptyHint: { fontSize: fontSize.sm, color: theme.textMuted },
  searchSpinner: { alignSelf: "flex-start" },
  rowActions: { flexDirection: "row", gap: spacing(1) },
  separator: { height: spacing(1) },
});
