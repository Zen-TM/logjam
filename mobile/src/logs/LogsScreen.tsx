// Logs — the logbook. Answers "what have I done?" before anything else: a
// count, a twelve-month activity spark, and a chronological list grouped by
// year. Built on the DESIGN.md skeleton (pinned hero + pinned filter rail +
// scrolling list + one sheet), same as Saved.
//
// The four filter axes match Logjam Web's Trip Logs panel and share its
// predicate (`filterTrips` in shared/). Type is the rail, the axis you flick
// between; text is the bar under it; the rest is the filter sheet.
//
// PRIVACY: rows carry place names, dates and user notes — data the mirror
// already holds on this device. None of it is logged, and the failure paths
// here print our own copy rather than an error string that might embed a
// place name.
import {
  Fragment,
  memo,
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Keyboard,
  RefreshControl,
  SectionList,
  Text,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import {
  activeTripFilterCount,
  countTripsInLastMonths,
  dateRangeLabel,
  distinctPlaceCount,
  distinctTripTypes,
  filterTrips,
  formatTripDate,
  groupTripsByYear,
  contractSectionKeys,
  hasActiveTripFilter,
  listSelectionLabel,
  monthlyTripCounts,
  NO_TYPE_FILTER_VALUE,
  reconcileCustomFieldFilters,
  sortTrips,
  TRIP_SORT_OPTIONS,
  tripDeleteConfirm,
  tripsEmptyKind,
  tripsEmptyState,
  tripsFilterNote,
  tripsHeroTitle,
  TRIPS_ADD,
  TRIPS_ADD_ICON,
  TRIPS_FILTER_SHEET,
  TRIPS_LIST,
  tripFilterFieldDefs,
  type CustomFieldFilter,
  type SectionKeysOn,
  type TripSortKey,
  tripTitle,
} from "@logjam/shared";

import {
  radius,
  spacing,
  withAlpha,
  makeStyles,
  useTheme,
  muted,
  wash,
} from "../theme";
import type { MirrorTrip } from "../sync/mirrorStore";
import { deleteTripLocal } from "../sync/outbox";
import { useAccountState } from "../auth/AccountStateContext";
import { useConnectivity } from "../map/connectivity";
import {
  useMirrorPlaces,
  useMirrorMediaCounts,
  useMirrorTrips,
  usePendingSyncCount,
  useSyncStatus,
} from "../sync/useSyncQueries";
import {
  ActivitySpark,
  Button,
  ErrorState,
  Hero,
  ListEnd,
  IconButton,
  LoadingState,
  Row,
  ChipRail,
  SelectionBar,
  SearchField,
  SyncStatusPills,
  Toast,
  confirm,
  useBulkSelection,
  type ChipOption,
  type ToastMessage,
  Icon,
  EmptyState,
} from "../ui";
import { useFieldDefs } from "../customFields/useFieldDefs";
import { primaryTripType, tripTypeLabel, tripTypeMeta } from "./tripTypeMeta";
import { TripEditSheet } from "./TripEditSheet";
import { useStoredSort } from "../sortPreference";
import { LogsFilterSheet } from "./LogsFilterSheet";
import { TripOptionsSheet } from "./TripOptionsSheet";

const ALL_TYPES = "";

export function LogsScreen({
  onOpenTrip,
  onOpenStats,
}: {
  onOpenTrip: (trip: MirrorTrip) => void;
  onOpenStats: () => void;
}) {
  const theme = useTheme();
  const styles = useStyles();

  const connectivity = useConnectivity();
  const online = connectivity === "online";
  const guest = useAccountState().accountState === "guest";
  const pendingCount = usePendingSyncCount();
  const query = useMirrorTrips();
  const placesQuery = useMirrorPlaces();
  const attachmentCounts = useMirrorMediaCounts("tripLog");
  const syncStatus = useSyncStatus();
  // Memoised so the many derived useMemos below don't recompute on every render.
  const trips = useMemo(() => query.data ?? [], [query.data]);

  const [typeFilter, setTypeFilter] = useState<string>(ALL_TYPES);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState<string | null>(null);
  const [dateTo, setDateTo] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  // Attribute filters live and die with the screen, like every other filter
  // here: they are never persisted, so a month-old filter can't greet the user
  // as missing trips. The sort is a preference and outlives it.
  const [customFilters, setCustomFilters] = useState<
    Record<string, CustomFieldFilter>
  >({});
  const [includeUnknowns, setIncludeUnknowns] = useState(false);
  const [sort, setSort] = useStoredSort<TripSortKey>(
    "trips",
    TRIP_SORT_OPTIONS.map((option) => option.key),
    "newest",
  );
  const { defs: tripDefs } = useFieldDefs("tripLog");
  const [menuTripId, setMenuTripId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ trip: MirrorTrip | null } | null>(
    null,
  );
  // One toast channel for every async outcome on the screen (DESIGN.md).
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const toastNonce = useRef(0);
  const info = useCallback((text: string) => {
    toastNonce.current += 1;
    setToast({ text, tone: "done", nonce: toastNonce.current });
  }, []);
  const fail = useCallback((text: string) => {
    toastNonce.current += 1;
    setToast({ text, tone: "error", nonce: toastNonce.current });
  }, []);

  // Sheets don't outlive the tab: coming back to a half-open editor is a stale
  // prompt, not a resumed task (DESIGN.md).
  const closeSheets = useCallback(() => {
    setMenuTripId(null);
    setEditing(null);
    setSheetOpen(false);
  }, []);
  useFocusEffect(closeSheets);

  const criteria = useMemo(
    () => ({
      search,
      dateFrom: dateFrom ?? undefined,
      dateTo: dateTo ?? undefined,
      type: typeFilter,
      custom: customFilters,
      includeUnknowns,
    }),
    [dateFrom, dateTo, search, typeFilter, customFilters, includeUnknowns],
  );
  const visible = useMemo(
    () => sortTrips(filterTrips(trips, criteria), sort),
    [criteria, trips, sort],
  );
  const yearSections = useMemo(
    () =>
      // The year headings run the way the trips inside them do, or "Oldest
      // first" reads bottom-to-top.
      groupTripsByYear(visible, sort).map((group) => ({
        title: `${group.year}`,
        count: group.trips.length,
        data: group.trips,
      })),
    [visible, sort],
  );

  // The attributes worth OFFERING as filters follow the activity chip, the
  // way a place's follow its type (`tripFilterFieldDefs`).
  const filterableDefs = useMemo(
    () => tripFilterFieldDefs(tripDefs, trips, typeFilter),
    [trips, tripDefs, typeFilter],
  );

  // A filter whose definition was deleted, or retyped under it, would narrow
  // the list with no control left in the sheet to say so or undo it.
  const [reconciledDefs, setReconciledDefs] = useState(filterableDefs);
  if (reconciledDefs !== filterableDefs) {
    setReconciledDefs(filterableDefs);
    setCustomFilters(
      reconcileCustomFieldFilters(customFilters, filterableDefs),
    );
  }

  // --- Multi-select ---------------------------------------------------------
  // Press and hold a row to start; the rail's type chips become the
  // cancel / select-all / delete bar (see SavedScreen, the reference). Every
  // trip is deletable, so nothing is greyed out while selecting.
  const {
    selectedKeys,
    clearSelection,
    selectItem,
    selectAll,
    selectedItems,
    selectableItems,
    selecting,
  } = useBulkSelection({
    items: visible,
    keyOf: (trip) => trip.id,
    isDeletable: () => true,
  });
  // A selection is a transient mode over rows you can see; a pending "delete
  // these five" you no longer remember making is a stale prompt (DESIGN.md).
  useFocusEffect(
    useCallback(() => {
      clearSelection();
    }, [clearSelection]),
  );

  const deleteSelected = useCallback(async () => {
    const targets = selectedItems;
    const count = targets.length;
    if (
      !(await confirm({
        ...tripDeleteConfirm(count),
        confirmLabel: "Delete",
        tone: "destructive",
      }))
    )
      return;
    let failures = 0;
    for (const trip of targets) {
      try {
        await deleteTripLocal(trip.id);
      } catch (err) {
        console.error(err);
        failures += 1;
      }
    }
    clearSelection();
    if (failures === 0)
      info(`Deleted ${count} ${count === 1 ? "trip" : "trips"}.`);
    else fail(`${failures} of ${count} couldn't be deleted.`);
  }, [selectedItems, clearSelection, fail, info]);

  // Tallies come from the OTHER axes only, so a chip's count answers "how many
  // would I get if I tapped this" rather than "how many are showing now".
  const withoutType = useMemo(
    () => filterTrips(trips, { ...criteria, type: ALL_TYPES }),
    [criteria, trips],
  );
  const distinctTypes = useMemo(() => distinctTripTypes(trips), [trips]);
  const typeOptions: ChipOption<string>[] = useMemo(() => {
    const distinct = distinctTypes;
    // Existence is decided by the whole set, the count by the other axes — so
    // this chip behaves like the type chips instead of vanishing when a search
    // empties it.
    const anyUntyped = trips.some((trip) => trip.types.length === 0);
    const untyped = withoutType.filter(
      (trip) => trip.types.length === 0,
    ).length;
    return [
      { value: ALL_TYPES, label: "All", count: withoutType.length },
      // Busiest activity first: the rail's left end is the reachable end, and
      // a logbook's answer to "which of these do I actually do" is the tally.
      // Ties break alphabetically so the order is stable, not arbitrary.
      ...distinct
        .map((type) => ({
          type,
          count: withoutType.filter((trip) => trip.types.includes(type)).length,
        }))
        .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type))
        .map(({ type, count }) => ({
          value: type,
          label: tripTypeLabel(type),
          hue: tripTypeMeta(type, theme).hue,
          icon: tripTypeMeta(type, theme).icon,
          count,
          // A chip the other filters have emptied stays in place but can't be
          // tapped into a dead end — removing it instead would make the rail
          // shuffle under the thumb on every keystroke.
          disabled: count === 0 && typeFilter !== type,
        })),
      ...(anyUntyped
        ? [
            {
              value: NO_TYPE_FILTER_VALUE,
              label: "No type",
              hue: tripTypeMeta(null, theme).hue,
              count: untyped,
              disabled: untyped === 0 && typeFilter !== NO_TYPE_FILTER_VALUE,
            },
          ]
        : []),
    ];
  }, [distinctTypes, trips, typeFilter, withoutType, theme]);

  const spark = useMemo(() => monthlyTripCounts(trips, new Date()), [trips]);
  const recentCount = useMemo(
    () => countTripsInLastMonths(trips, new Date()),
    [trips],
  );
  const placeCount = useMemo(() => distinctPlaceCount(trips), [trips]);

  const menuTrip = trips.find((trip) => trip.id === menuTripId) ?? null;
  const filtering = hasActiveTripFilter(criteria);
  const rangeSet = dateFrom != null || dateTo != null;
  // What the SHEET owns — the search box and the type rail show their own state
  // where they stand, so the sheet's button speaks only for the rest.
  const sheetFilterCount =
    activeTripFilterCount(criteria) -
    (search.trim() ? 1 : 0) -
    (typeFilter ? 1 : 0);

  // Stable identities so the memoised rows below never re-render on a state
  // change that has nothing to do with them.
  const openTrip = useCallback(
    (trip: MirrorTrip) => onOpenTrip(trip),
    [onOpenTrip],
  );
  const openMenu = useCallback(
    (trip: MirrorTrip) => setMenuTripId(trip.id),
    [],
  );
  const keyExtractor = useCallback((trip: MirrorTrip) => trip.id, []);
  const counts = attachmentCounts.data;
  const renderItem = useCallback(
    ({ item }: { item: MirrorTrip }) => (
      <TripRow
        trip={item}
        attachments={counts?.[item.id] ?? 0}
        onOpen={openTrip}
        onMenu={openMenu}
        selecting={selecting}
        selected={selectedKeys.includes(item.id)}
        onToggle={() => selectItem(item)}
      />
    ),
    [counts, openMenu, openTrip, selecting, selectedKeys, selectItem],
  );
  const renderSectionHeader = useCallback(
    ({ section }: { section: { title: string; count: number } }) => (
      <View style={styles.yearHeader}>
        <Text style={styles.yearLabel}>{section.title}</Text>
        <Text style={styles.yearCount}>{section.count}</Text>
      </View>
    ),
    [styles],
  );

  /** Everything the sheet owns. The sort is a preference, not a filter, so it
   *  survives a Reset — clearing it would move the list for someone who only
   *  asked to see all their trips again. */
  const clearSheetFilters = useCallback(() => {
    setDateFrom(null);
    setDateTo(null);
    setCustomFilters({});
    setIncludeUnknowns(false);
  }, []);

  if (query.loading && trips.length === 0)
    return <LoadingState label={TRIPS_LIST.copy.loading} />;
  if (query.error && trips.length === 0) {
    return <ErrorState message={query.error} onRetry={query.refresh} />;
  }

  const copy = TRIPS_LIST.copy;
  const note = tripsFilterNote({
    rangeLabel: rangeSet ? dateRangeLabel(dateFrom, dateTo) : null,
    sheetFilterCount,
    sort,
  });
  const emptyState = tripsEmptyState(tripsEmptyKind({ total: trips.length }), {
    platform: "gps",
    guest,
  });

  // The page, section by section, in the order its contract gives. Exhaustive
  // by type: a section the contract names cannot be left out, and one it does
  // not name cannot be drawn.
  const sections: Record<SectionKeysOn<typeof TRIPS_LIST, "gps">, ReactNode> = {
    hero: (
      <Hero
        eyebrow="Trips"
        title={tripsHeroTitle(trips.length)}
        actions={
          <View style={styles.heroActions}>
            {/* The retrospective lives one tap away rather than on this screen:
                Logs answers "what have I done?", stats answers "am I getting
                out, and is it going anywhere?" — two questions, so two screens
                (shared/DESIGN.md §2). */}
            <IconButton
              icon="stats"
              accessibilityLabel={copy.stats}
              color={theme.textMuted}
              onPress={onOpenStats}
            />
            <IconButton
              icon="filter"
              accessibilityLabel={TRIPS_FILTER_SHEET.title}
              color={sheetFilterCount > 0 ? theme.accent : theme.textMuted}
              filled={sheetFilterCount > 0}
              onPress={() => {
                // Drop the keyboard BEFORE the sheet mounts: a sheet that opens
                // over a live IME inherits KeyboardAvoidingView's shrunk frame
                // and stops short of the bottom edge, leaving a stripe of the
                // tab bar showing under it.
                Keyboard.dismiss();
                setSheetOpen(true);
              }}
            />
            {/* One way in, so a button: Logjam Web's menu holds this and an
                import (`TRIPS_ADD`). */}
            <Button
              label={TRIPS_ADD.copy.add}
              icon={TRIPS_ADD_ICON.add}
              compact
              onPress={() => setEditing({ trip: null })}
            />
          </View>
        }
      >
        <ActivitySpark
          buckets={spark}
          caption={`${recentCount} in the last 12 months · ${placeCount} ${
            placeCount === 1 ? "place" : "places"
          }`}
        />

        {/* State of the world, once, where it can be read at a glance. Offline
            is not an error here — logging, editing and attaching all work — so
            it is paired with what is waiting rather than with a warning. */}
        <SyncStatusPills online={online} pendingCount={pendingCount} />
      </Hero>
    ),

    typeRail: (
      <View style={styles.rail}>
        {selecting ? (
          <SelectionBar
            countLabel={listSelectionLabel(selectedItems.length)}
            showSelectAll={selectedItems.length < selectableItems.length}
            onClear={clearSelection}
            onSelectAll={selectAll}
            onDelete={() => void deleteSelected()}
          />
        ) : (
          <ChipRail
            scroll
            options={typeOptions}
            value={typeFilter}
            onChange={setTypeFilter}
          />
        )}
      </View>
    ),

    search:
      trips.length > 0 ? (
        <View style={styles.search}>
          <SearchField
            label={copy.search}
            value={search}
            onChangeText={setSearch}
            // As on Saved: narrowing mid-selection would drop a picked row.
            editable={!selecting}
          />
        </View>
      ) : null,

    // The hidden filters, said out loud: the rail and the search box show
    // their own state where they stand, so this speaks only for what the
    // closed sheet is doing (DESIGN.md).
    filterNote:
      note != null && !selecting ? (
        <View style={styles.rangeNote}>
          <Text style={styles.rangeText} numberOfLines={1}>
            {note}
          </Text>
          {sheetFilterCount > 0 ? (
            <IconButton
              icon="close"
              size={16}
              accessibilityLabel={copy.clearFilters}
              onPress={clearSheetFilters}
            />
          ) : null}
        </View>
      ) : null,

    list: (
      <SectionList
        style={styles.list}
        contentContainerStyle={styles.listContent}
        sections={yearSections}
        keyExtractor={keyExtractor}
        keyboardShouldPersistTaps="handled"
        // A logbook is append-only and long. The defaults keep roughly 21
        // screens of rows mounted, which for a few hundred trips means EVERY
        // row re-renders on any state change — tapping the search icon was
        // paying for 100+ row renders. Narrow the window and let the memoised
        // rows below skip the rest.
        initialNumToRender={12}
        maxToRenderPerBatch={8}
        windowSize={5}
        removeClippedSubviews
        refreshControl={
          <RefreshControl
            refreshing={syncStatus.state === "syncing"}
            onRefresh={() => {
              if (!online) {
                info("Offline — changes sync when you're back.");
                return;
              }
              query.refresh();
            }}
            tintColor={theme.accent}
          />
        }
        ListFooterComponent={
          // The list ends with the button its empty state offers.
          trips.length > 0 && !filtering ? (
            <ListEnd>
              <Button
                label={TRIPS_ADD.copy.add}
                icon={TRIPS_ADD_ICON.add}
                variant="outlineAccent"
                onPress={() => setEditing({ trip: null })}
              />
            </ListEnd>
          ) : undefined
        }
        ListEmptyComponent={
          <EmptyPanel
            state={emptyState}
            filtering={filtering}
            onLogTrip={() => setEditing({ trip: null })}
            onClear={() => {
              setSearch("");
              clearSheetFilters();
              setTypeFilter(ALL_TYPES);
            }}
          />
        }
        renderSectionHeader={renderSectionHeader}
        renderItem={renderItem}
      />
    ),
  };

  return (
    <View style={styles.screen}>
      {contractSectionKeys(TRIPS_LIST, "gps").map((key) => (
        <Fragment key={key}>{sections[key]}</Fragment>
      ))}

      <TripOptionsSheet
        trip={menuTrip}
        surface="row"
        onClose={() => setMenuTripId(null)}
        onOpen={onOpenTrip}
        onEdit={(trip) => setEditing({ trip })}
        onInfo={info}
        onError={fail}
      />

      <LogsFilterSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        sort={sort}
        onChangeSort={setSort}
        filterableDefs={filterableDefs}
        customFilters={customFilters}
        onChangeCustom={(key, next) =>
          setCustomFilters((current) => {
            const custom = { ...current };
            // Absent rather than present-at-its-default, so "is this axis
            // filtering" stays `key in custom` for every kind.
            if (next == null) delete custom[key];
            else custom[key] = next;
            return custom;
          })
        }
        includeUnknowns={includeUnknowns}
        onChangeIncludeUnknowns={setIncludeUnknowns}
        dateFrom={dateFrom}
        dateTo={dateTo}
        onChangeDates={(from, to) => {
          setDateFrom(from);
          setDateTo(to);
        }}
        onReset={clearSheetFilters}
        activeCount={sheetFilterCount}
      />

      <TripEditSheet
        online={online}
        visible={editing !== null}
        trip={editing?.trip ?? null}
        places={placesQuery.data ?? []}
        existingTypes={distinctTypes}
        onClose={() => setEditing(null)}
        onSaved={info}
      />

      <Toast message={toast} onDismissed={() => setToast(null)} />
    </View>
  );
}

