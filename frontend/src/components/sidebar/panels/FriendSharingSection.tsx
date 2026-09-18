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
// THE TWO DIRECTIONS GET DIFFERENT VERBS, and that is the design, not an
// omission:
//   You share with them — yours. Per-row Unshare, and Unshare all, because
//     re-sharing is a couple of presses.
//   They share with you — theirs. Per-row Remove my access only, no bulk: only
//     the owner can grant it back, so a bulk version would be an unrecoverable
//     mis-press. Remove friend already revokes both directions at once.
// There is NO delete anywhere on this page: every verb here ends a GRANT, and a
// bin would promise to end the record.
//
// PRIVACY: usernames and item names only — the payload carries no coordinates
// and no notes. Nothing here is logged.
import { useCallback, useEffect, useMemo, useState } from "react";
import { FileText, MapPin, Mountain, PenLine, Users, type LucideIcon } from "lucide-react";
import {
  buildShareCards,
  SHARE_KIND_LABEL,
  shareCardItem,
  unshareAllConfirm,
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
  IconTile,
  Row,
  type ChipOption,
} from "../../../ui";
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

/* CONFIRMATION SCALES WITH BLAST RADIUS × COST OF RECOVERY, which is why only
   two of the three verbs have one:
     per-row unshare  → none. It is one press to share it again.
     unshare all      → confirm, below. Bulk, and re-sharing N items by hand hurts.
     remove my access → confirm, and `RemoveSharedButton` owns it: small, but
                        only the OWNER can undo it, and every web surface that
                        lists shared things asks that question with the same
                        words. This page used to word it itself. */

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
  const [shares, setShares] = useState<TFriendShares | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [direction, setDirection] = useState<FriendShareDirection>("theySee");
  const [confirmingUnshareAll, setConfirmingUnshareAll] = useState(false);

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

  /** One revoke, whichever kind and whichever side. `userId` is the friend for
   *  a forward unshare and "me" for dropping my own access — the alias both
   *  share endpoints have always accepted. */
  function revoke(card: FriendShareCard, userId: string): Promise<unknown> {
    return card.row.entityType === "place"
      ? unsharePlaceWith(card.row.entityId, userId)
      : unshareEntityWith(card.row.entityType, card.row.entityId, userId);
  }

  async function run(action: () => Promise<unknown>, failure: string, success: string) {
    setBusy(true);
    try {
      await action();
      toast.success(success);
      setConfirmingUnshareAll(false);
      load();
      onSharesChanged();
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, failure));
    } finally {
      setBusy(false);
    }
  }

  const cards = direction === "theySee" ? theirs : mine;
  const directions: ChipOption<FriendShareDirection>[] = [
    { value: "theySee", label: "You share", count: theirs.length },
    { value: "youSee", label: "They share", count: mine.length, hue: "var(--hue-shared)" },
  ];

  return (
    <div className={classes.root}>
      <Hero title={friend.username} onBack={onBack} backLabel="Back to friends" />

      <div className={classes.rails}>
        <ChipRail
          label="Which direction"
          options={directions}
          value={direction}
          onChange={setDirection}
        />
        {/* The two lists look alike at a glance, and the chips alone read as a
            filter rather than as a direction. */}
        <p className={classes.note}>
          {direction === "theySee"
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
            return (
              <Row
                key={card.key}
                leading={<IconTile icon={identity.icon} hue={identity.hue} />}
                title={card.title}
                subtitle={card.blockedReason ?? card.subtitle}
                disabled={busy}
                trailing={
                  direction === "theySee" ? (
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

          {direction === "theySee" && (
            <Button
              variant="outline"
              disabled={busy}
              className={classes.unshareAll}
              onClick={() => setConfirmingUnshareAll(true)}
            >
              Unshare all ({theirs.length})
            </Button>
          )}
        </div>
      )}

      {/* Impact-aware confirmation, from the one place that words it. */}
      <ConfirmDialog
        open={confirmingUnshareAll}
        title={
          unshareAllConfirm({
            count: theirs.length,
            friendName: friend.username,
            includesPlace: theirs.some((card) => card.row.entityType === "place"),
          }).title
        }
        message={
          unshareAllConfirm({
            count: theirs.length,
            friendName: friend.username,
            includesPlace: theirs.some((card) => card.row.entityType === "place"),
          }).body
        }
        confirmLabel={`Unshare all (${theirs.length})`}
        busy={busy}
        onConfirm={() =>
          void run(
            () =>
              unshareAllWithFriend(friend.friendshipId, theirs.map(shareCardItem)),
            "Couldn't unshare all. Please try again.",
            `${friend.username} can no longer see any of it.`,
          )
        }
        onClose={() => setConfirmingUnshareAll(false)}
      />
    </div>
  );
}

export default FriendSharingSection;
