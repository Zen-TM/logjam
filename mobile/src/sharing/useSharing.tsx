// The state behind "share this thing with a friend": who has it, granting,
// revoking, and the door that closes when sharing is unavailable.
//
// Its only caller is `useSharePanel` (SharePanel.tsx), which is what every
// surface renders — the canyon screen, Saved's item sheet, the route sheet and
// the map's waypoint sheet. It exists for the reason assetActions.ts exists:
// two surfaces offering the same verb is how the two copies of "what does
// unsharing mean" drift apart (DESIGN.md §7). The API calls differ (canyons
// keep /canyons/:id/share, every other kind uses /shares), so they arrive as
// props; everything else — load, grant, revoke-with-confirm, busy state, the
// offline gate, the error copy — lives here once.
//
// The FRIEND list is not here: it is the panel's, because "send a copy" needs
// the same list with no share state behind it at all.
//
// ONLINE-ONLY, deliberately. Sharing is not an outbox operation: the outbox
// carries entity mutations, and queueing a permission grant to fire later
// would tell the user they had shared something when they had not. Offline the
// door is closed WITH ITS REASON in place of the subtitle (DESIGN.md §10)
// rather than hidden, so the feature does not appear to come and go.
//
// PRIVACY: recipients and friends are username-only (server-enforced). Error
// copy is OURS, never the server's message — interpolating a response into a
// row is how a canyon name reaches a screenshot (DESIGN.md §11).
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert } from "react-native";

import { messageFromError } from "@logjam/shared";

import { useAccountState } from "../auth/AccountStateContext";
import { shareCapabilityStatus } from "../auth/capabilities";
import type { Friend } from "../api/friends";
import type { ShareRecipient } from "../api/shares";
import { ErrorBanner, IconButton, Row } from "../ui";
import { theme } from "../theme";
import { FriendAvatar } from "./FriendAvatar";

/**
 * The three endpoints, for whichever kind this is.
 *
 * MUST be memoised on the item's identity, not rebuilt per render: this hook
 * reloads whenever it changes, and everything below captures it. `useSharePanel`
 * is the only caller and derives it from primitive ids for exactly that reason.
 */
export type SharingCalls = {
  /** Who this item is currently shared with. */
  load: () => Promise<ShareRecipient[]>;
  /** Grant one friend access. */
  grant: (userId: string) => Promise<unknown>;
  /** Revoke one recipient's access. */
  revoke: (userId: string) => Promise<unknown>;
};

export type Sharing = ReturnType<typeof useSharing>;

export { shareRowSubtitle } from "./shareRowSubtitle";

/**
 * Share state for one item. `enabled` gates the initial load so a sheet that
 * is not open (or a guest, who has no shares and no endpoint that would
 * answer) issues no request.
 */
export function useSharing({
  calls,
  online,
  onServer = true,
  enabled = true,
  itemLabel,
  revokeBody,
}: {
  calls: SharingCalls;
  online: boolean;
  /**
   * Does the ACCOUNT hold this row yet? False while its `create` op is still in
   * the outbox — the item exists on this phone only, so every endpoint below
   * answers 404. It closes the door with `needs-upload` in place of the
   * subtitle AND keeps the load from firing: a dimmed row that still fetches
   * has fixed half of it. Defaults true for the kinds that can only come from
   * the server (a LiDAR topo, a GeoPDF job).
   */
  onServer?: boolean;
  enabled?: boolean;
  /** The item's name, for the revoke confirm. */
  itemLabel: string;
  /** What the recipient loses, in this kind's words. */
  revokeBody: (username: string) => string;
}) {
  const [recipients, setRecipients] = useState<ShareRecipient[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const { accountState } = useAccountState();
  const shareStatus = shareCapabilityStatus(accountState, online, onServer);
  const canShare = shareStatus.status === "available";

  const load = useCallback(async () => {
    try {
      setRecipients(await calls.load());
      setLoadFailed(false);
    } catch (err) {
      // Degrade to a note rather than a hard error: the surface around this
      // renders offline, and sharing being unreachable must not block a read.
      console.error(err);
      setLoadFailed(true);
    }
    // Depends on `calls`, which is memoised on the item's ids — so switching
    // items reloads and nothing else does. It used to capture the FIRST
    // render's calls and never look again, which was invisible while every
    // caller mounted this hook alongside its item and broke the moment one
    // mounted it above the item (the panel then loaded from the placeholder
    // and reported "no share target" on open).
  }, [calls]);

  useEffect(() => {
    if (canShare && enabled) void load();
  }, [load, canShare, enabled]);

  const grant = useCallback(
    async (friend: Friend) => {
      setBusyId(friend.id);
      setActionError(null);
      try {
        await calls.grant(friend.id);
        await load();
        return true;
      } catch (err) {
        console.error(err);
        setActionError(messageFromError(err, "Couldn't share that."));
        return false;
      } finally {
        setBusyId(null);
      }
    },
    [calls, load],
  );

  const confirmRevoke = useCallback(
    (recipient: ShareRecipient) => {
      Alert.alert(
        `Stop sharing with ${recipient.sharedWith.username}?`,
        revokeBody(recipient.sharedWith.username),
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Unshare",
            style: "destructive",
            onPress: () => {
              setBusyId(recipient.id);
              setActionError(null);
              Promise.resolve(calls.revoke(recipient.sharedWith.id))
                .then(() => load())
                .catch((err: unknown) => {
                  console.error(err);
                  setActionError(
                    messageFromError(err, "Couldn't stop sharing that."),
                  );
                })
                .finally(() => setBusyId(null));
            },
          },
        ],
      );
    },
    [calls, load, revokeBody],
  );

  return {
    recipients,
    /** Ids that already have it — the panel drops them from the pick list. */
    sharedIds: new Set((recipients ?? []).map((r) => r.sharedWith.id)),
    busyId,
    actionError,
    loadFailed,
    canShare,
    shareStatus,
    itemLabel,
    load,
    grant,
    confirmRevoke,
  };
}

/**
 * Current recipients, each revocable. Empty render when there are none.
 *
 * `recipients` overrides the hook's own list so the panel can pass the ones
 * matching its search box; the canyon screen's at-a-glance section passes
 * nothing and gets them all.
 */
export function RecipientRows({
  sharing,
  recipients = sharing.recipients ?? [],
}: {
  sharing: Sharing;
  recipients?: ShareRecipient[];
}) {
  return (
    <>
      {recipients.map((recipient) => (
        <Row
          key={recipient.id}
          leading={<FriendAvatar username={recipient.sharedWith.username} />}
          title={recipient.sharedWith.username}
          right={
            sharing.busyId === recipient.id ? (
              <ActivityIndicator color={theme.accent} />
            ) : (
              <IconButton
                icon="x"
                color={theme.warning}
                accessibilityLabel={`Stop sharing with ${recipient.sharedWith.username}`}
                onPress={() => sharing.confirmRevoke(recipient)}
              />
            )
          }
        />
      ))}
    </>
  );
}

/** Whatever went wrong with the last grant/revoke, in our words. */
export function SharingError({ sharing }: { sharing: Sharing }) {
  return sharing.actionError ? (
    <ErrorBanner message={sharing.actionError} />
  ) : null;
}
