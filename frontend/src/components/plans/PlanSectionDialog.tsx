// A write-up section: one form for adding and editing (shared/DESIGN.md §10).
// An edit sends each changed field as the value last seen and the new one; on
// a 409 the form stays open with the API's sentence, keeps what was typed and
// shows what the plan now says, so the next Save compares against that. A
// field the user never touched follows the plan (`adoptTheirs`).
import { useId, useState } from "react";
import {
  TRIP_PLAN_PAGE,
  TRIP_PLAN_SECTION_BODY_MAX_LENGTH,
  TRIP_PLAN_SECTION_SUGGESTIONS,
  TRIP_PLAN_SECTION_TITLE_MAX_LENGTH,
  parseTripPlanSectionCreate,
  planAddVerbLabel,
  type TripPlanSectionPatch,
  type TripPlanSectionView,
} from "@logjam/shared";
import {
  Button,
  Chip,
  Dialog,
  ErrorBanner,
  TextArea,
  TextField,
} from "../../ui";
import ConfirmDialog from "../dialogs/ConfirmDialog";
import { useUnsavedChangesGuard } from "../../useUnsavedChangesGuard";
import { messageFromError } from "../../errors/messageFromError";
import { ApiError } from "../../errors/ApiError";
import {
  adoptTheirs,
  sectionPatch,
  type SectionValues as Values,
} from "./plansModel";
import classes from "./plans.module.css";

const copy = TRIP_PLAN_PAGE.copy;

export default function PlanSectionDialog(props: {
  open: boolean;
  /** Absent: a new section. Updated in place after a refetch. */
  section?: TripPlanSectionView;
  onSubmit: (values: Values, patch: TripPlanSectionPatch) => Promise<void>;
  /** A 409 came back: fetch the plan again so `section` is the current one. */
  onStale: () => void;
  onClose: () => void;
}) {
  return props.open ? <SectionForm {...props} /> : null;
}

function SectionForm({
  section,
  onSubmit,
  onStale,
  onClose,
}: {
  section?: TripPlanSectionView;
  onSubmit: (values: Values, patch: TripPlanSectionPatch) => Promise<void>;
  onStale: () => void;
  onClose: () => void;
}) {
  const formId = useId();
  const opened: Values = {
    title: section?.title ?? "",
    body: section?.body ?? "",
  };
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

  const dirty = values.title !== opened.title || values.body !== opened.body;
  const guard = useUnsavedChangesGuard(dirty, onClose);
  const set = (next: Partial<Values>) => {
    setValues((was) => ({ ...was, ...next }));
    setError(null);
  };

  async function submit() {
    const parsed = parseTripPlanSectionCreate(values);
    if (!("value" in parsed)) {
      const sentence = "sentence" in parsed ? parsed.sentence : null;
      if (!values.title.trim())
        setTitleError(sentence ?? copy.sectionSaveFailed);
      else setError(sentence ?? copy.sectionSaveFailed);
      return;
    }
    const patch = sectionPatch(seen, parsed.value);
    if (section && Object.keys(patch).length === 0) return onClose();
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

  const theirs =
    moved && current && current.body !== values.body ? current.body : null;

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
              {section ? copy.sectionSave : planAddVerbLabel("section")}
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
            label={copy.sectionTitleField}
            required
            value={values.title}
            maxLength={TRIP_PLAN_SECTION_TITLE_MAX_LENGTH}
            data-autofocus
            onChange={(event) => {
              set({ title: event.target.value });
              setTitleError(null);
            }}
            error={titleError}
            hint={
              moved && current && current.title !== values.title
                ? `In the plan now: ${current.title}`
                : undefined
            }
          />
          {!section && (
            <div
              className={classes.suggestions}
              role="group"
              aria-label={copy.sectionSuggestions}
            >
              {TRIP_PLAN_SECTION_SUGGESTIONS.map((title) => (
                <Chip
                  key={title}
                  label={title}
                  active={values.title === title}
                  aria-pressed={values.title === title}
                  onClick={() => {
                    set({ title });
                    setTitleError(null);
                  }}
                />
              ))}
            </div>
          )}
          <TextArea
            label={copy.sectionBody}
            value={values.body}
            minRows={8}
            onChange={(event) => set({ body: event.target.value })}
            // A limit shows live (shared/DESIGN.md §11).
            hint={
              values.body.length > TRIP_PLAN_SECTION_BODY_MAX_LENGTH * 0.9
                ? `${values.body.length} of ${TRIP_PLAN_SECTION_BODY_MAX_LENGTH} characters`
                : undefined
            }
          />
          {theirs != null && (
            <div className={classes.theirs}>
              <p className={classes.note}>In the plan now:</p>
              <p className={classes.body}>{theirs || copy.writeUpEmpty}</p>
            </div>
          )}
          {error && <ErrorBanner message={error} />}
        </form>
      </Dialog>
      <ConfirmDialog
        open={guard.guardOpen}
        title={section ? "Discard unsaved changes?" : "Discard this section?"}
        message={
          section
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
