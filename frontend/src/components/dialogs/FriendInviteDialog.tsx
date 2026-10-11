import { useEffect, useState } from "react";
import {
  alreadyFriendsMessage,
  friendAcceptedMessage,
  friendInviteConfirm,
  FRIENDS,
} from "@logjam/shared";
import ConfirmDialog from "./ConfirmDialog";
import { useToast } from "../feedback/ToastProvider";
import { messageFromError } from "../../errors/messageFromError";
import { previewFriendInvite, redeemFriendInvite } from "../../placeUtils";
import {
  clearPendingFriendInvite,
  pendingFriendInvite,
} from "../../pendingFriendInvite";

const copy = FRIENDS.copy;

/**
 * Answers a friend invite link once its opener is signed in: names who it is
 * from and asks. Nothing is spent until they say yes, so a link opened by
 * accident, or by a preview fetcher, costs its sender nothing.
 */
function FriendInviteDialog({
  enabled,
  onFriended,
}: {
  enabled: boolean;
  onFriended: () => void;
}) {
  const toast = useToast();
  const [invite, setInvite] = useState<{
    token: string;
    username: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const token = pendingFriendInvite();
    if (!token) return;
    // Cleared before the answer, not after: a link that fails must not ask
    // again on every reload.
    clearPendingFriendInvite();
    previewFriendInvite(token)
      .then(({ inviter, alreadyFriends }) => {
        if (alreadyFriends) toast.info(alreadyFriendsMessage(inviter.username));
        else setInvite({ token, username: inviter.username });
      })
      .catch((err) => {
        console.error(err);
        toast.error(messageFromError(err, copy.inviteInvalid));
      });
  }, [enabled, toast]);

  async function accept() {
    if (!invite) return;
    setBusy(true);
    try {
      await redeemFriendInvite(invite.token);
      toast.success(friendAcceptedMessage(invite.username));
      onFriended();
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, copy.inviteInvalid));
    } finally {
      setBusy(false);
      setInvite(null);
    }
  }

  const words = invite ? friendInviteConfirm(invite.username) : null;
  return (
    <ConfirmDialog
      open={invite != null}
      title={words?.confirmTitle ?? ""}
      message={words?.confirmBody ?? null}
      confirmLabel={copy.inviteAccept}
      confirmColor="primary"
      busy={busy}
      onConfirm={() => void accept()}
      onClose={() => setInvite(null)}
    />
  );
}

export default FriendInviteDialog;
