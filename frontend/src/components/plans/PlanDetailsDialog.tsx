// The one form for a plan's name, dates and trip types: New plan and Edit
// name and dates differ only in title and submit (shared/DESIGN.md §10). An
// edit sends only what changed, each as the value last seen and the new one,
// so a save over someone else's change is refused rather than lost (design §4).
import { useId, useMemo, useState } from "react";
import {
  parseTripPlanCreate,
  TRIP_PLANS_LIST,
  TRIP_TYPE_SUGGESTIONS,
  tripTypeLabel,
  type TripPlanPatch,
  type TripPlanView,
} from "@logjam/shared";
import { Button, ChipPicker, Dialog, ErrorBanner, TextField } from "../../ui";
import ConfirmDialog from "../dialogs/ConfirmDialog";
import { tripTypeLook } from "../sidebar/panels/tripTypeIcon";
import { useUnsavedChangesGuard } from "../../useUnsavedChangesGuard";
import { messageFromError } from "../../errors/messageFromError";
import { planPatch, type PlanValues as Values } from "./plansModel";
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
  const initial: Values = useMemo(
    () => ({
      name: plan?.name ?? "",
      startDate: plan?.startDate ?? null,
      endDate: plan?.endDate ?? null,
      tripTypes: plan?.tripTypes ?? [],
    }),
    [plan],
  );
  const [values, setValues] = useState<Values>(initial);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const dirty = JSON.stringify(values) !== JSON.stringify(initial);
  const guard = useUnsavedChangesGuard(dirty, onClose);
  const set = (next: Partial<Values>) => {
    setValues((current) => ({ ...current, ...next }));
    setError(null);
  };

  const typeOptions = useMemo(() => {
    const seen = new Set<string>();
    return [...TRIP_TYPE_SUGGESTIONS, ...values.tripTypes]
      .filter((type) => {
        const key = type.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((type) => {
        const look = tripTypeLook(type);
        return {
          value:
            values.tripTypes.find(
              (picked) => picked.toLowerCase() === type.toLowerCase(),
            ) ?? type,
          label: tripTypeLabel(type),
          icon: look.icon,
          hue: look.hue,
        };
      });
  }, [values.tripTypes]);

  const toggleType = (type: string) =>
    set({
      tripTypes: values.tripTypes.includes(type)
        ? values.tripTypes.filter((each) => each !== type)
        : [...values.tripTypes, type],
    });

  async function submit() {
    // The API's own rule, run here first, so the refusal is the one it sends.
    const parsed = parseTripPlanCreate(values);
    if (!("value" in parsed)) {
      const sentence = "sentence" in parsed ? parsed.sentence : null;
      if (sentence === copy.nameRequired || !values.name.trim())
        setNameError(sentence ?? copy.nameRequired);
      else setError(sentence ?? (plan ? copy.saveFailed : copy.makeFailed));
      return;
    }
    const patch = planPatch(initial, parsed.value);
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
            onChange={(event) => {
              set({ name: event.target.value });
              setNameError(null);
            }}
            error={nameError}
          />
          <div className={classes.pair}>
            <TextField
              label={copy.startDate}
              type="date"
              value={values.startDate ?? ""}
              onChange={(event) =>
                set({ startDate: event.target.value || null })
              }
            />
            <TextField
              label={copy.endDate}
              type="date"
              value={values.endDate ?? ""}
              min={values.startDate ?? undefined}
              onChange={(event) => set({ endDate: event.target.value || null })}
            />
          </div>
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
