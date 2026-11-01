// Edit a plan item: a place's details (name, other names, position,
// elevation, notes, its type's attributes), or a way's or a file's name. As a
// section's form does, each changed field goes as the value last seen and the
// new one; on a 409 the form stays open with the API's sentence, keeps what
// was typed and shows what the plan now says, and a field the user never
// touched follows the plan (`adoptTheirs`). A way's geometry stays as it came
// in: that is edited where the way was made.
import { useId, useState } from "react";
import {
  customFieldDisplayLabel,
  LATITUDE_RANGE,
  LONGITUDE_RANGE,
  TRIP_PLAN_PAGE,
  tripPlanInPlanNow,
  type TripPlanItem,
} from "@logjam/shared";
import {
  Button,
  Dialog,
  ErrorBanner,
  NumberField,
  SectionHeader,
  TextArea,
  TextField,
} from "../../ui";
import CustomFieldInput, {
  customFieldValueError,
} from "../dialogs/CustomFieldInput";
import { numericFieldError } from "../../numberInput";
import ConfirmDialog from "../dialogs/ConfirmDialog";
import { useUnsavedChangesGuard } from "../../useUnsavedChangesGuard";
import { messageFromError } from "../../errors/messageFromError";
import { ApiError } from "../../errors/ApiError";
import { patchPlanItem } from "../../plansApi";
import { wayNameError } from "../sidebar/panels/waysModel";
import {
  ITEM_ATTR,
  itemFieldDefs,
  itemPatch,
  itemWords,
  sameValue,
  tripPlanAdoptTheirs,
  tripPlanTheirsChanged,
  type ItemWords,
} from "@logjam/shared";
import classes from "./plans.module.css";

const copy = TRIP_PLAN_PAGE.copy;
const LATITUDE = { min: LATITUDE_RANGE.min, max: LATITUDE_RANGE.max };
const LONGITUDE = { min: LONGITUDE_RANGE.min, max: LONGITUDE_RANGE.max };

