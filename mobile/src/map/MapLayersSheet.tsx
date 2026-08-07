// "Map layers" — everything that decides what the map draws, in one sheet with
// three tabs.
//
// The old version was one scroll through six stacked sections (basemap, offline,
// topo overlays, imports, GeoPDFs, tracks) of hand-rolled rows. It answered
// three unrelated questions in one column, so every one of them was a scroll
// away from the others. The tabs are those three questions:
//
//   Basemap  — what is the map made of?
//   Layers   — what is drawn on top of it?
//   Offline  — what works with no signal?
//
// Tabs rather than a second sheet, per DESIGN.md §6: one sheet, content swapped
// in place. The rail is pinned, so switching tabs never scrolls the list you are
// working in out of reach (§2).
//
// The Layers tab is one row PER KIND, not per file: a phone with thirty tracks
// and a dozen GeoPDFs made that tab a scroll of near-identical switches with no
// way to turn a whole kind off. Each kind carries its own master switch and
// opens to reveal its items — and an item's overflow gives the same three verbs
// Saved does (`assetActions.ts`), so the map is not a dead end for the layer you
// are looking at.
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, StyleSheet, Text, TextInput, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { BASEMAP_CATALOG, formatDistanceM, messageFromError } from "@logjam/shared";

import { assetHue, fontSize, fontWeight, spacing, theme, withAlpha } from "../theme";
import {
  BottomSheet,
  Button,
  IconButton,
  Row,
  SectionHeader,
  SegmentedControl,
  StatusPill,
  TextField,
  Toggle,
} from "../ui";
import { RESIDUAL_WARN_FRACTION } from "../geopdf/importPipeline";
import type { GeoPdfImport } from "../geopdf/geoPdfImportsDb";
import type { VectorImport } from "../imports/importsDb";
import type { Track } from "../tracks/tracksDb";
import {
  geoPdfActions,
  trackActions,
  vectorImportActions,
  type AssetActions,
} from "../saved/assetActions";
import type { Bbox } from "../saved/bboxOfPoints";
import {
  listUnfinishedRegions,
  deleteRegionFile,
  type UnfinishedRegion,
} from "../offline/regionMbtiles";
import {
  enqueueRegionDownloads,
  useRegionDownloads,
} from "../offline/regionDownloadQueue";
import { BasemapThumb } from "./BasemapThumb";
import { BASEMAP_META, MOBILE_BASEMAPS } from "./basemapMeta";
import type { CanyonRoutesStatus } from "./CanyonRoutesLayer";
import type { Connectivity } from "./connectivity";
import type { BasemapId, MapArtifact } from "./sourceResolver";

/** Steps rather than a slider: a horizontal drag inside a sheet fights the
 *  sheet's own drag-to-dismiss (DESIGN.md §9). */
const GEOPDF_OPACITY_STEPS = [0.2, 0.4, 0.6, 0.8, 1] as const;

type Tab = "basemap" | "layers" | "offline";

export type OverlayEntry = {
  /** "<jobId>/<layerName>" — the enabled-set key. */
  key: string;
  /** The LiDAR job this layer was rendered from. */
  areaId: string;
  areaLabel: string;
  /** TopoLayerName + its display label ("hillshade" / "Hillshade"). */
  layer: string;
  layerLabel: string;
};

/** An item's overflow sheet: which asset, and how far into it we are. */
type ItemMenu = { title: string; actions: AssetActions };

