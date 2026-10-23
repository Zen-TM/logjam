import {
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import {
  contractSectionKeys,
  MAP_LAYERS,
  MAP_TERRAIN,
  PLACE_TYPE_COLORS,
  takesNswContours,
  type RegionBbox,
  type SectionKeysOn,
  type SlopeBand,
  type TerrainLayerKey,
} from "@logjam/shared";
import { TOPO_LAYERS, type CompletedTopoJob } from "../../topoLayerTypes";
import { PROTOMAPS_SWATCH } from "../../basemapSwatch";
import { previewUrlFor, type TileLayer } from "../sidebar/panels/tilePreview";
import { boundsIntersect, footprintBounds } from "./topoFootprint";
import SlopeSettings from "../dialogs/topoSettings/SlopeSettings";
import { nextEnabledIndex } from "../../ui/rovingFocus";
import {
  Chip,
  ChipRail,
  IconButton,
  IconTile,
  Popover,
  Row,
  SearchField,
  Toggle,
  Icon,
  InfoTip,
  type Glyph,
} from "../../ui";
import classes from "./LayersPopover.module.css";

type BaseLayer = TileLayer & { id: string; name: string };
type Setter<T> = (value: T | ((prev: T) => T)) => void;
type View = "overlays" | "basemap" | "terrain" | "topos" | "slopeBands";

// A layer-row descriptor, shown as the row's info tooltip. Only vegetation needs
// one: its orange crosshatch (fire more recent than the survey) is the least
// intuitive symbol and carries no other label.
const LAYER_DESCRIPTIONS: Partial<Record<string, string>> = {
  vegetation:
    "Estimated vegetation density for bushbashing — denser scrub renders darker. " +
    "Orange crosshatching marks areas burnt more recently than the LiDAR survey, " +
    "so the estimate there may be out of date.",
};

const copy = MAP_LAYERS.copy;
const terrainCopy = MAP_TERRAIN.copy;

const countOf = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

const TOPO_DATE = new Intl.DateTimeFormat("en-AU", {
  month: "short",
  year: "numeric",
});

/** A drawn scrap of the vector basemap's own palette — land, a creek, a road
 *  and a lane — because a vector basemap has no XYZ tile to thumbnail. */
function VectorSwatch() {
  return (
    <svg
      className={classes.thumb}
      viewBox="0 0 40 40"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <rect width="40" height="40" fill={PROTOMAPS_SWATCH.earth} />
      <path
        d="M-2 27 C 8 22, 12 32, 22 27 S 34 18, 42 22"
        fill="none"
        stroke={PROTOMAPS_SWATCH.water}
        strokeWidth="3"
      />
      <path
        d="M-2 14 L 42 9"
        stroke={PROTOMAPS_SWATCH.road}
        strokeWidth="3.5"
      />
      <path
        d="M14 -2 L 20 42"
        stroke={PROTOMAPS_SWATCH.minor}
        strokeWidth="2"
      />
    </svg>
  );
}

/**
 * What is drawn on the map, in a popover over it — not a page, because it is a
 * question about the map. Two views (Basemap, Overlays); an overlay with more
 * inside it than a switch (LiDAR topos) opens a sub-view in place, so twenty
 * topos cost a scroll inside that view rather than a screen of rows here.
 */
/**
 * The jobs that have an overlay to switch. A sharpened job with no
 * vegetation has none: its area is terrain, drawn by the Terrain group, so it
 * gets no switch (LayersPopover.test.ts).
 */
export function jobsWithOverlays(
  jobs: readonly CompletedTopoJob[],
): CompletedTopoJob[] {
  return jobs.filter((job) => job.layers.length > 0);
}

export default function LayersPopover({
  open,
  onClose,
  anchorRef,
  showPlaces,
  setShowPlaces,
  showWays,
  setShowWays,
  placeCount,
  wayCount,
  lidarEnabled,
  setLidarEnabled,
  lidarLayerToggles,
  setLidarLayerToggles,
  lidarLayerOrder,
  setLidarLayerOrder,
  unavailableTopoLayerNames,
  completedTopoJobs,
  lidarJobToggles,
  setLidarJobToggles,
  mapBounds,
  baseLayers,
  activeLayerId,
  onActiveLayerChange,
  terrainLayers,
  onTerrainLayerChange,
  slopeBands,
  onSlopeBandsChange,
  mapView,
  onImportFile,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  showPlaces: boolean;
  setShowPlaces: (v: boolean) => void;
  showWays: boolean;
  setShowWays: (v: boolean) => void;
  /** Every place drawn: the user's own and the ones shared with them. */
  placeCount: number;
  /** Null while the lines are not loaded (they load with their layer). */
  wayCount: number | null;
  lidarEnabled: boolean;
  setLidarEnabled: (v: boolean) => void;
  lidarLayerToggles: Record<string, boolean>;
  setLidarLayerToggles: Setter<Record<string, boolean>>;
  lidarLayerOrder: string[];
  setLidarLayerOrder: Setter<string[]>;
  /** Layer names whose PMTiles failed to load for at least one job. */
  unavailableTopoLayerNames: Set<string>;
  completedTopoJobs: CompletedTopoJob[];
  lidarJobToggles: Record<string, boolean>;
  setLidarJobToggles: Setter<Record<string, boolean>>;
  mapBounds: RegionBbox | null;
  baseLayers: readonly BaseLayer[];
  activeLayerId: string;
  onActiveLayerChange: (id: string) => void;
  terrainLayers: Readonly<Record<TerrainLayerKey, boolean>>;
  onTerrainLayerChange: (key: TerrainLayerKey, on: boolean) => void;
  slopeBands: SlopeBand[];
  onSlopeBandsChange: (bands: SlopeBand[]) => void;
  mapView: { lng: number; lat: number; zoom: number } | null;
  /** Opens the importer (the same entry the Ways and Logs lists use). */
  onImportFile: () => void;
}) {
  const [view, setView] = useState<View>("overlays");

  const overlayJobs = jobsWithOverlays(completedTopoJobs);
  const shownJobs = overlayJobs.filter(
    (job) => lidarJobToggles[job.jobId] ?? true,
  );
  const shownLayerLabels = lidarLayerOrder
    .filter((name) => lidarLayerToggles[name])
    .map(
      (name) =>
        TOPO_LAYERS.find((layer) => layer.name === name)?.label.toLowerCase() ??
        name,
    );
  const overlaysOn = [showPlaces, showWays, lidarEnabled].filter(
    Boolean,
  ).length;

  const close = () => {
    setView("overlays");
    onClose();
  };

  return (
    <Popover
      open={open}
      onClose={close}
      anchorRef={anchorRef}
      label={
        view === "topos"
          ? "LiDAR topos"
          : view === "slopeBands"
            ? terrainCopy.slopeBands
            : "Map layers"
      }
      className={classes.popover}
      // Both views carry their own × in the header.
      closeButton={false}
    >
      {view === "topos" ? (
        <ToposView
          onBack={() => setView("overlays")}
          onClose={close}
          lidarEnabled={lidarEnabled}
          setLidarEnabled={setLidarEnabled}
          jobs={overlayJobs}
          shownCount={shownJobs.length}
          lidarJobToggles={lidarJobToggles}
          setLidarJobToggles={setLidarJobToggles}
          lidarLayerToggles={lidarLayerToggles}
          setLidarLayerToggles={setLidarLayerToggles}
          lidarLayerOrder={lidarLayerOrder}
          setLidarLayerOrder={setLidarLayerOrder}
          unavailableTopoLayerNames={unavailableTopoLayerNames}
          mapBounds={mapBounds}
        />
      ) : view === "slopeBands" ? (
        <SlopeBandsView
          onBack={() => setView("terrain")}
          onClose={close}
          bands={slopeBands}
          onChange={onSlopeBandsChange}
        />
      ) : (
        <>
          <div className={classes.head}>
            <ChipRail
              label="Layers view"
              className={classes.grow}
              options={contractSectionKeys(MAP_LAYERS, "web").map((key) =>
                key === "basemap"
                  ? { value: key, label: copy.tabBasemap, icon: "map" as const }
                  : key === "terrain"
                    ? { value: key, label: copy.tabTerrain }
                    : {
                        value: key,
                        label: copy.tabOverlays,
                        count: overlaysOn,
                      },
              )}
              value={view}
              onChange={setView}
            />
            <IconButton icon="close" label="Close" onClick={close} />
          </div>
          {/* Exhaustive by type: a tab the contract names and this popover
              does not draw, or the reverse, fails `tsc` (`MAP_LAYERS`). */}
          {(() => {
            const panes: Record<
              SectionKeysOn<typeof MAP_LAYERS, "web">,
              () => ReactNode
            > = {
              basemap: () => (
                <BasemapGallery
                  layers={baseLayers}
                  activeLayerId={activeLayerId}
                  onChange={onActiveLayerChange}
                  mapView={mapView}
                />
              ),
              terrain: () => (
                <TerrainPane
                  layers={terrainLayers}
                  onChange={onTerrainLayerChange}
                  activeLayerId={activeLayerId}
                  onOpenSlopeBands={() => setView("slopeBands")}
                />
              ),
              overlays: () => (
                <div className={classes.body}>
                  {/* TWO overlays for the user's own data, and they divide it by
                            WHAT A THING IS: a pin is a place, a line is a way. Nothing
                            belongs to both, so no toggle overlaps another and there is
                            nothing to explain.

                            Ownership deliberately does NOT split them. It was tried
                            (Your places / Shared with you, then Ways / Shared ways) and
                            it splits the wrong axis: "mine" and "shared with me" are the
                            same KIND of thing drawn the same way, so two rows say one
                            thing twice — while any three-row arrangement that keeps a
                            "Shared with you" row makes a shared place answer to two
                            toggles at once. Whose a thing is is already on the thing
                            itself: on the map FILL is the type and the RING is sharing
                            (shared/DESIGN.md), and every list marks a shared row. A legend
                            says what kind; the pin says whose (operator, 2026-09-17). */}
                  <OverlayRow
                    icon="place"
                    hue={PLACE_TYPE_COLORS[0]}
                    title={copy.places}
                    subtitle={countOf(placeCount, "place")}
                    checked={showPlaces}
                    onToggle={setShowPlaces}
                  />
                  {/* "Ways" rather than "Routes": it draws every line there is —
                            routes drawn here, files imported or recorded, and the tracks
                            on places friends shared. Those files used to be drawn by a
                            per-item switch buried on each one's detail page, which is a
                            control you had to open a page to find. */}
                  <OverlayRow
                    icon="route"
                    hue="var(--hue-route)"
                    title={copy.ways}
                    subtitle={
                      wayCount == null
                        ? "Every line you have"
                        : countOf(wayCount, "way")
                    }
                    checked={showWays}
                    onToggle={setShowWays}
                  />
                  {overlayJobs.length === 0 ? (
                    <Row
                      leading={
                        <IconTile icon="lidar" hue="var(--hue-overlay)" />
                      }
                      title={copy.lidarTopos}
                      subtitle="None yet. Make one from Maps."
                    />
                  ) : (
                    <OverlayRow
                      icon="lidar"
                      hue="var(--hue-overlay)"
                      title={copy.lidarTopos}
                      subtitle={[
                        `${shownJobs.length} of ${overlayJobs.length} shown`,
                        shownLayerLabels.join(", ") || "no layers",
                      ].join(" · ")}
                      checked={lidarEnabled}
                      onToggle={setLidarEnabled}
                      onOpen={() => setView("topos")}
                      openLabel="Choose topos and layers"
                    />
                  )}
                  {/* The list ends with the way to add to it: the same
                      import the Ways and Logs lists offer. */}
                  <Row
                    leading={
                      <IconTile icon="upload" hue="var(--color-neutral)" />
                    }
                    title={copy.importFile}
                    onOpen={() => {
                      onClose();
                      onImportFile();
                    }}
                  />
                </div>
              ),
            };
            return panes[view as keyof typeof panes]();
          })()}
        </>
      )}
    </Popover>
  );
}

/** The Terrain group: one switch per layer, in `MAP_TERRAIN`'s order. */
export function TerrainPane({
  layers,
  onChange,
  activeLayerId,
  onOpenSlopeBands,
}: {
  layers: Readonly<Record<TerrainLayerKey, boolean>>;
  onChange: (key: TerrainLayerKey, on: boolean) => void;
  activeLayerId: string;
  onOpenSlopeBands: () => void;
}) {
  // One shape for all three, so the Slope row's chevron is the only difference.
  const row = (key: TerrainLayerKey, extra: ReactNode = null) => {
    const title = terrainCopy[key];
    const printed = key === "contours" && !takesNswContours(activeLayerId);
    return (
      <Row
        key={key}
        title={title}
        subtitle={printed ? terrainCopy.contoursPrinted : undefined}
        trailing={
          <>
            {extra}
            <Toggle
              checked={layers[key]}
              onChange={(on) => onChange(key, on)}
              label={`Show ${title.toLowerCase()}`}
              disabled={printed}
            />
          </>
        }
      />
    );
  };
  const panes: Record<
    SectionKeysOn<typeof MAP_TERRAIN, "web">,
    () => ReactNode
  > = {
    contours: () => row("contours"),
    slope: () =>
      row(
        "slope",
        <IconButton
          icon="disclosure"
          label={terrainCopy.slopeBands}
          onClick={onOpenSlopeBands}
        />,
      ),
    hillshade: () => row("hillshade"),
    // Opened from the Slope row's chevron, as a view of its own.
    slopeBands: () => null,
  };
  return (
    <div className={classes.body}>
      {contractSectionKeys(MAP_TERRAIN, "web").map((key) => panes[key]())}
    </div>
  );
}

/** The bands the statewide slope is drawn in, edited while the map redraws. */
function SlopeBandsView({
  onBack,
  onClose,
  bands,
  onChange,
}: {
  onBack: () => void;
  onClose: () => void;
  bands: SlopeBand[];
  onChange: (bands: SlopeBand[]) => void;
}) {
  return (
    <>
      <div className={classes.head}>
        <IconButton icon="back" label="Back to terrain" onClick={onBack} />
        <div className={classes.titleBlock}>
          <span className={classes.title}>{terrainCopy.slopeBands}</span>
        </div>
        <IconButton icon="close" label="Close" onClick={onClose} />
      </div>
      <div className={classes.body}>
        <SlopeSettings
          value={{ enabled: true, bands }}
          onChange={(next) => onChange(next.bands)}
        />
      </div>
    </>
  );
}

function OverlayRow({
  icon,
  hue,
  title,
  subtitle,
  checked,
  onToggle,
  onOpen,
  openLabel,
}: {
  icon: Glyph;
  hue: string;
  title: string;
  subtitle: string;
  checked: boolean;
  onToggle: (next: boolean) => void;
  onOpen?: () => void;
  openLabel?: string;
}) {
  return (
    <Row
      leading={<IconTile icon={icon} hue={hue} />}
      title={title}
      subtitle={subtitle}
      trailing={
        <>
          {onOpen && (
            <IconButton
              icon="disclosure"
              label={openLabel ?? title}
              onClick={onOpen}
            />
          )}
          <Toggle
            checked={checked}
            onChange={onToggle}
            label={`Show ${title.toLowerCase()}`}
          />
        </>
      }
    />
  );
}

function BasemapGallery({
  layers,
  activeLayerId,
  onChange,
  mapView,
}: {
  layers: readonly BaseLayer[];
  activeLayerId: string;
  onChange: (id: string) => void;
  mapView: { lng: number; lat: number; zoom: number } | null;
}) {
  const tileRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const activeIndex = layers.findIndex((layer) => layer.id === activeLayerId);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const from = tileRefs.current.findIndex(
      (tile) => tile === document.activeElement,
    );
    const to = nextEnabledIndex(
      layers.map(() => false),
      from,
      event.key,
    );
    if (to == null) return;
    event.preventDefault();
    tileRefs.current[to]?.focus();
    onChange(layers[to].id);
  }

  return (
    <div
      role="radiogroup"
      aria-label="Map"
      tabIndex={-1}
      className={classes.gallery}
      onKeyDown={onKeyDown}
    >
      {layers.map((layer, index) => {
        const active = layer.id === activeLayerId;
        const thumbnail =
          mapView && layer.tiles.length > 0
            ? previewUrlFor(layer, mapView)
            : null;
        return (
          <button
            key={layer.id}
            ref={(tile) => {
              tileRefs.current[index] = tile;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={index === (activeIndex < 0 ? 0 : activeIndex) ? 0 : -1}
            className={classes.tile}
            onClick={() => onChange(layer.id)}
          >
            {thumbnail ? (
              <img
                src={thumbnail}
                alt=""
                className={classes.thumb}
                draggable={false}
              />
            ) : (
              <VectorSwatch />
            )}
            <span className={classes.caption}>{layer.name}</span>
          </button>
        );
      })}
    </div>
  );
}

function ToposView({
  onBack,
  onClose,
  lidarEnabled,
  setLidarEnabled,
  jobs,
  shownCount,
  lidarJobToggles,
  setLidarJobToggles,
  lidarLayerToggles,
  setLidarLayerToggles,
  lidarLayerOrder,
  setLidarLayerOrder,
  unavailableTopoLayerNames,
  mapBounds,
}: {
  onBack: () => void;
  onClose: () => void;
  lidarEnabled: boolean;
  setLidarEnabled: (v: boolean) => void;
  jobs: CompletedTopoJob[];
  shownCount: number;
  lidarJobToggles: Record<string, boolean>;
  setLidarJobToggles: Setter<Record<string, boolean>>;
  lidarLayerToggles: Record<string, boolean>;
  setLidarLayerToggles: Setter<Record<string, boolean>>;
  lidarLayerOrder: string[];
  setLidarLayerOrder: Setter<string[]>;
  unavailableTopoLayerNames: Set<string>;
  mapBounds: RegionBbox | null;
}) {
  const [tab, setTab] = useState<"topos" | "layers">("topos");
  const [scope, setScope] = useState<"view" | "all">("view");
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");

  // "In this view" is a footprint test against the map's current bounds, done
  // here rather than by the server: the footprints are already on the client.
  const inView = useMemo(
    () =>
      mapBounds
        ? jobs.filter(
            (job) =>
              job.footprint &&
              boundsIntersect(footprintBounds(job.footprint), mapBounds),
          )
        : jobs,
    [jobs, mapBounds],
  );
  const needle = query.trim().toLowerCase();
  const listed = (scope === "view" ? inView : jobs).filter((job) =>
    (job.name ?? "Untitled topo").toLowerCase().includes(needle),
  );

  return (
    <>
      <div className={classes.head}>
        <IconButton icon="back" label="Back to overlays" onClick={onBack} />
        <div className={classes.titleBlock}>
          <span className={classes.title}>LiDAR topos</span>
          <span className={classes.subtitle}>
            {shownCount} of {jobs.length} shown
          </span>
        </div>
        <Toggle
          checked={lidarEnabled}
          onChange={setLidarEnabled}
          label="Show LiDAR topos"
        />
        <IconButton icon="close" label="Close" onClick={onClose} />
      </div>
      <div className={classes.body}>
        <ChipRail
          label="Topos or layers"
          options={[
            { value: "topos", label: "Topos", count: jobs.length },
            { value: "layers", label: "Layers", count: lidarLayerOrder.length },
          ]}
          value={tab}
          onChange={setTab}
        />
        {tab === "topos" ? (
          <>
            <div className={classes.scopeLine}>
              {searching ? (
                <SearchField
                  label="Search topos"
                  value={query}
                  autoFocus
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Escape") return;
                    event.stopPropagation();
                    setQuery("");
                    setSearching(false);
                  }}
                />
              ) : (
                <ChipRail
                  label="Which topos"
                  className={classes.grow}
                  options={[
                    {
                      value: "view",
                      label: "In this view",
                      count: inView.length,
                      icon: "scan",
                    },
                    { value: "all", label: "All", count: jobs.length },
                  ]}
                  value={scope}
                  onChange={setScope}
                />
              )}
              <IconButton
                icon={searching ? "close" : "search"}
                label={searching ? "Close search" : "Search topos"}
                tone={query ? "filled" : "default"}
                onClick={() => {
                  if (searching) setQuery("");
                  setSearching(!searching);
                }}
              />
            </div>
            {listed.length === 0 ? (
              <div className={classes.emptyLine}>
                <span>
                  {needle ? "No topos match." : "No topos in this view."}
                </span>
                {scope === "view" && !needle && (
                  <Chip
                    label="Show all"
                    count={jobs.length}
                    onClick={() => setScope("all")}
                  />
                )}
              </div>
            ) : (
              <ul className={classes.list}>
                {listed.map((job) => {
                  const name = job.name ?? "Untitled topo";
                  return (
                    <li key={job.jobId} className={classes.listRow}>
                      <span className={classes.dot} aria-hidden />
                      <span className={classes.titleBlock}>
                        <span className={classes.listName}>{name}</span>
                        <span className={classes.subtitle}>
                          {TOPO_DATE.format(new Date(job.createdAt))}
                          {job.syncRole === "shared"
                            ? " · Shared with you"
                            : ""}
                        </span>
                      </span>
                      <Toggle
                        checked={lidarJobToggles[job.jobId] ?? true}
                        onChange={(next) =>
                          setLidarJobToggles((prev) => ({
                            ...prev,
                            [job.jobId]: next,
                          }))
                        }
                        label={`Show ${name}`}
                        disabled={!lidarEnabled}
                      />
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        ) : (
          <LayerOrder
            order={lidarLayerOrder}
            setOrder={setLidarLayerOrder}
            toggles={lidarLayerToggles}
            setToggles={setLidarLayerToggles}
            unavailable={unavailableTopoLayerNames}
            disabled={!lidarEnabled}
          />
        )}
      </div>
    </>
  );
}

/** The topo layers, drawn top-to-bottom in this order, applying to every topo.
 *  Reorder by dragging the grip or with ↑/↓ on it (WCAG 2.5.7). */
function LayerOrder({
  order,
  setOrder,
  toggles,
  setToggles,
  unavailable,
  disabled,
}: {
  order: string[];
  setOrder: Setter<string[]>;
  toggles: Record<string, boolean>;
  setToggles: Setter<Record<string, boolean>>;
  unavailable: Set<string>;
  disabled: boolean;
}) {
  const dragFrom = useRef<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length || from === to) return;
    setOrder((prev) => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  };

  return (
    <>
      <span className={classes.caption}>
        Drawn top to bottom, on every topo
      </span>
      <ul className={classes.list}>
        {order.map((name, index) => {
          const label =
            TOPO_LAYERS.find((layer) => layer.name === name)?.label ?? name;
          const description = LAYER_DESCRIPTIONS[name];
          return (
            <li
              key={name}
              className={classes.listRow}
              data-drop-target={dropAt === index}
              draggable
              onDragStart={() => {
                dragFrom.current = index;
              }}
              onDragOver={(event) => {
                event.preventDefault();
                setDropAt(index);
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (dragFrom.current != null) move(dragFrom.current, index);
                dragFrom.current = null;
                setDropAt(null);
              }}
              onDragEnd={() => {
                dragFrom.current = null;
                setDropAt(null);
              }}
            >
              <button
                type="button"
                className={classes.grip}
                aria-label={`Reorder ${label}, position ${index + 1} of ${order.length}. Use the up and down arrow keys.`}
                title="Drag, or focus and use ↑/↓"
                onKeyDown={(event) => {
                  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                    event.preventDefault();
                    move(index, index + (event.key === "ArrowUp" ? -1 : 1));
                  }
                }}
              >
                <Icon idea="dragHandle" size={16} aria-hidden />
              </button>
              <span className={classes.titleBlock}>
                <span className={classes.listName}>
                  {label}
                  {description && (
                    <InfoTip label={label} content={description} />
                  )}
                </span>
                {unavailable.has(name) && (
                  <span className={classes.warning}>
                    Files missing for some topos — re-run them to restore
                  </span>
                )}
              </span>
              <Toggle
                checked={toggles[name] ?? true}
                onChange={(next) =>
                  setToggles((prev) => ({ ...prev, [name]: next }))
                }
                label={`Show ${label}`}
                disabled={disabled}
              />
            </li>
          );
        })}
      </ul>
    </>
  );
}
