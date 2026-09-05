import { useState, useEffect, useCallback } from "react";
import { Typography } from "@mui/material";
import { ChevronLeft } from "lucide-react";
import classes from "./FriendSharingSection.module.css";
import ConfirmDialog from "../../dialogs/ConfirmDialog";
import { ErrorBanner } from "../../feedback/ErrorBanner";
import { useToast } from "../../feedback/ToastProvider";
import { messageFromError } from "../../../errors/messageFromError";
import { removeShareConfirm, shareRowTitle } from "@logjam/shared";
import type { TFriend, TFriendShares, TFriendShareRow } from "../../../canyonUtils";
import {
  getFriendShares,
  unshareAllWithFriend,
  unshareCanyonWith,
} from "../../../canyonUtils";

// Which confirmation is open. Confirmation scales with blast radius x cost of
// recovery, which is why only two of the three actions have one:
//  - forward per-row unshare  -> none. Matches ShareCanyonDialog, and you can
//    re-share it yourself in two clicks.
//  - forward "unshare all"    -> confirm. Bulk, and re-sharing N canyons by
//    hand is punishing.
//  - reverse "remove access"  -> confirm. Small, but only the OWNER can undo
//    it; you cannot restore your own access.
type PendingConfirm =
  | { kind: "unshare-all" }
  | { kind: "remove-mine"; row: TFriendShareRow }
  | null;

/**
 * The per-friend sharing audit (fix 24): "what does Bob see, and how do I take
 * it all back?". Sharing is authored per-canyon, so this is the only surface
 * that answers the question from the person's side.
 *
 * Two directions, deliberately asymmetric:
 *  - "Canyons you share with Bob"  — yours. Per-row unshare + bulk "Unshare all".
 *  - "Canyons Bob shares with you" — Bob's. Per-row "Remove my access" only;
 *    no bulk. Dropping your own access is supported by the API (the `me` alias
 *    on DELETE /canyons/:id/share/:userId), but only Bob can grant it back, so
 *    a bulk version would be an unrecoverable mis-tap. If you want Bob gone
 *    entirely, Remove Friend already revokes both directions.
 */
