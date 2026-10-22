// A plan form's questions, as a member answering it and a joiner both fill
// them in: one control per question kind, holding the shared draft
// (`tripPlanAnswerDraft.ts`). Logjam Web's twin is `PlanFormFields` in
// PlanAnswerDialog.tsx; the parser that checks what is sent is shared too.
import { Text } from "react-native";
import {
  tripPlanVisibilityLine,
  TRIP_PLAN_FORMS,
  TRIP_PLAN_LONG_TEXT_ANSWER_MAX_LENGTH,
  TRIP_PLAN_TEXT_ANSWER_MAX_LENGTH,
  type TripPlanAnswerDraft,
  type TripPlanFormView,
  type TripPlanQuestion,
} from "@logjam/shared";

import { makeStyles, muted } from "../theme";
import {
  ChipPicker,
  ChipRail,
  Field,
  FormStack,
  SwitchRow,
  TextField,
} from "../ui";

const copy = TRIP_PLAN_FORMS.copy;

function QuestionField({
  question,
  value,
  onChange,
}: {
  question: TripPlanQuestion;
  value: TripPlanAnswerDraft[string] | undefined;
  onChange: (next: TripPlanAnswerDraft[string]) => void;
}) {
  const label = question.required ? `${question.label} *` : question.label;
  const hint = question.help || undefined;
  const text = typeof value === "string" ? value : "";
  switch (question.kind) {
    case "text":
    case "phone":
    case "longText":
    case "number":
      return (
        <TextField
          label={label}
          hint={hint}
          value={text}
          onChangeText={onChange}
          multiline={question.kind === "longText"}
          maxLength={
            question.kind === "longText"
              ? TRIP_PLAN_LONG_TEXT_ANSWER_MAX_LENGTH
              : TRIP_PLAN_TEXT_ANSWER_MAX_LENGTH
          }
          keyboardType={
            question.kind === "phone"
              ? "phone-pad"
              : question.kind === "number"
                ? "number-pad"
                : "default"
          }
          autoComplete={question.kind === "phone" ? "tel" : "off"}
        />
      );
    case "choice":
    case "yesNo":
      return (
        <Field label={label} hint={hint}>
          <ChipRail
            scroll
            value={text}
            onChange={onChange}
            options={[
              // An optional pick can be taken back (shared/DESIGN.md §10).
              ...(question.required ? [] : [{ value: "", label: "—" }]),
              ...(question.kind === "yesNo"
                ? [
                    { value: "true", label: copy.yes },
                    { value: "false", label: copy.no },
                  ]
                : (question.options ?? []).map((option) => ({
                    value: option.id,
                    label: option.label,
                  }))),
            ]}
          />
        </Field>
      );
    case "multiChoice": {
      const ticked = Array.isArray(value) ? value : [];
      return (
        <ChipPicker
          label={label}
          hint={hint}
          options={(question.options ?? []).map((option) => ({
            value: option.id,
            label: option.label,
          }))}
          selected={ticked}
          onToggle={(id) =>
            onChange(
              ticked.includes(id)
                ? ticked.filter((each) => each !== id)
                : [...ticked, id],
            )
          }
        />
      );
    }
    case "agree":
      return (
        <SwitchRow
          title={label}
          description={hint}
          checked={value === true}
          onChange={onChange}
        />
      );
  }
}

/** Who sees the answers, then the questions. */
export function PlanFormFields({
  form,
  draft,
  onChange,
}: {
  form: Pick<TripPlanFormView, "questions" | "visibleTo" | "preset">;
  draft: TripPlanAnswerDraft;
  onChange: (next: TripPlanAnswerDraft) => void;
}) {
  const styles = useStyles();
  return (
    <FormStack>
      <Text style={styles.visibility}>
        {tripPlanVisibilityLine(form.visibleTo, form.preset)}
      </Text>
      {form.questions.map((question) => (
        <QuestionField
          key={question.id}
          question={question}
          value={draft[question.id]}
          onChange={(next) => onChange({ ...draft, [question.id]: next })}
        />
      ))}
    </FormStack>
  );
}

const useStyles = makeStyles((theme, textRole) => ({
  visibility: { ...muted(theme, textRole.detail) },
}));
