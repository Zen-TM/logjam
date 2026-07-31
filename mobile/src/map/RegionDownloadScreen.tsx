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
import {
  Alert,
  LayoutChangeEvent,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Camera, MapView, RasterLayer } from "@maplibre/maplibre-react-native";
import NetInfo from "@react-native-community/netinfo";
import {
  BASEMAP_CATALOG,
  MAX_REGION_EDGE_KM,
  MAX_REGION_TILES,
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
 * Chip labels, not the catalog's picker names: "SIX Maps Base Map" on a chip
 * pushed the row onto a third line, and the "SIX Maps" prefix is noise when
 * every chip here carries it.
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

/** How far the map runs up behind the hero — one corner radius. */
const HERO_OVERLAP = 16;
/**
 * Lowest the top edge may go. The overlap plus half a handle: clamping to the
 * overlap alone leaves the handle's upper half behind the hero, which is still
 * a handle you have to aim under.
 */
const MIN_TOP_INSET = HERO_OVERLAP + 22;

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

  // Stable identity: the frame's gesture handlers are rebuilt whenever this
  // changes, and rebuilding one mid-drag kills the drag (see SelectionFrame).
  const handleFrameChange = useCallback((next: FrameInsets) => {
    // Never let the top edge slide up behind the hero, which overlaps the map
    // — a handle under it can't be grabbed again.
    setFrame({ ...next, top: Math.max(MIN_TOP_INSET, next.top) });
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
      {/* Wrapped only to lift it above the map, which now slides up under its
          rounded bottom corners. */}
      <View style={styles.hero}>
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
          {/* Always mounted, even when empty: the hero and the panel are the
              two things the map is measured against, and a warning appearing
              or clearing used to resize the map under a frame the user was
              already dragging. Two lines tall — the tile-cap sentence names
              the three ways out of it and clipping the way out is worse than
              an empty band. */}
          <View style={styles.heroNote}>
            {capNote ? (
              <Text style={styles.capNote} numberOfLines={2}>
                {capNote}
              </Text>
            ) : caps?.ok && caps.softWarn ? (
              <StatusPill
                label="Large area — keep Logjam open"
                tone="warning"
                icon="alert-triangle"
              />
            ) : null}
          </View>
        </HeroHeader>
      </View>

      {/* The map slides UP under the hero's rounded bottom corners, so those
          two notches show map instead of page colour. The frame's top inset is
          clamped to the same overlap, or the top edge handle can be dragged in
          behind the hero and become ungrabbable. */}
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
          <SelectionFrame insets={frame} size={size} onChange={handleFrameChange} />
        ) : null}
        <View style={styles.mapHint} pointerEvents="none">
          <Text style={styles.mapHintText}>
            Move the map to position it · drag an edge to reshape
          </Text>
        </View>
      </View>

      <View style={styles.panel}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipScroll}
          contentContainerStyle={styles.chipRow}
        >
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
        </ScrollView>

        <ScrollView
          style={styles.panelScroll}
          contentContainerStyle={styles.panelScrollContent}
        >
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
        </ScrollView>
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
  // The hero paints over the map's top strip, so it has to win the z-order.
  hero: { zIndex: 1 },
  mapWrap: { flex: 1, overflow: "hidden", marginTop: -HERO_OVERLAP },
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
  // Fixed height, both of them: the map fills what is left, and a panel that
  // grew or shrank (a cellular row appearing, a warning clearing, a download
  // row replacing the button) resized the map mid-gesture and moved the frame
  // the user was dragging.
  heroNote: { height: 44, justifyContent: "center" },
  panel: {
    height: 208,
    backgroundColor: theme.primary,
    paddingTop: spacing(1.25),
    paddingBottom: spacing(1.5),
    gap: spacing(1),
    borderTopWidth: 1,
    borderTopColor: surface.border,
  },
  panelScroll: { flex: 1 },
  panelScrollContent: {
    paddingHorizontal: spacing(2),
    paddingBottom: spacing(1),
    gap: spacing(1.25),
  },
  // Horizontally scrolling, like the detail rail: four chips wrapped onto a
  // second line and took the height straight out of the map.
  // `flexGrow: 0` and a centred cross-axis: a horizontal ScrollView otherwise
  // grows to fill the panel and stretches its chips into tall ovals.
  chipScroll: { flexGrow: 0 },
  chipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(1),
    paddingHorizontal: spacing(2),
  },
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
