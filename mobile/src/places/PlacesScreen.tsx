// Places — the tick list. Answers "what have I done, and what's left?" before
// any row appears, then gets out of the way of the two jobs people actually
// open this screen for: pick something for this weekend, or find one place by
// name.
//
// Built on the DESIGN.md skeleton (pinned hero + pinned filter rail + scrolling
// list + one sheet), same as Saved and Logs. The rail's four buckets are a true
// partition — every place is one of All/Not visited/Visited/Shared — so it
// never hides
// a row behind a combination the user has to reason about.
//
// Filtering shares the web panel's predicate (`passesPlaceFilters` in
// shared/): the web's twelve axes are cut here to the ones that decide a
// Saturday (grade, commitment, quality, hours, rope length) because a phone
// screen full of controls is a worse tool than a short one that fits.
//
// PRIVACY: rows carry names, grades, tallies — never coordinates or any derived
// location detail (DESIGN.md §11). Nothing here is logged, and the failure paths
// print our own copy rather than an error string that might embed a place name.
import { numericFieldValue } from "@logjam/shared";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  activePlaceFilterCount,
  placeMatchesSearch,
  comparePlaces,
  distinctTripTypes,
  EMPTY_PLACE_FILTERS,
  passesPlaceFilters,
  type PlaceFilters,
  type PlaceSortKey,
  type RegionBbox,
} from "@logjam/shared";

import { useAccountState } from "../auth/AccountStateContext";
import { placeHue, fontSize, fontWeight, radius, spacing, surface, theme, withAlpha } from "../theme";
import type { MirrorPlace } from "../sync/mirrorStore";
import { useConnectivity } from "../map/connectivity";
import {
  useMirrorPlaces,
  useMirrorPlaceTypes,
  useMirrorShareCounts,
  useMirrorTrips,
  usePendingSyncCount,
  useSyncStatus,
} from "../sync/useSyncQueries";
import {
  BottomSheet,
  Button,
  CapacityBar,
  HeroHeader,
  IconButton,
  LoadingState,
  ErrorState,
  Row,
  SegmentedControl,
  SelectionBar,
  SyncStatusPills,
  Toast,
  useBulkSelection,
  type CapacitySegment,
  type SegmentOption,
  type ToastMessage,
} from "../ui";
import { deletePlaceLocal } from "../sync/outbox";
import { TripEditSheet } from "../logs/TripEditSheet";
import { PlaceEditSheet } from "./PlaceEditSheet";
import { takePickedPoint } from "../map/pickedPoint";
import { setAreaPickerStart, takePickedArea } from "../map/pickedArea";
import { PlaceOptionsSheet } from "./PlaceOptionsSheet";
import { usePlaceTypeForm } from "./PlaceTypesEditor";
import { BulkShareButton, BulkShareSheet } from "../sharing/BulkShareSheet";
import { PlaceFilterSheet, sortLabel } from "./PlaceFilterSheet";
import {
  publishVisiblePlaces,
  setPlaceMapFilterEnabled,
  usePlaceMapFilter,
} from "./placeMapFilter";
import { PLACE_STATUS_META, placeStatus, placeSummary, qualityLabel, type PlaceStatus } from "./placeMeta";
import { placeTypeFeatherIcon } from "./placeTypeIcon";

type Bucket = "all" | PlaceStatus;

/** The type rail's "every type" chip. A sentinel rather than `null`, because
 *  `SegmentedControl` keys its chips by value. No place type can collide with
 *  it — an id is a UUID. */
const ALL_TYPES = "all";
/** The rail's trailing ACTION chip. Not a type id and cannot collide with one:
 *  every real id is a UUID. */
const NEW_TYPE = "__new_type__";

