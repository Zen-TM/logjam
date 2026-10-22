// A plan's form (`TRIP_PLAN_FORMS`): who sees the answers, the caller's own
// answer, then everyone's when the caller may see them. Answering is the
// sheet's sub-mode, back to the form, as SectionSheet's edit is. Building a
// form is Logjam Web's (the contract's `table` and the builder are `on: "web"`).
import { useState, type Dispatch, type SetStateAction } from "react";
import { Text, View } from "react-native";
import {
  answersFromDraft,
  ApiError,
  contractSectionKeys,
  draftFromAnswers,
  fitAnswerDraft,
  messageFromError,
  parseTripPlanAnswers,
  tripPlanAnswerText,
  tripPlanSeesAnswers,
  tripPlanVisibilityLine,
  TRIP_PLAN_FORMS,
  type TripPlanAnswerDraft,
  type TripPlanAnswers,
  type TripPlanFormView,
  type TripPlanQuestion,
  type TripPlanView,
} from "@logjam/shared";

import { unavailableReasonText } from "../auth/capabilities";
import { AttributeTable } from "../customFields/CustomFieldValues";
import { makeStyles, muted, spacing } from "../theme";
import {
  BottomSheet,
  Button,
  ErrorBanner,
  SectionHeader,
  StatusPill,
} from "../ui";
import { PlanFormFields } from "./PlanFormFields";
import { putAnswer } from "./plansApi";
import { afterPlanWrite } from "./plansCache";

const copy = TRIP_PLAN_FORMS.copy;
const OFFLINE = unavailableReasonText("needs-connection");

export type FormSheetState = { formId: string; answering: boolean } | null;

/** One person's answers, question by question, in the form's order. */
const answerRows = (
  questions: readonly TripPlanQuestion[],
  answers: TripPlanAnswers,
) =>
  questions.map(
    (question) =>
      [
        question.id,
        question.label,
        tripPlanAnswerText(question, answers[question.id]) || "—",
        null,
      ] as [string, string, string, null],
  );

