import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  activeTripFilterCount,
  contractSectionKeys,
  dateRangeLabel,
  distinctTripTypes,
  filterTrips,
  formatTripDate,
  groupTripsByYear,
  hasActiveTripFilter,
  NO_TYPE_FILTER_VALUE,
  primaryTripType,
  reconcileCustomFieldFilters,
  listSelectionLabel,
  sortTrips,
  tripDeleteConfirm,
  tripFilterFieldDefs,
  tripsEmptyKind,
  tripsEmptyState,
  tripsFilterNote,
  tripsHeroTitle,
  TRIPS_ADD,
  TRIPS_ADD_ICON,
  TRIPS_FILTER_SHEET,
  TRIPS_LIST,
  tripTypeLabel,
  tripVerbs,
  type CustomFieldFilter,
  type ScopedCustomFieldDef,
  type SectionKeysOn,
  type TripSortKey,
  type TripVerbId,
} from "@logjam/shared";
import type { TPlace, TTripLog } from "../../../placeUtils";
import {
  bulkDeleteTripLogs,
  deleteTripLog,
  tripTitle,
} from "../../../placeUtils";
import { useStoredState } from "../../../useStoredState";
import { useIsMobile } from "../../../useIsMobile";
import TripLogDialog from "../../dialogs/TripLogDialog";
import ConfirmDialog from "../../dialogs/ConfirmDialog";
import { useToast } from "../../feedback/ToastProvider";
import { messageFromError } from "../../../errors/messageFromError";
import {
  Button,
  ChipRail,
  EmptyState,
  Hero,
  IconButton,
  IconTile,
  Menu,
  Row,
  SearchField,
  SectionHeader,
  SelectionBar,
  TileCheckbox,
  type MenuEntry,
  Icon,
  LoadingState,
} from "../../../ui";
import { usePanelSheet } from "./usePanelSheet";
import TripLogFilterSheet from "./TripLogFilterSheet";
import { idRange } from "./placesModel";
import { tripTypeLook } from "./tripTypeIcon";
import classes from "./TripLogsPanel.module.css";

/** The type rail's "every activity" value — also what `filterTrips` treats as no filter. */
const ALL_TYPES = "";

const { copy } = TRIPS_LIST;

const plural = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

/**
 * Logs: "what have I done?" (Logjam GPS's `LogsScreen`). The hero answers with
 * the trip count; one rail narrows by activity; search hides behind the hero's
 * icon and the date range in a sheet beside the list. The list runs newest
 * first in year sections. A row opens its trip; ⋯ opens, edits or deletes it;
 * its tile starts a selection that deletes in bulk.
 */
