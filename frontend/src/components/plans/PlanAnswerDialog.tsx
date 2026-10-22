// Answering a form: who sees the answers comes first, before any field, and
// the answer echoes the form as it was shown (its visibility and its
// updatedAt). A 409 means the form moved meanwhile: the plan is fetched
// again, and what was typed is fitted to the form as it now is
// (`fitAnswerDraft`), so the person sends it against that.
import { useId, useState } from "react";
import {
  tripPlanQuestionChoices,
  answersFromDraft,
  draftFromAnswers,
  fitAnswerDraft,
  parseTripPlanAnswers,
  TRIP_PLAN_FORMS,
  TRIP_PLAN_LONG_TEXT_ANSWER_MAX_LENGTH,
  TRIP_PLAN_TEXT_ANSWER_MAX_LENGTH,
  tripPlanVisibilityLine,
  type TripPlanAnswerDraft as AnswerDraft,
  type TripPlanAnswers,
  type TripPlanFormView,
  type TripPlanQuestion,
} from "@logjam/shared";
import {
  Button,
  Checkbox,
  ChipRail,
  Dialog,
  ErrorBanner,
  NumberField,
  TextArea,
  TextField,
} from "../../ui";
import ConfirmDialog from "../dialogs/ConfirmDialog";
import { useUnsavedChangesGuard } from "../../useUnsavedChangesGuard";
import { messageFromError } from "../../errors/messageFromError";
import { ApiError } from "../../errors/ApiError";
import classes from "./plans.module.css";

const copy = TRIP_PLAN_FORMS.copy;

/** One question's control, by kind. A required one is starred. */
function QuestionField({
  question,
  value,
  onChange,
}: {
  question: TripPlanQuestion;
  value: AnswerDraft[string];
  onChange: (next: AnswerDraft[string]) => void;
}) {
  const label = question.required ? `${question.label} *` : question.label;
  const help = question.help || undefined;
  switch (question.kind) {
    case "text":
    case "phone":
      return (
        <TextField
          label={label}
          hint={help}
          required={question.required}
          type={question.kind === "phone" ? "tel" : "text"}
          autoComplete={question.kind === "phone" ? "tel" : "off"}
          maxLength={TRIP_PLAN_TEXT_ANSWER_MAX_LENGTH}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    case "longText":
      return (
        <TextArea
          label={label}
          hint={help}
          required={question.required}
          maxLength={TRIP_PLAN_LONG_TEXT_ANSWER_MAX_LENGTH}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    case "number":
      return (
        <NumberField
          label={label}
          hint={help}
          required={question.required}
          constraints={{ integer: true, min: 0 }}
          value={typeof value === "string" ? value : ""}
          onChange={onChange}
        />
      );
    case "choice":
    case "yesNo": {
      const options = tripPlanQuestionChoices(question);
      return (
        <div className={classes.question}>
          <span className={classes.questionLabel} aria-hidden>
            {label}
          </span>
          {help && <p className={classes.note}>{help}</p>}
          <ChipRail
            label={question.label}
            options={options}
            value={typeof value === "string" ? value : ""}
            onChange={onChange}
          />
        </div>
      );
    }
    case "multiChoice": {
      const ticked = Array.isArray(value) ? value : [];
      return (
        <fieldset className={classes.question}>
          <legend className={classes.questionLabel}>{label}</legend>
          {help && <p className={classes.note}>{help}</p>}
          {(question.options ?? []).map((option) => (
            <Checkbox
              key={option.id}
              label={option.label}
              checked={ticked.includes(option.id)}
              onChange={(next) =>
                onChange(
                  next
                    ? [...ticked, option.id]
                    : ticked.filter((id) => id !== option.id),
                )
              }
            />
          ))}
        </fieldset>
      );
    }
    case "agree":
      return (
        <Checkbox
          label={label}
          description={help}
          checked={value === true}
          onChange={onChange}
        />
      );
  }
}

/** A form's questions, as a joiner and a member both fill them in. */
export function PlanFormFields({
  form,
  draft,
  onChange,
}: {
  form: Pick<TripPlanFormView, "title" | "preset" | "questions" | "visibleTo">;
  draft: AnswerDraft;
  onChange: (next: AnswerDraft) => void;
}) {
  return (
    <>
      <p className={classes.note}>
        {tripPlanVisibilityLine(form.visibleTo, form.preset)}
      </p>
      {form.questions.map((question) => (
        <QuestionField
          key={question.id}
          question={question}
          value={draft[question.id]}
          onChange={(next) => onChange({ ...draft, [question.id]: next })}
        />
      ))}
    </>
  );
}

export default function PlanAnswerDialog(props: {
  open: boolean;
  form: TripPlanFormView;
  onSubmit: (answers: TripPlanAnswers) => Promise<void>;
  /** A 409 came back: fetch the plan again so `form` is the current one. */
  onStale: () => void;
  onClose: () => void;
}) {
  return props.open ? <AnswerForm {...props} /> : null;
}

function AnswerForm({
  form,
  onSubmit,
  onStale,
  onClose,
}: {
  form: TripPlanFormView;
  onSubmit: (answers: TripPlanAnswers) => Promise<void>;
  onStale: () => void;
  onClose: () => void;
}) {
  const formId = useId();
  const [draft, setDraft] = useState<AnswerDraft>(() =>
    draftFromAnswers(form.questions, form.myAnswer?.answers ?? {}),
  );
  const [opened] = useState(draft);
  // The form as the draft was last fitted to it.
  const [fittedTo, setFittedTo] = useState(form);
  if (form.updatedAt !== fittedTo.updatedAt) {
    setFittedTo(form);
    setDraft(fitAnswerDraft(fittedTo.questions, form.questions, draft));
  }
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const guard = useUnsavedChangesGuard(
    JSON.stringify(draft) !== JSON.stringify(opened),
    onClose,
  );

  async function submit() {
    const parsed = parseTripPlanAnswers(
      form.questions,
      answersFromDraft(form.questions, draft),
    );
    if (!("value" in parsed)) {
      setError("sentence" in parsed ? parsed.sentence : copy.saveFailed);
      return;
    }
    setBusy(true);
    try {
      await onSubmit(parsed.value);
    } catch (err) {
      console.error(err);
      setError(messageFromError(err, copy.saveFailed));
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
        title={form.title}
        onClose={guard.requestClose}
        dismissible={!busy}
        footer={
          <>
            <Button
              onClick={guard.requestClose}
              disabled={busy}
              disabledReason="Sending…"
            >
              Cancel
            </Button>
            <Button type="submit" form={formId} variant="filled" busy={busy}>
              {copy.save}
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
          <PlanFormFields
            form={form}
            draft={draft}
            onChange={(next) => {
              setDraft(next);
              setError(null);
            }}
          />
          {error && <ErrorBanner message={error} />}
        </form>
      </Dialog>
      <ConfirmDialog
        open={guard.guardOpen}
        title="Discard unsaved changes?"
        message="Your answers will be lost."
        confirmLabel="Discard"
        onConfirm={guard.confirmDiscard}
        onClose={guard.cancelDiscard}
      />
    </>
  );
}
