// A leader's form builder (Logjam Web only, `PLAN_FORM_VERBS`): a new form
// starts from a preset or blank, then every part can change. One form for
// making and editing (shared/DESIGN.md §10); an edit sends each changed part
// as the value last seen and the new one, and a 409 re-bases on the form as
// the plan now has it while keeping the leader's changes.
import { useId, useState } from "react";
import {
  parseTripPlanFormCreate,
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
import { formPatch, mintSlug, type FormValues } from "./plansModel";
import classes from "./plans.module.css";

const copy = TRIP_PLAN_FORMS.copy;

const questionCount = (count: number) =>
  `${count} ${count === 1 ? "question" : "questions"}`;

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
  const [opened] = useState(values);
  const [seen, setSeen] = useState(values);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (stale && form && JSON.stringify(valuesOf(form)) !== JSON.stringify(seen))
    setSeen(valuesOf(form));

  const dirty =
    values != null && JSON.stringify(values) !== JSON.stringify(opened);
  const guard = useUnsavedChangesGuard(dirty, onClose);

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
      if (err instanceof ApiError && err.status === 409) {
        setStale(true);
        onStale();
      }
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
                subtitle={questionCount(
                  TRIP_PLAN_FORM_PRESETS[id].questions.length,
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
            onSubmit={(event) => {
              event.preventDefault();
              if (!busy) void submit();
            }}
          >
            <TextField
              label={copy.title}
              required
              value={values.title}
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
                  { value: "members", label: copy.visibleToMembers },
                ]}
              />
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
