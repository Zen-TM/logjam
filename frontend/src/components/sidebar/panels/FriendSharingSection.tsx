// One friend's sharing, both ways — "what does Bob see of mine, and what does
// he let me see?"
//
// Sharing is AUTHORED per item, from that item's own dialog, so nothing else in
// Logjam Web can answer the question from the person's side. Reached by opening
// a friend's row on the Friends page, which replaces the list: at 380px there
// is no room for both, and this is a page you go and read.
//
// EVERY KIND THE PAYLOAD CARRIES. It listed places only until 2026-09-18, and
// said so in a comment — "the sections say Places, so filter to places" — which
// made an audit answer its own question with a subset while Bob could also see
// a route, a LiDAR topo and a GeoPDF of yours. Which rows get which verb is
// `buildShareCards` in @logjam/shared, the same call Logjam GPS makes.
//
// SELECTION, LIKE EVERY OTHER LIST THAT ACTS IN BULK. The tile is the checkbox
// and the bar takes the rail's place at the same height (DESIGN.md §7), as on
// Places, Logs and the Inbox — and as on Logjam GPS's own FriendSharesScreen,
// which is the screen this one mirrors. It shipped instead with a per-row verb
// and one "Unshare all", which is the shape to notice: an all-or-nothing bulk
// verb in an app that lets you pick everywhere else, when the real sentence is
// "these five, not those eight" (operator, 2026-09-18).
//
// THE TWO DIRECTIONS GET DIFFERENT VERBS, and that is the design, not an
// omission:
//   You share with them — yours. Unshare, per row or over a selection, because
//     re-sharing is a couple of presses.
//   They share with you — theirs. Remove my access, and only from rows where
//     dropping it would change anything. Only the owner can grant it back.
// There is NO delete anywhere on this page: every verb here ends a GRANT, and a
// bin would promise to end the record.
//
// PRIVACY: usernames and item names only — the payload carries no coordinates
// and no notes. Nothing here is logged.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  EyeOff,
  FileText,
  ListChecks,
  MapPin,
  Mountain,
  PenLine,
  UserMinus,
  Users,
  type LucideIcon,
} from "lucide-react";
import {
  buildShareCards,
  removeAllConfirm,
  removeOutcomeMessage,
  SHARE_KIND_LABEL,
  shareCardItem,
  shareSelectionCountLabel,
  unshareAllConfirm,
  unshareOutcomeMessage,
  type FriendShareCard,
  type FriendShareDirection,
  type FriendShareRow,
} from "@logjam/shared";
import classes from "./FriendSharingSection.module.css";
import ConfirmDialog from "../../dialogs/ConfirmDialog";
import RemoveSharedButton from "../../common/RemoveSharedButton";
import { ErrorBanner } from "../../feedback/ErrorBanner";
import { useToast } from "../../feedback/ToastProvider";
import { messageFromError } from "../../../errors/messageFromError";
import {
  Button,
  ChipRail,
  EmptyState,
  Hero,
  IconButton,
  IconTile,
  Row,
  SelectionBar,
  TileCheckbox,
  type ChipOption,
} from "../../../ui";
import { idRange } from "./placesModel";
import type { TFriend, TFriendShares } from "../../../placeUtils";
import {
  getFriendShares,
  unshareAllWithFriend,
  unshareEntityWith,
  unsharePlaceWith,
} from "../../../placeUtils";

/** The glyph and hue per kind — lucide's four, the same identity these kinds
 *  wear on Ways and Maps. Per client, because an icon key resolves in one
 *  client's set and not the other's (root CLAUDE.md). */
const KIND_IDENTITY: Record<FriendShareRow["entityType"], { icon: LucideIcon; hue: string }> = {
  place: { icon: MapPin, hue: "var(--hue-shared)" },
  route: { icon: PenLine, hue: "var(--hue-route)" },
  topoJob: { icon: Mountain, hue: "var(--hue-overlay)" },
  geoPdfJob: { icon: FileText, hue: "var(--hue-geoPdf)" },
};

