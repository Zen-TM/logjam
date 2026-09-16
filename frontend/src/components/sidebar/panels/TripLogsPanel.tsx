import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  AlignLeft,
  ArrowRight,
  BookOpen,
  CalendarRange,
  ChevronDown,
  EllipsisVertical,
  Filter,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  dateRangeLabel,
  datePresets,
  distinctTripTypes,
  filterTrips,
  formatTripDate,
  groupTripsByYear,
  hasActiveTripFilter,
  NO_TYPE_FILTER_VALUE,
  primaryTripType,
  tripTypeLabel,
  type ScopedCustomFieldDef,
} from "@logjam/shared";
import type { TPlace, TTripLog } from "../../../placeUtils";
import { bulkDeleteTripLogs, deleteTripLog, tripTitle } from "../../../placeUtils";
import { useStoredState } from "../../../useStoredState";
import { useIsMobile } from "../../../useIsMobile";
import TripLogViewDialog from "../../dialogs/TripLogViewDialog";
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
  SheetSection,
  SideSheet,
  TextField,
  TileCheckbox,
  type MenuEntry,
} from "../../../ui";
import { usePanelSheet } from "./usePanelSheet";
import { idRange } from "./placesModel";
import { tripTypeLook } from "./tripTypeIcon";
import classes from "./TripLogsPanel.module.css";