export function MapLayersSheet({
  visible,
  onClose,
  connectivity,
  basemapId,
  onBasemapChange,
  artifacts,
  overlays,
  enabledOverlays,
  onToggleOverlay,
  mutedAreas,
  onSetAreasMuted,
  geoPdfImports,
  onGeoPdfChange,
  imports,
  onImportVisibility,
  tracks,
  onTrackVisibility,
  showCanyonRoutes,
  onShowCanyonRoutesChange,
  routesStatus,
  canyonRouteHue,
  showRoutes,
  onShowRoutesChange,
  routeCount,
  offlineOnly,
  onOfflineOnlyChange,
  onSaveArea,
  onShowOnMap,
  onOpenSaved,
}: {
  visible: boolean;
  onClose: () => void;
  connectivity: Connectivity;
  basemapId: BasemapId;
  onBasemapChange: (id: BasemapId) => void;
  artifacts: MapArtifact[];
  overlays: OverlayEntry[];
  enabledOverlays: ReadonlySet<string>;
  onToggleOverlay: (key: string) => void;
  /** Areas hidden wholesale — the "where" axis (see TopoOverlayList). */
  mutedAreas: ReadonlySet<string>;
  onSetAreasMuted: (areaIds: string[], muted: boolean) => void;
  geoPdfImports: GeoPdfImport[];
  onGeoPdfChange: (id: string, patch: { visible?: boolean; opacity?: number }) => void;
  imports: VectorImport[];
  onImportVisibility: (id: string, visible: boolean) => void;
  tracks: Track[];
  onTrackVisibility: (id: string, visible: boolean) => void;
  showCanyonRoutes: boolean;
  onShowCanyonRoutesChange: (next: boolean) => void;
  /** What the routes layer actually managed to draw, reported on its own row. */
  routesStatus: CanyonRoutesStatus | null;
  /** The colour the routes are actually drawn in, so the row matches the map. */
  canyonRouteHue: string;
  showRoutes: boolean;
  onShowRoutesChange: (next: boolean) => void;
  /** How many routes the user has drawn — the row's own tally. */
  routeCount: number;
  offlineOnly: boolean;
  onOfflineOnlyChange: (next: boolean) => void;
  onSaveArea: () => void;
  /** Fly the map to an asset's extent (and close the sheet). */
  onShowOnMap: (bbox: Bbox) => void;
  onOpenSaved: (category: "region") => void;
}) {
  const [tab, setTab] = useState<Tab>("basemap");
  const [menu, setMenu] = useState<ItemMenu | null>(null);
  const online = connectivity === "online";
  const readyGeoPdfs = geoPdfImports.filter((entry) => entry.state === "ready");
  const savedTracks = tracks.filter((track) => track.state === "done");

  const visibleLayerCount =
    overlays.filter(
      (overlay) => enabledOverlays.has(overlay.key) && !mutedAreas.has(overlay.areaId),
    ).length +
    readyGeoPdfs.filter((entry) => entry.visible).length +
    imports.filter((entry) => entry.visible).length +
    savedTracks.filter((track) => track.visible).length +
    (showCanyonRoutes ? 1 : 0) +
    (showRoutes && routeCount > 0 ? 1 : 0);

  // The sheet closing for any reason drops an open overflow: coming back to a
  // rename form for a layer you have since navigated away from is a stale
  // prompt, not a resumed task.
  useEffect(() => {
    if (!visible) setMenu(null);
  }, [visible]);

  return (
    <BottomSheet
      visible={visible}
      // A sub-mode backs out to its parent, not out of the sheet (DESIGN.md §6).
      onClose={menu ? () => setMenu(null) : onClose}
      title={menu ? menu.title : "Map layers"}
      overlay={
        menu ? (
          <ItemMenuPanel
            menu={menu}
            onDone={() => setMenu(null)}
            onShowOnMap={(bbox) => {
              setMenu(null);
              onShowOnMap(bbox);
            }}
          />
        ) : undefined
      }
    >
      <View style={styles.rail}>
        <SegmentedControl
          options={[
            { value: "basemap", label: "Basemap" },
            { value: "layers", label: "Layers", count: visibleLayerCount },
            { value: "offline", label: "Offline" },
          ]}
          value={tab}
          onChange={(next) => setTab(next as Tab)}
        />
      </View>

      {tab === "basemap" ? (
        <BasemapTab
          basemapId={basemapId}
          onBasemapChange={onBasemapChange}
          online={online}
        />
      ) : null}

      {tab === "layers" ? (
        <LayersTab
          overlays={overlays}
          enabledOverlays={enabledOverlays}
          onToggleOverlay={onToggleOverlay}
          mutedAreas={mutedAreas}
          onSetAreasMuted={onSetAreasMuted}
          geoPdfImports={readyGeoPdfs}
          onGeoPdfChange={onGeoPdfChange}
          imports={imports}
          onImportVisibility={onImportVisibility}
          tracks={savedTracks}
          onTrackVisibility={onTrackVisibility}
          showCanyonRoutes={showCanyonRoutes}
          onShowCanyonRoutesChange={onShowCanyonRoutesChange}
          routesStatus={routesStatus}
          canyonRouteHue={canyonRouteHue}
          showRoutes={showRoutes}
          onShowRoutesChange={onShowRoutesChange}
          routeCount={routeCount}
          onOpenMenu={setMenu}
        />
      ) : null}

      {tab === "offline" ? (
        <OfflineTab
          online={online}
          offlineOnly={offlineOnly}
          onOfflineOnlyChange={onOfflineOnlyChange}
          onSaveArea={onSaveArea}
          onOpenSaved={onOpenSaved}
          artifacts={artifacts}
          visible={visible}
        />
      ) : null}
    </BottomSheet>
  );
}

