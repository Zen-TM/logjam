// Plans: "what trips am I getting ready for?" (`TRIP_PLANS_LIST`).
//
// Cache-first, like the inbox: the last GET /plans renders at once, and the
// screen polls on opening and on pull to refresh (`plansCache.ts`). A failed
// poll with a cached list is silent; offline is the hero's pill. Which state
// draws is `plansListView`'s.
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { FlatList, RefreshControl, Text, View } from "react-native";
import {
  PLAN_REQUEST_VERBS,
  contractSectionKeys,
  messageFromError,
  sortTripPlans,
  tripPlanBucket,
  tripPlanRowPill,
  tripPlanRowSubtitle,
  tripPlansEmpty,
  tripPlansHeroTitle,
  TRIP_PLAN_OFFLINE,
  TRIP_PLANS_LIST,
  type SectionKeysOn,
  type TripPlanBucket,
  type TripPlanSummary,
} from "@logjam/shared";

import { useAccountState } from "../auth/AccountStateContext";
import {
  capabilityScreenBlock,
  unavailableReasonText,
} from "../auth/capabilities";
import { useConnectivity } from "../map/connectivity";
import { onMirrorChanged } from "../sync/syncDb";
import { makeStyles, muted, spacing, useHues, useTheme } from "../theme";
import {
  BottomSheet,
  Button,
  ChipRail,
  EmptyState,
  ErrorState,
  Hero,
  IconButton,
  ListEnd,
  LoadingState,
  Row,
  StatusPill,
  SyncStatusPills,
  Toast,
  todayDateKey,
  type ChipOption,
  type ToastMessage,
} from "../ui";
import { PlanDetailsSheet } from "./PlanDetailsSheet";
import { createPlan, leavePlan } from "./plansApi";
import {
  planChanged,
  pollPlans,
  readCachedPlanStamps,
  readPlansList,
  type CachedPlanStamp,
} from "./plansCache";
import { plansListView } from "./planViews";

const copy = TRIP_PLANS_LIST.copy;
const OFFLINE = unavailableReasonText("needs-connection");
const WITHDRAW = PLAN_REQUEST_VERBS[0];
const BUCKETS: TripPlanBucket[] = ["upcoming", "past", "archived"];
const BUCKET_LABEL: Record<TripPlanBucket, string> = {
  upcoming: copy.bucketUpcoming,
  past: copy.bucketPast,
  archived: copy.bucketArchived,
};

/** The cached list and stamps, kept fresh by the poll and the mirror signal. */
export function usePlansList(blocked: boolean) {
  const [plans, setPlans] = useState<TripPlanSummary[] | null>(null);
  const [stamps, setStamps] = useState<Map<string, CachedPlanStamp>>(new Map());
  const [failure, setFailure] = useState<string | null>(null);
  const [settled, setSettled] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const reread = useCallback(async () => {
    const [list, nextStamps] = await Promise.all([
      readPlansList(),
      readCachedPlanStamps(),
    ]);
    setStamps(nextStamps);
    // An emptied cache (a wipe) takes the list off screen with it.
    setPlans(list ? list.plans : null);
    if (list) setFailure(null);
    return list;
  }, []);

  const poll = useCallback(async () => {
    setRefreshing(true);
    try {
      await pollPlans();
      setFailure(null);
    } catch (err) {
      setFailure(messageFromError(err, copy.loadFailed));
    } finally {
      setRefreshing(false);
      setSettled(true);
    }
  }, []);

  useEffect(() => {
    if (blocked) return;
    void (async () => {
      await reread().catch(console.error);
      await poll();
    })();
    return onMirrorChanged(() => void reread().catch(console.error));
  }, [blocked, poll, reread]);

  return { plans, stamps, failure, settled, refreshing, poll };
}

