// A plan a leader invited the user to by username (design §7.6): what they
// would join (the write-up, who's going, the forms they answer first) with
// Join and Decline. Joining is theirs to choose (O-14), so nothing happens
// until they press Join.
import { useEffect, useState } from "react";
import {
  TRIP_PLAN_JOIN,
  TRIP_PLAN_PAGE,
  TRIP_PLANS_LIST,
  tripPlanDatesLabel,
  type TripPlanInvitedPreview,
} from "@logjam/shared";
import {
  Avatar,
  Button,
  ErrorState,
  Hero,
  LoadingState,
  Row,
  SectionHeader,
} from "../../ui";
import { useToast } from "../feedback/ToastProvider";
import { messageFromError } from "../../errors/messageFromError";
import { getInvitedPreview, joinPlan, leavePlan } from "../../plansApi";
import PlanJoinDialog from "./PlanJoinDialog";
import classes from "./plans.module.css";

export default function PlanInvitedPage({
  planId,
  onBack,
  onJoined,
  onDeclined,
}: {
  planId: string;
  onBack: () => void;
  onJoined: () => void;
  onDeclined: () => void;
}) {
  const toast = useToast();
  const [preview, setPreview] = useState<TripPlanInvitedPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fetchCount, setFetchCount] = useState(0);
  const [joining, setJoining] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getInvitedPreview(planId)
      .then((data) => !cancelled && setPreview(data))
      .catch((err) => {
        console.error(err);
        if (!cancelled)
          setError(messageFromError(err, TRIP_PLAN_PAGE.copy.loadFailed));
      });
    return () => {
      cancelled = true;
    };
  }, [planId, fetchCount]);

  async function decline() {
    setBusy(true);
    try {
      await leavePlan(planId);
      toast.success(TRIP_PLANS_LIST.copy.declined);
      onDeclined();
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, TRIP_PLANS_LIST.copy.declineFailed));
    } finally {
      setBusy(false);
    }
  }

  if (!preview)
    return (
      <div className={classes.root}>
        <Hero
          title={TRIP_PLAN_PAGE.copy.loading}
          onBack={onBack}
          backLabel={TRIP_PLAN_PAGE.copy.back}
        />
        <div className={classes.emptyArea} role="status">
          {error ? (
            <ErrorState
              message={error}
              onRetry={() => setFetchCount((n) => n + 1)}
            />
          ) : (
            <LoadingState label={TRIP_PLAN_PAGE.copy.loading} />
          )}
        </div>
      </div>
    );

  return (
    <div className={classes.root}>
      <Hero
        title={preview.name}
        onBack={onBack}
        backLabel={TRIP_PLAN_PAGE.copy.back}
      />
      <p className={classes.datesLine}>
        {[
          tripPlanDatesLabel(preview.startDate, preview.endDate),
          preview.invitedBy &&
            `${TRIP_PLAN_JOIN.copy.invitedBy} ${preview.invitedBy.username}`,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      <div className={classes.notice}>
        <span className={classes.noticeText}>
          {preview.requiredForms.length > 0
            ? TRIP_PLAN_JOIN.copy.answerToJoin
            : TRIP_PLANS_LIST.copy.pillInvited}
        </span>
        <Button compact variant="filled" onClick={() => setJoining(true)}>
          {TRIP_PLAN_JOIN.copy.join}
        </Button>
        <Button compact busy={busy} onClick={() => void decline()}>
          {TRIP_PLAN_JOIN.copy.decline}
        </Button>
      </div>
      <div className={classes.list}>
        {preview.sections.map((section) => (
          <section key={section.id} className={classes.section}>
            <h3 className={classes.sectionTitle}>{section.title}</h3>
            {section.body && <p className={classes.body}>{section.body}</p>}
          </section>
        ))}
        {/* A heading needs a second group to divide from: the write-up. */}
        {preview.sections.length > 0 && (
          <SectionHeader
            title={TRIP_PLAN_PAGE.copy.peopleGoing}
            count={preview.members.length}
          />
        )}
        {preview.members.map((member) => (
          <Row
            key={member.id}
            title={member.username}
            leading={<Avatar username={member.username} />}
          />
        ))}
      </div>
      {joining && (
        <PlanJoinDialog
          via="username"
          plan={{
            ...preview,
            person: preview.invitedBy?.username ?? null,
          }}
          onStale={() => setFetchCount((n) => n + 1)}
          onClose={() => setJoining(false)}
          onJoin={async (answers) => {
            await joinPlan(planId, answers);
            setJoining(false);
            onJoined();
          }}
        />
      )}
    </div>
  );
}
