// A plan's page: "what do I need to know and do for this trip?"
// (`TRIP_PLAN_PAGE`). Reads the cached GET /plans/:id, so a plan opened once
// with signal reads in a canyon; it is fetched again when it opens and the
// poll says it changed, or there is no copy yet, and on pull to refresh
// (`plansCache.ts`). Which state draws is `planPageView`'s.
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import {
  ApiError,
  contractSectionKeys,
  mediaCategory,
  mediaDisplayName,
  messageFromError,
  planAddVerbLabel,
  planVerbLabel,
  planVerbsFor,
  PLAN_ADD_VERBS,
  PLAN_FORM_VERBS,
  tripPlanAddedByLine,
  tripPlanCounts,
  tripPlanDatesLine,
  tripPlanGoing,
  tripPlanIsOver,
  tripPlanNotice,
  tripTypeLabel,
  weatherAge as updatedAgo,
  TRIP_PLAN_FORMS,
  TRIP_PLAN_OFFLINE,
  TRIP_PLAN_PAGE,
  type SectionKeysOn,
  type TripPlanItem,
  type TripPlanPageView,
  type TripPlanView,
} from "@logjam/shared";

import { useAccountState } from "../auth/AccountStateContext";
import {
  capabilityScreenBlock,
  unavailableReasonText,
} from "../auth/capabilities";
import { useConnectivity } from "../map/connectivity";
import { MediaViewer, type ViewerMedia } from "../media/MediaViewer";
import { getSyncStateValue, onMirrorChanged } from "../sync/syncDb";
import {
  formRhythm,
  makeStyles,
  muted,
  spacing,
  useHues,
  useTheme,
} from "../theme";
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
import { FormSheet, type FormSheetState } from "./FormSheet";
import { PlanDetailsSheet } from "./PlanDetailsSheet";
import { PeopleView } from "./PeopleView";
import {
  openPlanMedia,
  PlanDownload,
  usePlanFilesOnPhone,
} from "./PlanDownload";
import { openablePlanMedia, planFiles, planFileSource } from "./planFiles";
import { PlanPlaceSheet } from "./PlanPlaceSheet";
import { planBbox } from "./planMap";
import { itemTitle, PlanItemSheet } from "./PlanItemSheet";
import { PlanOptionsSheet } from "./PlanOptionsSheet";
import { PlanTripLogSheet } from "./PlanTripLogSheet";
import {
  SAVE_A_COPY,
  SaveCopySheet,
  type SaveCopyTarget,
} from "./SaveCopySheet";
import { patchPlan } from "./plansApi";
import { AddCopySheet } from "./AddCopySheet";
import { SectionSheet, type SectionSheetState } from "./SectionSheet";
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
const OFFLINE = unavailableReasonText("needs-connection");

