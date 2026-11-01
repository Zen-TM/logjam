// A write-up section: one form for adding and editing (shared/DESIGN.md §10).
// An edit sends each changed field as the value last seen and the new one; on
// a 409 the form stays open with the API's sentence, keeps what was typed and
// shows what the plan now says, so the next Save compares against that. A
// field the user never touched follows the plan (`adoptTheirs`). Add or edit
// is decided by the id it opened with, so a section deleted meanwhile is
// refused, never made again.
import { useId, useState } from "react";
import {
  limitHint,
  TRIP_PLAN_PAGE,
  TRIP_PLAN_SECTION_BODY_MAX_LENGTH,
  TRIP_PLAN_SECTION_TITLE_MAX_LENGTH,
  parseTripPlanSectionCreate,
  planAddVerbLabel,
  tripPlanInPlanNow,
  type TripPlanSectionPatch,
  type TripPlanSectionView,
} from "@logjam/shared";
import { Button, Dialog, ErrorBanner, TextArea, TextField } from "../../ui";
import ConfirmDialog from "../dialogs/ConfirmDialog";
import { useUnsavedChangesGuard } from "../../useUnsavedChangesGuard";
import { messageFromError } from "../../errors/messageFromError";
import { ApiError } from "../../errors/ApiError";
import {
  adoptTheirs,
  same,
  sectionPatch,
  theirsChanged,
  type SectionValues as Values,
} from "./plansModel";
import classes from "./plans.module.css";

const copy = TRIP_PLAN_PAGE.copy;

export default function PlanSectionDialog(props: {
  open: boolean;
  /** The section being edited, or null for a new one. */
  sectionId: string | null;
  /** That section as the plan now has it: absent once it is deleted. */
  section?: TripPlanSectionView;
  onSubmit: (values: Values, patch: TripPlanSectionPatch) => Promise<void>;
  /** A 409 came back: fetch the plan again so `section` is the current one. */
  onStale: () => void;
  onClose: () => void;
}) {
  return props.open ? <SectionForm {...props} /> : null;
}

function SectionForm({
  sectionId,
  section,
  onSubmit,
  onStale,
  onClose,
}: {
  sectionId: string | null;
  section?: TripPlanSectionView;
  onSubmit: (values: Values, patch: TripPlanSectionPatch) => Promise<void>;
  onStale: () => void;
  onClose: () => void;
}) {
  const formId = useId();
  const editing = sectionId != null;
  const [opened] = useState<Values>(() => ({
    title: section?.title ?? "",
    body: section?.body ?? "",
  }));
  // What the form compares against: the section as opened, then as the plan
  // was fetched again. Never moves on its own while the user types.
  const [seen, setSeen] = useState<Values>(opened);
  const [values, setValues] = useState<Values>(opened);
  const [error, setError] = useState<string | null>(null);
  const [titleError, setTitleError] = useState<string | null>(null);
  // Someone else's change arrived while the form was open.
  const [moved, setMoved] = useState(false);
  const [busy, setBusy] = useState(false);

  const current: Values | null = section
    ? { title: section.title, body: section.body }
    : null;
  if (current && (current.title !== seen.title || current.body !== seen.body)) {
    const next = adoptTheirs(seen, values, current);
    setSeen(next.seen);
    setValues(next.values);
    setMoved(true);
  }

  // Against what a Save would compare: after a refetch, the section as it is.
  const dirty = !same(values, seen);
  /** The plan's words under a field the user edited and the plan changed. */
  const theirs = (field: keyof Values) =>
    moved && current && theirsChanged(opened, current, values, [field])
      ? current[field]
      : null;
  const guard = useUnsavedChangesGuard(dirty, onClose);
  const set = (next: Partial<Values>) => {
    setValues((was) => ({ ...was, ...next }));
    setError(null);
  };

  async function submit() {
    if (editing && !section) return setError(copy.sectionGone);
    const parsed = parseTripPlanSectionCreate(values);
    if (!("value" in parsed)) {
      const sentence = "sentence" in parsed ? parsed.sentence : null;
      if (!values.title.trim())
        setTitleError(sentence ?? copy.sectionSaveFailed);
      else setError(sentence ?? copy.sectionSaveFailed);
      return;
    }
    const patch = sectionPatch(seen, parsed.value);
    if (editing && Object.keys(patch).length === 0) return onClose();
    setBusy(true);
    try {
      await onSubmit(parsed.value, patch);
    } catch (err) {
      console.error(err);
      setError(messageFromError(err, copy.sectionSaveFailed));
      if (err instanceof ApiError && err.status === 409) onStale();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Dialog
        open
        size="large"
        title={copy.sectionTitle}
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
              {editing ? copy.sectionSave : planAddVerbLabel("section")}
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
            label={copy.sectionTitleField}
            required
            value={values.title}
            maxLength={TRIP_PLAN_SECTION_TITLE_MAX_LENGTH}
            data-autofocus
            placeholder={copy.sectionTitlePlaceholder}
            onChange={(event) => {
              set({ title: event.target.value });
              setTitleError(null);
            }}
            error={titleError}
            hint={
              theirs("title") != null
                ? tripPlanInPlanNow(theirs("title")!)
                : undefined
            }
          />
          <TextArea
            label={copy.sectionBody}
            value={values.body}
            minRows={8}
            onChange={(event) => set({ body: event.target.value })}
            // A limit shows live (shared/DESIGN.md §11).
            hint={limitHint(
              values.body.length,
              TRIP_PLAN_SECTION_BODY_MAX_LENGTH,
            )}
          />
          {theirs("body") != null && (
            <div className={classes.theirs}>
              <p className={classes.note}>{copy.inPlanNow}</p>
              <p className={classes.body}>
                {theirs("body") || copy.writeUpEmpty}
              </p>
            </div>
          )}
          {error && <ErrorBanner message={error} />}
        </form>
      </Dialog>
      <ConfirmDialog
        open={guard.guardOpen}
        title={editing ? "Discard unsaved changes?" : "Discard this section?"}
        message={
          editing
            ? "Your changes will be lost."
            : "What you typed will be lost."
        }
        confirmLabel="Discard"
        onConfirm={guard.confirmDiscard}
        onClose={guard.cancelDiscard}
      />
    </>
  );
}
