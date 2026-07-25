// Logs — the logbook. Answers "what have I done?" before anything else: a
// count, a twelve-month activity spark, and a chronological list grouped by
// year. Built on the DESIGN.md skeleton (pinned hero + pinned filter rail +
// scrolling list + one sheet), same as Saved.
//
// The four filter axes match the web Trip Logs panel and share its predicate
// (`filterTrips` in shared/). Type is the rail — the axis you flick between —
// while text and date range live in a "find" row that stays collapsed until
// asked for, so the resting screen is a logbook and not a search console.
//
// PRIVACY: rows carry canyon names, dates and user notes — data the mirror
// already holds on this device. None of it is logged, and the failure paths
// here print our own copy rather than an error string that might embed a
// canyon name.
import { memo, useCallback, useMemo, useRef, useState } from "react";
import {
  Alert,
  Keyboard,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import {
  distinctTripTypes,
  filterTrips,
  hasActiveTripFilter,
  NO_TYPE_FILTER_VALUE,
} from "@logjam/shared";

import { tripTitle } from "../api/tripTitle";
import { fontSize, fontWeight, radius, spacing, surface, theme, withAlpha } from "../theme";
import type { MirrorTrip } from "../sync/mirrorStore";
import { deleteTripLocal } from "../sync/outbox";
import { useConnectivity } from "../map/connectivity";
import {
  useMirrorCanyons,
  useMirrorMediaCounts,
  useMirrorTrips,
  usePendingSyncCount,
  useSyncStatus,
} from "../sync/useSyncQueries";
import {
  ActivitySpark,
  BottomSheet,
  Button,
  Chip,
  DatePicker,
  ErrorState,
  HeroHeader,
  IconButton,
  LoadingState,
  Row,
  SectionHeader,
  SegmentedControl,
  StatusPill,
  Toast,
  type SegmentOption,
  type ToastMessage,
} from "../ui";
import {
  countTripsInLastMonths,
  distinctCanyonCount,
  formatDateKey,
  formatTripDate,
  groupTripsByYear,
  monthlyTripCounts,
} from "./logbook";
import { primaryTripType, tripTypeLabel, tripTypeMeta } from "./tripTypeMeta";
import { TripEditSheet } from "./TripEditSheet";

const ALL_TYPES = "";

export function LogsScreen({ onOpenTrip }: { onOpenTrip: (trip: MirrorTrip) => void }) {
  const connectivity = useConnectivity();
  const online = connectivity === "online";
  const pendingCount = usePendingSyncCount();
  const query = useMirrorTrips();
  const canyonsQuery = useMirrorCanyons();
  const attachmentCounts = useMirrorMediaCounts("tripLog");
  const syncStatus = useSyncStatus();
  // Memoised so the many derived useMemos below don't recompute on every render.
  const trips = useMemo(() => query.data ?? [], [query.data]);

  const [typeFilter, setTypeFilter] = useState<string>(ALL_TYPES);
  const [findOpen, setFindOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState<string | null>(null);
  const [dateTo, setDateTo] = useState<string | null>(null);
  const [dateMode, setDateMode] = useState<"presets" | "from" | "to" | null>(null);
  const [menuTripId, setMenuTripId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ trip: MirrorTrip | null } | null>(null);
  // One toast channel for every async outcome on the screen (DESIGN.md §6).
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const toastNonce = useRef(0);
  const info = useCallback((text: string) => {
    toastNonce.current += 1;
    setToast({ text, tone: "info", nonce: toastNonce.current });
  }, []);
  const fail = useCallback((text: string) => {
    toastNonce.current += 1;
    setToast({ text, tone: "error", nonce: toastNonce.current });
  }, []);

  // Sheets don't outlive the tab: coming back to a half-open editor is a stale
  // prompt, not a resumed task (DESIGN.md §7).
  const closeSheets = useCallback(() => {
    setMenuTripId(null);
    setEditing(null);
    setDateMode(null);
  }, []);
  useFocusEffect(closeSheets);

  const criteria = useMemo(
    () => ({
      search,
      dateFrom: dateFrom ?? undefined,
      dateTo: dateTo ?? undefined,
      type: typeFilter,
    }),
    [dateFrom, dateTo, search, typeFilter],
  );
  const visible = useMemo(() => filterTrips(trips, criteria), [criteria, trips]);
  const sections = useMemo(
    () =>
      groupTripsByYear(visible).map((group) => ({
        title: `${group.year}`,
        count: group.trips.length,
        data: group.trips,
      })),
    [visible],
  );

  // Tallies come from the OTHER axes only, so a chip's count answers "how many
  // would I get if I tapped this" rather than "how many are showing now".
  const withoutType = useMemo(
    () => filterTrips(trips, { ...criteria, type: ALL_TYPES }),
    [criteria, trips],
  );
  const distinctTypes = useMemo(() => distinctTripTypes(trips), [trips]);
  const typeOptions: SegmentOption<string>[] = useMemo(() => {
    const distinct = distinctTypes;
    // Existence is decided by the whole set, the count by the other axes — so
    // this chip behaves like the type chips instead of vanishing when a search
    // empties it.
    const anyUntyped = trips.some((trip) => trip.types.length === 0);
    const untyped = withoutType.filter((trip) => trip.types.length === 0).length;
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
          hue: tripTypeMeta(type).hue,
          icon: tripTypeMeta(type).icon,
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
              hue: tripTypeMeta(null).hue,
              count: untyped,
              disabled: untyped === 0 && typeFilter !== NO_TYPE_FILTER_VALUE,
            },
          ]
        : []),
    ];
  }, [distinctTypes, trips, typeFilter, withoutType]);

  const spark = useMemo(() => monthlyTripCounts(trips, new Date()), [trips]);
  const recentCount = useMemo(() => countTripsInLastMonths(trips, new Date()), [trips]);
  const canyonCount = useMemo(() => distinctCanyonCount(trips), [trips]);

  const menuTrip = trips.find((trip) => trip.id === menuTripId) ?? null;
  const filtering = hasActiveTripFilter(criteria);
  const rangeSet = dateFrom != null || dateTo != null;

  // Stable identities so the memoised rows below never re-render on a state
  // change that has nothing to do with them.
  const openTrip = useCallback((trip: MirrorTrip) => onOpenTrip(trip), [onOpenTrip]);
  const openMenu = useCallback((trip: MirrorTrip) => setMenuTripId(trip.id), []);
  const keyExtractor = useCallback((trip: MirrorTrip) => trip.id, []);
  const counts = attachmentCounts.data;
  const renderItem = useCallback(
    ({ item }: { item: MirrorTrip }) => (
      <TripRow
        trip={item}
        attachments={counts?.[item.id] ?? 0}
        onOpen={openTrip}
        onMenu={openMenu}
      />
    ),
    [counts, openMenu, openTrip],
  );
  const renderSectionHeader = useCallback(
    ({ section }: { section: { title: string; count: number } }) => (
      <View style={styles.yearHeader}>
        <Text style={styles.yearLabel}>{section.title}</Text>
        <Text style={styles.yearCount}>
          {section.count === 1 ? "1 trip" : `${section.count} trips`}
        </Text>
      </View>
    ),
    [],
  );

  const clearFind = useCallback(() => {
    setSearch("");
    setDateFrom(null);
    setDateTo(null);
    setFindOpen(false);
  }, []);

  const confirmDelete = useCallback(
    (trip: MirrorTrip) => {
      setMenuTripId(null);
      Alert.alert(
        "Delete this trip?",
        "The log entry and its photos are removed from this device and from your account. This can't be undone.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => {
              deleteTripLocal(trip.id)
                .then(() => info("Trip deleted."))
                .catch((err) => {
                  console.error(err);
                  fail("Couldn't delete this trip.");
                });
            },
          },
        ],
      );
    },
    [fail, info],
  );

  if (query.loading && trips.length === 0) return <LoadingState />;
  if (query.error && trips.length === 0) {
    return <ErrorState message={query.error} onRetry={query.refresh} />;
  }

  return (
    <View style={styles.screen}>
      <HeroHeader
        eyebrow="Logbook"
        title={trips.length === 1 ? "1 trip" : `${trips.length} trips`}
        action={
          <View style={styles.heroActions}>
            <IconButton
              icon="search"
              accessibilityLabel={findOpen ? "Hide search" : "Search trips"}
              color={filtering ? theme.accent : theme.textMuted}
              filled={filtering}
              onPress={() => (findOpen ? clearFind() : setFindOpen(true))}
            />
            <Button
              label="Log trip"
              icon="plus"
              compact
              onPress={() => setEditing({ trip: null })}
            />
          </View>
        }
      >
        {/* One slot, two uses: the spark is retrospective decoration you don't
            need while hunting for a trip, and swapping in place keeps the hero
            a constant height instead of shoving the list down. */}
        {findOpen ? (
          <View style={styles.findRow}>
            <View style={styles.searchWrap}>
              <Feather name="search" size={16} color={theme.textMuted} />
              <TextInput
                style={styles.searchInput}
                value={search}
                onChangeText={setSearch}
                placeholder="Canyon or trip name"
                placeholderTextColor={theme.textMuted}
                accessibilityLabel="Search by canyon or trip name"
                autoCapitalize="none"
                autoFocus
                returnKeyType="search"
              />
            </View>
            <IconButton
              icon="calendar"
              accessibilityLabel="Filter by date range"
              color={rangeSet ? theme.accent : theme.textMuted}
              filled={rangeSet}
              onPress={() => {
                // Drop the keyboard BEFORE the sheet mounts: a sheet that opens
                // over a live IME inherits KeyboardAvoidingView's shrunk frame
                // and stops short of the bottom edge, leaving a stripe of the
                // tab bar showing under it.
                Keyboard.dismiss();
                setDateMode("presets");
              }}
            />
            <IconButton
              icon="x"
              accessibilityLabel="Clear filters and close search"
              onPress={clearFind}
            />
          </View>
        ) : (
          <ActivitySpark
            buckets={spark}
            caption={`${recentCount} in the last 12 months · ${canyonCount} ${
              canyonCount === 1 ? "canyon" : "canyons"
            }`}
          />
        )}

        {/* State of the world, once, where it can be read at a glance. Offline
            is not an error here — logging, editing and attaching all work — so
            it is paired with what is waiting rather than with a warning. */}
        {!online || pendingCount > 0 ? (
          <View style={styles.statusRow}>
            {online ? null : <StatusPill label="Offline" tone="muted" icon="cloud-off" />}
            {pendingCount > 0 ? (
              <StatusPill
                label={`${pendingCount} waiting to sync`}
                tone="outline"
                icon="upload-cloud"
              />
            ) : null}
          </View>
        ) : null}
      </HeroHeader>

      <View style={styles.rail}>
        <SegmentedControl
          scroll
          options={typeOptions}
          value={typeFilter}
          onChange={setTypeFilter}
        />
      </View>

      {rangeSet ? (
        <View style={styles.rangeNote}>
          <Text style={styles.rangeText} numberOfLines={1}>
            {rangeLabel(dateFrom, dateTo)}
          </Text>
          <IconButton
            icon="x"
            size={16}
            accessibilityLabel="Clear the date range"
            onPress={() => {
              setDateFrom(null);
              setDateTo(null);
            }}
          />
        </View>
      ) : null}

      <SectionList
        style={styles.list}
        contentContainerStyle={styles.listContent}
        sections={sections}
        keyExtractor={keyExtractor}
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
                info("No connection — your changes will sync when you're back.");
                return;
              }
              query.refresh();
            }}
            tintColor={theme.accent}
          />
        }
        ListEmptyComponent={
          <EmptyPanel
            filtering={filtering || typeFilter !== ALL_TYPES}
            onLogTrip={() => setEditing({ trip: null })}
            onClear={() => {
              clearFind();
              setTypeFilter(ALL_TYPES);
            }}
          />
        }
        renderSectionHeader={renderSectionHeader}
        renderItem={renderItem}
      />

      {/* Per-trip actions, titled with the trip so a mis-tap can't destroy the
          wrong one. */}
      <BottomSheet
        visible={menuTrip !== null}
        onClose={() => setMenuTripId(null)}
        title={menuTrip ? tripTitle(menuTrip) : ""}
      >
        {menuTrip ? (
          <View style={styles.sheetBody}>
            <Row
              icon="book-open"
              title="Open trip"
              onPress={() => {
                const trip = menuTrip;
                setMenuTripId(null);
                onOpenTrip(trip);
              }}
            />
            <Row
              icon="edit-2"
              title="Edit trip"
              onPress={() => {
                const trip = menuTrip;
                setMenuTripId(null);
                setEditing({ trip });
              }}
            />
            <Row
              icon="trash-2"
              hue={theme.warning}
              title="Delete trip"
              onPress={() => confirmDelete(menuTrip)}
            />
          </View>
        ) : null}
      </BottomSheet>

      {/* Date range: presets first (what people actually pick), with the
          calendar as a mode of this same sheet rather than a second one. */}
      <BottomSheet
        visible={dateMode !== null}
        // A calendar mode backs out to the presets, not out of the sheet.
        onClose={() => setDateMode(dateMode === "presets" ? null : "presets")}
        title={
          dateMode === "from" ? "From" : dateMode === "to" ? "To" : "Date range"
        }
        footer={
          dateMode === "presets" ? (
            <Button label="Done" icon="check" onPress={() => setDateMode(null)} />
          ) : (
            <Button
              label="Clear this bound"
              variant="outlineAccent"
              onPress={() => {
                if (dateMode === "from") setDateFrom(null);
                else setDateTo(null);
                setDateMode("presets");
              }}
            />
          )
        }
      >
        {dateMode === "presets" ? (
          <View style={styles.sheetBody}>
            <View style={styles.presets}>
              {datePresets().map((preset) => (
                <Chip
                  key={preset.label}
                  label={preset.label}
                  active={dateFrom === preset.from && dateTo === preset.to}
                  onPress={() => {
                    setDateFrom(preset.from);
                    setDateTo(preset.to);
                  }}
                />
              ))}
            </View>
            <SectionHeader label="Exact range" />
            <Row
              icon="calendar"
              title={dateFrom ? formatDateKey(`${dateFrom}T00:00:00.000Z`) : "Any time"}
              subtitle="From"
              onPress={() => setDateMode("from")}
            />
            <Row
              icon="calendar"
              title={dateTo ? formatDateKey(`${dateTo}T00:00:00.000Z`) : "Today"}
              subtitle="To"
              onPress={() => setDateMode("to")}
            />
          </View>
        ) : null}
        {dateMode === "from" || dateMode === "to" ? (
          <DatePicker
            value={dateMode === "from" ? dateFrom : dateTo}
            onChange={(key) => {
              if (dateMode === "from") setDateFrom(key);
              else setDateTo(key);
              setDateMode("presets");
            }}
          />
        ) : null}
      </BottomSheet>

      <TripEditSheet
        online={online}
        visible={editing !== null}
        trip={editing?.trip ?? null}
        canyons={canyonsQuery.data ?? []}
        existingTypes={distinctTypes}
        onClose={() => setEditing(null)}
        onSaved={info}
        onFailed={fail}
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
}: {
  trip: MirrorTrip;
  attachments: number;
  onOpen: (trip: MirrorTrip) => void;
  onMenu: (trip: MirrorTrip) => void;
}) {
  const meta = tripTypeMeta(primaryTripType(trip.types));
  return (
    <Row
      icon={meta.icon}
      hue={meta.hue}
      title={tripTitle(trip)}
      titleNumberOfLines={2}
      subtitle={[
        formatTripDate(trip.date),
        trip.canyons.length > 1 ? `${trip.canyons.length} canyons` : null,
      ]
        .filter(Boolean)
        .join(" · ")}
      onPress={() => onOpen(trip)}
      right={
        <View style={styles.rowTrailing}>
          {/* What is IN this entry, each glyph labelled by its own count where
              a count means something. A bare "+2" (it used to mean extra trip
              types) reads as an unexplained number — the extra types are
              already implied by the rail and shown in full on the trip. */}
          {attachments > 0 ? (
            <View style={styles.badge}>
              <Feather name="paperclip" size={12} color={theme.textMuted} />
              <Text style={styles.badgeText}>{attachments}</Text>
            </View>
          ) : null}
          {trip.notes ? (
            <Feather
              name="align-left"
              size={14}
              color={theme.textMuted}
              accessibilityLabel="Has notes"
            />
          ) : null}
          <IconButton
            icon="more-vertical"
            accessibilityLabel={`Actions for ${tripTitle(trip)}`}
            onPress={() => onMenu(trip)}
          />
        </View>
      }
    />
  );
});

