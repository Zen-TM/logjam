// Friends — "who can I share a place with, and who is waiting on me?"
//
// LAYOUT (shared/DESIGN.md §2, §2): hero answers with a count and owns the one
// acquisition action (Add, which opens the username search in a sheet); a pinned
// rail partitions into Friends / Requests — a true partition, because a pending
// request is not yet a friendship; one flat list under it. Per-row actions live
// in an overflow sheet titled with the username, so a mis-tap can't revoke
// anything (DESIGN.md).
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
// `/friends/search` never return an email (guard: api/src/__tests__/friends.test.ts)
// and nothing here would have somewhere to put one.
import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  Share,
  Text,
  View,
} from "react-native";
import {
  contractSectionKeys,
  friendAcceptedMessage,
  friendInviteMessage,
  friendInviteUrl,
  friendInvitesLiveLabel,
  friendRemovedMessage,
  friendRemoveConfirm,
  friendRequestMadeFriend,
  friendsEmptyKind,
  friendsHeroTitle,
  FRIENDS,
  friendVerb,
  LEADERBOARD,
  leaderboardRowSubtitle,
  type LeaderboardResponse,
  messageFromError,
  type FriendsBucket,
  type SectionKeysOn,
  friendSearchHint,
} from "@logjam/shared";

import {
  acceptFriendRequest,
  createFriendInvite,
  declineFriendRequest,
  getFriendInvites,
  getFriendRequests,
  getFriends,
  getLeaderboard,
  removeFriend,
  revokeFriendInvites,
  searchUsers,
  sendFriendRequest,
  type Friend,
  type FriendRequest,
  type UserSearchResult,
} from "../api/friends";
import { fetchCurrentUser, useApiQuery } from "../api/queries";
import { config } from "../config";
import { useAccountState } from "../auth/AccountStateContext";
import { capabilityScreenBlock } from "../auth/capabilities";
import { spacing, makeStyles, useTheme, useHues, muted } from "../theme";
import { selfStanding } from "./leaderboard";
import {
  BottomSheet,
  Button,
  EmptyState,
  ErrorBanner,
  ErrorState,
  Hero,
  Icon,
  ListEnd,
  IconButton,
  LoadingState,
  Row,
  ChipRail,
  StatusPill,
  TextField,
  Toast,
  type ChipOption,
  type ToastMessage,
} from "../ui";

const SEARCH_MIN_CHARS = 3;

type Bucket = FriendsBucket;

const copy = FRIENDS.copy;

/**
 * One row shape for both populations, so a single renderer covers the list.
 * A request wears the heath hue a shared place wears — it is someone else
 * reaching into your account, which is the same idea (shared/DESIGN.md §8).
 */
type FriendItem =
  | { kind: "friend"; key: string; username: string; friendshipId: string }
  | { kind: "request"; key: string; username: string; requestId: string };

