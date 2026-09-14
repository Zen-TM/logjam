import { useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import {
  ArrowLeft,
  ChevronRight,
  GripVertical,
  Info,
  Map as MapIcon,
  MapPin,
  Mountain,
  Route,
  Scan,
  Search,
  Spline,
  Users,
  X,
} from "lucide-react";
import type { RegionBbox } from "@logjam/shared";
import { TOPO_LAYERS, type CompletedTopoJob } from "../../topoLayerTypes";
import { PROTOMAPS_SWATCH } from "../../basemapSwatch";
import { previewUrlFor, type TileLayer } from "../sidebar/panels/tilePreview";
import { boundsIntersect, footprintBounds } from "./topoFootprint";
import { nextEnabledIndex } from "../../ui/rovingFocus";
import { Chip, ChipRail, IconButton, IconTile, Popover, Row, SearchField, Toggle } from "../../ui";
import classes from "./LayersPopover.module.css";

type BaseLayer = TileLayer & { id: string; name: string };
type Setter<T> = (value: T | ((prev: T) => T)) => void;
type View = "overlays" | "basemap" | "topos";

// A layer-row descriptor, shown as the row's info tooltip. Only vegetation needs
// one: its orange crosshatch (fire more recent than the survey) is the least
// intuitive symbol and carries no other label.
const LAYER_DESCRIPTIONS: Partial<Record<string, string>> = {
  vegetation:
    "Estimated vegetation density for bushbashing — denser scrub renders darker. " +
    "Orange crosshatching marks areas burnt more recently than the LiDAR survey, " +
    "so the estimate there may be out of date.",
};

const countOf = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

const TOPO_DATE = new Intl.DateTimeFormat("en-AU", { month: "short", year: "numeric" });

/** A drawn scrap of the vector basemap's own palette — land, a creek, a road
 *  and a lane — because a vector basemap has no XYZ tile to thumbnail. */
function VectorSwatch() {
  return (
    <svg className={classes.thumb} viewBox="0 0 40 40" preserveAspectRatio="none" aria-hidden="true">
      <rect width="40" height="40" fill={PROTOMAPS_SWATCH.earth} />
      <path d="M-2 27 C 8 22, 12 32, 22 27 S 34 18, 42 22" fill="none" stroke={PROTOMAPS_SWATCH.water} strokeWidth="3" />
      <path d="M-2 14 L 42 9" stroke={PROTOMAPS_SWATCH.road} strokeWidth="3.5" />
      <path d="M14 -2 L 20 42" stroke={PROTOMAPS_SWATCH.minor} strokeWidth="2" />
    </svg>
  );
}

/**
 * What is drawn on the map, in a popover over it — not a page, because it is a
 * question about the map. Two views (Basemap, Overlays); an overlay with more
 * inside it than a switch (LiDAR topos) opens a sub-view in place, so twenty
 * topos cost a scroll inside that view rather than a screen of rows here.
 */
export default function LayersPopover({
  open,
  onClose,
  anchorRef,
  showOwnedPlaces,
  setShowOwnedPlaces,
  showSharedPlaces,
  setShowSharedPlaces,
  showPlaceTracks,
  setShowPlaceTracks,
  showRoutes,
  setShowRoutes,
  ownedPlaceCount,
  sharedPlaceCount,
  routeCount,
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
  mapView,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  showOwnedPlaces: boolean;
  setShowOwnedPlaces: (v: boolean) => void;
  showSharedPlaces: boolean;
  setShowSharedPlaces: (v: boolean) => void;
  showPlaceTracks: boolean;
  setShowPlaceTracks: (v: boolean) => void;
  showRoutes: boolean;
  setShowRoutes: (v: boolean) => void;
  ownedPlaceCount: number;
  sharedPlaceCount: number;
  /** Null while routes are not loaded (they load with their layer). */
  routeCount: number | null;
  lidarEnabled: boolean;
  setLidarEnabled: (v: boolean) => void;
  lidarLayerToggles: Record<string, boolean>;
  setLidarLayerToggles: Setter<Record<string, boolean>>;
  lidarLayerOrder: string[];
  setLidarLayerOrder: Setter<string[]>;
  /** Layer names whose PMTiles failed to load for at least one job (LAYERS-1). */
  unavailableTopoLayerNames: Set<string>;
  completedTopoJobs: CompletedTopoJob[];
  lidarJobToggles: Record<string, boolean>;
  setLidarJobToggles: Setter<Record<string, boolean>>;
  mapBounds: RegionBbox | null;
  baseLayers: readonly BaseLayer[];
  activeLayerId: string;
  onActiveLayerChange: (id: string) => void;
  mapView: { lng: number; lat: number; zoom: number } | null;
}) {
  const [view, setView] = useState<View>("overlays");

  const shownJobs = completedTopoJobs.filter((job) => lidarJobToggles[job.jobId] ?? true);
  const shownLayerLabels = lidarLayerOrder
    .filter((name) => lidarLayerToggles[name])
    .map((name) => TOPO_LAYERS.find((layer) => layer.name === name)?.label.toLowerCase() ?? name);
  const overlaysOn = [showOwnedPlaces, showSharedPlaces, showPlaceTracks, showRoutes, lidarEnabled].filter(
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
      label={view === "topos" ? "LiDAR topos" : "Map layers"}
      className={classes.popover}
    >
      {view === "topos" ? (
        <ToposView
          onBack={() => setView("overlays")}
          onClose={close}
          lidarEnabled={lidarEnabled}
          setLidarEnabled={setLidarEnabled}
          jobs={completedTopoJobs}
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
      ) : (
        <>
          <div className={classes.head}>
            <ChipRail
              label="Layers view"
              className={classes.grow}
              options={[
                { value: "basemap", label: "Basemap", icon: MapIcon },
                { value: "overlays", label: "Overlays", count: overlaysOn },
              ]}
              value={view}
              onChange={setView}
            />
            <IconButton icon={X} label="Close" onClick={close} />
          </div>
          {view === "overlays" ? (
            <div className={classes.body}>
              <OverlayRow
                icon={MapPin}
                hue="var(--owned-place-color)"
                title="Your places"
                subtitle={countOf(ownedPlaceCount, "place")}
                checked={showOwnedPlaces}
                onToggle={setShowOwnedPlaces}
              />
              <OverlayRow
                icon={Users}
                hue="var(--hue-shared)"
                title="Shared with you"
                subtitle={countOf(sharedPlaceCount, "place")}
                checked={showSharedPlaces}
                onToggle={setShowSharedPlaces}
              />
              <OverlayRow
                icon={Route}
                hue="var(--hue-route)"
                title="Routes"
                subtitle={routeCount == null ? "Routes you drew" : countOf(routeCount, "route")}
                checked={showRoutes}
                onToggle={setShowRoutes}
              />
              <OverlayRow
                icon={Spline}
                hue="var(--hue-import)"
                title="Place tracks"
                subtitle="Track files attached to places"
                checked={showPlaceTracks}
                onToggle={setShowPlaceTracks}
              />
              {completedTopoJobs.length === 0 ? (
                <Row
                  leading={<IconTile icon={Mountain} hue="var(--hue-overlay)" />}
                  title="LiDAR topos"
                  subtitle="None yet. Make one from Maps."
                />
              ) : (
                <OverlayRow
                  icon={Mountain}
                  hue="var(--hue-overlay)"
                  title="LiDAR topos"
                  subtitle={[
                    `${shownJobs.length} of ${completedTopoJobs.length} shown`,
                    shownLayerLabels.join(", ") || "no layers",
                  ].join(" · ")}
                  checked={lidarEnabled}
                  onToggle={setLidarEnabled}
                  onOpen={() => setView("topos")}
                  openLabel="Choose topos and layers"
                />
              )}
            </div>
          ) : (
            <BasemapGallery
              layers={baseLayers}
              activeLayerId={activeLayerId}
              onChange={onActiveLayerChange}
              mapView={mapView}
            />
          )}
        </>
      )}
    </Popover>
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
  icon: typeof MapPin;
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
          {onOpen && <IconButton icon={ChevronRight} label={openLabel ?? title} onClick={onOpen} />}
          <Toggle checked={checked} onChange={onToggle} label={`Show ${title.toLowerCase()}`} />
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
    const from = tileRefs.current.findIndex((tile) => tile === document.activeElement);
    const to = nextEnabledIndex(layers.map(() => false), from, event.key);
    if (to == null) return;
    event.preventDefault();
    tileRefs.current[to]?.focus();
    onChange(layers[to].id);
  }

  return (
    <div role="radiogroup" aria-label="Basemap" tabIndex={-1} className={classes.gallery} onKeyDown={onKeyDown}>
      {layers.map((layer, index) => {
        const active = layer.id === activeLayerId;
        const thumbnail = mapView && layer.tiles.length > 0 ? previewUrlFor(layer, mapView) : null;
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
              <img src={thumbnail} alt="" className={classes.thumb} draggable={false} />
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
        ? jobs.filter((job) => job.footprint && boundsIntersect(footprintBounds(job.footprint), mapBounds))
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
        <IconButton icon={ArrowLeft} label="Back to overlays" onClick={onBack} />
        <div className={classes.titleBlock}>
          <span className={classes.title}>LiDAR topos</span>
          <span className={classes.subtitle}>
            {shownCount} of {jobs.length} shown
          </span>
        </div>
        <Toggle checked={lidarEnabled} onChange={setLidarEnabled} label="Show LiDAR topos" />
        <IconButton icon={X} label="Close" onClick={onClose} />
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
                    { value: "view", label: "In this view", count: inView.length, icon: Scan },
                    { value: "all", label: "All", count: jobs.length },
                  ]}
                  value={scope}
                  onChange={setScope}
                />
              )}
              <IconButton
                icon={searching ? X : Search}
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
                <span>{needle ? "No topos match." : "No topos in this view."}</span>
                {scope === "view" && !needle && (
                  <Chip label="Show all" count={jobs.length} onClick={() => setScope("all")} />
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
                          {job.syncRole === "shared" ? " · Shared with you" : ""}
                        </span>
                      </span>
                      <Toggle
                        checked={lidarJobToggles[job.jobId] ?? true}
                        onChange={(next) => setLidarJobToggles((prev) => ({ ...prev, [job.jobId]: next }))}
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
      <span className={classes.caption}>Drawn top to bottom, on every topo</span>
      <ul className={classes.list}>
        {order.map((name, index) => {
          const label = TOPO_LAYERS.find((layer) => layer.name === name)?.label ?? name;
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
                <GripVertical size={16} aria-hidden />
              </button>
              <span className={classes.titleBlock}>
                <span className={classes.listName}>
                  {label}
                  {description && (
                    <span className={classes.info} title={description} role="img" aria-label={description}>
                      <Info size={14} aria-hidden />
                    </span>
                  )}
                </span>
                {unavailable.has(name) && (
                  <span className={classes.warning}>Files missing for some topos — re-run them to restore</span>
                )}
              </span>
              <Toggle
                checked={toggles[name] ?? true}
                onChange={(next) => setToggles((prev) => ({ ...prev, [name]: next }))}
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
