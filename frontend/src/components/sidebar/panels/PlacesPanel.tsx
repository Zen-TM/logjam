import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  comparePlaces,
  contractSectionKeys,
  EMPTY_PLACE_FILTERS,
  numericFieldValue,
  passesPlaceFilters,
  PLACE_STATUS_LABELS,
  PLACE_STATUS_ORDER,
  PLACES_ADD,
  PLACES_ADD_ICON,
  PLACES_FILTER_SHEET,
  PLACES_LIST,
  placeDeleteConfirm,
  placeMatchesSearch,
  placesCountLabel,
  placesEmptyKind,
  placesEmptyState,
  placesFilterNote,
  placesHeroTitle,
  placeSortLabel,
  placeStatus,
  placeSummary,
  qualityLabel,
  type PlaceSortKey,
  type PlaceStatus,
  type RegionBbox,
  type ScopedCustomFieldDef,
  type SectionKeysOn,
} from "@logjam/shared";
import type {
  TFilters,
  TPlace,
  TPlaceType,
  RefreshResult,
} from "../../../placeUtils";
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
  Icon,
  IconButton,
  IconTile,
  Menu,
  Row,
  SearchField,
  SelectionBar,
  TileCheckbox,
  type Glyph,
  type MenuEntry,
} from "../../../ui";
import { placeTypeLucideIcon } from "./placeTypeIcon";
import PlaceFilterSheet from "./PlaceFilterSheet";
import { usePanelSheet } from "./usePanelSheet";
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
import { placeVerbEntries, type WebPlaceVerbId } from "./placeVerbMenu";
import classes from "./PlacesPanel.module.css";

const { copy } = PLACES_LIST;

export type MapKind = "topo" | "geopdf";

const STATUS_ICON: Record<PlaceStatus, Glyph> = {
  done: "success",
  todo: "place",
  shared: "friends",
};
const STATUS_HUE: Record<PlaceStatus, string> = {
  done: "var(--color-accent)",
  todo: "var(--hue-todo)",
  shared: "var(--hue-shared)",
};

const ANY_TYPE = "any";

type Listed = { place: TPlace; owned: boolean; status: PlaceStatus };

