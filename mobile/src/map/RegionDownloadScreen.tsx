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
// tile coordinates only, as byte ranges of public archives to our CDN, and as
// byte ranges of a sharpened area's private archive to the bucket, through the
// presigned URL the account's list gave (offline/regionDownloads.ts). The one
// Logjam API request is for that list, and it carries no bbox: the bbox never
// reaches the API (docs/decisions/0036, update of 2026-10-24). Guards:
// offline/regionDownloads.test.ts ("cuts the clip from the CDN, asking for
// nothing but byte ranges", "cuts a sharpened area's clip through its
// presigned URL, filed under the area").
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  LayoutChangeEvent,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type TextInputInstance,
} from "react-native";
import {
  Camera,
  Layer,
  Map,
  type LngLatBounds,
  type MapRef,
} from "@maplibre/maplibre-react-native";
import NetInfo from "@react-native-community/netinfo";
import {
  BASEMAP_CATALOG,
  checkRegionCaps,
  DEM_SOURCE_ID,
  NSW_5M,
  NSW_CONTOURS,
  NSW_SLOPE,
  planRegionForBasemaps,
  type OfflineBasemapId,
  type RegionBbox,
} from "@logjam/shared";

import { config } from "../config";
import { formatBytes, formatMinutes } from "../format";
import { spacing, makeStyles, muted } from "../theme";
import {
  BottomSheet,
  Button,
  Chip,
  Field,
  Hero,
  Notice,
  ChipRail,
  TextField,
} from "../ui";
import {
  enqueueRegionDownloads,
  setRegionGroupLabel,
  useRegionDownloads,
} from "../offline/regionDownloadQueue";
import { placeRegistryWithRegion } from "../offline/placeRegistry";
import { isExpensive } from "../offline/networkPolicy";
import { NotEnoughSpaceError, assertSpaceFor } from "../offline/freeSpace";
import { regionClipSpecs } from "../offline/regionTilePlanning";
import {
  areaClipBytes,
  areaClipSpecs,
  areasForSave,
  saveGate,
} from "../offline/sharpenedClips";
import { rememberSharpenedAreas } from "../offline/sharpenedAreaStore";
import { useApiQuery } from "../api/queries";
import { useAccountState } from "../auth/AccountStateContext";
import { capabilityStatus } from "../auth/capabilities";
import { getCompletedOverlays } from "./completedOverlays";
import { useConnectivity } from "./connectivity";
import { sharpenedAreasOf } from "./sharpenedArchives";
import { useMapArtifacts } from "../offline/useMapArtifacts";
import { useBasemapAssets } from "./basemap/basemapAssets";
import { ProtomapsLayers } from "./basemap/ProtomapsLayers";
import { PROTOMAPS_FLAVOR } from "./basemap/protomapsLayers";
import { useShellStyle } from "./basemap/shellStyle";
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
 * worse than no affordance.
 *
 * `protomaps`, our own vector basemap, is not a choice here: it comes with
 * every area anyone saves (`regionClipSpecs`). It is a few megabytes
 * against tens for one raster, and the route and measure tools snap to it, so
 * leaving it optional would mean a tool that quietly stops working in the field.
 */
type SelectableId = OfflineBasemapId;
const DOWNLOADABLE: SelectableId[] = ["six-topo", "six-base", "six-imagery"];

/**
 * Chip labels, not the catalog's picker names: "SIX Maps Base Map" on a chip
 * pushed the row onto a third line, and the "SIX Maps" prefix is noise when
 * every chip here carries it.
 */
