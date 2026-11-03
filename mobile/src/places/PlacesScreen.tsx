// Places — the tick list. Answers "what have I done, and what's left?" before
// any row appears, then gets out of the way of the two jobs people actually
// open this screen for: pick something for this weekend, or find one place by
// name.
//
// Built on the DESIGN.md skeleton (pinned hero + pinned filter rail + scrolling
// list + one sheet), same as Saved and Logs. The status filter in the sheet is
// a true partition, every place is one of Not visited/Visited/Shared, so it
// never hides a row behind a combination the user has to reason about.
//
// WHAT the screen is made of, in what order and under what words is its
// contract (`PLACES_LIST` in `@logjam/shared`), which Logjam Web's Places panel
// renders from too. Filtering shares its predicate (`passesPlaceFilters`).
//
// PRIVACY: rows carry names, grades, tallies — never coordinates or any derived
// location detail (shared/DESIGN.md §13). Nothing here is logged, and the failure paths
// print our own copy rather than an error string that might embed a place name.
import { numericFieldValue } from "@logjam/shared";
import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { FlatList, Keyboard, RefreshControl, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import {
  activePlaceFilterCount,
  placeMatchesSearch,
  comparePlaces,
  PLACE_SORT_OPTIONS,
  contractSectionKeys,
  distinctTripTypes,
  EMPTY_PLACE_FILTERS,
  passesPlaceFilters,
  type PlaceFilters,
  type PlaceSortKey,
  type RegionBbox,
  PLACES_ADD,
  PLACES_ADD_ICON,
  PLACES_FILTER_SHEET,
  PLACES_LIST,
  placeDeleteConfirm,
  placeDeleteDone,
  placesEmptyKind,
  placeTypeHasTab,
  isSystemPlaceTypeId,
  listSelectionLabel,
  placesEmptyState,
  placesFilterNote,
  placesHeroTitle,
  incomingLabel,
  placeStatus,
  placeSummary,
  qualityLabel,
  type PlacesEmptyKind,
  type PlaceStatus,
  type PlaceStatusFilterValue,
  type SectionKeysOn,
} from "@logjam/shared";

import { useAccountState } from "../auth/AccountStateContext";
import {
  radius,
  spacing,
  withAlpha,
  makeStyles,
  useTheme,
  useHues,
  muted,
  wash,
} from "../theme";
import type { MirrorPlace } from "../sync/mirrorStore";
import { useConnectivity } from "../map/connectivity";
import {
  useMirrorPlaces,
  useMirrorPlaceTypes,
  useMirrorIncomingShareOwners,
  useMirrorShareCounts,
  useMirrorTrips,
  usePendingSyncCount,
  useSyncStatus,
} from "../sync/useSyncQueries";
import {
  BottomSheet,
  Meter,
  Hero,
  useHeroCollapse,
  HeroAdd,
  compactHeroTitle,
  Icon,
  IconButton,
  LoadingState,
  ErrorState,
  Row,
  Chip,
  ChipRail,
  SelectionBar,
  SearchField,
  StatusPill,
  SyncStatusPills,
  Toast,
  confirm,
  useBulkSelection,
  type MeterSegment,
  type ChipOption,
  type ToastMessage,
  EmptyState,
} from "../ui";
import { useStoredSort } from "../sortPreference";
import { deletePlaceLocal } from "../sync/outbox";
import { TripEditSheet } from "../logs/TripEditSheet";
import { PlaceEditSheet } from "./PlaceEditSheet";
import { takePickedPoint } from "../map/pickedPoint";
import { setAreaPickerStart, takePickedArea } from "../map/pickedArea";
import { PlaceOptionsSheet } from "./PlaceOptionsSheet";
import { usePlaceTypeForm, type NewPlaceType } from "./PlaceTypesEditor";
import { useTypeAttributesStep } from "../customFields/useTypeAttributesStep";
import { BulkShareButton, BulkShareSheet } from "../sharing/BulkShareSheet";
import { PlaceFilterSheet } from "./PlaceFilterSheet";
import {
  publishVisiblePlaces,
  setPlaceMapFilterEnabled,
  usePlaceMapFilter,
} from "./placeMapFilter";
import { placeStatusMeta } from "./placeMeta";
import { placeTypeGlyph } from "./placeTypeIcon";

const { copy } = PLACES_LIST;

type Bucket = PlaceStatusFilterValue;

/** The type rail's "every type" chip. A sentinel rather than `null`, because
 *  `ChipRail` keys its chips by value. No place type can collide with
 *  it — an id is a UUID. */
const ALL_TYPES = "all";

/** A place plus the tallies the shared predicate reads off `_count`. */
type Countable = MirrorPlace & {
  _count?: { tripLogLinks: number; shares: number };
};

/** The page's name: the full hero's eyebrow and the compact row's title. */
const PAGE_NAME = "Places";

export function PlacesScreen({
  onOpenPlace,
  onShowOnMap,
  onPickPoint,
  onPickArea,
}: {
  onOpenPlace: (place: MirrorPlace) => void;
  /** Focuses the map on one place (a tight bbox around its point). */
  onShowOnMap: (place: MirrorPlace) => void;
  /**
   * Open the full-screen point picker, starting on `from` if the form already
   * holds a coordinate. It hands its answer back through `pickedPoint.ts`,
   * which this screen collects when it regains focus.
   */
  onPickPoint: (from: { latitude: number; longitude: number } | null) => void;
  /**
   * Open the full-screen area picker. Where it opens and what it answers both
   * travel in memory through `pickedArea.ts` rather than through navigation
   * params — a drawn region of places does not go into navigation state.
   */
  onPickArea: () => void;
}) {
  const theme = useTheme();
  const heroCollapse = useHeroCollapse();
  const { placeHue } = useHues();
  const styles = useStyles();

  const connectivity = useConnectivity();
  const online = connectivity === "online";
  const pendingCount = usePendingSyncCount();
  const query = useMirrorPlaces();
  const tripsQuery = useMirrorTrips();
  const shareCounts = useMirrorShareCounts();
  const shareOwners = useMirrorIncomingShareOwners();
  const typesQuery = useMirrorPlaceTypes();
  const syncStatus = useSyncStatus();
  const places = useMemo(() => query.data ?? [], [query.data]);
  const trips = useMemo(() => tripsQuery.data ?? [], [tripsQuery.data]);
  const placeTypes = useMemo(() => typesQuery.data ?? [], [typesQuery.data]);

  const [bucket, setBucket] = useState<Bucket>("all");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<PlaceFilters>(EMPTY_PLACE_FILTERS);
  const [sort, setSort] = useStoredSort<PlaceSortKey>(
    "places",
    PLACE_SORT_OPTIONS.map((option) => option.key),
    "name",
  );
  const [sheet, setSheet] = useState<
    "filters" | "bulkShare" | "placeTypeForm" | "typeAttributes" | null
  >(null);
  const [addedType, setAddedType] = useState<NewPlaceType | null>(null);
  const mapFilter = usePlaceMapFilter();
  const [menuPlaceId, setMenuPlaceId] = useState<string | null>(null);
  /** The sheet owns its own share sub-mode and forgets it on close. */
  const closeMenu = useCallback(() => setMenuPlaceId(null), []);
  const [editing, setEditing] = useState<{ place: MirrorPlace | null } | null>(
    null,
  );
  /**
   * The picker round trip.
   *
   * `resumingEdit` is true from the moment the sheet is closed to make room for
   * the map until the sheet is back on screen — it is what stops the reopen
   * from reseeding the form (see `PlaceEditSheet`). `pickedCoords` is the
   * answer, applied to the two coordinate fields and nothing else.
   */
  const [resumingEdit, setResumingEdit] = useState(false);
  const [pickedCoords, setPickedCoords] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  /** Which place the interrupted edit belonged to (null = a new one). */
  const pendingEditPlace = useRef<MirrorPlace | null>(null);
  /**
   * Away at the picker. A REF as well as the state above, because the two are
   * cleared at different moments: this one the instant we are back (it is
   * control flow), the state only when the sheet finally closes (it is the prop
   * that suppresses the reseed, and clearing it while the sheet is open would
   * wipe the form on the very next render).
   */
  const awayAtPicker = useRef(false);

  const startEditing = useCallback((place: MirrorPlace | null) => {
    // A NEW edit, so the form seeds from scratch: every picker flag off first.
    awayAtPicker.current = false;
    setResumingEdit(false);
    setPickedCoords(null);
    setEditing({ place });
  }, []);

  const openPicker = useCallback(
    (from: { latitude: number; longitude: number } | null) => {
      // The sheet is a Modal and would cover the map, so it has to go — but the
      // component stays mounted, which is what makes the form survive.
      pendingEditPlace.current = editing?.place ?? null;
      awayAtPicker.current = true;
      setResumingEdit(true);
      setEditing(null);
      onPickPoint(from);
    },
    [editing, onPickPoint],
  );

  /**
   * The filter sheet's own round trip to the map, and a separate flag from the
   * edit form's: the two return to different places (a sheet vs a form inside
   * one), and sharing a flag would reopen whichever the user was NOT in.
   */
  const awayAtAreaPicker = useRef(false);
  const openAreaPicker = useCallback(
    (from: RegionBbox | null) => {
      // Same reason the edit sheet has to go: a BottomSheet is a Modal in its
      // own window, so the map would draw behind it and be invisible.
      awayAtAreaPicker.current = true;
      setAreaPickerStart(from);
      setSheet(null);
      onPickArea();
    },
    [onPickArea],
  );

  const [loggingFor, setLoggingFor] = useState<MirrorPlace | null>(null);
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

  // Sheets don't outlive the tab (DESIGN.md) — with ONE exception, and it is
  // the same focus effect because the two must not race: arriving back from the
  // point picker is not "the user came to this tab", it is the second half of
  // something they started here. `takePickedPoint` consumes the answer, so a
  // later ordinary arrival cannot re-apply a coordinate that has since been
  // typed over, and a CANCELLED pick still restores the form — they went to
  // look at a map, not to abandon what they had written.
  const onFocus = useCallback(() => {
    if (awayAtAreaPicker.current) {
      awayAtAreaPicker.current = false;
      const area = takePickedArea();
      // Functional update on purpose: reading `filters` here would put it in
      // this callback's deps, and `useFocusEffect` re-runs whenever the
      // callback's identity changes — every filter tap would replay the whole
      // arrival. A cancelled pick keeps the area that was already set; the user
      // went to look at the map, not to clear the filter.
      if (area) setFilters((current) => ({ ...current, area }));
      setSheet("filters");
      return;
    }
    if (awayAtPicker.current) {
      awayAtPicker.current = false;
      const point = takePickedPoint();
      if (point) setPickedCoords(point);
      setEditing({ place: pendingEditPlace.current });
      return;
    }
    setSheet(null);
    closeMenu();
    setEditing(null);
    setLoggingFor(null);
  }, [closeMenu]);
  useFocusEffect(onFocus);

  // The viewer's OWN trip tally per place, derived locally from the mirrored
  // trips — the server's `_count` never reaches the mirror. Trips of others
  // never reach it either, so a shared place naturally tallies zero.
  const tripCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const trip of trips) {
      for (const link of trip.places) {
        counts.set(link.id, (counts.get(link.id) ?? 0) + 1);
      }
    }
    return counts;
  }, [trips]);

  const shares = shareCounts.data;
  // `_count` is attached for owned places only. On a place shared WITH the
  // viewer these counts are the owner's and are deliberately unknowable here —
  // absent is the honest value, and passing zeros would let the "shared by me"
  // filter answer a question about someone else's fan-out.
  const countable = useMemo<Countable[]>(
    () =>
      places.map((place) =>
        place.syncRole === "owner"
          ? {
              ...place,
              _count: {
                tripLogLinks: tripCounts.get(place.id) ?? 0,
                shares: shares?.[place.id] ?? 0,
              },
            }
          : place,
      ),
    [places, shares, tripCounts],
  );

  const matchesSearchAndFilters = useCallback(
    (place: Countable) =>
      placeMatchesSearch(place, search) &&
      passesPlaceFilters(place, filters, place.syncRole === "owner"),
    [filters, search],
  );

  const statusOf = useCallback(
    (place: MirrorPlace) => placeStatus(place, tripCounts.get(place.id) ?? 0),
    [tripCounts],
  );

  const visible = useMemo(
    () =>
      countable
        .filter(
          (place) =>
            matchesSearchAndFilters(place) &&
            (bucket === "all" || statusOf(place) === bucket),
        )
        .sort((a, b) => comparePlaces(a, b, sort)),
    [bucket, countable, matchesSearchAndFilters, sort, statusOf],
  );

  // --- Multi-select ---------------------------------------------------------
  // Press and hold a row to start; the rail's type chips become the
  // cancel / select-all / delete bar (see SavedScreen, the reference). A shared
  // place is not pickable — deleting is the only thing a selection does, and
  // the owner-only delete gate means a sharee has nothing to be picked for.
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
    keyOf: (place) => place.id,
    isDeletable: (place) => place.syncRole === "owner",
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
    const only = targets.length === 1 ? targets[0] : undefined;
    if (
      !(await confirm(
        placeDeleteConfirm(only ? { name: only.name } : { count }),
      ))
    )
      return;
    let failures = 0;
    for (const place of targets) {
      try {
        await deletePlaceLocal(place.id);
      } catch (err) {
        console.error(err);
        failures += 1;
      }
    }
    clearSelection();
    if (failures === 0) info(placeDeleteDone(count));
    else fail(`${failures} of ${count} couldn't be deleted.`);
  }, [selectedItems, clearSelection, fail, info]);

  // Every selectable place is one this user OWNS (`isDeletable` above), so a
  // bulk share never has to triage them — the plan's skip list is always empty
  // here, and the shape exists for Saved, where a selection genuinely mixes.
  const shareCandidates = useMemo(
    () =>
      selectedItems.map((place) => ({
        key: place.id,
        share: { entityType: "place" as const, entityId: place.id },
      })),
    [selectedItems],
  );

  // The hero's answer, over the WHOLE collection rather than the filtered view:
  // "how far through my list am I" is a fact about the list, not about the
  // filter I happen to be holding.
  const totals = useMemo(() => {
    const counts: Record<PlaceStatus, number> = { done: 0, todo: 0, shared: 0 };
    for (const place of places) counts[statusOf(place)] += 1;
    return counts;
  }, [places, statusOf]);

  // TYPE TABS. The vocabulary is the user's own, so this rail is built from
  // their types rather than from a fixed list — and it is the one filter with a
  // permanent control, because "which kind of place am I looking at" is the
  // question people arrive with (§5.4).
  //
  // MEMBERSHIP is `placeTypeHasTab`, decided over the whole collection, not
  // the filtered view: a tab does NOT come and go as the user types.
  const typeTotals = useMemo(() => {
    const counts = new Map<string, number>();
    for (const place of places) {
      const id = place.placeTypeId;
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }, [places]);

  // Tallies over every axis EXCEPT the type itself, so a tab's badge answers
  // "how many would I get if I tapped this".
  const withoutType = useMemo(
    () =>
      countable.filter(
        (place) =>
          placeMatchesSearch(place, search) &&
          passesPlaceFilters(
            place,
            { ...filters, placeTypeId: null },
            place.syncRole === "owner",
          ) &&
          (bucket === "all" || statusOf(place) === bucket),
      ),
    [bucket, countable, filters, search, statusOf],
  );
  const typeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const place of withoutType) {
      const id = place.placeTypeId;
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }, [withoutType]);

  const typeOptions: ChipOption<string>[] = useMemo(
    () => [
      { value: ALL_TYPES, label: copy.anyType, count: withoutType.length },
      ...placeTypes
        .filter((type) =>
          placeTypeHasTab({
            builtIn: isSystemPlaceTypeId(type.id),
            places: typeTotals.get(type.id) ?? 0,
          }),
        )
        .map((type) => ({
          value: type.id,
          label: type.name,
          icon: placeTypeGlyph(type.iconKey),
          hue: type.color,
          count: typeCounts.get(type.id) ?? 0,
          disabled:
            (typeCounts.get(type.id) ?? 0) === 0 &&
            filters.placeTypeId !== type.id,
        })),
    ],
    [
      filters.placeTypeId,
      placeTypes,
      typeCounts,
      typeTotals,
      withoutType.length,
    ],
  );
  /** Null once a tab is doing the saying. */
  const typeLabelOf = useCallback(
    (typeId: string) =>
      filters.placeTypeId != null
        ? null
        : (placeTypes.find((type) => type.id === typeId)?.name ?? null),
    [filters.placeTypeId, placeTypes],
  );

  const selectType = useCallback((next: string) => {
    setFilters((current) => ({
      ...current,
      placeTypeId: next === ALL_TYPES ? null : next,
    }));
  }, []);

  const placeTypeForm = usePlaceTypeForm({
    open: sheet === "placeTypeForm",
    editing: null,
    onSaved: info,
    onDone: () => setSheet(null),
    onAdded: (type) => {
      setAddedType(type);
      setSheet("typeAttributes");
    },
  });
  const typeAttributes = useTypeAttributesStep({
    type: sheet === "typeAttributes" ? addedType : null,
    onDone: () => setSheet(null),
  });

  const heroSegments: MeterSegment[] = useMemo(
    () => [
      {
        label: "Visited",
        value: totals.done,
        hue: placeHue.done,
        display: String(totals.done),
      },
      {
        label: "Not visited",
        value: totals.todo,
        hue: placeHue.todo,
        display: String(totals.todo),
      },
      {
        label: "Shared",
        value: totals.shared,
        hue: placeHue.shared,
        display: String(totals.shared),
      },
    ],
    [totals, placeHue],
  );

  // The trip form's type vocabulary, so logging from here offers the same
  // chips as logging from the Logs tab.
  const tripTypes = useMemo(() => distinctTripTypes(trips), [trips]);

  // Hand the resolved set to the map. Published even while the option is off, so
  // switching it on is instant; the store drops an identical republish, so this
  // doesn't re-render the map on every keystroke.
  useEffect(() => {
    publishVisiblePlaces(
      visible.map((place) => place.id),
      places.length,
    );
  }, [places.length, visible]);

  const filterCount = activePlaceFilterCount(filters);
  // The type tab IS a filter and the shared predicate counts it as one — but it
  // is the one filter the user can already see, sitting selected in the rail.
  // Counting it again in "1 filter active", under a control that says so, would
  // send people into the sheet looking for something they had not set. So the
  // rail's own axis is subtracted from what the *hidden* filter warnings count,
  // and only while the rail is on screen to state it.
  const railShowsType = typeOptions.length > 1;
  const hiddenFilterCount =
    filterCount -
    (railShowsType && filters.placeTypeId != null ? 1 : 0) +
    (bucket === "all" ? 0 : 1);
  // What a CLEAR button could actually clear. A type tab is not it — the tab
  // is visible, one tap from All, and an empty panel telling someone to clear
  // "filters" they never opened is a dead end.
  const menuPlace = places.find((place) => place.id === menuPlaceId) ?? null;

  // Stable identities so the memoised rows never re-render for a state change
  // that has nothing to do with them (DESIGN.md).
  const openPlace = useCallback(
    (place: MirrorPlace) => onOpenPlace(place),
    [onOpenPlace],
  );
  const openMenu = useCallback(
    (place: MirrorPlace) => setMenuPlaceId(place.id),
    [],
  );
  const keyExtractor = useCallback((place: MirrorPlace) => place.id, []);
  const renderItem = useCallback(
    ({ item }: { item: Countable }) => (
      <PlaceRow
        place={item}
        status={statusOf(item)}
        typeLabel={typeLabelOf(item.placeTypeId)}
        sharedWith={item._count?.shares ?? 0}
        owner={shareOwners.data?.[item.id]}
        onOpen={openPlace}
        onMenu={openMenu}
        selecting={selecting}
        selected={selectedKeys.includes(item.id)}
        deletable={item.syncRole === "owner"}
        onToggle={() => selectItem(item)}
      />
    ),
    [
      openPlace,
      openMenu,
      statusOf,
      selecting,
      selectedKeys,
      selectItem,
      typeLabelOf,
      shareOwners.data,
    ],
  );

  /** Clears the SHEET's filters and leaves the type rail's selection standing —
   *  the rail is that axis's own control, and a reset that silently jumped the
   *  user back to All would be a second, invisible action. "All" is one tap
   *  away and says what it does. */
  const resetFilters = useCallback(() => {
    setBucket("all");
    setFilters((current) => ({
      ...EMPTY_PLACE_FILTERS,
      placeTypeId: current.placeTypeId,
    }));
  }, []);

  if (query.loading && places.length === 0) return <LoadingState />;
  if (query.error && places.length === 0) {
    return <ErrorState message={query.error} onRetry={query.refresh} />;
  }

  const note = placesFilterNote(hiddenFilterCount, sort);

  // The screen, section by section, in the order its contract gives.
  // Exhaustive by type: a section the contract names cannot be left out, and
  // one it does not name cannot be drawn.
  const sections: Record<
    SectionKeysOn<typeof PLACES_LIST, "gps">,
    ReactNode
  > = {
    hero: (
      <View {...heroCollapse.heroProps}>
        <Hero
          compact={heroCollapse.compact}
          eyebrow={PAGE_NAME}
          title={
            heroCollapse.compact
              ? compactHeroTitle(PAGE_NAME, places.length)
              : placesHeroTitle(places.length)
          }
          actions={
            <View style={styles.heroActions}>
              <IconButton
                icon="filter"
                accessibilityLabel={PLACES_FILTER_SHEET.title}
                color={hiddenFilterCount > 0 ? theme.accent : theme.textMuted}
                filled={hiddenFilterCount > 0}
                onPress={() => {
                  // Drop the keyboard BEFORE the sheet mounts: a sheet opening
                  // over a live IME inherits the shrunk frame and stops short of
                  // the bottom edge.
                  Keyboard.dismiss();
                  setSheet("filters");
                }}
              />
              {/* One way in on this client, so a button and no menu. With no
                  places the empty state carries the one add. */}
              {places.length > 0 &&
                contractSectionKeys(PLACES_ADD, "gps").map((key) => (
                  <HeroAdd
                    key={key}
                    label={PLACES_ADD.copy[key]}
                    icon={PLACES_ADD_ICON[key]}
                    compact={heroCollapse.compact}
                    onPress={() => startEditing(null)}
                  />
                ))}
            </View>
          }
        >
          {heroCollapse.compact ? undefined : (
            <>
              <Meter segments={heroSegments} />

              <SyncStatusPills online={online} pendingCount={pendingCount} />
            </>
          )}
        </Hero>
      </View>
    ),

    // ALWAYS ON SCREEN: the rail carries the only way to create a type from
    // this tab, and hiding it from accounts that have not made one yet would
    // hide the affordance from everyone who needs it.
    typeRail: (
      <View style={styles.rail}>
        {selecting ? (
          <SelectionBar
            countLabel={listSelectionLabel(selectedItems.length)}
            showSelectAll={selectedItems.length < selectableItems.length}
            extra={
              <BulkShareButton
                online={online}
                onPress={() => setSheet("bulkShare")}
              />
            }
            onClear={clearSelection}
            onSelectAll={selectAll}
            onDelete={() => void deleteSelected()}
          />
        ) : (
          <ChipRail
            scroll
            options={typeOptions}
            value={filters.placeTypeId ?? ALL_TYPES}
            onChange={selectType}
            // A way to make a type, drawn last so it never moves as types come
            // and go. "There is no tab for the kind of place I'm looking at" is
            // where a user notices they want one, and Settings is three taps
            // and a different mental mode away. An ACTION, not a filter value
            // (DESIGN.md: a control that changes mode says so by what it
            // does, not by looking different): a dashed chip leaves the
            // selection where it was.
            trailing={
              <Chip
                label={copy.newType}
                icon="add"
                dashed
                onPress={() => setSheet("placeTypeForm")}
              />
            }
          />
        )}
      </View>
    ),

    search:
      places.length > 0 ? (
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

    // An active hidden filter has to announce itself, with the way out in
    // reach.
    filterNote: note ? (
      <View style={styles.filterNote}>
        <Text style={styles.filterText} numberOfLines={1}>
          {note}
        </Text>
        <IconButton
          icon="close"
          size={16}
          accessibilityLabel={
            hiddenFilterCount === 0 ? copy.sortByNameAgain : copy.clearFilters
          }
          onPress={() => {
            if (hiddenFilterCount === 0) setSort("name");
            else resetFilters();
          }}
        />
      </View>
    ) : null,

    list: (
      <FlatList
        style={styles.list}
        {...heroCollapse.scrollProps}
        contentContainerStyle={styles.listContent}
        data={visible}
        keyExtractor={keyExtractor}
        keyboardShouldPersistTaps="handled"
        // A NSW place list runs to several hundred rows. The defaults keep ~21
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
                info("Offline — changes sync when you're back.");
                return;
              }
              query.refresh();
            }}
            tintColor={theme.accent}
          />
        }
        ListEmptyComponent={
          <EmptyPanel
            kind={placesEmptyKind({ total: places.length })}
            onAdd={() => startEditing(null)}
            onClear={() => {
              // "Show me everything" — the ONE place the type tab clears too,
              // because the user is looking at nothing and asking why.
              setSearch("");
              setFilters(EMPTY_PLACE_FILTERS);
              setBucket("all");
            }}
          />
        }
        renderItem={renderItem}
      />
    ),
  };

  return (
    <View style={styles.screen}>
      {contractSectionKeys(PLACES_LIST, "gps").map((key) => (
        <Fragment key={key}>{sections[key]}</Fragment>
      ))}

      {/* Per-place actions, titled with the place so a mis-tap can't destroy
          the wrong one — the SAME sheet the map opens on a place pin, so the
          two surfaces cannot offer different verbs for one place (DESIGN.md
          §7). The only row this surface adds is "Show on map". */}
      <PlaceOptionsSheet
        place={menuPlace}
        surface="row"
        visible={menuPlace !== null}
        onClose={closeMenu}
        onOpenPlace={onOpenPlace}
        onShowOnMap={onShowOnMap}
        onLogTrip={setLoggingFor}
        onEdit={startEditing}
        onInfo={info}
        onError={fail}
      />

      {/* Share the whole selection — one sheet, shared with Saved, so the two
          screens cannot word a bulk share differently. */}
      <BulkShareSheet
        visible={sheet === "bulkShare"}
        selection={shareCandidates}
        online={online}
        onClose={() => setSheet(null)}
        onDone={(report) => {
          setSheet(null);
          clearSelection();
          if (report.tone === "error") fail(report.text);
          else info(report.text);
        }}
      />

      {/* Making a type without leaving the tab that made you want one. The
          same form Settings uses, so the two cannot drift; only ADD is offered
          here — editing and deleting a type belong with the list of them. The
          new type's attributes follow in the same sheet. */}
      <BottomSheet
        visible={sheet === "placeTypeForm" || sheet === "typeAttributes"}
        onClose={
          sheet === "typeAttributes"
            ? typeAttributes.onClose
            : () => setSheet(null)
        }
        title={
          sheet === "typeAttributes" ? typeAttributes.title : "New place type"
        }
        onBack={sheet === "typeAttributes" ? typeAttributes.onBack : undefined}
        footer={
          sheet === "typeAttributes"
            ? typeAttributes.footer
            : placeTypeForm.footer
        }
      >
        {sheet === "typeAttributes" ? typeAttributes.body : placeTypeForm.body}
      </BottomSheet>

      <PlaceFilterSheet
        visible={sheet === "filters"}
        onClose={() => setSheet(null)}
        filters={filters}
        onChangeFilters={setFilters}
        status={bucket}
        onChangeStatus={setBucket}
        sort={sort}
        onChangeSort={setSort}
        onReset={resetFilters}
        onPickArea={() => openAreaPicker(filters.area)}
        activeCount={hiddenFilterCount}
        showFilteredOnMap={mapFilter.enabled}
        onChangeShowFilteredOnMap={setPlaceMapFilterEnabled}
        filteredCount={visible.length}
        totalCount={places.length}
      />

      <PlaceEditSheet
        visible={editing !== null}
        place={editing?.place ?? null}
        onPickOnMap={openPicker}
        pickedCoords={pickedCoords}
        resuming={resumingEdit}
        onClose={() => {
          setEditing(null);
          // The round trip is over: the next open seeds from scratch again.
          setResumingEdit(false);
          setPickedCoords(null);
        }}
        onSaved={info}
      />

      {/* Logging from a place: the same trip form, with this place already
          linked — the shortcut for the actual sequence (run it, then log it). */}
      <TripEditSheet
        online={online}
        visible={loggingFor !== null}
        places={places}
        initialPlaces={
          loggingFor
            ? [{ id: loggingFor.id, name: loggingFor.name }]
            : undefined
        }
        existingTypes={tripTypes}
        onClose={() => setLoggingFor(null)}
        onSaved={info}
      />

      <Toast message={toast} onDismissed={() => setToast(null)} />
    </View>
  );
}

