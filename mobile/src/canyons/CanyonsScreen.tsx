// Canyons — the tick list. Answers "what have I done, and what's left?" before
// any row appears, then gets out of the way of the two jobs people actually
// open this screen for: pick something for this weekend, or find one canyon by
// name.
//
// Built on the DESIGN.md skeleton (pinned hero + pinned filter rail + scrolling
// list + one sheet), same as Saved and Logs. The rail's four buckets are a true
// partition — every canyon is one of All/To do/Done/Shared — so it never hides
// a row behind a combination the user has to reason about.
//
// Filtering shares the web panel's predicate (`passesCanyonFilters` in
// shared/): the web's twelve axes are cut here to the ones that decide a
// Saturday (grade, commitment, quality, hours, rope length) because a phone
// screen full of controls is a worse tool than a short one that fits.
//
// PRIVACY: rows carry names, grades, tallies — never coordinates or any derived
// location detail (DESIGN.md §11). Nothing here is logged, and the failure paths
// print our own copy rather than an error string that might embed a canyon name.
import { memo, useCallback, useMemo, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  Keyboard,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import {
  activeCanyonFilterCount,
  CANYON_RANGE_BOUNDS,
  canyonMatchesSearch,
  compareCanyons,
  distinctTripTypes,
  EMPTY_CANYON_FILTERS,
  passesCanyonFilters,
  type CanyonFilters,
  type CanyonSortKey,
} from "@logjam/shared";

import { canyonHue, fontSize, fontWeight, radius, spacing, surface, theme, withAlpha } from "../theme";
import type { MirrorCanyon } from "../sync/mirrorStore";
import { deleteCanyonLocal } from "../sync/outbox";
import { useConnectivity } from "../map/connectivity";
import {
  useMirrorCanyons,
  useMirrorShareCounts,
  useMirrorTrips,
  usePendingSyncCount,
  useSyncStatus,
} from "../sync/useSyncQueries";
import {
  BottomSheet,
  Button,
  CapacityBar,
  Chip,
  HeroHeader,
  IconButton,
  LoadingState,
  ErrorState,
  RangePills,
  Row,
  SectionHeader,
  SegmentedControl,
  StatusPill,
  Toast,
  Toggle,
  type CapacitySegment,
  type NumberRange,
  type SegmentOption,
  type ToastMessage,
} from "../ui";
import { TripEditSheet } from "../logs/TripEditSheet";
import { CanyonEditSheet } from "./CanyonEditSheet";
import { CANYON_STATUS_META, canyonStatus, canyonSummary, qualityLabel, type CanyonStatus } from "./canyonMeta";

type Bucket = "all" | CanyonStatus;

/** A canyon plus the tallies the shared predicate reads off `_count`. */
type Countable = MirrorCanyon & { _count?: { tripLogLinks: number; shares: number } };

const SORTS: { key: CanyonSortKey; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "recent", label: "Recently added" },
  { key: "grade", label: "Easiest first" },
  { key: "quality", label: "Best rated" },
];

/** Rope length and daylight — the two logistics questions worth a preset. Each
 * is the strict "Less than" the shared predicate implements, so the label says
 * "under" and means it. */
const ROPE_PRESETS = [20, 30, 45, 60];
const HOURS_PRESETS = [4, 6, 8];

