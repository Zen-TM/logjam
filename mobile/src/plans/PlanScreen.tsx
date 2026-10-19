// A plan's page: "what do I need to know and do for this trip?"
// (`TRIP_PLAN_PAGE`). Reads the cached GET /plans/:id, so a plan opened once
// with signal reads in a canyon; it is fetched again when it opens and the
// poll says it changed, or there is no copy yet, and on pull to refresh
// (`plansCache.ts`). Which state draws is `planPageView`'s.
import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import {
  ApiError,
  contractSectionKeys,
  mediaDisplayName,
  messageFromError,
  tripPlanAddedByLine,
  tripPlanDatesLine,
  tripPlanGoing,
  tripPlanIsOver,
  tripPlanNotice,
  tripTypeLabel,
  weatherAge as updatedAgo,
  TRIP_PLAN_OFFLINE,
  TRIP_PLAN_PAGE,
  TRIP_PLANS_LIST,
  type SectionKeysOn,
  type TripPlanPageView,
  type TripPlanView,
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
  Button,
  ChipRail,
  EmptyState,
  ErrorState,
  Hero,
  IconButton,
  LoadingState,
  Notice,
  Row,
  SectionHeader,
  StatusPill,
  SyncStatusPills,
  Toast,
  todayDateKey,
  type ChipOption,
  type ToastMessage,
} from "../ui";
import { PlanDetailsSheet } from "./PlanDetailsSheet";
import { PlanOptionsSheet } from "./PlanOptionsSheet";
import { patchPlan } from "./plansApi";
import {
  afterPlanWrite,
  fetchPlan,
  planChanged,
  readCachedPlan,
  readPlansList,
  type CachedPlan,
} from "./plansCache";
import { planPageView } from "./planViews";

const copy = TRIP_PLAN_PAGE.copy;

