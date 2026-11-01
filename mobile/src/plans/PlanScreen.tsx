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
  planItemVerbs,
  TRIP_PLAN_MAX_FORMS,
  tripPlanActionsFor,
  tripPlanAtMost,
  planVerbLabel,
  planVerbsFor,
  PLAN_ADD_VERBS,
  PLAN_FORM_VERBS,
  tripPlanAddedByLine,
  tripPlanCounts,
  tripPlanDatesLine,
  tripPlanFormsToAnswer,
  tripPlanFormsToAnswerLine,
  tripPlanFormTally,
  tripPlanFormTallyLines,
  tripPlanGoing,
  tripPlanIsOver,
  tripPlanNotice,
  tripTypeLabel,
  weatherAge as updatedAgo,
  TRIP_PLAN_FORMS,
  TRIP_PLAN_OFFLINE,
  TRIP_PLAN_JOIN,
  TRIP_PLAN_PAGE,
  TRIP_PLANS_LIST,
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
  ListEnd,
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
import { FormBuilderSheet, type FormBuilderState } from "./FormBuilderSheet";
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
  planMovedOn,
  readCachedPlan,
  readCachedPlanStamps,
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
    const [plan, list, stamps] = await Promise.all([
      readCachedPlan(planId),
      readPlansList(),
      readCachedPlanStamps(),
    ]);
    const moved = plan != null && planMovedOn(planId, list, stamps);
    if (!plan && leaving.current) return { stale: false };
    if (plan) held.current = true;
    else if (held.current) setGone(true);
    // Same copy (a mirror signal about something else): keep the object, so
    // the page does not draw again for nothing.
    setCached((was) =>
      was &&
      plan &&
      was.fetchedAt === plan.fetchedAt &&
      was.downloadedAt === plan.downloadedAt
        ? was
        : plan,
    );
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
  joined,
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
  /** Arrived by joining from an invite: say so once. */
  joined?: boolean;
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
  // Read once for the whole page; it draws after it, so nothing pops in
  // (a leader's tally, a member's own-item ⋯). Null: no mirror account.
  const [myId, setMyId] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    getSyncStateValue("userId")
      .then(setMyId)
      .catch((err: unknown) => {
        console.error(err);
        setMyId(null);
      });
  }, []);

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
  if (shown.kind !== "page" || !cached || myId === undefined)
    return (
      <View style={styles.screen}>
        <Hero eyebrow={TRIP_PLANS_LIST.title} title={name} onBack={onBack} />
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
      myId={myId}
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
      joined={joined}
    />
  );
}

