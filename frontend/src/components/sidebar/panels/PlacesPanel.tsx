import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  ChevronDown,
  CircleCheck,
  CloudDownload,
  Download,
  EllipsisVertical,
  FileText,
  Filter,
  LocateFixed,
  Map as MapIcon,
  MapPin,
  MapPinPlus,
  Mountain,
  Plus,
  Search,
  Share2,
  SlidersHorizontal,
  Star,
  Trash2,
  Upload,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  comparePlaces,
  EMPTY_PLACE_FILTERS,
  numericFieldValue,
  passesPlaceFilters,
  PLACE_STATUS_LABELS,
  PLACE_STATUS_ORDER,
  placeMatchesSearch,
  placeSortLabel,
  placeStatus,
  placeSummary,
  qualityLabel,
  type PlaceSortKey,
  type PlaceStatus,
  type RegionBbox,
  type ScopedCustomFieldDef,
} from "@logjam/shared";
import type { TFilters, TPlace, TPlaceType, RefreshResult } from "../../../placeUtils";
import { bulkDeletePlaces, refreshFromRopeWiki } from "../../../placeUtils";
import { buildPlaceExport, type TExportFormat } from "../../../placeExport";
import { useStoredState } from "../../../useStoredState";
import { useIsMobile } from "../../../useIsMobile";
import type { PanelId } from "../panels";
import RopeWikiReviewDialog from "../../dialogs/RopeWikiReviewDialog";
import ConfirmDialog from "../../dialogs/ConfirmDialog";
import { useToast } from "../../feedback/ToastProvider";
import { messageFromError } from "../../../errors/messageFromError";
import {
  Button,
  Chip,
  ChipRail,
  EmptyState,
  Hero,
  IconButton,
  IconTile,
  Menu,
  Row,
  SearchField,
  SelectionBar,
  TileCheckbox,
  type MenuEntry,
} from "../../../ui";
import { placeTypeLucideIcon } from "./placeTypeIcon";
import PlaceFilterSheet from "./PlaceFilterSheet";
import {
  bucketOf,
  clearSheetFilters,
  idRange,
  normaliseBucket,
  placesBounds,
  sheetFilterCount,
  withBucket,
  type StatusBucket,
} from "./placesModel";
import classes from "./PlacesPanel.module.css";

export type MapKind = "topo" | "geopdf";

const STATUS_ICON: Record<PlaceStatus, LucideIcon> = { done: CircleCheck, todo: MapPin, shared: Users };
const STATUS_HUE: Record<PlaceStatus, string> = {
  done: "var(--theme-accent)",
  todo: "var(--hue-todo)",
  shared: "var(--hue-shared)",
};

const ANY_TYPE = "any";
const REVEAL_MS = 2000;

type Listed = { place: TPlace; owned: boolean; status: PlaceStatus };

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * Places: a tick list. The hero answers "how far through my list am I?" over the
 * whole collection; two rails narrow the list (the user's own types, then the
 * status partition); everything else is the sheet beside it. Rows are cards
 * whose tile is their status, and whose ⋯ holds the same verbs a pin opens.
 * Selecting starts from a row's tile and swaps the status rail for the bar.
 */
