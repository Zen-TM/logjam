// A plan someone is invited to by username, before they join
// (`TRIP_PLAN_PREVIEW`, GET /plans/:id/preview): the write-up, the forms
// required to join and who is going, with Join and Decline. Join answers
// those forms in a sheet (`TRIP_PLAN_JOIN`), with the controls the Forms tab
// answers with (`PlanFormFields`). Logjam Web's twin is PlanInvitedPage with
// PlanJoinDialog. A preview is not cached: it needs a connection, unless the
// reader has joined since, when the plan opens instead (`opensAsPreview`).
import { useEffect, useEffectEvent, useState, type ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import {
  ApiError,
  contractSectionKeys,
  fitAnswerDraft,
  joinAnswers,
  messageFromError,
  tripPlanInvitedLine,
  tripPlanJoinTitle,
  tripPlanPreviewHeaded,
  tripPlanVisibilityLine,
  TRIP_PLAN_JOIN,
  TRIP_PLAN_OFFLINE,
  TRIP_PLAN_PREVIEW,
  type SectionKeysOn,
  type TripPlanAnswerDraft,
  type TripPlanInvitedPreview,
  type TripPlanJoinAnswers,
  type TripPlanJoinForm,
} from "@logjam/shared";

import { useAccountState } from "../auth/AccountStateContext";
import {
  capabilityScreenBlock,
  unavailableReasonText,
} from "../auth/capabilities";
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
  Row,
  SectionHeader,
} from "../ui";
import { PlanFormFields } from "./PlanFormFields";
import { getInvitedPreview, joinPlan, leavePlan } from "./plansApi";
import { fetchPlan, opensAsPreview, pollPlans } from "./plansCache";

