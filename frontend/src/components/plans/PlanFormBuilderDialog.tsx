// A leader's form builder (Logjam Web only, `PLAN_FORM_VERBS`): a new form
// starts from a preset or blank, then every part can change. One form for
// making and editing (shared/DESIGN.md §10); an edit sends each changed part
// as the value last seen and the new one. When the plan is fetched again
// under it, every part the leader has not touched follows the form as it now
// is (`adoptTheirs`), so a save never sends another leader's change back.
import { useEffect, useId, useRef, useState } from "react";
import {
  parseTripPlanFormCreate,
  pluralCount,
  TRIP_PLAN_FORM_TITLE_MAX_LENGTH,
  TRIP_PLAN_MAX_OPTIONS,
  TRIP_PLAN_MAX_QUESTIONS,
  TRIP_PLAN_OPTION_LABEL_MAX_LENGTH,
  TRIP_PLAN_QUESTION_HELP_MAX_LENGTH,
  TRIP_PLAN_QUESTION_LABEL_MAX_LENGTH,
  TRIP_PLAN_FORM_PRESETS,
  TRIP_PLAN_FORM_PRESET_IDS,
  TRIP_PLAN_FORMS,
  TRIP_PLAN_QUESTION_KINDS,
  TRIP_PLAN_QUESTION_KIND_LABELS,
  type TripPlanFormPatch,
  type TripPlanFormView,
  type TripPlanQuestion,
  type TripPlanQuestionKind,
} from "@logjam/shared";
import {
  Button,
  Checkbox,
  ChipRail,
  Dialog,
  ErrorBanner,
  IconButton,
  Row,
  SectionHeader,
  Select,
  SwitchRow,
  TextField,
} from "../../ui";
import ConfirmDialog from "../dialogs/ConfirmDialog";
import { useUnsavedChangesGuard } from "../../useUnsavedChangesGuard";
import { messageFromError } from "../../errors/messageFromError";
import { ApiError } from "../../errors/ApiError";
import {
  adoptTheirs,
  formPatch,
  mintSlug,
  same,
  type FormValues,
} from "./plansModel";
import classes from "./plans.module.css";

const copy = TRIP_PLAN_FORMS.copy;

const hasOptions = (kind: TripPlanQuestionKind) =>
  kind === "choice" || kind === "multiChoice";

function valuesOf(form: TripPlanFormView): FormValues {
  return {
    title: form.title,
    preset: form.preset,
    questions: form.questions,
    visibleTo: form.visibleTo,
    requiredToJoin: form.requiredToJoin,
  };
}

export default function PlanFormBuilderDialog(props: {
  open: boolean;
  /** Absent: a new form. Updated in place after a refetch. */
  form?: TripPlanFormView;
  onSubmit: (values: FormValues, patch: TripPlanFormPatch) => Promise<void>;
  onStale: () => void;
  onClose: () => void;
}) {
  return props.open ? <Builder {...props} /> : null;
}

