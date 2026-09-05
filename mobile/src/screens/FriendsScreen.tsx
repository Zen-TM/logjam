// Friends — "who can I share a canyon with, and who is waiting on me?"
//
// LAYOUT (DESIGN.md §1, §2): hero answers with a count and owns the one
// acquisition action (Add, which opens the username search in a sheet); a pinned
// rail partitions into Friends / Requests — a true partition, because a pending
// request is not yet a friendship; one flat list under it. Per-row actions live
// in an overflow sheet titled with the username, so a mis-tap can't revoke
// anything (§7).
//
// Online-only, deliberately: managing friendships is never a field use case, and
// the mirror handles the offline propagation of the resulting shares and
// tombstones. The More hub disables the row when offline, and this screen still
// reports the failure with a retry if it is reached another way.
//
// GUEST: gated HERE as well as on the More row that leads here. A guest has no
// friends endpoint to call, so `load()` would be a guaranteed 401 on every open
// — the More row is the only entry point today, but the gate belongs on the
// screen so a second one (a deep link, a back-stack restore) can't reopen it.
//
// PRIVACY: usernames only, everywhere. `/friends`, `/friends/requests` and
// `/friends/search` never return an email (root CLAUDE.md convention) and nothing
// here would have somewhere to put one.
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
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
import { useAccountState } from "../auth/AccountStateContext";
import { capabilityScreenBlock } from "../auth/capabilities";
import { canyonHue, fontSize, spacing, theme } from "../theme";
import {
  BottomSheet,
  Button,
  EmptyState,
  ErrorBanner,
  ErrorState,
  HeroHeader,
  LoadingState,
  Row,
  SegmentedControl,
  StatusPill,
  TextField,
  Toast,
  type SegmentOption,
  type ToastMessage,
} from "../ui";

const SEARCH_MIN_CHARS = 3;

type Bucket = "all" | "friends" | "requests";

/**
 * One row shape for both populations, so a single renderer covers the list.
 * A request wears the heath hue a shared canyon wears — it is someone else
 * reaching into your account, which is the same idea (§3).
 */
type FriendItem =
  | { kind: "friend"; key: string; username: string; friendshipId: string }
  | { kind: "request"; key: string; username: string; requestId: string };

