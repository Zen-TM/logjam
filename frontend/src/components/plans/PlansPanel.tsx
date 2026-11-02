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
  TRIP_PLAN_JOIN,
  TRIP_PLAN_BULK_DELETE_ADDED_LABEL,
  tripPlanBucket,
  listSelectionLabel,
  tripPlanBulkConfirm,
  tripPlanBulkOffers,
  tripPlanBulkDone,
  tripPlanFormsToAnswerLine,
  tripPlanFormsUrgent,
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
  Checkbox,
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
import { listVerbs, type ListVerbId } from "./planListVerbs";
import { menuEntries } from "./planMenu";
import PlanDetailsDialog from "./PlanDetailsDialog";
import classes from "./plans.module.css";

const copy = TRIP_PLANS_LIST.copy;
const pageCopy = TRIP_PLAN_PAGE.copy;

const RUN: Record<
  ListVerbId,
  (id: string, deleteAdded: boolean) => Promise<unknown>
> = {
  archive: (id) => archivePlan(id, true),
  unarchive: (id) => archivePlan(id, false),
  leave: (id, deleteAdded) => leavePlan(id, deleteAdded),
  delete: (id) => deletePlan(id),
};

function confirmCopy(plans: TripPlanSummary[], deleteAdded: boolean) {
  const { lead, leave } = tripPlanBulkOffers(plans);
  const one =
    plans.length === 1
      ? lead.length === 1
        ? planDeleteConfirm(plans[0].name, { places: 0, ways: 0 })
        : planLeaveConfirm(plans[0].name)
      : tripPlanBulkConfirm(
          { lead: lead.length, leave: leave.length },
          deleteAdded,
        );
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
  const offers = tripPlanBulkOffers(selected);
  const archiveVerb = selected[0] // one bucket, so all archived or none
    ? listVerbs(selected[0]).find(
        (verb) => verb.id === "archive" || verb.id === "unarchive",
      )
    : undefined;
  // Delete-or-leave: the plans you lead are deleted, the rest left.
  const [confirm, setConfirm] = useState<TripPlanSummary[] | null>(null);
  // Leaving keeps what you added unless this is ticked; it starts off.
  const [deleteAdded, setDeleteAdded] = useState(false);
  const ask = (plans: TripPlanSummary[]) => {
    setDeleteAdded(false);
    setConfirm(plans);
  };
  const [declining, setDeclining] = useState<TripPlanSummary | null>(null);

  // Each plan with the verb to run on it; the toast counts what went through.
  async function run(jobs: { verb: ListVerbId; plan: TripPlanSummary }[]) {
    setBusyId("bulk");
    const results = await Promise.allSettled(
      jobs.map(({ verb, plan }) => RUN[verb](plan.id, deleteAdded)),
    );
    for (const r of results)
      if (r.status === "rejected") console.error(r.reason);
    if (jobs.length === 1) {
      const { verb } = jobs[0];
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
      const lines = (["delete", "leave", "archive", "unarchive"] as const)
        .map((kind) => {
          const mine = results.filter((_, i) => jobs[i].verb === kind);
          return mine.length === 0
            ? null
            : tripPlanBulkDone(
                kind,
                mine.filter((r) => r.status === "fulfilled").length,
                mine.length,
              );
        })
        .filter(Boolean);
      (results.every((r) => r.status === "fulfilled")
        ? toast.success
        : toast.error)(lines.join(" "));
    }
    setBusyId(null);
    setConfirm(null);
    // The ones that went through stop being rows and drop out of the
    // selection; the ones that failed stay picked, to try again.
    if (results.every((r) => r.status === "fulfilled")) clear();
    onRefetch();
  }

  const byRole = (plans: TripPlanSummary[]) =>
    plans.map((plan) => ({
      plan,
      verb: (plan.role === "leader" ? "delete" : "leave") as ListVerbId,
    }));
  const runOrConfirm = (verb: ListVerbId, plans: TripPlanSummary[]) =>
    verb === "delete" || verb === "leave"
      ? ask(plans)
      : void run(plans.map((plan) => ({ plan, verb })));

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
            {plan.status === "active" && plan.unansweredForms > 0 && (
              <StatusPill
                label={tripPlanFormsToAnswerLine(plan.unansweredForms)}
                tone={
                  tripPlanFormsUrgent(plan.unansweredForms, plan, today)
                    ? "warning"
                    : "outline"
                }
              />
            )}
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
                onClick={() => setDeclining(plan)}
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
            countLabel={listSelectionLabel(selected.length)}
            onClear={clear}
          >
            {offers.archive && archiveVerb && (
              <IconButton
                icon={archiveVerb.icon}
                label={archiveVerb.label}
                disabled={busyId != null}
                disabledReason="Working…"
                onClick={() => runOrConfirm(archiveVerb.id, selected)}
              />
            )}
            <IconButton
              icon={offers.destructive ? "delete" : "leave"}
              label={offers.deleteLabel}
              tone={offers.destructive ? "danger" : undefined}
              disabled={busyId != null}
              disabledReason="Working…"
              onClick={() => ask(selected)}
            />
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
          {...confirmCopy(confirm, deleteAdded)}
          message={
            <>
              <p>{confirmCopy(confirm, deleteAdded).message}</p>
              {tripPlanBulkOffers(confirm).leave.length > 0 && (
                <Checkbox
                  label={TRIP_PLAN_BULK_DELETE_ADDED_LABEL}
                  checked={deleteAdded}
                  onChange={setDeleteAdded}
                />
              )}
            </>
          }
          confirmColor={
            tripPlanBulkOffers(confirm).lead.length > 0 || deleteAdded
              ? "error"
              : "primary"
          }
          busy={busyId != null}
          onConfirm={() => void run(byRole(confirm))}
          onClose={() => setConfirm(null)}
        />
      )}
      <ConfirmDialog
        open={declining != null}
        title={TRIP_PLAN_JOIN.copy.declineTitle}
        message={TRIP_PLAN_JOIN.copy.declineBody}
        confirmLabel={copy.decline}
        busy={busyId != null}
        onClose={() => setDeclining(null)}
        onConfirm={() => {
          const plan = declining;
          if (plan) void dropMembership(plan).then(() => setDeclining(null));
        }}
      />
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
