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
import { useEffect, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { BASEMAP_CATALOG, formatDistanceM } from "@logjam/shared";

import { assetHue, fontSize, fontWeight, spacing, theme, withAlpha } from "../theme";
import {
  BottomSheet,
  IconButton,
  Row,
  SectionHeader,
  SegmentedControl,
  StatusPill,
  Toggle,
} from "../ui";
import { RESIDUAL_WARN_FRACTION } from "../geopdf/importPipeline";
import type { GeoPdfImport } from "../geopdf/geoPdfImportsDb";
import type { VectorImport } from "../imports/importsDb";
import type { Track } from "../tracks/tracksDb";
import {
  listUnfinishedRegions,
  deleteRegionFile,
  type UnfinishedRegion,
} from "../offline/regionMbtiles";
import {
  enqueueRegionDownloads,
  useRegionDownloads,
} from "../offline/regionDownloadQueue";
import { BASEMAP_META } from "./basemapMeta";
import type { Connectivity } from "./connectivity";
import type { BasemapId, MapArtifact } from "./sourceResolver";

/** Steps rather than a slider: a horizontal drag inside a sheet fights the
 *  sheet's own drag-to-dismiss (DESIGN.md §9). */
const GEOPDF_OPACITY_STEPS = [0.2, 0.4, 0.6, 0.8, 1] as const;

type Tab = "basemap" | "layers" | "offline";

export type OverlayEntry = {
  key: string;
  label: string;
};

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
  geoPdfImports,
  onGeoPdfChange,
  imports,
  onImportVisibility,
  tracks,
  onTrackVisibility,
  showCanyonRoutes,
  onShowCanyonRoutesChange,
  canyonRouteHue,
  offlineOnly,
  onOfflineOnlyChange,
  onSaveArea,
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
  geoPdfImports: GeoPdfImport[];
  onGeoPdfChange: (id: string, patch: { visible?: boolean; opacity?: number }) => void;
  imports: VectorImport[];
  onImportVisibility: (id: string, visible: boolean) => void;
  tracks: Track[];
  onTrackVisibility: (id: string, visible: boolean) => void;
  showCanyonRoutes: boolean;
  onShowCanyonRoutesChange: (next: boolean) => void;
  /** The colour the routes are actually drawn in, so the row matches the map. */
  canyonRouteHue: string;
  offlineOnly: boolean;
  onOfflineOnlyChange: (next: boolean) => void;
  onSaveArea: () => void;
  onOpenSaved: () => void;
}) {
  const [tab, setTab] = useState<Tab>("basemap");
  const online = connectivity === "online";
  const readyGeoPdfs = geoPdfImports.filter((entry) => entry.state === "ready");
  const savedTracks = tracks.filter((track) => track.state === "done");

  const visibleLayerCount =
    enabledOverlays.size +
    readyGeoPdfs.filter((entry) => entry.visible).length +
    imports.filter((entry) => entry.visible).length +
    savedTracks.filter((track) => track.visible).length +
    (showCanyonRoutes ? 1 : 0);

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Map layers">
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
          artifacts={artifacts}
          online={online}
        />
      ) : null}

      {tab === "layers" ? (
        <LayersTab
          overlays={overlays}
          enabledOverlays={enabledOverlays}
          onToggleOverlay={onToggleOverlay}
          artifacts={artifacts}
          geoPdfImports={readyGeoPdfs}
          onGeoPdfChange={onGeoPdfChange}
          imports={imports}
          onImportVisibility={onImportVisibility}
          tracks={savedTracks}
          onTrackVisibility={onTrackVisibility}
          showCanyonRoutes={showCanyonRoutes}
          onShowCanyonRoutesChange={onShowCanyonRoutesChange}
          canyonRouteHue={canyonRouteHue}
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
  artifacts,
  online,
}: {
  basemapId: BasemapId;
  onBasemapChange: (id: BasemapId) => void;
  artifacts: MapArtifact[];
  online: boolean;
}) {
  // Offline-capable sources first. The catalog's own order leads with the three
  // OSM ones, which are the least useful here — they can't be saved, and offline
  // they are the rows that grey out. What a canyoner reaches for goes on top.
  const ordered = [
    ...BASEMAP_CATALOG.filter((entry) => entry.offlineCapable),
    ...BASEMAP_CATALOG.filter((entry) => !entry.offlineCapable),
  ];

  return (
    <View style={styles.body}>
      {ordered.map((entry) => {
        const id = entry.id as BasemapId;
        const meta = BASEMAP_META[id];
        const saved = artifacts.some(
          (artifact) =>
            artifact.kind === "basemap-region" && artifact.logicalKey === entry.id,
        );
        // Online-only sources are unavailable offline BY POLICY (their tile
        // usage terms), which is a different thing from "not downloaded" — the
        // subtitle says which.
        const unavailable = !online && !entry.offlineCapable;
        const active = basemapId === id;
        return (
          <Row
            key={entry.id}
            icon={meta.icon}
            hue={assetHue.region}
            title={entry.name}
            subtitle={unavailable ? "Needs a connection" : meta.blurb}
            disabled={unavailable}
            onPress={() => onBasemapChange(id)}
            right={
              <View style={styles.trailing}>
                {saved ? <StatusPill label="Offline" tone="accent" icon="check" /> : null}
                {active ? (
                  <StatusPill label="Showing" tone="outline" />
                ) : null}
              </View>
            }
            style={active ? styles.activeRow : undefined}
          />
        );
      })}
    </View>
  );
}

