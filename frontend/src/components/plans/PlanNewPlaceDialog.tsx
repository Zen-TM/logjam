// A place made in the plan: where it is (picked on the map before this opens),
// its type, and the same details a plan place's edit form asks. It belongs to
// the plan, not to the maker's account; Save a copy brings it in.
import { useId, useState } from "react";
import {
  abandonConfirm,
  itemFieldDefs,
  newPlaceFromWords,
  newPlaceWords,
  SYSTEM_PLACE_TYPE_IDS,
  SYSTEM_PLACE_TYPES,
  sameValue,
  TRIP_PLAN_PAGE,
  type ItemWords,
} from "@logjam/shared";
import { Button, ChipRail, Dialog, ErrorBanner, TextField } from "../../ui";
import { messageFromError } from "../../errors/messageFromError";
import { addPlanItem } from "../../plansApi";
import { placeTypeLucideIcon } from "../sidebar/panels/placeTypeIcon";
import PlanPlaceFields from "./PlanPlaceFields";
import { placeDetailsInvalid } from "./placeDetailsInvalid";
import classes from "./plans.module.css";

const copy = TRIP_PLAN_PAGE.copy;

export default function PlanNewPlaceDialog({
  planId,
  at,
  onSaved,
  onClose,
}: {
  planId: string;
  /** The point picked on the map. */
  at: { latitude: number; longitude: number };
  onSaved: () => void;
  onClose: () => void;
}) {
  const formId = useId();
  const [typeId, setTypeId] = useState<string>(SYSTEM_PLACE_TYPE_IDS.marker);
  const [values, setValues] = useState<ItemWords>(() =>
    newPlaceWords(typeId, at),
  );
  const [asked, setAsked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const defs = itemFieldDefs({ placeTypeId: typeId });
  const dirty = !sameValue(values, newPlaceWords(typeId, at));

  const set = (next: Record<string, string>) => {
    setValues((was) => ({ ...was, ...next }));
    setError(null);
    setAsked(false);
  };
  // A type has its own attributes: the ones typed under the last one go.
  const retype = (next: string) => {
    setTypeId(next);
    setValues((was) => ({
      ...newPlaceWords(next),
      name: was.name,
      notes: was.notes,
      altNames: was.altNames,
      latitude: was.latitude,
      longitude: was.longitude,
      elevation: was.elevation,
    }));
  };

  async function submit() {
    setAsked(true);
    if (placeDetailsInvalid(values, defs)) return;
    setBusy(true);
    try {
      await addPlanItem(planId, {
        kind: "place",
        new: newPlaceFromWords(typeId, values),
      });
      onSaved();
    } catch (err) {
      console.error(err);
      setError(messageFromError(err, copy.addCopyFailed));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      title={copy.itemNewPlace}
      size="large"
      onClose={onClose}
      discard={dirty ? abandonConfirm("place", true) : null}
      dismissible={!busy}
      footer={(requestClose) => (
        <>
          <Button
            onClick={requestClose}
            disabled={busy}
            disabledReason="Saving…"
          >
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="filled" busy={busy}>
            {copy.sectionSave}
          </Button>
        </>
      )}
    >
      <form
        id={formId}
        className={classes.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) void submit();
        }}
      >
        <p className={classes.note}>{copy.addCopyLine}</p>
        <ChipRail
          label={copy.itemType}
          options={SYSTEM_PLACE_TYPES.map((type) => ({
            value: type.id,
            label: type.name,
            icon: placeTypeLucideIcon(type.iconKey),
            hue: type.color,
          }))}
          value={typeId}
          onChange={retype}
        />
        <TextField
          label={copy.itemName}
          value={values.name}
          data-autofocus
          onChange={(event) => set({ name: event.target.value })}
        />
        <PlanPlaceFields values={values} defs={defs} asked={asked} set={set} />
        {error && <ErrorBanner message={error} />}
      </form>
    </Dialog>
  );
}