/** The type rail's "every activity" value — also what `filterTrips` treats as no filter. */
const ALL_TYPES = "";

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

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
  onOpenPlace,
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
  onOpenPlace: (placeId: string) => void;
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
  const [search, setSearch] = useStoredState("logjam.tripSearch", "", sessionStorage);
  const [dateFrom, setDateFrom] = useStoredState("logjam.tripDateFrom", "", sessionStorage);
  const [dateTo, setDateTo] = useStoredState("logjam.tripDateTo", "", sessionStorage);
  const [typeFilter, setTypeFilter] = useStoredState("logjam.tripTypeFilter", ALL_TYPES, sessionStorage);
  const [searchOpen, setSearchOpen] = useState(search !== "");
  const { sheetOpen, openSheet } = usePanelSheet({ onOpenChange: onFiltersOpenChange, onExpandSheet });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectionAnchor = useRef<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [viewingTripLog, setViewingTripLog] = useState<TTripLog | null>(null);
  const [editingTripLog, setEditingTripLog] = useState<TTripLog | null>(null);
  const [creatingTrip, setCreatingTrip] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);


  // ── The list ─────────────────────────────────────────────────────────
  const criteria = useMemo(
    () => ({ search, dateFrom, dateTo, type: typeFilter }),
    [search, dateFrom, dateTo, typeFilter],
  );
  const visible = useMemo(() => filterTrips(tripLogs, criteria), [tripLogs, criteria]);
  const years = useMemo(() => groupTripsByYear(visible), [visible]);
  // Trip types flattened across the loaded trips, for the form's type chips.
  const existingTripTypes = useMemo(() => tripLogs.flatMap((trip) => trip.types), [tripLogs]);
  const distinctTypes = useMemo(() => distinctTripTypes(tripLogs), [tripLogs]);
  const anyUntyped = useMemo(() => tripLogs.some((trip) => trip.types.length === 0), [tripLogs]);

  // A remembered type the logbook no longer has would narrow the list with no
  // chip lit to say so.
  useEffect(() => {
    if (!loaded || typeFilter === ALL_TYPES) return;
    const exists = typeFilter === NO_TYPE_FILTER_VALUE ? anyUntyped : distinctTypes.includes(typeFilter);
    if (!exists) setTypeFilter(ALL_TYPES);
  }, [loaded, typeFilter, anyUntyped, distinctTypes, setTypeFilter]);

  // Tallies come from the OTHER axes only, so a chip's count answers "how many
  // would I get if I pressed this" rather than "how many are showing now".
  const typeOptions = useMemo(() => {
    const withoutType = filterTrips(tripLogs, { ...criteria, type: ALL_TYPES });
    const untyped = withoutType.filter((trip) => trip.types.length === 0).length;
    return [
      { value: ALL_TYPES, label: "All", count: withoutType.length },
      // Busiest activity first; ties alphabetical so the order is stable.
      ...distinctTypes
        .map((type) => ({ type, count: withoutType.filter((trip) => trip.types.includes(type)).length }))
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

  // ── Selection ────────────────────────────────────────────────────────
  // Every trip is the user's own, so every row is selectable.
  const selectableIds = useMemo(() => visible.map((trip) => trip.id), [visible]);
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
      setSelectedIds((current) => (current.includes(id) ? current.filter((other) => other !== id) : [...current, id]));
    }
    selectionAnchor.current = id;
  };

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !selecting) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, [role='menu'], section[aria-labelledby]")) return;
      if (event.key === "Escape") {
        event.preventDefault();
        clearSelection();
      } else if (event.key.toLowerCase() === "a" && (event.ctrlKey || event.metaKey)) {
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
  const rowEntries = (trip: TTripLog): MenuEntry[] => [
    { id: "open", label: "Open trip", icon: ArrowRight, onSelect: () => setViewingTripLog(trip) },
    { id: "edit", label: "Edit trip", icon: Pencil, onSelect: () => setEditingTripLog(trip) },
    { id: "sep", separator: true },
    { id: "delete", label: "Delete", icon: Trash2, danger: true, onSelect: () => setPendingDelete([trip.id]) },
  ];

  async function confirmDelete() {
    if (!pendingDelete) return;
    const ids = pendingDelete;
    setDeleting(true);
    try {
      if (ids.length === 1) await deleteTripLog(ids[0]);
      else await bulkDeleteTripLogs(ids);
      toast.success(ids.length === 1 ? "Trip deleted." : `Deleted ${ids.length} trips.`);
      setPendingDelete(null);
      clearSelection();
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, ids.length === 1 ? "Couldn't delete that trip." : "Couldn't delete those trips."));
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

  const clearEverything = () => {
    setSearch("");
    clearRange();
    setTypeFilter(ALL_TYPES);
  };

  const closeSearch = () => {
    setSearch("");
    setSearchOpen(false);
  };

  // ── Render ───────────────────────────────────────────────────────────
  const rangeText = dateRangeLabel(dateFrom || null, dateTo || null);
  const dateButton = (
    <IconButton
      icon={CalendarRange}
      label={rangeSet ? `Date range, ${rangeText}` : "Date range"}
      tone={rangeSet || sheetOpen ? "filled" : "default"}
      aria-expanded={sheetOpen}
      onClick={() => openSheet(!sheetOpen)}
    />
  );

  const total = tripLogsTotal ?? tripLogs.length;
  const hero = (
    <Hero
      title={!loaded ? "Logs" : total === 0 ? "No trips yet" : plural(total, "trip")}
      actions={
        searchOpen ? (
          <>
            {dateButton}
            <IconButton icon={X} label="Close search" onClick={closeSearch} />
          </>
        ) : (
          <>
            <IconButton
              icon={Search}
              label="Search trips"
              tone={search ? "filled" : "default"}
              aria-expanded={false}
              onClick={() => setSearchOpen(true)}
            />
            {dateButton}
            <Menu
              label="Add trips"
              placement="bottom-end"
              entries={[
                { id: "log", label: "Log a trip", icon: Plus, onSelect: () => setCreatingTrip(true) },
                { id: "file", label: "Import from file", icon: Upload, onSelect: onOpenUnifiedImport },
              ]}
              trigger={(props) => (
                <Button {...props} compact variant="filled" icon={Plus} trailingIcon={ChevronDown}>
                  Add
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
          label="Search by place or trip name"
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

  const rails = (
    <div className={classes.rails}>
      <div className={selecting ? classes.inert : undefined} inert={selecting}>
        {views}
      </div>
      {selecting ? (
        <SelectionBar countLabel={`${selected.length} selected`} onClear={clearSelection}>
          <IconButton icon={Trash2} label="Delete" tone="danger" onClick={() => setPendingDelete(selected.map((trip) => trip.id))} />
        </SelectionBar>
      ) : (
        tripLogs.length > 0 && <ChipRail label="Activity" options={typeOptions} value={typeFilter} onChange={changeType} />
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
        className={classes.row}
        title={title}
        subtitle={[formatTripDate(trip.date), trip.places.length > 1 ? plural(trip.places.length, "place") : null]
          .filter(Boolean)
          .join(" · ")}
        // The tile's glyph and hue say the activity to a sighted reader.
        description={trip.types.length > 0 ? trip.types.map(tripTypeLabel).join(", ") : "No type"}
        selected={isSelected}
        onOpen={() => setViewingTripLog(trip)}
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
              <span className={classes.meta} role="img" aria-label="Has notes" title="Has notes">
                <AlignLeft size={14} aria-hidden />
              </span>
            )}
            {!selecting && (
              <Menu
                label={`Actions for ${title}`}
                title={title}
                placement="right-start"
                entries={rowEntries(trip)}
                trigger={(props) => <IconButton {...props} icon={EllipsisVertical} label={`Actions for ${title}`} />}
              />
            )}
          </>
        }
      />
    );
  };

  const list = !loaded ? (
    <div className={classes.emptyArea} role="status">
      <p className={classes.loading}>Loading your logbook…</p>
    </div>
  ) : tripLogs.length === 0 ? (
    <div className={classes.emptyArea}>
      <EmptyState
        icon={BookOpen}
        title="Your logbook is empty"
        body="Log a trip and it lands here, and on Logjam GPS too."
        actions={
          <>
            <Button compact variant="filled" icon={Plus} onClick={() => setCreatingTrip(true)}>
              Log a trip
            </Button>
            <Button compact variant="outline" icon={Upload} onClick={onOpenUnifiedImport}>
              Import
            </Button>
          </>
        }
      />
    </div>
  ) : visible.length === 0 ? (
    <div className={classes.emptyArea}>
      <EmptyState
        icon={Filter}
        title="No trips match"
        body="Nothing matches your search and filters. Clear them to see the rest."
        actions={
          filtering ? (
            <Button compact variant="outline" onClick={clearEverything}>
              Clear filters
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
          <section key={group.year} className={classes.year} aria-labelledby={headingId}>
            <SectionHeader id={headingId} title={`${group.year}`} count={group.trips.length} className={classes.yearHead} />
            {group.trips.map(renderRow)}
          </section>
        );
      })}
    </div>
  );

  const presets = datePresets();
  const activePreset = presets.find((preset) => preset.from === dateFrom && preset.to === dateTo)?.label ?? "";
  const sheet = sheetOpen && (
    <SideSheet
      title="Date range"
      onClose={() => openSheet(false)}
      footer={
        <>
          <span className={classes.sheetCount}>{plural(visible.length, "trip")}</span>
          {rangeSet && (
            <Button compact onClick={clearRange}>
              Clear
            </Button>
          )}
          <Button compact variant="filled" onClick={() => openSheet(false)}>
            Done
          </Button>
        </>
      }
    >
      <SheetSection title="Presets">
        <ChipRail
          label="Date presets"
          options={presets.map((preset) => ({ value: preset.label, label: preset.label }))}
          value={activePreset}
          onChange={(label) => {
            const preset = presets.find((entry) => entry.label === label);
            if (!preset) return;
            setDateFrom(preset.from ?? "");
            setDateTo(preset.to ?? "");
          }}
        />
      </SheetSection>
      <SheetSection title="Exact range">
        {/* Bounds are set independently, so one could be moved past the other,
            after which nothing matches and the list empties with no reason
            given. Moving one pushes the other along. */}
        <div className={classes.dates}>
          <TextField
            label="From"
            type="date"
            className={classes.date}
            value={dateFrom}
            onChange={(event) => {
              const key = event.target.value;
              setDateFrom(key);
              if (key && dateTo && key > dateTo) setDateTo(key);
            }}
          />
          <TextField
            label="To"
            type="date"
            className={classes.date}
            value={dateTo}
            onChange={(event) => {
              const key = event.target.value;
              setDateTo(key);
              if (key && dateFrom && key < dateFrom) setDateFrom(key);
            }}
          />
        </div>
      </SheetSection>
    </SideSheet>
  );

  return (
    <div ref={rootRef} className={classes.root}>
      {isNarrow && sheet ? (
        sheet
      ) : (
        <>
          {hero}
          {rails}
          {rangeSet && !sheetOpen && !selecting && (
            <div className={classes.strip}>
              <span className={classes.stripText}>{rangeText}</span>
              <IconButton icon={X} size={14} round label="Clear the date range" onClick={clearRange} />
            </div>
          )}
          {/* The server caps the trip list; say when this is a truncated view so
              the oldest trips aren't silently hidden (UX-001). */}
          {tripLogsTotal != null && tripLogsTotal > tripLogs.length && (
            <p className={classes.note}>
              Showing your {tripLogs.length} most recent trips of {tripLogsTotal}. Older ones aren&rsquo;t loaded.
            </p>
          )}
          {list}
          {!isNarrow && sheet}
        </>
      )}

      <TripLogViewDialog
        open={viewingTripLog != null}
        onClose={() => setViewingTripLog(null)}
        tripLog={viewingTripLog}
        customFieldDefs={customFieldDefs}
        onMediaChanged={onQuotaChanged}
        onOpenPlace={(placeId) => {
          setViewingTripLog(null);
          onOpenPlace(placeId);
        }}
        onEdit={() => {
          setEditingTripLog(viewingTripLog);
          setViewingTripLog(null);
        }}
        onDeleted={() => {
          onRefetchTripLogs();
          onQuotaChanged();
        }}
      />

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
        title={pendingDelete?.length === 1 ? "Delete this trip?" : `Delete ${pendingDelete?.length ?? 0} trips?`}
        message={
          pendingDelete?.length === 1
            ? "Its photos, videos and tracks go too. The places it links to stay. This can't be undone."
            : "Their photos, videos and tracks go too. The places they link to stay. This can't be undone."
        }
        busy={deleting}
        onConfirm={() => void confirmDelete()}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
}

export default TripLogsPanel;