export function PlansScreen({
  message,
  onBack,
  onOpenPlan,
}: {
  /** What just happened elsewhere (a plan left or deleted), as a toast;
   *  `at` tells one from the next with the same words. */
  message?: { text: string; at: number };
  onBack: () => void;
  onOpenPlan: (plan: Pick<TripPlanSummary, "id" | "name" | "status">) => void;
}) {
  const theme = useTheme();
  const styles = useStyles();
  const { assetHue } = useHues();
  const { accountState } = useAccountState();
  const block = capabilityScreenBlock("plans", accountState);
  const online = useConnectivity() === "online";
  const { plans, stamps, failure, settled, refreshing, poll } = usePlansList(
    block !== null,
  );
  const shown = plansListView({ plans, failure, settled, online });
  const [bucket, setBucket] = useState<TripPlanBucket>("upcoming");
  const [newOpen, setNewOpen] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [toastAt, setToastAt] = useState<number | undefined>(undefined);
  if (message && message.at !== toastAt) {
    setToastAt(message.at);
    setToast({ text: message.text, tone: "info", nonce: message.at });
  }
  const today = todayDateKey();

  const byBucket = useMemo(() => {
    const groups: Record<TripPlanBucket, TripPlanSummary[]> = {
      upcoming: [],
      past: [],
      archived: [],
    };
    for (const plan of plans ?? [])
      groups[tripPlanBucket(plan, today)].push(plan);
    return groups;
  }, [plans, today]);
  const rows = useMemo(
    () => sortTripPlans(byBucket[bucket], bucket),
    [bucket, byBucket],
  );
  const options: ChipOption<TripPlanBucket>[] = BUCKETS.map((value) => ({
    value,
    label: BUCKET_LABEL[value],
    count: byBucket[value].length,
  }));

  // Decline and Withdraw request: one call, by status (`leavePlan`); no
  // confirm, as on Logjam Web.
  const [menuFor, setMenuFor] = useState<TripPlanSummary | null>(null);
  // Each plan's own: a second decline doesn't free the first's button.
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  const leave = useCallback(
    (plan: TripPlanSummary, done: string, failed: string) => {
      setLeaving((was) => new Set(was).add(plan.id));
      void leavePlan(plan.id)
        .then(async () => {
          await poll();
          setToast({ text: done, tone: "info", nonce: Date.now() });
        })
        .catch((err: unknown) =>
          setToast({
            text: messageFromError(err, failed),
            tone: "error",
            nonce: Date.now(),
          }),
        )
        .finally(() =>
          setLeaving((was) => {
            const next = new Set(was);
            next.delete(plan.id);
            return next;
          }),
        );
    },
    [poll, setToast],
  );

  const renderItem = useCallback(
    ({ item }: { item: TripPlanSummary }) => {
      const stamp = stamps.get(item.id);
      const pill = tripPlanRowPill(item);
      return (
        <Row
          icon="plan"
          hue={assetHue.plan}
          title={item.name}
          titleNumberOfLines={2}
          subtitle={tripPlanRowSubtitle(item)}
          // The body opens; a request's only action is its ⋯ (shared/DESIGN.md §9).
          onPress={
            item.status !== "requested" ? () => onOpenPlan(item) : undefined
          }
          right={
            <View style={styles.pills}>
              {planChanged(item, stamp) ? (
                <StatusPill label={TRIP_PLAN_OFFLINE.changed} tone="warning" />
              ) : stamp?.downloadedAt ? (
                <StatusPill
                  label={TRIP_PLAN_OFFLINE.downloaded}
                  tone="muted"
                  icon="saveOffline"
                />
              ) : null}
              {pill ? <StatusPill label={pill} tone="outline" /> : null}
              {item.status === "requested" ? (
                <IconButton
                  icon="overflow"
                  accessibilityLabel={`Actions for ${item.name}`}
                  color={theme.textMuted}
                  onPress={() => setMenuFor(item)}
                />
              ) : null}
            </View>
          }
          // An invite answers in its footer: Open (the preview) · Decline.
          footer={
            item.status === "invited" ? (
              // Its own taps: a dimmed Decline doesn't fall through to the
              // row's Open.
              <View
                style={styles.footer}
                onStartShouldSetResponder={() => true}
              >
                <View style={styles.pills}>
                  <Button
                    label={copy.open}
                    compact
                    onPress={() => onOpenPlan(item)}
                  />
                  <Button
                    label={copy.decline}
                    compact
                    variant="outlineAccent"
                    loading={leaving.has(item.id)}
                    disabled={!online}
                    disabledReason={OFFLINE}
                    onPress={() =>
                      leave(item, copy.declined, copy.declineFailed)
                    }
                  />
                </View>
                {online ? null : <Text style={styles.hint}>{OFFLINE}</Text>}
              </View>
            ) : undefined
          }
        />
      );
    },
    [
      assetHue.plan,
      leave,
      leaving,
      onOpenPlan,
      online,
      setMenuFor,
      stamps,
      styles,
      theme.textMuted,
    ],
  );

  if (block) {
    return (
      <View style={styles.screen}>
        <Hero
          eyebrow={TRIP_PLANS_LIST.title}
          title={block.title}
          onBack={onBack}
        />
        <EmptyState title={block.title} hint={block.hint} icon="plan" />
      </View>
    );
  }

  const newPlan = {
    label: copy.add,
    icon: "add" as const,
    onPress: () => setNewOpen(true),
    disabledReason: online
      ? undefined
      : unavailableReasonText("needs-connection"),
  };
  const empty = tripPlansEmpty(plans?.length ?? 0, bucket);
  const sections: Record<
    SectionKeysOn<typeof TRIP_PLANS_LIST, "gps">,
    ReactNode
  > = {
    hero: (
      <Hero
        eyebrow={TRIP_PLANS_LIST.title}
        title={
          shown.kind === "list"
            ? tripPlansHeroTitle(shown.plans, today)
            : shown.kind === "loading"
              ? copy.loading
              : TRIP_PLANS_LIST.title
        }
        titleNumberOfLines={2}
        onBack={onBack}
      >
        <View style={styles.pills}>
          <Button
            label={copy.add}
            icon="add"
            compact
            variant="outlineAccent"
            disabled={!online}
            disabledReason={unavailableReasonText("needs-connection")}
            onPress={() => setNewOpen(true)}
          />
          <SyncStatusPills online={online} pendingCount={0} />
        </View>
      </Hero>
    ),
    buckets: (
      <View style={styles.rail}>
        <ChipRail
          scroll
          options={options}
          value={bucket}
          onChange={setBucket}
        />
      </View>
    ),
    list:
      shown.kind === "loading" ? (
        <LoadingState label={copy.loading} />
      ) : shown.kind === "neverFetched" ? (
        <EmptyState icon="offline" title={TRIP_PLAN_OFFLINE.noPlansOffline} />
      ) : shown.kind === "failed" ? (
        <ErrorState message={shown.message} onRetry={() => void poll()} />
      ) : (
        <FlatList
          style={styles.list}
          contentContainerStyle={styles.listContent}
          data={rows}
          keyExtractor={planKey}
          renderItem={renderItem}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void poll()}
              tintColor={theme.accent}
            />
          }
          ListEmptyComponent={
            <EmptyState
              icon={empty.icon}
              title={empty.title}
              hint={empty.body}
              // The way in, where a new plan would land.
              action={bucket === "upcoming" ? newPlan : undefined}
            />
          }
          // The list ends with the button its empty state offers.
          ListFooterComponent={
            bucket === "upcoming" && rows.length > 0 ? (
              <ListEnd>
                <Button
                  {...newPlan}
                  variant="outlineAccent"
                  disabled={!online}
                />
                {/* Away from the hero's Offline pill, so the words go under
                    it (ui/Button.tsx). */}
                {newPlan.disabledReason ? (
                  <Text style={styles.offline}>{newPlan.disabledReason}</Text>
                ) : null}
              </ListEnd>
            ) : undefined
          }
        />
      ),
  };

  return (
    <View style={styles.screen}>
      {contractSectionKeys(TRIP_PLANS_LIST, "gps").map((key) => (
        <Fragment key={key}>{sections[key]}</Fragment>
      ))}
      <PlanDetailsSheet
        visible={newOpen}
        onClose={() => setNewOpen(false)}
        onSubmit={async (values) => {
          const made = await createPlan(values);
          setNewOpen(false);
          void poll();
          onOpenPlan({ id: made.id, name: made.name, status: "active" });
        }}
      />
      <BottomSheet
        visible={menuFor !== null}
        onClose={() => setMenuFor(null)}
        title={menuFor?.name ?? ""}
      >
        {menuFor ? (
          <Row
            icon={WITHDRAW.icon}
            title={WITHDRAW.label}
            subtitle={online ? undefined : OFFLINE}
            disabled={!online}
            onPress={() => {
              const plan = menuFor;
              setMenuFor(null);
              leave(plan, copy.withdrawn, copy.withdrawFailed);
            }}
          />
        ) : null}
      </BottomSheet>
      <Toast message={toast} onDismissed={() => setToast(null)} />
    </View>
  );
}

const planKey = (plan: TripPlanSummary) => plan.id;

const useStyles = makeStyles((theme, textRole) => ({
  screen: { flex: 1, backgroundColor: theme.page },
  offline: { ...muted(theme, textRole.detail), textAlign: "center" },
  rail: { paddingHorizontal: spacing(2), paddingVertical: spacing(1) },
  list: { flex: 1 },
  listContent: {
    paddingHorizontal: spacing(2),
    gap: spacing(1),
    paddingBottom: spacing(4),
  },
  footer: { gap: spacing(0.5) },
  hint: { ...muted(theme, textRole.detail) },
  pills: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing(1),
  },
}));
