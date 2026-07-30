// "Save maps offline" — frame an area, pick which maps and how much detail, see
// what it costs, download it.
//
// The screen answers ONE question and answers it in the hero: what is this going
// to cost me? Everything below is the controls that change that number, and it
// updates as the user drags an edge or changes the detail level, because the
// tradeoff (bigger area / deeper zoom / more maps) is the entire decision.
//
// Rotation and pitch are disabled here on purpose: the frame→bbox conversion
// reads the map's axis-aligned visible bounds, which a rotated view invalidates
// (see regionFrame.ts).
//
// PRIVACY: the framed bbox exists in component state and goes to the provider as
// tile coordinates only. Nothing about the area reaches the Logjam API — the
// tile-pyramid path never calls it (mobile/CLAUDE.md: region-of-interest bboxes
// stay off the server).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, LayoutChangeEvent, StyleSheet, Text, View } from "react-native";
import { Camera, MapView, RasterLayer } from "@maplibre/maplibre-react-native";
import NetInfo from "@react-native-community/netinfo";
import {
  BASEMAP_CATALOG,
  MAX_REGION_EDGE_KM,
  MAX_REGION_TILES,
  REGION_MIN_ZOOM,
  checkRegionCaps,
  planRegionForBasemaps,
  type OfflineBasemapId,
  type RegionBbox,
} from "@logjam/shared";

import { formatBytes } from "../format";
import { fontSize, fontWeight, radius, spacing, surface, theme, withAlpha } from "../theme";
import {
  Button,
  Chip,
  HeroHeader,
  Row,
  SectionHeader,
  SegmentedControl,
  StatusPill,
  Toggle,
} from "../ui";
import {
  cancelRegionDownload,
  enqueueRegionDownloads,
  pauseRegionDownload,
  resumeRegionDownload,
  useRegionDownloads,
} from "../offline/regionDownloadQueue";
import type { RegionJob } from "../offline/regionDownloadQueue";
import { useBasemapAssets } from "./basemap/basemapAssets";
import { buildShellStyle } from "./basemap/shellStyle";
import { BASEMAP_META } from "./basemapMeta";
import { DEFAULT_CENTER, DEFAULT_ZOOM } from "./mapChrome";
import { ResolvedSource } from "./ResolvedSource";
import {
  defaultFrameInsets,
  frameToBbox,
  metresPerPixel,
  type FrameInsets,
  type FrameViewport,
} from "./regionFrame";
import { SelectionFrame } from "./SelectionFrame";
import { resolveMapSource, type BasemapId } from "./sourceResolver";

/**
 * What may be kept on the device.
 *
 * The three NSW SIX rasters are here because their CC licence permits
 * redistribution (operator-verified); the OSM-family sources are NOT, and are
 * absent rather than disabled — an affordance that exists only to refuse is
 * worse than no affordance. `protomaps` is our own self-hosted vector basemap and
 * arrives as one clip file rather than a tile pyramid (see the queue's two task
 * kinds), which is why it is priced differently below.
 */
type SelectableId = OfflineBasemapId | "protomaps";
const DOWNLOADABLE: SelectableId[] = [
  "six-topo",
  "six-base",
  "six-imagery",
  "protomaps",
];

function isRasterPyramid(id: SelectableId): id is OfflineBasemapId {
  return id !== "protomaps";
}

/**
 * Chip labels, not the catalog's picker names: "Topo Vector (offline-ready)" is
 * a whole row on its own and pushed the chips onto a third line, and every
 * source here is offline-ready by definition.
 */
const DOWNLOAD_CHIP_LABEL: Record<SelectableId, string> = {
  "six-topo": "Topo",
  "six-base": "Base Map",
  "six-imagery": "Imagery",
  protomaps: "Vector",
};

/**
 * Detail levels offered. The ceiling is per-source (topo stops at z16), so the
 * rail shows every level any selected source can reach and each source clamps
 * itself — picking z18 with topo selected saves topo at 16 rather than failing.
 */
const DETAIL_ZOOMS = [12, 13, 14, 15, 16, 17, 18];
const DEFAULT_DETAIL_ZOOM = 16;

function catalogMaxZoom(basemapId: string): number {
  const entry = BASEMAP_CATALOG.find((candidate) => candidate.id === basemapId);
  // `displayMaxZoom`, not `maxNativeZoom`: fetching levels the map will never
  // request is pure cost. (Imagery advertises z20 and serves patchy z18 in the
  // bush — measured.)
  return entry?.displayMaxZoom ?? 16;
}