export function FriendsScreen({
  onBack,
  onOpenShares,
}: {
  onBack: () => void;
  /**
   * Open the per-friend sharing audit — "what does this person see?". Pushed by
   * the caller so Back returns to this list. It is reached from the friend's
   * overflow sheet rather than from the row: this screen's per-row actions live
   * behind that sheet on purpose (§7), and a row that navigated would put a
   * revoke one mis-tap from the tap that opens it.
   */
  onOpenShares: (friend: { friendshipId: string; username: string }) => void;
}) {
  const { accountState } = useAccountState();
  const guestBlock = useMemo(
    () => capabilityScreenBlock("friends", accountState),
    [accountState],
  );
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [bucket, setBucket] = useState<Bucket>("all");
  const [addOpen, setAddOpen] = useState(false);
  const [menuItem, setMenuItem] = useState<FriendItem | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const notify = useCallback((text: string, tone: ToastMessage["tone"] = "info") => {
    setToast({ text, tone, nonce: Date.now() });
  }, []);

  const load = useCallback(async () => {
    if (guestBlock) return;
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
      setLoadError(messageFromError(err, "Couldn't load friends."));
    }
  }, [guestBlock]);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const runAction = useCallback(
    async (id: string, action: () => Promise<unknown>, fallback: string, done?: string) => {
      setBusyId(id);
      try {
        await action();
        await load();
        if (done) notify(done);
      } catch (err) {
        console.error(err);
        notify(messageFromError(err, fallback), "error");
      } finally {
        setBusyId(null);
      }
    },
    [load, notify],
  );

  const confirmRemove = useCallback(
    (item: Extract<FriendItem, { kind: "friend" }>) => {
      setMenuItem(null);
      // A dialog, because the consequence is the point and it is bigger than the
      // verb suggests (§7).
      Alert.alert(
        `Remove ${item.username}?`,
        "This also revokes every canyon you've shared with them.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Remove",
            style: "destructive",
            onPress: () =>
              void runAction(
                item.friendshipId,
                () => removeFriend(item.friendshipId),
                "Couldn't remove that friend.",
                `${item.username} removed.`,
              ),
          },
        ],
      );
    },
    [runAction],
  );

  // Stable identities so the memoised rows only re-render for a change that is
  // actually theirs (DESIGN.md §9).
  const acceptRequest = useCallback(
    (item: FriendItem) => {
      if (item.kind !== "request") return;
      void runAction(
        item.requestId,
        () => acceptFriendRequest(item.requestId),
        "Couldn't accept that request.",
        `${item.username} is now a friend.`,
      );
    },
    [runAction],
  );
  const openMenu = useCallback((item: FriendItem) => setMenuItem(item), []);
  const keyExtractor = useCallback((item: FriendItem) => item.key, []);
  const renderItem = useCallback(
    ({ item }: { item: FriendItem }) => (
      <FriendRow
        item={item}
        busy={busyId === (item.kind === "friend" ? item.friendshipId : item.requestId)}
        onAccept={acceptRequest}
        onMenu={openMenu}
      />
    ),
    [acceptRequest, busyId, openMenu],
  );

  const items = useMemo<FriendItem[]>(() => {
    const requestItems: FriendItem[] = requests.map((request) => ({
      kind: "request",
      key: `request:${request.id}`,
      username: request.requester.username,
      requestId: request.id,
    }));
    const friendItems: FriendItem[] = (friends ?? []).map((friend) => ({
      kind: "friend",
      key: `friend:${friend.friendshipId}`,
      username: friend.username,
      friendshipId: friend.friendshipId,
    }));
    // Requests first in "All": they are the only entries that need a decision.
    if (bucket === "friends") return friendItems;
    if (bucket === "requests") return requestItems;
    return [...requestItems, ...friendItems];
  }, [bucket, friends, requests]);

  // Before the loading branch: with the fetch gated off, `friends` stays null
  // forever and a guest would otherwise sit on a spinner. The hero keeps the
  // back affordance — a dead-end screen with no way out is worse than the gate.
  if (guestBlock) {
    return (
      <View style={styles.root}>
        <HeroHeader eyebrow="Friends" title="Friends" onBack={onBack} />
        <EmptyState title={guestBlock.title} hint={guestBlock.hint} />
      </View>
    );
  }
  if (friends === null && loadError) {
    return <ErrorState message={loadError} onRetry={() => void load()} />;
  }
  if (friends === null) return <LoadingState />;

  const buckets: SegmentOption<Bucket>[] = [
    { value: "all", label: "All", count: friends.length + requests.length },
    { value: "friends", label: "Friends", count: friends.length, disabled: friends.length === 0 },
    {
      value: "requests",
      label: "Requests",
      count: requests.length,
      hue: canyonHue.shared,
      disabled: requests.length === 0,
    },
  ];

  return (
    <View style={styles.root}>
      <HeroHeader
        eyebrow="Friends"
        title={requests.length > 0 ? "Someone's waiting" : "Your people"}
        onBack={onBack}
        value={String(friends.length)}
        valueSuffix={friends.length === 1 ? "friend" : "friends"}
        action={
          <Button
            label="Add"
            icon="user-plus"
            variant="outlineAccent"
            compact
            onPress={() => setAddOpen(true)}
          />
        }
      />

      <View style={styles.rail}>
        <SegmentedControl options={buckets} value={bucket} onChange={setBucket} scroll />
      </View>

      {/* Stays inline with a retry, because a stale list IS the problem and it
          persists until the fetch works (§6). */}
      {loadError ? (
        <View style={styles.banner}>
          <ErrorBanner message={loadError} onRetry={() => void load()} />
        </View>
      ) : null}

      <FlatList
        style={styles.list}
        contentContainerStyle={styles.listContent}
        data={items}
        keyExtractor={keyExtractor}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} />
        }
        renderItem={renderItem}
        ListEmptyComponent={
          <EmptyPanel bucket={bucket} onAdd={() => setAddOpen(true)} />
        }
      />

      <BottomSheet
        visible={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add a friend"
      >
        <AddFriendBody
          existingIds={friends.map((friend) => friend.id)}
          onSent={() => void load()}
          onFailed={(message) => notify(message, "error")}
        />
      </BottomSheet>

      {/* Per-row actions, titled with the username (§7). */}
      <BottomSheet
        visible={menuItem !== null}
        onClose={() => setMenuItem(null)}
        title={menuItem?.username ?? ""}
      >
        {menuItem?.kind === "friend" ? (
          <View style={styles.menuBody}>
            <Row
              icon="share-2"
              title="Shared items"
              subtitle="What they can see, and what they share with you"
              onPress={() => {
                const friend = menuItem;
                setMenuItem(null);
                onOpenShares({
                  friendshipId: friend.friendshipId,
                  username: friend.username,
                });
              }}
            />
            <Row
              icon="user-minus"
              hue={theme.warning}
              title="Remove friend"
              onPress={() => confirmRemove(menuItem)}
            />
          </View>
        ) : null}
        {menuItem?.kind === "request" ? (
          <View style={styles.menuBody}>
            <Row
              icon="user-check"
              title="Accept"
              onPress={() => {
                const request = menuItem;
                setMenuItem(null);
                void runAction(
                  request.requestId,
                  () => acceptFriendRequest(request.requestId),
                  "Couldn't accept that request.",
                  `${request.username} is now a friend.`,
                );
              }}
            />
            <Row
              icon="user-x"
              hue={theme.warning}
              title="Decline"
              onPress={() => {
                const request = menuItem;
                setMenuItem(null);
                void runAction(
                  request.requestId,
                  () => declineFriendRequest(request.requestId),
                  "Couldn't decline that request.",
                  "Request declined.",
                );
              }}
            />
          </View>
        ) : null}
      </BottomSheet>

      <Toast message={toast} onDismissed={() => setToast(null)} />
    </View>
  );
}