function TripLogsPanel({
  views,
  tripLogs,
  tripLogsTotal,
  loaded,
  onRefetchTripLogs,
  customFieldDefs,
  onCustomFieldDefsChange,
  places,
  onPickCoords,
  pickingCoords,
  onQuotaChanged,
  onRefetchPlaces,
  onOpenUnifiedImport,
  onOpenTrip,
  onFiltersOpenChange,
  onExpandSheet,
}: {
  /** The Logs | Stats switch, drawn under the hero. */
  views: React.ReactNode;
  tripLogs: TTripLog[];
  // True trip-log total before the server's list cap; null until known.
  tripLogsTotal: number | null;
  /** False until the first fetch settles — an empty list before then is not
   *  "no trips yet". */
  loaded: boolean;
  onRefetchTripLogs: () => void;
  customFieldDefs: ScopedCustomFieldDef[];
  onCustomFieldDefsChange: (defs: ScopedCustomFieldDef[]) => void;
  places: TPlace[];
  onPickCoords: (onPicked: (lat: number, lng: number) => void) => void;
  pickingCoords: boolean;
  onQuotaChanged: () => void;
  onRefetchPlaces: () => void;
  onOpenUnifiedImport: () => void;
  /** A trip is READ on its own page (DESIGN.md §4), not in a dialog. */
  onOpenTrip: (tripLogId: string) => void;
  /** The date sheet is open beside the panel, so the map's chrome slides clear. */
  onFiltersOpenChange: (open: boolean) => void;
  /** Narrow web: grow the bottom sheet to full. */
  onExpandSheet?: () => void;
}) {
  const toast = useToast();
  const isNarrow = useIsMobile();
  const yearIdPrefix = useId();
  // Ephemeral filters — session-scoped, matching the place search. They survive
  // the panel's unmount-on-close (and a tab switch) so a mid-task filter isn't
  // retyped, but they're gone next session: a date range remembered for a month
  // hides trips the user never asked to hide (UX finding 5).
  const [search, setSearch] = useStoredState(
    "logjam.tripSearch",
    "",
    sessionStorage,
  );
  const [dateFrom, setDateFrom] = useStoredState(
    "logjam.tripDateFrom",
    "",
    sessionStorage,
  );
  const [dateTo, setDateTo] = useStoredState(
    "logjam.tripDateTo",
    "",
    sessionStorage,
  );
  const [typeFilter, setTypeFilter] = useStoredState(
    "logjam.tripTypeFilter",
    ALL_TYPES,
    sessionStorage,
  );
  // Attribute filters are ephemeral like the rest of them; the SORT is a
  // preference and outlives the session, exactly as Places' does.
  const [customFilters, setCustomFilters] = useStoredState<
    Record<string, CustomFieldFilter>
  >("logjam.tripAttributeFilters", {}, sessionStorage);
  const [includeUnknowns, setIncludeUnknowns] = useStoredState(
    "logjam.tripIncludeUnknowns",
    false,
    sessionStorage,
  );
  const [sort, setSort] = useStoredState<TripSortKey>(
    "logjam.tripSort",
    "newest",
  );
  const [searchOpen, setSearchOpen] = useState(search !== "");
  const { sheetOpen, openSheet } = usePanelSheet({
    onOpenChange: onFiltersOpenChange,
    onExpandSheet,
  });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectionAnchor = useRef<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [editingTripLog, setEditingTripLog] = useState<TTripLog | null>(null);
  const [creatingTrip, setCreatingTrip] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // ── The list ─────────────────────────────────────────────────────────
  const criteria = useMemo(
    () => ({
      search,
      dateFrom,
      dateTo,
      type: typeFilter,
      custom: customFilters,
      includeUnknowns,
    }),
    [search, dateFrom, dateTo, typeFilter, customFilters, includeUnknowns],
  );
  const visible = useMemo(
    () => sortTrips(filterTrips(tripLogs, criteria), sort),
    [tripLogs, criteria, sort],
  );
  // The year headings run the way the trips inside them do, or "Oldest first"
  // reads bottom-to-top.
  const years = useMemo(() => groupTripsByYear(visible, sort), [visible, sort]);
  // Trip types flattened across the loaded trips, for the form's type chips.
  const existingTripTypes = useMemo(
    () => tripLogs.flatMap((trip) => trip.types),
    [tripLogs],
  );
  const distinctTypes = useMemo(() => distinctTripTypes(tripLogs), [tripLogs]);
  const anyUntyped = useMemo(
    () => tripLogs.some((trip) => trip.types.length === 0),
    [tripLogs],
  );

  // The attributes worth OFFERING as filters follow the activity chip, the
  // way a place's follow its type (`tripFilterFieldDefs`).
  const filterableDefs = useMemo(
    () => tripFilterFieldDefs(customFieldDefs, tripLogs, typeFilter),
    [customFieldDefs, tripLogs, typeFilter],
  );

  // A filter whose definition was deleted, or retyped under it, would narrow
  // the list with no control left in the sheet to say so or undo it.
  useEffect(() => {
    setCustomFilters((current) =>
      reconcileCustomFieldFilters(current, filterableDefs),
    );
  }, [filterableDefs, setCustomFilters]);

  // A remembered type the logbook no longer has would narrow the list with no
  // chip lit to say so.
  useEffect(() => {
    if (!loaded || typeFilter === ALL_TYPES) return;
    const exists =
      typeFilter === NO_TYPE_FILTER_VALUE
        ? anyUntyped
        : distinctTypes.includes(typeFilter);
    if (!exists) setTypeFilter(ALL_TYPES);
  }, [loaded, typeFilter, anyUntyped, distinctTypes, setTypeFilter]);

  // Tallies come from the OTHER axes only, so a chip's count answers "how many
  // would I get if I pressed this" rather than "how many are showing now".
  const typeOptions = useMemo(() => {
    const withoutType = filterTrips(tripLogs, { ...criteria, type: ALL_TYPES });
    const untyped = withoutType.filter(
      (trip) => trip.types.length === 0,
    ).length;
    return [
      { value: ALL_TYPES, label: "All", count: withoutType.length },
      // Busiest activity first; ties alphabetical so the order is stable.
      ...distinctTypes
        .map((type) => ({
          type,
          count: withoutType.filter((trip) => trip.types.includes(type)).length,
        }))
        .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type))
        .map(({ type, count }) => {
          const look = tripTypeLook(type);
          return {
            value: type,
            label: tripTypeLabel(type),
            icon: look.icon,
            hue: look.hue,
            count,
            disabled: count === 0 && typeFilter !== type,
          };
        }),
      // Existence from the whole set, the count from the other axes.
      ...(anyUntyped
        ? [
            {
              value: NO_TYPE_FILTER_VALUE,
              label: "No type",
              icon: tripTypeLook(null).icon,
              hue: tripTypeLook(null).hue,
              count: untyped,
              disabled: untyped === 0 && typeFilter !== NO_TYPE_FILTER_VALUE,
            },
          ]
        : []),
    ];
  }, [tripLogs, criteria, distinctTypes, anyUntyped, typeFilter]);

  const rangeSet = dateFrom !== "" || dateTo !== "";
  const filtering = hasActiveTripFilter(criteria);
  const activeCount = activeTripFilterCount(criteria);
  // What the SHEET owns — the strip and its Reset speak for these, not for the
  // rail or the search box, which say their own state where they stand.
  const sheetFilterCount =
    activeCount - (search.trim() ? 1 : 0) - (typeFilter ? 1 : 0);

  // ── Selection ────────────────────────────────────────────────────────
  // Every trip is the user's own, so every row is selectable.
  const selectableIds = useMemo(
    () => visible.map((trip) => trip.id),
    [visible],
  );
  const selected = useMemo(() => {
    const picked = new Set(selectedIds);
    return visible.filter((trip) => picked.has(trip.id));
  }, [visible, selectedIds]);
  const selecting = selected.length > 0;

  const clearSelection = useCallback(() => {
    setSelectedIds([]);
    selectionAnchor.current = null;
  }, []);

  const toggleSelected = (id: string, extendRange: boolean) => {
    if (extendRange && selectionAnchor.current) {
      const range = idRange(selectableIds, selectionAnchor.current, id);
      setSelectedIds((current) => [...new Set([...current, ...range])]);
    } else {
      setSelectedIds((current) =>
        current.includes(id)
          ? current.filter((other) => other !== id)
          : [...current, id],
      );
    }
    selectionAnchor.current = id;
  };

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !selecting) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        target.closest(
          "input, textarea, [role='menu'], section[aria-labelledby]",
        )
      )
        return;
      if (event.key === "Escape") {
        event.preventDefault();
        clearSelection();
      } else if (
        event.key.toLowerCase() === "a" &&
        (event.ctrlKey || event.metaKey)
      ) {
        event.preventDefault();
        setSelectedIds(selectableIds);
      }
    };
    root.addEventListener("keydown", onKeyDown);
    return () => root.removeEventListener("keydown", onKeyDown);
  }, [selecting, selectableIds, clearSelection]);

  // A narrower axis can hide a picked row, and a group verb must not reach
  // rows the user can no longer see.
  const changeType = (next: string) => {
    clearSelection();
    setTypeFilter(next);
  };

  // ── Verbs ────────────────────────────────────────────────────────────
  // Which verbs, in what order and under what words is `TRIP_VERBS`, the
  // declaration a trip's page and Logjam GPS draw from too.
  const rowEntries = (trip: TTripLog): MenuEntry[] => {
    const runners: Record<TripVerbId, () => void> = {
      open: () => onOpenTrip(trip.id),
      edit: () => setEditingTripLog(trip),
      delete: () => setPendingDelete([trip.id]),
    };
    return tripVerbs("row").flatMap((verb) => {
      const item: MenuEntry = {
        id: verb.id,
        label: verb.label,
        icon: verb.icon,
        ...(verb.danger ? { danger: true } : {}),
        onSelect: runners[verb.id],
      };
      return verb.separated
        ? [{ id: `${verb.id}-sep`, separator: true }, item]
        : [item];
    });
  };

  async function confirmDelete() {
    if (!pendingDelete) return;
    const ids = pendingDelete;
    setDeleting(true);
    try {
      if (ids.length === 1) await deleteTripLog(ids[0]);
      else await bulkDeleteTripLogs(ids);
      toast.success(
        ids.length === 1 ? "Trip deleted." : `Deleted ${ids.length} trips.`,
      );
      setPendingDelete(null);
      clearSelection();
    } catch (err) {
      console.error(err);
      toast.error(
        messageFromError(
          err,
          ids.length === 1
            ? "Couldn't delete that trip."
            : "Couldn't delete those trips.",
        ),
      );
    } finally {
      setDeleting(false);
      // The refetch says which went, whether or not the request failed part-way.
      onRefetchTripLogs();
      onQuotaChanged();
    }
  }

  const clearRange = () => {
    setDateFrom("");
    setDateTo("");
  };

  /** Everything the sheet owns. The sort is a preference, not a filter, so it
   *  survives a Reset — clearing it would move the list for someone who only
   *  asked to see all their trips again. */
  const clearSheetFilters = () => {
    clearRange();
    setCustomFilters({});
    setIncludeUnknowns(false);
  };

  const clearEverything = () => {
    setSearch("");
    setTypeFilter(ALL_TYPES);
    clearSheetFilters();
  };

  const closeSearch = () => {
    setSearch("");
    setSearchOpen(false);
  };

  // ── Render ───────────────────────────────────────────────────────────
  const deleteCopy = tripDeleteConfirm(pendingDelete?.length ?? 1);
  const rangeText = rangeSet
    ? dateRangeLabel(dateFrom || null, dateTo || null)
    : null;
  const dateButton = (
    <IconButton
      icon="filter"
      label={
        sheetFilterCount > 0
          ? `${TRIPS_FILTER_SHEET.title}, ${plural(sheetFilterCount, "filter")} active`
          : TRIPS_FILTER_SHEET.title
      }
      tone={sheetFilterCount > 0 || sheetOpen ? "filled" : "default"}
      aria-expanded={sheetOpen}
      onClick={() => openSheet(!sheetOpen)}
    />
  );

  const total = tripLogsTotal ?? tripLogs.length;

  // The ways to add a trip, in the contract's order.
  const addEntries: Record<
    SectionKeysOn<typeof TRIPS_ADD, "web">,
    { label: string; onSelect: () => void }
  > = {
    add: { label: TRIPS_ADD.copy.add, onSelect: () => setCreatingTrip(true) },
    importFile: {
      label: TRIPS_ADD.copy.importFile,
      onSelect: onOpenUnifiedImport,
    },
  };

  const hero = (
    <Hero
      title={!loaded ? "Logs" : tripsHeroTitle(total)}
      actions={
        searchOpen ? (
          <>
            {dateButton}
            <IconButton
              icon="close"
              label={copy.closeSearch}
              onClick={closeSearch}
            />
          </>
        ) : (
          <>
            <IconButton
              icon="search"
              label={copy.search}
              tone={search ? "filled" : "default"}
              aria-expanded={false}
              onClick={() => setSearchOpen(true)}
            />
            {dateButton}
            <Menu
              label={TRIPS_ADD.copy.menu}
              placement="bottom-end"
              entries={contractSectionKeys(TRIPS_ADD, "web").map((key) => ({
                id: key,
                icon: TRIPS_ADD_ICON[key],
                ...addEntries[key],
              }))}
              trigger={(props) => (
                <Button
                  {...props}
                  compact
                  variant="filled"
                  icon="add"
                  trailingIcon="expand"
                >
                  {TRIPS_ADD.title}
                </Button>
              )}
            />
          </>
        )
      }
    >
      {/* The search box takes the title's place on the same line, so opening it moves nothing. */}
      {searchOpen && (
        <SearchField
          label={copy.searchField}
          value={search}
          autoFocus
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.stopPropagation();
            closeSearch();
          }}
        />
      )}
    </Hero>
  );

  const typeRail = (
    <div className={classes.rails}>
      <div className={selecting ? classes.inert : undefined} inert={selecting}>
        {views}
      </div>
      {selecting ? (
        <SelectionBar
          countLabel={listSelectionLabel(selected.length)}
          onClear={clearSelection}
        >
          <IconButton
            icon="delete"
            label="Delete"
            tone="danger"
            onClick={() => setPendingDelete(selected.map((trip) => trip.id))}
          />
        </SelectionBar>
      ) : (
        tripLogs.length > 0 && (
          <ChipRail
            label={copy.typeRail}
            options={typeOptions}
            value={typeFilter}
            onChange={changeType}
          />
        )
      )}
    </div>
  );

  const renderRow = (trip: TTripLog) => {
    const title = tripTitle(trip);
    const look = tripTypeLook(primaryTripType(trip.types));
    const isSelected = selectedIds.includes(trip.id);
    return (
      <Row
        key={trip.id}
        title={title}
        subtitle={[
          formatTripDate(trip.date),
          trip.places.length > 1 ? plural(trip.places.length, "place") : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        // The tile's glyph and hue say the activity to a sighted reader.
        description={
          trip.types.length > 0
            ? trip.types.map(tripTypeLabel).join(", ")
            : copy.noType
        }
        selected={isSelected}
        onOpen={() => onOpenTrip(trip.id)}
        leading={
          <TileCheckbox
            tile={<IconTile icon={look.icon} hue={look.hue} />}
            label={`Select ${title}`}
            checked={isSelected}
            selecting={selecting}
            onToggle={(extendRange) => toggleSelected(trip.id, extendRange)}
          />
        }
        trailing={
          <>
            {trip.notes && (
              <span
                className={classes.meta}
                role="img"
                aria-label={copy.hasNotes}
                title={copy.hasNotes}
              >
                <Icon idea="notes" size={14} aria-hidden />
              </span>
            )}
            {!selecting && (
              <Menu
                label={`Actions for ${title}`}
                title={title}
                placement="right-start"
                entries={rowEntries(trip)}
                trigger={(props) => (
                  <IconButton
                    {...props}
                    icon="overflow"
                    label={`Actions for ${title}`}
                  />
                )}
              />
            )}
          </>
        }
      />
    );
  };

  const emptyState =
    loaded && visible.length === 0
      ? tripsEmptyState(tripsEmptyKind({ total: tripLogs.length }), {
          platform: "web",
        })
      : null;

  const list = !loaded ? (
    <div className={classes.emptyArea} role="status">
      <LoadingState label={copy.loading} />
    </div>
  ) : emptyState ? (
    <div className={classes.emptyArea}>
      <EmptyState
        icon={emptyState.icon}
        title={emptyState.title}
        body={emptyState.body}
        actions={
          emptyState.action === "add" ? (
            <>
              <Button
                compact
                variant="filled"
                icon={TRIPS_ADD_ICON.add}
                onClick={() => setCreatingTrip(true)}
              >
                {TRIPS_ADD.copy.add}
              </Button>
              <Button
                compact
                variant="outline"
                icon={TRIPS_ADD_ICON.importFile}
                onClick={onOpenUnifiedImport}
              >
                {TRIPS_ADD.copy.importFile}
              </Button>
            </>
          ) : filtering ? (
            <Button compact variant="outline" onClick={clearEverything}>
              {copy.clearFilters}
            </Button>
          ) : undefined
        }
      />
    </div>
  ) : (
    <div className={classes.list}>
      {years.map((group) => {
        const headingId = `${yearIdPrefix}-${group.year}`;
        return (
          <section
            key={group.year}
            className={classes.year}
            aria-labelledby={headingId}
          >
            <SectionHeader
              id={headingId}
              title={`${group.year}`}
              count={group.trips.length}
              className={classes.yearHead}
            />
            {group.trips.map(renderRow)}
          </section>
        );
      })}
    </div>
  );

  const sheet = sheetOpen && (
    <TripLogFilterSheet
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
      onClose={() => openSheet(false)}
      activeCount={sheetFilterCount}
      resultCount={visible.length}
    />
  );

  const note = tripsFilterNote({
    rangeLabel: rangeText,
    sheetFilterCount,
    sort,
  });

  // The page, section by section, in the order its contract gives. Exhaustive
  // by type: a section the contract names cannot be left out, and one it does
  // not name cannot be drawn.
  const sections: Record<SectionKeysOn<typeof TRIPS_LIST, "web">, ReactNode> = {
    hero,
    typeRail,
    // The hidden filters, said out loud: the rail and the search box show
    // their own state where they stand, so this speaks only for what the
    // closed sheet is doing (DESIGN.md §2).
    filterNote: note != null && !sheetOpen && !selecting && (
      <div className={classes.strip}>
        <span className={classes.stripText}>{note}</span>
        {sheetFilterCount > 0 && (
          <IconButton
            icon="close"
            size={14}
            round
            label={copy.clearFilters}
            onClick={clearSheetFilters}
          />
        )}
      </div>
    ),
    // The server caps the trip list; say when this is a truncated view so the
    // oldest trips aren't silently hidden.
    truncated: tripLogsTotal != null && tripLogsTotal > tripLogs.length && (
      <p className={classes.note}>
        Showing your {tripLogs.length} most recent trips of {tripLogsTotal}.
        Older ones aren&rsquo;t loaded.
      </p>
    ),
    list,
  };

  return (
    <div ref={rootRef} className={classes.root}>
      {isNarrow && sheet ? (
        sheet
      ) : (
        <>
          {contractSectionKeys(TRIPS_LIST, "web").map((key) => (
            <Fragment key={key}>{sections[key]}</Fragment>
          ))}
          {!isNarrow && sheet}
        </>
      )}

      {/* Mounted while editing and hidden (not unmounted) while a coordinate is
          picked on the map, so the form survives the trip there and back. */}
      {editingTripLog && (
        <TripLogDialog
          open={!pickingCoords}
          onClose={() => setEditingTripLog(null)}
          onSaved={() => {
            setEditingTripLog(null);
            onRefetchTripLogs();
          }}
          places={places}
          tripLog={editingTripLog}
          customFieldDefs={customFieldDefs}
          onCustomFieldDefsChange={onCustomFieldDefsChange}
          existingTripTypes={existingTripTypes}
          onPickCoords={onPickCoords}
          onPlaceCreated={onRefetchPlaces}
        />
      )}

      <TripLogDialog
        open={creatingTrip && !pickingCoords}
        onClose={() => setCreatingTrip(false)}
        onSaved={() => {
          setCreatingTrip(false);
          onRefetchTripLogs();
          onQuotaChanged();
        }}
        places={places}
        customFieldDefs={customFieldDefs}
        onCustomFieldDefsChange={onCustomFieldDefsChange}
        existingTripTypes={existingTripTypes}
        onPickCoords={onPickCoords}
        onPlaceCreated={onRefetchPlaces}
      />

      <ConfirmDialog
        open={pendingDelete != null}
        title={deleteCopy.confirmTitle}
        message={deleteCopy.confirmBody}
        busy={deleting}
        onConfirm={() => void confirmDelete()}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
}

export default TripLogsPanel;