function BasemapTab({
  basemapId,
  onBasemapChange,
  online,
}: {
  basemapId: BasemapId;
  onBasemapChange: (id: BasemapId) => void;
  online: boolean;
}) {
  return (
    <View style={styles.body}>
      {/* Order and membership are MOBILE_BASEMAPS', not the catalog's — see
          basemapMeta.ts (the catalog also carries the web-only "osm" raster). */}
      {MOBILE_BASEMAPS.map((id) => {
        const entry = BASEMAP_CATALOG.find((candidate) => candidate.id === id);
        // Fail loudly: an id the catalog doesn't know is a programming error.
        if (!entry) throw new Error(`Unknown basemap id: ${id}`);
        // Online-only sources are unavailable offline BY POLICY (their tile
        // usage terms), which is a different thing from "not downloaded" — the
        // subtitle says which.
        const unavailable = !online && !entry.offlineCapable;
        const active = basemapId === id;
        return (
          <Row
            key={entry.id}
            leading={<BasemapThumb basemapId={id} />}
            title={entry.name}
            subtitle={unavailable ? "Needs a connection" : BASEMAP_META[id].blurb}
            subtitleNumberOfLines={2}
            disabled={unavailable}
            onPress={() => onBasemapChange(id)}
            // No "Showing" pill: the selection is a state of the row, not a
            // label on it. A filled check on an accent-lit card says it at a
            // glance, and a downloaded-region pill used to say "Offline" for a
            // basemap of which one small area is on the phone.
            right={
              active ? (
                <Feather name="check-circle" size={22} color={theme.accent} />
              ) : null
            }
            style={active ? styles.activeRow : undefined}
          />
        );
      })}
    </View>
  );
}

/**
 * One kind of layer: a master switch over the whole kind, and its items behind
 * a disclosure. Collapsed it is one row however many files are underneath it.
 */