function FriendSharingSection({
  friend,
  onBack,
  onSharesChanged,
}: {
  friend: TFriend;
  onBack: () => void;
  // Fired after any successful revoke so App can refetch the shared-canyon list
  // (a canyon may have just left or entered it).
  onSharesChanged: () => void;
}) {
  const toast = useToast();
  const [shares, setShares] = useState<TFriendShares | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingConfirm>(null);

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

  // Canyon rows only: both section labels below say "Canyons", and the payload
  // now also carries waypoint/route/topo/GeoPDF shares (listed on Logjam GPS).
  // Filtering here rather than widening the sections keeps this panel's wording
  // true — and its Unshare all passes `theirs`, so it revokes exactly what it
  // showed.
  const theirs = (shares?.sharedWithThem ?? []).filter(
    (row) => row.entityType === "canyon",
  );
  const mine = (shares?.sharedWithYou ?? []).filter(
    (row) => row.entityType === "canyon",
  );

  async function handleUnshareOne(row: TFriendShareRow) {
    setBusy(true);
    try {
      await unshareCanyonWith(row.entityId, friend.id);
      toast.success(
        `${shareRowTitle(row)} is no longer shared with ${friend.username}.`,
      );
      load();
      onSharesChanged();
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, "Couldn't remove share. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  async function handleUnshareAll() {
    setBusy(true);
    try {
      const { revokedCount } = await unshareAllWithFriend(friend.friendshipId, theirs);
      toast.success(
        revokedCount === 1
          ? `1 canyon is no longer shared with ${friend.username}.`
          : `${revokedCount} canyons are no longer shared with ${friend.username}.`,
      );
      setPending(null);
      load();
      onSharesChanged();
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, "Couldn't unshare all. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  // "me" is the API's alias for the caller on DELETE /canyons/:id/share/:userId
  // — the sharee-side revoke it already supports.
  async function handleRemoveMyAccess(row: TFriendShareRow) {
    setBusy(true);
    try {
      await unshareCanyonWith(row.entityId, "me");
      toast.success(`You no longer have access to ${shareRowTitle(row)}.`);
      setPending(null);
      load();
      onSharesChanged();
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, "Couldn't remove your access. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={classes.root}>
      <button className={classes.backButton} onClick={onBack}>
        <ChevronLeft size={14} />
        Friends
      </button>
      <span className={classes.friendHeading}>{friend.username}</span>

      {error && <ErrorBanner message={error} onRetry={load} />}
      {!shares && !error && <span className={classes.caption}>Loading sharing…</span>}

      {shares && (
        <>
          <div className={classes.divider} />
          <span className={classes.sectionLabel}>
            Canyons you share with {friend.username} ({theirs.length})
          </span>
          {theirs.length === 0 ? (
            <span className={classes.caption}>
              You haven&rsquo;t shared any canyons with {friend.username}. Share one
              from its canyon page.
            </span>
          ) : (
            <>
              <div className={classes.shareList}>
                {theirs.map((row) => (
                  <div key={row.entityId} className={classes.shareRow}>
                    <span className={classes.canyonName} title={shareRowTitle(row)}>
                      {shareRowTitle(row)}
                    </span>
                    <button
                      className={classes.unshareButton}
                      disabled={busy}
                      onClick={() => handleUnshareOne(row)}
                    >
                      Unshare
                    </button>
                  </div>
                ))}
              </div>
              <button
                className={classes.unshareAllButton}
                disabled={busy}
                onClick={() => setPending({ kind: "unshare-all" })}
              >
                Unshare all ({theirs.length})
              </button>
            </>
          )}

          <div className={classes.divider} />
          <span className={classes.sectionLabel}>
            Canyons {friend.username} shares with you ({mine.length})
          </span>
          {mine.length === 0 ? (
            <span className={classes.caption}>
              {friend.username} hasn&rsquo;t shared any canyons with you.
            </span>
          ) : (
            <div className={classes.shareList}>
              {mine.map((row) => (
                <div key={row.entityId} className={classes.shareRow}>
                  <span className={classes.canyonName} title={shareRowTitle(row)}>
                    {shareRowTitle(row)}
                  </span>
                  <button
                    className={classes.unshareButton}
                    disabled={busy}
                    onClick={() => setPending({ kind: "remove-mine", row })}
                    title="Remove this shared canyon"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Impact-aware confirmation (the DeleteCustomFieldDialog precedent):
          name the blast radius and the recovery cost, don't just ask "sure?". */}
      <ConfirmDialog
        open={pending?.kind === "unshare-all"}
        title={`Unshare all with ${friend.username}?`}
        message={
          <>
            <Typography component="span" variant="body2" sx={{ display: "block" }}>
              {friend.username} will lose access to{" "}
              <b>
                {theirs.length} {theirs.length === 1 ? "canyon" : "canyons"}
              </b>
              , including their canyon-level notes and media. You stay friends,
              and canyons {friend.username} shares with you are unaffected.
            </Typography>
            <Typography
              component="span"
              variant="body2"
              sx={{ display: "block", mt: 1, color: "var(--theme-text-muted)" }}
            >
              There is no undo — restoring access means sharing each canyon
              again, one at a time. Unsharing won&rsquo;t remove copies{" "}
              {friend.username} has already made.
            </Typography>
          </>
        }
        confirmLabel={`Unshare all (${theirs.length})`}
        busy={busy}
        onConfirm={handleUnshareAll}
        onClose={() => setPending(null)}
      />

      {/* The SAME question the canyon panel, the waypoint list, the route
          panel and both phone sheets ask, from the one source that words it
          (removeShareConfirm) — this surface used to phrase it its own way. */}
      <ConfirmDialog
        open={pending?.kind === "remove-mine"}
        title={
          pending?.kind === "remove-mine"
            ? removeShareConfirm({
                kindLabel: "canyon",
                itemName: shareRowTitle(pending.row),
                ownerName: friend.username,
              }).title
            : ""
        }
        message={
          pending?.kind === "remove-mine" ? (
            <Typography component="span" variant="body2" sx={{ display: "block" }}>
              {
                removeShareConfirm({
                  kindLabel: "canyon",
                  itemName: shareRowTitle(pending.row),
                  ownerName: friend.username,
                }).body
              }
            </Typography>
          ) : null
        }
        confirmLabel="Remove"
        busy={busy}
        onConfirm={() =>
          pending?.kind === "remove-mine" && handleRemoveMyAccess(pending.row)
        }
        onClose={() => setPending(null)}
      />
    </div>
  );
}

export default FriendSharingSection;
