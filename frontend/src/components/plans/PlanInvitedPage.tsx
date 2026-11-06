// A plan a leader invited the user to by username: who invited them, what
// they would join (the write-up and who's going), with Join and Decline.
// Joining is theirs to choose, so nothing happens until they press Join,
// which joins at once. What the page says and in what order is
// `tripPlanInvitePage` and `TRIP_PLAN_PREVIEW`, shared with Logjam GPS.
import { Fragment, useEffect, useState, type ReactNode } from "react";
import {
  ApiError,
  contractSectionKeys,
  tripTypeLabel,
  TRIP_PLAN_JOIN,
  TRIP_PLAN_PAGE,
  TRIP_PLAN_PREVIEW,
  tripPlanInvitePage,
  type SectionKeysOn,
  type TripPlanInvitedPreview,
} from "@logjam/shared";
import {
  Avatar,
  Button,
  EmptyState,
  ErrorState,
  Hero,
  IconTile,
  LoadingState,
  Row,
  SectionHeader,
} from "../../ui";
import ConfirmDialog from "../dialogs/ConfirmDialog";
import { useToast } from "../feedback/ToastProvider";
import { messageFromError } from "../../errors/messageFromError";
import { getInvitedPreview, joinPlan, leavePlan } from "../../plansApi";
import WriteUpBody from "./WriteUpBody";
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
  const [gone, setGone] = useState(false);
  const [fetchCount, setFetchCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [declining, setDeclining] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getInvitedPreview(planId)
      .then((data) => !cancelled && setPreview(data))
      .catch((err) => {
        if (cancelled) return;
        // Withdrawn, joined elsewhere or deleted: the server says 404 for all.
        if (err instanceof ApiError && err.status === 404) return setGone(true);
        console.error(err);
        setError(messageFromError(err, TRIP_PLAN_PREVIEW.copy.loadFailed));
      });
    return () => {
      cancelled = true;
    };
  }, [planId, fetchCount]);

  async function join() {
    setBusy(true);
    try {
      await joinPlan(planId);
      toast.done(TRIP_PLAN_JOIN.copy.joined);
      onJoined();
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, TRIP_PLAN_JOIN.copy.joinFailed));
    } finally {
      setBusy(false);
    }
  }

  async function decline() {
    setBusy(true);
    try {
      await leavePlan(planId);
      toast.done(TRIP_PLAN_PREVIEW.copy.declined);
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
          {gone ? (
            <EmptyState icon="plan" title={TRIP_PLAN_PREVIEW.copy.gone} />
          ) : error ? (
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
  const page = tripPlanInvitePage(preview, tripTypeLabel);
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
        <p className={classes.datesLine}>{page.facts}</p>
      </>
    ),
    notice: (
      <div className={classes.noticeCard}>
        <Row
          leading={<IconTile icon="plan" hue="var(--hue-plan)" />}
          title={page.inviteTitle}
          subtitle={page.inviteHint}
          footer={
            <>
              <Button
                compact
                variant="filled"
                busy={busy}
                onClick={() => void join()}
              >
                {copy.join}
              </Button>
              <Button compact busy={busy} onClick={() => setDeclining(true)}>
                {copy.decline}
              </Button>
            </>
          }
        />
      </div>
    ),
    writeUp: page.writeUpEmpty ? (
      <p className={classes.note}>{page.writeUpEmpty}</p>
    ) : (
      page.sections.map((section) => (
        <section key={section.id} className={classes.section}>
          <h3 className={classes.sectionTitle}>{section.title}</h3>
          {section.body && (
            <WriteUpBody title={section.title} body={section.body} />
          )}
        </section>
      ))
    ),
    people: (
      <>
        <SectionHeader title={page.going.title} count={page.going.count} />
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
      <ConfirmDialog
        open={declining}
        copy={{
          confirmTitle: TRIP_PLAN_JOIN.copy.declineTitle,
          confirmBody: TRIP_PLAN_JOIN.copy.declineBody,
          confirmLabel: copy.decline,
          tone: "filled",
        }}
        busy={busy}
        onClose={() => setDeclining(false)}
        onConfirm={() => void decline().then(() => setDeclining(false))}
      />
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
    </div>
  );
}