const copy = TRIP_PLAN_PREVIEW.copy;
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
  // An invite push tapped after sign-out can open this for a guest: no read,
  // no fetch, as on Plans.
  const { accountState } = useAccountState();
  const block = capabilityScreenBlock("plans", accountState);
  // The list first: joined since (on Logjam Web, or here), it opens the plan.
  const [checked, setChecked] = useState(false);
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [reads, setReads] = useState(0);
  const [joining, setJoining] = useState(false);
  const [busy, setBusy] = useState<"join" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The caller's arrow, recreated on each of its renders: not a reason to
  // read the preview again.
  const joined = useEffectEvent(() => onJoined());

  useEffect(() => {
    if (block) return;
    let alive = true;
    opensAsPreview(planId, online)
      .then((stillInvited) => {
        if (!alive) return;
        if (stillInvited) setChecked(true);
        else joined();
      })
      .catch((err: unknown) => {
        console.error(err);
        if (alive) setChecked(true);
      });
    return () => {
      alive = false;
    };
  }, [planId, block, online]);

  useEffect(() => {
    if (block || !checked || !online) return;
    let alive = true;
    getInvitedPreview(planId).then(
      (preview) => {
        if (alive) setLoaded({ kind: "preview", preview });
      },
      async (err: unknown) => {
        if (!alive) return;
        if (!(err instanceof ApiError && err.status === 404)) {
          setLoaded({
            kind: "failed",
            message: messageFromError(err, copy.loadFailed),
          });
          return;
        }
        // Not invited any more: joined meanwhile, or the invite went. The
        // list, just polled, says which.
        await pollPlans().catch(console.error);
        const stillInvited = await opensAsPreview(planId, false).catch(
          (failed: unknown) => {
            console.error(failed);
            return true;
          },
        );
        if (!alive) return;
        if (stillInvited) setLoaded({ kind: "gone" });
        else joined();
      },
    );
    return () => {
      alive = false;
    };
  }, [planId, block, checked, online, reads]);

  async function join(answers: TripPlanJoinAnswers) {
    setBusy("join");
    setError(null);
    try {
      await joinPlan(planId, answers);
      await Promise.all([pollPlans(), fetchPlan(planId)]).catch(console.error);
      setJoining(false);
      onJoined();
    } catch (err) {
      setError(messageFromError(err, TRIP_PLAN_JOIN.copy.joinFailed));
      // A 409 is a form changed or gone: read again, the drafts refit.
      if (err instanceof ApiError && err.status === 409) setReads((n) => n + 1);
    } finally {
      setBusy(null);
    }
  }

  async function decline() {
    setBusy("decline");
    try {
      await leavePlan(planId);
      await pollPlans().catch(console.error);
      onDeclined(copy.declined);
    } catch (err) {
      setError(messageFromError(err, copy.declineFailed));
    } finally {
      setBusy(null);
    }
  }

  if (block)
    return (
      <View style={styles.screen}>
        <Hero title={block.title} onBack={onBack} />
        <EmptyState title={block.title} hint={block.hint} icon="plan" />
      </View>
    );

  const preview = loaded.kind === "preview" ? loaded.preview : null;
  const headed = preview ? tripPlanPreviewHeaded(preview) : false;
  const sections: Record<
    SectionKeysOn<typeof TRIP_PLAN_PREVIEW, "gps">,
    ReactNode
  > | null = preview
    ? {
        // The name is the screen's hero; its line is here.
        hero: <Text style={styles.muted}>{tripPlanInvitedLine(preview)}</Text>,
        notice: (
          <>
            <Row
              icon="plan"
              title={
                preview.requiredForms.length > 0
                  ? copy.answerToJoin
                  : copy.invited
              }
              titleNumberOfLines={3}
              footer={
                <View style={styles.controls}>
                  <Button
                    label={copy.join}
                    compact
                    loading={busy === "join"}
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
                    loading={busy === "decline"}
                    disabled={!online}
                    disabledReason={OFFLINE}
                    onPress={() => void decline()}
                  />
                </View>
              }
            />
            {online ? null : <Text style={styles.offline}>{OFFLINE}</Text>}
            {!joining && error ? <ErrorBanner message={error} /> : null}
          </>
        ),
        writeUp: preview.sections.map((section) => (
          <View key={section.id} style={styles.section}>
            <SectionHeader title={section.title} />
            {section.body ? (
              <Text style={styles.sectionBody} selectable>
                {section.body}
              </Text>
            ) : null}
          </View>
        )),
        // What the notice's "Answer these" means, before Join asks.
        forms: (
          <>
            {preview.requiredForms.length > 0 && headed ? (
              <SectionHeader title={copy.forms} />
            ) : null}
            {preview.requiredForms.map((form) => (
              <Row
                key={form.id}
                icon="form"
                title={form.title}
                subtitle={tripPlanVisibilityLine(form.visibleTo, form.preset)}
              />
            ))}
          </>
        ),
        people: (
          <>
            {headed ? (
              <SectionHeader
                title={copy.people}
                count={preview.members.length}
              />
            ) : null}
            {preview.members.map((member) => (
              <Row
                key={member.id}
                title={member.username}
                leading={<Avatar username={member.username} />}
              />
            ))}
          </>
        ),
      }
    : null;

  return (
    <View style={styles.screen}>
      <Hero title={preview?.name ?? name} onBack={onBack} />
      {!checked ? (
        <LoadingState label={copy.loading} />
      ) : !online && !preview ? (
        <EmptyState icon="offline" title={OFFLINE} />
      ) : loaded.kind === "loading" ? (
        <LoadingState label={copy.loading} />
      ) : loaded.kind === "gone" ? (
        <EmptyState icon="plan" title={TRIP_PLAN_OFFLINE.gone} />
      ) : loaded.kind === "failed" ? (
        <ErrorState
          message={loaded.message}
          onRetry={() => setReads((n) => n + 1)}
        />
      ) : preview && sections ? (
        <ScrollView contentContainerStyle={styles.body}>
          {contractSectionKeys(TRIP_PLAN_PREVIEW, "gps").map((key) => (
            <View key={key} style={styles.block}>
              {sections[key]}
            </View>
          ))}
          <JoinSheet
            visible={joining}
            preview={preview}
            online={online}
            busy={busy === "join"}
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
  /** Null clears it: an edit does (shared/DESIGN.md §11). */
  onError: (sentence: string | null) => void;
  onClose: () => void;
  onJoin: (answers: TripPlanJoinAnswers) => void;
}) {
  const styles = useStyles();
  const [drafts, setDrafts] = useState<Record<string, TripPlanAnswerDraft>>({});
  // A form that changed under the joiner (a 409, then the preview read
  // again) keeps the answers that still fit. Keyed on each form's
  // `updatedAt`, not the array: a read of the same forms changes nothing.
  const formsKey = preview.requiredForms
    .map((form) => `${form.id}@${form.updatedAt}`)
    .join(",");
  const [shown, setShown] = useState<{
    key: string;
    forms: readonly TripPlanJoinForm[];
  }>({ key: formsKey, forms: preview.requiredForms });
  if (shown.key !== formsKey) {
    setShown({ key: formsKey, forms: preview.requiredForms });
    setDrafts((was) =>
      Object.fromEntries(
        preview.requiredForms.map((form) => {
          const before = shown.forms.find((each) => each.id === form.id);
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
  const sections: Record<
    SectionKeysOn<typeof TRIP_PLAN_JOIN, "gps">,
    ReactNode
  > = {
    hero: <Text style={styles.muted}>{tripPlanInvitedLine(preview)}</Text>,
    forms: preview.requiredForms.map((form) => (
      <View key={form.id} style={styles.section}>
        <SectionHeader title={form.title} />
        <PlanFormFields
          form={form}
          draft={drafts[form.id] ?? {}}
          onChange={(next) => {
            setDrafts((was) => ({ ...was, [form.id]: next }));
            onError(null);
          }}
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
            label={TRIP_PLAN_JOIN.copy.join}
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
  block: { gap: spacing(1) },
  sheetBody: { gap: spacing(2) },
  muted: { ...muted(theme, textRole.detail) },
  offline: { ...muted(theme, textRole.detail), textAlign: "center" },
  controls: { flexDirection: "row", gap: spacing(1) },
  section: { gap: spacing(1) },
  sectionBody: { ...textRole.body, color: theme.text },
  footer: { gap: spacing(1) },
}));