// Memoised: the list holds hundreds of these, and a hero or rail state change
// must not re-render a row whose place is untouched. Handlers take the place
// back rather than closing over it, so their identity stays stable.
const PlaceRow = memo(function PlaceRow({
  place,
  status,
  typeLabel,
  sharedWith,
  owner,
  onOpen,
  onMenu,
  selecting,
  selected,
  deletable,
  onToggle,
}: {
  place: MirrorPlace;
  status: PlaceStatus;
  /** The place's type name, or null while a type tab is filtering the list. */
  typeLabel: string | null;
  sharedWith: number;
  /** The sharer's username, when this place is shared with the viewer. */
  owner: string | undefined;
  onOpen: (place: MirrorPlace) => void;
  onMenu: (place: MirrorPlace) => void;
  selecting: boolean;
  selected: boolean;
  /** False on a shared place — the owner-only delete gate leaves it nothing to
   *  be picked for, so it is greyed out while selecting rather than refused. */
  deletable: boolean;
  onToggle: () => void;
}) {
  const theme = useTheme();
  const styles = useStyles();

  const meta = placeStatusMeta(theme)[status];
  const quality = qualityLabel(numericFieldValue(place.fieldValues, "quality"));
  // The glyph stays the STATUS one, and the map is where a type is a colour. What the row owes a mixed list is the
  // type's NAME, and only while the list is mixed: with a tab selected the
  // strip above already says it, and a place of a type with no grades
  // summarises to nothing at all, so this is often the only second line.
  const subtitle = [typeLabel, placeSummary(place)]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
  return (
    <Row
      icon={meta.icon}
      hue={meta.hue}
      title={place.name}
      titleNumberOfLines={2}
      subtitle={subtitle || undefined}
      subtitleNumberOfLines={2}
      selected={selected}
      disabled={selecting && !deletable}
      onLongPress={onToggle}
      onPress={selecting ? onToggle : () => onOpen(place)}
      rightBelow
      right={
        <View style={styles.rowTrailing}>
          {place.syncRole === "shared" ? (
            <StatusPill label={incomingLabel(owner)} tone="outline" />
          ) : null}
          {quality ? <Text style={styles.quality}>{quality}</Text> : null}
          {sharedWith > 0 ? (
            <View style={styles.badge}>
              <Icon idea="friends" size={12} color={theme.textMuted} />
              <Text style={styles.badgeText}>{sharedWith}</Text>
            </View>
          ) : null}
          {selecting ? (
            // The ⋯ button's box, holding the checkbox — no circle at all on a
            // shared place (an empty checkbox promises a tap that does nothing).
            <View style={styles.selectBox}>
              {deletable ? (
                <Icon
                  idea={selected ? "success" : "unselected"}
                  size={22}
                  color={selected ? theme.accent : theme.textMuted}
                />
              ) : null}
            </View>
          ) : (
            <IconButton
              icon="overflow"
              accessibilityLabel={`Actions for ${place.name}`}
              onPress={() => onMenu(place)}
            />
          )}
        </View>
      }
    />
  );
});

