// A leader's form builder: a new form starts from a template, one of their
// other plans' forms or blank; then every part can change. One sheet for
// making and editing (shared/DESIGN.md §10). An edit sends each changed part
// as the value last seen and the new one; when the plan is fetched again
// under it, every part the leader has not touched follows the form as it now
// is (`tripPlanAdoptTheirs`), so a save never sends another leader's change
// back. Logjam Web's twin is PlanFormBuilderDialog.tsx.
import {
  memo,
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { Alert, Text, View } from "react-native";
import {
  ApiError,
  messageFromError,
  parseTripPlanFormCreate,
  pluralCount,
  tripPlanAdoptTheirs,
  tripPlanAtMost,
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
  TRIP_PLAN_FORM_PRESET_BLURBS,
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
  ErrorState,
  FormStack,
  IconButton,
  LoadingState,
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
  // Where a new form began (blank, a template or a copy): what "changed" is
  // measured from. An edit measures from `seen`.
  const [started, setStarted] = useState<TripPlanFormValues | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (formKey !== formFor) {
    setFormFor(formKey);
    setOpened(current);
    setSeen(current);
    setValues(current);
    setStarted(null);
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
  const [attempt, setAttempt] = useState(0);
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
  }, [picking, online, plan.id, attempt]);
  const start = (next: TripPlanFormValues) => {
    setStarted(next);
    setValues(next);
  };

  // The API refuses widening a form others answered for leaders only.
  const widenLocked =
    form != null && form.visibleTo === "leaders" && form.answers.length > 0;

  const set = (next: Partial<TripPlanFormValues>) => {
    setValues((was) => (was ? { ...was, ...next } : was));
    setError(null);
  };
  // Stable and keyed by question id, so typing in one question redraws only
  // that card (`QuestionCard` is memoised).
  const changeQuestion = useCallback(
    (id: string, next: (question: TripPlanQuestion) => TripPlanQuestion) => {
      setValues((was) =>
        was
          ? {
              ...was,
              questions: was.questions.map((q) => (q.id === id ? next(q) : q)),
            }
          : was,
      );
      setError(null);
    },
    [],
  );
  const moveQuestion = useCallback((id: string, by: -1 | 1) => {
    setValues((was) => {
      if (!was) return was;
      const ids = planSectionsMoved(
        was.questions.map((q) => q.id),
        was.questions.findIndex((q) => q.id === id),
        by,
      );
      return ids
        ? {
            ...was,
            questions: ids.map(
              (each) => was.questions.find((q) => q.id === each)!,
            ),
          }
        : was;
    });
  }, []);
  const removeQuestion = useCallback((id: string) => {
    setValues((was) =>
      was
        ? { ...was, questions: was.questions.filter((q) => q.id !== id) }
        : was,
    );
  }, []);

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

  // Unsaved work asks before it goes (Discard changes?, as the route editor
  // on the map does). A saving sheet doesn't close at all.
  const dirty =
    values != null &&
    (form ? seen : started) != null &&
    !tripPlanSame(values, form ? seen : started);
  const leave = (go: () => void) => {
    if (!dirty) return go();
    Alert.alert(copy.discardTitle, copy.discardBody, [
      { text: copy.discardKeep, style: "cancel" },
      { text: copy.discardConfirm, style: "destructive", onPress: go },
    ]);
  };
  // A new form's editor goes back to the picker; an edit has nowhere to go.
  const back =
    formKey === "new" && values
      ? () =>
          leave(() => {
            setValues(null);
            setStarted(null);
            setError(null);
          })
      : undefined;
  const closeSheet = () => leave(close);

  return (
    <BottomSheet
      visible={open}
      onClose={back ?? closeSheet}
      onBack={back}
      closable={!busy}
      title={form ? copy.editTitle : copy.newTitle}
      footer={
        values ? (
          <FormStack>
            {error ? <ErrorBanner message={error} /> : null}
            <Button
              label={form ? copy.saveForm : copy.add}
              icon="done"
              loading={busy}
              disabled={!online || values.title.trim() === ""}
              disabledReason={online ? copy.titleNeeded : OFFLINE}
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
            icon="add"
            title={copy.blank}
            subtitle={copy.chooseBlankHint}
            onPress={() => start(tripPlanBlankForm())}
          />
          <SectionHeader title={copy.chooseTemplates} />
          {TRIP_PLAN_FORM_PRESET_IDS.map((id) => (
            <Row
              key={id}
              icon="form"
              title={TRIP_PLAN_FORM_PRESETS[id].title}
              subtitle={`${TRIP_PLAN_FORM_PRESET_BLURBS[id]} ${pluralCount(
                TRIP_PLAN_FORM_PRESETS[id].questions.length,
                "question",
              )}.`}
              onPress={() =>
                start({ ...TRIP_PLAN_FORM_PRESETS[id], preset: id })
              }
            />
          ))}
          <SectionHeader title={copy.chooseMine} />
          {!online ? (
            <Text style={styles.note}>{OFFLINE}</Text>
          ) : others === "failed" ? (
            <ErrorState
              message={copy.chooseMineFailed}
              onRetry={() => setAttempt((n) => n + 1)}
            />
          ) : others == null ? (
            <LoadingState label={copy.chooseMineLoading} />
          ) : others.length === 0 ? (
            <Text style={styles.note}>{copy.chooseMineEmpty}</Text>
          ) : (
            // Under their plan, so the same name in two plans tells apart.
            [...new Set(others.map((other) => other.planId))].map((planId) => {
              const forms = others.filter((other) => other.planId === planId);
              return (
                <View key={planId} style={styles.stack}>
                  <SectionHeader title={forms[0].planName} />
                  {forms.map((other) => (
                    <Row
                      key={other.formId}
                      icon="copy"
                      title={other.title}
                      subtitle={pluralCount(other.questions.length, "question")}
                      onPress={() => start(valuesOf(other))}
                    />
                  ))}
                </View>
              );
            })
          )}
        </View>
      ) : null}
      {values ? (
        <FormStack>
          <TextField
            label={copy.title}
            placeholder={copy.titlePlaceholder}
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
            <QuestionCard
              key={question.id}
              question={question}
              index={index}
              last={index === values.questions.length - 1}
              onChange={changeQuestion}
              onMove={moveQuestion}
              onRemove={removeQuestion}
            />
          ))}
          <Button
            variant="outlineAccent"
            icon="add"
            label={copy.addQuestion}
            disabled={values.questions.length >= TRIP_PLAN_MAX_QUESTIONS}
            disabledReason={tripPlanAtMost(
              TRIP_PLAN_MAX_QUESTIONS,
              "questions",
            )}
            onPress={() =>
              set({ questions: [...values.questions, tripPlanBlankQuestion()] })
            }
          />
        </FormStack>
      ) : null}
    </BottomSheet>
  );
}