function usePlan(planId: string, online: boolean, blocked: boolean) {
  const [cached, setCached] = useState<CachedPlan | null | undefined>(
    undefined,
  );
  const [changed, setChanged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Lost while this page had it, or a 404 on opening: no Try again helps.
  const [gone, setGone] = useState(false);
  const held = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  // When the cache was last read: "Updated 3 days ago" is relative to it.
  const [now, setNow] = useState(0);

  const reread = useCallback(async () => {
    const [plan, list] = await Promise.all([
      readCachedPlan(planId),
      readPlansList(),
    ]);
    const summary = list?.plans.find((row) => row.id === planId);
    const moved =
      plan != null &&
      summary != null &&
      planChanged(summary, {
        updatedAt: plan.plan.updatedAt,
        downloadedAt: null,
      });
    if (plan) held.current = true;
    else if (held.current) setGone(true);
    setCached(plan);
    setChanged(moved);
    setNow(Date.now());
    return { stale: plan == null || moved };
  }, [planId]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetchPlan(planId);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setGone(true);
      else setError(messageFromError(err, copy.loadFailed));
    } finally {
      setRefreshing(false);
    }
  }, [planId]);

  useEffect(() => {
    if (blocked) return;
    let cancelled = false;
    void (async () => {
      const state = await reread();
      if (!cancelled && online && state.stale) await refresh();
    })().catch(console.error);
    const unsubscribe = onMirrorChanged(
      () => void reread().catch(console.error),
    );
    return () => {
      cancelled = true;
      unsubscribe();
    };
    // Opening is the moment that fetches; coming back online is not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId, reread, refresh, blocked]);

  return { cached, changed, error, gone, refreshing, refresh, now };
}

export function PlanScreen({
  planId,
  name,
  initialView,
  onBack,
  onGone,
}: {
  planId: string;
  /** The list row's name, for the hero before the cache is read. */
  name: string;
  /** The tab it opens on; the write-up when absent. */
  initialView?: TripPlanPageView;
  onBack: () => void;
  /** The caller left or deleted the plan: back to Plans, saying so. */
  onGone: (message: string) => void;
}) {
  const online = useConnectivity() === "online";
  const styles = useStyles();
  // A plan push tapped after sign-out can open this for a guest: no read, no
  // fetch, as on Plans.
  const { accountState } = useAccountState();
  const block = capabilityScreenBlock("plans", accountState);
  const { cached, changed, error, gone, refreshing, refresh, now } = usePlan(
    planId,
    online,
    block !== null,
  );
  const [view, setView] = useState<TripPlanPageView>(initialView ?? "writeUp");

  if (block)
    return (
      <View style={styles.screen}>
        <Hero title={block.title} onBack={onBack} />
        <EmptyState title={block.title} hint={block.hint} icon="plan" />
      </View>
    );
  const shown = planPageView({
    cached,
    gone,
    refreshing,
    failure: error,
    online,
  });
  if (shown.kind !== "page" || !cached)
    return (
      <View style={styles.screen}>
        <Hero title={name} onBack={onBack} />
        {shown.kind === "gone" ? (
          <EmptyState icon="plan" title={TRIP_PLAN_OFFLINE.gone} />
        ) : shown.kind === "failed" ? (
          <ErrorState message={shown.message} onRetry={() => void refresh()} />
        ) : shown.kind === "notDownloaded" ? (
          <EmptyState icon="offline" title={TRIP_PLAN_OFFLINE.notDownloaded} />
        ) : (
          <LoadingState label={copy.loading} />
        )}
      </View>
    );

  return (
    <PlanPage
      cached={cached}
      now={now}
      changed={changed}
      online={online}
      refreshing={refreshing}
      view={view}
      onView={setView}
      onRefresh={() => void refresh()}
      onBack={onBack}
      onGone={onGone}
    />
  );
}

function PlanPage({
  cached,
  now,
  changed,
  online,
  refreshing,
  view,
  onView,
  onRefresh,
  onBack,
  onGone,
}: {
  cached: CachedPlan;
  now: number;
  changed: boolean;
  online: boolean;
  refreshing: boolean;
  view: TripPlanPageView;
  onView: (view: TripPlanPageView) => void;
  onRefresh: () => void;
  onBack: () => void;
  onGone: (message: string) => void;
}) {
  const theme = useTheme();
  const styles = useStyles();
  const { plan } = cached;
  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const notify = (text: string, tone: ToastMessage["tone"] = "info") =>
    setToast({ text, tone, nonce: Date.now() });
  const today = todayDateKey();
  const notice = tripPlanNotice({
    archived: plan.archivedAt != null,
    unansweredRequired:
      plan.forms.find((form) => form.requiredToJoin && !form.myAnswer) ?? null,
    over: tripPlanIsOver(plan, today),
  });
  const going = tripPlanGoing(plan.members);
  const itemCount =
    plan.places.length +
    plan.routes.length +
    plan.files.length +
    plan.geoPdfs.length;
  const views: ChipOption<TripPlanPageView>[] = [
    { value: "writeUp", label: copy.viewWriteUp },
    // A zero is left out (shared/DESIGN.md §11).
    { value: "items", label: copy.viewItems, count: itemCount || undefined },
    {
      value: "forms",
      label: copy.viewForms,
      count: plan.forms.length || undefined,
    },
    {
      value: "people",
      label: copy.viewPeople,
      count: going.length || undefined,
    },
  ];

  const sections: Record<
    SectionKeysOn<typeof TRIP_PLAN_PAGE, "gps">,
    ReactNode
  > = {
    hero: (
      <Hero
        title={plan.name}
        titleNumberOfLines={2}
        onBack={onBack}
        actions={
          <IconButton
            icon="overflow"
            accessibilityLabel={copy.actions}
            color={theme.accent}
            filled
            onPress={() => setMenuOpen(true)}
          />
        }
      >
        <Text style={styles.age}>
          {updatedAgo(Date.parse(cached.fetchedAt), now)}
        </Text>
        {changed || !online ? (
          <View style={styles.pills}>
            <SyncStatusPills online={online} pendingCount={0} />
            {changed ? (
              <StatusPill label={TRIP_PLAN_OFFLINE.changed} tone="warning" />
            ) : null}
            {changed ? (
              <Button
                label={TRIP_PLAN_OFFLINE.refresh}
                icon="refresh"
                compact
                variant="outlineAccent"
                disabled={!online}
                disabledReason={unavailableReasonText("needs-connection")}
                loading={refreshing}
                onPress={onRefresh}
              />
            ) : null}
          </View>
        ) : null}
      </Hero>
    ),
    notices: notice ? (
      <View style={styles.notice}>
        <Notice icon={notice.icon}>{notice.text}</Notice>
      </View>
    ) : null,
    dates: (
      <Text style={styles.dates}>
        {tripPlanDatesLine(plan, plan.myRole, tripTypeLabel)}
      </Text>
    ),
    views: (
      <View style={styles.rail}>
        <ChipRail scroll options={views} value={view} onChange={onView} />
      </View>
    ),
    writeUp: view === "writeUp" ? <WriteUp plan={plan} /> : null,
    items: view === "items" ? <Items plan={plan} /> : null,
    forms: view === "forms" ? <Forms plan={plan} /> : null,
    people:
      view === "people" ? (
        <>
          {going.map((member) => (
            <Row
              key={member.user.id}
              icon="account"
              title={member.user.username}
              right={
                member.role === "member" ? undefined : (
                  <StatusPill
                    label={
                      member.role === "leader"
                        ? TRIP_PLANS_LIST.copy.pillLeader
                        : TRIP_PLANS_LIST.copy.pillEditor
                    }
                    tone="outline"
                  />
                )
              }
            />
          ))}
        </>
      ) : null,
  };

  const keys = contractSectionKeys(TRIP_PLAN_PAGE, "gps");
  return (
    <View style={styles.screen}>
      {keys
        .filter((key) => PINNED.includes(key))
        .map((key) => (
          <Fragment key={key}>{sections[key]}</Fragment>
        ))}
      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={online ? onRefresh : undefined}
            enabled={online}
            tintColor={theme.accent}
          />
        }
      >
        {keys
          .filter((key) => !PINNED.includes(key))
          .map((key) => (
            <Fragment key={key}>{sections[key]}</Fragment>
          ))}
      </ScrollView>

      <PlanOptionsSheet
        plan={menuOpen ? plan : null}
        online={online}
        onClose={() => setMenuOpen(false)}
        onEdit={() => setEditOpen(true)}
        onInfo={notify}
        onError={(text) => notify(text, "error")}
        onGone={onGone}
      />
      <PlanDetailsSheet
        visible={editOpen}
        plan={plan}
        onClose={() => setEditOpen(false)}
        onSubmit={async (_values, patch) => {
          try {
            await patchPlan(plan.id, patch);
          } catch (err) {
            // Someone else's change: fetch it, so the form shows theirs.
            if (err instanceof ApiError && err.status === 409)
              await afterPlanWrite(plan.id);
            throw err;
          }
          await afterPlanWrite(plan.id);
          setEditOpen(false);
        }}
      />
      <Toast message={toast} onDismissed={() => setToast(null)} />
    </View>
  );
}

