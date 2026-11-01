// A plan a leader invited the user to by username: what they
// would join (the write-up and who's going) with
// Join and Decline. Joining is theirs to choose, so nothing happens
// until they press Join.
import { Fragment, useEffect, useState, type ReactNode } from "react";
import {
  contractSectionKeys,
  TRIP_PLAN_PAGE,
  TRIP_PLAN_PREVIEW,
  tripPlanInvitedLine,
  tripPlanPreviewHeaded,
  type SectionKeysOn,
  type TripPlanInvitedPreview,
} from "@logjam/shared";
import {
  Avatar,
  Button,
  ErrorState,
  Hero,
  IconTile,
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
          setError(messageFromError(err, TRIP_PLAN_PREVIEW.copy.loadFailed));
      });
    return () => {
      cancelled = true;
    };
  }, [planId, fetchCount]);

  async function decline() {
    setBusy(true);
    try {
      await leavePlan(planId);
      toast.success(TRIP_PLAN_PREVIEW.copy.declined);
      onDeclined();
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, TRIP_PLAN_PREVIEW.copy.declineFailed));
    } finally {
      setBusy(false);
    }
  }

  if (!preview)
    return (
      <div className={classes.root}>
        <Hero
          title={TRIP_PLAN_PREVIEW.copy.loading}
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
            <LoadingState label={TRIP_PLAN_PREVIEW.copy.loading} />
          )}
        </div>
      </div>
    );

  const copy = TRIP_PLAN_PREVIEW.copy;
  // A heading needs a second group to divide from: the write-up.
  const headed = tripPlanPreviewHeaded(preview);
  const sections: Record<
    SectionKeysOn<typeof TRIP_PLAN_PREVIEW, "web">,
    ReactNode
  > = {
    hero: (
      <>
        <Hero
          title={preview.name}
          onBack={onBack}
          backLabel={TRIP_PLAN_PAGE.copy.back}
        />
        <p className={classes.datesLine}>{tripPlanInvitedLine(preview)}</p>
      </>
    ),
    notice: (
      <div className={classes.noticeCard}>
        <Row
          leading={<IconTile icon="plan" hue="var(--hue-plan)" />}
          title={copy.invited}
          footer={
            <>
              <Button compact variant="filled" onClick={() => setJoining(true)}>
                {copy.join}
              </Button>
              <Button compact busy={busy} onClick={() => void decline()}>
                {copy.decline}
              </Button>
            </>
          }
        />
      </div>
    ),
    writeUp: preview.sections.map((section) => (
      <section key={section.id} className={classes.section}>
        <h3 className={classes.sectionTitle}>{section.title}</h3>
        {section.body && <p className={classes.body}>{section.body}</p>}
      </section>
    )),
    people: (
      <>
        {headed && (
          <SectionHeader title={copy.people} count={preview.members.length} />
        )}
        {preview.members.map((member) => (
          <Row
            key={member.id}
            title={member.username}
            leading={<Avatar username={member.username} />}
          />
        ))}
      </>
    ),
  };
  // The hero and the notice stand above the list, the rest inside it.
  const above = new Set<string>(["hero", "notice"]);
  const keys = contractSectionKeys(TRIP_PLAN_PREVIEW, "web");

  return (
    <div className={classes.root}>
      {keys
        .filter((key) => above.has(key))
        .map((key) => (
          <Fragment key={key}>{sections[key]}</Fragment>
        ))}
      <div className={classes.list}>
        {keys
          .filter((key) => !above.has(key))
          .map((key) => (
            <Fragment key={key}>{sections[key]}</Fragment>
          ))}
      </div>
      {joining && (
        <PlanJoinDialog
          via="username"
          plan={{
            ...preview,
            person: preview.invitedBy?.username ?? null,
          }}
          onClose={() => setJoining(false)}
          onJoin={async () => {
            await joinPlan(planId);
            setJoining(false);
            onJoined();
          }}
        />
      )}
    </div>
  );
}