// Memoised: the list holds hundreds of these, and a hero/filter state change
// must not re-render a row whose trip is untouched. Handlers take the trip back
// rather than closing over it, so their identity stays stable across renders.
const TripRow = memo(function TripRow({
  trip,
  attachments,
  onOpen,
  onMenu,
  selecting,
  selected,
  onToggle,
}: {
  trip: MirrorTrip;
  attachments: number;
  onOpen: (trip: MirrorTrip) => void;
  onMenu: (trip: MirrorTrip) => void;
  selecting: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  const theme = useTheme();
  const styles = useStyles();

  const meta = tripTypeMeta(primaryTripType(trip.types), theme);
  return (
    <Row
      icon={meta.icon}
      hue={meta.hue}
      title={tripTitle(trip)}
      titleNumberOfLines={2}
      subtitle={[
        formatTripDate(trip.date),
        trip.places.length > 1 ? `${trip.places.length} places` : null,
      ]
        .filter(Boolean)
        .join(" · ")}
      selected={selected}
      onLongPress={onToggle}
      onPress={selecting ? onToggle : () => onOpen(trip)}
      right={
        <View style={styles.rowTrailing}>
          {/* What is IN this entry, each glyph labelled by its own count where
              a count means something. A bare "+2" reads as an unexplained
              number — the extra types are already implied by the rail and shown
              in full on the trip. */}
          {attachments > 0 ? (
            <View style={styles.badge}>
              <Icon idea="attachment" size={12} color={theme.textMuted} />
              <Text style={styles.badgeText}>{attachments}</Text>
            </View>
          ) : null}
          {trip.notes ? (
            <Icon
              idea="notes"
              size={14}
              color={theme.textMuted}
              label="Has notes"
            />
          ) : null}
          {selecting ? (
            // The ⋯ button's box, holding the checkbox.
            <View style={styles.selectBox}>
              <Icon
                idea={selected ? "success" : "unselected"}
                size={22}
                color={selected ? theme.accent : theme.textMuted}
              />
            </View>
          ) : (
            <IconButton
              icon="overflow"
              accessibilityLabel={`Actions for ${tripTitle(trip)}`}
              onPress={() => onMenu(trip)}
            />
          )}
        </View>
      }
    />
  );
});

/** Per-state empty panel: nothing logged yet is a different problem from a
 * filter that excludes everything, and each has its own way out. What each
 * says is `tripsEmptyState` in `@logjam/shared`. */
function EmptyPanel({
  state,
  filtering,
  onLogTrip,
  onClear,
}: {
  state: ReturnType<typeof tripsEmptyState>;
  filtering: boolean;
  onLogTrip: () => void;
  onClear: () => void;
}) {
  return (
    <EmptyState
      icon={state.icon}
      title={state.title}
      hint={state.body}
      action={
        state.action === "add"
          ? {
              label: TRIPS_ADD.copy.add,
              icon: TRIPS_ADD_ICON.add,
              onPress: onLogTrip,
            }
          : filtering || state.action === "clear"
            ? {
                label: TRIPS_LIST.copy.clearFilters,
                variant: "outlineAccent",
                onPress: onClear,
              }
            : undefined
      }
    />
  );
}

const useStyles = makeStyles((theme, textRole) => ({
  screen: { flex: 1, backgroundColor: theme.page },
  heroActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(0.5),
  },
  // The rail's bottom pad is the gap the list scrolls against (DESIGN.md).
  rail: {
    paddingLeft: spacing(2),
    paddingTop: spacing(1.5),
    paddingBottom: spacing(1.5),
  },
  search: { paddingHorizontal: spacing(2), paddingBottom: spacing(1.5) },
  rangeNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(1),
    marginHorizontal: spacing(2),
    marginBottom: spacing(1),
    paddingLeft: spacing(1.5),
    paddingRight: spacing(0.5),
    borderRadius: radius.pill,
    backgroundColor: withAlpha(theme.accent, wash.selected),
  },
  rangeText: { ...textRole.detail, flex: 1, color: theme.text },
  list: { flex: 1 },
  listContent: {
    paddingHorizontal: spacing(2),
    paddingBottom: spacing(4),
    gap: spacing(1),
  },
  // Sticky, so a long scroll always says which year you are reading. Opaque:
  // rows pass underneath it.
  yearHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    backgroundColor: theme.page,
    paddingTop: spacing(1),
    paddingBottom: spacing(0.5),
  },
  yearLabel: { ...textRole.heading, color: theme.text },
  yearCount: { ...muted(theme, textRole.meta) },
  rowTrailing: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(0.5),
  },
  // IconButton's own box, so the checkbox that stands in for the ⋯ button
  // occupies exactly what it replaced and the row cannot resize on selection.
  selectBox: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: { flexDirection: "row", alignItems: "center", gap: spacing(0.25) },
  badgeText: { ...muted(theme, textRole.meta) },
  sheetBody: { gap: spacing(1) },
  presets: { flexDirection: "row", flexWrap: "wrap", gap: spacing(1) },
}));