/** Above the scroll; every other section scrolls under them. */
const PINNED: readonly SectionKeysOn<typeof TRIP_PLAN_PAGE, "gps">[] = [
  "hero",
  "notices",
  "dates",
  "views",
];

function WriteUp({ plan }: { plan: TripPlanView }) {
  const styles = useStyles();
  if (plan.sections.length === 0)
    return <EmptyState icon="notes" title={copy.writeUpEmpty} />;
  return plan.sections.map((section) => (
    <View key={section.id} style={styles.section}>
      <SectionHeader title={section.title} />
      <Text style={styles.sectionBody} selectable>
        {section.body || copy.writeUpEmpty}
      </Text>
    </View>
  ));
}

function Items({ plan }: { plan: TripPlanView }) {
  const theme = useTheme();
  const { assetHue } = useHues();
  const ways = plan.routes.length + plan.files.length;
  if (plan.places.length + ways + plan.geoPdfs.length === 0)
    return <EmptyState icon="place" title={copy.itemsEmpty} />;
  // A heading needs a second group to divide from (shared/DESIGN.md §2).
  const headed =
    [plan.places.length, ways, plan.geoPdfs.length].filter((n) => n > 0)
      .length > 1;
  return (
    <>
      {headed && plan.places.length > 0 ? (
        <SectionHeader title={copy.itemsPlaces} count={plan.places.length} />
      ) : null}
      {plan.places.map((place) => (
        <Row
          key={place.id}
          icon="place"
          hue={theme.accent}
          title={place.name}
          subtitle={tripPlanAddedByLine(place.addedBy)}
        />
      ))}
      {headed && ways > 0 ? (
        <SectionHeader title={copy.itemsWays} count={ways} />
      ) : null}
      {plan.routes.map((route) => (
        <Row
          key={route.id}
          icon="route"
          hue={assetHue.route}
          title={route.name}
          subtitle={tripPlanAddedByLine(route.addedBy)}
        />
      ))}
      {plan.files.map((file) => (
        <Row
          key={file.id}
          icon="importedFile"
          hue={assetHue.import}
          title={mediaDisplayName(file.item)}
          subtitle={tripPlanAddedByLine(file.addedBy)}
        />
      ))}
      {headed && plan.geoPdfs.length > 0 ? (
        <SectionHeader title={copy.itemsMaps} count={plan.geoPdfs.length} />
      ) : null}
      {plan.geoPdfs.map((pdf) => (
        <Row
          key={pdf.id}
          icon="geoPdf"
          hue={assetHue.geoPdf}
          title={pdf.title ?? "GeoPDF"}
          subtitle={tripPlanAddedByLine(pdf.addedBy)}
        />
      ))}
    </>
  );
}