/** One question's card. Memoised with id-keyed callbacks: a keystroke in one
 *  question redraws that card, not all forty. */
const QuestionCard = memo(function QuestionCard({
  question,
  index,
  last,
  onChange,
  onMove,
  onRemove,
}: {
  question: TripPlanQuestion;
  index: number;
  last: boolean;
  onChange: (
    id: string,
    next: (question: TripPlanQuestion) => TripPlanQuestion,
  ) => void;
  onMove: (id: string, by: -1 | 1) => void;
  onRemove: (id: string) => void;
}) {
  const theme = useTheme();
  const styles = useStyles();
  const change = (patch: Partial<TripPlanQuestion>) =>
    onChange(question.id, (was) => ({ ...was, ...patch }));
  return (
    <View style={styles.question}>
      <TextField
        label={`${copy.questionLabel} ${index + 1}`}
        placeholder={copy.questionPlaceholder}
        value={question.label}
        maxLength={TRIP_PLAN_QUESTION_LABEL_MAX_LENGTH}
        autoCapitalize="sentences"
        onChangeText={(label) => change({ label })}
      />
      <Field label={copy.questionKind}>
        <ChipRail
          scroll
          options={KIND_OPTIONS}
          value={question.kind}
          onChange={(kind) =>
            onChange(question.id, (was) =>
              tripPlanQuestionKindChanged(was, kind),
            )
          }
        />
      </Field>
      <TextField
        label={copy.questionHelp}
        value={question.help ?? ""}
        maxLength={TRIP_PLAN_QUESTION_HELP_MAX_LENGTH}
        autoCapitalize="sentences"
        onChangeText={(help) => change({ help })}
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
                onChange(question.id, (was) => ({
                  ...was,
                  options: was.options?.map((each) =>
                    each.id === option.id ? { ...each, label } : each,
                  ),
                }))
              }
              accessory={
                <IconButton
                  icon="close"
                  accessibilityLabel={`${copy.removeOption} ${at + 1}`}
                  onPress={() =>
                    onChange(question.id, (was) => ({
                      ...was,
                      options: was.options?.filter(
                        (each) => each.id !== option.id,
                      ),
                    }))
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
            disabled={(question.options?.length ?? 0) >= TRIP_PLAN_MAX_OPTIONS}
            disabledReason={tripPlanAtMost(TRIP_PLAN_MAX_OPTIONS, "options")}
            onPress={() =>
              onChange(question.id, (was) => ({
                ...was,
                options: [
                  ...(was.options ?? []),
                  { id: tripPlanMintSlug("o"), label: "" },
                ],
              }))
            }
          />
        </View>
      ) : null}
      <SwitchRow
        title={copy.questionRequired}
        checked={question.required}
        onChange={(required) => change({ required })}
      />
      <View style={styles.tools}>
        <IconButton
          icon="collapse"
          accessibilityLabel={`${copy.moveUp}: ${index + 1}`}
          color={theme.textMuted}
          disabled={index === 0}
          onPress={() => onMove(question.id, -1)}
        />
        <IconButton
          icon="expand"
          accessibilityLabel={`${copy.moveDown}: ${index + 1}`}
          color={theme.textMuted}
          disabled={last}
          onPress={() => onMove(question.id, 1)}
        />
        <IconButton
          icon="delete"
          accessibilityLabel={`${copy.removeQuestion}: ${index + 1}`}
          color={theme.warning}
          onPress={() => onRemove(question.id)}
        />
      </View>
    </View>
  );
});

const KIND_OPTIONS = TRIP_PLAN_QUESTION_KINDS.map((kind) => ({
  value: kind,
  label: TRIP_PLAN_QUESTION_KIND_LABELS[kind],
}));

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