/** Per-state empty panel: nothing logged yet is a different problem from a
 * filter that excludes everything, and each has its own way out. */
function EmptyPanel({
  filtering,
  onLogTrip,
  onClear,
}: {
  filtering: boolean;
  onLogTrip: () => void;
  onClear: () => void;
}) {
  return (
    <View style={styles.empty}>
      <Feather
        name={filtering ? "filter" : "book-open"}
        size={28}
        color={withAlpha(theme.accent, 0.8)}
      />
      <Text style={styles.emptyTitle}>
        {filtering ? "No trips match" : "Your logbook is empty"}
      </Text>
      <Text style={styles.emptyBody}>
        {filtering
          ? "Nothing in this type, date range or search. Widen it to see the rest."
          : "Log a trip and it lands here — date, canyons, notes and photos, all readable with no signal."}
      </Text>
      {filtering ? (
        <Button label="Clear filters" variant="outlineAccent" onPress={onClear} />
      ) : (
        <Button label="Log your first trip" icon="plus" onPress={onLogTrip} />
      )}
    </View>
  );
}

function rangeLabel(from: string | null, to: string | null): string {
  const start = from ? formatDateKey(`${from}T00:00:00.000Z`) : "Any time";
  const end = to ? formatDateKey(`${to}T00:00:00.000Z`) : "today";
  return `${start} → ${end}`;
}