export function CanyonsScreen({
  onOpenCanyon,
  onShowOnMap,
  onPickOnMap,
}: {
  onOpenCanyon: (canyon: MirrorCanyon) => void;
  /** Focuses the map on one canyon (a tight bbox around its point). */
  onShowOnMap: (canyon: MirrorCanyon) => void;
  /** Opens the map so the user can press and hold where the canyon is. */
  onPickOnMap: () => void;
}) {
  const connectivity = useConnectivity();
  const online = connectivity === "online";
  const pendingCount = usePendingSyncCount();
  const query = useMirrorCanyons();
  const tripsQuery = useMirrorTrips();
  const shareCounts = useMirrorShareCounts();
  const syncStatus = useSyncStatus();
  const canyons = useMemo(() => query.data ?? [], [query.data]);
  const trips = useMemo(() => tripsQuery.data ?? [], [tripsQuery.data]);

  const [bucket, setBucket] = useState<Bucket>("all");
  const [findOpen, setFindOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<CanyonFilters>(EMPTY_CANYON_FILTERS);
  const [sort, setSort] = useState<CanyonSortKey>("name");
  const [sheet, setSheet] = useState<"filters" | "add" | null>(null);
  const [menuCanyonId, setMenuCanyonId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ canyon: MirrorCanyon | null } | null>(null);
  const [loggingFor, setLoggingFor] = useState<MirrorCanyon | null>(null);
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

  // Sheets don't outlive the tab (DESIGN.md §7).
  const closeSheets = useCallback(() => {
    setSheet(null);
    setMenuCanyonId(null);
    setEditing(null);
    setLoggingFor(null);
  }, []);
  useFocusEffect(closeSheets);

  // The viewer's OWN trip tally per canyon, derived locally from the mirrored
  // trips — the server's `_count` never reaches the mirror. Trips of others
  // never reach it either, so a shared canyon naturally tallies zero.
  const tripCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const trip of trips) {
      for (const link of trip.canyons) {
        counts.set(link.id, (counts.get(link.id) ?? 0) + 1);
      }
    }
    return counts;
  }, [trips]);

  const shares = shareCounts.data;
  // `_count` is attached for owned canyons only. On a canyon shared WITH the
  // viewer these counts are the owner's and are deliberately unknowable here —
  // absent is the honest value, and passing zeros would let the "shared by me"
  // filter answer a question about someone else's fan-out.
  const countable = useMemo<Countable[]>(
    () =>
      canyons.map((canyon) =>
        canyon.syncRole === "owner"
          ? {
              ...canyon,
              _count: {
                tripLogLinks: tripCounts.get(canyon.id) ?? 0,
                shares: shares?.[canyon.id] ?? 0,
              },
            }
          : canyon,
      ),
    [canyons, shares, tripCounts],
  );

  const matchesSearchAndFilters = useCallback(
    (canyon: Countable) =>
      canyonMatchesSearch(canyon, search) &&
      passesCanyonFilters(canyon, filters, canyon.syncRole === "owner"),
    [filters, search],
  );

  const statusOf = useCallback(
    (canyon: MirrorCanyon) => canyonStatus(canyon, tripCounts.get(canyon.id) ?? 0),
    [tripCounts],
  );

  const visible = useMemo(
    () =>
      countable
        .filter(
          (canyon) =>
            matchesSearchAndFilters(canyon) &&
            (bucket === "all" || statusOf(canyon) === bucket),
        )
        .sort((a, b) => compareCanyons(a, b, sort)),
    [bucket, countable, matchesSearchAndFilters, sort, statusOf],
  );

  // Tallies come from the OTHER axes only, so a chip's count answers "how many
  // would I get if I tapped this" rather than restating the current view.
  const withoutBucket = useMemo(
    () => countable.filter(matchesSearchAndFilters),
    [countable, matchesSearchAndFilters],
  );
  const bucketCounts = useMemo(() => {
    const counts: Record<CanyonStatus, number> = { done: 0, todo: 0, shared: 0 };
    for (const canyon of withoutBucket) counts[statusOf(canyon)] += 1;
    return counts;
  }, [statusOf, withoutBucket]);

  // The hero's answer, over the WHOLE collection rather than the filtered view:
  // "how far through my list am I" is a fact about the list, not about the
  // filter I happen to be holding.
  const totals = useMemo(() => {
    const counts: Record<CanyonStatus, number> = { done: 0, todo: 0, shared: 0 };
    for (const canyon of canyons) counts[statusOf(canyon)] += 1;
    return counts;
  }, [canyons, statusOf]);

  const bucketOptions: SegmentOption<Bucket>[] = useMemo(
    () => [
      { value: "all", label: "All", count: withoutBucket.length },
      ...(["todo", "done", "shared"] as CanyonStatus[]).map((status) => ({
        value: status,
        label: CANYON_STATUS_META[status].label,
        icon: CANYON_STATUS_META[status].icon,
        hue: CANYON_STATUS_META[status].hue,
        count: bucketCounts[status],
        // A bucket the other axes have emptied stays in place but isn't a tap
        // into a dead end. Never removed: a rail that reshuffles under the
        // thumb on every keystroke is worse than a greyed chip.
        disabled: bucketCounts[status] === 0 && bucket !== status,
      })),
    ],
    [bucket, bucketCounts, withoutBucket.length],
  );

  const heroSegments: CapacitySegment[] = useMemo(
    () => [
      { label: "Done", value: totals.done, color: canyonHue.done, display: String(totals.done) },
      { label: "To do", value: totals.todo, color: canyonHue.todo, display: String(totals.todo) },
      {
        label: "Shared",
        value: totals.shared,
        color: canyonHue.shared,
        display: String(totals.shared),
      },
    ],
    [totals],
  );

  // The trip form's type vocabulary, so logging from here offers the same
  // chips as logging from the Logs tab.
  const tripTypes = useMemo(() => distinctTripTypes(trips), [trips]);

  const filterCount = activeCanyonFilterCount(filters);
  const filtering = filterCount > 0 || search.trim() !== "";
  const menuCanyon = canyons.find((canyon) => canyon.id === menuCanyonId) ?? null;

  // Stable identities so the memoised rows never re-render for a state change
  // that has nothing to do with them (DESIGN.md §9).
  const openCanyon = useCallback((canyon: MirrorCanyon) => onOpenCanyon(canyon), [onOpenCanyon]);
  const openMenu = useCallback((canyon: MirrorCanyon) => setMenuCanyonId(canyon.id), []);
  const keyExtractor = useCallback((canyon: MirrorCanyon) => canyon.id, []);
  const renderItem = useCallback(
    ({ item }: { item: Countable }) => (
      <CanyonRow
        canyon={item}
        status={statusOf(item)}
        sharedWith={item._count?.shares ?? 0}
        onOpen={openCanyon}
        onMenu={openMenu}
      />
    ),
    [openCanyon, openMenu, statusOf],
  );

  const clearFind = useCallback(() => {
    setSearch("");
    setFindOpen(false);
  }, []);

  const resetFilters = useCallback(() => setFilters(EMPTY_CANYON_FILTERS), []);

  const setRange = useCallback(
    (axis: keyof typeof CANYON_RANGE_BOUNDS, next: NumberRange | null) => {
      setFilters((current) => ({ ...current, [axis]: next }));
    },
    [],
  );

  const setThreshold = useCallback(
    (key: "longest_pitch" | "hours", value: number | null) => {
      setFilters((current) => ({
        ...current,
        [key]: value == null ? null : (["Less than", value] as const),
      }));
    },
    [],
  );

  const confirmDelete = useCallback(
    (canyon: MirrorCanyon) => {
      setMenuCanyonId(null);
      const linked = tripCounts.get(canyon.id) ?? 0;
      Alert.alert(
        `Delete ${canyon.name}?`,
        [
          "The canyon, its notes and its photos are removed from this device and from your account.",
          linked > 0
            ? `${linked} logged ${linked === 1 ? "trip" : "trips"} will stay, but lose the link to it.`
            : null,
          "This can't be undone.",
        ]
          .filter(Boolean)
          .join(" "),
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => {
              deleteCanyonLocal(canyon.id)
                .then(() => info("Canyon deleted."))
                .catch((err: unknown) => {
                  console.error(err);
                  fail("Couldn't delete this canyon.");
                });
            },
          },
        ],
      );
    },
    [fail, info, tripCounts],
  );

  if (query.loading && canyons.length === 0) return <LoadingState />;
  if (query.error && canyons.length === 0) {
    return <ErrorState message={query.error} onRetry={query.refresh} />;
  }

  return (
    <View style={styles.screen}>
      <HeroHeader
        eyebrow="Canyons"
        title={canyons.length === 1 ? "1 canyon" : `${canyons.length} canyons`}
        action={
          <View style={styles.heroActions}>
            <IconButton
              icon="search"
              accessibilityLabel={findOpen ? "Hide search" : "Search canyons"}
              color={search.trim() !== "" ? theme.accent : theme.textMuted}
              filled={search.trim() !== ""}
              onPress={() => (findOpen ? clearFind() : setFindOpen(true))}
            />
            <Button label="Add" icon="plus" compact onPress={() => setSheet("add")} />
          </View>
        }
      >
        {/* One slot, two uses: the tick-list meter is the answer you came for,
            and the search row replaces it in place so opening search doesn't
            shove the list down (DESIGN.md §2). */}
        {findOpen ? (
          <View style={styles.findRow}>
            <View style={styles.searchWrap}>
              <Feather name="search" size={16} color={theme.textMuted} />
              <TextInput
                style={styles.searchInput}
                value={search}
                onChangeText={setSearch}
                placeholder="Canyon or alternative name"
                placeholderTextColor={theme.textMuted}
                accessibilityLabel="Search by canyon or alternative name"
                autoCapitalize="none"
                autoFocus
                returnKeyType="search"
              />
            </View>
            <IconButton
              icon="sliders"
              accessibilityLabel="Sort and filter"
              color={filterCount > 0 ? theme.accent : theme.textMuted}
              filled={filterCount > 0}
              onPress={() => {
                // Drop the keyboard BEFORE the sheet mounts: a sheet opening
                // over a live IME inherits the shrunk frame and stops short of
                // the bottom edge.
                Keyboard.dismiss();
                setSheet("filters");
              }}
            />
            <IconButton icon="x" accessibilityLabel="Clear search" onPress={clearFind} />
          </View>
        ) : (
          <View style={styles.meterRow}>
            <View style={styles.meter}>
              <CapacityBar segments={heroSegments} />
            </View>
            <IconButton
              icon="sliders"
              accessibilityLabel="Sort and filter"
              color={filterCount > 0 ? theme.accent : theme.textMuted}
              filled={filterCount > 0}
              onPress={() => setSheet("filters")}
            />
          </View>
        )}

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
        <SegmentedControl scroll options={bucketOptions} value={bucket} onChange={setBucket} />
      </View>

      {/* An active hidden filter has to announce itself, with the way out in
          reach (DESIGN.md §2). */}
      {filterCount > 0 ? (
        <View style={styles.filterNote}>
          <Text style={styles.filterText} numberOfLines={1}>
            {filterCount === 1 ? "1 filter active" : `${filterCount} filters active`}
            {sort === "name" ? "" : ` · ${SORTS.find((s) => s.key === sort)?.label}`}
          </Text>
          <IconButton
            icon="x"
            size={16}
            accessibilityLabel="Clear all filters"
            onPress={resetFilters}
          />
        </View>
      ) : null}

      <FlatList
        style={styles.list}
        contentContainerStyle={styles.listContent}
        data={visible}
        keyExtractor={keyExtractor}
        // A NSW canyon list runs to several hundred rows. The defaults keep ~21
        // screens mounted, which makes every state change re-render the lot.
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
            bucket={bucket}
            filtering={filtering}
            onAdd={() => setSheet("add")}
            onClear={() => {
              clearFind();
              resetFilters();
              setBucket("all");
            }}
          />
        }
        renderItem={renderItem}
      />

      {/* Per-canyon actions, titled with the canyon so a mis-tap can't destroy
          the wrong one. */}
      <BottomSheet
        visible={menuCanyon !== null}
        onClose={() => setMenuCanyonId(null)}
        title={menuCanyon?.name ?? ""}
      >
        {menuCanyon ? (
          <View style={styles.sheetBody}>
            <Row
              icon="book-open"
              title="Open canyon"
              onPress={() => {
                const canyon = menuCanyon;
                setMenuCanyonId(null);
                onOpenCanyon(canyon);
              }}
            />
            <Row
              icon="map"
              title="Show on map"
              onPress={() => {
                const canyon = menuCanyon;
                setMenuCanyonId(null);
                onShowOnMap(canyon);
              }}
            />
            <Row
              icon="edit-3"
              title="Log a trip here"
              onPress={() => {
                const canyon = menuCanyon;
                setMenuCanyonId(null);
                setLoggingFor(canyon);
              }}
            />
            {menuCanyon.syncRole === "owner" ? (
              <>
                <Row
                  icon="edit-2"
                  title="Edit canyon"
                  onPress={() => {
                    const canyon = menuCanyon;
                    setMenuCanyonId(null);
                    setEditing({ canyon });
                  }}
                />
                <Row
                  icon="trash-2"
                  hue={theme.warning}
                  title="Delete canyon"
                  onPress={() => confirmDelete(menuCanyon)}
                />
              </>
            ) : null}
          </View>
        ) : null}
      </BottomSheet>

      {/* How a canyon gets in. Both routes end in the same form; the difference
          is only where the coordinates come from. Sharing a canyon and picking
          it on the map both live on the canyon itself, not here. */}
      <BottomSheet
        visible={sheet === "add"}
        onClose={() => setSheet(null)}
        title="Add a canyon"
      >
        <View style={styles.sheetBody}>
          <Row
            icon="edit-3"
            title="Enter it by hand"
            subtitle="Name, position, grade — whatever you know"
            onPress={() => {
              setSheet(null);
              setEditing({ canyon: null });
            }}
          />
          <Row
            icon="map"
            title="Pick it on the map"
            subtitle="Press and hold the spot, then choose Add canyon"
            onPress={() => {
              setSheet(null);
              onPickOnMap();
            }}
          />
        </View>
      </BottomSheet>

      <BottomSheet
        visible={sheet === "filters"}
        onClose={() => setSheet(null)}
        title="Sort & filter"
        footer={<Button label="Done" icon="check" onPress={() => setSheet(null)} />}
      >
        <View style={styles.sheetBody}>
          <SectionHeader label="Sort" />
          <View style={styles.chipRow}>
            {SORTS.map((option) => (
              <Chip
                key={option.key}
                label={option.label}
                active={sort === option.key}
                onPress={() => setSort(option.key)}
              />
            ))}
          </View>

          <SectionHeader label="Grade" />
          <RangePills
            label="Vertical"
            prefix="V"
            bounds={CANYON_RANGE_BOUNDS.v_grade}
            value={filters.v_grade as NumberRange | null}
            onChange={(next) => setRange("v_grade", next)}
          />
          <RangePills
            label="Aquatic"
            prefix="A"
            bounds={CANYON_RANGE_BOUNDS.a_grade}
            value={filters.a_grade as NumberRange | null}
            onChange={(next) => setRange("a_grade", next)}
          />
          <RangePills
            label="Commitment"
            bounds={CANYON_RANGE_BOUNDS.commitment}
            value={filters.commitment as NumberRange | null}
            onChange={(next) => setRange("commitment", next)}
          />
          <RangePills
            label="Quality"
            bounds={CANYON_RANGE_BOUNDS.quality}
            value={filters.quality as NumberRange | null}
            onChange={(next) => setRange("quality", next)}
          />

          <SectionHeader label="Fits the day" />
          <PresetRow
            label="Longest abseil"
            unit="m"
            presets={ROPE_PRESETS}
            value={filters.longest_pitch?.[1] ?? null}
            onChange={(next) => setThreshold("longest_pitch", next)}
          />
          <PresetRow
            label="Time out"
            unit="h"
            presets={HOURS_PRESETS}
            value={filters.hours?.[1] ?? null}
            onChange={(next) => setThreshold("hours", next)}
          />

          <SectionHeader label="Gaps in the data" />
          <Row
            icon="help-circle"
            title="Include canyons missing this data"
            subtitle="Most imported canyons have no recorded grade"
            right={
              <Toggle
                value={filters.include_unknowns}
                accessibilityLabel="Include canyons missing the filtered data"
                onValueChange={(next) =>
                  setFilters((current) => ({ ...current, include_unknowns: next }))
                }
              />
            }
          />

          {filterCount > 0 ? (
            <Button label="Reset filters" variant="outlineAccent" onPress={resetFilters} />
          ) : null}
        </View>
      </BottomSheet>

      <CanyonEditSheet
        visible={editing !== null}
        canyon={editing?.canyon ?? null}
        onClose={() => setEditing(null)}
        onSaved={info}
        onFailed={fail}
      />

      {/* Logging from a canyon: the same trip form, with this canyon already
          linked — the shortcut for the actual sequence (run it, then log it). */}
      <TripEditSheet
        online={online}
        visible={loggingFor !== null}
        canyons={canyons}
        initialCanyons={
          loggingFor ? [{ id: loggingFor.id, name: loggingFor.name }] : undefined
        }
        existingTypes={tripTypes}
        onClose={() => setLoggingFor(null)}
        onSaved={info}
        onFailed={fail}
      />

      <Toast message={toast} onDismissed={() => setToast(null)} />
    </View>
  );
}