function LayerGroup({
  icon,
  hue,
  title,
  subtitle,
  visibleCount,
  totalCount,
  onSetAll,
  children,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  hue: string;
  title: string;
  subtitle: string;
  visibleCount: number;
  totalCount: number;
  onSetAll: (next: boolean) => void;
  children?: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const expandable = totalCount > 0 && children != null;
  return (
    <View style={styles.group}>
      <Row
        icon={icon}
        hue={hue}
        title={title}
        subtitle={subtitle}
        subtitleNumberOfLines={2}
        onPress={expandable ? () => setExpanded((current) => !current) : undefined}
        accessibilityLabel={`${title} — ${expanded ? "hide" : "show"} the list`}
        right={
          <View style={styles.trailing}>
            <Toggle
              value={visibleCount > 0}
              onValueChange={onSetAll}
              accessibilityLabel={`Show ${title}`}
            />
            {expandable ? (
              <Feather
                name={expanded ? "chevron-up" : "chevron-down"}
                size={20}
                color={theme.textMuted}
              />
            ) : null}
          </View>
        }
      />
      {expanded ? <View style={styles.groupItems}>{children}</View> : null}
    </View>
  );
}

function LayersTab({
  overlays,
  enabledOverlays,
  onToggleOverlay,
  mutedAreas,
  onSetAreasMuted,
  geoPdfImports,
  onGeoPdfChange,
  imports,
  onImportVisibility,
  tracks,
  onTrackVisibility,
  showCanyonRoutes,
  onShowCanyonRoutesChange,
  routesStatus,
  canyonRouteHue,
  showRoutes,
  onShowRoutesChange,
  routeCount,
  onOpenMenu,
}: {
  overlays: OverlayEntry[];
  enabledOverlays: ReadonlySet<string>;
  onToggleOverlay: (key: string) => void;
  mutedAreas: ReadonlySet<string>;
  onSetAreasMuted: (areaIds: string[], muted: boolean) => void;
  geoPdfImports: GeoPdfImport[];
  onGeoPdfChange: (id: string, patch: { visible?: boolean; opacity?: number }) => void;
  imports: VectorImport[];
  onImportVisibility: (id: string, visible: boolean) => void;
  tracks: Track[];
  onTrackVisibility: (id: string, visible: boolean) => void;
  showCanyonRoutes: boolean;
  onShowCanyonRoutesChange: (next: boolean) => void;
  routesStatus: CanyonRoutesStatus | null;
  canyonRouteHue: string;
  showRoutes: boolean;
  onShowRoutesChange: (next: boolean) => void;
  routeCount: number;
  onOpenMenu: (menu: ItemMenu) => void;
}) {
  // Both axes have to agree before an overlay is on the map (TopoOverlayList).
  const shownOverlayCount = overlays.filter(
    (overlay) => enabledOverlays.has(overlay.key) && !mutedAreas.has(overlay.areaId),
  ).length;

  const visibleGeoPdfs = geoPdfImports.filter((entry) => entry.visible);
  // ONE opacity for every GeoPDF, not one rail per file. They are all the same
  // kind of thing over the same basemap, and a stack of identical 5-step rails
  // was most of the height of this tab.
  const sharedOpacity = visibleGeoPdfs[0]?.opacity ?? 1;
  const setAllOpacity = (next: number) => {
    for (const geoPdf of geoPdfImports) onGeoPdfChange(geoPdf.id, { opacity: next });
  };

  return (
    <View style={styles.body}>
      {/* Web parity: the web map can draw every canyon's route as a layer.
          Mobile only ever drew one at a time, transiently, from a canyon's own
          screen. The mirror already holds the files, so this works offline.
          Its partial-coverage report lives HERE rather than as a badge on the
          map: this layer is one people leave on, and a permanent chip over the
          map is a permanent tax on the thing the map is for. */}
      <LayerGroup
        icon="git-commit"
        hue={canyonRouteHue}
        title="Canyon routes"
        subtitle={
          showCanyonRoutes && routesStatus && routesStatus.unavailable > 0
            ? `${routesStatus.drawn} drawn · ${routesStatus.unavailable} not downloaded yet`
            : "Every route you have, drawn at once"
        }
        visibleCount={showCanyonRoutes ? 1 : 0}
        totalCount={1}
        onSetAll={onShowCanyonRoutesChange}
      />

      {/* The user's OWN drawn routes — a different kind from the canyon files
          above, and the one layer they made themselves, so it gets its own
          switch rather than being permanently on. */}
      {routeCount > 0 ? (
        <LayerGroup
          icon="pen-tool"
          hue={assetHue.route}
          title="My routes"
          subtitle={`${routeCount} drawn`}
          visibleCount={showRoutes ? 1 : 0}
          totalCount={1}
          onSetAll={onShowRoutesChange}
        />
      ) : null}

      {overlays.length > 0 ? (
        <LayerGroup
          icon="layers"
          hue={assetHue.overlay}
          title="Topo overlays"
          // Counts what is actually on the map: a cell whose area is muted is
          // selected but not drawn, and reporting it as shown would have this
          // row disagree with the map behind the sheet.
          subtitle={`${shownOverlayCount} of ${overlays.length} shown`}
          visibleCount={shownOverlayCount}
          totalCount={overlays.length}
          // The master is "show me the topo overlays" / "take them off", so
          // turning it on has to clear the muting as well — otherwise it
          // enables every cell and the map stays empty.
          onSetAll={(next) => {
            for (const overlay of overlays) {
              if (enabledOverlays.has(overlay.key) !== next) onToggleOverlay(overlay.key);
            }
            if (next) onSetAreasMuted([...mutedAreas], false);
          }}
        >
          <TopoOverlayList
            overlays={overlays}
            enabledOverlays={enabledOverlays}
            onToggleOverlay={onToggleOverlay}
            mutedAreas={mutedAreas}
            onSetAreasMuted={onSetAreasMuted}
          />
        </LayerGroup>
      ) : null}

      {geoPdfImports.length > 0 ? (
        <LayerGroup
          icon="file-text"
          hue={assetHue.geoPdf}
          title="GeoPDF maps"
          subtitle={`${visibleGeoPdfs.length} of ${geoPdfImports.length} shown`}
          visibleCount={visibleGeoPdfs.length}
          totalCount={geoPdfImports.length}
          onSetAll={(next) => {
            for (const geoPdf of geoPdfImports) {
              onGeoPdfChange(geoPdf.id, { visible: next });
            }
          }}
        >
          {geoPdfImports.map((geoPdf) => (
            <View key={geoPdf.id} style={styles.stack}>
              <ItemRow
                hue={assetHue.geoPdf}
                title={geoPdf.label}
                visible={geoPdf.visible}
                onVisibility={() =>
                  onGeoPdfChange(geoPdf.id, { visible: !geoPdf.visible })
                }
                onMenu={() =>
                  onOpenMenu({ title: geoPdf.label, actions: geoPdfActions(geoPdf) })
                }
              />
              {geoPdf.residualFraction != null &&
              geoPdf.residualFraction > RESIDUAL_WARN_FRACTION ? (
                <Text style={styles.note}>
                  Georeferencing in this file is imprecise — positions may be off.
                </Text>
              ) : null}
            </View>
          ))}
          {visibleGeoPdfs.length > 0 ? (
            <View style={styles.opacity}>
              <Text style={styles.opacityLabel}>Opacity</Text>
              <SegmentedControl
                scroll
                options={GEOPDF_OPACITY_STEPS.map((step) => ({
                  value: String(step),
                  label: `${Math.round(step * 100)}%`,
                }))}
                value={String(
                  GEOPDF_OPACITY_STEPS.find(
                    (step) => Math.abs(sharedOpacity - step) < 0.01,
                  ) ?? 1,
                )}
                onChange={(next) => setAllOpacity(Number(next))}
              />
            </View>
          ) : null}
        </LayerGroup>
      ) : null}

      {imports.length > 0 ? (
        <LayerGroup
          icon="file-plus"
          hue={assetHue.vector}
          title="Other routes"
          subtitle={`${imports.filter((entry) => entry.visible).length} of ${imports.length} shown`}
          visibleCount={imports.filter((entry) => entry.visible).length}
          totalCount={imports.length}
          onSetAll={(next) => {
            for (const imported of imports) onImportVisibility(imported.id, next);
          }}
        >
          {imports.map((imported) => (
            <ItemRow
              key={imported.id}
              hue={imported.color}
              title={imported.name}
              visible={imported.visible}
              onVisibility={() => onImportVisibility(imported.id, !imported.visible)}
              onMenu={() =>
                onOpenMenu({
                  title: imported.name,
                  actions: vectorImportActions(imported),
                })
              }
            />
          ))}
        </LayerGroup>
      ) : null}

      <LayerGroup
        icon="activity"
        hue={assetHue.track}
        title="Tracks"
        subtitle={
          tracks.length === 0
            ? "The record button on the map starts one"
            : `${tracks.filter((track) => track.visible).length} of ${tracks.length} shown`
        }
        visibleCount={tracks.filter((track) => track.visible).length}
        totalCount={tracks.length}
        onSetAll={(next) => {
          for (const track of tracks) onTrackVisibility(track.id, next);
        }}
      >
        {tracks.map((track) => (
          <ItemRow
            key={track.id}
            hue={track.color}
            title={track.name}
            subtitle={formatDistanceM(track.distanceM)}
            visible={track.visible}
            onVisibility={() => onTrackVisibility(track.id, !track.visible)}
            onMenu={() =>
              onOpenMenu({ title: track.name, actions: trackActions(track) })
            }
          />
        ))}
      </LayerGroup>
    </View>
  );
}

/**
 * The topo overlays, as two questions rather than a grid.
 *
 * A LiDAR job covers ONE area and renders the same handful of layers inside it
 * (hillshade, contours, features…), so the honest shape of this data is a
 * matrix — and a row per cell grows by five with every area saved. Nobody asks
 * it a per-cell question. They ask "contours, everywhere" or "not this area at
 * all", so those are the two sections:
 *
 *   LAYERS — what to draw. One switch per layer kind, across every area.
 *   AREAS  — where to draw it. One switch per area.
 *
 * The two are INDEPENDENT, not two views of one set: an overlay renders when
 * its layer is on AND its area is not muted. That is what makes each switch
 * mean one thing — muting an area hides it without destroying the layer picks
 * underneath, so unmuting brings back exactly what was showing. Deriving the
 * area switch from the cells instead would make it read "off" the moment any
 * single layer was off, which is the state the map is in almost all the time.
 *
 * Storage follows the same split: cells in `overlay_enabled` (registryDb),
 * muting in `topoAreaMuting.ts`.
 */
function TopoOverlayList({
  overlays,
  enabledOverlays,
  onToggleOverlay,
  mutedAreas,
  onSetAreasMuted,
}: {
  overlays: OverlayEntry[];
  enabledOverlays: ReadonlySet<string>;
  onToggleOverlay: (key: string) => void;
  mutedAreas: ReadonlySet<string>;
  onSetAreasMuted: (areaIds: string[], muted: boolean) => void;
}) {
  // Both groupings keep first-seen order, which is the order MapScreen composed
  // the jobs in (newest area first, TOPO_LAYERS order within one).
  const byLayer = useMemo(() => {
    const groups = new Map<string, { label: string; keys: string[] }>();
    for (const overlay of overlays) {
      const group = groups.get(overlay.layer) ?? {
        label: overlay.layerLabel,
        keys: [],
      };
      group.keys.push(overlay.key);
      groups.set(overlay.layer, group);
    }
    return [...groups];
  }, [overlays]);

  // Areas keep first-seen order too, and are deduped by id — one row per area,
  // however many layers it rendered.
  const areas = useMemo(() => {
    const seen = new Map<string, string>();
    for (const overlay of overlays) {
      if (!seen.has(overlay.areaId)) seen.set(overlay.areaId, overlay.areaLabel);
    }
    return [...seen];
  }, [overlays]);

  return (
    <>
      <SectionHeader label="Layers" />
      {byLayer.map(([layer, group]) => {
        const allOn = group.keys.every((key) => enabledOverlays.has(key));
        return (
          <ItemRow
            key={layer}
            hue={assetHue.overlay}
            title={group.label}
            visible={allOn}
            onVisibility={() => {
              for (const key of group.keys) {
                if (enabledOverlays.has(key) !== !allOn) onToggleOverlay(key);
              }
            }}
          />
        );
      })}

      <SectionHeader label="Areas" />
      {areas.map(([areaId, label]) => (
        <ItemRow
          key={areaId}
          hue={assetHue.overlay}
          title={label}
          visible={!mutedAreas.has(areaId)}
          onVisibility={() => onSetAreasMuted([areaId], !mutedAreas.has(areaId))}
        />
      ))}
    </>
  );
}

/** One file inside a group: a colour dot, its name, its switch, its overflow. */
function ItemRow({
  hue,
  title,
  subtitle,
  visible,
  onVisibility,
  onMenu,
}: {
  hue: string;
  title: string;
  subtitle?: string;
  visible: boolean;
  onVisibility: () => void;
  onMenu?: () => void;
}) {
  return (
    <Row
      leading={<View style={[styles.dot, { backgroundColor: hue }]} />}
      title={title}
      subtitle={subtitle}
      style={styles.itemRow}
      right={
        <View style={styles.trailing}>
          <Toggle
            value={visible}
            onValueChange={onVisibility}
            accessibilityLabel={`Show ${title}`}
          />
          {onMenu ? (
            <IconButton
              icon="more-horizontal"
              accessibilityLabel={`More actions for ${title}`}
              onPress={onMenu}
            />
          ) : null}
        </View>
      }
    />
  );
}

/**
 * The three verbs, over the layer list rather than in a second sheet — the same
 * content-swap rule the tabs follow, and the same actions the Saved tab offers
 * (`assetActions.ts` is the one definition of what each verb means).
 */
function ItemMenuPanel({
  menu,
  onDone,
  onShowOnMap,
}: {
  menu: ItemMenu;
  onDone: () => void;
  onShowOnMap: (bbox: Bbox) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(menu.title);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);

  // The sheet is already open and focused, so focusing on the next frame is
  // what actually raises the keyboard (DESIGN.md §6 — `autoFocus` runs before
  // the field attaches).
  useEffect(() => {
    if (!renaming) return;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [renaming]);

  if (renaming) {
    return (
      <View style={styles.menu}>
        <TextField
          inputRef={inputRef}
          label="Name"
          value={draft}
          onChangeText={setDraft}
        />
        {error ? <Text style={styles.menuError}>{error}</Text> : null}
        <Button
          label="Save"
          icon="check"
          onPress={() => {
            const name = draft.trim();
            if (name.length === 0) {
              setError("Give it a name.");
              return;
            }
            menu.actions
              .rename(name)
              .then(onDone)
              .catch((err: unknown) => {
                console.error(err);
                setError(messageFromError(err, "Couldn't rename that."));
              });
          }}
        />
      </View>
    );
  }

  return (
    <View style={styles.menu}>
      <Row
        icon="map-pin"
        title="Show on map"
        // Absent, not disabled, when there is nothing to fly to — an affordance
        // that exists only to refuse is worse than no affordance (DESIGN.md §7).
        onPress={
          menu.actions.locatable
            ? () => {
                menu.actions
                  .resolveBbox()
                  .then((bbox) => {
                    if (bbox) onShowOnMap(bbox);
                    else onDone();
                  })
                  .catch((err: unknown) => {
                    console.error(err);
                    onDone();
                  });
              }
            : undefined
        }
        disabled={!menu.actions.locatable}
      />
      <Row icon="edit-2" title="Rename" onPress={() => setRenaming(true)} />
      <Row
        icon="trash-2"
        hue={theme.warning}
        title="Delete from device"
        onPress={() =>
          Alert.alert(menu.actions.delete.confirmTitle, menu.actions.delete.confirmBody, [
            { text: "Keep it", style: "cancel" },
            {
              text: "Delete",
              style: "destructive",
              onPress: () => {
                menu.actions.delete.run().catch(console.error);
                onDone();
              },
            },
          ])
        }
      />
    </View>
  );
}

function OfflineTab({
  online,
  offlineOnly,
  onOfflineOnlyChange,
  onSaveArea,
  onOpenSaved,
  artifacts,
  visible,
}: {
  online: boolean;
  offlineOnly: boolean;
  onOfflineOnlyChange: (next: boolean) => void;
  onSaveArea: () => void;
  onOpenSaved: (category: "region") => void;
  artifacts: MapArtifact[];
  visible: boolean;
}) {
  const [unfinished, setUnfinished] = useState<UnfinishedRegion[]>([]);
  const jobs = useRegionDownloads();
  const activeIds = useMemo(() => new Set(jobs.map((job) => job.spec.id)), [jobs]);

  // Read the half-written files each time the sheet opens: a download that died
  // with the app is only discoverable from disk (regionMbtiles.ts).
  useEffect(() => {
    if (!visible) return;
    listUnfinishedRegions()
      .then((rows) => setUnfinished(rows.filter((row) => !activeIds.has(row.id))))
      .catch(console.error);
    // `activeIds` changes identity every render; the queue's own state drives
    // the filter below instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, jobs.length]);

  const savedRegions = artifacts.filter(
    (artifact) => artifact.kind === "basemap-region",
  );
  const savedBytes = savedRegions.reduce(
    (sum, artifact) => sum + artifact.sizeBytes,
    0,
  );

  return (
    <View style={styles.body}>
      <Row
        icon="download-cloud"
        hue={assetHue.region}
        title="Save maps for offline use"
        subtitle={
          online
            ? "Pick an area, choose the maps and the detail"
            : "Needs a connection"
        }
        disabled={!online}
        onPress={onSaveArea}
      />
      <Row
        icon="cloud-off"
        hue={assetHue.region}
        title="Offline maps only"
        subtitle="Draw from this phone even when you have signal"
        subtitleNumberOfLines={2}
        right={
          <Toggle
            value={offlineOnly}
            onValueChange={onOfflineOnlyChange}
            accessibilityLabel="Offline maps only"
          />
        }
      />

      {unfinished.length > 0 ? (
        <>
          <SectionHeader label="Unfinished" />
          {unfinished.map((region) => (
            <Row
              key={region.id}
              icon="pause-circle"
              hue={theme.warning}
              title={region.label}
              subtitle={
                online
                  ? `${region.tilesStored.toLocaleString()} tiles already saved`
                  : "Needs a connection to finish"
              }
              // Trailing order per §5: state, then the inline recovery action.
              right={
                <View style={styles.trailing}>
                  {online ? <StatusPill label="Resume" tone="accent" /> : null}
                  <IconButton
                    icon="trash-2"
                    color={theme.warning}
                    accessibilityLabel={`Discard the unfinished download ${region.label}`}
                    onPress={() =>
                      Alert.alert(
                        "Discard this download?",
                        "The tiles saved so far are deleted from this phone.",
                        [
                          { text: "Keep it", style: "cancel" },
                          {
                            text: "Discard",
                            style: "destructive",
                            onPress: () => {
                              void deleteRegionFile(region.id);
                              setUnfinished((current) =>
                                current.filter((row) => row.id !== region.id),
                              );
                            },
                          },
                        ],
                      )
                    }
                  />
                </View>
              }
              disabled={!online}
              onPress={() => {
                enqueueRegionDownloads([
                  {
                    taskKind: "tile-pyramid",
                    id: region.id,
                    basemapId: region.basemapId,
                    label: region.label,
                    bbox: region.bbox,
                    zMax: region.zMax,
                    allowCellular: false,
                  },
                ]);
                setUnfinished((current) =>
                  current.filter((row) => row.id !== region.id),
                );
              }}
            />
          ))}
        </>
      ) : null}

      <SectionHeader label="On this phone" />
      <Row
        icon="hard-drive"
        hue={assetHue.region}
        title={
          savedRegions.length === 1
            ? "1 saved area"
            : `${savedRegions.length} saved areas`
        }
        subtitle={
          savedRegions.length === 0
            ? "The map goes blank without one"
            : `${(savedBytes / 1024 / 1024).toFixed(0)} MB · rename or delete in Saved`
        }
        // Lands on Saved's Regions filter, not its everything-list: a pointer
        // that makes the user find the thing again is not a pointer.
        onPress={() => onOpenSaved("region")}
        right={<Feather name="chevron-right" size={20} color={theme.textMuted} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // The gap the list scrolls against, exactly as a screen's pinned rail owns
  // (DESIGN.md §2).
  rail: { paddingBottom: spacing(1.5) },
  body: { gap: spacing(1) },
  stack: { gap: spacing(0.5) },
  group: { gap: spacing(0.5) },
  // Items hang off their group's row, indented so the hierarchy is visible
  // without a second card colour.
  groupItems: { gap: spacing(0.5), paddingLeft: spacing(2) },
  itemRow: { minHeight: 48, paddingVertical: spacing(1) },
  dot: { width: 12, height: 12, borderRadius: 6 },
  trailing: { flexDirection: "row", alignItems: "center", gap: spacing(1) },
  activeRow: {
    borderWidth: 1,
    borderColor: theme.accent,
    backgroundColor: withAlpha(theme.accent, 0.12),
  },
  menu: { gap: spacing(1), backgroundColor: theme.primary },
  menuError: { color: theme.warning, fontSize: fontSize.sm },
  note: { color: theme.textMuted, fontSize: fontSize.xs, lineHeight: 16 },
  opacity: {
    gap: spacing(0.5),
    paddingTop: spacing(0.5),
  },
  opacityLabel: {
    color: theme.textMuted,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
});
