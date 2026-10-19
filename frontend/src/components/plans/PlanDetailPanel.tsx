// A plan's page: "what do I need to know and do for this trip?" Drawn from
// `TRIP_PLAN_PAGE` and rendered from the one full fetch (GET /plans/:id).
// Every write refetches it: the plan is shared, and what someone else changed
// meanwhile is part of the answer. Verbs are `planVerbs.ts`, by role.
import { Fragment, useState, type ReactNode } from "react";
import {
  contractSectionKeys,
  planDeleteConfirm,
  planLeaveConfirm,
  planAddVerbLabel,
  planSectionDeleteConfirm,
  planVerbs,
  planVerbsFor,
  PLAN_ADD_VERBS,
  PLAN_VERBS,
  PLAN_SECTION_VERBS,
  todayDateKey,
  TRIP_PLAN_PAGE,
  TRIP_PLANS_LIST,
  tripPlanAddedByLine,
  tripPlanGoing,
  tripPlanLeaveState,
  tripPlanDatesLine,
  tripPlanIsOver,
  tripPlanNotice,
  tripTypeLabel,
  type PlanAddVerbId,
  type PlanSectionVerbId,
  type PlanVerb,
  type PlanVerbId,
  type SectionKeysOn,
  type TripPlanPageView,
  type TripPlanSectionView,
  type TripPlanView,
} from "@logjam/shared";
import {
  Button,
  ChipRail,
  EmptyState,
  ErrorState,
  Hero,
  IconButton,
  IconTile,
  LoadingState,
  Menu,
  Icon,
  Row,
  SectionHeader,
  StatusPill,
  type MenuEntry,
} from "../../ui";
import { useToast } from "../feedback/ToastProvider";
import { messageFromError } from "../../errors/messageFromError";
import ConfirmDialog from "../dialogs/ConfirmDialog";
import {
  archivePlan,
  createSection,
  deletePlan,
  deleteSection,
  leavePlan,
  patchPlan,
  patchSection,
  reorderSections,
  usePlan,
} from "../../plansApi";
import PlanDetailsDialog from "./PlanDetailsDialog";
import PlanSectionDialog from "./PlanSectionDialog";
import classes from "./plans.module.css";

const copy = TRIP_PLAN_PAGE.copy;

/** A verb list as menu entries, a rule above the first separated one. */
function menuEntries<Id extends string>(
  verbs: PlanVerb<Id>[],
  run: (id: Id) => void,
): MenuEntry[] {
  const entries: MenuEntry[] = [];
  let ruled = false;
  for (const verb of verbs) {
    if (verb.separated && !ruled && entries.length > 0) {
      entries.push({ id: `rule-${verb.id}`, separator: true });
      ruled = true;
    }
    entries.push({
      id: verb.id,
      label: verb.label,
      icon: verb.icon,
      danger: verb.danger,
      onSelect: () => run(verb.id),
      // Offered but not yet: the reason is on the item and in its name.
      ...(verb.disabledReason && {
        disabled: true,
        hint: verb.disabledReason,
        accessibleLabel: `${verb.label}, ${verb.disabledReason}`,
      }),
    });
  }
  return entries;
}