// Memoised: the list holds hundreds of these, and a hero or rail state change
// must not re-render a row whose canyon is untouched. Handlers take the canyon
// back rather than closing over it, so their identity stays stable.
const CanyonRow = memo(function CanyonRow({
  canyon,
  status,
  sharedWith,
  onOpen,
  onMenu,
}: {
  canyon: MirrorCanyon;
  status: CanyonStatus;
  sharedWith: number;
  onOpen: (canyon: MirrorCanyon) => void;
  onMenu: (canyon: MirrorCanyon) => void;
}) {
  const meta = CANYON_STATUS_META[status];
  const quality = qualityLabel(canyon.quality);
  return (
    <Row
      icon={meta.icon}
      hue={meta.hue}
      title={canyon.name}
      titleNumberOfLines={2}
      subtitle={canyonSummary(canyon) || undefined}
      onPress={() => onOpen(canyon)}
      right={
        <View style={styles.rowTrailing}>
          {quality ? <Text style={styles.quality}>{quality}</Text> : null}
          {sharedWith > 0 ? (
            <View style={styles.badge}>
              <Feather name="users" size={12} color={theme.textMuted} />
              <Text style={styles.badgeText}>{sharedWith}</Text>
            </View>
          ) : null}
          <IconButton
            icon="more-vertical"
            accessibilityLabel={`Actions for ${canyon.name}`}
            onPress={() => onMenu(canyon)}
          />
        </View>
      }
    />
  );
});

