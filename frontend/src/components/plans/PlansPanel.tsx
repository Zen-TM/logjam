// Plans: "what trips am I getting ready for?" One rail partitions Upcoming /
// Past / Archived over one list. A plan's row opens its page; an invite asks
// its question in the row's footer (shared/DESIGN.md §9), and a request
// waiting on a leader says who it waits for. Drawn from `TRIP_PLANS_LIST`.
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  PLAN_REQUEST_VERBS,
  contractSectionKeys,
  sortTripPlans,
  todayDateKey,
  TRIP_PLANS_LIST,
  tripPlanBucket,
  tripPlanRowPill,
  tripPlanRowSubtitle,
  tripPlansEmpty,
  type SectionKeysOn,
  type TripPlanBucket,
  type TripPlanSummary,
} from "@logjam/shared";
import {
  Button,
  ChipRail,
  EmptyState,
  ErrorState,
  Hero,
  IconButton,
  IconTile,
  ListEnd,
  LoadingState,
  Menu,
  Row,
  StatusPill,
} from "../../ui";
import { useToast } from "../feedback/ToastProvider";
import { messageFromError } from "../../errors/messageFromError";
import { createPlan, leavePlan } from "../../plansApi";
import PlanDetailsDialog from "./PlanDetailsDialog";
import classes from "./plans.module.css";

const copy = TRIP_PLANS_LIST.copy;

export default function PlansPanel({
  plans,
  loaded,
  error,
  onRefetch,
  onOpenPlan,
}: {
  plans: TripPlanSummary[];
  loaded: boolean;
  error: string | null;
  onRefetch: () => void;
  /** Open a plan's page; an invited row opens its preview. */
  onOpenPlan: (id: string, invited: boolean) => void;
}) {
  const toast = useToast();
  const [bucket, setBucket] = useState<TripPlanBucket>("upcoming");
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // On every open: an invite or an approval that arrived mid-session shows
  // without a reload.
  useEffect(() => {
    onRefetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const today = todayDateKey();
  const byBucket = useMemo(() => {
    const groups: Record<TripPlanBucket, TripPlanSummary[]> = {
      upcoming: [],
      past: [],
      archived: [],
    };
    for (const plan of plans) groups[tripPlanBucket(plan, today)].push(plan);
    return groups;
  }, [plans, today]);
  const rows = sortTripPlans(byBucket[bucket], bucket);

  // Decline an invite, withdraw a request: the same call, by status.
  async function dropMembership(plan: TripPlanSummary) {
    const declining = plan.status === "invited";
    setBusyId(plan.id);
    try {
      await leavePlan(plan.id);
      toast.success(declining ? copy.declined : copy.withdrawn);
      onRefetch();
    } catch (err) {
      console.error(err);
      toast.error(
        messageFromError(
          err,
          declining ? copy.declineFailed : copy.withdrawFailed,
        ),
      );
    } finally {
      setBusyId(null);
    }
  }

  const newPlanButton = (
    <Button variant="filled" icon="add" onClick={() => setCreating(true)}>
      {copy.add}
    </Button>
  );

  const renderRow = (plan: TripPlanSummary) => {
    const pill = tripPlanRowPill(plan);
    return (
      <Row
        key={plan.id}
        title={plan.name}
        subtitle={tripPlanRowSubtitle(plan)}
        leading={<IconTile icon="plan" hue="var(--hue-plan)" />}
        // A request has nothing to open yet: the plan is the leaders' to show.
        onOpen={
          plan.status === "requested"
            ? undefined
            : () => onOpenPlan(plan.id, plan.status === "invited")
        }
        trailing={
          <>
            {pill && (
              <StatusPill
                label={pill}
                tone={plan.status === "active" ? "outline" : "accent"}
              />
            )}
            {plan.status === "requested" && (
              <Menu
                label={`Actions for ${plan.name}`}
                title={plan.name}
                placement="right-start"
                entries={PLAN_REQUEST_VERBS.map((verb) => ({
                  id: verb.id,
                  label: verb.label,
                  icon: verb.icon,
                  onSelect: () => void dropMembership(plan),
                }))}
                trigger={(props) => (
                  <IconButton
                    {...props}
                    icon="overflow"
                    label={`Actions for ${plan.name}`}
                  />
                )}
              />
            )}
          </>
        }
        footer={
          plan.status === "invited" ? (
            <>
              <Button compact onClick={() => onOpenPlan(plan.id, true)}>
                {copy.open}
              </Button>
              <Button
                compact
                variant="outline"
                busy={busyId === plan.id}
                onClick={() => void dropMembership(plan)}
              >
                {copy.decline}
              </Button>
            </>
          ) : undefined
        }
      />
    );
  };

  const empty =
    loaded && rows.length === 0 && tripPlansEmpty(plans.length, bucket);

  const sections: Record<
    SectionKeysOn<typeof TRIP_PLANS_LIST, "web">,
    ReactNode
  > = {
    hero: (
      <Hero
        title={TRIP_PLANS_LIST.title}
        actions={
          <Button
            compact
            variant="filled"
            icon="add"
            onClick={() => setCreating(true)}
          >
            {copy.add}
          </Button>
        }
      />
    ),
    buckets: plans.length > 0 && (
      <div className={classes.rails}>
        <ChipRail
          label={copy.buckets}
          value={bucket}
          onChange={setBucket}
          options={(
            [
              ["upcoming", copy.bucketUpcoming],
              ["past", copy.bucketPast],
              ["archived", copy.bucketArchived],
            ] as const
          ).map(([value, label]) => ({
            value,
            label,
            count: byBucket[value].length,
          }))}
        />
      </div>
    ),
    list: !loaded ? (
      <div className={classes.emptyArea} role="status">
        <LoadingState label={copy.loading} />
      </div>
    ) : error && plans.length === 0 ? (
      <div className={classes.emptyArea}>
        <ErrorState message={error} onRetry={onRefetch} />
      </div>
    ) : empty ? (
      <div className={classes.emptyArea}>
        <EmptyState
          icon={empty.icon}
          title={empty.title}
          body={empty.body}
          actions={newPlanButton}
        />
      </div>
    ) : (
      <div className={classes.list}>
        {rows.map(renderRow)}
        <ListEnd>{newPlanButton}</ListEnd>
      </div>
    ),
  };

  return (
    <div className={classes.root}>
      {contractSectionKeys(TRIP_PLANS_LIST, "web").map((key) => (
        <Fragment key={key}>{sections[key]}</Fragment>
      ))}
      <PlanDetailsDialog
        open={creating}
        onClose={() => setCreating(false)}
        onSubmit={async (values) => {
          const made = await createPlan(values);
          setCreating(false);
          onRefetch();
          onOpenPlan(made.id, false);
        }}
      />
    </div>
  );
}