function Forms({ plan }: { plan: TripPlanView }) {
  const styles = useStyles();
  const { assetHue } = useHues();
  if (plan.forms.length === 0)
    return (
      <EmptyState
        icon="form"
        title={
          plan.myRole === "leader" ? copy.formsEmptyLeader : copy.formsEmpty
        }
      />
    );
  return plan.forms.map((form) => (
    <Row
      key={form.id}
      icon="form"
      hue={assetHue.plan}
      title={form.title}
      subtitle={
        form.visibleTo === "leaders" ? copy.seenByLeaders : copy.seenByMembers
      }
      right={
        form.requiredToJoin ? (
          <View style={styles.pills}>
            <StatusPill label={copy.pillRequired} tone="outline" />
            {form.myAnswer ? null : (
              <StatusPill label={copy.pillNotAnswered} tone="warning" />
            )}
          </View>
        ) : undefined
      }
    />
  ));
}

const useStyles = makeStyles((theme, textRole) => ({
  screen: { flex: 1, backgroundColor: theme.page },
  age: { ...muted(theme, textRole.detail) },
  pills: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing(1),
  },
  notice: { paddingHorizontal: spacing(2), paddingTop: spacing(1) },
  dates: {
    ...muted(theme, textRole.detail),
    paddingHorizontal: spacing(2),
    paddingTop: spacing(1),
  },
  rail: { paddingHorizontal: spacing(2), paddingVertical: spacing(1) },
  body: { flex: 1 },
  bodyContent: {
    paddingHorizontal: spacing(2),
    gap: spacing(1),
    paddingBottom: spacing(4),
  },
  section: { gap: spacing(1) },
  sectionBody: { ...textRole.body, color: theme.text },
}));