function usePlan(planId: string, online: boolean, blocked: boolean) {
  const [cached, setCached] = useState<CachedPlan | null | undefined>(
    undefined,
  );
  const [changed, setChanged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Lost while this page had it, or a 404 on opening: no Try again helps.
  const [gone, setGone] = useState(false);
  const held = useRef(false);
  // A Leave or Delete under way: the plan stays drawn while the page goes.
  const leaving = useRef(false);
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
    if (!plan && leaving.current) return { stale: false };
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

  const setLeaving = useCallback((next: boolean) => {
    leaving.current = next;
  }, []);

  return {
    cached,
    changed,
    error,
    gone,
    refreshing,
    refresh,
    now,
    setLeaving,
  };
}

export function PlanScreen({
  planId,
  name,
  initialView,
  onBack,
  onShowOnMap,
  onDownloadMap,
  onDrawRoute,
  onGone,
}: {
  planId: string;
  /** The list row's name, for the hero before the cache is read. */
  name: string;
  /** The tab it opens on; the write-up when absent. */
  initialView?: TripPlanPageView;
  onBack: () => void;
  /** The map in plan mode, framed on the plan's items when it has any. */
  onShowOnMap: (
    planId: string,
    bbox: [number, number, number, number] | null,
  ) => void;
  /** The region download, framed on the plan's items. */
  onDownloadMap: (bbox: [number, number, number, number]) => void;
  /** The map with the pen armed; the finished route is added to this plan. */
  onDrawRoute: (planId: string) => void;
  /** The caller left or deleted the plan: back to Plans, saying so. */
  onGone: (message: string) => void;
}) {
  const online = useConnectivity() === "online";
  const styles = useStyles();
  // A plan push tapped after sign-out can open this for a guest: no read, no
  // fetch, as on Plans.
  const { accountState } = useAccountState();
  const block = capabilityScreenBlock("plans", accountState);
  const { cached, changed, error, gone, refreshing, refresh, now, setLeaving } =
    usePlan(planId, online, block !== null);
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
      onShowOnMap={() => onShowOnMap(planId, planBbox(cached.plan))}
      onDownloadMap={onDownloadMap}
      onDrawRoute={onDrawRoute}
      onGone={onGone}
      onLeaving={setLeaving}
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
  onShowOnMap,
  onDownloadMap,
  onDrawRoute,
  onGone,
  onLeaving,
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
  onShowOnMap: () => void;
  onDownloadMap: (bbox: [number, number, number, number]) => void;
  onDrawRoute: (planId: string) => void;
  onGone: (message: string) => void;
  onLeaving: (leaving: boolean) => void;
}) {
  const theme = useTheme();
  const styles = useStyles();
  const { plan } = cached;
  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [tripLogOpen, setTripLogOpen] = useState(false);
  const [sectionSheet, setSectionSheet] = useState<SectionSheetState>(null);
  const [formSheet, setFormSheet] = useState<FormSheetState>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const notify = (text: string, tone: ToastMessage["tone"] = "info") =>
    setToast({ text, tone, nonce: Date.now() });
  // Stable: FormSheet hands a refusal over from an effect.
  const notifyError = useCallback(
    (text: string) => setToast({ text, tone: "error", nonce: Date.now() }),
    [],
  );
  const archived = plan.archivedAt != null;
  // Add ▾'s verbs this caller may run; the page draws each where it belongs.
  const adds = new Set(
    planVerbsFor(PLAN_ADD_VERBS, "gps", plan.myRole, { archived }).map(
      (verb) => verb.id,
    ),
  );
  const today = todayDateKey();
  const notice = tripPlanNotice({
    archived: plan.archivedAt != null,
    unansweredRequired:
      plan.forms.find((form) => form.requiredToJoin && !form.myAnswer) ?? null,
    over: tripPlanIsOver(plan, today),
  });
  const going = tripPlanGoing(plan.members);
  const counts = tripPlanCounts(plan);
  const itemCount = counts.places + counts.ways;
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
        <PlanDownload cached={cached} now={now} />
      </Hero>
    ),
    notices: notice ? (
      <View style={styles.notice}>
        {notice.kind === "answer" || notice.kind === "over" ? (
          // A prompt that opens a form is a pressable row, as every other
          // thing here that opens something.
          <Row
            icon={notice.icon}
            title={notice.text}
            titleNumberOfLines={3}
            subtitle={
              online || notice.kind === "over"
                ? notice.kind === "answer"
                  ? TRIP_PLAN_FORMS.copy.answer
                  : planVerbLabel("tripLog")
                : OFFLINE
            }
            // Live offline: a trip log is the caller's own and queues.
            disabled={!online && notice.kind === "answer"}
            onPress={() =>
              notice.kind === "answer"
                ? setFormSheet({ formId: notice.formId, mode: "answer" })
                : setTripLogOpen(true)
            }
          />
        ) : (
          <Notice icon={notice.icon}>{notice.text}</Notice>
        )}
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
    writeUp:
      view === "writeUp" ? (
        <WriteUp
          plan={plan}
          canWrite={adds.has("section")}
          online={online}
          onSection={setSectionSheet}
        />
      ) : null,
    showOnMap:
      view === "items" && plan.places.length + plan.routes.length > 0 ? (
        <Button
          label={copy.showOnMap}
          icon="map"
          variant="outlineAccent"
          onPress={onShowOnMap}
        />
      ) : null,
    items:
      view === "items" ? (
        <Items
          plan={plan}
          online={online}
          canAdd={adds.has("copy")}
          onInfo={notify}
          onError={(text) => notify(text, "error")}
          onDrawRoute={() => onDrawRoute(plan.id)}
        />
      ) : null,
    forms:
      view === "forms" ? (
        <Forms
          plan={plan}
          onOpen={(formId, mode) => setFormSheet({ formId, mode })}
        />
      ) : null,
    people:
      view === "people" ? (
        <PeopleView
          plan={plan}
          canInvite={adds.has("invite")}
          online={online}
          onInfo={notify}
          onError={(text) => notify(text, "error")}
        />
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
        cached={menuOpen ? cached : null}
        online={online}
        onDownloadMap={onDownloadMap}
        onClose={() => setMenuOpen(false)}
        onEdit={() => setEditOpen(true)}
        onTripLog={() => setTripLogOpen(true)}
        onInfo={notify}
        onError={(text) => notify(text, "error")}
        onGone={onGone}
        onLeaving={onLeaving}
      />
      <PlanTripLogSheet
        plan={tripLogOpen ? plan : null}
        online={online}
        onClose={() => setTripLogOpen(false)}
        // A toast only: the form closes itself after Log trip, and an
        // attribute added inside it saves without closing it.
        onSaved={(text, tone) => notify(text, tone)}
      />
      <PlanDetailsSheet
        visible={editOpen}
        plan={plan}
        onClose={() => setEditOpen(false)}
        onSubmit={async (_values, patch) => {
          try {
            await patchPlan(plan.id, patch);
          } catch (err) {
            // Someone else's change, or the plan gone: fetch it, so the form
            // shows theirs, or the page goes.
            if (err instanceof ApiError) {
              const lost = err.status === 404;
              await afterPlanWrite(plan.id, lost);
              if (lost) {
                setEditOpen(false);
                return onGone(TRIP_PLAN_OFFLINE.gone);
              }
            }
            throw err;
          }
          await afterPlanWrite(plan.id);
          setEditOpen(false);
        }}
      />
      <SectionSheet
        // Closed when the caller can no longer write (archived, demoted).
        state={adds.has("section") ? sectionSheet : null}
        planId={plan.id}
        role={plan.myRole}
        sections={plan.sections}
        online={online}
        onState={setSectionSheet}
        onInfo={notify}
        onError={(text) => notify(text, "error")}
      />
      <FormSheet
        state={formSheet}
        plan={plan}
        online={online}
        onState={setFormSheet}
        onInfo={notify}
        onError={notifyError}
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

function WriteUp({
  plan,
  canWrite,
  online,
  onSection,
}: {
  plan: TripPlanView;
  /** The caller may add, edit, move and delete sections (and it's live). */
  canWrite: boolean;
  online: boolean;
  onSection: (state: SectionSheetState) => void;
}) {
  const theme = useTheme();
  const styles = useStyles();
  const addButton = (
    <Button
      label={planAddVerbLabel("section")}
      icon="add"
      variant="outlineAccent"
      disabled={!online}
      disabledReason={OFFLINE}
      onPress={() => onSection({ mode: "add" })}
    />
  );
  // The button only dims: the words go under it (ui/Button.tsx).
  const add = canWrite ? (
    <>
      {addButton}
      {online ? null : <Text style={styles.offline}>{OFFLINE}</Text>}
    </>
  ) : null;
  if (plan.sections.length === 0)
    return (
      <>
        <EmptyState icon="notes" title={copy.writeUpEmpty} />
        {add}
      </>
    );
  return (
    <>
      {plan.sections.map((section) => (
        <View key={section.id} style={styles.section}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle} accessibilityRole="header">
              {section.title}
            </Text>
            {canWrite ? (
              <IconButton
                icon="overflow"
                accessibilityLabel={`Actions for ${section.title}`}
                color={theme.textMuted}
                onPress={() =>
                  onSection({ mode: "verbs", sectionId: section.id })
                }
              />
            ) : null}
          </View>
          <Text style={styles.sectionBody} selectable>
            {section.body || copy.writeUpEmpty}
          </Text>
        </View>
      ))}
      {add}
    </>
  );
}

function Items({
  plan,
  online,
  canAdd,
  onInfo,
  onError,
  onDrawRoute,
}: {
  plan: TripPlanView;
  online: boolean;
  /** The caller may Add a copy (and it's live). */
  canAdd: boolean;
  onInfo: (message: string, tone?: "info" | "error") => void;
  onError: (message: string) => void;
  onDrawRoute: () => void;
}) {
  const theme = useTheme();
  const [saving, setSaving] = useState<SaveCopyTarget | null>(null);
  const [adding, setAdding] = useState(false);
  const styles = useStyles();
  // The button only dims: the words go under it (ui/Button.tsx).
  const add = canAdd ? (
    <>
      <Button
        label={planAddVerbLabel("copy")}
        icon="copy"
        variant="outlineAccent"
        disabled={!online}
        disabledReason={OFFLINE}
        onPress={() => setAdding(true)}
      />
      <Button
        label="Draw a route"
        icon="route"
        variant="outlineAccent"
        disabled={!online}
        disabledReason={OFFLINE}
        onPress={onDrawRoute}
      />
      {online ? null : <Text style={styles.offline}>{OFFLINE}</Text>}
      <AddCopySheet
        planId={plan.id}
        visible={adding}
        online={online}
        onClose={() => setAdding(false)}
        onDone={onInfo}
      />
    </>
  ) : null;
  const [menuItem, setMenuItem] = useState<TripPlanItem | null>(null);
  const [me, setMe] = useState<string | null>(null);
  useEffect(() => {
    void getSyncStateValue("userId").then(setMe).catch(console.error);
  }, []);
  /** The item's ⋯ (`PlanItemSheet`): its row's trailing control. */
  const menu = (item: TripPlanItem) => (
    <IconButton
      icon="overflow"
      accessibilityLabel={`Actions for ${itemTitle(item)}`}
      color={theme.textMuted}
      onPress={() => setMenuItem(item)}
    />
  );
  const { assetHue } = useHues();
  const [placeId, setPlaceId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<ViewerMedia[] | null>(null);
  // A downloaded file opens from the phone; one that isn't, from its URL
  // while online (`planFileSource`).
  const files = useMemo(() => planFiles(plan), [plan]);
  const onPhone = usePlanFilesOnPhone(plan.id, files);
  const failed = (err: unknown) =>
    onInfo(messageFromError(err, TRIP_PLAN_PAGE.copy.loadFailed));
  // Offline, what can't open says why under its name.
  const subtitle = (addedBy: string | undefined, opens: boolean) =>
    opens || online ? addedBy : [addedBy, OFFLINE].filter(Boolean).join(" · ");
  const { ways } = tripPlanCounts(plan);
  if (plan.places.length + ways === 0)
    return (
      <>
        <EmptyState icon="place" title={copy.itemsEmpty} />
        {add}
      </>
    );
  // A heading needs a second group to divide from (shared/DESIGN.md §2).
  const headed = [plan.places.length, ways].filter((n) => n > 0).length > 1;
  return (
    <>
      {headed && plan.places.length > 0 ? (
        <SectionHeader title={copy.itemsPlaces} count={plan.places.length} />
      ) : null}
      {plan.places.map((each) => (
        <Row
          key={each.id}
          icon="place"
          hue={theme.accent}
          title={each.name}
          subtitle={tripPlanAddedByLine(each.addedBy)}
          right={menu(each)}
          onPress={() => setPlaceId(each.id)}
        />
      ))}
      <PlanPlaceSheet
        planId={plan.id}
        place={plan.places.find((each) => each.id === placeId) ?? null}
        online={online}
        onClose={() => setPlaceId(null)}
        onInfo={onInfo}
      />
      {headed && ways > 0 ? (
        <SectionHeader title={copy.itemsWays} count={ways} />
      ) : null}
      {plan.routes.map((route) => (
        <Row
          key={route.id}
          icon="route"
          hue={assetHue.route}
          title={route.name}
          // Its actions all need a connection.
          subtitle={subtitle(tripPlanAddedByLine(route.addedBy), false)}
          right={menu(route)}
        />
      ))}
      {plan.files.map((file) => {
        const category = mediaCategory(file.item.mediaType);
        // A GPX or KML file has no viewer that keeps it out of the caller's
        // account: importing it is Save a copy.
        const shown =
          category === "image" || category === "video"
            ? openablePlanMedia(plan.id, [file.item], files, onPhone, online)
            : null;
        return (
          <Row
            key={file.id}
            icon="importedFile"
            hue={assetHue.import}
            title={mediaDisplayName(file.item)}
            right={menu(file)}
            subtitle={subtitle(
              tripPlanAddedByLine(file.addedBy),
              // Opens only as a photo or video; a GPX/KML row's one action
              // is Save a copy, which needs a connection.
              !!shown?.length,
            )}
            onPress={
              shown?.length
                ? () =>
                    void openPlanMedia(
                      plan.id,
                      [file.item],
                      files,
                      onPhone,
                      online,
                    )
                      .then(setViewing)
                      .catch(failed)
                : undefined
            }
          />
        );
      })}
      {add}
      <PlanItemSheet
        item={menuItem}
        planId={plan.id}
        role={plan.myRole}
        me={me}
        archived={plan.archivedAt != null}
        online={online}
        onClose={() => setMenuItem(null)}
        onSave={(item) =>
          setSaving({
            kind: item.kind,
            id: item.id,
            title: itemTitle(item),
            photos: item.kind === "place" ? item.media.length : 0,
          })
        }
        onInfo={onInfo}
        onError={onError}
      />
      <SaveCopySheet
        planId={plan.id}
        target={saving}
        online={online}
        onClose={() => setSaving(null)}
        onDone={onInfo}
      />
      {viewing?.length ? (
        <MediaViewer
          items={viewing}
          startIndex={0}
          onClose={() => setViewing(null)}
        />
      ) : null}
    </>
  );
}

function Forms({
  plan,
  onOpen,
}: {
  plan: TripPlanView;
  /** The form's sheet, read or on its ⋯ (`verbs`). */
  onOpen: (formId: string, mode: "read" | "verbs") => void;
}) {
  const theme = useTheme();
  const styles = useStyles();
  const { assetHue } = useHues();
  // The row offers the form's verbs as its sheet does (shared/DESIGN.md §9).
  const verbs = planVerbsFor(PLAN_FORM_VERBS, "gps", plan.myRole, {
    archived: plan.archivedAt != null,
  });
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
      onPress={() => onOpen(form.id, "read")}
      // The pills sit under the line: beside the ⋯ they squeezed the title.
      footer={
        form.requiredToJoin ? (
          <View style={styles.pills}>
            <StatusPill label={copy.pillRequired} tone="outline" />
            {form.myAnswer ? null : (
              <StatusPill label={copy.pillNotAnswered} tone="warning" />
            )}
          </View>
        ) : undefined
      }
      right={
        verbs.length > 0 ? (
          <IconButton
            icon="overflow"
            accessibilityLabel={`${TRIP_PLAN_FORMS.copy.actions}: ${form.title}`}
            color={theme.textMuted}
            onPress={() => onOpen(form.id, "verbs")}
          />
        ) : undefined
      }
    />
  ));
}

const useStyles = makeStyles((theme, textRole) => ({
  screen: { flex: 1, backgroundColor: theme.page },
  age: { ...muted(theme, textRole.detail) },
  offline: { ...muted(theme, textRole.detail), textAlign: "center" },
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
  // The title is SectionHeader's style without its margins, so the ⋯ centres
  // on the line.
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: formRhythm.section,
  },
  sectionTitle: {
    ...muted(theme, textRole.section),
    flex: 1,
    letterSpacing: 0.8,
  },
  sectionBody: { ...textRole.body, color: theme.text },
}));