export default function PlanItemEditDialog({
  planId,
  opened: openedItem,
  item,
  onSaved,
  onStale,
  onClose,
}: {
  planId: string;
  /** The item as the form opened on it. */
  opened: TripPlanItem;
  /** That item as the plan now has it: absent once it is deleted. */
  item?: TripPlanItem;
  onSaved: () => void;
  /** A 409, 404 or 403 came back: fetch the plan again so `item` is the
   *  current one, or absent. */
  onStale: () => void;
  onClose: () => void;
}) {
  const formId = useId();
  const [opened] = useState<ItemWords>(() => itemWords(openedItem));
  // What a Save compares against: the item as opened, then as the plan was
  // fetched again. Never moves on its own while the user types.
  const [seen, setSeen] = useState<TripPlanItem>(openedItem);
  const [values, setValues] = useState<ItemWords>(opened);
  const [moved, setMoved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A way's name is checked here, as its own form does; the API answers a
  // place's with its own sentences.
  const [asked, setAsked] = useState(false);
  const nameError =
    openedItem.kind === "route" ? wayNameError(values.name, asked) : null;
  const place = openedItem.kind === "place" ? openedItem : null;
  const defs = place ? itemFieldDefs(place) : [];

  const current = item ? itemWords(item) : null;
  if (item && current && !sameValue(item, seen)) {
    setValues(tripPlanAdoptTheirs(itemWords(seen), values, current).values);
    setSeen(item);
    setMoved(true);
  }

  const dirty = !sameValue(values, itemWords(seen));
  /** The plan's words under a field the user edited and the plan changed. */
  const theirs = (field: string) =>
    moved && current && tripPlanTheirsChanged([field], values, current, opened)
      ? current[field]
      : null;
  const theirsHint = (field: string) =>
    theirs(field) != null ? tripPlanInPlanNow(theirs(field)!) : undefined;
  const guard = useUnsavedChangesGuard(dirty, onClose);
  const set = (next: Record<string, string>) => {
    setValues((was) => ({ ...was, ...next }));
    setError(null);
    setAsked(false);
  };

  const detailsInvalid =
    place != null &&
    (values.latitude.trim() === "" ||
      values.longitude.trim() === "" ||
      numericFieldError(values.latitude, LATITUDE) != null ||
      numericFieldError(values.longitude, LONGITUDE) != null ||
      numericFieldError(values.elevation, {}) != null ||
      defs.some(
        (def) =>
          customFieldValueError(def, values[ITEM_ATTR + def.key]) != null,
      ));

  async function submit() {
    if (!item) return setError(copy.itemGone);
    setAsked(true);
    if (openedItem.kind === "route" && wayNameError(values.name, true)) return;
    if (place && detailsInvalid) return;
    const patch = itemPatch(seen, values);
    if (!patch) return onClose();
    setBusy(true);
    try {
      await patchPlanItem(planId, seen.kind, seen.id, patch);
      onSaved();
    } catch (err) {
      console.error(err);
      setError(messageFromError(err, copy.itemSaveFailed));
      // Changed, gone, or no longer theirs to change: the plan as it now is
      // says which, and a deleted item turns the next Save into `itemGone`.
      if (err instanceof ApiError && [403, 404, 409].includes(err.status))
        onStale();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Dialog
        open
        title={copy.itemEdit}
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
              {copy.sectionSave}
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
            label={copy.itemName}
            value={values.name}
            data-autofocus
            onChange={(event) => set({ name: event.target.value })}
            error={nameError}
            hint={theirsHint("name")}
          />
          {place && (
            <>
              <TextField
                label={copy.itemOtherNames}
                value={values.altNames}
                onChange={(event) => set({ altNames: event.target.value })}
                hint={theirsHint("altNames") ?? copy.itemOtherNamesHint}
              />
              <div className={classes.pair}>
                <NumberField
                  label={copy.itemLatitude}
                  required
                  value={values.latitude}
                  onChange={(latitude) => set({ latitude })}
                  constraints={LATITUDE}
                  showError={asked}
                  hint={theirsHint("latitude")}
                />
                <NumberField
                  label={copy.itemLongitude}
                  required
                  value={values.longitude}
                  onChange={(longitude) => set({ longitude })}
                  constraints={LONGITUDE}
                  showError={asked}
                  hint={theirsHint("longitude")}
                />
              </div>
              <NumberField
                label={copy.itemElevation}
                value={values.elevation}
                onChange={(elevation) => set({ elevation })}
                constraints={{}}
                showError={asked}
                hint={theirsHint("elevation")}
              />
              <TextArea
                label={copy.itemNotes}
                value={values.notes}
                onChange={(event) => set({ notes: event.target.value })}
                hint={theirsHint("notes")}
              />
              {defs.length > 0 && (
                <section className={classes.form}>
                  <SectionHeader title={copy.itemAttributes} />
                  {defs.map((def) => (
                    <div key={def.key}>
                      <CustomFieldInput
                        def={def}
                        value={values[ITEM_ATTR + def.key]}
                        onChange={(value) =>
                          set({ [ITEM_ATTR + def.key]: value })
                        }
                        showError={asked}
                      />
                      {theirsHint(ITEM_ATTR + def.key) && (
                        <p className={classes.note}>
                          {customFieldDisplayLabel(def)}:{" "}
                          {theirsHint(ITEM_ATTR + def.key)}
                        </p>
                      )}
                    </div>
                  ))}
                </section>
              )}
            </>
          )}
          {error && <ErrorBanner message={error} />}
        </form>
      </Dialog>
      <ConfirmDialog
        open={guard.guardOpen}
        title="Discard unsaved changes?"
        message="Your changes will be lost."
        confirmLabel="Discard"
        onConfirm={guard.confirmDiscard}
        onClose={guard.cancelDiscard}
      />
    </>
  );
}