export function FormSheet({
  state,
  plan,
  online,
  onState,
  onInfo,
}: {
  state: FormSheetState;
  plan: TripPlanView;
  online: boolean;
  onState: Dispatch<SetStateAction<FormSheetState>>;
  onInfo: (message: string) => void;
}) {
  const styles = useStyles();
  const form = state
    ? plan.forms.find((each) => each.id === state.formId)
    : undefined;
  // An archived plan is read-only: its answers stay, nothing is sent.
  const canAnswer = plan.archivedAt == null;
  const answering = state?.answering === true && form != null && canAnswer;

  // The draft lives here, so Send can sit in the footer. It starts from the
  // caller's answer, and a form changed under it (a 409, then the refetch)
  // keeps what still fits (`fitAnswerDraft`).
  const [draft, setDraft] = useState<TripPlanAnswerDraft>({});
  const [draftFor, setDraftFor] = useState<Pick<
    TripPlanFormView,
    "id" | "updatedAt" | "questions"
  > | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!answering || !form) {
    if (draftFor) {
      setDraftFor(null);
      setError(null);
    }
  } else if (draftFor?.id !== form.id) {
    setDraftFor(form);
    setDraft(draftFromAnswers(form.questions, form.myAnswer?.answers ?? {}));
    setError(null);
  } else if (draftFor.updatedAt !== form.updatedAt) {
    setDraft(fitAnswerDraft(draftFor.questions, form.questions, draft));
    setDraftFor(form);
  }

  async function send(target: TripPlanFormView) {
    const parsed = parseTripPlanAnswers(
      target.questions,
      answersFromDraft(target.questions, draft),
    );
    if (!("value" in parsed)) {
      setError("sentence" in parsed ? parsed.sentence : copy.saveFailed);
      return;
    }
    const sending = state;
    setBusy(true);
    try {
      await putAnswer(plan.id, target.id, {
        answers: parsed.value,
        visibleTo: target.visibleTo,
        formUpdatedAt: target.updatedAt,
      });
      await afterPlanWrite(plan.id);
      // Closed, as Logjam Web's dialog closes, so the toast shows; unless
      // the sheet has moved on meanwhile.
      onState((now) => (now === sending ? null : now));
      onInfo(copy.saved);
    } catch (err) {
      setError(messageFromError(err, copy.saveFailed));
      // A 409 is the form or who sees it changing: fetched again, the draft
      // is refitted above and the new visibility line shows before a resend.
      if (err instanceof ApiError) await afterPlanWrite(plan.id);
    } finally {
      setBusy(false);
    }
  }

  const sections = form
    ? {
        // The sheet's title.
        hero: null,
        visibility: (
          <Text style={styles.muted}>
            {tripPlanVisibilityLine(form.visibleTo, form.preset)}
          </Text>
        ),
        mine: (
          <View style={styles.block}>
            <SectionHeader title={copy.mine} />
            {form.myAnswer ? (
              <AttributeTable
                rows={answerRows(form.questions, form.myAnswer.answers)}
              />
            ) : (
              <Text style={styles.muted}>{copy.noAnswer}</Text>
            )}
            {canAnswer ? (
              <>
                <Button
                  label={form.myAnswer ? copy.change : copy.answer}
                  variant="outlineAccent"
                  disabled={!online}
                  disabledReason={OFFLINE}
                  onPress={() => onState({ formId: form.id, answering: true })}
                />
                {online ? null : <Text style={styles.offline}>{OFFLINE}</Text>}
              </>
            ) : null}
          </View>
        ),
        list:
          tripPlanSeesAnswers(plan.myRole, form.visibleTo) &&
          form.answers.length > 0 ? (
            <View style={styles.block}>
              <SectionHeader title={copy.answers} count={form.answers.length} />
              {form.answers.map((answer) => (
                <View key={answer.user.id} style={styles.person}>
                  <View style={styles.name}>
                    <Text style={styles.username}>{answer.user.username}</Text>
                    {plan.members.some(
                      (member) =>
                        member.user.id === answer.user.id &&
                        member.status === "requested",
                    ) ? (
                      <StatusPill label={copy.asking} tone="outline" />
                    ) : null}
                  </View>
                  <AttributeTable
                    rows={answerRows(form.questions, answer.answers)}
                  />
                </View>
              ))}
            </View>
          ) : null,
      }
    : null;

  return (
    <BottomSheet
      visible={form != null}
      onClose={() => onState(null)}
      title={form?.title ?? ""}
      onBack={
        answering && form
          ? () => onState({ formId: form.id, answering: false })
          : undefined
      }
      footer={
        answering && form ? (
          <View style={styles.footer}>
            {error ? <ErrorBanner message={error} /> : null}
            <Button
              label={copy.save}
              loading={busy}
              disabled={!online}
              disabledReason={OFFLINE}
              onPress={() => void send(form)}
            />
            {online ? null : <Text style={styles.offline}>{OFFLINE}</Text>}
          </View>
        ) : undefined
      }
    >
      {answering && form ? (
        <PlanFormFields form={form} draft={draft} onChange={setDraft} />
      ) : sections ? (
        <View style={styles.body}>
          {/* The hero is the sheet's title: no empty slot for it. */}
          {contractSectionKeys(TRIP_PLAN_FORMS, "gps").map((key) =>
            sections[key] ? <View key={key}>{sections[key]}</View> : null,
          )}
        </View>
      ) : null}
    </BottomSheet>
  );
}

const useStyles = makeStyles((theme, textRole) => ({
  body: { gap: spacing(2) },
  block: { gap: spacing(1) },
  person: { gap: spacing(0.5), paddingTop: spacing(1) },
  name: { flexDirection: "row", alignItems: "center", gap: spacing(1) },
  username: { ...textRole.rowTitle, color: theme.text },
  muted: { ...muted(theme, textRole.detail) },
  offline: { ...muted(theme, textRole.detail), textAlign: "center" },
  footer: { gap: spacing(1) },
}));
