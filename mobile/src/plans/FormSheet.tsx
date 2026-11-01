// A plan's form (`TRIP_PLAN_FORMS`): who sees the answers, the caller's own
// answer, then everyone's when the caller may see them. Answering is the
// sheet's sub-mode, back to the form, as SectionSheet's edit is. A leader's
// Edit hands over to FormBuilderSheet; Delete is confirmed here
// (`PLAN_FORM_VERBS`).
import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { Alert, Text, View } from "react-native";
import {
  answersFromDraft,
  ApiError,
  contractSectionKeys,
  draftFromAnswers,
  fitAnswerDraft,
  messageFromError,
  parseTripPlanAnswers,
  planFormDeleteConfirm,
  planVerbsFor,
  PLAN_FORM_VERBS,
  tripPlanAnswerRows,
  tripPlanAnswerText,
  tripPlanFormTally,
  tripPlanFormTallyLines,
  tripPlanSeesAnswers,
  tripPlanVisibilityLine,
  TRIP_PLAN_FORMS,
  TRIP_PLAN_VISIBILITY_CHANGED_SENTENCE,
  type SectionKeysOn,
  type TripPlanAnswerDraft,
  type TripPlanAnswers,
  type TripPlanFormView,
  type TripPlanQuestion,
  type TripPlanView,
} from "@logjam/shared";

import { unavailableReasonText } from "../auth/capabilities";
import { AttributeTable } from "../customFields/CustomFieldValues";
import { makeStyles, muted, spacing, useTheme } from "../theme";
import {
  BottomSheet,
  Button,
  ErrorBanner,
  IconButton,
  Row,
  SectionHeader,
} from "../ui";
import { PlanFormFields } from "./PlanFormFields";
import { deleteForm, putAnswer } from "./plansApi";
import { afterPlanWrite } from "./plansCache";

const copy = TRIP_PLAN_FORMS.copy;
const OFFLINE = unavailableReasonText("needs-connection");