/* CONFIRMATION SCALES WITH BLAST RADIUS × COST OF RECOVERY, which is why the
   three verbs do not get the same treatment:
     per-row unshare  → none. It is one press to share it again.
     either verb in BULK → confirm, naming the count and what a place takes with
                        it. Re-sharing N by hand is punishing, and a selection
                        is the easiest thing on this page to get wrong.
     remove my access → confirm, and `RemoveSharedButton` owns it: small, but
                        only the OWNER can undo it, and every web surface that
                        lists shared things asks that question with the same
                        words. This page used to word it itself. */

/** Which bulk verb is waiting on an answer. */
type PendingBulk = "unshare" | "remove" | null;

function FriendSharingSection({
  friend,
  onBack,
  onSharesChanged,
}: {
  friend: TFriend;
  onBack: () => void;
  /** Fired after any successful revoke, so App can refetch the shared lists —
   *  something may have just left or entered them. */
  onSharesChanged: () => void;
}) {
  const toast = useToast();
  const rootRef = useRef<HTMLDivElement>(null);
  const [shares, setShares] = useState<TFriendShares | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [direction, setDirection] = useState<FriendShareDirection>("theySee");
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const selectionAnchor = useRef<string | null>(null);
  const [pendingBulk, setPendingBulk] = useState<PendingBulk>(null);

  const load = useCallback(() => {
    setError(null);
    getFriendShares(friend.friendshipId)
      .then(setShares)
      .catch((err) => {
        console.error(err);
        setError(messageFromError(err, "Couldn't load sharing for this friend."));
      });
  }, [friend.friendshipId]);

  useEffect(load, [load]);

  const theirs = useMemo(
    () =>
      buildShareCards(shares?.sharedWithThem ?? [], {
        direction: "theySee",
        friendName: friend.username,
      }),
    [shares, friend.username],
  );
  const mine = useMemo(
    () =>
      buildShareCards(shares?.sharedWithYou ?? [], {
        direction: "youSee",
        friendName: friend.username,
      }),
    [shares, friend.username],
  );

  const cards = direction === "theySee" ? theirs : mine;
  // A row a group verb cannot act on is not selectable: forward rows all
  // unshare, received rows only where Remove would change anything (one that
  // also rides a shared place would come straight back).
  const selectableKeys = useMemo(
    () => cards.filter((card) => direction === "theySee" || card.removable).map((card) => card.key),
    [cards, direction],
  );
  const selected = useMemo(() => {
    const picked = new Set(selectedKeys);
    return cards.filter((card) => picked.has(card.key));
  }, [cards, selectedKeys]);
  const selecting = selected.length > 0;

  const clearSelection = useCallback(() => {
    setSelectedKeys([]);
    selectionAnchor.current = null;
  }, []);

  // Changing direction is changing which list you are looking at, so a
  // selection made in the other one cannot survive it.
  const changeDirection = (next: FriendShareDirection) => {
    clearSelection();
    setDirection(next);
  };

  const toggleSelected = (key: string, extendRange: boolean) => {
    if (extendRange && selectionAnchor.current) {
      const range = idRange(selectableKeys, selectionAnchor.current, key);
      setSelectedKeys((current) => [...new Set([...current, ...range])]);
    } else {
      setSelectedKeys((current) =>
        current.includes(key) ? current.filter((other) => other !== key) : [...current, key],
      );
    }
    selectionAnchor.current = key;
  };

  // The same two keys the other lists answer to (PlacesPanel, the Inbox).
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !selecting) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, [role='menu'], dialog")) return;
      if (event.key === "Escape") {
        event.preventDefault();
        clearSelection();
      } else if (event.key.toLowerCase() === "a" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        setSelectedKeys(selectableKeys);
      }
    };
    root.addEventListener("keydown", onKeyDown);
    return () => root.removeEventListener("keydown", onKeyDown);
  }, [selecting, selectableKeys, clearSelection]);

  /** One revoke, whichever kind and whichever side. `userId` is the friend for
   *  a forward unshare and "me" for dropping my own access — the alias both
   *  share endpoints have always accepted. */
  function revoke(card: FriendShareCard, userId: string): Promise<unknown> {
    return card.row.entityType === "place"
      ? unsharePlaceWith(card.row.entityId, userId)
      : unshareEntityWith(card.row.entityType, card.row.entityId, userId);
  }

  async function run(action: () => Promise<unknown>, failure: string, success?: string) {
    setBusy(true);
    try {
      await action();
      if (success) toast.success(success);
      setPendingBulk(null);
      clearSelection();
      load();
      onSharesChanged();
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, failure));
    } finally {
      setBusy(false);
    }
  }

  /** The forward bulk: ONE call, naming exactly the rows that were ticked. The
   *  endpoint's no-body form means "everything, both tables", which is not what
   *  a selection asked for. */
  async function unshareSelected() {
    const picked = selected;
    await run(
      async () => {
        const { revokedCount } = await unshareAllWithFriend(
          friend.friendshipId,
          picked.map(shareCardItem),
        );
        toast.success(unshareOutcomeMessage({ revokedCount, friendName: friend.username }));
      },
      "Couldn't unshare those. Please try again.",
    );
  }

  /** The received bulk: no endpoint takes a list, so these go one at a time and
   *  the result reports what actually happened. A partial failure is normal
   *  (a row the owner revoked a moment ago) and must not read as total. */
  async function removeSelected() {
    const picked = selected.filter((card) => card.removable);
    setBusy(true);
    const failed: string[] = [];
    let removed = 0;
    for (const card of picked) {
      try {
        await revoke(card, "me");
        removed += 1;
      } catch (err) {
        console.error(err);
        failed.push(card.title);
      }
    }
    const outcome = removeOutcomeMessage({ removed, failed });
    if (outcome.tone === "error") toast.error(outcome.text);
    else toast.success(outcome.text);
    setPendingBulk(null);
    clearSelection();
    load();
    onSharesChanged();
    setBusy(false);
  }

  const directions: ChipOption<FriendShareDirection>[] = [
    { value: "theySee", label: "You share", count: theirs.length },
    { value: "youSee", label: "They share", count: mine.length, hue: "var(--hue-shared)" },
  ];

  return (
    <div className={classes.root} ref={rootRef}>
      <Hero title={friend.username} onBack={onBack} backLabel="Back to friends" />

      <div className={classes.rails}>
        {selecting ? (
          <SelectionBar
            countLabel={shareSelectionCountLabel(selected, direction)}
            onClear={clearSelection}
          >
            {selected.length < selectableKeys.length && (
              <IconButton
                icon={ListChecks}
                label={`Select all ${selectableKeys.length}`}
                onClick={() => setSelectedKeys(selectableKeys)}
              />
            )}
            {/* Neither verb is a bin: both end a grant, and the record outlives
                them. `user-minus` for "they stop seeing it", `eye-off` for "I
                stop seeing it" — the same two glyphs Logjam GPS uses here. */}
            {direction === "theySee" ? (
              <IconButton
                icon={UserMinus}
                label={`Unshare ${selected.length} from ${friend.username}`}
                disabled={busy}
                onClick={() => setPendingBulk("unshare")}
              />
            ) : (
              <IconButton
                icon={EyeOff}
                label={`Remove ${selected.filter((card) => card.removable).length} from your account`}
                disabled={busy}
                onClick={() => setPendingBulk("remove")}
              />
            )}
          </SelectionBar>
        ) : (
          <ChipRail
            label="Which direction"
            options={directions}
            value={direction}
            onChange={changeDirection}
          />
        )}
        {/* The two lists look alike at a glance, and the chips alone read as a
            filter rather than as a direction. */}
        <p className={classes.note}>
          {selecting
            ? "Shift-click to select a range · Ctrl+A selects all"
            : direction === "theySee"
              ? `Things you have shared with ${friend.username}.`
              : `Things ${friend.username} has shared with you.`}
        </p>
      </div>

      {error && (
        <div className={classes.banner}>
          <ErrorBanner message={error} onRetry={load} />
        </div>
      )}

      {!shares && !error ? (
        <p className={classes.loading}>Loading sharing…</p>
      ) : cards.length === 0 ? (
        <div className={classes.emptyArea}>
          <EmptyState
            icon={Users}
            title={
              direction === "theySee"
                ? `You haven't shared anything with ${friend.username}`
                : `${friend.username} hasn't shared anything with you`
            }
            body={
              direction === "theySee"
                ? "Share a place, a route or a map from its own Share button."
                : undefined
            }
          />
        </div>
      ) : (
        <div className={classes.list}>
          {cards.map((card) => {
            const identity = KIND_IDENTITY[card.row.entityType];
            const tile = <IconTile icon={identity.icon} hue={identity.hue} />;
            const isSelected = selectedKeys.includes(card.key);
            const selectable = selectableKeys.includes(card.key);
            return (
              <Row
                key={card.key}
                leading={
                  selectable ? (
                    <TileCheckbox
                      tile={tile}
                      label={`Select ${card.title}`}
                      checked={isSelected}
                      selecting={selecting}
                      onToggle={(extendRange) => toggleSelected(card.key, extendRange)}
                    />
                  ) : (
                    tile
                  )
                }
                title={card.title}
                subtitle={card.blockedReason ?? card.subtitle}
                selected={isSelected}
                // A row no group verb can act on is inert for the duration,
                // rather than a checkbox that refuses.
                disabled={busy || (selecting && !selectable)}
                trailing={
                  selecting ? undefined : direction === "theySee" ? (
                    <Button
                      compact
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () => revoke(card, friend.id),
                          "Couldn't remove share. Please try again.",
                          `${card.title} is no longer shared with ${friend.username}.`,
                        )
                      }
                    >
                      Unshare
                    </Button>
                  ) : card.removable ? (
                    <RemoveSharedButton
                      kindLabel={SHARE_KIND_LABEL[card.row.entityType]}
                      itemName={card.title}
                      ownerName={friend.username}
                      disabled={busy}
                      remove={() => revoke(card, "me")}
                      onRemoved={() => {
                        load();
                        onSharesChanged();
                      }}
                    />
                  ) : undefined
                }
              />
            );
          })}
        </div>
      )}

      {/* Impact-aware confirmations, from the one place that words them. */}
      <ConfirmDialog
        open={pendingBulk === "unshare"}
        title={
          unshareAllConfirm({
            count: selected.length,
            friendName: friend.username,
            includesPlace: selected.some((card) => card.row.entityType === "place"),
          }).title
        }
        message={
          unshareAllConfirm({
            count: selected.length,
            friendName: friend.username,
            includesPlace: selected.some((card) => card.row.entityType === "place"),
          }).body
        }
        confirmLabel={`Unshare ${selected.length}`}
        busy={busy}
        onConfirm={() => void unshareSelected()}
        onClose={() => setPendingBulk(null)}
      />

      <ConfirmDialog
        open={pendingBulk === "remove"}
        title={
          removeAllConfirm({
            count: selected.filter((card) => card.removable).length,
            friendName: friend.username,
            // ZERO on purpose: the sentence it unlocks offers to save a copy
            // first, and this screen has no copy verb to offer. Saying so
            // mid-confirm would send someone looking for a control that is on
            // the place's own page (Phase B package 6) and nowhere near here.
            copyableCount: 0,
          }).title
        }
        message={
          removeAllConfirm({
            count: selected.filter((card) => card.removable).length,
            friendName: friend.username,
            copyableCount: 0,
          }).body
        }
        confirmLabel="Remove"
        // Not `error`: removing a share destroys nothing, and a red button here
        // would say otherwise.
        confirmColor="primary"
        busy={busy}
        onConfirm={() => void removeSelected()}
        onClose={() => setPendingBulk(null)}
      />
    </div>
  );
}

export default FriendSharingSection;
