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
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Alert, FlatList, RefreshControl, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import {
  PLAN_REQUEST_VERBS,
  PLAN_VERBS,
  planDeleteConfirm,
  planLeaveConfirm,
  planVerbsFor,
  tripPlanCounts,
  TRIP_PLAN_JOIN,
  TRIP_PLAN_PAGE,
  contractSectionKeys,
  messageFromError,
  sortTripPlans,
  tripPlanBucket,
  listSelectionLabel,
  tripPlanBulkConfirm,
  TRIP_PLAN_BULK_DELETE_ADDED_LABEL,
  tripPlanCardActionsLabel,
  tripPlanFormsUrgent,
  tripPlanBulkOffers,
  tripPlanFormsToAnswerLine,
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
  SelectionBar,
  SelectionMark,
  StatusPill,
  SyncStatusPills,
  Toast,
  todayDateKey,
  useBulkSelection,
  type ChipOption,
  type ToastMessage,
} from "../ui";
import { PlanDetailsSheet } from "./PlanDetailsSheet";
import { planSelectable, runPlanBulk } from "./planBulk";
import { startPlanDownload } from "./planDownloads";
import { LeaveSheet, type LeaveWords } from "./LeaveSheet";
import { archivePlan, createPlan, deletePlan, leavePlan } from "./plansApi";
import {
  afterPlanWrite,
  planChanged,
  pollPlans,
  readCachedPlan,
  readCachedPlanStamps,
  readPlansList,
  type CachedPlanStamp,
} from "./plansCache";
import { plansListView } from "./planViews";

