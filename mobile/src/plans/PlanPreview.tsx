// A plan someone is invited to by username, before they join
// (`TRIP_PLAN_PREVIEW`, GET /plans/:id/preview): the write-up and who is
// going, with Join and Decline. Joining answers nothing: forms are answered
// from the plan afterwards. Logjam Web's twin is PlanInvitedPage. A preview is not cached: it needs a connection, unless the
// reader has joined since, when the plan opens instead (`opensAsPreview`).
import { useEffect, useEffectEvent, useState, type ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import {
  ApiError,
  contractSectionKeys,
  messageFromError,
  tripPlanInvitedLine,
  tripPlanPreviewHeaded,
  TRIP_PLAN_JOIN,
  TRIP_PLAN_OFFLINE,
  TRIP_PLAN_PREVIEW,
  type SectionKeysOn,
  type TripPlanInvitedPreview,
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
  Button,
  EmptyState,
  ErrorBanner,
  ErrorState,
  Hero,
  LoadingState,
  Row,
  SectionHeader,
} from "../ui";
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

  async function join() {
    setBusy("join");
    setError(null);
    try {
      await joinPlan(planId);
      await Promise.all([pollPlans(), fetchPlan(planId)]).catch(console.error);
      onJoined();
    } catch (err) {
      setError(messageFromError(err, TRIP_PLAN_JOIN.copy.joinFailed));
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
              title={copy.invited}
              titleNumberOfLines={3}
              footer={
                <View style={styles.controls}>
                  <Button
                    label={copy.join}
                    compact
                    loading={busy === "join"}
                    disabled={!online}
                    disabledReason={OFFLINE}
                    onPress={() => void join()}
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
            {error ? <ErrorBanner message={error} /> : null}
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
        </ScrollView>
      ) : null}
    </View>
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
  muted: { ...muted(theme, textRole.detail) },
  offline: { ...muted(theme, textRole.detail), textAlign: "center" },
  controls: { flexDirection: "row", gap: spacing(1) },
  section: { gap: spacing(1) },
  sectionBody: { ...textRole.body, color: theme.text },
}));