function Builder({
  form,
  onSubmit,
  onStale,
  onClose,
}: {
  form?: TripPlanFormView;
  onSubmit: (values: FormValues, patch: TripPlanFormPatch) => Promise<void>;
  onStale: () => void;
  onClose: () => void;
}) {
  const formId = useId();
  // A new form asks where to start first; picking is the step's whole job.
  const [values, setValues] = useState<FormValues | null>(
    form ? valuesOf(form) : null,
  );
  const [seen, setSeen] = useState(values);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  const current = form ? valuesOf(form) : null;
  if (current && seen && values && !same(current, seen)) {
    const next = adoptTheirs(seen, values, current);
    setSeen(next.seen);
    setValues(next.values);
  }

  // The Dialog focuses only on open; a preset picked swaps the step in place.
  const picked = values != null;
  useEffect(() => {
    if (picked && !form) titleRef.current?.focus();
  }, [picked, form]);

  // Against what a Save would compare: a new form against nothing at all.
  const dirty = values != null && (!seen || !same(values, seen));
  const guard = useUnsavedChangesGuard(dirty, onClose);
  // The API refuses widening a form others answered for leaders only.
  const widenLocked =
    form != null && form.visibleTo === "leaders" && form.answers.length > 0;

  const set = (next: Partial<FormValues>) => {
    setValues((was) => (was ? { ...was, ...next } : was));
    setError(null);
  };
  const setQuestion = (index: number, next: Partial<TripPlanQuestion>) =>
    values &&
    set({
      questions: values.questions.map((question, at) =>
        at === index ? { ...question, ...next } : question,
      ),
    });
  const moveQuestion = (index: number, by: -1 | 1) => {
    if (!values) return;
    const questions = [...values.questions];
    [questions[index], questions[index + by]] = [
      questions[index + by],
      questions[index],
    ];
    set({ questions });
  };

  async function submit() {
    if (!values) return;
    const parsed = parseTripPlanFormCreate(values);
    if (!("value" in parsed)) {
      setError("sentence" in parsed ? parsed.sentence : copy.formSaveFailed);
      return;
    }
    const patch = seen ? formPatch(seen, parsed.value) : {};
    if (form && Object.keys(patch).length === 0) return onClose();
    setBusy(true);
    try {
      await onSubmit(parsed.value, patch);
    } catch (err) {
      console.error(err);
      setError(messageFromError(err, copy.formSaveFailed));
      if (err instanceof ApiError && err.status === 409) onStale();
    } finally {
      setBusy(false);
    }
  }

  const footer = (
    <>
      <Button
        onClick={guard.requestClose}
        disabled={busy}
        disabledReason="Saving…"
      >
        Cancel
      </Button>
      {values && (
        <Button type="submit" form={formId} variant="filled" busy={busy}>
          {form ? copy.saveForm : copy.add}
        </Button>
      )}
    </>
  );

  return (
    <>
      <Dialog
        open
        size="large"
        title={form ? copy.editTitle : copy.newTitle}
        onClose={guard.requestClose}
        dismissible={!busy}
        footer={footer}
      >
        {!values ? (
          <div className={classes.form}>
            <SectionHeader title={copy.startFrom} />
            {TRIP_PLAN_FORM_PRESET_IDS.map((id) => (
              <Row
                key={id}
                title={TRIP_PLAN_FORM_PRESETS[id].title}
                subtitle={pluralCount(
                  TRIP_PLAN_FORM_PRESETS[id].questions.length,
                  "question",
                )}
                onOpen={() =>
                  setValues({ ...TRIP_PLAN_FORM_PRESETS[id], preset: id })
                }
              />
            ))}
            <Row
              title={copy.blank}
              onOpen={() =>
                setValues({
                  title: "",
                  preset: null,
                  visibleTo: "leaders",
                  requiredToJoin: false,
                  questions: [
                    {
                      id: mintSlug("q"),
                      kind: "text",
                      label: "",
                      required: false,
                    },
                  ],
                })
              }
            />
          </div>
        ) : (
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
              label={copy.title}
              required
              ref={titleRef}
              value={values.title}
              maxLength={TRIP_PLAN_FORM_TITLE_MAX_LENGTH}
              data-autofocus
              onChange={(event) => set({ title: event.target.value })}
            />
            <div className={classes.question}>
              <span className={classes.questionLabel} aria-hidden>
                {copy.visibleTo}
              </span>
              <ChipRail
                label={copy.visibleTo}
                value={values.visibleTo}
                onChange={(visibleTo) => set({ visibleTo })}
                options={[
                  { value: "leaders", label: copy.visibleToLeaders },
                  {
                    value: "members",
                    label: copy.visibleToMembers,
                    disabled: widenLocked,
                  },
                ]}
              />
              {widenLocked && (
                <p className={classes.note}>{copy.visibleToLocked}</p>
              )}
            </div>
            <SwitchRow
              title={copy.requiredToJoin}
              description={copy.requiredToJoinHint}
              checked={values.requiredToJoin}
              onChange={(requiredToJoin) => set({ requiredToJoin })}
            />
            <SectionHeader
              title={copy.questions}
              count={values.questions.length}
            />
            {values.questions.map((question, index) => (
              <fieldset key={question.id} className={classes.questionEditor}>
                <legend className="visually-hidden">
                  {`${copy.questionLabel} ${index + 1}`}
                </legend>
                <div className={classes.questionTools}>
                  <TextField
                    className={classes.grow}
                    label={`${copy.questionLabel} ${index + 1}`}
                    value={question.label}
                    maxLength={TRIP_PLAN_QUESTION_LABEL_MAX_LENGTH}
                    onChange={(event) =>
                      setQuestion(index, { label: event.target.value })
                    }
                  />
                  <IconButton
                    icon="collapse"
                    label={copy.moveUp}
                    disabled={index === 0}
                    disabledReason="It's first already"
                    onClick={() => moveQuestion(index, -1)}
                  />
                  <IconButton
                    icon="expand"
                    label={copy.moveDown}
                    disabled={index === values.questions.length - 1}
                    disabledReason="It's last already"
                    onClick={() => moveQuestion(index, 1)}
                  />
                  <IconButton
                    icon="delete"
                    label={copy.removeQuestion}
                    tone="danger"
                    onClick={() =>
                      set({
                        questions: values.questions.filter(
                          (_, at) => at !== index,
                        ),
                      })
                    }
                  />
                </div>
                <Select
                  label={copy.questionKind}
                  value={question.kind}
                  onChange={(event) => {
                    const kind = event.target.value as TripPlanQuestionKind;
                    setQuestion(index, {
                      kind,
                      // A choice starts with two options to fill in.
                      options: hasOptions(kind)
                        ? (question.options ?? [
                            { id: mintSlug("o"), label: "" },
                            { id: mintSlug("o"), label: "" },
                          ])
                        : undefined,
                    });
                  }}
                >
                  {TRIP_PLAN_QUESTION_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {TRIP_PLAN_QUESTION_KIND_LABELS[kind]}
                    </option>
                  ))}
                </Select>
                <TextField
                  label={copy.questionHelp}
                  value={question.help ?? ""}
                  maxLength={TRIP_PLAN_QUESTION_HELP_MAX_LENGTH}
                  onChange={(event) =>
                    setQuestion(index, { help: event.target.value })
                  }
                />
                {hasOptions(question.kind) && (
                  <div className={classes.question}>
                    <span className={classes.questionLabel} aria-hidden>
                      {copy.options}
                    </span>
                    {(question.options ?? []).map((option, at) => (
                      <div key={option.id} className={classes.questionTools}>
                        <TextField
                          className={classes.grow}
                          label={`${copy.optionLabel} ${at + 1}`}
                          hideLabel
                          value={option.label}
                          maxLength={TRIP_PLAN_OPTION_LABEL_MAX_LENGTH}
                          onChange={(event) =>
                            setQuestion(index, {
                              options: question.options!.map((each) =>
                                each.id === option.id
                                  ? { ...each, label: event.target.value }
                                  : each,
                              ),
                            })
                          }
                        />
                        <IconButton
                          icon="close"
                          label={copy.removeOption}
                          onClick={() =>
                            setQuestion(index, {
                              options: question.options!.filter(
                                (each) => each.id !== option.id,
                              ),
                            })
                          }
                        />
                      </div>
                    ))}
                    <div>
                      <Button
                        compact
                        variant="outline"
                        icon="add"
                        disabled={
                          (question.options?.length ?? 0) >=
                          TRIP_PLAN_MAX_OPTIONS
                        }
                        disabledReason={`${TRIP_PLAN_MAX_OPTIONS} options at most`}
                        onClick={() =>
                          setQuestion(index, {
                            options: [
                              ...(question.options ?? []),
                              { id: mintSlug("o"), label: "" },
                            ],
                          })
                        }
                      >
                        {copy.addOption}
                      </Button>
                    </div>
                  </div>
                )}
                <Checkbox
                  label={copy.questionRequired}
                  checked={question.required}
                  onChange={(required) => setQuestion(index, { required })}
                />
              </fieldset>
            ))}
            <div>
              <Button
                variant="outline"
                icon="add"
                disabled={values.questions.length >= TRIP_PLAN_MAX_QUESTIONS}
                disabledReason={`${TRIP_PLAN_MAX_QUESTIONS} questions at most`}
                onClick={() =>
                  set({
                    questions: [
                      ...values.questions,
                      {
                        id: mintSlug("q"),
                        kind: "text",
                        label: "",
                        required: false,
                      },
                    ],
                  })
                }
              >
                {copy.addQuestion}
              </Button>
            </div>
            {error && <ErrorBanner message={error} />}
          </form>
        )}
      </Dialog>
      <ConfirmDialog
        open={guard.guardOpen}
        title={form ? "Discard unsaved changes?" : "Discard this form?"}
        message={
          form ? "Your changes will be lost." : "What you made will be lost."
        }
        confirmLabel="Discard"
        onConfirm={guard.confirmDiscard}
        onClose={guard.cancelDiscard}
      />
    </>
  );
}
