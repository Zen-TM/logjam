// A leader's form builder: a new form starts from a template, one of their
// other plans' forms or blank; then every part can change. One sheet for
// making and editing (shared/DESIGN.md §10). An edit sends each changed part
// as the value last seen and the new one; when the plan is fetched again
// under it, every part the leader has not touched follows the form as it now
// is (`tripPlanAdoptTheirs`), so a save never sends another leader's change
// back. Logjam Web's twin is PlanFormBuilderDialog.tsx.
import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { Text, View } from "react-native";
import {
  ApiError,
  messageFromError,
  parseTripPlanFormCreate,
  pluralCount,
  tripPlanAdoptTheirs,
  tripPlanBlankForm,
  tripPlanBlankQuestion,
  tripPlanFormPatch,
  tripPlanInPlanNow,
  tripPlanKindHasOptions,
  tripPlanMintSlug,
  tripPlanQuestionKindChanged,
  tripPlanSame,
  tripPlanTheirsChanged,
  planSectionsMoved,
  TRIP_PLAN_FORM_PRESET_IDS,
  TRIP_PLAN_FORM_PRESETS,
  TRIP_PLAN_FORM_TITLE_MAX_LENGTH,
  TRIP_PLAN_FORMS,
  TRIP_PLAN_MAX_OPTIONS,
  TRIP_PLAN_MAX_QUESTIONS,
  TRIP_PLAN_OPTION_LABEL_MAX_LENGTH,
  TRIP_PLAN_QUESTION_HELP_MAX_LENGTH,
  TRIP_PLAN_QUESTION_KIND_LABELS,
  TRIP_PLAN_QUESTION_KINDS,
  TRIP_PLAN_QUESTION_LABEL_MAX_LENGTH,
  type TripPlanFormValues,
  type TripPlanLeaderForm,
  type TripPlanQuestion,
  type TripPlanView,
} from "@logjam/shared";

import { unavailableReasonText } from "../auth/capabilities";
import { makeStyles, muted, radius, spacing, useTheme } from "../theme";
import {
  BottomSheet,
  Button,
  ChipRail,
  ErrorBanner,
  FormStack,
  IconButton,
  Row,
  SectionHeader,
  SwitchRow,
  TextField,
} from "../ui";
import { Field } from "../ui/Field";
import { createForm, getLeaderForms, patchForm } from "./plansApi";
import { afterPlanWrite } from "./plansCache";

const copy = TRIP_PLAN_FORMS.copy;
const OFFLINE = unavailableReasonText("needs-connection");

/** Which builder is open: a new form, or one of the plan's. */
export type FormBuilderState =
  | { mode: "new" }
  | { mode: "edit"; formId: string }
  | null;

const valuesOf = (form: {
  title: string;
  preset: TripPlanFormValues["preset"];
  questions: TripPlanQuestion[];
  visibleTo: TripPlanFormValues["visibleTo"];
}): TripPlanFormValues => ({
  title: form.title,
  preset: form.preset,
  questions: form.questions,
  visibleTo: form.visibleTo,
});

