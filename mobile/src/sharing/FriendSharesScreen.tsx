// One friend's sharing, both ways — "what does bob see of mine, and what does
// he let me see?"
//
// Sharing is AUTHORED per item, from that item's own sheet, so nothing else in
// the app can answer the question from the person's side. Reached by tapping a
// friend on the Friends screen (a row in that friend's overflow sheet, not the
// row itself: per-row actions live behind the sheet there precisely so a mis-tap
// cannot revoke anything).
//
// LAYOUT (DESIGN.md §1, §2, §7): hero counts what this friend can see; the rail
// is a two-chip partition — the two directions are genuinely different sets,
// not a filter over one — and the multi-select bar swaps into that rail at the
// same height, so the list cannot jump. Rows carry a ⋯ that becomes the
// checkbox in the same 40pt box.
//
// THE TWO DIRECTIONS GET DIFFERENT VERBS, and `friendShareRows.ts` owns which
// and why. Forward: share these with someone else (the existing bulk-share
// sheet, unchanged) and unshare them. Received: save a copy of a canyon, and
// remove my own access. There is NO delete anywhere on this screen, in the bar
// or in a sheet — every other verb here ends a RELATIONSHIP, while delete would
// end the record for me and for everyone else I had shared it with, off a
// screen scoped to one person. It belongs on Canyons and Saved, where a row
// means "my item" rather than "my grant to bob".
//
// ONLINE-ONLY, like the Friends screen that leads here and like every other
// permission change (`sharing/removeShare.ts` says why): the outbox carries
// entity mutations, not grants, so a queued revoke would leave the row on
// screen claiming to be gone.
//
// PRIVACY: usernames and item names only — the payload carries no coordinates
// and no notes. Nothing here is logged.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";

import { messageFromError, SHARE_KIND_LABEL } from "@logjam/shared";
import type { FriendShares } from "@logjam/shared";

import {
  copySharedCanyon,
  getFriendShares,
  unshareWithFriend,
} from "../api/friends";
import { useAccountState } from "../auth/AccountStateContext";
import { capabilityScreenBlock } from "../auth/capabilities";
import { useConnectivity } from "../map/connectivity";
import { requestSync } from "../sync/syncEngine";
import { canyonHue, fontSize, spacing, theme } from "../theme";
import {
  BottomSheet,
  EmptyState,
  ErrorBanner,
  ErrorState,
  HeroHeader,
  IconButton,
  LoadingState,
  Row,
  SegmentedControl,
  SelectionBar,
  SelectionMark,
  Toast,
  useBulkSelection,
  type SegmentOption,
  type ToastMessage,
} from "../ui";
import { BulkShareButton, BulkShareSheet } from "./BulkShareSheet";
import {
  buildShareCards,
  copyConfirm,
  copyOutcomeMessage,
  removeRowSubtitle,
  removeAllConfirm,
  removeOutcomeMessage,
  shareCardItem,
  shareSelectionCountLabel,
  unshareAllConfirm,
  unshareOutcomeMessage,
  type FriendShareCard,
  type FriendShareDirection,
} from "./friendShareRows";
import { removeSharedCanyon, removeSharedEntity } from "./removeShare";

const cardKey = (card: FriendShareCard) => card.key;