function uuid(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function regionLabelFor(basemapId: string): string {
  const name = BASEMAP_CATALOG.find((entry) => entry.id === basemapId)?.name;
  return `${name ?? "Map"} region`;
}

function formatMinutes(seconds: number): string {
  if (seconds < 90) return "under a minute";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `about ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `about ${hours} h ${minutes % 60} min`;
}

export function RegionDownloadScreen({
  onBack,
  initialBasemapId = "six-topo",
  initialCenter = DEFAULT_CENTER,
  initialZoom = DEFAULT_ZOOM,
}: {
  onBack: () => void;
  /**
   * What the map screen was showing, so this opens on the same ground. Absent
   * when the screen is reached from Saved, which has no camera of its own —
   * then it opens on the app's default view.
   */
  initialBasemapId?: BasemapId;
  initialCenter?: [number, number];
  initialZoom?: number;
}) {
  const basemapAssets = useBasemapAssets();
  const shellStyle = useMemo(
    () => buildShellStyle(basemapAssets.localBaseUrl, "light"),
    [basemapAssets.localBaseUrl],
  );
  const mapRef = useRef<React.ComponentRef<typeof MapView>>(null);

  const [selected, setSelected] = useState<SelectableId[]>(() =>
    DOWNLOADABLE.includes(initialBasemapId as SelectableId)
      ? [initialBasemapId as SelectableId]
      : ["six-topo"],
  );
  const [detailZoom, setDetailZoom] = useState(DEFAULT_DETAIL_ZOOM);
  const [allowCellular, setAllowCellular] = useState(false);
  const [onCellular, setOnCellular] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [frame, setFrame] = useState<FrameInsets | null>(null);
  const [viewport, setViewport] = useState<FrameViewport | null>(null);
  const jobs = useRegionDownloads();

  // Preview the map they will be saving: the first selected RASTER source (the
  // vector basemap needs its whole generated layer stack, which is not worth
  // mounting for a preview), drawn online — this screen needs a connection.
  const previewBasemap: BasemapId = selected.find(isRasterPyramid) ?? "six-topo";
  const previewResolved = useMemo(
    () =>
      resolveMapSource(
        { kind: "basemap", basemapId: previewBasemap },
        { connectivity: "online", artifacts: [], cdnBaseUrl: "" },
      ),
    [previewBasemap],
  );

  useEffect(() => {
    NetInfo.fetch()
      .then((state) => setOnCellular(state.type === "cellular"))
      .catch(console.error);
  }, []);

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize({ width, height });
    setFrame((current) => current ?? defaultFrameInsets({ width, height }));
  }, []);

  // The map's own bounds are the reference rectangle the frame is measured
  // against. Refreshed when a gesture settles; the frame maths in between is
  // synchronous, so the estimate keeps up with a drag.
  const refreshViewport = useCallback(async () => {
    const bounds = await mapRef.current?.getVisibleBounds();
    if (!bounds || size.width === 0) return;
    const [[neLng, neLat], [swLng, swLat]] = bounds;
    setViewport({
      north: neLat,
      south: swLat,
      east: neLng,
      west: swLng,
      width: size.width,
      height: size.height,
    });
  }, [size.width, size.height]);

  useEffect(() => {
    // Also once on mount, so the estimate is there before the first gesture.
    void refreshViewport();
  }, [refreshViewport]);

  const bbox: RegionBbox | null =
    viewport && frame ? frameToBbox(viewport, frame) : null;

  const pyramidIds = selected.filter(isRasterPyramid);
  const includesVector = selected.includes("protomaps");
  const job = useMemo(
    () =>
      bbox
        ? planRegionForBasemaps(bbox, pyramidIds, detailZoom, catalogMaxZoom)
        : null,
    // `pyramidIds` is derived from `selected` each render; keying on the ids
    // themselves keeps the plan from being rebuilt on every unrelated render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bbox, pyramidIds.join(","), detailZoom],
  );
  const caps = bbox && job ? checkRegionCaps(bbox, job.totalTiles) : null;
  const canDownload =
    selected.length > 0 &&
    bbox != null &&
    caps?.ok === true &&
    (job == null || job.totalTiles > 0 || includesVector);

  const centreLat = bbox ? (bbox.north + bbox.south) / 2 : 0;
  const deepestZoom = job
    ? Math.max(...job.perSource.map((source) => source.zMax))
    : detailZoom;

  const capNote = useMemo(() => {
    if (!caps || caps.ok) return null;
    return caps.reason === "edge-too-long"
      ? `That area is wider than ${MAX_REGION_EDGE_KM} km. Drag an edge in.`
      : `That is more than ${MAX_REGION_TILES.toLocaleString()} tiles. Lower the detail, shrink the area, or pick fewer maps.`;
  }, [caps]);

  const handleSave = useCallback(() => {
    if (!bbox || !job) return;
    if (onCellular && !allowCellular) {
      Alert.alert(
        "You're on mobile data",
        "Turn on “Use mobile data” to download without Wi-Fi.",
      );
      return;
    }
    enqueueRegionDownloads([
      ...job.perSource.map((source) => ({
        taskKind: "tile-pyramid" as const,
        id: uuid(),
        basemapId: source.basemapId,
        label: regionLabelFor(source.basemapId),
        bbox,
        zMax: source.zMax,
        allowCellular,
      })),
      ...(includesVector
        ? [
            {
              taskKind: "http-file" as const,
              id: uuid(),
              basemapId: "protomaps" as const,
              label: regionLabelFor("protomaps"),
              bbox,
              zMax: Math.min(detailZoom, catalogMaxZoom("protomaps")),
              allowCellular,
            },
          ]
        : []),
    ]);
  }, [allowCellular, bbox, detailZoom, includesVector, job, onCellular]);

  const running = jobs.filter((entry) => entry.state.kind !== "ready");
  const finished = jobs.filter((entry) => entry.state.kind === "ready");

  return (
    <View style={styles.root}>
      <HeroHeader
        onBack={onBack}
        eyebrow="Offline maps"
        title="Save maps offline"
        value={
          job && job.totalTiles > 0 ? `≈ ${formatBytes(job.meanBytes)}` : "—"
        }
        valueSuffix={
          job && job.totalTiles > 0
            ? `up to ${formatBytes(job.p90Bytes)} · ${job.totalTiles.toLocaleString()} tiles · ${formatMinutes(job.seconds)}`
            : includesVector
              ? "the vector map's size is known once it starts"
              : undefined
        }
      >
        {capNote ? (
          <Text style={styles.capNote}>{capNote}</Text>
        ) : caps?.ok && caps.softWarn ? (
          <StatusPill
            label="Large area — keep Logjam open"
            tone="warning"
            icon="alert-triangle"
          />
        ) : null}
      </HeroHeader>

      <View style={styles.mapWrap} onLayout={handleLayout}>
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          mapStyle={shellStyle}
          attributionEnabled={false}
          logoEnabled={false}
          compassEnabled={false}
          // North-up only: the frame maths reads axis-aligned bounds.
          rotateEnabled={false}
          pitchEnabled={false}
          onRegionDidChange={() => void refreshViewport()}
        >
          <Camera
            defaultSettings={{
              centerCoordinate: initialCenter,
              zoomLevel: initialZoom,
            }}
          />
          {previewResolved.map((resolved) =>
            resolved.status === "ok" ? (
              <ResolvedSource key={resolved.key} resolved={resolved}>
                <RasterLayer
                  id={`region-preview-${resolved.key}`}
                  layerIndex={1}
                  style={{ rasterOpacity: 1 }}
                />
              </ResolvedSource>
            ) : null,
          )}
        </MapView>
        {frame && size.width > 0 ? (
          <SelectionFrame insets={frame} size={size} onChange={setFrame} />
        ) : null}
        <View style={styles.mapHint} pointerEvents="none">
          <Text style={styles.mapHintText}>
            Move the map to position it · drag an edge to reshape
          </Text>
        </View>
      </View>

      <View style={styles.panel}>
        <View style={styles.chipRow}>
          {DOWNLOADABLE.map((id) => {
            const active = selected.includes(id);
            return (
              <Chip
                key={id}
                label={DOWNLOAD_CHIP_LABEL[id]}
                icon={BASEMAP_META[id as BasemapId].icon}
                active={active}
                onPress={() =>
                  setSelected((current) =>
                    active
                      ? current.filter((value) => value !== id)
                      : [...current, id],
                  )
                }
              />
            );
          })}
        </View>

        <View style={styles.detailBlock}>
          <View style={styles.detailHeader}>
            <SectionHeader label="Detail" />
            <Text style={styles.detailCaption}>
              {`z${deepestZoom} · ≈ ${metresPerPixel(centreLat, deepestZoom).toFixed(1)} m per pixel`}
            </Text>
          </View>
          <SegmentedControl
            scroll
            options={DETAIL_ZOOMS.map((zoom) => ({
              value: String(zoom),
              label: `z${zoom}`,
            }))}
            value={String(detailZoom)}
            onChange={(next) => setDetailZoom(Number(next))}
          />
          {/* Says what the user does NOT choose, once, instead of a per-source
              footnote: every download also takes the wide-context levels. */}
          <Text style={styles.footnote}>
            {`Zoomed-out levels (z${REGION_MIN_ZOOM} up) always come along, so the map isn't blank when you pull back.`}
            {selected.some((id) => catalogMaxZoom(id) < detailZoom)
              ? " Some of these maps stop short of that detail and save as deep as they go."
              : ""}
            {includesVector && job && job.totalTiles > 0
              ? " The vector map is one file from our own server, so it isn't in the size above."
              : ""}
          </Text>
        </View>

        {onCellular ? (
          <Row
            icon="wifi-off"
            hue={theme.warning}
            title="Use mobile data"
            subtitle="Downloads wait for Wi-Fi otherwise"
            right={
              <Toggle
                value={allowCellular}
                onValueChange={setAllowCellular}
                accessibilityLabel="Use mobile data for this download"
              />
            }
          />
        ) : null}

        {running.length === 0 ? (
          <Button
            label={selected.length > 1 ? `Save ${selected.length} maps` : "Save this area"}
            icon="download"
            onPress={handleSave}
            disabled={!canDownload}
          />
        ) : (
          running.map((entry) => (
            <DownloadRow key={entry.spec.id} job={entry} />
          ))
        )}
        {finished.length > 0 ? (
          <Text style={styles.footnote}>
            {finished.length === 1
              ? "1 map saved — it works with no signal from now on."
              : `${finished.length} maps saved — they work with no signal from now on.`}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** One in-flight (or stalled) download, with the action its state allows. */
function DownloadRow({ job }: { job: RegionJob }) {
  const { progress, state, spec } = job;
  const fraction =
    progress.tilesTotal > 0 ? progress.tilesDone / progress.tilesTotal : 0;

  const subtitle = (() => {
    if (state.kind === "queued") return "Waiting its turn";
    if (state.kind === "failed") {
      return state.code === "provider-errors"
        ? "Too many tiles wouldn't load. Try again later."
        : "That didn't finish. Try again.";
    }
    if (state.kind === "paused") {
      switch (state.reason) {
        case "connectivity":
          return "Paused — waiting for Wi-Fi";
        case "background":
          return "Paused — Logjam has to stay open to download";
        case "provider-backoff":
          return "Paused — the map service asked us to slow down";
        default:
          return "Paused";
      }
    }
    const gaps = progress.tilesGap > 0 ? ` · ${progress.tilesGap} not available` : "";
    return `${progress.tilesDone.toLocaleString()} of ${progress.tilesTotal.toLocaleString()} tiles${gaps}`;
  })();

  return (
    <Row
      icon="download"
      title={spec.label}
      subtitle={subtitle}
      progress={state.kind === "downloading" ? fraction : null}
      right={
        <View style={styles.rowActions}>
          {state.kind === "downloading" ? (
            <Button
              label="Pause"
              variant="ghost"
              compact
              onPress={() => pauseRegionDownload(spec.id)}
            />
          ) : (
            <Button
              label="Resume"
              variant="outlineAccent"
              compact
              onPress={() => resumeRegionDownload(spec.id)}
            />
          )}
          <Button
            label="Stop"
            variant="ghost"
            compact
            onPress={() =>
              Alert.alert(
                "Stop this download?",
                "The tiles saved so far are deleted from this phone.",
                [
                  { text: "Keep going", style: "cancel" },
                  {
                    text: "Stop",
                    style: "destructive",
                    onPress: () => cancelRegionDownload(spec.id),
                  },
                ],
              )
            }
          />
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.primary },
  mapWrap: { flex: 1, overflow: "hidden" },
  mapHint: {
    position: "absolute",
    left: spacing(2),
    right: spacing(2),
    bottom: spacing(1),
    alignItems: "center",
  },
  mapHintText: {
    color: theme.textPrimary,
    fontSize: fontSize.xs,
    backgroundColor: withAlpha(theme.primary, 0.85),
    borderRadius: radius.pill,
    paddingHorizontal: spacing(1.5),
    paddingVertical: spacing(0.5),
    overflow: "hidden",
  },
  panel: {
    backgroundColor: theme.primary,
    paddingHorizontal: spacing(2),
    paddingTop: spacing(1.5),
    paddingBottom: spacing(2),
    gap: spacing(1.25),
    borderTopWidth: 1,
    borderTopColor: surface.border,
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing(1) },
  detailBlock: { gap: spacing(0.75) },
  detailHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  detailCaption: { color: theme.textMuted, fontSize: fontSize.xs },
  footnote: {
    color: theme.textMuted,
    fontSize: fontSize.xs,
    lineHeight: 16,
  },
  capNote: {
    color: theme.warning,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  rowActions: { flexDirection: "row", alignItems: "center", gap: spacing(0.5) },
});