const DOWNLOAD_CHIP_LABEL: Record<SelectableId, string> = {
  "six-topo": "Topo",
  "six-base": "Base Map",
  "six-imagery": "Imagery",
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
  if (basemapId === NSW_5M.id) return "Elevation data, NSW 5 m";
  if (basemapId === NSW_CONTOURS.id) return "Contours";
  if (basemapId === NSW_SLOPE.id) return "Slope";
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
 * user is mid-drag. Its contents (the map-layer chips, detail rail, and Save
 * button) have a fixed shape, the connection confirmation is a dialog at the
 * Save tap, and warnings overlay the map, so the panel does not scroll.
 *
 * That includes the one line under the chips saying the detailed map comes
 * with every area.
 *
 * ponytail: fixed pixels, so a very large OS font setting will clip the last
 * row rather than scroll it. Measure and raise this number if that turns
 * up in the field; making the panel scrollable again just hides the Save button.
 */
const PANEL_HEIGHT = 250;

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
  const styles = useStyles();

  // Read once: `initialViewState` below is only honoured on the first render,
  // and re-reading a module store mid-session would move the frame the user is
  // already dragging.
  const [lastCamera] = useState(() => readLastMapCamera());
  const startBasemapId: BasemapId =
    initialBasemapId ?? lastCamera?.basemapId ?? "six-topo";
  const startCenter = initialCenter ?? lastCamera?.center ?? DEFAULT_CENTER;
  const startZoom = initialZoom ?? lastCamera?.zoom ?? DEFAULT_ZOOM;
  const basemapAssets = useBasemapAssets();
  const shellStyle = useShellStyle(
    basemapAssets.localBaseUrl,
    PROTOMAPS_FLAVOR,
  );
  const mapRef = useRef<MapRef>(null);

  const downloadable = DOWNLOADABLE;

  const [selected, setSelected] = useState<SelectableId[]>(() =>
    downloadable.includes(startBasemapId as SelectableId)
      ? [startBasemapId as SelectableId]
      : // Arriving from the Vector map: that map is coming anyway, so nothing
        // else is picked for them.
        startBasemapId === "protomaps"
        ? []
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
  const [naming, setNaming] = useState<{
    groupId: string;
    name: string;
  } | null>(null);
  const nameInputRef = useRef<TextInputInstance>(null);

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
  // The default is the vector basemap: it is the detailed one, it is what the
  // map screen draws, and every area saves it.
  const defaultPreview: BasemapId = "protomaps";
  const [preview, setPreview] = useState<BasemapId>(() =>
    downloadable.includes(startBasemapId as SelectableId)
      ? startBasemapId
      : defaultPreview,
  );
  const previewBasemap: BasemapId = (selected as BasemapId[]).includes(preview)
    ? preview
    : defaultPreview;
  const previewResolved = useMemo(
    () =>
      resolveMapSource(
        { kind: "basemap", basemapId: previewBasemap },
        // `artifacts: []` on purpose: the preview is the ONLINE map, not
        // whatever this phone already holds. `cdnBaseUrl` builds the vector
        // source's pmtiles:// URL — without it, it would resolve to an
        // unfetchable archive path.
        {
          connectivity: "online",
          artifacts: [],
          cdnBaseUrl: config.topoCdnBaseUrl,
        },
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
  // against. The frame maths in between is synchronous, so the estimate keeps
  // up with a drag.
  const applyBounds = useCallback(
    (bounds: LngLatBounds) => {
      if (size.width === 0) return;
      const [west, south, east, north] = bounds;
      setViewport({
        north,
        south,
        east,
        west,
        width: size.width,
        height: size.height,
      });
    },
    [size.width, size.height],
  );

  /**
   * THE FIRST READING HAS TO WAIT FOR THE MAP TO EXIST.
   *
   * MLRN 11's native getBounds is `mapLibreMap!!.projection.visibleRegion` — a
   * non-null assertion on a field that is null until the map is created. Asking
   * on mount therefore races the map: winning it gives a viewport, losing it
   * throws a Kotlin NPE that React Native promotes to a HOST exception, which
   * tears down the whole React instance. That is not a JS error, so the root
   * error boundary never sees it — the screen just goes blank and Logjam GPS has
   * to be killed and reopened.
   *
   * Gated on `onDidFinishLoadingMap` below, which cannot fire before the map
   * exists. Every later reading comes off the region event instead (see
   * `onRegionDidChange`), so this is the only native call left.
   */
  const [mapReady, setMapReady] = useState(false);
  const refreshViewport = useCallback(async () => {
    const bounds = await mapRef.current?.getBounds();
    if (bounds) applyBounds(bounds);
  }, [applyBounds]);

  useEffect(() => {
    // `size` arrives from onLayout, which can land either side of the map
    // finishing its load; both have to be in before the first reading.
    if (!mapReady || size.width === 0) return;
    void refreshViewport();
  }, [mapReady, size.width, refreshViewport]);

  const bbox: RegionBbox | null =
    viewport && frame ? frameToBbox(viewport, frame) : null;

  // The account's sharpened areas the box reaches go into the save, cut
  // through the list's presigned URLs (offline/sharpenedClips.ts). A guest has
  // none; a signed-in save waits for the list rather than leave them out.
  // Online passed as true, as `capabilityScreenBlock` does: offline the
  // query fails and says so, where a disabled one would wait for good.
  const loadsAreas =
    capabilityStatus("lidarOverlays", useAccountState().accountState, true)
      .status === "available";
  const overlays = useApiQuery(
    getCompletedOverlays,
    "Couldn't load your sharpened areas, so this area can't be saved yet.",
    loadsAreas,
  );
  const areasState = areasForSave(loadsAreas, overlays);
  // Offline, Save goes ahead to its "needs a connection" alert; online it
  // waits for the list, or is saved without the areas after a warning.
  const gate = saveGate(areasState, useConnectivity() === "online");
  const { sharpenedAreas, areasEpoch } = useMemo(
    () => sharpenedAreasOf(overlays.data, loadsAreas),
    [loadsAreas, overlays.data],
  );
  // The list the clips are cut from is the one the offline map and sampler
  // must know, or an area new since the map loaded its list would be saved
  // but never drawn or read.
  useEffect(() => {
    if (overlays.data && loadsAreas)
      void rememberSharpenedAreas(sharpenedAreas, areasEpoch);
  }, [overlays.data, loadsAreas, sharpenedAreas, areasEpoch]);
  const areaBytes = bbox ? areaClipBytes(sharpenedAreas, bbox) : 0;

  const pyramidIds = selected;
  // Not memoised: `bbox` is a fresh object every render, so no key could hold.
  const job = bbox
    ? planRegionForBasemaps(bbox, pyramidIds, detailZoom, catalogMaxZoom)
    : null;
  const caps = bbox && job ? checkRegionCaps(bbox, job.totalTiles) : null;
  // The vector map comes with every area and is a download worth making on
  // its own, so no raster need be picked.
  const mapCount = selected.length + 1;
  const canDownload = bbox != null && caps?.ok === true && gate.canSave;

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
  const deepestZoom =
    rasterZooms.length > 0 ? Math.max(...rasterZooms) : detailZoom;
  const vectorOnly = pyramidIds.length === 0;

  // ONE warning, over the map (DESIGN.md). The three cap reasons
  // (edge-too-long, area-too-large, tile-cap) all mean the same thing to the
  // user and all have the same ways out, so they are one chip — three
  // sentences in a hero band cost more map than they ever bought.
  const overCap = caps != null && !caps.ok;

  const startDownloads = useCallback(
    (
      groupId: string,
      groupLabel: string,
      allowCellular: boolean,
      withAreas: boolean,
    ) => {
      if (!bbox || !job) return;
      enqueueRegionDownloads([
        // First, while the list's presigned URLs are freshest: the queue runs
        // one job at a time, and an expired URL fails its clip for good.
        ...areaClipSpecs(
          { bbox, groupId, groupLabel, allowCellular },
          withAreas ? sharpenedAreas : [],
          uuid,
        ),
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
        ...regionClipSpecs(
          { bbox, groupId, groupLabel, allowCellular },
          job.demArchives.map(({ sourceId }) => sourceId),
          (basemapId) => ({ id: uuid(), label: regionLabelFor(basemapId) }),
        ),
      ]);
      // The first region brings the place names for search (ADR 0034).
      placeRegistryWithRegion(allowCellular);
    },
    [bbox, job, sharpenedAreas],
  );

  // `withAreas` false only from the failed-list warning's "Save without
  // sharpened areas".
  const handleSave = useCallback(
    (withAreas: boolean) => {
      if (!bbox || !job) return;
      setBusy(true);
      void (async () => {
        try {
          // Asked HERE, at the tap, rather than from a subscription's last
          // value: the answer decides whether tens of megabytes go on someone's
          // plan, and the connection can change between the last event and the
          // tap. It is also why there is no "use mobile data" toggle: a switch
          // set before the walk out of Wi-Fi range answers a question about a
          // connection the phone is no longer on.
          const connection = await NetInfo.fetch();
          if (connection.isConnected === false) {
            Alert.alert(
              "No connection",
              "Saving maps needs a connection. Try again when you have one.",
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
                "This download will use your mobile data.",
                [
                  {
                    text: "Cancel",
                    style: "cancel",
                    onPress: () => resolve(false),
                  },
                  { text: "Download", onPress: () => resolve(true) },
                ],
                { cancelable: true, onDismiss: () => resolve(false) },
              );
            });
            if (!allowCellular) return;
          }
          // Check space before starting: on a full phone the SQLite insert would
          // fail mid-batch and report a generic failure with nothing reclaimed.
          // The p90 estimate is what actually lands, so that is what has to fit.
          //
          // `p90Bytes` has no entry for the vector clip, whose size is known
          // once its directories are read. That one is checked inside
          // `runRegionClip`, through the same helper.
          await assertSpaceFor(job.p90Bytes + (withAreas ? areaBytes : 0));
          // One id for the whole run: every map chosen here covers the SAME area,
          // so Saved shows them as one card (see MapArtifact.groupId).
          //
          // Enqueue FIRST, ask for a name after: the naming prompt opens over a
          // download that is already running, which is the point of it — the
          // tiles do not wait on the keyboard. The default name is written with
          // the jobs, so dismissing the prompt is a complete answer.
          const groupId = uuid();
          startDownloads(groupId, defaultName, allowCellular, withAreas);
          setNaming({ groupId, name: defaultName });
        } catch (err) {
          if (!(err instanceof NotEnoughSpaceError)) throw err;
          Alert.alert("Not enough space", `${err.message} Or pick fewer maps.`);
        } finally {
          setBusy(false);
        }
      })();
    },
    [bbox, job, areaBytes, defaultName, startDownloads],
  );

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
  // an animating Modal, whose window is not focusable yet (DESIGN.md).
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
        <Hero
          onBack={onBack}
          eyebrow="Offline maps"
          title="Save maps offline"
          // TWO stats, equal weight, one line — the two things the decision is
          // actually made on. Showing additional stats would overflow the
          // line without changing what the user does next. The hero carries no
          // warning slot (warnings overlay the map), keeping its height fixed
          // so the map does not resize under a frame the user is actively
          // dragging.
          value={
            job && job.totalTiles > 0
              ? `≈ ${formatBytes(job.meanBytes + areaBytes)}`
              : "—"
          }
          secondaryValue={
            job && job.totalTiles > 0 ? formatMinutes(job.seconds) : "—"
          }
        />
      </View>

      {/* The map slides UP under the hero's rounded bottom corners, so those
          two notches show map instead of page colour. The frame's top inset is
          clamped to the same overlap, or the top edge handle can be dragged in
          behind the hero and become ungrabbable. */}
      <View style={styles.mapWrap} onLayout={handleLayout}>
        <Map
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          mapStyle={shellStyle}
          attribution={false}
          logo={false}
          compass={false}
          // North-up only: the frame maths reads axis-aligned bounds.
          touchRotate={false}
          touchPitch={false}
          // The settled bounds ride the event, so no native call and no race.
          onRegionDidChange={(event) => applyBounds(event.nativeEvent.bounds)}
          onDidFinishLoadingMap={() => setMapReady(true)}
        >
          <Camera
            initialViewState={{
              center: startCenter,
              zoom: startZoom,
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
                  <Layer
                    key={`region-preview-${resolved.key}`}
                    type="raster"
                    id={`region-preview-${resolved.key}`}
                    layerIndex={1}
                    style={{ rasterOpacity: 1 }}
                  />
                )}
              </ResolvedSource>
            ) : null,
          )}
        </Map>
        {frame && size.width > 0 ? (
          <SelectionFrame
            insets={frame}
            size={size}
            onChange={handleFrameChange}
          />
        ) : null}
        {/* The screen's ONLY warning, over the map rather than in the hero:
            a hero band would take vertical space the map needs, and the three
            cap reasons represent one message wearing three hats. One at a
            time: the cap first, then the account's area list, which a save
            waits for (`areasForSave`). */}
        {overCap ? (
          <View style={styles.mapWarning} pointerEvents="none">
            <Notice icon="warning" tone="warning">
              Too large — reduce the area or detail, or pick fewer maps.
            </Notice>
          </View>
        ) : gate.warning === "failed" ? (
          // `box-none`: "Try again" takes a press, and the strip around it
          // still lets the frame's top handle and a pan through.
          <View style={styles.mapWarning} pointerEvents="box-none">
            <Notice
              icon="warning"
              tone="warning"
              action={
                <View style={styles.warningActions}>
                  <Button
                    label="Try again"
                    variant="outlineAccent"
                    onPress={overlays.refetch}
                  />
                  <Button
                    label="Save without sharpened areas"
                    variant="outlineAccent"
                    onPress={() => handleSave(false)}
                    disabled={bbox == null || caps?.ok !== true || busy}
                  />
                </View>
              }
            >
              {overlays.error ?? ""}
            </Notice>
          </View>
        ) : gate.warning === "loading" ? (
          <View style={styles.mapWarning} pointerEvents="none">
            <Notice>Checking for your sharpened areas…</Notice>
          </View>
        ) : null}
        <View style={styles.mapHint} pointerEvents="none">
          <Notice>Move the map · drag edges to resize</Notice>
        </View>
      </View>

      <View style={styles.panel}>
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
                icon="map"
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

        <Text style={styles.sourceNote}>
          The detailed map is saved with every area.
        </Text>

        <View style={styles.panelBody}>
          <Field
            label="Detail"
            aside={
              <Text style={styles.detailCaption}>
                {/* Metres-per-pixel describes a RASTER pyramid: fixed images at
                  fixed scales. A vector clip has no pixels — it redraws sharp
                  at any zoom, and the detail level only caps how much of the
                  archive comes with you. */}
                {vectorOnly
                  ? "Detailed map only · sharp at any zoom"
                  : `z${deepestZoom} · ≈ ${metresPerPixel(centreLat, deepestZoom).toFixed(1)} m per pixel`}
              </Text>
            }
          >
            <ChipRail
              scroll
              options={DETAIL_ZOOMS.map((zoom) => ({
                value: String(zoom),
                label: `z${zoom}`,
              }))}
              value={String(detailZoom)}
              onChange={(next) => setDetailZoom(Number(next))}
            />
          </Field>

          {/* Progress lives as cards in the Saved tab's Regions filter from
            here: the download outlives this screen, and a screen whose whole
            job is to be left is the wrong place to report from. */}
          <Button
            label={mapCount > 1 ? `Save ${mapCount} maps` : "Save this area"}
            icon="saveOffline"
            onPress={() => handleSave(true)}
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
        footer={<Button label="Done" icon="done" onPress={closeNaming} />}
      >
        <View style={styles.namingBody}>
          <TextField
            label="Name"
            inputRef={nameInputRef}
            value={naming?.name ?? ""}
            onChangeText={(text) =>
              setNaming((current) =>
                current ? { ...current, name: text } : current,
              )
            }
            placeholder={defaultName}
            returnKeyType="done"
            onSubmitEditing={closeNaming}
          />
          <Text style={styles.namingNote}>
            Downloads keep going after you leave Logjam GPS. Watch them in
            Saved.
          </Text>
        </View>
      </BottomSheet>
    </View>
  );
}