export function FriendSharesScreen({
  friendshipId,
  username,
  onBack,
  onOpenCanyon,
}: {
  friendshipId: string;
  username: string;
  onBack: () => void;
  /** Open a canyon's detail page. Pushed in the caller's stack, so Back returns here. */
  onOpenCanyon: (canyonId: string) => void;
}) {
  const { accountState } = useAccountState();
  const guestBlock = useMemo(
    () => capabilityScreenBlock("friends", accountState),
    [accountState],
  );
  const online = useConnectivity() === "online";

  const [shares, setShares] = useState<FriendShares | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [direction, setDirection] = useState<FriendShareDirection>("theySee");
  const [sheetCard, setSheetCard] = useState<FriendShareCard | null>(null);
  const [shareSheetOpen, setShareSheetOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const notify = useCallback(
    (text: string, tone: ToastMessage["tone"] = "info") =>
      setToast({ text, tone, nonce: Date.now() }),
    [],
  );

  const load = useCallback(async () => {
    if (guestBlock) return;
    try {
      setShares(await getFriendShares(friendshipId));
      setLoadError(null);
    } catch (err) {
      console.error(err);
      // Our own copy, never the error's: it may carry an item name.
      setLoadError(messageFromError(err, "Couldn't load what's shared with this friend."));
    }
  }, [friendshipId, guestBlock]);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const cards = useMemo(
    () =>
      buildShareCards(
        (direction === "theySee" ? shares?.sharedWithThem : shares?.sharedWithYou) ?? [],
        { direction, friendName: username },
      ),
    [direction, shares, username],
  );

  // A row a group verb can act on. Forward: all of them (unshare and re-share
  // apply to every row). Received: anything that can be copied or removed —
  // which, for a row visible through a shared canyon, is neither, so it answers
  // a long press with its reason rather than a checkbox (§7).
  const isSelectable = useCallback(
    (card: FriendShareCard) =>
      direction === "theySee" || card.copyable || card.removable,
    [direction],
  );

  const {
    selectedKeys,
    clearSelection,
    selectItem,
    selectAll,
    selectedItems,
    selectableItems,
    selecting,
  } = useBulkSelection({ items: cards, keyOf: cardKey, isDeletable: isSelectable });

  // Changing direction is a different SET, not a filter, so a selection made in
  // one cannot survive into the other (§7's filter/selection exclusivity).
  const changeDirection = useCallback(
    (next: FriendShareDirection) => {
      clearSelection();
      setDirection(next);
    },
    [clearSelection],
  );

  const copyable = useMemo(
    () => selectedItems.filter((card) => card.copyable),
    [selectedItems],
  );
  const removable = useMemo(
    () => selectedItems.filter((card) => card.removable),
    [selectedItems],
  );

  /** Refetch, and tell the mirror to catch up if the account changed. */
  const settle = useCallback(
    async (pullSync: boolean) => {
      if (pullSync) void requestSync().catch((err: unknown) => console.error(err));
      await load();
    },
    [load],
  );

  const runUnshare = useCallback(
    (targets: FriendShareCard[]) => {
      const confirm = unshareAllConfirm({
        count: targets.length,
        friendName: username,
        includesCanyon: targets.some((card) => card.row.entityType === "canyon"),
      });
      Alert.alert(confirm.title, confirm.body, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Unshare",
          style: "destructive",
          onPress: () => {
            setBusy(true);
            void unshareWithFriend(friendshipId, targets.map(shareCardItem))
              .then(async ({ revokedCount }) => {
                clearSelection();
                notify(unshareOutcomeMessage({ revokedCount, friendName: username }));
                await settle(true);
              })
              .catch((err: unknown) => {
                console.error(err);
                notify("Couldn't unshare those. Try again in a moment.", "error");
              })
              .finally(() => setBusy(false));
          },
        },
      ]);
    },
    [clearSelection, friendshipId, notify, settle, username],
  );

  /**
   * Save copies of the selected shared canyons.
   *
   * A LOOP, not one request: `POST /canyons/:id/copy` already exists and a
   * friend's shared list is tens of rows at most, so a bulk endpoint would buy
   * nothing but a second copy of the copy rules. One failure is one failure —
   * aborting would strand the user with no way to tell which canyons landed —
   * so the report names the ones that did not (`runBulkShare.ts`'s rule).
   */
  const runCopy = useCallback(
    (targets: FriendShareCard[]) => {
      // Confirms even though nothing is destroyed: "Save a copy" does not say
      // where the copy goes, whether the friend's canyon changes, or what
      // happens when they stop sharing — and a verb whose effect cannot be
      // predicted is one nobody presses.
      const confirm = copyConfirm({
        count: targets.length,
        friendName: username,
        ...(targets.length === 1 ? { itemName: targets[0].title } : {}),
      });
      Alert.alert(confirm.title, confirm.body, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Save a copy",
          onPress: () => {
            setBusy(true);
            const failed: string[] = [];
            let copied = 0;
            void (async () => {
              for (const card of targets) {
                try {
                  await copySharedCanyon(card.row.entityId);
                  copied += 1;
                } catch (err) {
                  console.error(err);
                  failed.push(card.title);
                }
              }
              clearSelection();
              const report = copyOutcomeMessage({ copied, failed });
              notify(report.text, report.tone);
              // The copies are server-side rows: they reach this phone on the pull.
              await settle(copied > 0);
              setBusy(false);
            })();
          },
        },
      ]);
    },
    [clearSelection, notify, settle, username],
  );

  /**
   * Drop my own access to the selected rows.
   *
   * Per row through `removeShare.ts`, which is also what the item sheets use:
   * it applies the same local cascade the server's tombstone would, so the row
   * leaves the screen now rather than on the next pull.
   */
  const runRemove = useCallback(
    (targets: FriendShareCard[]) => {
      const confirm = removeAllConfirm({
        count: targets.length,
        friendName: username,
        copyableCount: targets.filter((card) => card.copyable).length,
      });
      Alert.alert(confirm.title, confirm.body, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            setBusy(true);
            const failed: string[] = [];
            let removed = 0;
            void (async () => {
              for (const card of targets) {
                try {
                  if (card.row.entityType === "canyon") {
                    await removeSharedCanyon(card.row.entityId);
                  } else {
                    await removeSharedEntity(card.row.entityType, card.row.entityId);
                  }
                  removed += 1;
                } catch (err) {
                  console.error(err);
                  failed.push(card.title);
                }
              }
              clearSelection();
              const report = removeOutcomeMessage({ removed, failed });
              notify(report.text, report.tone);
              await settle(false);
              setBusy(false);
            })();
          },
        },
      ]);
    },
    [clearSelection, notify, settle, username],
  );

  const openSheet = useCallback((card: FriendShareCard) => setSheetCard(card), []);
  const renderItem = useCallback(
    ({ item }: { item: FriendShareCard }) => (
      <ShareCardRow
        card={item}
        selecting={selecting}
        selected={selectedKeys.includes(item.key)}
        selectable={isSelectable(item)}
        onOpen={openSheet}
        onToggle={selectItem}
      />
    ),
    [isSelectable, openSheet, selectItem, selectedKeys, selecting],
  );

  if (guestBlock) {
    return (
      <View style={styles.root}>
        <HeroHeader eyebrow="Sharing" title={username} onBack={onBack} />
        <EmptyState title={guestBlock.title} hint={guestBlock.hint} />
      </View>
    );
  }
  if (shares === null && loadError) {
    return <ErrorState message={loadError} onRetry={() => void load()} />;
  }
  if (shares === null) return <LoadingState />;

  const theirCount = shares.sharedWithThem.length;
  const yourCount = shares.sharedWithYou.length;
  const directions: SegmentOption<FriendShareDirection>[] = [
    { value: "theySee", label: "You share", count: theirCount },
    {
      value: "youSee",
      label: "They share",
      count: yourCount,
      hue: canyonHue.shared,
    },
  ];

  return (
    <View style={styles.root}>
      <HeroHeader
        eyebrow="Sharing"
        title={username}
        onBack={onBack}
        value={String(theirCount)}
        valueSuffix={theirCount === 1 ? "item they can see" : "items they can see"}
      />

      <View style={styles.rail}>
        {selecting ? (
          <SelectionBar
            countLabel={shareSelectionCountLabel(selectedItems, direction)}
            showSelectAll={selectedItems.length < selectableItems.length}
            extra={
              direction === "theySee" ? (
                // Share these with someone ELSE — the same sheet Canyons and
                // Saved open, so nothing about the promise is worded here.
                <BulkShareButton online={online} onPress={() => setShareSheetOpen(true)} />
              ) : copyable.length > 0 ? (
                <IconButton
                  icon="copy"
                  accessibilityLabel={`Save a copy of ${copyable.length} selected canyons`}
                  color={online ? theme.accent : theme.textMuted}
                  onPress={() =>
                    online
                      ? runCopy(copyable)
                      : notify("Saving a copy needs a connection.", "error")
                  }
                />
              ) : null
            }
            onClear={clearSelection}
            onSelectAll={selectAll}
            // The bar's destructive slot, renamed per direction: these end a
            // GRANT, not a record, and a trash can here would promise to
            // destroy the canyon.
            deleteIcon={direction === "theySee" ? "user-minus" : "eye-off"}
            deleteLabel={
              direction === "theySee"
                ? `Unshare ${selectedItems.length} selected items from ${username}`
                : `Remove ${removable.length} selected items from your account`
            }
            onDelete={() => {
              if (!online) {
                notify("Changing sharing needs a connection.", "error");
                return;
              }
              if (direction === "theySee") {
                runUnshare(selectedItems);
                return;
              }
              if (removable.length === 0) {
                notify("Nothing in this selection can be removed here.", "error");
                return;
              }
              runRemove(removable);
            }}
          />
        ) : (
          <SegmentedControl
            options={directions}
            value={direction}
            onChange={changeDirection}
          />
        )}
      </View>

      {/* What this tab holds, in the plainest words available — the two lists
          are near-identical at a glance and the chips alone ("You share" /
          "They share") are read as a filter rather than as a direction. */}
      <View style={styles.note}>
        <Text style={styles.noteText} numberOfLines={2}>
          {direction === "theySee"
            ? `Items you have shared with ${username}.`
            : `Items ${username} has shared with you.`}
        </Text>
      </View>

      {loadError ? (
        <View style={styles.banner}>
          <ErrorBanner message={loadError} onRetry={() => void load()} />
        </View>
      ) : null}

      <FlatList
        style={styles.list}
        contentContainerStyle={styles.listContent}
        data={cards}
        keyExtractor={cardKey}
        renderItem={renderItem}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.accent}
          />
        }
        ListEmptyComponent={
          <EmptyState
            title={
              direction === "theySee"
                ? `You haven't shared anything with ${username}`
                : `${username} hasn't shared anything with you`
            }
            hint={
              direction === "theySee"
                ? "Share a canyon, waypoint, route or map from its own options."
                : undefined
            }
          />
        }
      />

      {/* Per-row verbs, titled with the item (§7). */}
      <BottomSheet
        visible={sheetCard !== null}
        onClose={() => setSheetCard(null)}
        title={sheetCard?.title ?? ""}
      >
        {sheetCard ? (
          <ShareCardMenu
            card={sheetCard}
            direction={direction}
            username={username}
            busy={busy}
            online={online}
            onOpenCanyon={(canyonId) => {
              setSheetCard(null);
              onOpenCanyon(canyonId);
            }}
            onUnshare={(card) => {
              setSheetCard(null);
              runUnshare([card]);
            }}
            onCopy={(card) => {
              setSheetCard(null);
              runCopy([card]);
            }}
            onRemove={(card) => {
              setSheetCard(null);
              runRemove([card]);
            }}
          />
        ) : null}
      </BottomSheet>

      {/* Re-sharing my own rows with other friends. The selection carries no
          `sendCopy` descriptors — everything here is a server-backed row — so
          the sheet's triage resolves to shares only. */}
      <BulkShareSheet
        visible={shareSheetOpen}
        selection={selectedItems.map((card) => ({
          key: card.key,
          share: { entityType: card.row.entityType, entityId: card.row.entityId },
        }))}
        online={online}
        onClose={() => setShareSheetOpen(false)}
        onDone={(report) => {
          setShareSheetOpen(false);
          clearSelection();
          notify(report.text, report.tone);
        }}
      />

      <Toast message={toast} onDismissed={() => setToast(null)} />
    </View>
  );
}