export function FormBuilderSheet({
  state,
  plan,
  online,
  onState,
  onInfo,
}: {
  state: FormBuilderState;
  plan: TripPlanView;
  online: boolean;
  onState: Dispatch<SetStateAction<FormBuilderState>>;
  onInfo: (message: string) => void;
}) {
  const theme = useTheme();
  const styles = useStyles();
  const form =
    state?.mode === "edit"
      ? plan.forms.find((each) => each.id === state.formId)
      : undefined;
  // A form deleted under an open sheet: nothing left to edit.
  const open = state?.mode === "new" || form != null;
  const close = () => onState(null);

  // A new form asks where to start first (values null); an edit starts filled.
  const formKey =
    state?.mode === "edit" && form
      ? `edit:${form.id}`
      : state?.mode === "new"
        ? "new"
        : null;
  const current = form ? valuesOf(form) : null;
  const [formFor, setFormFor] = useState<string | null>(null);
  const [opened, setOpened] = useState<TripPlanFormValues | null>(null);
  const [seen, setSeen] = useState<TripPlanFormValues | null>(null);
  const [values, setValues] = useState<TripPlanFormValues | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (formKey !== formFor) {
    setFormFor(formKey);
    setOpened(current);
    setSeen(current);
    setValues(current);
    setError(null);
  } else if (current && seen && values && !tripPlanSame(current, seen)) {
    const next = tripPlanAdoptTheirs(seen, values, current);
    setSeen(next.seen);
    setValues(next.values);
  }
  const theirs = (field: "title" | "questions") =>
    current && opened && values
      ? tripPlanTheirsChanged([field], values, current, opened)
      : false;

  // The other plans' forms, fetched when the picker is shown.
  const picking = formKey === "new" && values == null;
  const [others, setOthers] = useState<TripPlanLeaderForm[] | "failed" | null>(
    null,
  );
  useEffect(() => {
    if (!picking || !online) return;
    let live = true;
    setOthers(null);
    getLeaderForms(plan.id)
      .then((res) => live && setOthers(res.forms))
      .catch(() => live && setOthers("failed"));
    return () => {
      live = false;
    };
  }, [picking, online, plan.id]);

  // The API refuses widening a form others answered for leaders only.
  const widenLocked =
    form != null && form.visibleTo === "leaders" && form.answers.length > 0;

  const set = (next: Partial<TripPlanFormValues>) => {
    setValues((was) => (was ? { ...was, ...next } : was));
    setError(null);
  };
  const setQuestion = (index: number, next: TripPlanQuestion) =>
    values &&
    set({
      questions: values.questions.map((q, at) => (at === index ? next : q)),
    });
  const moveQuestion = (index: number, by: -1 | 1) => {
    if (!values) return;
    const ids = planSectionsMoved(
      values.questions.map((q) => q.id),
      index,
      by,
    );
    if (ids)
      set({
        questions: ids.map((id) => values.questions.find((q) => q.id === id)!),
      });
  };

  async function submit() {
    if (!values) return;
    const parsed = parseTripPlanFormCreate(values);
    if (!("value" in parsed)) {
      setError("sentence" in parsed ? parsed.sentence : copy.formSaveFailed);
      return;
    }
    const patch = seen && form ? tripPlanFormPatch(seen, parsed.value) : {};
    if (form && Object.keys(patch).length === 0) return close();
    // A save that lands after the sheet was swiped away leaves another open.
    const saving = state;
    setBusy(true);
    try {
      if (form) await patchForm(plan.id, form.id, patch);
      else await createForm(plan.id, parsed.value);
      await afterPlanWrite(plan.id);
      onState((now) => (now === saving ? null : now));
      onInfo(copy.formSaved);
    } catch (err) {
      setError(messageFromError(err, copy.formSaveFailed));
      if (err instanceof ApiError) await afterPlanWrite(plan.id);
    } finally {
      setBusy(false);
    }
  }

  // A new form's editor goes back to the picker; an edit has nowhere to go.
  const back =
    formKey === "new" && values
      ? () => {
          setValues(null);
          setError(null);
        }
      : undefined;

  return (
    <BottomSheet
      visible={open}
      onClose={back ?? close}
      onBack={back}
      title={form ? copy.editTitle : copy.newTitle}
      footer={
        values ? (
          <FormStack>
            {error ? <ErrorBanner message={error} /> : null}
            <Button
              label={form ? copy.saveForm : copy.add}
              icon="done"
              loading={busy}
              disabled={!online}
              disabledReason={OFFLINE}
              onPress={() => void submit()}
            />
            {online ? null : <Text style={styles.note}>{OFFLINE}</Text>}
          </FormStack>
        ) : undefined
      }
    >
      {open && !values ? (
        <View style={styles.stack}>
          <SectionHeader title={copy.startFrom} />
          <Row
            icon="form"
            title={copy.blank}
            onPress={() => setValues(tripPlanBlankForm())}
          />
          <SectionHeader title={copy.chooseTemplates} />
          {TRIP_PLAN_FORM_PRESET_IDS.map((id) => (
            <Row
              key={id}
              icon="form"
              title={TRIP_PLAN_FORM_PRESETS[id].title}
              subtitle={pluralCount(
                TRIP_PLAN_FORM_PRESETS[id].questions.length,
                "question",
              )}
              onPress={() =>
                setValues({ ...TRIP_PLAN_FORM_PRESETS[id], preset: id })
              }
            />
          ))}
          <SectionHeader title={copy.chooseMine} />
          {!online ? (
            <Text style={styles.note}>{OFFLINE}</Text>
          ) : others === "failed" ? (
            <Text style={styles.note}>{copy.chooseMineFailed}</Text>
          ) : others == null ? null : others.length === 0 ? (
            <Text style={styles.note}>{copy.chooseMineEmpty}</Text>
          ) : (
            others.map((other) => (
              <Row
                key={other.formId}
                icon="form"
                title={other.title}
                subtitle={`${other.planName} · ${pluralCount(other.questions.length, "question")}`}
                onPress={() => setValues(valuesOf(other))}
              />
            ))
          )}
        </View>
      ) : null}
      {values ? (
        <FormStack>
          <TextField
            label={copy.title}
            value={values.title}
            maxLength={TRIP_PLAN_FORM_TITLE_MAX_LENGTH}
            autoCapitalize="sentences"
            hint={
              theirs("title") && current
                ? tripPlanInPlanNow(current.title)
                : undefined
            }
            onChangeText={(title) => set({ title })}
          />
          <Field
            label={copy.visibleTo}
            hint={widenLocked ? copy.visibleToLocked : undefined}
          >
            <ChipRail
              options={[
                { value: "leaders", label: copy.visibleToLeaders },
                {
                  value: "members",
                  label: copy.visibleToMembers,
                  disabled: widenLocked,
                },
              ]}
              value={values.visibleTo}
              onChange={(visibleTo) => set({ visibleTo })}
            />
          </Field>
          <SectionHeader
            title={copy.questions}
            count={values.questions.length}
          />
          {theirs("questions") ? (
            <Text style={styles.note}>{copy.questionsChanged}</Text>
          ) : null}
          {values.questions.map((question, index) => (
            <View key={question.id} style={styles.question}>
              <TextField
                label={`${copy.questionLabel} ${index + 1}`}
                value={question.label}
                maxLength={TRIP_PLAN_QUESTION_LABEL_MAX_LENGTH}
                autoCapitalize="sentences"
                onChangeText={(label) =>
                  setQuestion(index, { ...question, label })
                }
              />
              <Field label={copy.questionKind}>
                <ChipRail
                  scroll
                  options={TRIP_PLAN_QUESTION_KINDS.map((kind) => ({
                    value: kind,
                    label: TRIP_PLAN_QUESTION_KIND_LABELS[kind],
                  }))}
                  value={question.kind}
                  onChange={(kind) =>
                    setQuestion(
                      index,
                      tripPlanQuestionKindChanged(question, kind),
                    )
                  }
                />
              </Field>
              <TextField
                label={copy.questionHelp}
                value={question.help ?? ""}
                maxLength={TRIP_PLAN_QUESTION_HELP_MAX_LENGTH}
                autoCapitalize="sentences"
                onChangeText={(help) =>
                  setQuestion(index, { ...question, help })
                }
              />
              {tripPlanKindHasOptions(question.kind) ? (
                <View style={styles.options}>
                  <SectionHeader title={copy.options} />
                  {(question.options ?? []).map((option, at) => (
                    <TextField
                      key={option.id}
                      label={`${copy.optionLabel} ${at + 1}`}
                      value={option.label}
                      maxLength={TRIP_PLAN_OPTION_LABEL_MAX_LENGTH}
                      autoCapitalize="sentences"
                      onChangeText={(label) =>
                        setQuestion(index, {
                          ...question,
                          options: question.options!.map((each) =>
                            each.id === option.id ? { ...each, label } : each,
                          ),
                        })
                      }
                      accessory={
                        <IconButton
                          icon="close"
                          accessibilityLabel={`${copy.removeOption} ${at + 1}`}
                          onPress={() =>
                            setQuestion(index, {
                              ...question,
                              options: question.options!.filter(
                                (each) => each.id !== option.id,
                              ),
                            })
                          }
                        />
                      }
                    />
                  ))}
                  <Button
                    compact
                    variant="outlineAccent"
                    icon="add"
                    label={copy.addOption}
                    disabled={
                      (question.options?.length ?? 0) >= TRIP_PLAN_MAX_OPTIONS
                    }
                    disabledReason={`${TRIP_PLAN_MAX_OPTIONS} options at most`}
                    onPress={() =>
                      setQuestion(index, {
                        ...question,
                        options: [
                          ...(question.options ?? []),
                          { id: tripPlanMintSlug("o"), label: "" },
                        ],
                      })
                    }
                  />
                </View>
              ) : null}
              <SwitchRow
                title={copy.questionRequired}
                checked={question.required}
                onChange={(required) =>
                  setQuestion(index, { ...question, required })
                }
              />
              <View style={styles.tools}>
                <IconButton
                  icon="collapse"
                  accessibilityLabel={`${copy.moveUp}: ${index + 1}`}
                  color={theme.textMuted}
                  disabled={index === 0}
                  onPress={() => moveQuestion(index, -1)}
                />
                <IconButton
                  icon="expand"
                  accessibilityLabel={`${copy.moveDown}: ${index + 1}`}
                  color={theme.textMuted}
                  disabled={index === values.questions.length - 1}
                  onPress={() => moveQuestion(index, 1)}
                />
                <IconButton
                  icon="delete"
                  accessibilityLabel={`${copy.removeQuestion}: ${index + 1}`}
                  color={theme.warning}
                  onPress={() =>
                    set({
                      questions: values.questions.filter(
                        (_, at) => at !== index,
                      ),
                    })
                  }
                />
              </View>
            </View>
          ))}
          <Button
            variant="outlineAccent"
            icon="add"
            label={copy.addQuestion}
            disabled={values.questions.length >= TRIP_PLAN_MAX_QUESTIONS}
            disabledReason={`${TRIP_PLAN_MAX_QUESTIONS} questions at most`}
            onPress={() =>
              set({ questions: [...values.questions, tripPlanBlankQuestion()] })
            }
          />
        </FormStack>
      ) : null}
    </BottomSheet>
  );
}

const useStyles = makeStyles((theme, textRole) => ({
  stack: { gap: spacing(1) },
  note: { ...muted(theme, textRole.detail) },
  question: {
    gap: spacing(1.5),
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: radius.lg,
    padding: spacing(1.5),
  },
  options: { gap: spacing(1) },
  tools: { flexDirection: "row", justifyContent: "flex-end" },
}));