/** A "no more than N" threshold as presets. The shared predicate's operator is
 * a strict `<`, so the labels say "under" rather than implying an inclusive
 * bound the filter doesn't apply. */
function PresetRow({
  label,
  unit,
  presets,
  value,
  onChange,
}: {
  label: string;
  unit: string;
  presets: number[];
  value: number | null;
  onChange: (next: number | null) => void;
}) {
  return (
    <View style={styles.presetBlock}>
      <Text style={styles.presetLabel}>{label}</Text>
      <View style={styles.chipRow}>
        {presets.map((preset) => (
          <Chip
            key={preset}
            label={`Under ${preset} ${unit}`}
            active={value === preset}
            onPress={() => onChange(value === preset ? null : preset)}
          />
        ))}
      </View>
    </View>
  );
}

/** Per-bucket empty states: an empty tick list, an exhausted one and an
 * over-tight filter are three different problems with three different ways out
 * (DESIGN.md §8). */
function EmptyPanel({
  bucket,
  filtering,
  onAdd,
  onClear,
}: {
  bucket: Bucket;
  filtering: boolean;
  onAdd: () => void;
  onClear: () => void;
}) {
  const copy = filtering
    ? {
        icon: "filter" as const,
        title: "No canyons match",
        body: "Nothing in this search and filter. Widen it to see the rest — or turn on “include canyons missing this data”, which hides most imported canyons when a grade filter is set.",
      }
    : bucket === "done"
      ? {
          icon: "check-circle" as const,
          title: "Nothing ticked off yet",
          body: "A canyon lands here once you log a trip that links to it.",
        }
      : bucket === "shared"
        ? {
            icon: "users" as const,
            title: "Nothing shared with you",
            body: "Canyons a friend shares appear here, with their notes and photos. You share yours from the canyon itself.",
          }
        : bucket === "todo"
          ? {
              icon: "map-pin" as const,
              title: "Your list is clear",
              body: "Every canyon you own has a logged trip against it. Add another and it lands here.",
            }
          : {
              icon: "map-pin" as const,
              title: "No canyons yet",
              body: "Add the ones you want to run, or import your list on the web. Everything here works with no signal once it has synced.",
            };
  return (
    <View style={styles.empty}>
      <Feather name={copy.icon} size={28} color={withAlpha(theme.accent, 0.8)} />
      <Text style={styles.emptyTitle}>{copy.title}</Text>
      <Text style={styles.emptyBody}>{copy.body}</Text>
      {filtering ? (
        <Button label="Clear filters" variant="outlineAccent" onPress={onClear} />
      ) : bucket === "all" || bucket === "todo" ? (
        <Button label="Add a canyon" icon="plus" onPress={onAdd} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.primary },
  heroActions: { flexDirection: "row", alignItems: "center", gap: spacing(0.5) },
  statusRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing(0.75) },
  meterRow: { flexDirection: "row", alignItems: "center", gap: spacing(1) },
  meter: { flex: 1 },
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
  filterNote: {
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
  filterText: { flex: 1, color: theme.textPrimary, fontSize: fontSize.sm },
  list: { flex: 1 },
  listContent: { paddingHorizontal: spacing(2), paddingBottom: spacing(4), gap: spacing(1) },
  rowTrailing: { flexDirection: "row", alignItems: "center", gap: spacing(0.75) },
  quality: { color: theme.textMuted, fontSize: fontSize.xs },
  badge: { flexDirection: "row", alignItems: "center", gap: spacing(0.25) },
  badgeText: { color: theme.textMuted, fontSize: fontSize.xs },
  sheetBody: { gap: spacing(1) },
  sheetHint: { color: theme.textMuted, fontSize: fontSize.sm },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing(0.75) },
  presetBlock: { gap: spacing(0.75) },
  presetLabel: {
    color: theme.textPrimary,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
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
  emptyBody: { color: theme.textMuted, fontSize: fontSize.sm, textAlign: "center" },
});
