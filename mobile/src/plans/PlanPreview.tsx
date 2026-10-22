// A plan someone is invited to by username, before they join: the write-up,
// the forms required to join and who is going (GET /plans/:id/preview), with
// Join and Decline. Join answers those forms in a sheet (`TRIP_PLAN_JOIN`),
// with the controls the Forms tab answers with (`PlanFormFields`). Logjam
// Web's twin is PlanInvitedPage with PlanJoinDialog. Online only: a preview
// is not cached, and an invite waits until there is signal.
import { useCallback, useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import {
  ApiError,
  contractSectionKeys,
  fitAnswerDraft,
  joinAnswers,
  messageFromError,
  opensPreview,
  tripPlanDatesLabel,
  tripPlanJoinTitle,
  tripPlanVisibilityLine,
  TRIP_PLAN_JOIN,
  TRIP_PLAN_OFFLINE,
  TRIP_PLAN_PAGE,
  TRIP_PLANS_LIST,
  type TripPlanAnswerDraft,
  type TripPlanInvitedPreview,
  type TripPlanJoinForm,
} from "@logjam/shared";

import { unavailableReasonText } from "../auth/capabilities";
import { useConnectivity } from "../map/connectivity";
import { makeStyles, muted, spacing } from "../theme";
import {
  Avatar,
  BottomSheet,
  Button,
  EmptyState,
  ErrorBanner,
  ErrorState,
  Hero,
  LoadingState,
  Notice,
  Row,
  SectionHeader,
} from "../ui";
import { PlanFormFields } from "./PlanFormFields";
import { getInvitedPreview, joinPlan, leavePlan } from "./plansApi";
import { fetchPlan, pollPlans, readPlansList } from "./plansCache";

const copy = TRIP_PLAN_JOIN.copy;
const OFFLINE = unavailableReasonText("needs-connection");

type Loaded =
  | { kind: "loading" }
  | { kind: "preview"; preview: TripPlanInvitedPreview }
  | { kind: "gone" }
  | { kind: "failed"; message: string };

export function PlanPreview({
  planId,
  name,
  onBack,
  onJoined,
  onDeclined,
}: {
  planId: string;
  /** The row's name, for the hero before the preview is read. */
  name: string;
  onBack: () => void;
  /** In the plan now: open the member's page. */
  onJoined: () => void;
  onDeclined: (message: string) => void;
}) {
  const styles = useStyles();
  const online = useConnectivity() === "online";
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [joining, setJoining] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      getInvitedPreview(planId).then(
        (preview) => setLoaded({ kind: "preview", preview }),
        async (err: unknown) => {
          if (!(err instanceof ApiError && err.status === 404)) {
            setLoaded({
              kind: "failed",
              message: messageFromError(err, TRIP_PLAN_PAGE.copy.loadFailed),
            });
            return;
          }
          // Not invited any more: joined meanwhile (from another device), or
          // the invite went. The list says which.
          const list = await pollPlans().catch(() => readPlansList());
          const listed = list?.plans.find((plan) => plan.id === planId)?.status;
          if (opensPreview(true, listed)) setLoaded({ kind: "gone" });
          else onJoined();
        },
      ),
    [planId, onJoined],
  );
  useEffect(() => {
    if (online) void load();
  }, [online, load]);

  async function join(answers: Parameters<typeof joinPlan>[1]) {
    setBusy(true);
    setError(null);
    try {
      await joinPlan(planId, answers);
      await Promise.all([pollPlans(), fetchPlan(planId)]).catch(console.error);
      setJoining(false);
      onJoined();
    } catch (err) {
      setError(messageFromError(err, copy.joinFailed));
      // A 409 is a form changed or gone: read again, the drafts refit.
      if (err instanceof ApiError && err.status === 409) void load();
    } finally {
      setBusy(false);
    }
  }

  async function decline() {
    setBusy(true);
    try {
      await leavePlan(planId);
      await pollPlans().catch(console.error);
      onDeclined(TRIP_PLANS_LIST.copy.declined);
    } catch (err) {
      setError(messageFromError(err, TRIP_PLANS_LIST.copy.declineFailed));
    } finally {
      setBusy(false);
    }
  }

  const preview = loaded.kind === "preview" ? loaded.preview : null;
  return (
    <View style={styles.screen}>
      <Hero title={preview?.name ?? name} onBack={onBack} />
      {!online && !preview ? (
        <EmptyState icon="offline" title={OFFLINE} />
      ) : loaded.kind === "loading" ? (
        <LoadingState label={TRIP_PLAN_PAGE.copy.loading} />
      ) : loaded.kind === "gone" ? (
        <EmptyState icon="plan" title={TRIP_PLAN_OFFLINE.gone} />
      ) : loaded.kind === "failed" ? (
        <ErrorState message={loaded.message} onRetry={() => void load()} />
      ) : preview ? (
        <ScrollView contentContainerStyle={styles.body}>
          <Text style={styles.muted}>
            {[
              tripPlanDatesLabel(preview.startDate, preview.endDate),
              preview.invitedBy &&
                `${copy.invitedBy} ${preview.invitedBy.username}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </Text>
          <Notice
            icon="plan"
            controls={
              <View style={styles.controls}>
                <Button
                  label={copy.join}
                  compact
                  disabled={!online}
                  disabledReason={OFFLINE}
                  onPress={() =>
                    preview.requiredForms.length > 0
                      ? setJoining(true)
                      : void join({})
                  }
                />
                <Button
                  label={copy.decline}
                  compact
                  variant="outlineAccent"
                  loading={busy && !joining}
                  disabled={!online}
                  disabledReason={OFFLINE}
                  onPress={() => void decline()}
                />
              </View>
            }
          >
            {preview.requiredForms.length > 0
              ? copy.answerToJoin
              : TRIP_PLANS_LIST.copy.pillInvited}
          </Notice>
          {online ? null : <Text style={styles.offline}>{OFFLINE}</Text>}
          {!joining && error ? <ErrorBanner message={error} /> : null}
          {preview.sections.map((section) => (
            <View key={section.id} style={styles.section}>
              <SectionHeader title={section.title} />
              {section.body ? (
                <Text style={styles.sectionBody} selectable>
                  {section.body}
                </Text>
              ) : null}
            </View>
          ))}
          {/* What the notice's "Answer these" means, before Join asks. */}
          {preview.requiredForms.length > 0 ? (
            <SectionHeader title={TRIP_PLAN_PAGE.copy.viewForms} />
          ) : null}
          {preview.requiredForms.map((form) => (
            <Row
              key={form.id}
              icon="form"
              title={form.title}
              subtitle={tripPlanVisibilityLine(form.visibleTo, form.preset)}
            />
          ))}
          <SectionHeader
            title={TRIP_PLAN_PAGE.copy.peopleGoing}
            count={preview.members.length}
          />
          {preview.members.map((member) => (
            <Row
              key={member.id}
              title={member.username}
              leading={<Avatar username={member.username} />}
            />
          ))}
          <JoinSheet
            visible={joining}
            preview={preview}
            online={online}
            busy={busy}
            error={error}
            onError={setError}
            onClose={() => {
              setJoining(false);
              setError(null);
            }}
            onJoin={(answers) => void join(answers)}
          />
        </ScrollView>
      ) : null}
    </View>
  );
}

/** The forms required to join, one draft each, then Join. */
function JoinSheet({
  visible,
  preview,
  online,
  busy,
  error,
  onError,
  onClose,
  onJoin,
}: {
  visible: boolean;
  preview: TripPlanInvitedPreview;
  online: boolean;
  busy: boolean;
  error: string | null;
  onError: (sentence: string) => void;
  onClose: () => void;
  onJoin: (answers: Parameters<typeof joinPlan>[1]) => void;
}) {
  const styles = useStyles();
  const [drafts, setDrafts] = useState<Record<string, TripPlanAnswerDraft>>({});
  // A form that changed under the joiner (a 409, then the preview read
  // again) keeps the answers that still fit.
  const [shown, setShown] = useState<readonly TripPlanJoinForm[]>(
    preview.requiredForms,
  );
  if (shown !== preview.requiredForms) {
    setShown(preview.requiredForms);
    setDrafts((was) =>
      Object.fromEntries(
        preview.requiredForms.map((form) => {
          const before = shown.find((each) => each.id === form.id);
          const draft = was[form.id] ?? {};
          return [
            form.id,
            before
              ? fitAnswerDraft(before.questions, form.questions, draft)
              : {},
          ];
        }),
      ),
    );
  }
  const sections = {
    hero: (
      <Text style={styles.muted}>
        {[
          tripPlanDatesLabel(preview.startDate, preview.endDate),
          preview.invitedBy &&
            `${copy.invitedBy} ${preview.invitedBy.username}`,
        ]
          .filter(Boolean)
          .join(" · ")}
      </Text>
    ),
    forms: preview.requiredForms.map((form) => (
      <View key={form.id} style={styles.section}>
        <SectionHeader title={form.title} />
        <PlanFormFields
          form={form}
          draft={drafts[form.id] ?? {}}
          onChange={(next) => setDrafts((was) => ({ ...was, [form.id]: next }))}
        />
      </View>
    )),
  };
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={tripPlanJoinTitle(preview.name)}
      footer={
        <View style={styles.footer}>
          {error ? <ErrorBanner message={error} /> : null}
          <Button
            label={copy.join}
            loading={busy}
            disabled={!online}
            disabledReason={OFFLINE}
            onPress={() => {
              const answers = joinAnswers(preview.requiredForms, drafts);
              if ("sentence" in answers) onError(answers.sentence);
              else onJoin(answers.value);
            }}
          />
          {online ? null : <Text style={styles.offline}>{OFFLINE}</Text>}
        </View>
      }
    >
      <View style={styles.sheetBody}>
        {contractSectionKeys(TRIP_PLAN_JOIN, "gps").map((key) => (
          <View key={key}>{sections[key]}</View>
        ))}
      </View>
    </BottomSheet>
  );
}

const useStyles = makeStyles((theme, textRole) => ({
  screen: { flex: 1, backgroundColor: theme.page },
  body: {
    paddingHorizontal: spacing(2),
    paddingBottom: spacing(4),
    gap: spacing(1.5),
  },
  sheetBody: { gap: spacing(2) },
  muted: { ...muted(theme, textRole.detail) },
  offline: { ...muted(theme, textRole.detail), textAlign: "center" },
  controls: { flexDirection: "row", gap: spacing(1) },
  section: { gap: spacing(1) },
  sectionBody: { ...textRole.body, color: theme.text },
  footer: { gap: spacing(1) },
}));
