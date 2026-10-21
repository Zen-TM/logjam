// Edit a plan item's words: a place's name and notes, a way's or a file's
// name. As a section's form does, each changed field goes as the value last
// seen and the new one; on a 409 the form stays open with the API's sentence,
// keeps what was typed and shows what the plan now says, and a field the user
// never touched follows the plan (`adoptTheirs`). Position, attributes and
// geometry stay as they came in: those are edited where the thing was made.
import { useId, useState } from "react";
import {
  TRIP_PLAN_PAGE,
  tripPlanInPlanNow,
  type TripPlanItem,
} from "@logjam/shared";
import { Button, Dialog, ErrorBanner, TextArea, TextField } from "../../ui";
import ConfirmDialog from "../dialogs/ConfirmDialog";
import { useUnsavedChangesGuard } from "../../useUnsavedChangesGuard";
import { messageFromError } from "../../errors/messageFromError";
import { ApiError } from "../../errors/ApiError";
import { patchPlanItem } from "../../plansApi";
import { wayNameError } from "../sidebar/panels/waysModel";
import {
  adoptTheirs,
  itemPatch,
  itemWords,
  same,
  theirsChanged,
  type ItemWords,
} from "./plansModel";
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

  const current = item ? itemWords(item) : null;
  if (item && current && !same(item, seen)) {
    setValues(adoptTheirs(itemWords(seen), values, current).values);
    setSeen(item);
    setMoved(true);
  }

  const dirty = !same(values, itemWords(seen));
  /** The plan's words under a field the user edited and the plan changed. */
  const theirs = (field: keyof ItemWords) =>
    moved && current && theirsChanged(opened, current, values, [field])
      ? current[field]
      : null;
  const guard = useUnsavedChangesGuard(dirty, onClose);
  const set = (next: Partial<ItemWords>) => {
    setValues((was) => ({ ...was, ...next }));
    setError(null);
    setAsked(false);
  };

  async function submit() {
    if (!item) return setError(copy.itemGone);
    setAsked(true);
    if (openedItem.kind === "route" && wayNameError(values.name, true)) return;
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
            hint={
              theirs("name") != null
                ? tripPlanInPlanNow(theirs("name")!)
                : undefined
            }
          />
          {openedItem.kind === "place" && (
            <TextArea
              label={copy.itemNotes}
              value={values.notes}
              onChange={(event) => set({ notes: event.target.value })}
              hint={
                theirs("notes") != null
                  ? tripPlanInPlanNow(theirs("notes")!)
                  : undefined
              }
            />
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
