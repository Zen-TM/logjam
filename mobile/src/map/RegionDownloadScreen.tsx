// "Save maps offline" — frame an area, pick which maps and how much detail, see
// what it costs, download it.
//
// The screen answers ONE question and answers it in the hero: what is this going
// to cost me? Two stats, size and time, of equal weight and on a fixed-height
// line; everything below is the controls that change them, and they update as
// the user drags an edge or changes the detail level, because the tradeoff
// (bigger area / deeper zoom / more maps) is the entire decision.
//
// Saving enqueues the jobs FIRST and asks for a name second, over the top of a
// download already running — the tiles do not wait on the keyboard. Progress is
// reported by the Saved tab's Regions filter, not here.
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
  TextInput,
  View,
} from "react-native";
import { Camera, MapView, RasterLayer } from "@maplibre/maplibre-react-native";
import NetInfo from "@react-native-community/netinfo";
import {
  BASEMAP_CATALOG,
  checkRegionCaps,
  DEM_SOURCE_ID,
  planRegionForBasemaps,
  type OfflineBasemapId,
  type RegionBbox,
} from "@logjam/shared";

import { config } from "../config";
import { formatBytes, formatMinutes } from "../format";
import { useAccountState } from "../auth/AccountStateContext";
import { fontSize, fontWeight, radius, spacing, surface, theme, withAlpha } from "../theme";
import {
  BottomSheet,
  Button,
  Chip,
  HeroHeader,
  SectionHeader,
  SegmentedControl,
  TextField,
} from "../ui";
import {
  enqueueRegionDownloads,
  setRegionGroupLabel,
  useRegionDownloads,
} from "../offline/regionDownloadQueue";
import { isExpensive } from "../offline/networkPolicy";
import { NotEnoughSpaceError, assertSpaceFor } from "../offline/freeSpace";
import { useMapArtifacts } from "../offline/useMapArtifacts";
import { useBasemapAssets } from "./basemap/basemapAssets";
import { ProtomapsLayers } from "./basemap/ProtomapsLayers";
import { buildShellStyle } from "./basemap/shellStyle";
import { BASEMAP_META } from "./basemapMeta";
import { readLastMapCamera } from "./lastCamera";
import { DEFAULT_CENTER, DEFAULT_ZOOM } from "./mapChrome";
import { nextRegionName } from "./regionName";
import { ResolvedSource, sourceIdFor } from "./ResolvedSource";
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
  // The DEM is not a map in the catalog and is not one to the user either —
  // it is what keeps elevation profiles and point heights working out there.
  if (basemapId === DEM_SOURCE_ID) return "Elevation data";
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

/**
 * The controls panel's height, fixed so the MAP never resizes under a frame the
 * user is mid-drag. Nothing inside it changes size any more: the "use mobile
 * data" toggle that used to appear and disappear with the connection is now a
 * dialog at the Save tap, and the warning moved onto the map. What is left —
 * the map-layer chips, the detail rail, the Save button — is always the same
 * shape, so the panel does not scroll.
 *
 * A guest gets one extra line explaining why there is no vector chip. That is
 * decided before the screen mounts and cannot change while it is open, so it is
 * a second constant rather than a reason to make the panel elastic.
 *
 * ponytail: fixed pixels, so a very large OS font setting will clip the last
 * row rather than scroll it. Measure and raise these two numbers if that turns
 * up in the field; making the panel scrollable again just hides the Save button.
 */
const PANEL_HEIGHT = 208;
const PANEL_HEIGHT_GUEST = 250;

/** Same flavor MapScreen mounts — the paper-topo look of the SIX rasters. */
const PROTOMAPS_FLAVOR = "light" as const;