const plural = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

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
  onMakeMap,
  onSharePlaces,
  onPlaceVerb,
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
  onMakeMap: (bounds: RegionBbox, kind: MapKind) => void;
  onSharePlaces: (ids: string[]) => void;
  /** A row's verb that needs the place's page (a form, a confirm): the row
   *  opens the page and the page runs it. */
  onPlaceVerb: (id: WebPlaceVerbId) => void;
  /** Narrow web: grow the bottom sheet to full. */
  onExpandSheet?: () => void;
}) {
  const toast = useToast();
  const isNarrow = useIsMobile();
  // Session-scoped like the filters: a search remembered for a month reads as
  // "my places are missing" (UX finding 5). Sort is a preference and stays.
  const [query, setQuery] = useStoredState(
    "logjam.placeSearch",
    "",
    sessionStorage,
  );
  const [sort, setSort] = useStoredState<PlaceSortKey>(
    "logjam.placeSort",
    "name",
  );
  const [searchOpen, setSearchOpen] = useState(query !== "");
  const { sheetOpen, openSheet } = usePanelSheet({
    onOpenChange: onFiltersOpenChange,
    onExpandSheet,
  });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectionAnchor = useRef<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Status axes set by an older build that the rail cannot show are rewritten
  // to the chip they are nearest, so nothing narrows the list with no chip lit.
  useEffect(() => {
    const normalised = normaliseBucket(filters);
    if (normalised !== filters) onChangeFilters(normalised);
  }, [filters, onChangeFilters]);

  useEffect(() => {
    if (!openFiltersRequested) return;
    openSheet(true);
    onOpenFiltersConsumed();
  }, [openFiltersRequested, onOpenFiltersConsumed, openSheet]);
  useEffect(() => () => onHoverPlace(null), [onHoverPlace]);

  const typeById = useMemo(
    () => new Map(placeTypes.map((type) => [type.id, type])),
    [placeTypes],
  );

  const collection = useMemo<Listed[]>(
    () => [
      ...places.map((place) => ({
        place,
        owned: true,
        status: placeStatus(
          { syncRole: "owner" },
          place._count?.tripLogLinks ?? 0,
        ),
      })),
      ...sharedPlaces.map((place) => ({
        place,
        owned: false,
        status: "shared" as const,
      })),
    ],
    [places, sharedPlaces],
  );

  const matching = useCallback(
    (axes: TFilters) =>
      collection.filter(
        ({ place, owned }) =>
          placeMatchesSearch(place, query) &&
          passesPlaceFilters(place, axes, owned),
      ),
    [collection, query],
  );

  const visible = useMemo(
    () =>
      matching(filters).sort((a, b) => comparePlaces(a.place, b.place, sort)),
    [matching, filters, sort],
  );

  // Tallies come from the OTHER axes only, so a chip's count answers "how many
  // would I get if I pressed this" rather than restating the current view.
  const statusCounts = useMemo(() => {
    const counts: Record<StatusBucket, number> = {
      all: 0,
      done: 0,
      todo: 0,
      shared: 0,
    };
    for (const { status } of matching(withBucket(filters, "all"))) {
      counts[status] += 1;
      counts.all += 1;
    }
    return counts;
  }, [matching, filters]);

  const typeCounts = useMemo(() => {
    const withoutType = matching({ ...filters, placeTypeId: null });
    const counts = new Map<string, number>();
    for (const { place } of withoutType)
      counts.set(place.placeTypeId, (counts.get(place.placeTypeId) ?? 0) + 1);
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
  const selectableIds = useMemo(
    () => visible.filter((row) => row.owned).map((row) => row.place.id),
    [visible],
  );
  const selected = useMemo(() => {
    const picked = new Set(selectedIds);
    return visible
      .filter((row) => picked.has(row.place.id))
      .map((row) => row.place);
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
      {
        id: "topo",
        label: "LiDAR topo",
        icon: "lidar",
        onSelect: () => onMakeMap(bounds, "topo"),
      },
      {
        id: "geopdf",
        label: "GeoPDF",
        icon: "geoPdf",
        onSelect: () => onMakeMap(bounds, "geopdf"),
      },
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
        const { blob, filename } = buildPlaceExport(
          targets,
          format,
          placeCustomFieldDefs,
        );
        download(blob, filename);
      },
    }));

  // A place's verbs are one declaration (`PLACE_VERBS`); the row runs what it
  // can and hands the ones that need a form or a confirm to the place's page.
  const rowEntries = ({ place, owned }: Listed): MenuEntry[] => {
    const onPage = () => {
      openPlace(place);
    };
    const handOff = (id: WebPlaceVerbId) => () => {
      openPlace(place);
      onPlaceVerb(id);
    };
    const makeMap = (kind: MapKind) => () => {
      const bounds = placesBounds([place]);
      if (bounds) onMakeMap(bounds, kind);
    };
    const run: Record<WebPlaceVerbId, () => void> = {
      open: onPage,
      show: () => onFlyToPlace(place.latitude, place.longitude),
      logTrip: handOff("logTrip"),
      edit: handOff("edit"),
      makeTopo: makeMap("topo"),
      makeGeoPdf: makeMap("geopdf"),
      share: () => onSharePlaces([place.id]),
      copy: handOff("copy"),
      copyAndRemove: handOff("copyAndRemove"),
      remove: handOff("remove"),
      delete: () => setPendingDelete([place.id]),
    };
    return placeVerbEntries("row", owned, (id) => run[id]());
  };

  async function confirmDelete() {
    if (!pendingDelete) return;
    const count = pendingDelete.length;
    setDeleting(true);
    try {
      await bulkDeletePlaces(pendingDelete);
      toast.success(`Deleted ${placesCountLabel(count)}.`);
      setPendingDelete(null);
      clearSelection();
      onQuotaChanged();
      onRefetch();
    } catch (err) {
      console.error(err);
      toast.error(
        messageFromError(
          err,
          count === 1
            ? "Couldn't delete that place."
            : "Couldn't delete those places.",
        ),
      );
    } finally {
      setDeleting(false);
    }
  }

  // ── RopeWiki ─────────────────────────────────────────────────────────
  const [confirmRefresh, setConfirmRefresh] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshResult, setRefreshResult] = useState<RefreshResult | null>(
    null,
  );
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
      const review =
        result.review.length > 0
          ? ` · ${plural(result.review.length, "possible duplicate")} to review`
          : "";
      const source = result.sourceUpdatedAt
        ? ` · source ${new Date(result.sourceUpdatedAt).toLocaleDateString()}`
        : "";
      toast.success(
        `RopeWiki import: ${done.length > 0 ? done.join(", ") : "no new places"}${review}${source}`,
      );
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
      icon="filter"
      label={
        sheetCount > 0
          ? `${PLACES_FILTER_SHEET.title}, ${plural(sheetCount, "filter")} on`
          : PLACES_FILTER_SHEET.title
      }
      tone={sheetCount > 0 || sheetOpen ? "filled" : "default"}
      aria-expanded={sheetOpen}
      onClick={() => openSheet(!sheetOpen)}
    />
  );

  const closeSearch = () => {
    setQuery("");
    setSearchOpen(false);
  };

  const addEntries: Record<
    SectionKeysOn<typeof PLACES_ADD, "web">,
    { label: string; onSelect: () => void; disabled?: boolean }
  > = {
    add: { label: PLACES_ADD.copy.add, onSelect: onAddPlace },
    importFile: {
      label: PLACES_ADD.copy.importFile,
      onSelect: onOpenUnifiedImport,
    },
    importRopewiki: {
      label: refreshing
        ? PLACES_ADD.copy.importingRopewiki
        : PLACES_ADD.copy.importRopewiki,
      disabled: refreshing,
      onSelect: () => setConfirmRefresh(true),
    },
  };

  // No meter: the status rail's counts already say how many are visited, not
  // visited and shared, and the bar beside them was the same numbers again.
  const hero = (
    <Hero
      title={!placesLoaded ? "Places" : placesHeroTitle(collection.length)}
      actions={
        searchOpen ? (
          <>
            {filterButton}
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
              tone={query ? "filled" : "default"}
              aria-expanded={false}
              onClick={() => setSearchOpen(true)}
            />
            {filterButton}
            <Menu
              label={PLACES_ADD.copy.menu}
              placement="bottom-end"
              entries={contractSectionKeys(PLACES_ADD, "web").map((key) => ({
                id: key,
                icon: PLACES_ADD_ICON[key],
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
                  {PLACES_ADD.title}
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

  const typeRail = (
    <div className={classes.typeRail}>
      <div className={selecting ? classes.inert : undefined} inert={selecting}>
        <ChipRail
          label={copy.typeRail}
          options={[
            { value: ANY_TYPE, label: copy.anyType, count: typeCounts.any },
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
          onChange={(next) =>
            onChangeFilters({
              ...filters,
              placeTypeId: next === ANY_TYPE ? null : next,
            })
          }
          trailing={
            <Chip
              label={copy.newType}
              icon="add"
              dashed
              onClick={() => setActivePanel("settings")}
            />
          }
        />
      </div>
    </div>
  );

  const statusRail = (
    <div className={classes.statusRail}>
      {selecting ? (
        <SelectionBar
          countLabel={`${selected.length} selected`}
          onClear={clearSelection}
        >
          {/* An icon like its siblings: as a labelled filled button the bar ran
              past one line at 380px. The menu it opens says LiDAR topo or GeoPDF. */}
          <Menu
            label="Make a map"
            entries={makeMapEntries(selected)}
            trigger={(props) => (
              <IconButton {...props} icon="template" label="Make a map" />
            )}
          />
          <IconButton
            icon="shareFriend"
            label="Share or export"
            onClick={() => onSharePlaces(selected.map((place) => place.id))}
          />
          <Menu
            label="Export as"
            placement="bottom-end"
            entries={exportEntries(selected)}
            trigger={(props) => (
              <IconButton {...props} icon="export" label="Export" />
            )}
          />
          <IconButton
            icon="delete"
            label="Delete"
            tone="danger"
            onClick={() => setPendingDelete(selected.map((place) => place.id))}
          />
        </SelectionBar>
      ) : (
        <ChipRail
          label={copy.statusRail}
          options={[
            { value: "all", label: copy.allStatuses, count: statusCounts.all },
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

  const empty =
    placesLoaded && visible.length === 0
      ? placesEmptyKind({
          total: collection.length,
          filtering: query.trim() !== "" || sheetCount > 0,
          bucket,
        })
      : null;
  const emptyState = empty && placesEmptyState(empty, { platform: "web" });

  const list = !placesLoaded ? (
    <div className={classes.emptyArea} role="status">
      <p className={classes.loading}>{copy.loading}</p>
    </div>
  ) : empty && emptyState ? (
    <div className={classes.emptyArea}>
      <EmptyState
        icon={emptyState.icon}
        title={emptyState.title}
        body={emptyState.body}
        actions={
          emptyState.action === "clear" ? (
            <Button compact variant="outline" onClick={clearEverything}>
              {copy.clearFilters}
            </Button>
          ) : emptyState.action === "add" ? (
            <>
              <Button compact variant="filled" icon="add" onClick={onAddPlace}>
                {PLACES_ADD.copy.add}
              </Button>
              {empty === "firstRun" && (
                <Button
                  compact
                  variant="outline"
                  icon={PLACES_ADD_ICON.importFile}
                  onClick={onOpenUnifiedImport}
                >
                  {PLACES_ADD.copy.importFile}
                </Button>
              )}
            </>
          ) : undefined
        }
      />
    </div>
  ) : (
    <div className={classes.list}>
      {visible.map((row) => {
        const { place, owned, status } = row;
        const isSelected = selectedIds.includes(place.id);
        const type = typeById.get(place.placeTypeId);
        const subtitle = [
          filters.placeTypeId == null ? type?.name : null,
          placeSummary(place),
        ]
          .filter(Boolean)
          .join(" · ");
        const quality = qualityLabel(
          numericFieldValue(place.fieldValues, "quality"),
        );
        const shareCount = owned ? (place._count?.shares ?? 0) : 0;
        const tile = (
          <IconTile icon={STATUS_ICON[status]} hue={STATUS_HUE[status]} />
        );
        return (
          <Row
            key={`${owned ? "o" : "s"}-${place.id}`}
            data-place-id={place.id}
            title={place.name}
            subtitle={subtitle || undefined}
            description={PLACE_STATUS_LABELS[status]}
            selected={isSelected}
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
                  onToggle={(extendRange) =>
                    toggleSelected(place.id, extendRange)
                  }
                />
              ) : (
                <IconTile
                  icon={STATUS_ICON[status]}
                  hue={STATUS_HUE[status]}
                  label={PLACE_STATUS_LABELS[status]}
                />
              )
            }
            trailing={
              <>
                {quality && (
                  <span
                    className={classes.meta}
                    aria-label={`Rated ${quality.replace("★ ", "")}`}
                  >
                    <Icon idea="favourite" size={12} aria-hidden />
                    {quality.replace("★ ", "")}
                  </span>
                )}
                {shareCount > 0 && (
                  <span
                    className={classes.meta}
                    title={`Shared with ${plural(shareCount, "friend")}`}
                    aria-label={`Shared with ${plural(shareCount, "friend")}`}
                  >
                    <Icon idea="friends" size={12} aria-hidden />
                    {shareCount}
                  </span>
                )}
                {!selecting && (
                  <Menu
                    label={`Actions for ${place.name}`}
                    title={place.name}
                    placement="right-start"
                    entries={rowEntries(row)}
                    trigger={(props) => (
                      <IconButton
                        {...props}
                        icon="overflow"
                        label={`Actions for ${place.name}`}
                      />
                    )}
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

  const note = placesFilterNote(sheetCount, sort);

  // The page, section by section, in the order its contract gives. Exhaustive
  // by type: a section the contract names cannot be left out, and one it does
  // not name cannot be drawn.
  const sections: Record<
    SectionKeysOn<typeof PLACES_LIST, "web">,
    ReactNode
  > = {
    hero,
    typeRail,
    statusRail,
    filterNote: sheetCount > 0 && !sheetOpen && !selecting && (
      <div className={classes.strip}>
        <span className={classes.stripText}>{note}</span>
        <IconButton
          icon="close"
          size={14}
          round
          label={copy.clearFilters}
          onClick={() => onChangeFilters(clearSheetFilters(filters))}
        />
      </div>
    ),
    listHead: collection.length > 0 && (
      <div className={classes.listHead}>
        <span>
          {selecting
            ? "Shift-click to select a range · Ctrl+A selects all"
            : `Sorted by ${placeSortLabel(sort).toLowerCase()}`}
        </span>
        <span>{visible.length}</span>
      </div>
    ),
    // The server caps the owned list; say when this is a truncated view so
    // the oldest places aren't silently missing.
    truncated: placesTotal != null && placesTotal > places.length && (
      <p className={classes.note}>
        Showing your {places.length} most recent places of {placesTotal}. Older
        ones aren&rsquo;t loaded.
      </p>
    ),
    list,
  };

  const deleteCopy = placeDeleteConfirm({ count: pendingDelete?.length ?? 0 });

  return (
    <div ref={rootRef} className={classes.root}>
      {isNarrow && sheet ? (
        sheet
      ) : (
        <>
          {contractSectionKeys(PLACES_LIST, "web").map((key) => (
            <Fragment key={key}>{sections[key]}</Fragment>
          ))}
          {!isNarrow && sheet}
        </>
      )}

      <ConfirmDialog
        open={pendingDelete != null}
        title={deleteCopy.confirmTitle}
        message={deleteCopy.confirmBody}
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
