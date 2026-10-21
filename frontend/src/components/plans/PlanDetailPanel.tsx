// A plan's page: "what do I need to know and do for this trip?" Drawn from
// `TRIP_PLAN_PAGE` and rendered from the one full fetch (GET /plans/:id).
// Every write refetches it: the plan is shared, and what someone else changed
// meanwhile is part of the answer. Verbs are `planVerbs.ts`, by role.
import { Fragment, useRef, useState, type ReactNode } from "react";
import {
  contractSectionKeys,
  PLAN_FORM_VERBS,
  planDeleteConfirm,
  formatBytes,
  planLeaveConfirm,
  planAddVerbLabel,
  planLeaveDeleteAddedLabel,
  planFormDeleteConfirm,
  planSectionDeleteConfirm,
  planVerbs,
  planVerbsFor,
  PLAN_ADD_VERBS,
  PLAN_VERBS,
  PLAN_SECTION_VERBS,
  todayDateKey,
  TRIP_PLAN_FORMS,
  TRIP_PLAN_PAGE,
  tripPlanGoing,
  tripPlanLeaveState,
  tripPlanDatesLine,
  tripPlanIsDated,
  tripPlanIsOver,
  tripPlanNotice,
  tripTypeLabel,
  type PlanAddVerbId,
  type PlanFormVerbId,
  type PlanSectionVerbId,
  type PlanVerbId,
  type SectionKeysOn,
  type TripPlanPageView,
  type TripPlanFormView,
  type TripPlanItem,
  type TripPlanSectionView,
  type TripPlanView,
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
  LoadingState,
  ListEnd,
  Menu,
  Icon,
  Row,
  StatusPill,
} from "../../ui";
import { useToast } from "../feedback/ToastProvider";
import { messageFromError } from "../../errors/messageFromError";
import ConfirmDialog from "../dialogs/ConfirmDialog";
import {
  archivePlan,
  createForm,
  createSection,
  deleteForm,
  deletePlan,
  deleteSection,
  leavePlan,
  patchForm,
  patchPlan,
  patchSection,
  putAnswer,
  reorderSections,
} from "../../plansApi";
import PlanDetailsDialog from "./PlanDetailsDialog";
import PlanSectionDialog from "./PlanSectionDialog";
import PlanAnswerDialog from "./PlanAnswerDialog";
import PlanFormBuilderDialog from "./PlanFormBuilderDialog";
import PlanFormPage from "./PlanFormPage";
import PlanPrintDialog from "./PlanPrintDialog";
import PlanPeople from "./PlanPeople";
import PlanInvitePage from "./PlanInvitePage";
import PlanItems from "./PlanItems";
import { addedBy } from "./plansModel";
import { menuEntries } from "./planMenu";
import classes from "./plans.module.css";

const copy = TRIP_PLAN_PAGE.copy;
const formsCopy = TRIP_PLAN_FORMS.copy;