function PlacesPanel({
  places,
  placesLoaded,
  placesTotal,
  sharedPlaces,
  placeTypes,
  placeCustomFieldDefs,
  filters,
  onChangeFilters,
  onAddPlace,
  onOpenUnifiedImport,
  onRefetch,
  onQuotaChanged,
  onDrawFilterArea,
  onFilterToMapView,
  openFiltersRequested,
  onOpenFiltersConsumed,
  onFiltersOpenChange,
  onFlyToPlace,
  setSelectedPlaceID,
  setActivePanel,
  onHoverPlace,
  revealPlaceId,
  onRevealConsumed,
  onMakeMap,
  onSharePlaces,
  onExpandSheet,
}: {
  places: TPlace[];
  /** False until the first fetch lands — an empty list before then is not "no
   *  places yet", and saying so flashes a first-run screen at every user. */
  placesLoaded: boolean;
  /** The true owned-place total before the server's list cap; null until known. */
  placesTotal: number | null;
  sharedPlaces: TPlace[];
  /** Every type the user has. The rail shows only those with places. */
  placeTypes: TPlaceType[];
  placeCustomFieldDefs: ScopedCustomFieldDef[];
  filters: TFilters;
  onChangeFilters: (next: TFilters) => void;
  onAddPlace: () => void;
  onOpenUnifiedImport: () => void;
  onRefetch: () => void;
  onQuotaChanged: () => void;
  onDrawFilterArea: () => void;
  onFilterToMapView: () => void;
  /** Open the sheet on arrival (returning from drawing an area). A request that
   *  is CONSUMED, not a counter: a counter above zero reopened the sheet on
   *  every later visit to Places. */
  openFiltersRequested: boolean;
  onOpenFiltersConsumed: () => void;
  onFiltersOpenChange: (open: boolean) => void;
  onFlyToPlace: (lat: number, lng: number) => void;
  setSelectedPlaceID: (id: string | null) => void;
  setActivePanel: (panel: PanelId | null) => void;
  /** The row under the pointer, so its pin lights on the map. */
  onHoverPlace: (id: string | null) => void;
  /** A pin was pressed while this list is open: scroll to its row. */
  revealPlaceId: string | null;
  onRevealConsumed: () => void;
  onMakeMap: (bounds: RegionBbox, kind: MapKind) => void;
  onSharePlaces: (ids: string[]) => void;
  /** Narrow web: grow the bottom sheet to full. */
  onExpandSheet?: () => void;
}) {
  const toast = useToast();
  const isNarrow = useIsMobile();
  // Session-scoped like the filters: a search remembered for a month reads as
  // "my places are missing" (UX finding 5). Sort is a preference and stays.
  const [query, setQuery] = useStoredState("logjam.placeSearch", "", sessionStorage);
  const [sort, setSort] = useStoredState<PlaceSortKey>("logjam.placeSort", "name");
  const [searchOpen, setSearchOpen] = useState(query !== "");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectionAnchor = useRef<string | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Status axes set by an older build that the rail cannot show are rewritten
  // to the chip they are nearest, so nothing narrows the list with no chip lit.
  useEffect(() => {
    const normalised = normaliseBucket(filters);
    if (normalised !== filters) onChangeFilters(normalised);
  }, [filters, onChangeFilters]);

  const openSheet = useCallback(
    (open: boolean) => {
      setSheetOpen(open);
      onFiltersOpenChange(open);
      if (open) onExpandSheet?.();
    },
    [onFiltersOpenChange, onExpandSheet],
  );
  useEffect(() => {
    if (!openFiltersRequested) return;
    openSheet(true);
    onOpenFiltersConsumed();
  }, [openFiltersRequested, onOpenFiltersConsumed, openSheet]);
  useEffect(() => () => onFiltersOpenChange(false), [onFiltersOpenChange]);
  useEffect(() => () => onHoverPlace(null), [onHoverPlace]);

  const typeById = useMemo(() => new Map(placeTypes.map((type) => [type.id, type])), [placeTypes]);

  const collection = useMemo<Listed[]>(
    () => [
      ...places.map((place) => ({
        place,
        owned: true,
        status: placeStatus({ syncRole: "owner" }, place._count?.tripLogLinks ?? 0),
      })),
      ...sharedPlaces.map((place) => ({ place, owned: false, status: "shared" as const })),
    ],
    [places, sharedPlaces],
  );

  const matching = useCallback(
    (axes: TFilters) => collection.filter(({ place, owned }) => placeMatchesSearch(place, query) && passesPlaceFilters(place, axes, owned)),
    [collection, query],
  );

  const visible = useMemo(
    () => matching(filters).sort((a, b) => comparePlaces(a.place, b.place, sort)),
    [matching, filters, sort],
  );

  // Tallies come from the OTHER axes only, so a chip's count answers "how many
  // would I get if I pressed this" rather than restating the current view.
  const statusCounts = useMemo(() => {
    const counts: Record<StatusBucket, number> = { all: 0, done: 0, todo: 0, shared: 0 };
    for (const { status } of matching(withBucket(filters, "all"))) {
      counts[status] += 1;
      counts.all += 1;
    }
    return counts;
  }, [matching, filters]);

  const typeCounts = useMemo(() => {
    const withoutType = matching({ ...filters, placeTypeId: null });
    const counts = new Map<string, number>();
    for (const { place } of withoutType) counts.set(place.placeTypeId, (counts.get(place.placeTypeId) ?? 0) + 1);
    return { any: withoutType.length, byType: counts };
  }, [matching, filters]);

  // Membership over the whole collection: a type with no places is not offered,
  // but a chip does not come and go as the user types.
  const typesWithPlaces = useMemo(() => {
    const present = new Set(collection.map(({ place }) => place.placeTypeId));
    return placeTypes.filter((type) => present.has(type.id));
  }, [collection, placeTypes]);

  const sheetCount = sheetFilterCount(filters);
  const bucket = bucketOf(filters);

  // ── Selection ─────────────────────────────────────────────────────────
  // Your own places only: every group verb (share, delete) is owner-only.
  const selectableIds = useMemo(() => visible.filter((row) => row.owned).map((row) => row.place.id), [visible]);
  const selected = useMemo(() => {
    const picked = new Set(selectedIds);
    return visible.filter((row) => picked.has(row.place.id)).map((row) => row.place);
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

  // ── A pin pressed on the map scrolls to its row ──────────────────────
  useEffect(() => {
    if (!revealPlaceId) return;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-place-id="${revealPlaceId}"]`);
    row?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    setHighlightedId(revealPlaceId);
    onRevealConsumed();
    const timer = window.setTimeout(() => setHighlightedId(null), REVEAL_MS);
    return () => window.clearTimeout(timer);
  }, [revealPlaceId, onRevealConsumed]);

  // ── Verbs ─────────────────────────────────────────────────────────────
  const openPlace = (place: TPlace) => {
    onFlyToPlace(place.latitude, place.longitude);
    setSelectedPlaceID(place.id);
    setActivePanel("place-detail");
  };

  const makeMapEntries = (targets: TPlace[]): MenuEntry[] => {
    const bounds = placesBounds(targets);
    if (!bounds) return [];
    return [
      { id: "topo", label: "LiDAR topo", icon: Mountain, onSelect: () => onMakeMap(bounds, "topo") },
      { id: "geopdf", label: "GeoPDF", icon: FileText, onSelect: () => onMakeMap(bounds, "geopdf") },
    ];
  };

  const exportEntries = (targets: TPlace[]): MenuEntry[] =>
    (
      [
        ["gpx", "GPX"],
        ["kml", "KML"],
        ["geojson", "GeoJSON"],
        ["csv", "CSV"],
      ] as [TExportFormat, string][]
    ).map(([format, label]) => ({
      id: format,
      label,
      onSelect: () => {
        const { blob, filename } = buildPlaceExport(targets, format, placeCustomFieldDefs);
        download(blob, filename);
      },
    }));

  const rowEntries = ({ place, owned }: Listed): MenuEntry[] => [
    { id: "open", label: "Open place", icon: ArrowRight, onSelect: () => openPlace(place) },
    { id: "show", label: "Show on map", icon: LocateFixed, onSelect: () => onFlyToPlace(place.latitude, place.longitude) },
    ...makeMapEntries([place]).map((entry) =>
      "separator" in entry ? entry : { ...entry, label: `Make a ${entry.label} here` },
    ),
    ...(owned
      ? ([
          { id: "sep", separator: true },
          { id: "share", label: "Share or export…", icon: Share2, onSelect: () => onSharePlaces([place.id]) },
          { id: "sep2", separator: true },
          { id: "delete", label: "Delete", icon: Trash2, danger: true, onSelect: () => setPendingDelete([place.id]) },
        ] satisfies MenuEntry[])
      : []),
  ];

  async function confirmDelete() {
    if (!pendingDelete) return;
    const count = pendingDelete.length;
    setDeleting(true);
    try {
      await bulkDeletePlaces(pendingDelete);
      toast.success(`Deleted ${plural(count, "place")}.`);
      setPendingDelete(null);
      clearSelection();
      onQuotaChanged();
      onRefetch();
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, count === 1 ? "Couldn't delete that place." : "Couldn't delete those places."));
    } finally {
      setDeleting(false);
    }
  }

  // ── RopeWiki ─────────────────────────────────────────────────────────
  const [confirmRefresh, setConfirmRefresh] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshResult, setRefreshResult] = useState<RefreshResult | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);

  async function importFromRopeWiki() {
    setConfirmRefresh(false);
    setRefreshing(true);
    try {
      const result = await refreshFromRopeWiki();
      setRefreshResult(result);
      onRefetch();
      if (result.review.length > 0) setReviewOpen(true);
      // Summarise what happened automatically, and flag what still needs review,
      // so the import isn't silent (IMPORT-3). The corpus is a hand-refreshed
      // snapshot, so date it (RopeWiki blocks server-side fetches).
      const done = [
        result.added > 0 ? `${result.added} added` : null,
        result.autoLinked > 0 ? `${result.autoLinked} linked` : null,
        result.updated > 0 ? `${result.updated} updated` : null,
      ].filter(Boolean);
      const review = result.review.length > 0 ? ` · ${plural(result.review.length, "possible duplicate")} to review` : "";
      const source = result.sourceUpdatedAt ? ` · source ${new Date(result.sourceUpdatedAt).toLocaleDateString()}` : "";
      toast.success(`RopeWiki import: ${done.length > 0 ? done.join(", ") : "no new places"}${review}${source}`);
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, "Couldn't import from RopeWiki."));
    } finally {
      setRefreshing(false);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────
  const clearEverything = () => {
    setQuery("");
    onChangeFilters({ ...EMPTY_PLACE_FILTERS, custom: {} });
  };

  const filterButton = (
    <IconButton
      icon={SlidersHorizontal}
      label={sheetCount > 0 ? `Sort and filter, ${plural(sheetCount, "filter")} on` : "Sort and filter"}
      tone={sheetCount > 0 || sheetOpen ? "filled" : "default"}
      aria-expanded={sheetOpen}
      onClick={() => openSheet(!sheetOpen)}
    />
  );

  const closeSearch = () => {
    setQuery("");
    setSearchOpen(false);
  };

  // No meter: the status rail's counts already say how many are visited, not
  // visited and shared, and the bar beside them was the same numbers again.
  const hero = (
    <Hero
      title={!placesLoaded ? "Places" : collection.length === 0 ? "No places yet" : plural(collection.length, "place")}
      actions={
        searchOpen ? (
          <>
            {filterButton}
            <IconButton icon={X} label="Close search" onClick={closeSearch} />
          </>
        ) : (
        <>
          <IconButton
            icon={Search}
            label="Search places"
            tone={query ? "filled" : "default"}
            aria-expanded={false}
            onClick={() => setSearchOpen(true)}
          />
          {filterButton}
          <Menu
            label="Add places"
            placement="bottom-end"
            entries={[
              { id: "add", label: "Add a place", icon: MapPinPlus, onSelect: onAddPlace },
              { id: "file", label: "Import from file", icon: Upload, onSelect: onOpenUnifiedImport },
              {
                id: "ropewiki",
                label: refreshing ? "Importing from RopeWiki…" : "Import from RopeWiki",
                icon: CloudDownload,
                disabled: refreshing,
                onSelect: () => setConfirmRefresh(true),
              },
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
          label="Search by name or alternative name"
          value={query}
          autoFocus
          onChange={(event) => setQuery(event.target.value)}
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
        <ChipRail
          label="Place type"
          options={[
            // "Any type", not "All": the status rail below has its own "All".
            { value: ANY_TYPE, label: "Any type", count: typeCounts.any },
            ...typesWithPlaces.map((type) => {
              const count = typeCounts.byType.get(type.id) ?? 0;
              return {
                value: type.id,
                label: type.name,
                count,
                icon: placeTypeLucideIcon(type.iconKey),
                hue: type.color,
                disabled: count === 0 && filters.placeTypeId !== type.id,
              };
            }),
          ]}
          value={filters.placeTypeId ?? ANY_TYPE}
          onChange={(next) => onChangeFilters({ ...filters, placeTypeId: next === ANY_TYPE ? null : next })}
          trailing={<Chip label="New type" icon={Plus} dashed onClick={() => setActivePanel("settings")} />}
        />
      </div>
      {selecting ? (
        <SelectionBar countLabel={`${selected.length} selected`} onClear={clearSelection}>
          {/* An icon like its siblings: as a labelled filled button the bar ran
              past one line at 380px. The menu it opens says LiDAR topo or GeoPDF. */}
          <Menu
            label="Make a map"
            entries={makeMapEntries(selected)}
            trigger={(props) => <IconButton {...props} icon={MapIcon} label="Make a map" />}
          />
          <IconButton icon={Share2} label="Share or export" onClick={() => onSharePlaces(selected.map((place) => place.id))} />
          <Menu
            label="Export as"
            placement="bottom-end"
            entries={exportEntries(selected)}
            trigger={(props) => <IconButton {...props} icon={Download} label="Export" />}
          />
          <IconButton icon={Trash2} label="Delete" tone="danger" onClick={() => setPendingDelete(selected.map((place) => place.id))} />
        </SelectionBar>
      ) : (
        <ChipRail
          label="Status"
          options={[
            { value: "all", label: "All", count: statusCounts.all },
            ...PLACE_STATUS_ORDER.map((status) => ({
              value: status,
              label: PLACE_STATUS_LABELS[status],
              count: statusCounts[status],
              icon: STATUS_ICON[status],
              hue: STATUS_HUE[status],
              disabled: statusCounts[status] === 0 && bucket !== status,
            })),
          ]}
          value={bucket}
          onChange={(next) => onChangeFilters(withBucket(filters, next))}
        />
      )}
    </div>
  );

  const list = !placesLoaded ? (
    <div className={classes.emptyArea} role="status">
      <p className={classes.loading}>Loading your places…</p>
    </div>
  ) : collection.length === 0 ? (
      <div className={classes.emptyArea}>
        <EmptyState
          icon={MapPin}
          title="No places yet"
          body="Add a place on the map, or bring your list in from a file or RopeWiki. Places you add here reach Logjam GPS for offline use."
          actions={
            <>
              <Button compact variant="filled" icon={Plus} onClick={onAddPlace}>
                Add a place
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
          title="No places match"
          body="Nothing matches your search and filters. Clear them to see the rest."
          actions={
            <Button compact variant="outline" onClick={clearEverything}>
              Clear filters
            </Button>
          }
        />
      </div>
    ) : (
      <div ref={listRef} className={classes.list}>
        {visible.map((row) => {
          const { place, owned, status } = row;
          const isSelected = selectedIds.includes(place.id);
          const type = typeById.get(place.placeTypeId);
          const subtitle = [filters.placeTypeId == null ? type?.name : null, placeSummary(place)]
            .filter(Boolean)
            .join(" · ");
          const quality = qualityLabel(numericFieldValue(place.fieldValues, "quality"));
          const shareCount = owned ? (place._count?.shares ?? 0) : 0;
          const tile = <IconTile icon={STATUS_ICON[status]} hue={STATUS_HUE[status]} />;
          return (
            <Row
              key={`${owned ? "o" : "s"}-${place.id}`}
              data-place-id={place.id}
              className={classes.row}
              title={place.name}
              subtitle={subtitle || undefined}
              description={PLACE_STATUS_LABELS[status]}
              selected={isSelected}
              highlighted={highlightedId === place.id}
              disabled={selecting && !owned}
              onOpen={() => openPlace(place)}
              onPointerEnter={() => onHoverPlace(place.id)}
              onPointerLeave={() => onHoverPlace(null)}
              leading={
                owned ? (
                  <TileCheckbox
                    tile={tile}
                    label={`Select ${place.name}`}
                    checked={isSelected}
                    selecting={selecting}
                    onToggle={(extendRange) => toggleSelected(place.id, extendRange)}
                  />
                ) : (
                  <IconTile icon={STATUS_ICON[status]} hue={STATUS_HUE[status]} label={PLACE_STATUS_LABELS[status]} />
                )
              }
              trailing={
                <>
                  {quality && (
                    <span className={classes.meta} aria-label={`Rated ${quality.replace("★ ", "")}`}>
                      <Star size={12} aria-hidden />
                      {quality.replace("★ ", "")}
                    </span>
                  )}
                  {shareCount > 0 && (
                    <span className={classes.meta} title={`Shared with ${plural(shareCount, "friend")}`} aria-label={`Shared with ${plural(shareCount, "friend")}`}>
                      <Users size={12} aria-hidden />
                      {shareCount}
                    </span>
                  )}
                  {!selecting && (
                    <Menu
                      label={`Actions for ${place.name}`}
                      title={place.name}
                      placement="right-start"
                      entries={rowEntries(row)}
                      trigger={(props) => <IconButton {...props} icon={EllipsisVertical} label={`Actions for ${place.name}`} />}
                    />
                  )}
                </>
              }
            />
          );
        })}
      </div>
    );

  const sheet = sheetOpen && (
    <PlaceFilterSheet
      className={isNarrow ? classes.sheetNarrow : classes.sheet}
      filters={filters}
      onChangeFilters={onChangeFilters}
      sort={sort}
      onChangeSort={setSort}
      placeCustomFieldDefs={placeCustomFieldDefs}
      onDrawArea={onDrawFilterArea}
      onAreaToView={onFilterToMapView}
      onReset={() => onChangeFilters(clearSheetFilters(filters))}
      onClose={() => openSheet(false)}
      activeCount={sheetCount}
      resultCount={visible.length}
    />
  );

  return (
    <div ref={rootRef} className={classes.root}>
      {isNarrow && sheet ? (
        sheet
      ) : (
        <>
          {hero}
          {rails}
          {sheetCount > 0 && !sheetOpen && !selecting && (
            <div className={classes.strip}>
              <span className={classes.stripText}>
                {plural(sheetCount, "filter")} active{sort !== "name" ? ` · ${placeSortLabel(sort)}` : ""}
              </span>
              <IconButton
                icon={X}
                size={14}
                round
                label="Clear filters"
                onClick={() => onChangeFilters(clearSheetFilters(filters))}
              />
            </div>
          )}
          {collection.length > 0 && (
            <div className={classes.listHead}>
              <span>
                {selecting ? "Shift-click to select a range · Ctrl+A selects all" : `Sorted by ${placeSortLabel(sort).toLowerCase()}`}
              </span>
              <span>{visible.length}</span>
            </div>
          )}
          {/* The server caps the owned list; say when this is a truncated view so
              the oldest places aren't silently missing (UX-001). */}
          {placesTotal != null && placesTotal > places.length && (
            <p className={classes.note}>
              Showing your {places.length} most recent places of {placesTotal}. Older ones aren&rsquo;t loaded.
            </p>
          )}
          {list}
          {!isNarrow && sheet}
        </>
      )}

      <ConfirmDialog
        open={pendingDelete != null}
        title={pendingDelete?.length === 1 ? "Delete this place?" : `Delete ${pendingDelete?.length ?? 0} places?`}
        message="Their photos, tracks and shares go too. Trips that link to them stay in your logbook, unlinked. This can't be undone."
        confirmLabel="Delete"
        confirmColor="error"
        busy={deleting}
        onConfirm={() => void confirmDelete()}
        onClose={() => setPendingDelete(null)}
      />
      <ConfirmDialog
        open={confirmRefresh}
        title="Import from RopeWiki?"
        message="This fetches the public NSW canyon list from ropewiki.com and adds any canyons you don't already have, updating RopeWiki-sourced ones you haven't edited. Canyons that look like ones you already have are set aside for you to review before they're imported. Nothing you've edited is overwritten."
        confirmLabel="Fetch from RopeWiki"
        confirmColor="secondary"
        busy={refreshing}
        onConfirm={() => void importFromRopeWiki()}
        onClose={() => setConfirmRefresh(false)}
      />
      {refreshResult && (
        <RopeWikiReviewDialog
          open={reviewOpen}
          review={refreshResult.review}
          autoImported={{
            added: refreshResult.added,
            autoLinked: refreshResult.autoLinked,
            updated: refreshResult.updated,
          }}
          onClose={() => setReviewOpen(false)}
          onApplied={() => {
            setRefreshResult({ ...refreshResult, review: [] });
            onRefetch();
          }}
        />
      )}
    </div>
  );
}

export default PlacesPanel;