export default function PlanDetailPanel({
  planId,
  onBack,
  onPlansChanged,
  onStartTripLog,
}: {
  planId: string;
  onBack: () => void;
  /** Something the list shows changed (name, dates, archive, membership). */
  onPlansChanged: () => void;
  onStartTripLog: (plan: TripPlanView) => void;
}) {
  const toast = useToast();
  const { view, error, refetch } = usePlan(planId, toast.error);
  const [tab, setTab] = useState<TripPlanPageView>("writeUp");
  const [editing, setEditing] = useState(false);
  const [sectionOpen, setSectionOpen] = useState<{ id: string | null } | null>(
    null,
  );
  const [confirm, setConfirm] = useState<
    | { kind: "delete" | "leave" }
    | { kind: "section"; section: TripPlanSectionView }
    | null
  >(null);
  const [busy, setBusy] = useState(false);

  if (!view) {
    return (
      <div className={classes.root}>
        <Hero title={copy.loading} onBack={onBack} backLabel={copy.back} />
        <div className={classes.emptyArea} role="status">
          {error ? (
            <ErrorState message={error} onRetry={() => refetch()} />
          ) : (
            <LoadingState label={copy.loading} />
          )}
        </div>
      </div>
    );
  }

  const plan = view;
  const role = plan.myRole;
  const today = todayDateKey();
  const archived = plan.archivedAt != null;
  const over = tripPlanIsOver(plan, today);
  const unansweredRequired =
    plan.forms.find((form) => form.requiredToJoin && !form.myAnswer) ?? null;
  const notice = tripPlanNotice({ archived, unansweredRequired, over });

  async function run(
    action: () => Promise<unknown>,
    failure: string,
    success?: string,
  ) {
    setBusy(true);
    try {
      await action();
      if (success) toast.success(success);
      refetch();
      return true;
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, failure));
      refetch({ quiet: true });
      return false;
    } finally {
      setBusy(false);
    }
  }

  const planVerbRunners: Record<PlanVerbId, () => void> = {
    edit: () => setEditing(true),
    // Plain print until #549 adds the summary dialog.
    print: () => window.print(),
    tripLog: () => onStartTripLog(plan),
    archive: () =>
      void run(
        () => archivePlan(plan.id, true),
        copy.archiveFailed,
        copy.archived,
      ).then(onPlansChanged),
    unarchive: () =>
      void run(
        () => archivePlan(plan.id, false),
        copy.archiveFailed,
        copy.unarchived,
      ).then(onPlansChanged),
    leave: () => setConfirm({ kind: "leave" }),
    delete: () => setConfirm({ kind: "delete" }),
  };

  const addRunners: Record<PlanAddVerbId, () => void> = {
    section: () => setSectionOpen({ id: null }),
    copy: () => setTab("items"),
    form: () => setTab("forms"),
    invite: () => setTab("people"),
  };

  const moveSection = (index: number, by: -1 | 1) => {
    const ids = plan.sections.map((section) => section.id);
    [ids[index], ids[index + by]] = [ids[index + by], ids[index]];
    void run(() => reorderSections(plan.id, ids), copy.sectionMoveFailed);
  };

  const sectionVerbs = (index: number) =>
    planVerbsFor(PLAN_SECTION_VERBS, "web", role, { archived }).filter(
      (verb) =>
        (verb.id !== "moveUp" || index > 0) &&
        (verb.id !== "moveDown" || index < plan.sections.length - 1),
    );
  const sectionRunners = (
    section: TripPlanSectionView,
    index: number,
  ): Record<PlanSectionVerbId, () => void> => ({
    edit: () => setSectionOpen({ id: section.id }),
    moveUp: () => moveSection(index, -1),
    moveDown: () => moveSection(index, 1),
    delete: () => setConfirm({ kind: "section", section }),
  });

  const addVerbs = planVerbsFor(PLAN_ADD_VERBS, "web", role, { archived });
  const canAddSection = addVerbs.some((verb) => verb.id === "section");
  const heroVerbs = planVerbs("web", role, {
    archived,
    over,
    ...tripPlanLeaveState(plan),
  });

  const counts = {
    places: plan.places.length,
    ways: plan.routes.length + plan.files.length,
    maps: plan.geoPdfs.length,
  };

  // The plan's things, by kind, in the rows and hues their own pages use.
  const itemGroups = [
    {
      title: copy.itemsPlaces,
      rows: plan.places.map((place) => ({
        id: place.id,
        title: place.name,
        addedBy: place.addedBy,
        icon: "place" as const,
        hue: "var(--color-accent)",
      })),
    },
    {
      title: copy.itemsWays,
      rows: [
        ...plan.routes.map((route) => ({
          id: route.id,
          title: route.name,
          addedBy: route.addedBy,
          icon: "route" as const,
          hue: "var(--hue-route)",
        })),
        ...plan.files.map((file) => ({
          id: file.id,
          title: file.item.displayName ?? file.item.filename,
          addedBy: file.addedBy,
          icon: "importedFile" as const,
          hue: "var(--hue-import)",
        })),
      ],
    },
    {
      title: copy.itemsMaps,
      rows: plan.geoPdfs.map((pdf) => ({
        id: pdf.id,
        title: pdf.title,
        addedBy: pdf.addedBy,
        icon: "geoPdf" as const,
        hue: "var(--hue-geo-pdf)",
      })),
    },
  ].filter((group) => group.rows.length > 0);

  const going = tripPlanGoing(plan.members);
  const viewOptions = [
    { value: "writeUp" as const, label: copy.viewWriteUp },
    {
      value: "items" as const,
      label: copy.viewItems,
      count: counts.places + counts.ways + counts.maps,
    },
    {
      value: "forms" as const,
      label: copy.viewForms,
      count: plan.forms.length,
    },
    {
      value: "people" as const,
      label: copy.viewPeople,
      count: going.length,
    },
  ];

  const sections: Record<
    SectionKeysOn<typeof TRIP_PLAN_PAGE, "web">,
    ReactNode
  > = {
    hero: (
      <Hero
        title={plan.name}
        onBack={onBack}
        backLabel={copy.back}
        actions={
          <>
            {addVerbs.length > 0 && (
              <Menu
                label={copy.addMenu}
                placement="bottom-end"
                entries={addVerbs.map((verb) => ({
                  id: verb.id,
                  label: verb.label,
                  icon: verb.icon,
                  onSelect: addRunners[verb.id],
                }))}
                trigger={(props) => (
                  <Button
                    {...props}
                    compact
                    variant="filled"
                    icon="add"
                    trailingIcon="expand"
                  >
                    {copy.add}
                  </Button>
                )}
              />
            )}
            <Menu
              label={copy.actions}
              title={plan.name}
              placement="bottom-end"
              entries={menuEntries(heroVerbs, (id) => planVerbRunners[id]())}
              trigger={(props) => (
                <IconButton {...props} icon="overflow" label={copy.actions} />
              )}
            />
          </>
        }
      />
    ),
    notices: notice && (
      <div className={classes.notice}>
        <Icon idea={notice.icon} size={16} />
        <span className={classes.noticeText}>{notice.text}</span>
        {notice.kind === "over" && (
          <Button compact onClick={() => onStartTripLog(plan)}>
            {PLAN_VERBS.find((verb) => verb.id === "tripLog")!.label}
          </Button>
        )}
        {notice.kind === "answer" && (
          <Button compact onClick={() => setTab("forms")}>
            {copy.answer}
          </Button>
        )}
      </div>
    ),
    dates: (
      <p className={classes.datesLine}>
        {tripPlanDatesLine(plan, role, tripTypeLabel)}
      </p>
    ),
    views: (
      <div className={classes.rails}>
        <ChipRail
          label={copy.views}
          options={viewOptions}
          value={tab}
          onChange={setTab}
        />
      </div>
    ),
    writeUp: tab === "writeUp" && (
      <div className={classes.list}>
        {plan.sections.length === 0 ? (
          <EmptyState
            icon="notes"
            title={copy.writeUpEmpty}
            actions={
              canAddSection && (
                <Button
                  variant="filled"
                  icon="add"
                  onClick={() => setSectionOpen({ id: null })}
                >
                  {planAddVerbLabel("section")}
                </Button>
              )
            }
          />
        ) : (
          plan.sections.map((section, index) => (
            <section
              key={section.id}
              className={classes.section}
              aria-labelledby={`section-${section.id}`}
            >
              <div className={classes.sectionHead}>
                <h3
                  id={`section-${section.id}`}
                  className={classes.sectionTitle}
                >
                  {section.title}
                </h3>
                {sectionVerbs(index).length > 0 && (
                  <Menu
                    label={`Actions for ${section.title}`}
                    title={section.title}
                    placement="bottom-end"
                    entries={menuEntries(sectionVerbs(index), (id) =>
                      sectionRunners(section, index)[id](),
                    )}
                    trigger={(props) => (
                      <IconButton
                        {...props}
                        icon="overflow"
                        label={`Actions for ${section.title}`}
                      />
                    )}
                  />
                )}
              </div>
              {section.body ? (
                <p className={classes.body}>{section.body}</p>
              ) : (
                <p className={classes.note}>{copy.writeUpEmpty}</p>
              )}
            </section>
          ))
        )}
      </div>
    ),
    items: tab === "items" && (
      <div className={classes.list}>
        {itemGroups.length === 0 ? (
          <EmptyState icon="place" title={copy.itemsEmpty} />
        ) : (
          itemGroups.map((group) => (
            <Fragment key={group.title}>
              {/* A heading needs a second group to divide from. */}
              {itemGroups.length > 1 && (
                <SectionHeader title={group.title} count={group.rows.length} />
              )}
              {group.rows.map((row) => (
                <Row
                  key={row.id}
                  title={row.title}
                  subtitle={tripPlanAddedByLine(row.addedBy)}
                  leading={<IconTile icon={row.icon} hue={row.hue} />}
                />
              ))}
            </Fragment>
          ))
        )}
      </div>
    ),
    forms: tab === "forms" && (
      <div className={classes.list}>
        {plan.forms.length === 0 ? (
          <EmptyState
            icon="form"
            title={role === "leader" ? copy.formsEmptyLeader : copy.formsEmpty}
          />
        ) : (
          plan.forms.map((form) => (
            <Row
              key={form.id}
              title={form.title}
              subtitle={
                form.visibleTo === "leaders"
                  ? copy.seenByLeaders
                  : copy.seenByMembers
              }
              leading={<IconTile icon="form" hue="var(--hue-plan)" />}
              // Under the text: beside it, two pills squeeze the title.
              footer={
                form.requiredToJoin ? (
                  <>
                    <StatusPill label={copy.pillRequired} tone="outline" />
                    {!form.myAnswer && (
                      <StatusPill label={copy.pillNotAnswered} tone="warning" />
                    )}
                  </>
                ) : undefined
              }
            />
          ))
        )}
      </div>
    ),
    people: tab === "people" && (
      <div className={classes.list}>
        {going.map((member) => (
          <Row
            key={member.user.id}
            title={member.user.username}
            trailing={
              member.role !== "member" && (
                <StatusPill
                  label={
                    member.role === "leader"
                      ? TRIP_PLANS_LIST.copy.pillLeader
                      : TRIP_PLANS_LIST.copy.pillEditor
                  }
                  tone="outline"
                />
              )
            }
          />
        ))}
      </div>
    ),
  };

  const editingSection =
    sectionOpen?.id != null
      ? plan.sections.find((section) => section.id === sectionOpen.id)
      : undefined;
  const deleteCopy = planDeleteConfirm(plan.name, counts);
  const leaveCopy = planLeaveConfirm(plan.name);
  const sectionCopy =
    confirm?.kind === "section"
      ? planSectionDeleteConfirm(confirm.section.title)
      : null;

  return (
    <div className={classes.root}>
      {contractSectionKeys(TRIP_PLAN_PAGE, "web").map((key) => (
        <Fragment key={key}>{sections[key]}</Fragment>
      ))}

      <PlanDetailsDialog
        open={editing}
        plan={plan}
        onClose={() => setEditing(false)}
        onSubmit={async (_values, patch) => {
          try {
            await patchPlan(plan.id, patch);
          } catch (err) {
            // The dialog says it, above its submit.
            refetch({ quiet: true });
            throw err;
          }
          refetch();
          setEditing(false);
          onPlansChanged();
        }}
      />
      <PlanSectionDialog
        open={sectionOpen != null}
        section={editingSection}
        onStale={() => refetch({ quiet: true })}
        onClose={() => setSectionOpen(null)}
        onSubmit={async (values, patch) => {
          if (editingSection)
            await patchSection(plan.id, editingSection.id, patch);
          else await createSection(plan.id, values);
          setSectionOpen(null);
          refetch();
        }}
      />
      <ConfirmDialog
        open={confirm?.kind === "delete"}
        title={deleteCopy.confirmTitle}
        message={deleteCopy.confirmBody}
        confirmLabel={deleteCopy.confirmLabel}
        busy={busy}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          try {
            setBusy(true);
            await deletePlan(plan.id);
            toast.success(copy.deleted);
            setConfirm(null);
            onPlansChanged();
            onBack();
          } catch (err) {
            console.error(err);
            toast.error(messageFromError(err, copy.deleteFailed));
          } finally {
            setBusy(false);
          }
        }}
      />
      <ConfirmDialog
        open={confirm?.kind === "leave"}
        title={leaveCopy.confirmTitle}
        message={leaveCopy.confirmBody}
        confirmLabel={leaveCopy.confirmLabel}
        confirmColor="primary"
        busy={busy}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          try {
            setBusy(true);
            await leavePlan(plan.id);
            toast.success(copy.left);
            setConfirm(null);
            onPlansChanged();
            onBack();
          } catch (err) {
            console.error(err);
            toast.error(messageFromError(err, copy.leaveFailed));
          } finally {
            setBusy(false);
          }
        }}
      />
      <ConfirmDialog
        open={sectionCopy != null}
        title={sectionCopy?.confirmTitle}
        message={sectionCopy?.confirmBody}
        confirmLabel={sectionCopy?.confirmLabel}
        busy={busy}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm?.kind !== "section") return;
          const id = confirm.section.id;
          void run(
            () => deleteSection(plan.id, id),
            copy.sectionDeleteFailed,
            copy.sectionDeleted,
          ).then(() => setConfirm(null));
        }}
      />
    </div>
  );
}
