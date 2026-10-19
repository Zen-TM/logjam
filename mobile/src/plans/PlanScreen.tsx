// A plan's page: "what do I need to know and do for this trip?"
// (`TRIP_PLAN_PAGE`). Reads the cached GET /plans/:id, so a plan opened once
// with signal reads in a canyon; it is fetched again when it opens and the
// poll says it changed, or there is no copy yet, and on pull to refresh
// (design §2.7).
import {
  Fragment,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import {
  contractSectionKeys,
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
  type SectionKeysOn,
  type TripPlanPageView,
  type TripPlanView,
} from "@logjam/shared";

import { useConnectivity } from "../map/connectivity";
import { onMirrorChanged } from "../sync/syncDb";
import { makeStyles, muted, spacing, useHues, useTheme } from "../theme";
import {
  Button,
  ChipRail,
  EmptyState,
  ErrorState,
  Hero,
  LoadingState,
  Notice,
  Row,
  SectionHeader,
  StatusPill,
  todayDateKey,
  type ChipOption,
} from "../ui";
import {
  fetchPlan,
  planChanged,
  readCachedPlan,
  readPlansList,
  type CachedPlan,
} from "./plansCache";

const copy = TRIP_PLAN_PAGE.copy;

function usePlan(planId: string, online: boolean) {
  const [cached, setCached] = useState<CachedPlan | null | undefined>(
    undefined,
  );
  const [changed, setChanged] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      setError(messageFromError(err, copy.loadFailed));
    } finally {
      setRefreshing(false);
    }
  }, [planId]);

  useEffect(() => {
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
  }, [planId, reread, refresh]);

  return { cached, changed, error, refreshing, refresh, now };
}

export function PlanScreen({
  planId,
  name,
  onBack,
}: {
  planId: string;
  /** The list row's name, for the hero before the cache is read. */
  name: string;
  onBack: () => void;
}) {
  const online = useConnectivity() === "online";
  const styles = useStyles();
  const { cached, changed, error, refreshing, refresh, now } = usePlan(
    planId,
    online,
  );
  const [view, setView] = useState<TripPlanPageView>("writeUp");

  if (cached === undefined)
    return (
      <View style={styles.screen}>
        <Hero title={name} onBack={onBack} />
        <LoadingState label={copy.loading} />
      </View>
    );
  if (cached === null)
    return (
      <View style={styles.screen}>
        <Hero title={name} onBack={onBack} />
        {refreshing ? (
          <LoadingState label={copy.loading} />
        ) : error && online ? (
          <ErrorState message={error} onRetry={() => void refresh()} />
        ) : (
          <EmptyState icon="offline" title={TRIP_PLAN_OFFLINE.notDownloaded} />
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
}) {
  const theme = useTheme();
  const styles = useStyles();
  const { plan } = cached;
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
    { value: "items", label: copy.viewItems, count: itemCount },
    { value: "forms", label: copy.viewForms, count: plan.forms.length },
    { value: "people", label: copy.viewPeople, count: going.length },
  ];

  const sections: Record<
    SectionKeysOn<typeof TRIP_PLAN_PAGE, "gps">,
    ReactNode
  > = {
    hero: (
      <Hero title={plan.name} titleNumberOfLines={2} onBack={onBack}>
        <Text style={styles.age}>
          {updatedAgo(Date.parse(cached.fetchedAt), now)}
        </Text>
        {changed || !online ? (
          <View style={styles.pills}>
            {online ? null : (
              <StatusPill label="Offline" tone="muted" icon="offline" />
            )}
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
          <SectionHeader title={copy.peopleGoing} count={going.length} />
          {going.map((member) => (
            <Row
              key={member.user.id}
              icon="account"
              title={member.user.username}
              right={
                member.role === "member" ? undefined : (
                  <StatusPill
                    label={member.role === "leader" ? "Leader" : "Editor"}
                    tone="outline"
                  />
                )
              }
            />
          ))}
        </>
      ) : null,
  };

  const [pinned, body] = [
    ["hero", "notices", "dates", "views"],
    ["writeUp", "items", "forms", "people"],
  ];
  const keys = contractSectionKeys(TRIP_PLAN_PAGE, "gps");
  return (
    <View style={styles.screen}>
      {keys
        .filter((key) => pinned.includes(key))
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
          .filter((key) => body.includes(key))
          .map((key) => (
            <Fragment key={key}>{sections[key]}</Fragment>
          ))}
      </ScrollView>
    </View>
  );
}

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
  return (
    <>
      {plan.places.length > 0 ? (
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
      {ways > 0 ? <SectionHeader title={copy.itemsWays} count={ways} /> : null}
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
          title={file.item.displayName ?? file.item.filename}
          subtitle={tripPlanAddedByLine(file.addedBy)}
        />
      ))}
      {plan.geoPdfs.length > 0 ? (
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
