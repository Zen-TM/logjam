// Answers a plan invite link once its opener is signed in, the
// `FriendInviteDialog` pattern: the pending token is cleared first, then
// previewed. Already in: the plan opens. Invited by username: its preview
// opens, with Join and Decline (redeeming the link would join them at once,
// though the dialog says "Ask to join"). Already asked: the list opens on
// the waiting row. Otherwise the join dialog asks, and nothing is spent
// until they press Ask to join.
import { useEffect, useState } from "react";
import {
  TRIP_PLAN_JOIN,
  tripPlanAskedMessage,
  type TripPlanLinkPreview,
} from "@logjam/shared";
import { useToast } from "../feedback/ToastProvider";
import { messageFromError } from "../../errors/messageFromError";
import { previewInviteLink, redeemInviteLink } from "../../plansApi";
import { planInvite } from "../../pendingInvite";
import PlanJoinDialog from "./PlanJoinDialog";

export default function PlanInviteLinkDialog({
  enabled,
  onOpenPlan,
  onShowPlans,
}: {
  enabled: boolean;
  onOpenPlan: (planId: string, invited: boolean) => void;
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
        if (preview.membership === "active") onOpenPlan(preview.planId, false);
        else if (preview.membership === "invited")
          onOpenPlan(preview.planId, true);
        else if (preview.membership === "requested") onShowPlans();
        else setInvite({ token, preview });
      })
      .catch((err) => {
        console.error(err);
        toast.error(messageFromError(err, TRIP_PLAN_JOIN.copy.linkFailed));
      });

  useEffect(() => {
    if (!enabled) return;
    const token = planInvite.pending();
    if (!token) return;
    // Cleared before the answer, so a link that fails is not asked about
    // again on every reload.
    planInvite.clear();
    void ask(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  if (!invite) return null;
  const { token, preview } = invite;
  return (
    <PlanJoinDialog
      plan={{ ...preview, person: preview.leader.username }}
      onClose={() => setInvite(null)}
      onJoin={async () => {
        const result = await redeemInviteLink(token);
        setInvite(null);
        if (result.status === "active") onOpenPlan(result.planId, false);
        else {
          toast.success(tripPlanAskedMessage(result.waitingFor.username));
          onShowPlans();
        }
      }}
    />
  );
}
