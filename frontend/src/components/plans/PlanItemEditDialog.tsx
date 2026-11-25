// Edit a plan item: a place's details (name, other names, position,
// elevation, notes, its type's attributes), or a way's or a file's name. As a
// section's form does, each changed field goes as the value last seen and the
// new one; on a 409 the form stays open with the API's sentence, keeps what
// was typed and shows what the plan now says, and a field the user never
// touched follows the plan (`adoptTheirs`). A way's geometry stays as it came
// in: that is edited where the way was made.
import { useId, useState } from "react";
import {
  abandonConfirm,
  formatFieldValue,
  itemFieldDefs,
  itemPatch,
  itemWords,
  sameValue,
  TRIP_PLAN_PAGE,
  tripPlanAdoptTheirs,
  tripPlanInPlanNow,
  tripPlanSetAsideRows,
  tripPlanTheirsChanged,
  type ItemWords,
  type TripPlanItem,
} from "@logjam/shared";
import {
  Button,
  Dialog,
  ErrorBanner,
  SectionHeader,
  TextField,
} from "../../ui";
import { messageFromError } from "../../errors/messageFromError";
import { ApiError } from "../../errors/ApiError";
import { patchPlanItem } from "../../plansApi";
import { wayNameError } from "../sidebar/panels/waysModel";
import PlanPlaceFields from "./PlanPlaceFields";
import { placeDetailsInvalid } from "./placeDetailsInvalid";
import classes from "./plans.module.css";

const copy = TRIP_PLAN_PAGE.copy;

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
  const set = (next: Record<string, string>) => {
    setValues((was) => ({ ...was, ...next }));
    setError(null);
    setAsked(false);
  };

  const detailsInvalid = place != null && placeDetailsInvalid(values, defs);

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
        title={place ? copy.itemEditPlace : copy.itemEditWay}
        size="large"
        onClose={onClose}
        discard={dirty ? abandonConfirm(place ? "place" : "way", false) : null}
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
              <PlanPlaceFields
                values={values}
                defs={defs}
                asked={asked}
                set={set}
                theirsHint={theirsHint}
              />
              {place && tripPlanSetAsideRows(place).length > 0 && (
                <section className={classes.form}>
                  <SectionHeader title={copy.placeSetAside} />
                  <p className={classes.note}>{copy.placeSetAsideHint}</p>
                  <dl className={classes.facts}>
                    {tripPlanSetAsideRows(place).map(
                      ([key, label, value, type]) => (
                        <div key={key} className={classes.fact}>
                          <dt>{label}</dt>
                          <dd>{formatFieldValue(value, type)}</dd>
                        </div>
                      ),
                    )}
                  </dl>
                </section>
              )}
            </>
          )}
          {error && <ErrorBanner message={error} />}
        </form>
      </Dialog>
    </>
  );
}