function PlanPage({
  myId,
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
  joined,
}: {
  myId: string | null;
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
  joined?: boolean;
}) {
  const theme = useTheme();
  const { assetHue } = useHues();
  const styles = useStyles();
  const { plan } = cached;
  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [tripLogOpen, setTripLogOpen] = useState(false);
  const [sectionSheet, setSectionSheet] = useState<SectionSheetState>(null);
  const [formSheet, setFormSheet] = useState<FormSheetState>(null);
  const [formBuilder, setFormBuilder] = useState<FormBuilderState>(null);
  const [toast, setToast] = useState<ToastMessage | null>(
    joined
      ? { text: TRIP_PLAN_JOIN.copy.joined, tone: "info", nonce: 1 }
      : null,
  );
  const notify = (text: string, tone: ToastMessage["tone"] = "info") =>
    setToast({ text, tone, nonce: Date.now() });
  // Stable: FormSheet hands a refusal over from an effect.
  const notifyError = useCallback(
    (text: string) => setToast({ text, tone: "error", nonce: Date.now() }),
    [],
  );
  const archived = plan.archivedAt != null;
  // Add ▾'s verbs this caller may run; the page draws each where it belongs.
  const adds = useMemo(
    () =>
      new Set(
        planVerbsFor(PLAN_ADD_VERBS, "gps", plan.myRole, { archived }).map(
          (verb) => verb.id,
        ),
      ),
    [plan.myRole, archived],
  );
  // The two sheets that read the whole mirror mount on first use, not with
  // the page.
  const tripLogMounted = useOnceOpened(tripLogOpen);
  const today = todayDateKey();
  const notice = tripPlanNotice({
    archived: plan.archivedAt != null,
    over: tripPlanIsOver(plan, today),
  });
  const toAnswer = tripPlanFormsToAnswer(plan, today);
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
        eyebrow={TRIP_PLANS_LIST.title}
        title={plan.name}
        titleNumberOfLines={2}
        onBack={onBack}
        actions={
          <IconButton
            icon="overflow"
            accessibilityLabel={copy.actions}
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
    notices:
      // The Forms tab lists the same forms, each marked: no second list there.
      notice || (toAnswer.forms.length > 0 && view !== "forms") ? (
        <View style={styles.notice}>
          {notice?.kind === "over" ? (
            // A prompt that opens something is a pressable row, as every
            // other thing here that opens something.
            <Row
              icon={notice.icon}
              title={notice.text}
              titleNumberOfLines={3}
              subtitle={planVerbLabel("tripLog")}
              onPress={() => setTripLogOpen(true)}
            />
          ) : notice ? (
            <Notice icon={notice.icon}>{notice.text}</Notice>
          ) : (
            // Nothing gates on a form: this only nudges, in the warning tone
            // from a week before the trip.
            <Row
              icon="form"
              hue={toAnswer.urgent ? theme.warning : assetHue.plan}
              // A card with its own controls fills like one (UX §4); a press
              // on its body goes to the forms.
              onPress={() => onView("forms")}
              title={tripPlanFormsToAnswerLine(toAnswer.forms.length)}
              subtitle={online ? undefined : OFFLINE}
              footer={
                <View style={styles.pills}>
                  {toAnswer.forms.map((form) => (
                    <Button
                      key={form.id}
                      label={form.title}
                      compact
                      variant="outlineAccent"
                      disabled={!online}
                      disabledReason={OFFLINE}
                      onPress={() =>
                        setFormSheet({ formId: form.id, mode: "answer" })
                      }
                    />
                  ))}
                </View>
              }
            />
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
          me={myId}
          onInfo={notify}
          onError={(text) => notify(text, "error")}
          onDrawRoute={() => onDrawRoute(plan.id)}
        />
      ) : null,
    forms:
      view === "forms" ? (
        <>
          <Forms
            plan={plan}
            me={myId}
            toAnswer={new Set(toAnswer.forms.map((form) => form.id))}
            onOpen={(formId, mode) => setFormSheet({ formId, mode })}
          />
          {adds.has("form") ? (
            <ListEnd>
              <Button
                label={planAddVerbLabel("form")}
                icon="add"
                variant="outlineAccent"
                disabled={!online || plan.forms.length >= TRIP_PLAN_MAX_FORMS}
                disabledReason={
                  online
                    ? tripPlanAtMost(TRIP_PLAN_MAX_FORMS, "forms")
                    : OFFLINE
                }
                onPress={() => setFormBuilder({ mode: "new" })}
              />
            </ListEnd>
          ) : null}
        </>
      ) : null,
    people:
      view === "people" ? (
        <PeopleView
          plan={plan}
          myId={myId}
          onSeeAnswers={(formId) => setFormSheet({ formId, mode: "read" })}
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
        me={myId}
        onDownloadMap={onDownloadMap}
        onClose={() => setMenuOpen(false)}
        onEdit={() => setEditOpen(true)}
        onTripLog={() => setTripLogOpen(true)}
        onInfo={notify}
        onError={(text) => notify(text, "error")}
        onGone={onGone}
        onLeaving={onLeaving}
      />
      {tripLogMounted ? (
        <PlanTripLogSheet
          plan={tripLogOpen ? plan : null}
          online={online}
          onClose={() => setTripLogOpen(false)}
          // A toast only: the form closes itself after Log trip, and an
          // attribute added inside it saves without closing it.
          onSaved={(text, tone) => notify(text, tone)}
        />
      ) : null}
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
        me={myId}
        online={online}
        onState={setFormSheet}
        onInfo={notify}
        onError={notifyError}
        onEdit={(formId) => setFormBuilder({ mode: "edit", formId })}
      />
      <FormBuilderSheet
        state={adds.has("form") ? formBuilder : null}
        plan={plan}
        online={online}
        onState={setFormBuilder}
        onInfo={notify}
      />
      <Toast message={toast} onDismissed={() => setToast(null)} />
    </View>
  );
}

/** True from the first time `open` is, for sheets that cost a mirror read. */
function useOnceOpened(open: boolean): boolean {
  const [seen, setSeen] = useState(open);
  if (open && !seen) setSeen(true);
  return seen || open;
}

/** Above the scroll: the title and its ⋯. The notices, dates and tabs scroll
 *  with the content, so a tall nudge never eats the page. */
const PINNED: readonly SectionKeysOn<typeof TRIP_PLAN_PAGE, "gps">[] = ["hero"];

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
    <ListEnd>
      {addButton}
      {online ? null : <Text style={styles.offline}>{OFFLINE}</Text>}
    </ListEnd>
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
                accessibilityLabel={tripPlanActionsFor(section.title)}
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
  me,
  onInfo,
  onError,
  onDrawRoute,
}: {
  plan: TripPlanView;
  online: boolean;
  /** The caller may Add a place or way (and it's live). */
  canAdd: boolean;
  /** The caller's user id: a member changes only what they added. */
  me: string | null;
  onInfo: (message: string, tone?: "info" | "error") => void;
  onError: (message: string) => void;
  onDrawRoute: () => void;
}) {
  const theme = useTheme();
  const [saving, setSaving] = useState<SaveCopyTarget | null>(null);
  const [adding, setAdding] = useState(false);
  const addingMounted = useOnceOpened(adding);
  const styles = useStyles();
  // The button only dims: the words go under it (ui/Button.tsx).
  const add = canAdd ? (
    <ListEnd>
      <Button
        label={planAddVerbLabel("copy")}
        icon="add"
        variant="outlineAccent"
        disabled={!online}
        disabledReason={OFFLINE}
        onPress={() => setAdding(true)}
      />
      <Button
        label={copy.drawRoute}
        icon="route"
        variant="outlineAccent"
        disabled={!online}
        disabledReason={OFFLINE}
        onPress={onDrawRoute}
      />
      {online ? null : <Text style={styles.offline}>{OFFLINE}</Text>}
      {addingMounted ? (
        <AddCopySheet
          plan={plan}
          visible={adding}
          online={online}
          me={me}
          onClose={() => setAdding(false)}
          onDone={onInfo}
        />
      ) : null}
    </ListEnd>
  ) : null;
  const [menuItem, setMenuItem] = useState<TripPlanItem | null>(null);
  /** The item's ⋯ (`PlanItemSheet`): its row's trailing control. */
  const menu = (item: TripPlanItem) =>
    // A leader's own item on an archived plan has no verb: no ⋯.
    planItemVerbs(
      plan.myRole,
      { kind: item.kind, mine: item.addedBy?.id === me },
      { archived: plan.archivedAt != null },
    ).filter((verb) => verb.id !== "download").length === 0 ? undefined : (
      <IconButton
        icon="overflow"
        accessibilityLabel={tripPlanActionsFor(itemTitle(item))}
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
        item={liveItem(plan, menuItem) ? menuItem : null}
        current={liveItem(plan, menuItem)}
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

/** An item as the plan now has it; null once it is gone. */
function liveItem(
  plan: TripPlanView,
  item: TripPlanItem | null,
): TripPlanItem | null {
  if (!item) return null;
  const rows: readonly TripPlanItem[] =
    item.kind === "place"
      ? plan.places
      : item.kind === "route"
        ? plan.routes
        : plan.files;
  return rows.find((each) => each.id === item.id) ?? null;
}

function Forms({
  plan,
  me,
  toAnswer,
  onOpen,
}: {
  plan: TripPlanView;
  /** The caller's user id, for a leader's tally. */
  me: string | null;
  /** The forms the page's nudge counts (`tripPlanFormsToAnswer`): only those
   *  wear "Not answered", so an archived or finished plan marks none. */
  toAnswer: ReadonlySet<string>;
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
  return plan.forms.map((form) => {
    const tally = me ? tripPlanFormTally(plan, form, me) : null;
    const pending = toAnswer.has(form.id);
    return (
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
          pending || tally ? (
            <FormFooter pending={pending} tally={tally} me={me} />
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
    );
  });
}

/** Under a form's line: whether the caller still owes it, and a leader's
 *  tally with who hasn't. The pills sit under the line: beside the ⋯ they
 *  squeezed the title. */
function FormFooter({
  pending,
  tally,
  me,
}: {
  pending: boolean;
  tally: ReturnType<typeof tripPlanFormTally>;
  me: string | null;
}) {
  const styles = useStyles();
  return (
    <View style={styles.formFooter}>
      {pending ? (
        <View style={styles.pills}>
          <StatusPill label={copy.pillNotAnswered} tone="warning" />
        </View>
      ) : null}
      {tally
        ? tripPlanFormTallyLines(tally, me ?? undefined).map((line) => (
            <Text key={line} style={styles.age}>
              {line}
            </Text>
          ))
        : null}
    </View>
  );
}

const useStyles = makeStyles((theme, textRole) => ({
  screen: { flex: 1, backgroundColor: theme.page },
  formFooter: { gap: spacing(0.5) },
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