function ShareCardRow({
  card,
  selecting,
  selected,
  selectable,
  onOpen,
  onToggle,
}: {
  card: FriendShareCard;
  selecting: boolean;
  selected: boolean;
  selectable: boolean;
  onOpen: (card: FriendShareCard) => void;
  onToggle: (card: FriendShareCard) => void;
}) {
  const openOrToggle = () => (selecting && selectable ? onToggle(card) : onOpen(card));
  return (
    <Row
      icon={card.icon}
      hue={card.row.entityType === "canyon" ? undefined : canyonHue.shared}
      title={card.title}
      subtitle={card.subtitle}
      selected={selected}
      // While selecting, a row no group verb can act on (one that came with a
      // shared canyon) is greyed out and inert — the same dead look Saved gives
      // an asset this user may not delete, rather than a checkbox that refuses.
      disabled={selecting && !selectable}
      onPress={openOrToggle}
      onLongPress={() => (selectable ? onToggle(card) : onOpen(card))}
      right={
        selecting ? (
          <SelectionMark selected={selected} selectable={selectable} />
        ) : (
          <IconButton
            icon="more-horizontal"
            accessibilityLabel="What can I do with this?"
            onPress={() => onOpen(card)}
          />
        )
      }
    />
  );
}

function ShareCardMenu({
  card,
  direction,
  username,
  busy,
  online,
  onOpenCanyon,
  onUnshare,
  onCopy,
  onRemove,
}: {
  card: FriendShareCard;
  direction: FriendShareDirection;
  username: string;
  busy: boolean;
  online: boolean;
  onOpenCanyon: (canyonId: string) => void;
  onUnshare: (card: FriendShareCard) => void;
  onCopy: (card: FriendShareCard) => void;
  onRemove: (card: FriendShareCard) => void;
}) {
  const kind = SHARE_KIND_LABEL[card.row.entityType];
  // Dimmed with the reason, never hidden: sharing is the one thing on this
  // screen that needs the network, so it is the row a user would go looking
  // for and not find (DESIGN.md §10, `useShareRowProps`'s rule).
  const offline = { disabled: true, subtitle: "Needs a connection" } as const;
  const live = { disabled: busy };
  return (
    <View style={styles.menuBody}>
      {card.row.entityType === "canyon" ? (
        <Row
          icon="map-pin"
          title="Open canyon"
          onPress={() => onOpenCanyon(card.row.entityId)}
        />
      ) : null}

      {direction === "theySee" ? (
        <Row
          icon="user-minus"
          hue={theme.warning}
          title={`Unshare from ${username}`}
          subtitle={online ? `${username} stops seeing this ${kind}.` : undefined}
          {...(online ? live : offline)}
          onPress={() => onUnshare(card)}
        />
      ) : null}

      {card.copyable ? (
        <Row
          icon="copy"
          title="Save a copy"
          subtitle={
            online
              ? "Copies it into your own canyons, with its route. Yours to edit."
              : undefined
          }
          {...(online ? live : offline)}
          onPress={() => onCopy(card)}
        />
      ) : null}

      {direction === "youSee" && card.removable ? (
        <Row
          icon="eye-off"
          hue={theme.warning}
          title="Remove"
          subtitle={
            online ? removeRowSubtitle({ kindLabel: kind, friendName: username }) : undefined
          }
          {...(online ? live : offline)}
          onPress={() => onRemove(card)}
        />
      ) : null}

      {/* A verb that cannot deliver is absent WITH ITS REASON, rather than
          present and refused: removing the direct share of a row that also
          rides a shared canyon would appear to work and bring it straight
          back on the next pull. */}
      {card.blockedReason ? (
        <Text style={styles.menuNote}>{card.blockedReason}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.primary },
  // Both children are SEGMENTED_CONTROL_HEIGHT tall by construction, which is
  // what keeps the list still when the bar swaps in (DESIGN.md §7).
  rail: {
    paddingHorizontal: spacing(2),
    paddingTop: spacing(1.5),
    paddingBottom: spacing(1),
  },
  note: { paddingHorizontal: spacing(2), paddingBottom: spacing(1) },
  noteText: { color: theme.textMuted, fontSize: fontSize.sm, lineHeight: 17 },
  banner: { paddingHorizontal: spacing(2), paddingBottom: spacing(1) },
  list: { flex: 1 },
  listContent: {
    paddingHorizontal: spacing(2),
    gap: spacing(1),
    paddingBottom: spacing(4),
  },
  menuBody: { gap: spacing(1) },
  menuNote: { color: theme.textMuted, fontSize: fontSize.sm },
});
