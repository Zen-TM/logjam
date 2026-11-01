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
  tripPlanBulkVerbConfirm,
  tripPlanBulkDone,
  tripPlanFormsToAnswerLine,
  tripPlanRowPill,
  TRIP_PLAN_PAGE,
  planDeleteConfirm,
  planLeaveConfirm,
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
  SelectionBar,
  TileCheckbox,
  LoadingState,
  Menu,
  Row,
  StatusPill,
} from "../../ui";
import { useToast } from "../feedback/ToastProvider";
import { messageFromError } from "../../errors/messageFromError";
import ConfirmDialog from "../dialogs/ConfirmDialog";
import { useRowSelection } from "../sidebar/panels/useRowSelection";
import { archivePlan, createPlan, deletePlan, leavePlan } from "../../plansApi";
import { bulkVerbs, listVerbs, type ListVerbId } from "./planListVerbs";
import { menuEntries } from "./planMenu";
import PlanDetailsDialog from "./PlanDetailsDialog";
import classes from "./plans.module.css";

const copy = TRIP_PLANS_LIST.copy;
const pageCopy = TRIP_PLAN_PAGE.copy;

const RUN: Record<ListVerbId, (id: string) => Promise<unknown>> = {
  archive: (id) => archivePlan(id, true),
  unarchive: (id) => archivePlan(id, false),
  leave: (id) => leavePlan(id),
  delete: (id) => deletePlan(id),
};

function confirmCopy({
  kind,
  plans,
}: {
  kind: "delete" | "leave";
  plans: TripPlanSummary[];
}) {
  const one =
    plans.length === 1
      ? kind === "delete"
        ? planDeleteConfirm(plans[0].name, { places: 0, ways: 0 })
        : planLeaveConfirm(plans[0].name)
      : tripPlanBulkVerbConfirm(kind, plans.length);
  return {
    title: one.confirmTitle,
    message: one.confirmBody,
    confirmLabel: one.confirmLabel,
  };
}

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

  // Only a plan you are in is selectable: an invite or a request has no verbs.
  const selectable = rows.filter((plan) => plan.status === "active");
  const { rootRef, selectedIds, selecting, toggle, clear } = useRowSelection(
    selectable.map((plan) => plan.id),
  );
  const selected = selectable.filter((plan) => selectedIds.includes(plan.id));
  const [confirm, setConfirm] = useState<{
    kind: "delete" | "leave";
    plans: TripPlanSummary[];
  } | null>(null);

  // One verb on one or many plans; the toast counts what went through.
  async function runVerb(verb: ListVerbId, plans: TripPlanSummary[]) {
    setBusyId("bulk");
    const results = await Promise.allSettled(
      plans.map((plan) => RUN[verb](plan.id)),
    );
    const done = results.filter((r) => r.status === "fulfilled").length;
    for (const r of results)
      if (r.status === "rejected") console.error(r.reason);
    if (plans.length === 1) {
      const failed = {
        archive: pageCopy.archiveFailed,
        unarchive: pageCopy.archiveFailed,
        leave: pageCopy.leaveFailed,
        delete: pageCopy.deleteFailed,
      }[verb];
      const worked = {
        archive: pageCopy.archived,
        unarchive: pageCopy.unarchived,
        leave: pageCopy.left,
        delete: pageCopy.deleted,
      }[verb];
      const rejected = results[0];
      if (rejected.status === "rejected")
        toast.error(messageFromError(rejected.reason, failed));
      else toast.success(worked);
    } else {
      (done === plans.length ? toast.success : toast.error)(
        tripPlanBulkDone(verb, done, plans.length),
      );
    }
    setBusyId(null);
    setConfirm(null);
    clear();
    onRefetch();
  }

  const runOrConfirm = (verb: ListVerbId, plans: TripPlanSummary[]) =>
    verb === "delete" || verb === "leave"
      ? setConfirm({ kind: verb, plans })
      : void runVerb(verb, plans);

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
        description={
          tripPlanFormsToAnswerLine(plan.unansweredForms) || undefined
        }
        selected={selectedIds.includes(plan.id)}
        leading={
          plan.status === "active" ? (
            <TileCheckbox
              tile={<IconTile icon="plan" hue="var(--hue-plan)" />}
              label={`Select ${plan.name}`}
              checked={selectedIds.includes(plan.id)}
              selecting={selecting}
              onToggle={(extendRange) => toggle(plan.id, extendRange)}
            />
          ) : (
            <IconTile icon="plan" hue="var(--hue-plan)" />
          )
        }
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
            {plan.status === "active" && !selecting && (
              <Menu
                label={`Actions for ${plan.name}`}
                title={plan.name}
                placement="right-start"
                entries={[
                  {
                    id: "open",
                    label: copy.open,
                    icon: "plan",
                    onSelect: () => onOpenPlan(plan.id, false),
                  },
                  ...menuEntries(listVerbs(plan), (verb) =>
                    runOrConfirm(verb, [plan]),
                  ),
                ]}
                trigger={(props) => (
                  <IconButton
                    {...props}
                    icon="overflow"
                    label={`Actions for ${plan.name}`}
                  />
                )}
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
        {selecting ? (
          <SelectionBar
            countLabel={`${selected.length} selected`}
            onClear={clear}
          >
            {bulkVerbs(selected).map((verb) => (
              <IconButton
                key={verb.id}
                icon={verb.icon}
                label={verb.label}
                tone={verb.danger ? "danger" : undefined}
                disabled={busyId != null}
                disabledReason="Working…"
                onClick={() => runOrConfirm(verb.id, selected)}
              />
            ))}
          </SelectionBar>
        ) : (
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
        )}
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
    <div ref={rootRef} className={classes.root}>
      {contractSectionKeys(TRIP_PLANS_LIST, "web").map((key) => (
        <Fragment key={key}>{sections[key]}</Fragment>
      ))}
      {confirm && (
        <ConfirmDialog
          open
          {...confirmCopy(confirm)}
          busy={busyId != null}
          onConfirm={() => void runVerb(confirm.kind, confirm.plans)}
          onClose={() => setConfirm(null)}
        />
      )}
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