const copy = TRIP_PLANS_LIST.copy;
const OFFLINE = unavailableReasonText("needs-connection");
const WITHDRAW = PLAN_REQUEST_VERBS[0];
const pageCopy = TRIP_PLAN_PAGE.copy;
const planKey = (plan: TripPlanSummary) => plan.id;

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
  const [actionsOpen, setActionsOpen] = useState(false);
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

  // Press and hold a card to select; the bar takes the bucket rail's slot.
  const {
    selectedKeys,
    clearSelection,
    selectItem,
    selectAll,
    selectOnly,
    selectedItems,
    selectableItems,
    selecting,
  } = useBulkSelection({
    items: rows,
    keyOf: planKey,
    isDeletable: planSelectable,
  });
  useFocusEffect(
    useCallback(() => {
      clearSelection();
    }, [clearSelection]),
  );
  const changeBucket = useCallback(
    (next: TripPlanBucket) => {
      clearSelection();
      setBucket(next);
    },
    [clearSelection],
  );

  // Decline and Withdraw request: one call, by status (`leavePlan`). Decline
  // is asked once (it cannot be undone); Withdraw is not.
  const [menuFor, setMenuFor] = useState<TripPlanSummary | null>(null);
  // The one Leave confirm (`LeaveSheet`), for a card and for bulk; opened from
  // the menu's `onClosed`, since a sheet can't open while another closes.
  const [leaveAsk, setLeaveAsk] = useState<{
    words: (deleteAdded: boolean) => LeaveWords;
    run: (deleteAdded: boolean) => void;
  } | null>(null);
  const parkedAsk = useRef<(() => void) | null>(null);
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

  const report = useCallback(
    (text: string, tone: "info" | "error") =>
      setToast({ text, tone, nonce: Date.now() }),
    [setToast],
  );
  // A plan that is gone for the caller drops from the cache (`gone`).
  const write = (
    plan: TripPlanSummary,
    call: Promise<unknown>,
    gone: boolean,
    done: string,
    failed: string,
  ) =>
    call
      .then(() => afterPlanWrite(plan.id, gone))
      .then(() => report(done, "info"))
      .catch((err: unknown) => report(messageFromError(err, failed), "error"));
  const confirm = (
    words: { confirmTitle: string; confirmBody: string; confirmLabel: string },
    destructive: boolean,
    action: () => void,
  ) =>
    Alert.alert(words.confirmTitle, words.confirmBody, [
      { text: "Cancel", style: "cancel" },
      {
        text: words.confirmLabel,
        style: destructive ? "destructive" : "default",
        onPress: action,
      },
    ]);
  // A card's ⋯: the verbs its own page offers that make sense without it open.
  const cardAction = async (
    plan: TripPlanSummary,
    id: "archive" | "unarchive" | "leave" | "delete",
  ) => {
    if (id === "archive" || id === "unarchive")
      return void write(
        plan,
        archivePlan(plan.id, id === "archive"),
        false,
        id === "archive" ? pageCopy.archived : pageCopy.unarchived,
        pageCopy.archiveFailed,
      );
    if (id === "leave")
      return void (parkedAsk.current = () =>
        setLeaveAsk({
          words: () => planLeaveConfirm(plan.name),
          run: (deleteAdded) =>
            void write(
              plan,
              leavePlan(plan.id, deleteAdded),
              true,
              pageCopy.left,
              pageCopy.leaveFailed,
            ),
        }));
    const cached = await readCachedPlan(plan.id).catch(() => null);
    const counts = cached
      ? tripPlanCounts(cached.plan)
      : { places: 0, ways: 0 };
    confirm(
      planDeleteConfirm(plan.name, counts),
      true,
      () =>
        void write(
          plan,
          deletePlan(plan.id),
          true,
          pageCopy.deleted,
          pageCopy.deleteFailed,
        ),
    );
  };

  const selectedPlans = selectedItems;
  const bulk = tripPlanBulkOffers(selectedPlans);
  const archivedBucket = bucket === "archived";
  // The plans that did not go through stay selected, to try again.
  const finishBulk = async (steps: Parameters<typeof runPlanBulk>[0]) => {
    const { message, failedIds } = await runPlanBulk(steps);
    if (failedIds.length > 0) {
      selectOnly(failedIds);
      await poll();
    } else clearSelection();
    report(message, failedIds.length > 0 ? "error" : "info");
  };
  const runBulk = () => {
    if (!online) return report(OFFLINE, "error");
    const { lead, leave: leaving } = bulk;
    const steps = (deleteAdded: boolean) => [
      ...lead.map((plan) => ({
        id: plan.id,
        kind: "delete" as const,
        run: () =>
          deletePlan(plan.id).then(() => afterPlanWrite(plan.id, true)),
      })),
      ...leaving.map((plan) => ({
        id: plan.id,
        kind: "leave" as const,
        run: () =>
          leavePlan(plan.id, deleteAdded).then(() =>
            afterPlanWrite(plan.id, true),
          ),
      })),
    ];
    const counts = { lead: lead.length, leave: leaving.length };
    // Only a leave has something of yours to delete.
    if (leaving.length > 0)
      return setLeaveAsk({
        words: (deleteAdded) => tripPlanBulkConfirm(counts, deleteAdded),
        run: (deleteAdded) => void finishBulk(steps(deleteAdded)),
      });
    const words = tripPlanBulkConfirm(counts);
    confirm(words, words.destructive, () => void finishBulk(steps(false)));
  };
  const runBulkArchive = () => {
    if (!online) return report(OFFLINE, "error");
    const archived = !archivedBucket;
    void finishBulk(
      bulk.lead.map((plan) => ({
        id: plan.id,
        kind: archived ? ("archive" as const) : ("unarchive" as const),
        run: () =>
          archivePlan(plan.id, archived).then(() => afterPlanWrite(plan.id)),
      })),
    );
  };

  const renderItem = useCallback(
    ({ item }: { item: TripPlanSummary }) => {
      const stamp = stamps.get(item.id);
      const pill = tripPlanRowPill(item);
      const picked = selectedKeys.includes(item.id);
      return (
        <Row
          icon="plan"
          hue={assetHue.plan}
          title={item.name}
          titleNumberOfLines={2}
          subtitle={tripPlanRowSubtitle(item)}
          // What the card shows, not only its name.
          accessibilityLabel={[
            item.name,
            tripPlanRowSubtitle(item),
            pill,
            item.unansweredForms > 0
              ? tripPlanFormsToAnswerLine(item.unansweredForms)
              : undefined,
            planChanged(item, stamp) ? TRIP_PLAN_OFFLINE.changed : undefined,
          ]
            .filter(Boolean)
            .join(", ")}
          // The body opens; a request's only action is its ⋯ (shared/DESIGN.md §9).
          onPress={
            selecting
              ? () => selectItem(item)
              : item.status !== "requested"
                ? () => onOpenPlan(item)
                : undefined
          }
          onLongPress={() => selectItem(item)}
          selected={picked}
          // An invite or a request can't be picked: it dims while picking.
          disabled={selecting && !planSelectable(item)}
          right={
            <View style={styles.trailing}>
              {pill ? <StatusPill label={pill} tone="outline" /> : null}
              {selecting && planSelectable(item) ? (
                // The ⋯'s box, so the card keeps its size when selecting starts.
                <SelectionMark selected={picked} />
              ) : item.status !== "invited" ? (
                <IconButton
                  icon="overflow"
                  accessibilityLabel={tripPlanCardActionsLabel(item.name)}
                  color={theme.textMuted}
                  onPress={() => setMenuFor(item)}
                />
              ) : null}
            </View>
          }
          // An invite answers in its footer: Open (the preview) · Decline. The
          // downloaded and changed marks sit under the line, so a long one
          // can't squeeze the name and dates.
          footer={
            item.status === "active" &&
            (planChanged(item, stamp) ||
              stamp?.downloadedAt ||
              item.unansweredForms > 0) ? (
              <View style={styles.pills}>
                {item.unansweredForms > 0 ? (
                  <StatusPill
                    label={tripPlanFormsToAnswerLine(item.unansweredForms)}
                    tone={
                      tripPlanFormsUrgent(item.unansweredForms, item, today)
                        ? "warning"
                        : "outline"
                    }
                  />
                ) : null}
                {planChanged(item, stamp) ? (
                  <StatusPill
                    label={TRIP_PLAN_OFFLINE.changed}
                    tone="warning"
                  />
                ) : stamp?.downloadedAt ? (
                  <StatusPill
                    label={TRIP_PLAN_OFFLINE.downloaded}
                    tone="muted"
                    icon="saveOffline"
                  />
                ) : null}
              </View>
            ) : item.status === "invited" ? (
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
                      Alert.alert(
                        TRIP_PLAN_JOIN.copy.declineTitle,
                        TRIP_PLAN_JOIN.copy.declineBody,
                        [
                          { text: "Cancel", style: "cancel" },
                          {
                            text: copy.decline,
                            style: "destructive",
                            onPress: () =>
                              leave(item, copy.declined, copy.declineFailed),
                          },
                        ],
                      )
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
      selectItem,
      selectedKeys,
      selecting,
      setMenuFor,
      stamps,
      styles,
      theme.textMuted,
      today,
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
        actions={
          <IconButton
            icon="overflow"
            accessibilityLabel={copy.plansActions}
            onPress={() => setActionsOpen(true)}
          />
        }
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
        {selecting ? (
          <SelectionBar
            countLabel={listSelectionLabel(selectedPlans.length)}
            showSelectAll={selectedPlans.length < selectableItems.length}
            extra={
              bulk.archive ? (
                <IconButton
                  icon="archive"
                  accessibilityLabel={
                    archivedBucket
                      ? copy.unarchiveSelected
                      : copy.archiveSelected
                  }
                  color={theme.accent}
                  disabled={!online}
                  onPress={runBulkArchive}
                />
              ) : null
            }
            onClear={clearSelection}
            onSelectAll={selectAll}
            onDelete={runBulk}
            deleteIcon={bulk.destructive ? "delete" : "leave"}
            destructive={bulk.destructive}
            deleteDisabled={!online}
            deleteLabel={
              online ? bulk.deleteLabel : `${bulk.deleteLabel}. ${OFFLINE}`
            }
          />
        ) : (
          <ChipRail
            scroll
            options={options}
            value={bucket}
            onChange={changeBucket}
          />
        )}
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
        visible={actionsOpen}
        onClose={() => setActionsOpen(false)}
        title={copy.plansActions}
      >
        <Row
          icon="multiSelect"
          title={copy.selectAllPlans}
          disabled={selectableItems.length === 0}
          onPress={() => {
            setActionsOpen(false);
            selectAll();
          }}
        />
      </BottomSheet>
      <BottomSheet
        visible={menuFor !== null}
        onClose={() => setMenuFor(null)}
        title={menuFor?.name ?? ""}
        onClosed={() => {
          const open = parkedAsk.current;
          parkedAsk.current = null;
          open?.();
        }}
      >
        {menuFor?.status === "requested" ? (
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
        ) : menuFor ? (
          <View style={styles.menu}>
            <Row
              icon="plan"
              title={copy.open}
              onPress={() => {
                const plan = menuFor;
                setMenuFor(null);
                onOpenPlan(plan);
              }}
            />
            <Row
              icon="saveOffline"
              title={TRIP_PLAN_OFFLINE.download}
              subtitle={online ? undefined : OFFLINE}
              disabled={!online}
              onPress={() => {
                const plan = menuFor;
                setMenuFor(null);
                void startPlanDownload(plan.id);
              }}
            />
            {planVerbsFor(PLAN_VERBS, "gps", menuFor.role, {
              archived: menuFor.archivedAt != null,
            })
              .filter(
                (verb) =>
                  (verb.id === "archive" ||
                    verb.id === "unarchive" ||
                    verb.id === "delete" ||
                    verb.id === "leave") &&
                  // A leader's Leave depends on who else leads: it is on the
                  // plan's own page, which knows.
                  !(verb.id === "leave" && menuFor.role === "leader") &&
                  verb.id !==
                    (menuFor.archivedAt != null ? "archive" : "unarchive"),
              )
              .map((verb) => (
                <Row
                  key={verb.id}
                  icon={verb.icon}
                  hue={verb.danger ? theme.warning : undefined}
                  title={verb.label}
                  subtitle={online ? undefined : OFFLINE}
                  disabled={!online}
                  onPress={() => {
                    const plan = menuFor;
                    setMenuFor(null);
                    void cardAction(
                      plan,
                      verb.id as "archive" | "unarchive" | "leave" | "delete",
                    );
                  }}
                />
              ))}
          </View>
        ) : null}
      </BottomSheet>
      <LeaveSheet
        words={leaveAsk?.words ?? null}
        choiceLabel={TRIP_PLAN_BULK_DELETE_ADDED_LABEL}
        onClose={() => setLeaveAsk(null)}
        onConfirm={(deleteAdded) => {
          const ask = leaveAsk;
          setLeaveAsk(null);
          ask?.run(deleteAdded);
        }}
      />
      <Toast message={toast} onDismissed={() => setToast(null)} />
    </View>
  );
}

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
  menu: { gap: spacing(1) },
  hint: { ...muted(theme, textRole.detail) },
  // One line, centred: a pill and the ⋯ share a centre line.
  trailing: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(1),
  },
  pills: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing(1),
  },
}));