/** An empty tick list and an over-tight filter are different problems with
 * different ways out. Which is which, and the words, are `placesEmptyKind` and
 * `placesEmptyState` in `@logjam/shared`. */
function EmptyPanel({
  kind,
  onAdd,
  onClear,
}: {
  kind: PlacesEmptyKind;
  onAdd: () => void;
  onClear: () => void;
}) {
  // Without an account there is no web list to import from and nothing will
  // ever sync — promising both would be the first thing a new guest reads.
  const guest = useAccountState().accountState === "guest";
  const state = placesEmptyState(kind, { platform: "gps", guest });
  return (
    <EmptyState
      icon={state.icon}
      title={state.title}
      hint={state.body}
      action={
        state.action === "clear"
          ? {
              label: copy.clearFilters,
              variant: "outlineAccent",
              onPress: onClear,
            }
          : {
              label: PLACES_ADD.copy.add,
              icon: PLACES_ADD_ICON.add,
              onPress: onAdd,
            }
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
  filterNote: {
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
  filterText: { ...textRole.detail, flex: 1, color: theme.text },
  list: { flex: 1 },
  listContent: {
    paddingHorizontal: spacing(2),
    paddingBottom: spacing(4),
    gap: spacing(1),
  },
  rowTrailing: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(1),
  },
  // IconButton's own box, so the checkbox that stands in for the ⋯ button
  // occupies exactly what it replaced and the row cannot resize on selection.
  selectBox: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  quality: { ...muted(theme, textRole.meta) },
  badge: { flexDirection: "row", alignItems: "center", gap: spacing(0.25) },
  badgeText: { ...muted(theme, textRole.meta) },
}));