/**
 * One tap accepts, because that is the answer nearly every request gets; the
 * overflow carries the same accept plus decline, so "no" is never a mis-tap
 * away from "yes".
 *
 * Memoised, with callbacks that take the item rather than closing over it — §9.
 */
const FriendRow = memo(function FriendRow({
  item,
  busy,
  onAccept,
  onMenu,
}: {
  item: FriendItem;
  busy: boolean;
  onAccept: (item: FriendItem) => void;
  onMenu: (item: FriendItem) => void;
}) {
  const request = item.kind === "request";
  return (
    <Row
      icon={request ? "user-plus" : "user"}
      hue={request ? canyonHue.shared : undefined}
      title={item.username}
      subtitle={request ? "Wants to be friends" : undefined}
      onPress={() => onMenu(item)}
      right={
        busy ? (
          <ActivityIndicator color={theme.accent} />
        ) : request ? (
          <Button
            label="Accept"
            variant="outlineAccent"
            compact
            onPress={() => onAccept(item)}
          />
        ) : (
          <StatusPill label="Friend" tone="muted" />
        )
      }
    />
  );
});

// Username search → send request. Already-friend / already-pending targets are
// rejected server-side (409) and the message is worth showing. Sent targets are
// locally marked so the row reflects the pending state without a reload.
function AddFriendBody({
  existingIds,
  onSent,
  onFailed,
}: {
  existingIds: string[];
  onSent: () => void;
  onFailed: (message: string) => void;
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
          console.error(err);
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
        setSentIds((current) => [...current, user.id]);
        onSent();
      } catch (err) {
        console.error(err);
        onFailed(messageFromError(err, "Couldn't send that request."));
      }
    },
    [onFailed, onSent],
  );

  const trimmed = query.trim();
  return (
    <View style={styles.addBody}>
      <TextField
        label="Search by username"
        value={query}
        onChangeText={setQuery}
        autoCapitalize="none"
      />
      {error ? <ErrorBanner message={error} /> : null}
      {searching ? <ActivityIndicator color={theme.accent} style={styles.spinner} /> : null}
      {!searching && trimmed.length >= SEARCH_MIN_CHARS && results.length === 0 ? (
        <Text style={styles.hint}>No one by that name.</Text>
      ) : null}
      {trimmed.length > 0 && trimmed.length < SEARCH_MIN_CHARS ? (
        <Text style={styles.hint}>Keep typing — at least {SEARCH_MIN_CHARS} characters.</Text>
      ) : null}
      {results.map((user) => {
        const alreadyFriend = existingIds.includes(user.id);
        const sent = sentIds.includes(user.id);
        return (
          <Row
            key={user.id}
            icon="user"
            title={user.username}
            right={
              alreadyFriend ? (
                <StatusPill label="Friend" tone="muted" />
              ) : sent ? (
                <StatusPill label="Requested" tone="outline" />
              ) : (
                <Button
                  label="Add"
                  variant="outlineAccent"
                  compact
                  onPress={() => void send(user)}
                />
              )
            }
          />
        );
      })}
    </View>
  );
}

/** Per-bucket and actionable (§8). */
function EmptyPanel({ bucket, onAdd }: { bucket: Bucket; onAdd: () => void }) {
  if (bucket === "requests") {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>No pending requests</Text>
      </View>
    );
  }
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>No friends yet</Text>
      <Text style={styles.emptyHint}>
        You need to be friends to share a canyon.
      </Text>
      <Button label="Add a friend" icon="user-plus" onPress={onAdd} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.primary },
  rail: { paddingHorizontal: spacing(2), paddingTop: spacing(1.5), paddingBottom: spacing(1.5) },
  banner: { paddingHorizontal: spacing(2), paddingBottom: spacing(1) },
  list: { flex: 1 },
  listContent: { paddingHorizontal: spacing(2), gap: spacing(1), paddingBottom: spacing(4) },
  menuBody: { gap: spacing(1) },
  addBody: { gap: spacing(1) },
  spinner: { alignSelf: "flex-start" },
  hint: { color: theme.textMuted, fontSize: fontSize.sm },
  empty: { alignItems: "center", gap: spacing(1.5), paddingVertical: spacing(6) },
  emptyTitle: { color: theme.textPrimary, fontSize: fontSize.base },
  emptyHint: {
    color: theme.textMuted,
    fontSize: fontSize.sm,
    textAlign: "center",
    paddingHorizontal: spacing(2),
  },
});
