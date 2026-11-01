// Joining a plan, from a link or a leader's username invite: the name, the
// dates and who leads it, then the one press. Joining is the user's choice,
// so it still takes the press; no form stands in the way, since the plan's
// forms are answered from the plan itself. Drawn from `TRIP_PLAN_JOIN`.
import { Fragment, useState, type ReactNode } from "react";
import {
  contractSectionKeys,
  TRIP_PLAN_JOIN,
  tripPlanDatesLabel,
  tripPlanJoinTitle,
  type DateOnly,
  type SectionKeysOn,
} from "@logjam/shared";
import { Button, Dialog, ErrorBanner } from "../../ui";
import { messageFromError } from "../../errors/messageFromError";
import classes from "./plans.module.css";

const copy = TRIP_PLAN_JOIN.copy;

export default function PlanJoinDialog({
  plan,
  via,
  onJoin,
  onClose,
}: {
  plan: {
    name: string;
    startDate: DateOnly | null;
    endDate: DateOnly | null;
    /** "Leader: mira" for a link; "Invited by mira" for a username invite. */
    person: string | null;
  };
  via: "link" | "username";
  onJoin: () => Promise<void>;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await onJoin();
    } catch (err) {
      console.error(err);
      setError(messageFromError(err, copy.joinFailed));
    } finally {
      setBusy(false);
    }
  }

  const sections: Record<
    SectionKeysOn<typeof TRIP_PLAN_JOIN, "web">,
    ReactNode
  > = {
    hero: (
      <div className={classes.block}>
        <p className={classes.body}>
          {tripPlanDatesLabel(plan.startDate, plan.endDate)}
        </p>
        {plan.person && (
          <p className={classes.note}>
            {via === "link"
              ? `${copy.leader} ${plan.person}`
              : `${copy.invitedBy} ${plan.person}`}
          </p>
        )}
      </div>
    ),
  };

  return (
    <Dialog
      open
      size="small"
      title={tripPlanJoinTitle(plan.name)}
      onClose={onClose}
      dismissible={!busy}
      footer={
        <>
          <Button onClick={onClose} disabled={busy} disabledReason="Joining…">
            Cancel
          </Button>
          <Button variant="filled" busy={busy} onClick={() => void submit()}>
            {via === "link" ? copy.askToJoin : copy.join}
          </Button>
        </>
      }
    >
      <div className={classes.form}>
        {contractSectionKeys(TRIP_PLAN_JOIN, "web").map((key) => (
          <Fragment key={key}>{sections[key]}</Fragment>
        ))}
        {error && <ErrorBanner message={error} />}
      </div>
    </Dialog>
  );
}