/** The ranges people actually ask for, relative to now. */
function datePresets(): { label: string; from: string; to: string }[] {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const year = now.getUTCFullYear();
  const twelveMonths = new Date(
    Date.UTC(year, now.getUTCMonth() - 11, 1),
  )
    .toISOString()
    .slice(0, 10);
  return [
    { label: "This year", from: `${year}-01-01`, to: today },
    { label: "Last 12 months", from: twelveMonths, to: today },
    { label: `${year - 1}`, from: `${year - 1}-01-01`, to: `${year - 1}-12-31` },
  ];
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.primary },
  heroActions: { flexDirection: "row", alignItems: "center", gap: spacing(0.5) },
  statusRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing(0.75) },
  findRow: { flexDirection: "row", alignItems: "center", gap: spacing(0.5) },
  searchWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(1),
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: withAlpha(theme.accent, 0.4),
    backgroundColor: withAlpha(theme.primary, 0.5),
    paddingHorizontal: spacing(1.5),
    minHeight: 40,
  },
  searchInput: {
    flex: 1,
    color: theme.textPrimary,
    fontSize: fontSize.base,
    fontWeight: fontWeight.regular,
  },
  // The rail's bottom pad is the gap the list scrolls against (DESIGN.md §2).
  rail: { paddingLeft: spacing(2), paddingTop: spacing(1.5), paddingBottom: spacing(1.5) },
  rangeNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(1),
    marginHorizontal: spacing(2),
    marginBottom: spacing(1),
    paddingLeft: spacing(1.5),
    paddingRight: spacing(0.5),
    borderRadius: radius.pill,
    backgroundColor: withAlpha(theme.accent, 0.12),
  },
  rangeText: { flex: 1, color: theme.textPrimary, fontSize: fontSize.sm },
  list: { flex: 1 },
  listContent: { paddingHorizontal: spacing(2), paddingBottom: spacing(4), gap: spacing(1) },
  // Sticky, so a long scroll always says which year you are reading. Opaque:
  // rows pass underneath it.
  yearHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    backgroundColor: theme.primary,
    paddingTop: spacing(1),
    paddingBottom: spacing(0.75),
  },
  yearLabel: {
    color: theme.textPrimary,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
  },
  yearCount: { color: theme.textMuted, fontSize: fontSize.xs },
  rowTrailing: { flexDirection: "row", alignItems: "center", gap: spacing(0.5) },
  badge: { flexDirection: "row", alignItems: "center", gap: spacing(0.25) },
  badgeText: { color: theme.textMuted, fontSize: fontSize.xs },
  sheetBody: { gap: spacing(1) },
  presets: { flexDirection: "row", flexWrap: "wrap", gap: spacing(1) },
  empty: {
    alignItems: "center",
    gap: spacing(1),
    paddingVertical: spacing(5),
    paddingHorizontal: spacing(2),
    backgroundColor: surface.card,
    borderWidth: 1,
    borderColor: surface.border,
    borderRadius: radius.lg,
  },
  emptyTitle: {
    color: theme.textPrimary,
    fontSize: fontSize.base,
    fontWeight: fontWeight.medium,
  },
  emptyBody: {
    color: theme.textMuted,
    fontSize: fontSize.sm,
    textAlign: "center",
  },
});