/** A place plus the tallies the shared predicate reads off `_count`. */
type Countable = MirrorPlace & { _count?: { tripLogLinks: number; shares: number } };

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
  const connectivity = useConnectivity();
  const online = connectivity === "online";
  const pendingCount = usePendingSyncCount();
  const query = useMirrorPlaces();
  const tripsQuery = useMirrorTrips();
  const shareCounts = useMirrorShareCounts();
  const typesQuery = useMirrorPlaceTypes();
  const syncStatus = useSyncStatus();
  const places = useMemo(() => query.data ?? [], [query.data]);
  const trips = useMemo(() => tripsQuery.data ?? [], [tripsQuery.data]);
  const placeTypes = useMemo(() => typesQuery.data ?? [], [typesQuery.data]);

  const [bucket, setBucket] = useState<Bucket>("all");
  const [findOpen, setFindOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<PlaceFilters>(EMPTY_PLACE_FILTERS);
  const [sort, setSort] = useState<PlaceSortKey>("name");
  const [sheet, setSheet] = useState<"filters" | "bulkShare" | "placeTypeForm" | null>(
    null,
  );
  const mapFilter = usePlaceMapFilter();
  const [menuPlaceId, setMenuPlaceId] = useState<string | null>(null);
  /** The sheet owns its own share sub-mode and forgets it on close. */
  const closeMenu = useCallback(() => setMenuPlaceId(null), []);
  const [editing, setEditing] = useState<{ place: MirrorPlace | null } | null>(null);
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
    setToast({ text, tone: "info", nonce: toastNonce.current });
  }, []);
  const fail = useCallback((text: string) => {
    toastNonce.current += 1;
    setToast({ text, tone: "error", nonce: toastNonce.current });
  }, []);

  // Sheets don't outlive the tab (DESIGN.md §7) — with ONE exception, and it is
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
  // Press and hold a row to start; the rail's bucket chips become the
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
  // these five" you no longer remember making is a stale prompt (DESIGN.md §7).
  useFocusEffect(
    useCallback(() => {
      clearSelection();
    }, [clearSelection]),
  );

  const deleteSelected = useCallback(() => {
    const targets = selectedItems;
    const count = targets.length;
    Alert.alert(
      count === 1 ? "Delete this place?" : `Delete ${count} places?`,
      "Their notes and photos are removed from this device and from your account. Trips that link to them stay, but lose the link. This can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void (async () => {
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
              if (failures === 0) info(`Deleted ${count} ${count === 1 ? "place" : "places"}.`);
              else fail(`${failures} of ${count} couldn't be deleted.`);
            })();
          },
        },
      ],
    );
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

  // Tallies come from the OTHER axes only, so a chip's count answers "how many
  // would I get if I tapped this" rather than restating the current view.
  const withoutBucket = useMemo(
    () => countable.filter(matchesSearchAndFilters),
    [countable, matchesSearchAndFilters],
  );
  const bucketCounts = useMemo(() => {
    const counts: Record<PlaceStatus, number> = { done: 0, todo: 0, shared: 0 };
    for (const place of withoutBucket) counts[statusOf(place)] += 1;
    return counts;
  }, [statusOf, withoutBucket]);

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
  // MEMBERSHIP is decided over the whole collection, not the filtered view: a
  // type with no places at all never appears (a canyoner should not be offered
  // a Campsite tab they have never used), but a tab does NOT come and go as the
  // user types — the bucket rail's rule, for the same reason.
  const typeTotals = useMemo(() => {
    const counts = new Map<string, number>();
    for (const place of places) {
      const id = place.placeTypeId;
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }, [places]);

  // Tallies over every axis EXCEPT the type itself, so a tab's badge answers
  // "how many would I get if I tapped this" — same rule as the bucket chips.
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

  const typeOptions: SegmentOption<string>[] = useMemo(
    () => [
      // "Any type", not "All": the bucket rail directly below has its own
      // "All" chip, and two identical words with the same number stacked six
      // pixels apart read as a rendering bug.
      { value: ALL_TYPES, label: "Any type", count: withoutType.length },
      ...placeTypes
        .filter((type) => (typeTotals.get(type.id) ?? 0) > 0)
        .map((type) => ({
          value: type.id,
          label: type.name,
          icon: placeTypeFeatherIcon(type.iconKey),
          hue: type.color,
          count: typeCounts.get(type.id) ?? 0,
          disabled:
            (typeCounts.get(type.id) ?? 0) === 0 && filters.placeTypeId !== type.id,
        })),
    ],
    [filters.placeTypeId, placeTypes, typeCounts, typeTotals, withoutType.length],
  );
  /**
   * What the rail actually draws: the type chips, then a way to make one.
   *
   * "There is no tab for the kind of place I'm looking at" is where a user
   * notices they want a new type, and Settings is three taps and a different
   * mental mode away. The chip is drawn last so it never moves as types come
   * and go, and it is an action rather than a selectable value — `selectType`
   * intercepts it (DESIGN.md §5: a control that changes mode says so by what it
   * does, not by looking different).
   */
  const railOptions: SegmentOption<string>[] = useMemo(
    () => [...typeOptions, { value: NEW_TYPE, label: "New type", icon: "plus" }],
    [typeOptions],
  );

  /** Null once a tab is doing the saying. */
  const typeLabelOf = useCallback(
    (typeId: string) =>
      filters.placeTypeId != null
        ? null
        : (placeTypes.find((type) => type.id === typeId)?.name ?? null),
    [filters.placeTypeId, placeTypes],
  );

  const selectType = useCallback(
    (next: string) => {
      // The last chip is an ACTION, not a filter state — it opens the form and
      // leaves the selection where it was, so a user who changes their mind
      // comes back to the tab they were on.
      if (next === NEW_TYPE) {
        setSheet("placeTypeForm");
        return;
      }
      setFilters((current) => ({
        ...current,
        placeTypeId: next === ALL_TYPES ? null : next,
      }));
    },
    [],
  );

  const placeTypeForm = usePlaceTypeForm({
    editing: null,
    onSaved: info,
    onDone: () => setSheet(null),
  });

  const bucketOptions: SegmentOption<Bucket>[] = useMemo(
    () => [
      { value: "all", label: "All", count: withoutBucket.length },
      ...(["todo", "done", "shared"] as PlaceStatus[]).map((status) => ({
        value: status,
        label: PLACE_STATUS_META[status].label,
        icon: PLACE_STATUS_META[status].icon,
        hue: PLACE_STATUS_META[status].hue,
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
      {
        label: "Visited",
        value: totals.done,
        color: placeHue.done,
        display: String(totals.done),
      },
      {
        label: "Not visited",
        value: totals.todo,
        color: placeHue.todo,
        display: String(totals.todo),
      },
      {
        label: "Shared",
        value: totals.shared,
        color: placeHue.shared,
        display: String(totals.shared),
      },
    ],
    [totals],
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
    filterCount - (railShowsType && filters.placeTypeId != null ? 1 : 0);
  // What a CLEAR button could actually clear. A type tab is not it — the tab
  // is visible, one tap from All, and an empty panel telling someone to clear
  // "filters" they never opened is a dead end.
  const filtering = hiddenFilterCount > 0 || search.trim() !== "";
  const menuPlace = places.find((place) => place.id === menuPlaceId) ?? null;

  // Stable identities so the memoised rows never re-render for a state change
  // that has nothing to do with them (DESIGN.md §9).
  const openPlace = useCallback((place: MirrorPlace) => onOpenPlace(place), [onOpenPlace]);
  const openMenu = useCallback((place: MirrorPlace) => setMenuPlaceId(place.id), []);
  const keyExtractor = useCallback((place: MirrorPlace) => place.id, []);
  const renderItem = useCallback(
    ({ item }: { item: Countable }) => (
      <PlaceRow
        place={item}
        status={statusOf(item)}
        typeLabel={typeLabelOf(item.placeTypeId)}
        sharedWith={item._count?.shares ?? 0}
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
    ],
  );

  const clearFind = useCallback(() => {
    setSearch("");
    setFindOpen(false);
  }, []);

  /** Clears the SHEET's filters and leaves the type rail's selection standing —
   *  the rail is that axis's own control, and a reset that silently jumped the
   *  user back to All would be a second, invisible action. "All" is one tap
   *  away and says what it does. */
  const resetFilters = useCallback(
    () =>
      setFilters((current) => ({
        ...EMPTY_PLACE_FILTERS,
        placeTypeId: current.placeTypeId,
      })),
    [],
  );

  if (query.loading && places.length === 0) return <LoadingState />;
  if (query.error && places.length === 0) {
    return <ErrorState message={query.error} onRetry={query.refresh} />;
  }

  return (
    <View style={styles.screen}>
      <HeroHeader
        eyebrow="Places"
        title={places.length === 1 ? "1 place" : `${places.length} places`}
        action={
          <View style={styles.heroActions}>
            <IconButton
              icon="search"
              accessibilityLabel={findOpen ? "Hide search" : "Search places"}
              color={search.trim() !== "" ? theme.accent : theme.textMuted}
              filled={search.trim() !== ""}
              onPress={() => (findOpen ? clearFind() : setFindOpen(true))}
            />
            <Button label="Add place" icon="plus" compact onPress={() => startEditing(null)} />
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
                placeholder="Place or alternative name"
                placeholderTextColor={theme.textMuted}
                accessibilityLabel="Search by place or alternative name"
                autoCapitalize="none"
                autoFocus
                returnKeyType="search"
              />
            </View>
            <IconButton
              icon="sliders"
              accessibilityLabel="Sort and filter"
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
              color={hiddenFilterCount > 0 ? theme.accent : theme.textMuted}
              filled={hiddenFilterCount > 0}
              onPress={() => setSheet("filters")}
            />
          </View>
        )}

        <SyncStatusPills online={online} pendingCount={pendingCount} />
      </HeroHeader>

      {/* Two rails, and they answer different questions: WHAT kind of place
          (the user's own vocabulary) and WHERE it is in the tick list. Only the
          bucket rail gives way to the selection bar — the type rail is the
          heading for what is selected, not a control over it. */}
      {/* ALWAYS ON SCREEN now, where it used to appear only once a second type
          had places in it: the rail carries the only way to create a type from
          this tab, and hiding it from exactly the accounts that have not made
          one yet would have hidden the affordance from everyone who needs it. */}
      {/* STAYS MOUNTED WHILE SELECTING, dimmed and inert. Unmounting it took
          ~52pt of chrome out from under the finger that had just long-pressed a
          row, sliding every row up mid-gesture — the same jump DESIGN.md §7
          fixed once for the bucket rail. A filter that cannot be changed during
          a selection still has to say what the selection is drawn from. */}
      <View
        style={[styles.typeRail, selecting && styles.railInert]}
        pointerEvents={selecting ? "none" : "auto"}
      >
        <SegmentedControl
          scroll
          options={railOptions}
          value={filters.placeTypeId ?? ALL_TYPES}
          onChange={selectType}
        />
      </View>

      <View style={styles.rail}>
        {selecting ? (
          <SelectionBar
            countLabel={`${selectedItems.length} ${
              selectedItems.length === 1 ? "place" : "places"
            } selected`}
            showSelectAll={selectedItems.length < selectableItems.length}
            extra={
              <BulkShareButton online={online} onPress={() => setSheet("bulkShare")} />
            }
            onClear={clearSelection}
            onSelectAll={selectAll}
            onDelete={deleteSelected}
          />
        ) : (
          <SegmentedControl scroll options={bucketOptions} value={bucket} onChange={setBucket} />
        )}
      </View>

      {/* An active hidden filter has to announce itself, with the way out in
          reach (DESIGN.md §2). */}
      {hiddenFilterCount > 0 || sort !== "name" ? (
        <View style={styles.filterNote}>
          <Text style={styles.filterText} numberOfLines={1}>
            {hiddenFilterCount === 0
              ? sortLabel(sort)
              : hiddenFilterCount === 1
                ? "1 filter active"
                : `${hiddenFilterCount} filters active`}
            {hiddenFilterCount === 0 || sort === "name" ? "" : ` · ${sortLabel(sort)}`}
          </Text>
          <IconButton
            icon="x"
            size={16}
            accessibilityLabel={
              hiddenFilterCount === 0 ? "Sort by name again" : "Clear all filters"
            }
            onPress={() => {
              if (hiddenFilterCount === 0) setSort("name");
              else resetFilters();
            }}
          />
        </View>
      ) : null}

      <FlatList
        style={styles.list}
        contentContainerStyle={styles.listContent}
        data={visible}
        keyExtractor={keyExtractor}
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
            bucket={bucket}
            filtering={filtering}
            onAdd={() => startEditing(null)}
            onClear={() => {
              // "Show me everything" — the ONE place the type tab clears too,
              // because the user is looking at nothing and asking why.
              clearFind();
              setFilters(EMPTY_PLACE_FILTERS);
              setBucket("all");
            }}
          />
        }
        renderItem={renderItem}
      />

      {/* Per-place actions, titled with the place so a mis-tap can't destroy
          the wrong one — the SAME sheet the map opens on a place pin, so the
          two surfaces cannot offer different verbs for one place (DESIGN.md
          §7). The only row this surface adds is "Show on map". */}
      <PlaceOptionsSheet
        place={menuPlace}
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
          here — editing and deleting a type belong with the list of them. */}
      <BottomSheet
        visible={sheet === "placeTypeForm"}
        onClose={() => setSheet(null)}
        title="New place type"
        footer={placeTypeForm.footer}
      >
        {placeTypeForm.body}
      </BottomSheet>

      <PlaceFilterSheet
        visible={sheet === "filters"}
        onClose={() => setSheet(null)}
        filters={filters}
        onChangeFilters={setFilters}
        sort={sort}
        onChangeSort={setSort}
        onReset={resetFilters}
        onPickArea={() => openAreaPicker(filters.area)}
        activeCount={filterCount}
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
          loggingFor ? [{ id: loggingFor.id, name: loggingFor.name }] : undefined
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
  onOpen: (place: MirrorPlace) => void;
  onMenu: (place: MirrorPlace) => void;
  selecting: boolean;
  selected: boolean;
  /** False on a shared place — the owner-only delete gate leaves it nothing to
   *  be picked for, so it is greyed out while selecting rather than refused. */
  deletable: boolean;
  onToggle: () => void;
}) {
  const meta = PLACE_STATUS_META[status];
  const quality = qualityLabel(numericFieldValue(place.fieldValues, "quality"));
  // The glyph stays the STATUS one — that is what the rail filters on, and the
  // map is where a type is a colour. What the row owes a mixed list is the
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
      selected={selected}
      disabled={selecting && !deletable}
      onLongPress={onToggle}
      onPress={selecting ? onToggle : () => onOpen(place)}
      right={
        <View style={styles.rowTrailing}>
          {quality ? <Text style={styles.quality}>{quality}</Text> : null}
          {sharedWith > 0 ? (
            <View style={styles.badge}>
              <Feather name="users" size={12} color={theme.textMuted} />
              <Text style={styles.badgeText}>{sharedWith}</Text>
            </View>
          ) : null}
          {selecting ? (
            // The ⋯ button's box, holding the checkbox — no circle at all on a
            // shared place (an empty checkbox promises a tap that does nothing).
            <View style={styles.selectBox}>
              {deletable ? (
                <Feather
                  name={selected ? "check-circle" : "circle"}
                  size={22}
                  color={selected ? theme.accent : theme.textMuted}
                />
              ) : null}
            </View>
          ) : (
            <IconButton
              icon="more-vertical"
              accessibilityLabel={`Actions for ${place.name}`}
              onPress={() => onMenu(place)}
            />
          )}
        </View>
      }
    />
  );
});

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
  const isGuest = useAccountState().accountState === "guest";
  const copy = filtering
    ? {
        icon: "filter" as const,
        title: "No places match",
        body: "Nothing matches your search and filters. Clear them to see the rest.",
      }
    : bucket === "done"
      ? {
          icon: "check-circle" as const,
          title: "Nothing ticked off yet",
          body: "Log a trip at a place and it moves here.",
        }
      : bucket === "shared"
        ? {
            icon: "users" as const,
            title: "Nothing shared with you",
            body: "Places a friend shares appear here with notes and photos. Share your own from a place's page.",
          }
        : bucket === "todo"
          ? {
              icon: "map-pin" as const,
              title: "Your list is clear",
              body: "You've logged a trip for every place. Add a new place and it appears here.",
            }
          : {
              icon: "map-pin" as const,
              title: "No places yet",
              // Without an account there is no web list to import from and
              // nothing will ever sync — promising both would be the first
              // thing a new guest reads, and wrong.
              body: isGuest
                ? "Add places to start. Everything is saved on this phone and works offline."
                : "Add places, or import your list on Logjam Web. Once synced, they work offline.",
            };
  return (
    <View style={styles.empty}>
      <Feather name={copy.icon} size={28} color={withAlpha(theme.accent, 0.8)} />
      <Text style={styles.emptyTitle}>{copy.title}</Text>
      <Text style={styles.emptyBody}>{copy.body}</Text>
      {filtering ? (
        <Button label="Clear filters" variant="outlineAccent" onPress={onClear} />
      ) : bucket === "all" || bucket === "todo" ? (
        <Button label="Add a place" icon="plus" onPress={onAdd} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.primary },
  heroActions: { flexDirection: "row", alignItems: "center", gap: spacing(0.5) },
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
  // The type rail sits directly under the hero and carries the bucket rail's
  // top padding, so the pair reads as one block rather than two stacked bars.
  typeRail: { paddingLeft: spacing(2), paddingTop: spacing(1.5) },
  // Dimmed, not gone: see the comment at the render site.
  railInert: { opacity: 0.4 },
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
  // IconButton's own box, so the checkbox that stands in for the ⋯ button
  // occupies exactly what it replaced and the row cannot resize on selection.
  selectBox: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  quality: { color: theme.textMuted, fontSize: fontSize.xs },
  badge: { flexDirection: "row", alignItems: "center", gap: spacing(0.25) },
  badgeText: { color: theme.textMuted, fontSize: fontSize.xs },
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