export function FriendsScreen({
  onBack,
  onOpenShares,
  onOpenLeaderboard,
}: {
  onBack: () => void;
  /** Push the leaderboard, for someone who has joined it. */
  onOpenLeaderboard: () => void;
  /**
   * Open the per-friend sharing audit — "what does this person see?". Pushed by
   * the caller so Back returns to this list. Reached by tapping the friend's row
   * body, and also from the row's overflow sheet: the body OPENS and the ⋯ ACTS
   * (DESIGN.md), so a mis-tap lands on a read-only screen rather than near a revoke.
   */
  onOpenShares: (friend: { friendshipId: string; username: string }) => void;
}) {
  const theme = useTheme();
  const { placeHue } = useHues();
  const styles = useStyles();

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
  const notify = useCallback(
    (text: string, tone: ToastMessage["tone"] = "info") => {
      setToast({ text, tone, nonce: Date.now() });
    },
    [],
  );

  // The leaderboard row exists only for someone who has joined (Settings →
  // Privacy and security). Settings' PATCH refreshes the cached user record
  // (`api/apiFetch.ts`), so this screen, mounted fresh on each visit, reads
  // the change.
  const userQuery = useApiQuery(
    fetchCurrentUser,
    "Couldn't load your account.",
    !guestBlock,
  );
  const { refetch: refetchUser } = userQuery;
  const leaderboardOptIn =
    userQuery.data?.uiPreferences?.leaderboardOptIn === true;
  const [board, setBoard] = useState<LeaderboardResponse | null>(null);
  const [boardRequest, setBoardRequest] = useState(0);
  useEffect(() => {
    if (!leaderboardOptIn) return;
    let cancelled = false;
    getLeaderboard()
      .then((next) => {
        if (!cancelled) setBoard(next);
      })
      // The subtitle is a courtesy; the row opens without it.
      .catch((err: unknown) => console.error(err));
    return () => {
      cancelled = true;
    };
  }, [leaderboardOptIn, boardRequest]);

  const load = useCallback(async () => {
    if (guestBlock) return;
    await Promise.all([getFriends(), getFriendRequests()])
      .then(([nextFriends, nextRequests]) => {
        setFriends(nextFriends);
        setRequests(nextRequests);
        setLoadError(null);
      })
      .catch((err: unknown) => {
        console.error(err);
        // Only surface a full-screen error when nothing has loaded yet; a later
        // refresh failure keeps the last-good lists on screen.
        setLoadError(messageFromError(err, copy.loadFailed));
      });
  }, [guestBlock]);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    refetchUser();
    setBoardRequest((n) => n + 1);
    await load();
    setRefreshing(false);
  }, [load, refetchUser]);

  const runAction = useCallback(
    async (
      id: string,
      action: () => Promise<unknown>,
      fallback: string,
      done?: string,
    ) => {
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
      // verb suggests (DESIGN.md).
      const { confirmTitle, confirmBody } = friendRemoveConfirm(item.username);
      Alert.alert(confirmTitle, confirmBody, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () =>
            void runAction(
              item.friendshipId,
              () => removeFriend(item.friendshipId),
              copy.removeFailed,
              friendRemovedMessage(item.username),
            ),
        },
      ]);
    },
    [runAction],
  );

  // Stable identities so the memoised rows only re-render for a change that is
  // actually theirs (DESIGN.md).
  const openFriend = useCallback(
    (item: FriendItem) => {
      if (item.kind !== "friend") return;
      onOpenShares({
        friendshipId: item.friendshipId,
        username: item.username,
      });
    },
    [onOpenShares],
  );
  const openMenu = useCallback((item: FriendItem) => setMenuItem(item), []);
  const keyExtractor = useCallback((item: FriendItem) => item.key, []);
  const renderItem = useCallback(
    ({ item }: { item: FriendItem }) => (
      <FriendRow
        item={item}
        busy={
          busyId ===
          (item.kind === "friend" ? item.friendshipId : item.requestId)
        }
        onOpen={openFriend}
        onMenu={openMenu}
      />
    ),
    [busyId, openFriend, openMenu],
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
        <Hero eyebrow={FRIENDS.title} title={FRIENDS.title} onBack={onBack} />
        <EmptyState title={guestBlock.title} hint={guestBlock.hint} />
      </View>
    );
  }
  if (friends === null && loadError) {
    return <ErrorState message={loadError} onRetry={() => void load()} />;
  }
  if (friends === null) return <LoadingState />;

  const buckets: ChipOption<Bucket>[] = [
    {
      value: "all",
      label: copy.bucketAll,
      count: friends.length + requests.length,
    },
    {
      value: "friends",
      label: copy.bucketFriends,
      count: friends.length,
      disabled: friends.length === 0,
    },
    {
      value: "requests",
      label: copy.bucketRequests,
      count: requests.length,
      hue: placeHue.shared,
      disabled: requests.length === 0,
    },
  ];

  // Exhaustive by type: a section the contract names and this screen does not
  // draw, or the reverse, fails `tsc` (`FRIENDS`, shared/src/contracts).
  const page: Record<SectionKeysOn<typeof FRIENDS, "gps">, () => ReactNode> = {
    hero: () => (
      <Hero
        eyebrow={FRIENDS.title}
        title={friendsHeroTitle(requests.length, friends.length)}
        onBack={onBack}
        actions={
          <Button
            label={copy.add}
            icon="addFriend"
            variant="outlineAccent"
            compact
            onPress={() => setAddOpen(true)}
          />
        }
      />
    ),
    leaderboard: () =>
      // Nothing at all until the user joins: Settings is the only way in.
      leaderboardOptIn && board?.joined !== false ? (
        <View style={styles.leaderboard}>
          <Row
            icon="leaderboard"
            title={LEADERBOARD.title}
            subtitle={
              board?.joined
                ? leaderboardRowSubtitle(
                    selfStanding(board).rank,
                    selfStanding(board).size,
                  )
                : undefined
            }
            onPress={onOpenLeaderboard}
            right={<Icon idea="disclosure" size={20} color={theme.textMuted} />}
          />
        </View>
      ) : null,
    buckets: () => (
      <View style={styles.rail}>
        <ChipRail
          options={buckets}
          value={bucket}
          onChange={setBucket}
          scroll
        />
      </View>
    ),
    list: () => (
      <>
        {/* Stays inline with a retry, because a stale list IS the problem and it
            persists until the fetch works (DESIGN.md). */}
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
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={theme.accent}
            />
          }
          renderItem={renderItem}
          ListFooterComponent={
            // The list ends with the button its empty state offers.
            items.length > 0 ? (
              <ListEnd>
                <Button
                  label={copy.addTitle}
                  icon="addFriend"
                  variant="outlineAccent"
                  onPress={() => setAddOpen(true)}
                />
              </ListEnd>
            ) : undefined
          }
          ListEmptyComponent={
            <EmptyPanel
              kind={friendsEmptyKind({
                friends: friends.length,
                requests: requests.length,
                bucket,
              })}
              onAdd={() => setAddOpen(true)}
            />
          }
        />
      </>
    ),
  };

  return (
    <View style={styles.root}>
      {contractSectionKeys(FRIENDS, "gps").map((key) => (
        <Fragment key={key}>{page[key]()}</Fragment>
      ))}

      <BottomSheet
        visible={addOpen}
        onClose={() => setAddOpen(false)}
        title={copy.addTitle}
      >
        <AddFriendBody
          open={addOpen}
          existingIds={friends.map((friend) => friend.id)}
          onSent={() => void load()}
        />
      </BottomSheet>

      {/* Per-row actions, titled with the username (DESIGN.md). */}
      <BottomSheet
        visible={menuItem !== null}
        onClose={() => setMenuItem(null)}
        title={menuItem?.username ?? ""}
      >
        {menuItem?.kind === "friend" ? (
          <View style={styles.menuBody}>
            <Row
              icon={friendVerb("shares").icon}
              title={friendVerb("shares").label}
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
              icon={friendVerb("remove").icon}
              hue={theme.warning}
              title={friendVerb("remove").label}
              onPress={() => confirmRemove(menuItem)}
            />
          </View>
        ) : null}
        {menuItem?.kind === "request" ? (
          <View style={styles.menuBody}>
            <Row
              icon={friendVerb("accept").icon}
              title={friendVerb("accept").label}
              onPress={() => {
                const request = menuItem;
                setMenuItem(null);
                void runAction(
                  request.requestId,
                  () => acceptFriendRequest(request.requestId),
                  copy.acceptFailed,
                  friendAcceptedMessage(request.username),
                );
              }}
            />
            <Row
              icon={friendVerb("decline").icon}
              title={friendVerb("decline").label}
              onPress={() => {
                const request = menuItem;
                setMenuItem(null);
                void runAction(
                  request.requestId,
                  () => declineFriendRequest(request.requestId),
                  copy.declineFailed,
                  copy.declined,
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
 * The card every list in this app uses (DESIGN.md): the row's body opens the thing, the
 * ⋯ opens its actions. A friend opens to their sharing screen — read-only, so
 * the tap costs nothing, while the verbs that revoke stay behind the sheet. A
 * request has nowhere to open to, so both its body and its ⋯ reach the same
 * accept/decline sheet; it carries no inline Accept, because one trailing
 * control is what makes this the same card as a place's.
 *
 * Memoised, with callbacks that take the item rather than closing over it — §9.
 */
const FriendRow = memo(function FriendRow({
  item,
  busy,
  onOpen,
  onMenu,
}: {
  item: FriendItem;
  busy: boolean;
  onOpen: (item: FriendItem) => void;
  onMenu: (item: FriendItem) => void;
}) {
  const theme = useTheme();
  const { placeHue } = useHues();

  const request = item.kind === "request";
  return (
    <Row
      icon={request ? "addFriend" : "account"}
      hue={request ? placeHue.shared : undefined}
      title={item.username}
      subtitle={request ? copy.requestSubtitle : undefined}
      onPress={() => (request ? onMenu(item) : onOpen(item))}
      right={
        busy ? (
          <ActivityIndicator color={theme.accent} />
        ) : (
          <IconButton
            icon="overflow"
            accessibilityLabel={`Actions for ${item.username}`}
            onPress={() => onMenu(item)}
          />
        )
      }
    />
  );
});

// Username search → send request. Already-friend / already-pending targets are
// rejected server-side (409) and the message is worth showing. Sent targets are
// locally marked so the row reflects the pending state without a reload.
function AddFriendBody({
  open,
  existingIds,
  onSent,
}: {
  open: boolean;
  existingIds: string[];
  onSent: () => void;
}) {
  const theme = useTheme();
  const styles = useStyles();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [searching, setSearching] = useState(false);
  const [sentIds, setSentIds] = useState<string[]>([]);
  // Made a friend by sending (they had already asked), shown until the
  // reloaded list says so itself.
  const [friendedIds, setFriendedIds] = useState<string[]>([]);
  // The search field's own problem (§8, rule 1).
  const [searchError, setSearchError] = useState<string | null>(null);
  // Not this field's problem — it's the tapped "Add" row's — so it goes in a
  // banner rather than under the search box (§8, rule 2). The sheet stays open
  // on a failed send, so this is a banner, never the toast a closed form gets.
  const [sendError, setSendError] = useState<string | null>(null);

  const changeQuery = (next: string) => {
    setQuery(next);
    // A fresh search supersedes whichever row's send just failed.
    setSendError(null);
    setSearchError(null);
    if (next.trim().length < SEARCH_MIN_CHARS) setResults([]);
    else setSearching(true);
  };

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < SEARCH_MIN_CHARS) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      searchUsers(trimmed)
        .then(({ data, total: all }) => {
          if (!cancelled) {
            setResults(data);
            setTotal(all);
            setSearchError(null);
          }
        })
        .catch((err: unknown) => {
          console.error(err);
          if (!cancelled)
            setSearchError(messageFromError(err, copy.searchFailed));
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
      setSendError(null);
      try {
        const friended = friendRequestMadeFriend(
          await sendFriendRequest(user.id),
        );
        (friended ? setFriendedIds : setSentIds)((current) => [
          ...current,
          user.id,
        ]);
        onSent();
      } catch (err) {
        console.error(err);
        setSendError(messageFromError(err, copy.sendFailed));
      }
    },
    [onSent],
  );

  // The other way to add someone: a link, handed to whichever app the user
  // sends messages with. It opens Logjam Web, so it works for someone who has
  // no Logjam GPS. Its failure is this button's, hence the same banner.
  const [inviting, setInviting] = useState(false);
  // How many links are out, and the one way to take them back: a link shared
  // into the wrong chat befriends whoever opens it. `null` once they have
  // been turned off, which is said where the count was.
  const [liveInvites, setLiveInvites] = useState<number | null>(0);
  const [revoking, setRevoking] = useState(false);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getFriendInvites()
      .then((invites) => {
        if (!cancelled) setLiveInvites(invites.length);
      })
      // The count is a courtesy; sharing works without it.
      .catch((err) => console.error(err));
    return () => {
      cancelled = true;
      setLiveInvites(0);
    };
  }, [open]);

  const shareInvite = useCallback(async () => {
    setSendError(null);
    setInviting(true);
    try {
      const { token } = await createFriendInvite();
      // Counted once it exists, whatever becomes of the share sheet.
      setLiveInvites((count) => (count ?? 0) + 1);
      await Share.share({
        message: friendInviteMessage(friendInviteUrl(config.webUrl, token)),
      });
    } catch (err) {
      console.error(err);
      setSendError(messageFromError(err, copy.inviteFailed));
    } finally {
      setInviting(false);
    }
  }, []);

  const revokeInvites = useCallback(async () => {
    setSendError(null);
    setRevoking(true);
    try {
      await revokeFriendInvites();
      setLiveInvites(null);
    } catch (err) {
      console.error(err);
      setSendError(messageFromError(err, copy.inviteRevokeFailed));
    } finally {
      setRevoking(false);
    }
  }, []);

  const trimmed = query.trim();
  return (
    <View style={styles.addBody}>
      <TextField
        label={copy.searchField}
        value={query}
        onChangeText={changeQuery}
        autoCapitalize="none"
        error={searchError}
      />
      {searching ? (
        <ActivityIndicator color={theme.accent} style={styles.spinner} />
      ) : null}
      {!searching &&
      trimmed.length >= SEARCH_MIN_CHARS &&
      results.length === 0 ? (
        <Text style={styles.hint}>{copy.searchEmpty}</Text>
      ) : null}
      {trimmed.length > 0 && trimmed.length < SEARCH_MIN_CHARS ? (
        <Text style={styles.hint}>{copy.searchHint}</Text>
      ) : null}
      {results.map((user) => {
        const alreadyFriend =
          existingIds.includes(user.id) || friendedIds.includes(user.id);
        const sent = sentIds.includes(user.id);
        return (
          <Row
            key={user.id}
            icon="account"
            title={user.username}
            right={
              alreadyFriend ? (
                <StatusPill label={copy.pillFriend} tone="muted" />
              ) : sent ? (
                <StatusPill label={copy.pillRequested} tone="outline" />
              ) : (
                <Button
                  label={copy.add}
                  variant="outlineAccent"
                  compact
                  onPress={() => void send(user)}
                />
              )
            }
          />
        );
      })}
      {friendSearchHint(results.length, total) ? (
        <Text style={styles.hint}>
          {friendSearchHint(results.length, total)}
        </Text>
      ) : null}
      <Text style={styles.hint}>{copy.inviteHint}</Text>
      <Button
        label={copy.inviteShare}
        icon="link"
        variant="outlineAccent"
        disabled={inviting}
        onPress={() => void shareInvite()}
      />
      {liveInvites === null ? (
        <Text style={styles.hint}>{copy.inviteRevoked}</Text>
      ) : liveInvites > 0 ? (
        <View style={styles.liveInvites}>
          <Text style={[styles.hint, styles.liveInvitesLabel]}>
            {friendInvitesLiveLabel(liveInvites)}
          </Text>
          <Button
            label={copy.inviteRevoke}
            variant="ghost"
            compact
            loading={revoking}
            onPress={() => void revokeInvites()}
          />
        </View>
      ) : null}
      {sendError ? <ErrorBanner message={sendError} /> : null}
    </View>
  );
}

/** Per-bucket and actionable (shared/DESIGN.md §11). */
function EmptyPanel({
  kind,
  onAdd,
}: {
  kind: "firstRun" | "noRequests" | null;
  onAdd: () => void;
}) {
  if (kind === "noRequests") {
    return <EmptyState title={copy.noRequestsTitle} />;
  }
  return (
    <EmptyState
      title={copy.firstRunTitle}
      hint={copy.firstRunBody}
      action={{ label: copy.addTitle, icon: "addFriend", onPress: onAdd }}
    />
  );
}

const useStyles = makeStyles((theme, textRole) => ({
  root: { flex: 1, backgroundColor: theme.page },
  leaderboard: { paddingHorizontal: spacing(2), paddingTop: spacing(1.5) },
  rail: {
    paddingHorizontal: spacing(2),
    paddingTop: spacing(1.5),
    paddingBottom: spacing(1.5),
  },
  banner: { paddingHorizontal: spacing(2), paddingBottom: spacing(1) },
  list: { flex: 1 },
  listContent: {
    paddingHorizontal: spacing(2),
    gap: spacing(1),
    paddingBottom: spacing(4),
  },
  menuBody: { gap: spacing(1) },
  addBody: { gap: spacing(1) },
  spinner: { alignSelf: "flex-start" },
  liveInvites: { flexDirection: "row", alignItems: "center", gap: spacing(1) },
  liveInvitesLabel: { flex: 1 },
  hint: { ...muted(theme, textRole.detail) },
}));