export function RegionDownloadScreen({
  onBack,
  onStarted,
  initialBasemapId,
  initialCenter,
  initialZoom,
}: {
  onBack: () => void;
  /**
   * The downloads are already enqueued and running by the time this fires: it
   * is called once the user has named the area (or dismissed the prompt), and
   * it leaves for the Saved tab's Regions filter, where the progress cards are.
   */
  onStarted: () => void;
  /**
   * What the map screen was showing, so this opens on the same ground. Absent
   * when the screen is reached from Saved, which has no camera of its own —
   * the last settled map camera answers for it (`lastCamera.ts`), and only a
   * session that has never opened the map falls back to the app default.
   */
  initialBasemapId?: BasemapId;
  initialCenter?: [number, number];
  initialZoom?: number;
}) {
  // Read once: `defaultSettings` below is only honoured on the first render,
  // and re-reading a module store mid-session would move the frame the user is
  // already dragging.
  const lastCamera = useRef(readLastMapCamera()).current;
  const startBasemapId: BasemapId =
    initialBasemapId ?? lastCamera?.basemapId ?? "six-topo";
  const startCenter = initialCenter ?? lastCamera?.center ?? DEFAULT_CENTER;
  const startZoom = initialZoom ?? lastCamera?.zoom ?? DEFAULT_ZOOM;
  const basemapAssets = useBasemapAssets();
  const shellStyle = useMemo(
    () => buildShellStyle(basemapAssets.localBaseUrl, PROTOMAPS_FLAVOR),
    [basemapAssets.localBaseUrl],
  );
  const mapRef = useRef<React.ComponentRef<typeof MapView>>(null);

  // The vector clip is cut server-side (POST /basemap/region-clip) and streamed
  // back over an authenticated request, so it is the one map source a guest
  // genuinely cannot have. The three SIX rasters are fetched client-direct from
  // the provider with no Logjam request at all (regionTileDownload.ts) and work
  // exactly as they do for anyone else.
  //
  // Dropped from the list rather than shown disabled, following this screen's
  // existing rule for the unlicensed OSM sources: a chip that exists only to
  // refuse is worse than no chip. The note under the rail says why, and where
  // to change it — which a greyed chip could not.
  const isGuest = useAccountState().accountState === "guest";
  const downloadable = isGuest
    ? DOWNLOADABLE.filter((id) => id !== "protomaps")
    : DOWNLOADABLE;

  const [selected, setSelected] = useState<SelectableId[]>(() =>
    downloadable.includes(startBasemapId as SelectableId)
      ? [startBasemapId as SelectableId]
      : ["six-topo"],
  );
  const [detailZoom, setDetailZoom] = useState(DEFAULT_DETAIL_ZOOM);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [frame, setFrame] = useState<FrameInsets | null>(null);
  const [viewport, setViewport] = useState<FrameViewport | null>(null);
  // Set while the free-space check is in flight, so a second tap can't enqueue
  // the same area twice.
  const [busy, setBusy] = useState(false);
  // The run being named. Non-null means the jobs are ALREADY enqueued and
  // running — this prompt is over the top of them, never in front of them.
  const [naming, setNaming] = useState<{ groupId: string; name: string } | null>(
    null,
  );
  const nameInputRef = useRef<TextInput>(null);

  // "Region 3", numbered off what this phone already holds plus what is still
  // downloading. Nothing in it needs the network or says where the area is
  // (see regionName.ts).
  const { artifacts } = useMapArtifacts();
  const runningJobs = useRegionDownloads();
  const defaultName = useMemo(
    () =>
      nextRegionName([
        ...artifacts
          .filter((artifact) => artifact.kind === "basemap-region")
          .map((artifact) => artifact.groupLabel),
        ...runningJobs.map((job) => job.spec.groupLabel),
      ]),
    [artifacts, runningJobs],
  );

  // Preview the map they are about to save — the LAST one they picked, which
  // is the one the tap was about. Deselecting the previewed map falls back to
  // the default rather than to whatever happens to be left in the list.
  //
  // The default is the vector basemap: it is the detailed one, and it is what
  // the map screen draws. A guest cannot have it (the clip is an authed API
  // call), so their default is the topo raster.
  const defaultPreview: SelectableId = isGuest ? "six-topo" : "protomaps";
  const [preview, setPreview] = useState<SelectableId>(
    () => (downloadable.includes(startBasemapId as SelectableId)
      ? (startBasemapId as SelectableId)
      : defaultPreview),
  );
  const previewBasemap: BasemapId = selected.includes(preview)
    ? preview
    : defaultPreview;
  const previewResolved = useMemo(
    () =>
      resolveMapSource(
        { kind: "basemap", basemapId: previewBasemap },
        // `artifacts: []` on purpose: the preview is the ONLINE map, not
        // whatever this phone already holds. `cdnBaseUrl` is what the vector
        // source's pmtiles:// URL is built from — empty, it resolved to an
        // unfetchable archive path, which is why the vector map never drew.
        { connectivity: "online", artifacts: [], cdnBaseUrl: config.topoCdnBaseUrl },
      ),
    [previewBasemap],
  );

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
  const caps =
    bbox && job ? checkRegionCaps(bbox, job.totalTiles, includesVector) : null;
  const canDownload =
    selected.length > 0 &&
    bbox != null &&
    caps?.ok === true &&
    (job == null || job.totalTiles > 0 || includesVector);

  const centreLat = bbox ? (bbox.north + bbox.south) / 2 : 0;
  // BASEMAP pyramids only. The DEM is in `perSource` too but its zoom is a
  // fixed internal detail, and the caption is about what the user will see.
  // (This list is EMPTY for a vector-only selection — the clip is one file, not
  // a tile pyramid — and Math.max() of nothing is -Infinity, which reached the
  // caption as "z-Infinity · ≈ Infinity m per pixel".)
  const rasterZooms =
    job?.perSource
      .filter((source) => source.basemapId !== DEM_SOURCE_ID)
      .map((source) => source.zMax) ?? [];
  const deepestZoom = rasterZooms.length > 0 ? Math.max(...rasterZooms) : detailZoom;
  const vectorOnly = selected.length > 0 && pyramidIds.length === 0;

  // ONE warning, over the map (DESIGN.md §7). The three cap reasons
  // (edge-too-long, area-too-large, tile-cap) all mean the same thing to the
  // user and all have the same ways out, so they are one chip — three
  // sentences in a hero band cost more map than they ever bought.
  const overCap = caps != null && !caps.ok;

  const startDownloads = useCallback(
    (groupId: string, groupLabel: string, allowCellular: boolean) => {
    if (!bbox || !job) return;
    enqueueRegionDownloads([
      ...job.perSource.map((source) => ({
        taskKind: "tile-pyramid" as const,
        id: uuid(),
        basemapId: source.basemapId,
        label: regionLabelFor(source.basemapId),
        groupId,
        groupLabel,
        bbox,
        zMin: source.zMin,
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
              groupId,
              groupLabel,
              bbox,
              zMax: Math.min(detailZoom, catalogMaxZoom("protomaps")),
              allowCellular,
            },
          ]
        : []),
    ]);
    },
    [bbox, detailZoom, includesVector, job],
  );

  const handleSave = useCallback(() => {
    if (!bbox || !job) return;
    setBusy(true);
    void (async () => {
      try {
        // Asked HERE, at the tap, rather than from a subscription's last
        // value: the answer decides whether tens of megabytes go on someone's
        // plan, and the connection can change between the last event and the
        // tap. It is also why there is no "use mobile data" toggle any more —
        // a switch set before the walk out of Wi-Fi range answers a question
        // about a connection the phone is no longer on.
        const connection = await NetInfo.fetch();
        if (connection.isConnected === false) {
          Alert.alert(
            "No connection",
            "Saving maps needs a connection. Try again once you have one.",
          );
          return;
        }
        // Metered: ask, once, about THIS download. Declining is a cancel, not
        // a setting to go and find.
        let allowCellular = false;
        if (isExpensive(connection)) {
          allowCellular = await new Promise<boolean>((resolve) => {
            Alert.alert(
              "Use mobile data?",
              "You're not on Wi-Fi. This download will use your mobile data.",
              [
                { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
                { text: "Download", onPress: () => resolve(true) },
              ],
              { cancelable: true, onDismiss: () => resolve(false) },
            );
          });
          if (!allowCellular) return;
        }
        // The screen computes and shows a size estimate and then never compared
        // it to the space available. On a full phone the SQLite insert fails
        // mid-batch and the job reports "That didn't finish. Try again." — no
        // hint that the phone is full, and nothing reclaimed. Check before
        // starting; the p90 is what actually lands, so that is what has to fit.
        //
        // This covers the RASTER pyramids only — `p90Bytes` has no entry for
        // the vector clip, whose size the server reports at request time. That
        // one is checked inside `downloadProtomapsRegion`, through the same
        // helper.
        await assertSpaceFor(job.p90Bytes);
        // One id for the whole run: every map chosen here covers the SAME area,
        // so Saved shows them as one card (see MapArtifact.groupId).
        //
        // Enqueue FIRST, ask for a name after: the naming prompt opens over a
        // download that is already running, which is the point of it — the
        // tiles do not wait on the keyboard. The default name is written with
        // the jobs, so dismissing the prompt is a complete answer.
        const groupId = uuid();
        startDownloads(groupId, defaultName, allowCellular);
        setNaming({ groupId, name: defaultName });
      } catch (err) {
        if (!(err instanceof NotEnoughSpaceError)) throw err;
        Alert.alert("Not enough space", `${err.message} Or pick fewer maps.`);
      } finally {
        setBusy(false);
      }
    })();
  }, [bbox, job, defaultName, startDownloads]);

  // Confirm and dismiss do the same thing: the field starts on the default, so
  // an untouched dismissal rewrites the label the jobs already carry. Leaving
  // is deferred to `onClosed` — navigating out from under an open Modal leaves
  // its window animating over the screen it landed on.
  // `BottomSheet` fires `onClosed` once for the close animation it runs on
  // MOUNT (visible has always been false), so leaving is armed here rather
  // than taken from the callback alone.
  const leaving = useRef(false);
  const closeNaming = useCallback(() => {
    if (naming && naming.name.trim().length > 0) {
      setRegionGroupLabel(naming.groupId, naming.name.trim());
    }
    leaving.current = true;
    setNaming(null);
  }, [naming]);

  // Focused on the next frame, not with `autoFocus` — the field mounts inside
  // an animating Modal, whose window is not focusable yet (DESIGN.md §6).
  const isNaming = naming != null;
  useEffect(() => {
    if (!isNaming) return;
    const frame = requestAnimationFrame(() => nameInputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [isNaming]);

  return (
    <View style={styles.root}>
      {/* Wrapped only to lift it above the map, which now slides up under its
          rounded bottom corners. */}
      <View style={styles.hero}>
        <HeroHeader
          onBack={onBack}
          eyebrow="Offline maps"
          title="Save maps offline"
          // TWO stats, equal weight, one line — the two things the decision is
          // actually made on. The tile count and the p90 spread were the third
          // and fourth, they overflowed the line, and neither changes what the
          // user does next. The hero carries no warning slot at all now (the
          // only one left is the chip over the map), which is what keeps its
          // height fixed: a band that appeared and cleared resized the map
          // under a frame the user was already dragging.
          value={
            job && job.totalTiles > 0 ? `≈ ${formatBytes(job.meanBytes)}` : "—"
          }
          secondaryValue={
            job && job.totalTiles > 0 ? formatMinutes(job.seconds) : "—"
          }
          valueSuffix={
            job && job.totalTiles === 0 && includesVector
              ? "the vector map's size is known once it starts"
              : undefined
          }
        />
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
              centerCoordinate: startCenter,
              zoomLevel: startZoom,
            }}
          />
          {previewResolved.map((resolved) =>
            resolved.status === "ok" ? (
              <ResolvedSource key={resolved.key} resolved={resolved}>
                {resolved.sourceType === "vector" ? (
                  // The vector basemap is ~70 generated layers, not one raster
                  // layer — same stack MapScreen mounts, from the same defs.
                  <ProtomapsLayers
                    flavor={PROTOMAPS_FLAVOR}
                    sourceID={sourceIdFor(resolved.key)}
                    startIndex={1}
                  />
                ) : (
                  <RasterLayer
                    id={`region-preview-${resolved.key}`}
                    layerIndex={1}
                    style={{ rasterOpacity: 1 }}
                  />
                )}
              </ResolvedSource>
            ) : null,
          )}
        </MapView>
        {frame && size.width > 0 ? (
          <SelectionFrame insets={frame} size={size} onChange={handleFrameChange} />
        ) : null}
        {/* The screen's ONLY warning, over the map rather than in the hero:
            the hero's band was vertical space the map wanted, and the three
            cap reasons it carried were one message wearing three hats. */}
        {overCap ? (
          <View style={styles.mapWarning} pointerEvents="none">
            <Text style={styles.mapWarningText}>
              Download too large. Reduce the area or detail, or pick fewer map
              layers.
            </Text>
          </View>
        ) : null}
        <View style={styles.mapHint} pointerEvents="none">
          <Text style={styles.mapHintText}>
            Move the map to position it · drag an edge to reshape
          </Text>
        </View>
      </View>

      <View style={[styles.panel, isGuest && styles.panelGuest]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipScroll}
          contentContainerStyle={styles.chipRow}
        >
          {downloadable.map((id) => {
            const active = selected.includes(id);
            return (
              <Chip
                key={id}
                label={DOWNLOAD_CHIP_LABEL[id]}
                icon={BASEMAP_META[id as BasemapId].icon}
                active={active}
                onPress={() => {
                  setSelected((current) =>
                    active
                      ? current.filter((value) => value !== id)
                      : [...current, id],
                  );
                  // Selecting a map previews it; deselecting leaves `preview`
                  // pointing at something no longer in `selected`, which is
                  // read as "back to the default".
                  if (!active) setPreview(id);
                }}
              />
            );
          })}
        </ScrollView>

        {isGuest ? (
          <Text style={styles.guestSourceNote}>
            The detailed vector basemap needs an account. These topographic and
            aerial maps download without one.
          </Text>
        ) : null}

        <View style={styles.panelBody}>
        <View style={styles.detailBlock}>
          <View style={styles.detailHeader}>
            <SectionHeader label="Detail" />
            <Text style={styles.detailCaption}>
              {/* Metres-per-pixel describes a RASTER pyramid: fixed images at
                  fixed scales. A vector clip has no pixels — it redraws sharp
                  at any zoom, and the detail level only caps how much of the
                  archive comes with you. */}
              {vectorOnly
                ? `z${deepestZoom} · sharp at any zoom`
                : `z${deepestZoom} · ≈ ${metresPerPixel(centreLat, deepestZoom).toFixed(1)} m per pixel`}
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

        {/* Progress lives as cards in the Saved tab's Regions filter from
            here: the download outlives this screen, and a screen whose whole
            job is to be left is the wrong place to report from. */}
        <Button
          label={selected.length > 1 ? `Save ${selected.length} maps` : "Save this area"}
          icon="download"
          onPress={handleSave}
          disabled={!canDownload || busy}
        />
        </View>
      </View>

      {/* Opens AFTER the jobs are enqueued — the tiles are landing behind it.
          Dismissing is a complete answer: the default is already the label the
          jobs carry. */}
      <BottomSheet
        visible={naming != null}
        onClose={closeNaming}
        onClosed={() => {
          if (!leaving.current) return;
          leaving.current = false;
          onStarted();
        }}
        title="Name this area"
        footer={<Button label="Done" icon="check" onPress={closeNaming} />}
      >
        <View style={styles.namingBody}>
          <TextField
            label="Name"
            inputRef={nameInputRef}
            value={naming?.name ?? ""}
            onChangeText={(text) =>
              setNaming((current) => (current ? { ...current, name: text } : current))
            }
            placeholder={defaultName}
            returnKeyType="done"
            onSubmitEditing={closeNaming}
          />
          {/* The honesty the progress screen's back-press warning used to
              carry, in the one place every download now passes through. */}
          <Text style={styles.namingNote}>
            Downloads pause when the app is closed. Watch them in Saved.
          </Text>
        </View>
      </BottomSheet>
    </View>
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
  // The one warning, at the TOP of the map — same overlay treatment as the
  // hint along the bottom, in the warning colour. Over the map rather than in
  // the hero so that it costs no layout: the hero and the panel are what the
  // map is measured against, and a band appearing or clearing there resized
  // the map mid-gesture and moved the frame the user was dragging.
  // Clear of the hero, which overlaps the map's top strip: at two lines the
  // pill used to slide up behind it and lose its first line. `HERO_OVERLAP`
  // is that strip; the rest is air.
  mapWarning: {
    position: "absolute",
    left: spacing(2),
    right: spacing(2),
    top: HERO_OVERLAP + spacing(1),
    alignItems: "center",
  },
  // Outlined in the warning colour over a wash of it, rather than the page
  // colour: over a map, a pill painted in the page's own brown reads as a gap
  // in the map. The border is what holds it together at two lines.
  mapWarningText: {
    color: theme.warning,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    textAlign: "center",
    backgroundColor: withAlpha(theme.warning, 0.16),
    borderWidth: 1,
    borderColor: theme.warning,
    borderRadius: radius.lg,
    paddingHorizontal: spacing(1.5),
    paddingVertical: spacing(0.75),
    overflow: "hidden",
  },
  namingBody: { gap: spacing(1.5) },
  namingNote: { color: theme.textMuted, fontSize: fontSize.sm },
  panel: {
    height: PANEL_HEIGHT,
    backgroundColor: theme.primary,
    paddingTop: spacing(1.25),
    paddingBottom: spacing(1.5),
    gap: spacing(1),
    borderTopWidth: 1,
    borderTopColor: surface.border,
  },
  panelGuest: { height: PANEL_HEIGHT_GUEST },
  panelBody: {
    flex: 1,
    paddingHorizontal: spacing(2),
    paddingBottom: spacing(1),
    gap: spacing(1.25),
  },
  // Horizontally scrolling, like the detail rail: four chips wrapped onto a
  // second line and took the height straight out of the map.
  // `flexGrow: 0` and a centred cross-axis: a horizontal ScrollView otherwise
  // grows to fill the panel and stretches its chips into tall ovals.
  chipScroll: { flexGrow: 0 },
  guestSourceNote: {
    color: theme.textMuted,
    fontSize: fontSize.sm,
    paddingHorizontal: spacing(2),
    paddingTop: spacing(0.5),
  },
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
});