function LayersTab({
  overlays,
  enabledOverlays,
  onToggleOverlay,
  artifacts,
  geoPdfImports,
  onGeoPdfChange,
  imports,
  onImportVisibility,
  tracks,
  onTrackVisibility,
  showCanyonRoutes,
  onShowCanyonRoutesChange,
  canyonRouteHue,
}: {
  overlays: OverlayEntry[];
  enabledOverlays: ReadonlySet<string>;
  onToggleOverlay: (key: string) => void;
  artifacts: MapArtifact[];
  geoPdfImports: GeoPdfImport[];
  onGeoPdfChange: (id: string, patch: { visible?: boolean; opacity?: number }) => void;
  imports: VectorImport[];
  onImportVisibility: (id: string, visible: boolean) => void;
  tracks: Track[];
  onTrackVisibility: (id: string, visible: boolean) => void;
  showCanyonRoutes: boolean;
  onShowCanyonRoutesChange: (next: boolean) => void;
  canyonRouteHue: string;
}) {
  return (
    <View style={styles.body}>
      <SectionHeader label="Canyons" />
      {/* Web parity: the web map can draw every canyon's route as a layer.
          Mobile only ever drew one at a time, transiently, from a canyon's own
          screen. The mirror already holds the files, so this works offline. */}
      <Row
        icon="git-commit"
        hue={canyonRouteHue}
        title="Canyon routes"
        subtitle="Every route you have, drawn at once"
        right={
          <Toggle
            value={showCanyonRoutes}
            onValueChange={onShowCanyonRoutesChange}
            accessibilityLabel="Show canyon routes"
          />
        }
      />

      {overlays.length > 0 ? (
        <>
          <SectionHeader label="Topo overlays" />
          {overlays.map((overlay) => {
            const saved = artifacts.some(
              (artifact) =>
                artifact.kind === "topo-overlay" &&
                artifact.logicalKey === overlay.key,
            );
            return (
              <Row
                key={overlay.key}
                icon="layers"
                hue={assetHue.overlay}
                title={overlay.label}
                right={
                  <View style={styles.trailing}>
                    {saved ? <StatusPill label="Offline" tone="accent" /> : null}
                    <Toggle
                      value={enabledOverlays.has(overlay.key)}
                      onValueChange={() => onToggleOverlay(overlay.key)}
                      accessibilityLabel={`Show ${overlay.label}`}
                    />
                  </View>
                }
              />
            );
          })}
        </>
      ) : null}

      {geoPdfImports.length > 0 ? (
        <>
          <SectionHeader label="GeoPDF maps" />
          {geoPdfImports.map((geoPdf) => (
            <View key={geoPdf.id} style={styles.stack}>
              <Row
                icon="file-text"
                hue={assetHue.geoPdf}
                title={geoPdf.label}
                right={
                  <Toggle
                    value={geoPdf.visible}
                    onValueChange={() =>
                      onGeoPdfChange(geoPdf.id, { visible: !geoPdf.visible })
                    }
                    accessibilityLabel={`Show ${geoPdf.label}`}
                  />
                }
              />
              {geoPdf.residualFraction != null &&
              geoPdf.residualFraction > RESIDUAL_WARN_FRACTION ? (
                <Text style={styles.note}>
                  Georeferencing in this file is imprecise — positions may be off.
                </Text>
              ) : null}
              {geoPdf.visible ? (
                <View style={styles.opacity}>
                  <Text style={styles.opacityLabel}>Opacity</Text>
                  <SegmentedControl
                    options={GEOPDF_OPACITY_STEPS.map((step) => ({
                      value: String(step),
                      label: `${Math.round(step * 100)}%`,
                    }))}
                    value={String(
                      GEOPDF_OPACITY_STEPS.find(
                        (step) => Math.abs(geoPdf.opacity - step) < 0.01,
                      ) ?? 1,
                    )}
                    onChange={(next) =>
                      onGeoPdfChange(geoPdf.id, { opacity: Number(next) })
                    }
                  />
                </View>
              ) : null}
            </View>
          ))}
        </>
      ) : null}

      {imports.length > 0 ? (
        <>
          <SectionHeader label="Imported files" />
          {imports.map((imported) => (
            <Row
              key={imported.id}
              icon="map"
              hue={imported.color}
              title={imported.name}
              right={
                <Toggle
                  value={imported.visible}
                  onValueChange={() =>
                    onImportVisibility(imported.id, !imported.visible)
                  }
                  accessibilityLabel={`Show ${imported.name}`}
                />
              }
            />
          ))}
        </>
      ) : null}

      <SectionHeader label="Tracks" />
      {tracks.length === 0 ? (
        <Text style={styles.note}>
          Nothing recorded yet. The record button on the map starts one.
        </Text>
      ) : (
        tracks.map((track) => (
          <Row
            key={track.id}
            icon="activity"
            hue={track.color}
            title={track.name}
            subtitle={formatDistanceM(track.distanceM)}
            right={
              <Toggle
                value={track.visible}
                onValueChange={() => onTrackVisibility(track.id, !track.visible)}
                accessibilityLabel={`Show ${track.name}`}
              />
            }
          />
        ))
      )}
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
  onOpenSaved: () => void;
  artifacts: MapArtifact[];
  visible: boolean;
}) {
  const [unfinished, setUnfinished] = useState<UnfinishedRegion[]>([]);
  const jobs = useRegionDownloads();
  const activeIds = new Set(jobs.map((job) => job.spec.id));

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
        onPress={onOpenSaved}
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
  trailing: { flexDirection: "row", alignItems: "center", gap: spacing(1) },
  activeRow: {
    borderWidth: 1,
    borderColor: withAlpha(theme.accent, 0.5),
  },
  note: { color: theme.textMuted, fontSize: fontSize.xs, lineHeight: 16 },
  opacity: {
    gap: spacing(0.5),
    paddingLeft: spacing(1),
    paddingBottom: spacing(0.5),
  },
  opacityLabel: {
    color: theme.textMuted,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
});