/** `verbs`: the form's ⋯ (a leader's Delete form), as rows. */
export type FormSheetState = {
  formId: string;
  mode: "read" | "answer" | "verbs";
} | null;

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
  me,
  online,
  onState,
  onInfo,
  onError,
  onEdit,
}: {
  state: FormSheetState;
  plan: TripPlanView;
  /** The caller's user id, for a leader's tally. */
  me: string | null;
  online: boolean;
  onState: Dispatch<SetStateAction<FormSheetState>>;
  onInfo: (message: string) => void;
  /** A refusal the sheet can no longer show: it closed, or left answering. */
  onError: (message: string) => void;
  /** A leader's Edit form: the builder takes over. */
  onEdit: (formId: string) => void;
}) {
  const theme = useTheme();
  const styles = useStyles();
  const form = state
    ? plan.forms.find((each) => each.id === state.formId)
    : undefined;
  // An archived plan is read-only: its answers stay, nothing is sent.
  const canAnswer = plan.archivedAt == null;
  const answering = state?.mode === "answer" && form != null && canAnswer;
  const choosing = state?.mode === "verbs" && form != null;
  const verbs = planVerbsFor(PLAN_FORM_VERBS, "gps", plan.myRole, {
    archived: plan.archivedAt != null,
  });

  // The draft lives here, so Send can sit in the footer. It starts from the
  // caller's answer, and a form changed under it (a 409, then the refetch)
  // keeps what still fits (`fitAnswerDraft`).
  const [draft, setDraft] = useState<TripPlanAnswerDraft>({});
  const [draftFor, setDraftFor] = useState<Pick<
    TripPlanFormView,
    "id" | "updatedAt" | "questions" | "visibleTo"
  > | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Who sees the answers changed under the draft: said by the footer until
  // Send or a way out, never as a refusal (edits leave it, so does the toast).
  const [changed, setChanged] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!answering || !form) {
    if (draftFor) setDraftFor(null);
  } else if (draftFor?.id !== form.id) {
    setDraftFor(form);
    setDraft(draftFromAnswers(form.questions, form.myAnswer?.answers ?? {}));
    setError(null);
    setChanged(false);
  } else if (draftFor.updatedAt !== form.updatedAt) {
    setDraft(fitAnswerDraft(draftFor.questions, form.questions, draft));
    setDraftFor(form);
    // Widened or narrowed under the person typing (a refetch from any push):
    // said before Send, which now carries the new visibility.
    if (draftFor.visibleTo !== form.visibleTo) setChanged(true);
  }
  // A refusal that took answering away (the plan archived, the form deleted)
  // or landed after the sheet was left goes to the page's toast, once. The
  // banner shows only while answering, and answering again clears it.
  const handed = useRef<string | null>(null);
  useEffect(() => {
    if (!error) handed.current = null;
    else if (!answering && handed.current !== error) {
      handed.current = error;
      onError(error);
    }
  }, [error, answering, onError]);

  const back =
    (answering || choosing) && form
      ? () => {
          setError(null);
          setChanged(false);
          onState({ formId: form.id, mode: "read" });
        }
      : undefined;
  // Edit hands over to the builder once this sheet has gone: a sheet can't
  // open while another closes (PlanItemSheet's Save a copy does the same).
  const parked = useRef<(() => void) | null>(null);
  const close = () => {
    setError(null);
    setChanged(false);
    onState(null);
  };

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
    // A refusal from before is answered by this Send, whatever it gets.
    setError(null);
    setChanged(false);
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

  function remove(target: TripPlanFormView) {
    const confirm = planFormDeleteConfirm(target);
    Alert.alert(confirm.confirmTitle, confirm.confirmBody, [
      { text: "Cancel", style: "cancel" },
      {
        text: confirm.confirmLabel,
        style: "destructive",
        onPress: () => {
          onState(null);
          deleteForm(plan.id, target.id)
            .then(() => afterPlanWrite(plan.id))
            .then(() => onInfo(copy.deleted))
            .catch(async (err: unknown) => {
              if (err instanceof ApiError) await afterPlanWrite(plan.id);
              onError(messageFromError(err, copy.deleteFailed));
            });
        },
      },
    ]);
  }

  const sees = form ? tripPlanSeesAnswers(plan.myRole, form.visibleTo) : false;
  const rows = form ? tripPlanAnswerRows(form, plan.members) : null;
  const tally = form && me ? tripPlanFormTally(plan, form, me) : null;
  const sections: Record<
    SectionKeysOn<typeof TRIP_PLAN_FORMS, "gps">,
    ReactNode
  > | null =
    form && rows
      ? {
          // The title is the sheet's; its ⋯ is the verbs mode.
          hero:
            verbs.length > 0 ? (
              <View style={styles.actions}>
                <IconButton
                  icon="overflow"
                  accessibilityLabel={copy.actions}
                  color={theme.textMuted}
                  onPress={() => onState({ formId: form.id, mode: "verbs" })}
                />
              </View>
            ) : null,
          visibility: (
            <View style={styles.block}>
              <Text style={styles.muted}>
                {tripPlanVisibilityLine(form.visibleTo, form.preset)}
              </Text>
              {tally
                ? tripPlanFormTallyLines(tally, me ?? undefined).map((line) => (
                    <Text key={line} style={styles.muted}>
                      {line}
                    </Text>
                  ))
                : null}
            </View>
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
                    onPress={() => onState({ formId: form.id, mode: "answer" })}
                  />
                  {online ? null : (
                    <Text style={styles.offline}>{OFFLINE}</Text>
                  )}
                </>
              ) : null}
            </View>
          ),
          // A row per person going, those without an answer last, then for
          // a leader those asking to join, marked so (`tripPlanAnswerRows`).
          list: sees ? (
            <View style={styles.block}>
              <SectionHeader title={copy.answers} count={rows.going.length} />
              {rows.going.map(({ user, answer }) => (
                <View key={user.id} style={styles.person}>
                  <Text style={styles.username}>{user.username}</Text>
                  {answer ? (
                    <AttributeTable
                      rows={answerRows(form.questions, answer.answers)}
                    />
                  ) : (
                    <Text style={styles.muted}>{copy.noAnswerYet}</Text>
                  )}
                </View>
              ))}
              {rows.asking.length > 0 ? (
                <SectionHeader title={copy.asking} count={rows.asking.length} />
              ) : null}
              {rows.asking.map(({ user, answer }) => (
                <View key={user.id} style={styles.person}>
                  <Text style={styles.username}>{user.username}</Text>
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
      // Inside answering, every way out (drag, back, ×) backs out one layer.
      onClose={back ?? close}
      title={form?.title ?? ""}
      onBack={back}
      onClosed={() => {
        const open = parked.current;
        parked.current = null;
        open?.();
      }}
      footer={
        answering && form ? (
          <View style={styles.footer}>
            {changed ? (
              <Text style={styles.changed}>
                {TRIP_PLAN_VISIBILITY_CHANGED_SENTENCE}
              </Text>
            ) : null}
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
        <PlanFormFields
          form={form}
          draft={draft}
          onChange={(next) => {
            setDraft(next);
            setError(null);
          }}
        />
      ) : choosing && form ? (
        <View style={styles.block}>
          {verbs.map((verb) => (
            <Row
              key={verb.id}
              icon={verb.icon}
              hue={verb.danger ? theme.warning : undefined}
              title={verb.label}
              subtitle={online ? undefined : OFFLINE}
              disabled={!online}
              onPress={() => {
                if (verb.id === "delete") remove(form);
                else {
                  parked.current = () => onEdit(form.id);
                  onState(null);
                }
              }}
            />
          ))}
        </View>
      ) : sections ? (
        <View style={styles.body}>
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
  actions: { flexDirection: "row", justifyContent: "flex-end" },
  person: { gap: spacing(0.5), paddingTop: spacing(1) },
  username: { ...textRole.rowTitle, color: theme.text },
  muted: { ...muted(theme, textRole.detail) },
  offline: { ...muted(theme, textRole.detail), textAlign: "center" },
  footer: { gap: spacing(1) },
  changed: { ...textRole.detail, color: theme.text },
}));