const useStyles = makeStyles((theme, textRole) => ({
  root: { flex: 1, backgroundColor: theme.page },
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
  // The one warning, at the TOP of the map — same overlay treatment as the
  // hint along the bottom, in the warning colour. Over the map rather than in
  // the hero so that it costs no layout: the hero and the panel are what the
  // map is measured against, and a band appearing or clearing there would resize
  // the map mid-gesture and move the frame the user is dragging.
  // Clear of the hero, which overlaps the map's top strip: at two lines the
  // pill would slide up behind it and lose its first line. `HERO_OVERLAP`
  // is that strip; the rest is air.
  mapWarning: {
    position: "absolute",
    left: spacing(2),
    right: spacing(2),
    top: HERO_OVERLAP + spacing(1),
    alignItems: "center",
  },
  warningActions: { gap: spacing(1) },
  namingBody: { gap: spacing(1.5) },
  namingNote: { ...muted(theme, textRole.detail) },
  panel: {
    height: PANEL_HEIGHT,
    backgroundColor: theme.page,
    paddingTop: spacing(1),
    paddingBottom: spacing(1.5),
    gap: spacing(1),
    borderTopWidth: 1,
    borderTopColor: theme.line,
  },
  panelBody: {
    flex: 1,
    paddingHorizontal: spacing(2),
    paddingBottom: spacing(1),
    gap: spacing(1),
  },
  // Horizontally scrolling, like the detail rail: wrapping chips onto a
  // second line would take the height straight out of the map.
  // `flexGrow: 0` and a centred cross-axis: a horizontal ScrollView otherwise
  // grows to fill the panel and stretches its chips into tall ovals.
  chipScroll: { flexGrow: 0 },
  sourceNote: {
    ...muted(theme, textRole.detail),
    paddingHorizontal: spacing(2),
    paddingTop: spacing(0.5),
  },
  chipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(1),
    paddingHorizontal: spacing(2),
  },
  detailCaption: { ...muted(theme, textRole.meta) },
}));
