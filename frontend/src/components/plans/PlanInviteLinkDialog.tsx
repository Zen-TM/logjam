// Answers a plan invite link once its opener is signed in (design §7.6), the
// `FriendInviteDialog` pattern: the pending token is cleared first, then
// previewed. Already in: the plan opens. Already asked: the list opens on the
// waiting row. Otherwise the join dialog asks, and nothing is spent until
// they press Ask to join.
import { useEffect, useState } from "react";
import {
  TRIP_PLAN_JOIN,
  tripPlanAskedMessage,
  type TripPlanLinkPreview,
} from "@logjam/shared";
import { useToast } from "../feedback/ToastProvider";
import { messageFromError } from "../../errors/messageFromError";
import { previewInviteLink, redeemInviteLink } from "../../plansApi";
import {
  clearPendingPlanInvite,
  pendingPlanInvite,
} from "../../pendingPlanInvite";
import PlanJoinDialog from "./PlanJoinDialog";

export default function PlanInviteLinkDialog({
  enabled,
  onOpenPlan,
  onShowPlans,
}: {
  enabled: boolean;
  onOpenPlan: (planId: string) => void;
  onShowPlans: () => void;
}) {
  const toast = useToast();
  const [invite, setInvite] = useState<{
    token: string;
    preview: TripPlanLinkPreview;
  } | null>(null);

  const ask = (token: string) =>
    previewInviteLink(token)
      .then((preview) => {
        if (preview.membership === "active") onOpenPlan(preview.planId);
        else if (preview.membership === "requested") onShowPlans();
        else setInvite({ token, preview });
      })
      .catch((err) => {
        console.error(err);
        toast.error(messageFromError(err, TRIP_PLAN_JOIN.copy.linkFailed));
      });

  useEffect(() => {
    if (!enabled) return;
    const token = pendingPlanInvite();
    if (!token) return;
    // Cleared before the answer, so a link that fails is not asked about
    // again on every reload.
    clearPendingPlanInvite();
    void ask(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  if (!invite) return null;
  const { token, preview } = invite;
  return (
    <PlanJoinDialog
      via="link"
      plan={{ ...preview, person: preview.leader.username }}
      onStale={() => void ask(token)}
      onClose={() => setInvite(null)}
      onJoin={async (answers) => {
        const result = await redeemInviteLink(token, answers);
        setInvite(null);
        if (result.status === "active") onOpenPlan(result.planId);
        else {
          toast.success(tripPlanAskedMessage(result.waitingFor.username));
          onShowPlans();
        }
      }}
    />
  );
}
