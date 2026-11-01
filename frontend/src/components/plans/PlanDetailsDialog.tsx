// The one form for a plan's name, dates and trip types: New plan and Edit
// name and dates differ only in title and submit (shared/DESIGN.md §10). An
// edit sends only what changed, each as the value last seen and the new one,
// so a save over someone else's change is refused rather than lost. When the
// plan is fetched again under the open form, every field the user has not
// touched follows it (`adoptTheirs`), and an edited field the plan also
// changed shows what the plan now says.
import { useId, useMemo, useState } from "react";
import {
  parseTripPlanCreate,
  TRIP_PLAN_NAME_MAX_LENGTH,
  TRIP_PLAN_PAGE,
  TRIP_PLANS_LIST,
  TRIP_TYPE_SUGGESTIONS,
  tripPlanDatesLabel,
  tripPlanInPlanNow,
  tripTypeLabel,
  type TripPlanPatch,
  type TripPlanView,
} from "@logjam/shared";
import { Button, ChipPicker, Dialog, ErrorBanner, TextField } from "../../ui";
import { DateRangeField } from "../../ui/DateRangeField";
import ConfirmDialog from "../dialogs/ConfirmDialog";
import { tripTypeOptions } from "../sidebar/panels/tripTypeIcon";
import { useUnsavedChangesGuard } from "../../useUnsavedChangesGuard";
import { messageFromError } from "../../errors/messageFromError";
import {
  adoptTheirs,
  PLAN_FIELD_GROUPS,
  planPatch,
  same,
  theirsChanged,
  type PlanValues as Values,
} from "./plansModel";
import classes from "./plans.module.css";

const copy = TRIP_PLANS_LIST.copy;

export default function PlanDetailsDialog(props: {
  open: boolean;
  /** Absent: New plan. */
  plan?: TripPlanView;
  onSubmit: (values: Values, patch: TripPlanPatch) => Promise<void>;
  onClose: () => void;
}) {
  // Mounted on open, so a reopened form starts from the plan as it is now.
  return props.open ? <PlanDetailsForm {...props} /> : null;
}

function PlanDetailsForm({
  plan,
  onSubmit,
  onClose,
}: {
  plan?: TripPlanView;
  onSubmit: (values: Values, patch: TripPlanPatch) => Promise<void>;
  onClose: () => void;
}) {
  const formId = useId();
  const current: Values = useMemo(
    () => ({
      name: plan?.name ?? "",
      startDate: plan?.startDate ?? null,
      endDate: plan?.endDate ?? null,
      tripTypes: plan?.tripTypes ?? [],
    }),
    [plan],
  );
  const [opened] = useState(current);
  // What a save compares against: the plan as opened, then as fetched again.
  const [seen, setSeen] = useState(current);
  const [values, setValues] = useState<Values>(current);
  const [moved, setMoved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (JSON.stringify(current) !== JSON.stringify(seen)) {
    const next = adoptTheirs(seen, values, current, PLAN_FIELD_GROUPS);
    setSeen(next.seen);
    setValues(next.values);
    setMoved(true);
  }
  const theirs = (fields: (keyof Values)[], words: string) =>
    moved && theirsChanged(opened, current, values, fields)
      ? tripPlanInPlanNow(words)
      : undefined;

  // Against what a Save would compare: after a refetch, the plan as it is.
  const dirty = !same(values, seen);
  const guard = useUnsavedChangesGuard(dirty, onClose);
  const set = (next: Partial<Values>) => {
    setValues((current) => ({ ...current, ...next }));
    setError(null);
  };

  const typeOptions = useMemo(
    () => tripTypeOptions(TRIP_TYPE_SUGGESTIONS, values.tripTypes),
    [values.tripTypes],
  );

  const toggleType = (type: string) =>
    set({
      tripTypes: values.tripTypes.includes(type)
        ? values.tripTypes.filter((each) => each !== type)
        : [...values.tripTypes, type],
    });

  async function submit() {
    // The API's own rule, run here first, so the refusal is the one it sends.
    // The name's own refusals go under the name; the rest above the submit.
    const failed = plan ? copy.saveFailed : copy.makeFailed;
    const name = parseTripPlanCreate({ name: values.name });
    if (!("value" in name))
      return setNameError("sentence" in name ? name.sentence : failed);
    const parsed = parseTripPlanCreate(values);
    if (!("value" in parsed))
      return setError("sentence" in parsed ? parsed.sentence : failed);
    const patch = planPatch(seen, parsed.value);
    if (plan && Object.keys(patch).length === 0) return onClose();
    setBusy(true);
    try {
      await onSubmit(parsed.value, patch);
    } catch (err) {
      console.error(err);
      setError(messageFromError(err, plan ? copy.saveFailed : copy.makeFailed));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Dialog
        open
        title={plan ? copy.editTitle : copy.newTitle}
        onClose={guard.requestClose}
        dismissible={!busy}
        footer={
          <>
            <Button
              onClick={guard.requestClose}
              disabled={busy}
              disabledReason="Saving…"
            >
              Cancel
            </Button>
            <Button type="submit" form={formId} variant="filled" busy={busy}>
              {plan ? copy.save : copy.make}
            </Button>
          </>
        }
      >
        <form
          id={formId}
          className={classes.form}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy) void submit();
          }}
        >
          <TextField
            label={copy.name}
            required
            value={values.name}
            data-autofocus
            maxLength={TRIP_PLAN_NAME_MAX_LENGTH}
            onChange={(event) => {
              set({ name: event.target.value });
              setNameError(null);
            }}
            error={nameError}
            hint={theirs(["name"], current.name)}
          />
          <DateRangeField
            label={TRIP_PLAN_PAGE.copy.datesField}
            start={values.startDate}
            end={values.endDate}
            onChange={(startDate, endDate) => set({ startDate, endDate })}
            // One note for the pair, as they are saved together.
            hint={theirs(
              ["startDate", "endDate"],
              tripPlanDatesLabel(current.startDate, current.endDate),
            )}
          />
          <ChipPicker
            label={copy.tripTypes}
            options={typeOptions}
            selected={values.tripTypes}
            onToggle={toggleType}
            onAdd={(type) => {
              const trimmed = type.trim();
              if (
                trimmed &&
                !values.tripTypes.some(
                  (each) => each.toLowerCase() === trimmed.toLowerCase(),
                )
              )
                set({ tripTypes: [...values.tripTypes, trimmed] });
            }}
            addLabel={copy.addTripType}
            hint={theirs(
              ["tripTypes"],
              current.tripTypes.map(tripTypeLabel).join(", "),
            )}
          />
          {error && <ErrorBanner message={error} />}
        </form>
      </Dialog>
      <ConfirmDialog
        open={guard.guardOpen}
        title={plan ? "Discard unsaved changes?" : "Discard this plan?"}
        message={
          plan ? "Your changes will be lost." : "What you typed will be lost."
        }
        confirmLabel="Discard"
        onConfirm={guard.confirmDiscard}
        onClose={guard.cancelDiscard}
      />
    </>
  );
}
