import {
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import {
  contractSectionKeys,
  MAP_LAYERS,
  MAP_OVERLAYS,
  MAP_TERRAIN,
  PLACE_TYPE_COLORS,
  takesNswContours,
  takesNswHillshade,
  type SectionKeysOn,
  type SlopeBand,
  type TerrainSwitchKey,
} from "@logjam/shared";
import type { CompletedTopoJob } from "../../topoLayerTypes";
import type { GeoJsonPolygonal, TopoJob } from "../dialogs/TopoDialog";
import type { TFriend } from "../../placeUtils";
import SharpenedAreasView from "./SharpenedAreasView";
import { PROTOMAPS_SWATCH } from "../../basemapSwatch";
import { previewUrlFor, type TileLayer } from "../sidebar/panels/tilePreview";
import SlopeSettings from "../dialogs/topoSettings/SlopeSettings";
import { nextEnabledIndex } from "../../ui/rovingFocus";
import {
  ChipRail,
  Dialog,
  IconButton,
  IconTile,
  Popover,
  Row,
  Toggle,
  type Glyph,
} from "../../ui";
import classes from "./LayersPopover.module.css";

type BaseLayer = TileLayer & { id: string; name: string };
type View = "overlays" | "basemap" | "terrain" | "slopeBands" | "sharpened";

const copy = MAP_LAYERS.copy;
const terrainCopy = MAP_TERRAIN.copy;

const countOf = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

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
 * question about the map. Three tabs (Map, Terrain, Overlays); a row with more
 * inside it than a switch (the slope bands) opens a sub-view in place.
 */
export default function LayersPopover({
  open,
  onClose,
  anchorRef,
  showPlaces,
  setShowPlaces,
  showWays,
  setShowWays,
  showGauges,
  setShowGauges,
  placeCount,
  wayCount,
  completedTopoJobs,
  baseLayers,
  activeLayerId,
  onActiveLayerChange,
  terrainLayers,
  onTerrainLayerChange,
  slopeBands,
  onSlopeBandsChange,
  mapView,
  onImportFile,
  startView,
  sharpenedLoaded,
  activeTopoJobs,
  friends,
  onSharpen,
  onExportArea,
  onFlyToArea,
  onRefetchCompletedTopoJobs,
  onDismissActiveJob,
  onQuotaChanged,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  showPlaces: boolean;
  setShowPlaces: (v: boolean) => void;
  showWays: boolean;
  setShowWays: (v: boolean) => void;
  showGauges: boolean;
  setShowGauges: (v: boolean) => void;
  /** Every place drawn: the user's own and the ones shared with them. */
  placeCount: number;
  /** Null while the lines are not loaded (they load with their layer). */
  wayCount: number | null;
  completedTopoJobs: CompletedTopoJob[];
  baseLayers: readonly BaseLayer[];
  activeLayerId: string;
  onActiveLayerChange: (id: string) => void;
  terrainLayers: Readonly<Record<TerrainSwitchKey, boolean>>;
  onTerrainLayerChange: (key: TerrainSwitchKey, on: boolean) => void;
  slopeBands: SlopeBand[];
  onSlopeBandsChange: (bands: SlopeBand[]) => void;
  mapView: { lng: number; lat: number; zoom: number } | null;
  /** Opens the importer (the same entry the Ways and Logs lists use). */
  onImportFile: () => void;
  /**
   * A request to open on a sub-view instead of where the popover was. Each
   * request is a new object, so asking again for the same view navigates
   * again (Back, then the Inbox's Show once more).
   */
  startView: { view: "sharpened" } | null;
  /** False until the first fetch of sharpened areas settles (shared/DESIGN.md §11). */
  sharpenedLoaded: boolean;
  activeTopoJobs: TopoJob[];
  friends: TFriend[];
  /** Arms the pick for a new sharpened area, as the Make a map menu does. */
  onSharpen: () => void;
  onExportArea: (job: CompletedTopoJob) => void;
  onFlyToArea: (footprint: GeoJsonPolygonal) => void;
  onRefetchCompletedTopoJobs: () => void;
  onDismissActiveJob: (jobId: string) => void;
  onQuotaChanged: () => void;
}) {
  const [view, setView] = useState<View>("overlays");
  // However it closes (the button toggles `open` itself), the next opening
  // starts on Overlays; a start request made in the same render wins.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) setView("overlays");
  }
  const [seenStartView, setSeenStartView] = useState(startView);
  if (seenStartView !== startView) {
    setSeenStartView(startView);
    if (startView) setView(startView.view);
  }

  // Only a sharpened area made with the vegetation layer has one to switch.
  const hasVegetation = completedTopoJobs.some((job) =>
    job.layers.some((layer) => layer.name === "vegetation"),
  );
  const overlaysOn = [showPlaces, showWays, showGauges].filter(Boolean).length;

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
        view === "slopeBands"
          ? terrainCopy.slopeBands
          : view === "sharpened"
            ? terrainCopy.sharpenedAreas
            : "Map layers"
      }
      className={classes.popover}
      // Both views carry their own × in the header.
      closeButton={false}
    >
      {view === "sharpened" ? (
        <SharpenedAreasView
          onBack={() => setView("terrain")}
          onClose={close}
          activeTopoJobs={activeTopoJobs}
          completedTopoJobs={completedTopoJobs}
          friends={friends}
          loaded={sharpenedLoaded}
          onSharpen={() => {
            close();
            onSharpen();
          }}
          onExportArea={(job) => {
            close();
            onExportArea(job);
          }}
          onFlyTo={onFlyToArea}
          onRefetchCompletedTopoJobs={onRefetchCompletedTopoJobs}
          onDismissActiveJob={onDismissActiveJob}
          onQuotaChanged={onQuotaChanged}
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
                  ? { value: key, label: copy.tabBasemap }
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
                  hasVegetation={hasVegetation}
                  sharpenedCount={
                    sharpenedLoaded ? completedTopoJobs.length : null
                  }
                  onOpenSharpened={() => setView("sharpened")}
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
                  <OverlayRow
                    icon="sensors"
                    hue="var(--color-accent)"
                    title={MAP_OVERLAYS.copy.gauges}
                    subtitle={MAP_OVERLAYS.copy.gaugesHint}
                    checked={showGauges}
                    onToggle={setShowGauges}
                  />
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
  hasVegetation,
  sharpenedCount,
  onOpenSharpened,
}: {
  layers: Readonly<Record<TerrainSwitchKey, boolean>>;
  onChange: (key: TerrainSwitchKey, on: boolean) => void;
  activeLayerId: string;
  onOpenSlopeBands: () => void;
  /** Whether any sharpened area has a vegetation layer to switch. */
  hasVegetation: boolean;
  /** Null until the first fetch settles. */
  sharpenedCount: number | null;
  onOpenSharpened: () => void;
}) {
  const [legendOpen, setLegendOpen] = useState(false);
  // One shape for all three, so the Slope row's chevron is the only difference.
  const row = (key: TerrainSwitchKey, extra: ReactNode = null) => {
    const title = terrainCopy[key];
    const printed = key === "contours" && !takesNswContours(activeLayerId);
    const shadowed = key === "hillshade" && !takesNswHillshade(activeLayerId);
    const reason = printed
      ? terrainCopy.contoursPrinted
      : shadowed
        ? terrainCopy.hillshadeImagery
        : undefined;
    return (
      <Row
        key={key}
        title={title}
        subtitle={reason}
        trailing={
          <>
            {extra}
            <Toggle
              // Off while nothing can draw it; the stored choice returns with
              // the basemap that can.
              checked={layers[key] && !printed && !shadowed}
              onChange={(on) => onChange(key, on)}
              label={`Show ${title.toLowerCase()}`}
              disabled={printed || shadowed}
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
    vegetation: () =>
      hasVegetation ? (
        <Row
          key="vegetation"
          title={terrainCopy.vegetation}
          subtitle={terrainCopy.vegetationHint}
          trailing={
            <>
              <IconButton
                icon="help"
                label={terrainCopy.vegetationAbout}
                onClick={() => setLegendOpen(true)}
              />
              <Toggle
                checked={layers.vegetation}
                onChange={(on) => onChange("vegetation", on)}
                label="Show vegetation"
              />
            </>
          }
        />
      ) : null,
    sharpenedAreas: () => (
      <Row
        key="sharpenedAreas"
        title={
          sharpenedCount === null
            ? terrainCopy.sharpenedAreas
            : `${terrainCopy.sharpenedAreas} · ${sharpenedCount}`
        }
        onOpen={onOpenSharpened}
      />
    ),
    // Opened from the Slope row's chevron, as a view of its own.
    slopeBands: () => null,
  };
  return (
    <div className={classes.body}>
      {contractSectionKeys(MAP_TERRAIN, "web").map((key) => panes[key]())}
      <Dialog
        open={legendOpen}
        title={terrainCopy.vegetation}
        onClose={() => setLegendOpen(false)}
      >
        <p>{terrainCopy.vegetationLegend}</p>
      </Dialog>
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
