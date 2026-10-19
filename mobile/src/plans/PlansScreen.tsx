// Plans: "what trips am I getting ready for?" (`TRIP_PLANS_LIST`).
//
// Cache-first, like the inbox: the last GET /plans renders at once, and the
// screen polls on opening and on pull to refresh (design §2.7). A failed poll
// with a cached list is silent; offline is the hero's pill.
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { FlatList, RefreshControl, View } from "react-native";
import {
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
import { capabilityScreenBlock } from "../auth/capabilities";
import { useConnectivity } from "../map/connectivity";
import { onMirrorChanged } from "../sync/syncDb";
import { makeStyles, spacing, useHues, useTheme } from "../theme";
import {
  ChipRail,
  EmptyState,
  ErrorState,
  Hero,
  LoadingState,
  Row,
  StatusPill,
  todayDateKey,
  type ChipOption,
} from "../ui";
import {
  planChanged,
  pollPlans,
  readCachedPlanStamps,
  readPlansList,
  type CachedPlanStamp,
} from "./plansCache";

const copy = TRIP_PLANS_LIST.copy;
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
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const reread = useCallback(async () => {
    const [list, nextStamps] = await Promise.all([
      readPlansList(),
      readCachedPlanStamps(),
    ]);
    setStamps(nextStamps);
    if (list) setPlans(list.plans);
    return list;
  }, []);

  const poll = useCallback(async () => {
    setRefreshing(true);
    try {
      await pollPlans();
      setError(null);
    } catch (err) {
      const cached = await reread().catch(() => null);
      if (!cached) {
        setError(messageFromError(err, copy.loadFailed));
        setPlans([]);
      }
    } finally {
      setRefreshing(false);
    }
  }, [reread]);

  useEffect(() => {
    if (blocked) return;
    void (async () => {
      await reread().catch(console.error);
      await poll();
    })();
    return onMirrorChanged(() => void reread().catch(console.error));
  }, [blocked, poll, reread]);

  return { plans, stamps, error, refreshing, poll };
}

export function PlansScreen({
  onBack,
  onOpenPlan,
}: {
  onBack: () => void;
  onOpenPlan: (plan: TripPlanSummary) => void;
}) {
  const theme = useTheme();
  const styles = useStyles();
  const { assetHue } = useHues();
  const { accountState } = useAccountState();
  const block = capabilityScreenBlock("plans", accountState);
  const online = useConnectivity() === "online";
  const { plans, stamps, error, refreshing, poll } = usePlansList(
    block !== null,
  );
  const [bucket, setBucket] = useState<TripPlanBucket>("upcoming");
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
          // ponytail: an invite or a request opens nothing yet; the join
          // screen comes with the plan's writes.
          onPress={
            item.status === "active" ? () => onOpenPlan(item) : undefined
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
            </View>
          }
        />
      );
    },
    [assetHue.plan, onOpenPlan, stamps, styles.pills],
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

  const empty = tripPlansEmpty(plans?.length ?? 0, bucket);
  const sections: Record<
    SectionKeysOn<typeof TRIP_PLANS_LIST, "gps">,
    ReactNode
  > = {
    hero: (
      <Hero
        eyebrow={TRIP_PLANS_LIST.title}
        title={plans ? tripPlansHeroTitle(plans, today) : copy.loading}
        titleNumberOfLines={2}
        onBack={onBack}
      >
        {online ? null : (
          <View style={styles.pills}>
            <StatusPill label="Offline" tone="muted" icon="offline" />
          </View>
        )}
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
      plans === null ? (
        <LoadingState label={copy.loading} />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void poll()} />
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
              hint={online ? empty.body : TRIP_PLAN_OFFLINE.noPlansOffline}
            />
          }
        />
      ),
  };

  return (
    <View style={styles.screen}>
      {contractSectionKeys(TRIP_PLANS_LIST, "gps").map((key) => (
        <Fragment key={key}>{sections[key]}</Fragment>
      ))}
    </View>
  );
}

const planKey = (plan: TripPlanSummary) => plan.id;

const useStyles = makeStyles((theme) => ({
  screen: { flex: 1, backgroundColor: theme.page },
  rail: { paddingHorizontal: spacing(2), paddingVertical: spacing(1) },
  list: { flex: 1 },
  listContent: {
    paddingHorizontal: spacing(2),
    gap: spacing(1),
    paddingBottom: spacing(4),
  },
  pills: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing(1),
  },
}));