export default function PlanDetailPanel({
  view,
  error,
  refetch,
  onOwnChanged,
  onOpenItem,
  onBack,
  onPlansChanged,
  onStartTripLog,
  myUserId,
  initialView = "writeUp",
}: {
  /** The full fetch (App holds it: the map draws the plan's items too). */
  view: TripPlanView | null;
  error: string | null;
  /** Fetch the plan again; `quiet` after a write whose failure was just said. */
  refetch: (options?: { quiet: boolean }) => void;
  /** A copy saved out of the plan landed in the caller's own lists. */
  onOwnChanged: () => void;
  /** Fit the map to a plan item. */
  onOpenItem: (item: TripPlanItem) => void;
  onBack: () => void;
  /** Something the list shows changed (name, dates, archive, membership). */
  onPlansChanged: () => void;
  onStartTripLog: (plan: TripPlanView) => void;
  myUserId: string | null;
  initialView?: TripPlanPageView;
}) {
  const toast = useToast();
  const [tab, setTab] = useState<TripPlanPageView>(initialView);
  const [editing, setEditing] = useState(false);
  const [sectionOpen, setSectionOpen] = useState<{ id: string | null } | null>(
    null,
  );
  const [confirm, setConfirm] = useState<
    | { kind: "delete" | "leave" }
    | { kind: "section"; section: TripPlanSectionView }
    | { kind: "form"; form: TripPlanFormView }
    | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [deleteAdded, setDeleteAdded] = useState(false);
  // A form's page, one step inside the Forms view; and its two dialogs.
  const [openFormId, setOpenFormId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // Focus follows a step inside the plan (a form's page, Invite people): in,
  // onto its back arrow; out, onto what opened it. Both are gone from the
  // page otherwise.
  const lastOpenedForm = useRef<string | null>(null);
  const focusSoon = (selector: string) =>
    requestAnimationFrame(() =>
      rootRef.current?.querySelector<HTMLElement>(selector)?.focus(),
    );
  const openFormPage = (id: string) => {
    lastOpenedForm.current = id;
    setOpenFormId(id);
    focusSoon("header button");
  };
  const closeFormPage = () => {
    setOpenFormId(null);
    focusSoon(`[data-form-id="${lastOpenedForm.current}"] button`);
  };
  const openInvite = () => {
    setTab("people");
    setInviting(true);
    focusSoon("header button");
  };
  const closeInvite = () => {
    setInviting(false);
    focusSoon("[data-invite-people]");
  };
  const [answering, setAnswering] = useState<string | null>(null);
  const [building, setBuilding] = useState<{ id: string | null } | null>(null);

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
    print: () => setPrinting(true),
    tripLog: () => onStartTripLog(plan),
    archive: () =>
      void run(
        () => archivePlan(plan.id, true),
        copy.archiveFailed,
        copy.archived,
      ).then((ok) => ok && onPlansChanged()),
    unarchive: () =>
      void run(
        () => archivePlan(plan.id, false),
        copy.archiveFailed,
        copy.unarchived,
      ).then((ok) => ok && onPlansChanged()),
    leave: () => {
      setDeleteAdded(false);
      setConfirm({ kind: "leave" });
    },
    delete: () => setConfirm({ kind: "delete" }),
  };

  const addRunners: Record<PlanAddVerbId, () => void> = {
    section: () => setSectionOpen({ id: null }),
    copy: () => setTab("items"),
    form: () => {
      setTab("forms");
      setBuilding({ id: null });
    },
    invite: () => openInvite(),
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
    dated: tripPlanIsDated(plan),
    over,
    ...tripPlanLeaveState(plan),
  });
  const canBuildForms = addVerbs.some((verb) => verb.id === "form");

  const counts = {
    places: plan.places.length,
    ways: plan.routes.length + plan.files.length,
    maps: plan.geoPdfs.length,
  };

  const going = tripPlanGoing(plan.members);
  const viewOptions = [
    { value: "writeUp" as const, label: copy.viewWriteUp },
    {
      value: "items" as const,
      label: copy.viewItems,
      // A zero is left out (shared/DESIGN.md §11).
      count: counts.places + counts.ways + counts.maps || undefined,
    },
    {
      value: "forms" as const,
      label: copy.viewForms,
      count: plan.forms.length || undefined,
    },
    {
      value: "people" as const,
      label: copy.viewPeople,
      count: going.length || undefined,
    },
  ];

  const formVerbs = planVerbsFor(PLAN_FORM_VERBS, "web", role, { archived });
  const formRunners = (
    form: TripPlanFormView,
  ): Record<PlanFormVerbId, () => void> => ({
    edit: () => setBuilding({ id: form.id }),
    delete: () => setConfirm({ kind: "form", form }),
  });
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
          <Button compact onClick={() => setAnswering(notice.formId)}>
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
      <PlanItems
        plan={plan}
        myUserId={myUserId}
        onChanged={refetch}
        onSaved={onOwnChanged}
        onOpen={onOpenItem}
      />
    ),
    forms: tab === "forms" && (
      <div className={classes.list}>
        {plan.forms.length === 0 ? (
          <EmptyState
            icon="form"
            title={role === "leader" ? copy.formsEmptyLeader : copy.formsEmpty}
            actions={
              canBuildForms && (
                <Button
                  variant="filled"
                  icon="add"
                  onClick={() => setBuilding({ id: null })}
                >
                  {planAddVerbLabel("form")}
                </Button>
              )
            }
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
              data-form-id={form.id}
              onOpen={() => openFormPage(form.id)}
              // One status: what the caller owes, else what the form asks;
              // then the form's own verbs, as on its page.
              trailing={
                <>
                  {form.requiredToJoin &&
                    (form.myAnswer ? (
                      <StatusPill label={copy.pillRequired} tone="outline" />
                    ) : (
                      <StatusPill label={copy.pillNotAnswered} tone="warning" />
                    ))}
                  {formVerbs.length > 0 && (
                    <Menu
                      label={`${formsCopy.actions}: ${form.title}`}
                      title={form.title}
                      placement="right-start"
                      entries={menuEntries(formVerbs, (id) =>
                        formRunners(form)[id](),
                      )}
                      trigger={(props) => (
                        <IconButton
                          {...props}
                          icon="overflow"
                          label={`${formsCopy.actions}: ${form.title}`}
                        />
                      )}
                    />
                  )}
                </>
              }
            />
          ))
        )}
        {plan.forms.length > 0 && canBuildForms && (
          <ListEnd>
            <Button
              variant="filled"
              icon="add"
              onClick={() => setBuilding({ id: null })}
            >
              {planAddVerbLabel("form")}
            </Button>
          </ListEnd>
        )}
      </div>
    ),
    people: tab === "people" && (
      <PlanPeople
        plan={plan}
        myUserId={myUserId}
        onChanged={refetch}
        onInvite={openInvite}
        onSeeAnswers={(formId) => {
          setTab("forms");
          openFormPage(formId);
        }}
      />
    ),
  };

  const editingSection =
    sectionOpen?.id != null
      ? plan.sections.find((section) => section.id === sectionOpen.id)
      : undefined;
  const deleteCopy = planDeleteConfirm(plan.name, counts);
  const leaveCopy = planLeaveConfirm(plan.name);
  const mineCount = myUserId
    ? addedBy(plan, myUserId)
    : { places: 0, ways: 0, maps: 0, bytes: 0 };
  const sectionCopy =
    confirm?.kind === "section"
      ? planSectionDeleteConfirm(confirm.section.title)
      : null;

  const openForm = plan.forms.find((form) => form.id === openFormId);
  const answeringForm = plan.forms.find((form) => form.id === answering);
  const buildingForm =
    building?.id != null
      ? plan.forms.find((form) => form.id === building.id)
      : undefined;
  const formCopy =
    confirm?.kind === "form" ? planFormDeleteConfirm(confirm.form) : null;

  return (
    <div ref={rootRef} className={classes.root}>
      {inviting ? (
        <PlanInvitePage plan={plan} onBack={closeInvite} onInvited={refetch} />
      ) : openForm ? (
        <PlanFormPage
          form={openForm}
          role={role}
          archived={archived}
          members={plan.members}
          onBack={closeFormPage}
          onAnswer={() => setAnswering(openForm.id)}
          onVerb={(id) => formRunners(openForm)[id]()}
        />
      ) : (
        contractSectionKeys(TRIP_PLAN_PAGE, "web").map((key) => (
          <Fragment key={key}>{sections[key]}</Fragment>
        ))
      )}

      {printing && (
        <PlanPrintDialog plan={plan} onClose={() => setPrinting(false)} />
      )}
      {answeringForm && (
        <PlanAnswerDialog
          open
          form={answeringForm}
          // Quiet: the dialog has said the 409 above its submit.
          onStale={() => refetch({ quiet: true })}
          onClose={() => setAnswering(null)}
          onSubmit={async (answers) => {
            await putAnswer(plan.id, answeringForm.id, {
              answers,
              visibleTo: answeringForm.visibleTo,
              formUpdatedAt: answeringForm.updatedAt,
            });
            setAnswering(null);
            toast.success(formsCopy.saved);
            refetch();
          }}
        />
      )}
      <PlanFormBuilderDialog
        open={building != null}
        form={buildingForm}
        onStale={() => refetch({ quiet: true })}
        onClose={() => setBuilding(null)}
        onSubmit={async (values, patch) => {
          if (buildingForm) await patchForm(plan.id, buildingForm.id, patch);
          else await createForm(plan.id, values);
          setBuilding(null);
          refetch();
        }}
      />
      <ConfirmDialog
        open={formCopy != null}
        title={formCopy?.confirmTitle}
        message={formCopy?.confirmBody}
        confirmLabel={formCopy?.confirmLabel}
        busy={busy}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm?.kind !== "form") return;
          const id = confirm.form.id;
          void run(
            () => deleteForm(plan.id, id),
            formsCopy.deleteFailed,
            formsCopy.deleted,
          ).then((done) => {
            setConfirm(null);
            if (done) closeFormPage();
          });
        }}
      />

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
        sectionId={sectionOpen?.id ?? null}
        section={editingSection}
        onStale={() => refetch({ quiet: true })}
        onClose={() => setSectionOpen(null)}
        onSubmit={async (values, patch) => {
          if (sectionOpen?.id)
            await patchSection(plan.id, sectionOpen.id, patch);
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
        message={
          <>
            <p>{leaveCopy.confirmBody}</p>
            {mineCount.places + mineCount.ways + mineCount.maps > 0 && (
              <Checkbox
                label={planLeaveDeleteAddedLabel(
                  mineCount,
                  mineCount.bytes > 0
                    ? formatBytes(mineCount.bytes)
                    : undefined,
                )}
                checked={deleteAdded}
                onChange={setDeleteAdded}
              />
            )}
          </>
        }
        confirmLabel={leaveCopy.confirmLabel}
        confirmColor={deleteAdded ? "error" : "primary"}
        busy={busy}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          try {
            setBusy(true);
            await leavePlan(plan.id, deleteAdded);
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
