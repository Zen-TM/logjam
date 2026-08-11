// Map core (Stage 2, online) — full-bleed map with raster + Protomaps vector
// basemaps, canyon overlay (owned vs shared theming), raster + vector topo
// overlays (user vectorStyle), tap → detail, locate-me. Every tile source
// flows through the resolver so Stage 4 offline downloads change data, not
// this screen.
//
// NOTE (Android): MapLibre runs the Vulkan backend (app.json MLRN plugin
// `nativeVariant: "vulkan"`). The OpenGL backend never draws ANY symbol layer
// (text or icons) on modern emulators — silent, no glyph errors — because its
// emulator detection (maplibre-native #3617) misses current AVD fingerprints.
// Vulkan renders symbols correctly; don't revert to opengl without retesting
// labels on the emulator AND a physical device.
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Alert,
  BackHandler,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
  PixelRatio,
  useWindowDimensions,
  type GestureResponderEvent,
  type TextInput,
} from "react-native";
import {
  Camera,
  CircleLayer,
  FillLayer,
  Images,
  LineLayer,
  MapView,
  RasterLayer,
  ShapeSource,
  SymbolLayer,
  type CameraStop,
} from "@maplibre/maplibre-react-native";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useIsFocused } from "@react-navigation/native";
import * as FileSystem from "expo-file-system";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import * as Location from "expo-location";
import {
  TOPO_LAYERS,
  VECTOR_STYLE_DEFAULTS,
  compassPointFor,
  draftAnchorIndices,
  draftPoints,
  emptyDraft,
  formatDistanceM,
  haversineMeters,
  initialBearingDegrees,
  messageFromError,
  ROUTE_NAME_MAX_LENGTH,
  nearestSegment,
  snapSegment,
  type SnapMode,
} from "@logjam/shared";

import { apiFetch } from "../api/apiFetch";
import { bboxOfPoints, type Bbox } from "../saved/bboxOfPoints";
import { setRouteEditing } from "./routeEditLock";
import { collectSnapLines } from "./snapLines";
import {
  clearRouteDraft,
  readRouteDraft,
  saveRouteDraft,
} from "./routeDraftStore";
import { useRouteDraft, type RouteDraftHandle } from "./useRouteDraft";
import { readSnapMode, writeSnapMode } from "./snapPreference";
import { getVectorStyle, useApiQuery } from "../api/queries";
import { useAccountState } from "../auth/AccountStateContext";
import type { TCanyon } from "../api/types";
import {
  useMirrorCanyons,
  useMirrorWaypoints,
  useMirrorRoutes,
} from "../sync/useSyncQueries";
import { config } from "../config";
import { fontSize, fontWeight, radius, scrim, spacing, theme, withAlpha } from "../theme";
import { MapSearchBar } from "./MapSearchBar";
import { ScaleBar, SCALE_BAR_HEIGHT, type ScaleBarHandle } from "./ScaleBar";
import { RouteMapLayer, ROUTE_COLOR, type RouteRequest } from "../media/RouteMapLayer";
import {
  CHROME_BOTTOM,
  CHROME_GAP,
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  FAB_ICON,
  FAB_SIZE,
  MINI_FAB_ICON,
  MINI_FAB_SIZE,
  SEARCH_SIZE,
} from "./mapChrome";
import {
  HEADING_RENDER_MS,
  resolveTrueHeading,
  shortestAngleDelta,
  smoothHeading,
} from "./heading";
import {
  CompassStrip,
  COMPASS_STRIP_HEIGHT,
  COMPASS_STRIP_WIDTH,
} from "./CompassStrip";
import { isCompassEnabled } from "./compassPreference";
import {
  MARKER_COLORS,
  isNorthUpLocked,
  isScaleBarEnabled,
  readKeepAwakeMode,
  readLongPressAction,
  readMapControlSide,
  readMarkerColorId,
  readNorthReference,
  type KeepAwakeMode,
  type LongPressAction,
  type MapControlSide,
  type MarkerColorId,
  type NorthReference,
} from "./mapPreferences";
import { readBasemapPreference, setBasemapPreference } from "./basemapPreference";
import { MOBILE_BASEMAPS } from "./basemapMeta";
import { readMutedTopoAreas, writeMutedTopoAreas } from "./topoAreaMuting";
import { offlineCoverageMask } from "./offlineMask";
import { DraftToolPanel } from "./DraftToolPanel";
import { MapToolGroup, type MapTool } from "./MapToolGroup";
import { RouteDraftLayer } from "./RouteDraftLayer";
import { RoutesLayer } from "./RoutesLayer";
import type { MirrorRoute } from "../sync/mirrorStore";
import { RouteStatsSheet } from "../routes/RouteStatsSheet";
import { RouteOptionsSheet } from "../routes/RouteOptionsSheet";
import { LinkCanyonSheet } from "../routes/LinkCanyonSheet";
import { BottomSheet } from "../ui/BottomSheet";
import { Button } from "../ui/Button";
import { TextField } from "../ui/TextField";
import { IconButton } from "../ui/IconButton";
import { Row } from "../ui/Row";
import { Toast, type ToastMessage } from "../ui/Toast";
import { BASEMAP_THUMB_CREDIT } from "./BasemapThumb";
import { CanyonRoutesLayer, type CanyonRoutesStatus } from "./CanyonRoutesLayer";
import { MapLayersSheet } from "./MapLayersSheet";
import { MapPointSheet, type MapPoint } from "./MapPointSheet";
import { CanyonEditSheet } from "../canyons/CanyonEditSheet";
import {
  isWithholdingCanyons,
  setCanyonMapFilterEnabled,
  useCanyonMapFilter,
} from "../canyons/canyonMapFilter";
import { updateGeoPdfImport } from "../geopdf/geoPdfImportsDb";
import { GEOPDF_ERRORS, importGeoPdfFile } from "../geopdf/importPipeline";
import { runGeoPdfImport } from "../geopdf/importRunner";
import { useGeoPdfImports } from "../geopdf/useGeoPdfImports";
import { setVectorImportVisible } from "../imports/importsDb";
import {
  classifyIncomingBytes,
  isFileIntentUrl,
  syntheticNameFor,
} from "../imports/incomingIntent";
import { useVectorImports } from "../imports/useVectorImports";
import { importVectorSource } from "../imports/vectorImports";
import { updateTrack, type Waypoint } from "../tracks/tracksDb";
import {
  createWaypointLocal,
  createRouteLocal,
  updateRouteLocal,
  deleteWaypointLocal,
} from "../sync/outbox";
import {
  reconcileTrackRecordingOnLaunch,
  startTrackRecording,
} from "../tracks/trackRecorder";
import { TrackMapLayers } from "../tracks/TrackMapLayers";
import { TrackRecordingControls } from "../tracks/TrackRecordingControls";
import { useTracks } from "../tracks/useTracks";
import { ensureForegroundLocationPermission } from "./locationPermission";
import { listEnabledOverlayKeys, setOverlayEnabled } from "../offline/registryDb";
import {
  activeRegionJob,
  useRegionDownloads,
} from "../offline/regionDownloadQueue";
import { useMapArtifacts } from "../offline/useMapArtifacts";
import { useBasemapAssets } from "./basemap/basemapAssets";
import { ProtomapsLayers, protomapsLayerCount } from "./basemap/ProtomapsLayers";
import { buildShellStyle } from "./basemap/shellStyle";
import { useConnectivity } from "./connectivity";
import { ResolvedSource, sourceIdFor } from "./ResolvedSource";
import {
  basemapsCoveringViewport,
  resolveMapSource,
  type BasemapId,
  type ResolveContext,
} from "./sourceResolver";
import {
  composeTopoOverlayRefs,
  mergeSavedOverlayJobs,
  type CompletedOverlaysResponse,
  type TopoOverlayRef,
} from "./topoOverlays";
import { buildTopoVectorLayerDefs } from "./topoVectorLayers";
import { TopoIconImages, TopoVectorOverlay } from "./TopoVectorOverlay";

// Shell style (glyphs/sprite) lives in basemap/shellStyle.ts — bundled
// file:// assets once installed (stage 4a §8.3), remote host as the
// install-failure fallback. Fonts: the Noto Sans stacks the generated basemap
// layers reference — canyon labels use the same stack so one glyph source
// serves everything.
//
// Light flavor everywhere for now — matches the paper-topo look of the SIX
// rasters; the dark JSON ships alongside for a later theme pass.
const PROTOMAPS_FLAVOR = "light" as const;

// Module-level: <Camera> is memo'd and takes no dynamic props, so a stable
// object lets the memo hold and keeps every re-render of this screen from
// re-committing props to the native camera.
/** Below this span an extent is a point, not an area (~1 m). */
const DEGENERATE_BBOX_DEGREES = 1e-5;
const SINGLE_POINT_ZOOM = 14;

const CAMERA_DEFAULTS = {
  centerCoordinate: DEFAULT_CENTER,
  zoomLevel: DEFAULT_ZOOM,
};

/**
 * The scale "where am I" always lands on: opening the app, and entering either
 * follow mode. Around 300 m across on a phone — the next few minutes of
 * walking, with the creek and the contours either side of it still legible.
 *
 * Applied absolutely, in both directions. Asking to be put back on yourself is
 * asking for a known scale, so it zooms out from a close reading just as it
 * zooms in from a whole-of-NSW view; the alternative (clamp one way) makes the
 * same button do two different things depending on where the map happened to be.
 */
const FOLLOW_ZOOM = 15;

/**
 * Zoom range the JS-driven pinch may reach. Not MapLibre's own 0-22: below ~2
 * the whole world is on screen twice and above ~20 every source is overzoomed,
 * and unlike a native gesture this one has no built-in stops of its own.
 */
const MIN_PINCH_ZOOM = 2;
const MAX_PINCH_ZOOM = 20;

/**
 * How far one finger must travel before it counts as a pan rather than a tap —
 * the drag that means "stop following".
 *
 * Android's own `ViewConfiguration` touch slop is 8dp, and matching it is the
 * point: while following, MapLibre's pan is disabled and this screen decides
 * when a drag has begun, so anything larger would feel like the map resisting
 * and anything smaller would drop follow on the wobble in a tap.
 */
const PAN_SLOP_DP = 8;

/** How near the drawn line a press-and-hold must land to insert a point. */
const LINE_GRAB_PIXELS = 24;
/** Screen pixels per CSS pixel, for converting a tolerance into degrees. */
const PIXEL_RATIO = PixelRatio.get();

// Bearing to 0..360 so "is the map facing north" is a single comparison.
function normalizeBearing(heading: number): number {
  if (!Number.isFinite(heading)) return 0;
  return ((heading % 360) + 360) % 360;
}

// A remount (tab switch) re-fires Linking.getInitialURL with the same intent
// URI — imports must not run twice for one "Open in Logjam".
const handledIntentUrls = new Set<string>();

/**
 * One-shot compass read, for the moment a mode is ENTERED — as opposed to the
 * watcher, which keeps it fed afterwards. Returns null when the device has no
 * usable reading; a mode that can't rotate yet is not an error worth an alert.
 */
async function currentHeading(): Promise<number | null> {
  try {
    return resolveTrueHeading(await Location.getHeadingAsync());
  } catch (err) {
    console.error(err);
    return null;
  }
}

type FollowMode = "off" | "follow" | "course-up";

/** Gap between the stacked instruments, and the same value their container uses. */
const INSTRUMENT_GAP = spacing(0.75);

/** Tag for this screen's wake lock, so releasing it can't release anyone else's. */
const KEEP_AWAKE_TAG = "logjam-map";

const LOCATE_ICON: Record<FollowMode, "navigation" | "crosshair" | "compass"> = {
  off: "navigation",
  follow: "crosshair",
  "course-up": "compass",
};

const LOCATE_LABEL: Record<FollowMode, string> = {
  off: "Show where I am",
  follow: "Following you — tap to face the way you are looking",
  "course-up": "Facing your direction — tap to stop following",
};

const OWNED_CANYON_COLOR = "#f97316";
const SHARED_CANYON_COLOR = "#629bf8";
const MAX_LABEL_CHARS = 40;

// Ellipsize pathological names (web CANYON-7 parity).
const CANYON_LABEL_EXPR = [
  "case",
  [">", ["length", ["get", "name"]], MAX_LABEL_CHARS],
  ["concat", ["slice", ["get", "name"], 0, MAX_LABEL_CHARS], "…"],
  ["get", "name"],
];

type CanyonFeatureCollection = {
  type: "FeatureCollection";
  features: {
    type: "Feature";
    id: string;
    geometry: { type: "Point"; coordinates: [number, number] };
    properties: { id: string; name: string };
  }[];
};

function toFeatureCollection(canyons: TCanyon[]): CanyonFeatureCollection {
  return {
    type: "FeatureCollection",
    features: canyons.map((c) => ({
      type: "Feature",
      id: c.id,
      geometry: { type: "Point", coordinates: [c.longitude, c.latitude] },
      properties: { id: c.id, name: c.name },
    })),
  };
}

function getCompletedOverlays(): Promise<CompletedOverlaysResponse> {
  return apiFetch<CompletedOverlaysResponse>("/topo-jobs/completed-overlays");
}

// Contour layers get contour styling; every other vector layer is the OSM
// features set (web parity: `id.includes("contours")`).
function overlayKind(ref: TopoOverlayRef): "contours" | "features" {
  return ref.layer === "contours" ? "contours" : "features";
}

export function MapScreen({
  onOpenCanyon,
  onOpenSaved,
  onSaveMapsOffline,
  focus,
  route,
  editRoute,
  drawRouteFor,
}: {
  onOpenCanyon: (canyonId: string, name: string) => void;
  /**
   * Opens the offline-download screen on the ground the user is looking at, so
   * framing an area starts from what they already framed by panning here.
   */
  onSaveMapsOffline?: (context: {
    basemapId: BasemapId;
    center: [number, number];
    zoom: number;
  }) => void;
  // Opens the Saved tab on one category, from the layer sheet's regions row.
  onOpenSaved?: (category: "region") => void;
  // "Show on map" for a trip's route attachment. Transient: drawn until the
  // user clears its badge, never added to the imports registry.
  route?: RouteRequest | null;
  // "Show on map" from the Saved tab: fit this bbox once on arrival. `nonce`
  // makes a repeat request for the same asset refocus instead of no-op.
  // Coordinates stay in navigation params + component state — never logged.
  focus?: {
    bbox: [number, number, number, number];
    nonce: number;
    /**
     * Switch to this basemap on arrival. Set when the asset being shown IS a
     * basemap's tiles (a downloaded region) — flying to one while a different
     * basemap is selected shows a blank rectangle, which reads as a failed
     * download rather than as the wrong layer.
     */
    basemapId?: BasemapId;
  } | null;
  // "Edit points" from the Saved tab: arm the draw tool on a saved route. An
  // id only — the geometry comes from the mirror.
  editRoute?: { routeId: string; nonce: number } | null;
  // "Draw one on the map" from a canyon: arm the tool, and save into that
  // canyon's route slot rather than as a standalone route.
  drawRouteFor?: { canyonId: string; nonce: number } | null;
}) {
  // A route arrives via navigation params; clearing its badge drops it, and a
  // fresh request (new nonce) replaces whatever was showing.
  const [shownRoute, setShownRoute] = useState<RouteRequest | null>(route ?? null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const fittedRouteNonce = useRef<number | null>(null);
  useEffect(() => {
    if (route) {
      setShownRoute(route);
      setRouteError(null);
    }
  }, [route]);

  // "Offline maps only" forces the resolver to local artifacts even with
  // signal — battery saver + predictability in the field.
  const [offlineOnly, setOfflineOnly] = useState(false);
  const connectivity = useConnectivity(offlineOnly);
  const { artifacts } = useMapArtifacts();
  // Bundled glyph/sprite install (§8.3). Map render is gated below until it
  // resolves — swapping the style's glyphs URL after mount rebuilds the whole
  // style. Post-install launches resolve in ~ms; install failure falls back
  // to the remote asset host (online-only labels).
  const basemapAssets = useBasemapAssets();
  const shellStyle = useMemo(
    () => buildShellStyle(basemapAssets.localBaseUrl, PROTOMAPS_FLAVOR),
    [basemapAssets.localBaseUrl],
  );
  // Whether the MapView (and therefore the camera) is mounted at all — the same
  // condition as the render gate at the bottom of this component. Anything that
  // drives the camera from an effect has to wait for this.
  const mapReady = basemapAssets.localBaseUrl != null || basemapAssets.failed;
  // Seeded from (and written back to) the device preference: a map that reset
  // to the default on every launch made the choice worth nothing.
  const [basemapId, setBasemapId] = useState<BasemapId>(readBasemapPreference);
  const chooseBasemap = useCallback((next: BasemapId) => {
    setBasemapId(next);
    setBasemapPreference(next);
  }, []);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [attributionOpen, setAttributionOpen] = useState(false);
  // Press-and-hold target, and the point handed to the canyon form once that
  // sheet has actually closed (never two sheets at once — DESIGN.md §6).
  const [longPressPoint, setLongPressPoint] = useState<MapPoint | null>(null);
  /** Where the user last tapped — the point panel's subject, and its dot. */
  const [tappedPoint, setTappedPoint] = useState<MapPoint | null>(null);
  const [addCanyonAt, setAddCanyonAt] = useState<MapPoint | null>(null);
  const pendingCanyonPoint = useRef<MapPoint | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const toastNonce = useRef(0);
  // Both point tools run the SAME draft model — same anchors, same drag,
  // delete and snapping. What differs is the exit (measure discards silently,
  // route draw confirms and saves) and the ink (DESIGN.md §8).
  const measureDraft = useRouteDraft();
  const routeDraft = useRouteDraft();
  const measuring = measureDraft.active;
  const [editingRouteId, setEditingRouteId] = useState<string | null>(null);
  const [savingRoute, setSavingRoute] = useState(false);
  /** A drag ends with a tap that also fires onSelected; this tells the two
   *  apart so dropping a handle doesn't delete it. */
  const anchorDragged = useRef(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [namingRoute, setNamingRoute] = useState(false);
  const drawingRoute = routeDraft.active;
  /** The draft the map's taps belong to, or null when no tool is armed. */
  const activeDraft: RouteDraftHandle | null = drawingRoute
    ? routeDraft
    : measuring
      ? measureDraft
      : null;
  /** Either point-collecting tool is armed — the flag every tap surface reads. */
  const collectingPoints = activeDraft !== null;
  const routes = useMirrorRoutes();
  // The user's own drawn routes, on by default: they are few, they are theirs,
  // and the map is where they are for. The switch lives in the layers sheet.
  const [showRoutes, setShowRoutes] = useState(true);
  // Tapping a route opens its stats; every verb sits one step further on, so a
  // tap on the map can never begin an accidental edit. Three sheets, one at a
  // time, each holding the id rather than the row — the row comes from the
  // mirror so it stays current if a sync lands while a sheet is open.
  const [statsRouteId, setStatsRouteId] = useState<string | null>(null);
  const [optionsRouteId, setOptionsRouteId] = useState<string | null>(null);
  const [linkingRouteId, setLinkingRouteId] = useState<string | null>(null);
  // Set when the draw was started from a canyon page; consumed by the save.
  const [draftCanyonId, setDraftCanyonId] = useState<string | null>(null);
  // "Canyon routes" layer (web parity), off by default: it is a lot of ink to
  // add to a map unasked, and the layers sheet is where it belongs.
  const [showCanyonRoutes, setShowCanyonRoutes] = useState(false);
  const [routesStatus, setRoutesStatus] = useState<CanyonRoutesStatus | null>(null);
  // Settled camera readout, used only to hand the offline-download screen the
  // ground the user is looking at. The scale bar does NOT read this: it follows
  // the camera continuously through its own ref (see scaleBarRef), because
  // re-rendering this screen at gesture rate would re-reconcile every layer.
  const [camera, setCamera] = useState({
    zoom: DEFAULT_ZOOM,
    latitude: DEFAULT_CENTER[1],
    longitude: DEFAULT_CENTER[0],
  });
  /**
   * The ground actually on screen, read back from the map when a move settles.
   *
   * Asked of MapLibre rather than derived from centre + zoom + window size,
   * because the map ROTATES: a course-up view's axis-aligned extent is up to
   * √2 wider than the same camera facing north, and the offline notice would be
   * wrong at exactly the moment (walking, map turning) it matters. Null until
   * the first settle. Coordinates stay in component state — never logged.
   */
  const [viewportBbox, setViewportBbox] = useState<{
    west: number;
    south: number;
    east: number;
    north: number;
  } | null>(null);
  const scaleBarRef = useRef<ScaleBarHandle>(null);
  /** Set once the user has panned/zoomed themselves — see the open-on-location effect. */
  const userMovedCamera = useRef(false);
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  // What new segments follow. Device-scoped and persisted, read once so the
  // tool is armed correctly on its first frame.
  const [snapMode, setSnapMode] = useState<SnapMode>(readSnapMode);
  const handleSnapModeChange = useCallback((mode: SnapMode) => {
    setSnapMode(mode);
    // Best-effort: a device that refuses to store the preference still gets
    // the behaviour for this session.
    writeSnapMode(mode);
  }, []);
  const mapRef = useRef<React.ComponentRef<typeof MapView>>(null);
  // Enabled topo overlays. Seeded from the persisted set (registryDb) so a
  // downloaded overlay stays visible across a cold offline launch; toggles
  // write through. Saved overlays are auto-enabled on download.
  const [enabledOverlays, setEnabledOverlays] = useState<ReadonlySet<string>>(new Set());
  // Re-read on focus (not just mount): the Saved screen's "Save offline"
  // action auto-enables an overlay by writing overlay_enabled directly, and
  // that table has no change listener (unlike the artifact registry) — a
  // focus refresh is how a Map screen that stayed mounted in the background
  // picks up an overlay saved while the user was on the Saved tab.
  // The compass switch lives in Settings, on another tab, so its value is
  // re-read on focus alongside the overlays rather than only at mount.
  const [compassEnabled, setCompassEnabled] = useState(isCompassEnabled);
  // The Map settings page writes these five and lives on another tab, so they
  // are re-read on focus alongside the compass rather than only at mount. All
  // five reads are synchronous (`prefsDb`), so the first frame after a change is
  // already correct — a chrome column that slides across a beat later would be
  // its own bug.
  const [controlSide, setControlSide] = useState<MapControlSide>(readMapControlSide);
  const [markerColorId, setMarkerColorId] = useState<MarkerColorId>(readMarkerColorId);
  const [keepAwakeMode, setKeepAwakeMode] = useState<KeepAwakeMode>(readKeepAwakeMode);
  const [northUpLocked, setNorthUpLocked] = useState(isNorthUpLocked);
  // Mirror, for the gesture callbacks: they are memoised once and would
  // otherwise close over the value this screen had when it mounted.
  const northUpLockedRef = useRef(northUpLocked);
  northUpLockedRef.current = northUpLocked;
  const [longPressAction, setLongPressAction] = useState<LongPressAction>(readLongPressAction);
  const [northReference, setNorthReference] = useState<NorthReference>(readNorthReference);
  const [scaleBarEnabled, setScaleBarEnabled] = useState(isScaleBarEnabled);
  useFocusEffect(
    useCallback(() => {
      setCompassEnabled(isCompassEnabled());
      setControlSide(readMapControlSide());
      setMarkerColorId(readMarkerColorId());
      setKeepAwakeMode(readKeepAwakeMode());
      setNorthUpLocked(isNorthUpLocked());
      setLongPressAction(readLongPressAction());
      setNorthReference(readNorthReference());
      setScaleBarEnabled(isScaleBarEnabled());
      listEnabledOverlayKeys()
        .then((keys) => setEnabledOverlays(new Set(keys)))
        .catch(console.error);
    }, []),
  );
  // Which areas are hidden wholesale — the "where" axis of the overlay matrix
  // (topoAreaMuting.ts). Independent of the per-cell enabled set above, so
  // unmuting an area restores whatever layers were selected for it.
  const [mutedAreas, setMutedAreas] = useState<ReadonlySet<string>>(readMutedTopoAreas);
  const setAreasMuted = useCallback((areaIds: string[], muted: boolean) => {
    setMutedAreas((prev) => {
      const next = new Set(prev);
      for (const areaId of areaIds) {
        if (muted) next.add(areaId);
        else next.delete(areaId);
      }
      writeMutedTopoAreas(next);
      return next;
    });
  }, []);
  // Toggle one overlay on/off, persisting the change.
  const toggleOverlay = useCallback((key: string) => {
    setEnabledOverlays((prev) => {
      const next = new Set(prev);
      const enabled = !next.has(key);
      if (enabled) next.add(key);
      else next.delete(key);
      setOverlayEnabled(key, enabled).catch(console.error);
      return next;
    });
  }, []);
  const cameraRef = useRef<React.ComponentRef<typeof Camera>>(null);
  // MLRN's native camera KEEPS the last stop handed to it imperatively, and
  // under the new architecture the legacy-interop layer re-sends that view's
  // props on later commits — so any re-render of this screen replays the last
  // camera move. Left alone, that makes the map unpannable after a programmatic
  // move (each region change writes the readout state below ⇒ re-render ⇒
  // replay ⇒ region change…) and it outlives whatever asked for the move: a
  // route fit still yanked the camera back after the route was dismissed.
  // Fix: once a move has settled, overwrite the stop with an empty one
  // (no target, no animation ⇒ "stay where you are"), so a later replay is a
  // no-op. Every camera write goes through the two helpers below so nothing
  // can leave a stale stop behind.
  const stopNeedsReset = useRef(false);
  const setCameraStop = useCallback((stop: CameraStop) => {
    if (!cameraRef.current) return;
    stopNeedsReset.current = true;
    // A stop that names a zoom or a heading IS the new truth for the running
    // camera — recorded here rather than waiting for MapLibre to report it back,
    // because the report comes late and can arrive out of order (see
    // `handleRegionDidChange`).
    if (typeof stop.zoomLevel === "number") zoomRef.current = stop.zoomLevel;
    if (typeof stop.heading === "number") headingRef.current = stop.heading;
    cameraRef.current.setCamera(stop);
  }, []);
  /**
   * Let the next settled region report set the running camera even though this
   * screen is driving.
   *
   * `fitCameraToBbox` is the one camera move whose zoom we cannot know in
   * advance — MapLibre picks it from the bounds — so it is the one case where
   * the report back is the only source of truth.
   */
  const acceptSettleCamera = useRef(false);
  const fitCameraToBbox = useCallback(
    (bbox: [number, number, number, number], padding = 40) => {
      if (!cameraRef.current) return;
      const [west, south, east, north] = bbox;
      stopNeedsReset.current = true;
      // MapLibre chooses the zoom here, so the settle is the only place we can
      // learn it — even if this screen is otherwise driving the camera.
      acceptSettleCamera.current = true;
      // A route with a single point (a lone waypoint file) has a zero-area
      // bbox; fitting to it asks the camera for infinite zoom. Centre on the
      // point at a fixed close zoom instead.
      if (east - west < DEGENERATE_BBOX_DEGREES && north - south < DEGENERATE_BBOX_DEGREES) {
        cameraRef.current.setCamera({
          centerCoordinate: [(west + east) / 2, (south + north) / 2],
          zoomLevel: SINGLE_POINT_ZOOM,
          animationDuration: 600,
        });
        return;
      }
      cameraRef.current.fitBounds([east, north], [west, south], padding, 600);
    },
    [],
  );
  // Stage 7 follow modes: follow recenters on each fix (north-up); course-up
  // additionally rotates the map to the direction of travel. The locate
  // button cycles off → follow → course-up → off.
  const [followMode, setFollowMode] = useState<FollowMode>("off");
  const followModeRef = useRef(followMode);
  followModeRef.current = followMode;
  /** Live zoom and heading, so a pinch starts from what is actually on screen. */
  const zoomRef = useRef(DEFAULT_ZOOM);
  const headingRef = useRef(0);
  /**
   * The two-finger gesture this screen is currently driving, or null.
   *
   * Non-null IS the answer to "is the user scaling/rotating rather than
   * panning", and it is the only thing the follow-mode guard consults. It is
   * set the instant a second finger lands and cleared on release, so it cannot
   * be confused by MapLibre's own event stream — which is what the old
   * max-fingers counter was, and why follow kept dropping mid-pinch: the
   * counter was reset by `onRegionDidChange`, and this handler's own camera
   * writes fire that on every move.
   */
  /**
   * Where the single finger now down first landed, or null when none is.
   *
   * While following, MapLibre has no pan gesture to detect a drag with, so the
   * drag that means "stop following" is measured from here instead.
   */
  const panOrigin = useRef<{ x: number; y: number } | null>(null);
  /**
   * Whether the gesture in progress has had two fingers on it at any point.
   *
   * Lifting one finger of a pinch hands the responder back to the capture
   * handlers with the OTHER finger still down, which arrives looking exactly
   * like a one-finger drag — from an origin set where the first finger of the
   * pinch landed, so a slop breach is guaranteed and follow mode was dropped at
   * the end of nearly every pinch. A pinch is ONE gesture until the last finger
   * lifts; its tail is not a pan.
   */
  const gestureHadTwoFingers = useRef(false);
  const pinchStart = useRef<{
    distance: number;
    angleDeg: number;
    zoom: number;
    heading: number;
  } | null>(null);
  /**
   * True for as long as a driven two-finger gesture is running. State rather
   * than a ref because it drives MapView props — one commit at the start of
   * the gesture and one at the end, not one per frame.
   */
  const [twoFingerLock, setTwoFingerLock] = useState(false);
  const [userCoord, setUserCoord] = useState<[number, number] | null>(null);
  const [userHeading, setUserHeading] = useState<number | null>(null);
  // Latest fix, in a ref as well as in state: entering a follow mode has to
  // recentre NOW, from the sensor callback's own value, not on the next render.
  const latestFix = useRef<[number, number] | null>(null);
  const locationWatch = useRef<Location.LocationSubscription | null>(null);
  const headingWatch = useRef<Location.LocationSubscription | null>(null);
  // Set between "asked for the compass" and "have the subscription" — see
  // ensureHeadingWatch.
  const headingWatchStarting = useRef(false);
  // Running smoothed heading, kept in a ref as well as in state: the POV
  // camera writes from the sensor callback, which must not close over a stale
  // render's value.
  const smoothedHeading = useRef<number | null>(null);
  const lastHeadingRender = useRef(0);
  const lastPovBearing = useRef<number | null>(null);
  const firstFix = useRef(true);

  // Stop the position/heading watchers when the screen unmounts.
  useEffect(() => {
    return () => {
      locationWatch.current?.remove();
      locationWatch.current = null;
      headingWatch.current?.remove();
      headingWatch.current = null;
    };
  }, []);

  // Canyon overlay reads the offline mirror (Stage 8): instant, and the map
  // keeps its pins in airplane mode.
  const canyons = useMirrorCanyons();
  // Both of these are account-backed. A guest gets no LiDAR overlays at all,
  // and the default vector style — which is what every user sees offline
  // anyway, so the map itself is unaffected.
  const isGuest = useAccountState().accountState === "guest";
  const overlays = useApiQuery(
    getCompletedOverlays,
    "Couldn't load topo overlays.",
    !isGuest,
  );
  // Server-side vector style (same one the web map + exports use); defaults
  // until it loads / when offline.
  const vectorStyleQuery = useApiQuery(
    getVectorStyle,
    "Couldn't load map style.",
    !isGuest,
  );
  const vectorStyle = vectorStyleQuery.data ?? VECTOR_STYLE_DEFAULTS;

  const ctx: ResolveContext = useMemo(
    () => ({
      connectivity,
      artifacts,
      cdnBaseUrl: config.topoCdnBaseUrl,
    }),
    [connectivity, artifacts],
  );

  /**
   * What is actually DRAWN, as against what the user has picked.
   *
   * Mounting the vector basemap is ~70 MLRN layer components in one commit,
   * and React cannot split a commit — so tapping "OSM Default (vector)" in the
   * layers sheet froze everything for about a second before the row even
   * showed a tick, which reads as the tap having missed. Deferring the value
   * the MAP renders from lets the urgent half (the sheet's selection, its
   * press feedback, its close animation) commit first at full priority, and
   * the layer mount follow as a low-priority render. The freeze is not gone —
   * the commit is still one lump of work — but it lands after the app has
   * acknowledged the tap rather than in place of acknowledging it.
   *
   * Everything downstream of "what is on screen" reads THIS: the resolver, the
   * layer-count arithmetic, the offline mask, the attribution and the offline
   * notice. `basemapId` itself stays the user's choice, and is what the picker
   * ticks and what the preference stores.
   */
  const renderedBasemapId = useDeferredValue(basemapId);

  const basemapResolved = useMemo(
    () => resolveMapSource({ kind: "basemap", basemapId: renderedBasemapId }, ctx),
    [renderedBasemapId, ctx],
  );

  /**
   * Basemaps OTHER than the current one that have downloaded tiles covering
   * where the camera is looking.
   *
   * Offline, the basemap preference is whatever the user last chose, and it is
   * very often not one of the ones they saved for this gorge — so the map goes
   * blank and the only thing on screen said "no downloaded basemap for this
   * area", which is false and sends them away thinking the download failed.
   * The centre of the view is the honest test: it is the ground they are
   * actually looking at, not the corners of a bbox they may only be clipping.
   */
  /**
   * What the offline notice knows: whether the basemap being drawn has saved
   * tiles on screen, and whether any OTHER basemap does.
   *
   * Both answers come from the VIEWPORT. The notice used to be gated on the
   * resolver instead, and the resolver reports a basemap as available the
   * moment any region exists for it anywhere — so a phone with one saved
   * Katoomba region stayed silent while showing blank ground three valleys
   * away, which is precisely the case the notice exists for. It fired "rarely,
   * and never for a basemap you had actually downloaded something for".
   */
  const coverageHere = useMemo(() => {
    if (connectivity === "online" || viewportBbox == null) {
      return { current: true, others: [] as BasemapId[] };
    }
    const covering = basemapsCoveringViewport(
      artifacts,
      viewportBbox,
      MOBILE_BASEMAPS,
    );
    return {
      current: covering.includes(renderedBasemapId),
      others: covering.filter((id) => id !== renderedBasemapId),
    };
  }, [artifacts, renderedBasemapId, viewportBbox, connectivity]);

  // Everywhere the phone has no saved tiles, blanked out — but only when the
  // basemap is actually being drawn FROM those saved tiles. Online there is
  // nothing to hide behind (see offlineMask.ts).
  const offlineMask = useMemo(() => {
    if (!basemapResolved.some((r) => r.status === "ok" && r.origin === "local")) {
      return null;
    }
    return offlineCoverageMask(
      basemapResolved.flatMap((r) =>
        r.status === "ok" && r.bounds ? [r.bounds] : [],
      ),
    );
  }, [basemapResolved]);

  // How many layers the basemap band actually occupies. NOT always one: an
  // offline basemap mounts one raster layer PER downloaded region, and they all
  // ask for layerIndex 1, so each insert pushes the previous one up. Assuming a
  // single layer put the offline mask underneath a region's raster — which
  // looked exactly like the mask half-rendering, red to that region's east
  // edge and nothing west of it.
  // Both branches scale with the number of resolved sources for the same
  // reason. The vector branch used a per-flavor CONSTANT, so with two saved
  // Protomaps regions the band is ~140 layers deep and the mask landed at 71
  // — inside the second region's stack, with ~70 basemap layers drawn over
  // the top of it. That is the half-rendered mask this comment warns about,
  // still live on the vector path.
  const resolvedSourceCount = Math.max(
    1,
    basemapResolved.filter((r) => r.status === "ok").length,
  );
  const basemapLayerCount =
    renderedBasemapId === "protomaps"
      ? protomapsLayerCount(PROTOMAPS_FLAVOR) * resolvedSourceCount
      : resolvedSourceCount;

  const maskLayerIndex = 1 + basemapLayerCount;
  // First free layerIndex above the basemap band and the mask's own slot.
  const overlayBaseIndex = maskLayerIndex + (offlineMask ? 1 : 0);

  // Union the online overlay list with downloaded artifacts, so saved overlays
  // list + render even on a cold offline launch (the online fetch has no
  // persistence and returns nothing then).
  const mergedOverlays = useMemo(
    () => mergeSavedOverlayJobs(overlays.data, artifacts),
    [overlays.data, artifacts],
  );

  const overlayRefs = useMemo(
    () =>
      // A muted area draws nothing, whatever its cells say — the "where" gate
      // applied after the "what" (topoAreaMuting.ts).
      composeTopoOverlayRefs(mergedOverlays, enabledOverlays).filter(
        (ref) => !mutedAreas.has(ref.jobId),
      ),
    [mergedOverlays, enabledOverlays, mutedAreas],
  );

  // Contiguous layerIndex allocation above the basemap band: raster overlays
  // take one slot, vector overlays exactly as many slots as their layer defs —
  // no gaps, so no index ever exceeds the mounted layer count. `nextIndex` is
  // where the next band (vector imports) starts.
  const overlayRenderPlan = useMemo(() => {
    let next = overlayBaseIndex;
    const plans = overlayRefs.map((ref) => {
      const start = next;
      next +=
        ref.format === "vector"
          ? buildTopoVectorLayerDefs(overlayKind(ref), vectorStyle).length
          : 1;
      return { ref, start };
    });
    return { plans, nextIndex: next };
  }, [overlayRefs, overlayBaseIndex, vectorStyle]);

  // "Show only these on the map" — the Canyons screen's filter, opt-in, handed
  // over as a set of ids (never a bbox; nothing persisted). Until that screen
  // has published, or with the option off, every canyon draws.
  //
  // NOT BUILT YET: the web also has a layer toggle that draws every canyon's
  // ROUTE (`showCanyonTracks` + GET /canyons/tracks). There is no mobile
  // equivalent — a route is drawn one at a time, transiently, from a canyon's
  // detail screen. It belongs in the map-page redesign, alongside the layer
  // sheet; the mirror already holds the files, so it can work offline.
  const mapFilter = useCanyonMapFilter();
  const allowedCanyonIds = useMemo(
    () =>
      mapFilter.enabled && mapFilter.visibleIds !== null
        ? new Set(mapFilter.visibleIds)
        : null,
    [mapFilter.enabled, mapFilter.visibleIds],
  );
  const withholdingCanyons = isWithholdingCanyons(mapFilter);

  const ownedFc = useMemo(
    () =>
      toFeatureCollection(
        (canyons.data ?? []).filter(
          (c) =>
            c.syncRole === "owner" &&
            (allowedCanyonIds === null || allowedCanyonIds.has(c.id)),
        ),
      ),
    [allowedCanyonIds, canyons.data],
  );
  const sharedFc = useMemo(
    () =>
      toFeatureCollection(
        (canyons.data ?? []).filter(
          (c) =>
            c.syncRole === "shared" &&
            (allowedCanyonIds === null || allowedCanyonIds.has(c.id)),
        ),
      ),
    [allowedCanyonIds, canyons.data],
  );

  /** Follow a track between two anchors, if snapping is on and finds one.
   *
   *  Async by nature (a cold tile is a range request), and the draft may have
   *  moved on by the time it answers — `applySnap` is guarded by the anchors it
   *  was computed for, so a late run lands only on a segment that still
   *  exists. */
  const snapBetween = useCallback(
    async (
      handle: RouteDraftHandle,
      from: [number, number],
      to: [number, number],
    ) => {
      if (snapMode === "off") return;
      const lines = await collectSnapLines(snapMode, from, to, artifacts);
      const snapped = snapSegment(lines, from, to);
      // The path includes the graph nodes nearest both ends; drop them, or the
      // line jumps sideways onto the track at every tap.
      if (!snapped || snapped.length <= 2) return;
      handle.applySnap(from, to, snapped.slice(1, -1));
    },
    [artifacts, snapMode],
  );

  /** Re-snap after a handle is dropped. An anchor in the middle of a line has a
   *  segment on EITHER side of it, and both followed the track to where the
   *  point used to be — re-running only one leaves the other straight. */
  const snapAroundAnchor = useCallback(
    (handle: RouteDraftHandle, index: number, moved: [number, number]) => {
      const anchors = handle.anchors.map((anchor, i) =>
        i === index ? moved : anchor,
      );
      const before = anchors[index - 1];
      const after = anchors[index + 1];
      if (before) void snapBetween(handle, before, moved).catch(console.error);
      if (after) void snapBetween(handle, moved, after).catch(console.error);
    },
    [snapBetween],
  );

  /** A tap on a handle offers to remove it — it does not remove it. A drag ends
   *  on the handle too, and losing a point to what felt like a drop is not a
   *  mistake the user can see coming (DESIGN.md §7). */
  const confirmDeleteAnchor = useCallback(
    (handle: RouteDraftHandle, index: number) => {
      Alert.alert("Remove this point?", "The line will join its neighbours.", [
        { text: "Keep it", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => handle.deleteAnchorAt(index),
        },
      ]);
    },
    [],
  );

  /** Drag and tap wiring for one draft's handles.
   *
   *  The drag PREVIEWS on every frame (so the line follows the finger) and
   *  COMMITS once on the drop — one undo step per gesture, one persisted write,
   *  and one round of snapping rather than one per frame. */
  const anchorHandlers = useCallback(
    (handle: RouteDraftHandle) => ({
      onAnchorDragStart: () => {
        anchorDragged.current = false;
      },
      onAnchorDrag: (index: number, point: [number, number]) => {
        anchorDragged.current = true;
        handle.previewAnchorAt(index, point);
      },
      onAnchorDragEnd: (index: number, point: [number, number]) => {
        handle.moveAnchorAt(index, point);
        snapAroundAnchor(handle, index, point);
        // The tap that ends a drag also fires onSelected; this keeps it from
        // being read as "remove this point".
        anchorDragged.current = true;
      },
      onAnchorPress: (index: number) => {
        if (anchorDragged.current) {
          anchorDragged.current = false;
          return;
        }
        confirmDeleteAnchor(handle, index);
      },
    }),
    [confirmDeleteAnchor, snapAroundAnchor],
  );

  /** Leaving route draw is NOT free the way leaving measure is — these points
   *  were meant to become something. Confirm before binning real work. */
  /** `then` runs only if the draft is actually discarded, so a caller can arm
   *  another tool without racing the confirm.
   *
   *  Guarded with a typeof check because this is also wired to a button, and a
   *  press handler is handed the gesture EVENT as its first argument — which
   *  crashed the screen with "then is not a function (it is Object)" the moment
   *  Cancel was pressed. Call sites that are event handlers wrap it. */
  const handleCancelRouteDraw = useCallback(
    (then?: () => void) => {
      const discard = () => {
        routeDraft.close();
        setEditingRouteId(null);
        if (typeof then === "function") then();
      };
      if (routeDraft.points.length === 0) {
        discard();
        return;
      }
      Alert.alert("Discard this route?", "The points you placed will be lost.", [
        { text: "Keep drawing", style: "cancel" },
        { text: "Discard", style: "destructive", onPress: discard },
      ]);
    },
    [routeDraft],
  );

  /** Restore a draft the app was killed in the middle of.
   *
   *  Runs once, before anything is persisted (`draftRestored` gates the writer
   *  below), or the empty first render would overwrite what we are about to
   *  read back. Failure is silent: an unreadable draft means the tool opens
   *  closed, which is where it would have been anyway. */
  const draftRestored = useRef(false);
  // Also state, because the "edit this route" request below must wait for it:
  // the restore is async and would otherwise land on top of the route the user
  // asked to edit.
  const [draftRestoreDone, setDraftRestoreDone] = useState(false);
  const [pendingDraftFit, setPendingDraftFit] = useState<Bbox | null>(null);
  useEffect(() => {
    let cancelled = false;
    readRouteDraft()
      .then((stored) => {
        if (cancelled) return;
        if (stored) {
          routeDraft.open({ points: stored.points, anchors: stored.anchors });
          setEditingRouteId(stored.editingRouteId);
          // Frame it too. A HUD announcing 22 points over an empty map reads
          // as "the app lost my route" — the camera is the confirmation that
          // it came back. Handed to an effect below because fitCameraToBbox is
          // declared after this one.
          setPendingDraftFit(
            bboxOfPoints(stored.points.map(([lon, lat]) => ({ lon, lat }))),
          );
        }
      })
      .catch(console.error)
      .finally(() => {
        if (cancelled) return;
        draftRestored.current = true;
        setDraftRestoreDone(true);
      });
    return () => {
      cancelled = true;
    };
    // Mount only: re-running this would resurrect a draft the user just binned.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Persist every change to the draft. Cheap — a route is a handful of
   *  coordinate pairs — and it is the only thing standing between a killed app
   *  and twenty minutes of drawing. */
  // Tell the tab bar there is unsaved work here (see routeEditLock). Cleared
  // on unmount too: a screen that goes away with the flag still set would lock
  // navigation with nothing on screen to explain it.
  useEffect(() => {
    setRouteEditing(routeDraft.active);
    return () => setRouteEditing(false);
  }, [routeDraft.active]);

  // Android back while drawing = the same question the bin asks, rather than
  // silently leaving the map with a draft armed.
  useEffect(() => {
    if (!routeDraft.active) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      handleCancelRouteDraw();
      return true;
    });
    return () => subscription.remove();
  }, [handleCancelRouteDraw, routeDraft.active]);

  //  Keyed on the draft VALUE, not the hook handle: the handle is a fresh
  //  object every render, which would turn this into a write per frame.
  const draft = routeDraft.draft;
  useEffect(() => {
    if (!draftRestored.current) return;
    if (!draft || draft.anchors.length === 0) {
      clearRouteDraft().catch(console.error);
      return;
    }
    saveRouteDraft({
      points: draftPoints(draft),
      anchors: draftAnchorIndices(draft),
      editingRouteId,
    }).catch(console.error);
  }, [draft, editingRouteId]);

  /** Save the drawn points as a route. Offline is the expected case, not a
   *  degraded one: createRouteLocal writes the mirror and queues the op, so the
   *  route is on the map immediately and reaches the server whenever there is
   *  signal. */
  const handleSaveRoute = useCallback(
    async (name: string) => {
      const points = routeDraft.points;
      if (points.length < 2) return;
      // Anchors ride along so a snapped route reopens with the user's own
      // handful of vertices rather than every snapped one.
      const anchors = routeDraft.anchorIndices();
      setSavingRoute(true);
      try {
        if (editingRouteId) {
          await updateRouteLocal(editingRouteId, { name, points, anchors });
        } else {
          await createRouteLocal({
            name,
            points,
            anchors,
            ...(draftCanyonId ? { canyonId: draftCanyonId } : {}),
          });
        }
        setNamingRoute(false);
        routeDraft.close();
        setEditingRouteId(null);
        setDraftCanyonId(null);
      } catch (err) {
        console.error(err);
        Alert.alert("Route error", "Couldn't save that route.");
      } finally {
        setSavingRoute(false);
      }
    },
    [draftCanyonId, editingRouteId, routeDraft],
  );

  /** Arming a tool closes the tray: the HUD then says what mode you are in,
   *  and an open tray behind it would be a second answer to that question.
   *  Tapping the armed tool again turns it off. */
  const handlePickTool = useCallback(
    (tool: MapTool) => {
      setToolsOpen(false);
      // Measure and route both want the map's taps, so arming one must disarm
      // the other — in BOTH directions. Measure used to arm without clearing a
      // route draft, which left two HUDs stacked and every tap going to
      // whichever tool won the race.
      if (tool === "measure") {
        // Leaving measure bins its points without asking — a measurement is a
        // question you asked once, not an asset (DESIGN.md §8).
        if (measureDraft.active) {
          measureDraft.close();
          return;
        }
        // Route draft holds work worth confirming before it is binned; the
        // confirm handler clears it, and measure arms once it has.
        if (routeDraft.active) {
          handleCancelRouteDraw(() => measureDraft.open());
          return;
        }
        measureDraft.open();
        return;
      }
      if (routeDraft.active) {
        handleCancelRouteDraw();
        return;
      }
      measureDraft.close();
      setEditingRouteId(null);
      routeDraft.open();
    },
    // handleCancelRouteDraw is declared below and is stable; see its useCallback.
    [measureDraft, routeDraft, handleCancelRouteDraw],
  );

  /** One entry point for both point-collecting tools, so every tap surface
   *  (map, canyon pin, waypoint pin) only has to know "a tool wants this".
   *
   *  Snapping happens here rather than in each tool, so both behave the same.
   *  It only ever ADDS points between the previous vertex and this one — the
   *  tapped point itself always lands where the finger did, so a snap the user
   *  dislikes costs one Undo rather than a guess at what they meant. */
  const addToolPoint = useCallback(
    async (longitude: number, latitude: number) => {
      if (!activeDraft) return;
      const tapped: [number, number] = [longitude, latitude];
      const previousPoint = activeDraft.anchors.at(-1) ?? null;

      // The tapped point lands FIRST and always: reading the archive is a
      // network round trip on a cold tile, and making every tap wait on it
      // would feel broken. The snapped run fills in behind.
      activeDraft.addAnchor(tapped);

      if (!previousPoint) return;
      await snapBetween(activeDraft, previousPoint, tapped);
    },
    [activeDraft, snapBetween],
  );

  /** Long-press near the drawn line adds a point there.
   *
   *  Web does this by dragging the line itself; a touch map cannot spare that
   *  gesture (it is pan), so the press-and-hold is the mobile equivalent. It
   *  only fires while a point tool is armed and only near the line, so it
   *  never competes with anything else. */
  const insertAnchorNear = useCallback(
    (lon: number, lat: number): boolean => {
      if (!activeDraft?.draft) return false;
      const near = nearestSegment(activeDraft.draft, [lon, lat]);
      if (!near) return false;
      // Tolerance in degrees, derived from the current zoom so the reach feels
      // the same however far in you are.
      const degreesPerPixel = 360 / (256 * 2 ** camera.zoom * PIXEL_RATIO);
      if (near.distanceDegrees > degreesPerPixel * LINE_GRAB_PIXELS) return false;
      activeDraft.insertAnchorAt(near.index, [lon, lat]);
      return true;
    },
    [activeDraft, camera.zoom],
  );

  const handleMapPress = useCallback(
    (feature: GeoJSON.Feature) => {
      if (feature.geometry.type !== "Point") return;
      const [lon, lat] = feature.geometry.coordinates as [number, number];
      // A tool armed owns every tap; nothing else on this handler runs.
      if (collectingPoints) {
        void addToolPoint(lon, lat);
        return;
      }
      // A tap is not a pan, so it no longer stops follow mode. It used to,
      // which meant looking at anything cost you the lock — and now that a tap
      // opens the point panel, "what is that spot" would end with the map no
      // longer following you.
      setTappedPoint({ latitude: lat, longitude: lon });
    },
    [addToolPoint, collectingPoints],
  );

  const handleCanyonPress = useCallback(
    (event: {
      features?: { properties?: Record<string, unknown> | null }[];
      coordinates?: { latitude: number; longitude: number };
      point?: { x: number; y: number };
    }) => {
      // A pin swallows the press before the map sees it, so while a
      // point-collecting tool is armed it has to place the point itself —
      // otherwise tapping near a canyon does nothing and reads as broken.
      if (collectingPoints) {
        if (event.coordinates) {
          void addToolPoint(event.coordinates.longitude, event.coordinates.latitude);
        }
        return;
      }
      const props = event.features?.[0]?.properties;
      if (props && typeof props.id === "string" && typeof props.name === "string") {
        onOpenCanyon(props.id, props.name);
      }
    },
    [addToolPoint, collectingPoints, onOpenCanyon],
  );

  // Stage 4b topo overlays + Stage 5 vector-import file management (save
  // offline / import file / delete) relocated to SavedScreen — viewport-
  // independent asset management. This screen keeps only the per-asset
  // visibility toggles (registry/hooks below feed both screens).
  const { imports } = useVectorImports();
  const visibleImports = imports.filter((imported) => imported.visible);

  // Stage 6: GeoPDF imports. Import/resume/account-import/delete relocated
  // to SavedScreen (viewport-independent management); this screen keeps only
  // the ready layers it renders plus the sheet's visibility + opacity rows.
  const { geoPdfImports } = useGeoPdfImports();
  const readyGeoPdfImports = geoPdfImports.filter(
    (gp) => gp.state === "ready" && gp.visible,
  );

  // Stage 7: track recording + waypoints + navigate-to-point. The recorder
  // itself lives in tracks/trackRecorder (background task); this screen only
  // starts it and renders state. (The start/navigate callbacks live below
  // handleLocateMe — they depend on it.)
  const { tracks } = useTracks();
  // Live region downloads, so the map can report one that is still running.
  const downloadJob = activeRegionJob(useRegionDownloads());
  // Waypoints are a synced entity since Stage 8: mirror-backed, offline
  // writes queue through the outbox. TrackMapLayers keeps its lon/lat shape.
  const mirrorWaypoints = useMirrorWaypoints();
  const waypoints: Waypoint[] = useMemo(
    () =>
      (mirrorWaypoints.data ?? []).map((wp) => ({
        id: wp.id,
        name: wp.name,
        lon: wp.longitude,
        lat: wp.latitude,
        createdAt: wp.createdAt,
      })),
    [mirrorWaypoints.data],
  );
  const activeTrack =
    tracks.find(
      (track) => track.state === "recording" || track.state === "paused",
    ) ?? null;

  // Locking north-up straightens a map that is already turned. Without this the
  // setting reads as broken for as long as the user leaves the screen rotated:
  // the gesture stops working, but the map stays askew with no way back to north
  // except the compass ornament they may have turned off.
  useEffect(() => {
    if (!northUpLocked) return;
    setCameraStop({ heading: 0, animationDuration: 300 });
  }, [northUpLocked, setCameraStop]);

  // KEEP AWAKE (Settings → Map). A wake lock is the most expensive preference in
  // the app, so it is held for exactly as long as its reason is true and no
  // longer: `map` while this screen is the focused one, `recording` while a
  // track is actually running (a PAUSED track is a phone in a pack). Recording
  // itself needs none of this — the foreground service keeps it alive with the
  // screen off — which is why the default is `off`.
  const mapFocused = useIsFocused();
  const keepAwakeReason =
    keepAwakeMode === "map"
      ? mapFocused
      : keepAwakeMode === "recording" && activeTrack?.state === "recording";
  useEffect(() => {
    if (!keepAwakeReason) return;
    activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(console.error);
    return () => {
      deactivateKeepAwake(KEEP_AWAKE_TAG).catch(console.error);
    };
  }, [keepAwakeReason]);
  const [navTarget, setNavTarget] = useState<Waypoint | null>(null);
  const navDistanceM =
    navTarget && userCoord
      ? haversineMeters(userCoord[1], userCoord[0], navTarget.lat, navTarget.lon)
      : null;
  const navBearingDeg =
    navTarget && userCoord
      ? initialBearingDegrees(
          userCoord[1],
          userCoord[0],
          navTarget.lat,
          navTarget.lon,
        )
      : null;

  // Reconcile a recording that outlived the app (kill/reboot) — marks it
  // paused when the platform task died, stops an orphaned task.
  useEffect(() => {
    reconcileTrackRecordingOnLaunch().catch(console.error);
  }, []);

  // A press-and-hold is "something goes here". Two things can: a waypoint (a
  // scratch mark) and a canyon (a real record). A sheet rather than an Alert now
  // that there is more than one — Android's Alert drops buttons past three, and
  // these entries carry glyphs and a subtitle (DESIGN.md §6).
  const notify = useCallback((text: string, tone: "info" | "error") => {
    toastNonce.current += 1;
    setToast({ text, tone, nonce: toastNonce.current });
  }, []);

  const dropWaypointAt = useCallback(
    (point: { latitude: number; longitude: number }) => {
      createWaypointLocal({
        name: `Waypoint ${waypoints.length + 1}`,
        latitude: point.latitude,
        longitude: point.longitude,
      }).catch(console.error);
    },
    [waypoints.length],
  );

  // "Open in Logjam": ACTION_VIEW / share-sheet delivers a content:// URI.
  // Kind is sniffed from leading bytes (content URIs carry no reliable name).
  // A GeoPDF goes through the same background runner as every other import
  // surface, so it gets the same progress card in Saved and the same toast; a
  // successful one also re-centres the map, which the other surfaces can't do.
  const handleIncomingUrl = useCallback(
    async (url: string | null) => {
      if (!url || !isFileIntentUrl(url) || handledIntentUrls.has(url)) return;
      handledIntentUrls.add(url);
      try {
        const headB64 = await FileSystem.readAsStringAsync(url, {
          encoding: FileSystem.EncodingType.Base64,
          position: 0,
          length: 4096,
        });
        const head = Uint8Array.from(atob(headB64), (c) => c.charCodeAt(0));
        const kind = classifyIncomingBytes(head);
        if (kind === null) {
          Alert.alert(
            "Can't open this file",
            "Logjam can import GeoPDF, GPX, KML/KMZ and GeoJSON files.",
          );
          return;
        }
        if (kind === "pdf") {
          // Through the shared background runner, exactly like the Saved tab's
          // import: a progress card, a toast on the outcome, and the app usable
          // throughout. This path used to read the whole file as base64 and
          // decode it a character at a time on the UI thread, then run the
          // import with an empty progress callback — minutes of frozen app with
          // nothing on screen to say why.
          const outcome = await runGeoPdfImport("Shared map", (onProgress, token) =>
            importGeoPdfFile("Shared map", url, onProgress, token),
          );
          if (outcome?.status === "imported" && outcome.record.bbox) {
            fitCameraToBbox(outcome.record.bbox);
          }
        } else {
          const record = await importVectorSource(
            url,
            syntheticNameFor(kind),
            imports.length,
          );
          fitCameraToBbox(record.bbox);
        }
      } catch (err) {
        console.error(err);
        const code = (err as { code?: string }).code;
        Alert.alert(
          "Import failed",
          (code && GEOPDF_ERRORS[code]) ??
            messageFromError(err, "Couldn't import that file."),
        );
      }
    },
    [imports.length, fitCameraToBbox],
  );
  const handleIncomingUrlRef = useRef(handleIncomingUrl);
  handleIncomingUrlRef.current = handleIncomingUrl;
  useEffect(() => {
    Linking.getInitialURL().then((url) => handleIncomingUrlRef.current(url));
    const sub = Linking.addEventListener("url", (event) =>
      handleIncomingUrlRef.current(event.url),
    );
    return () => sub.remove();
  }, []);

  // Open on the ground the user is standing on, at the standard scale — a map
  // that opens over the middle of NSW every time makes finding yourself the
  // first chore of every session.
  //
  // Permission is CHECKED, never requested (same rule as the compass tape): a
  // map that prompts the moment it opens is the prompt everyone learns to deny.
  // Without it, this quietly does nothing and the locate button still works.
  //
  // The OS's cached fix first, because it is instant and free. It is NOT always
  // there though — a phone that has just rebooted, or has had nothing ask for
  // location yet, has no last-known position at all, and that is exactly a
  // trailhead morning. So fall back to one Balanced fix (fused wifi/cell, not a
  // GPS spin-up) rather than leaving the user over the middle of NSW. One shot,
  // never a watcher: the live dot stays the locate button's job.
  //
  // Mount-only, and yields to an explicit destination: arriving with a route or
  // a "Show on map" bbox means the user asked for somewhere specific, and that
  // beats where they happen to be standing.
  const openedWithDestination = useRef(focus != null || route != null);
  const centredOnOpen = useRef(false);
  useEffect(() => {
    // WAIT FOR THE MAP. There is no <Camera> until the bundled glyph/sprite
    // install settles (the gate at the end of this component returns an empty
    // View until then), and `setCameraStop` against a null ref is silently
    // dropped — so an effect that ran plainly on mount did nothing at all, on
    // every launch. `mapReady` is the same condition that gate uses.
    if (!mapReady || centredOnOpen.current || openedWithDestination.current) return;
    centredOnOpen.current = true;
    let cancelled = false;
    void (async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== "granted" || cancelled) return;
        const position =
          (await Location.getLastKnownPositionAsync()) ??
          (await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          }));
        // The fallback can take seconds. Whatever the user has done with the
        // map in the meantime wins — yanking the camera out from under a pan
        // is worse than opening in the wrong place.
        if (!position || cancelled || userMovedCamera.current) return;
        setCameraStop({
          centerCoordinate: [position.coords.longitude, position.coords.latitude],
          zoomLevel: FOLLOW_ZOOM,
          // Instant when it came from the cache; a fetched fix animates in so
          // the jump reads as the map answering, not as a glitch.
          animationDuration: 0,
        });
      } catch (err) {
        // Never blocks the map: an unavailable provider just leaves the
        // default view (coordinates are never logged — privacy rule).
        console.error(err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mapReady, setCameraStop]);

  // "Show on map" arrival: fit the requested asset's bbox. Keyed on the nonce
  // so tapping the same asset again refocuses, and so a re-render with the
  // same params doesn't fight the user's own panning.
  useEffect(() => {
    if (!focus) return;
    // Basemap first, camera second: they commit in the same render either way,
    // and the ordering says which one is the correction.
    if (focus.basemapId) chooseBasemap(focus.basemapId);
    fitCameraToBbox(focus.bbox);
  }, [focus?.nonce, focus, chooseBasemap, fitCameraToBbox]);

  // Frame a draft restored from a killed session, once the map can take a
  // camera stop. Cleared after one use — the user's own panning owns the
  // camera from then on.
  useEffect(() => {
    if (!pendingDraftFit || !mapReady) return;
    fitCameraToBbox(pendingDraftFit);
    setPendingDraftFit(null);
  }, [fitCameraToBbox, mapReady, pendingDraftFit]);

  /** "Edit points" arrival from Saved: arm the draw tool on a saved route and
   *  frame it.
   *
   *  Waits for the draft restore, which is async — landing on top of it would
   *  either resurrect a discarded draft or bin the route the user asked for.
   *  An unsaved draft already in the tool goes through the same confirm as any
   *  other way of leaving it. Keyed on the nonce so asking twice re-arms. */
  const openRouteForEditing = useCallback(
    (target: MirrorRoute) => {
      const arm = () => {
        measureDraft.close();
        routeDraft.open({ points: target.points, anchors: target.anchors });
        setEditingRouteId(target.id);
        const bbox = bboxOfPoints(
          target.points.map(([lon, lat]) => ({ lon, lat })),
        );
        if (bbox) fitCameraToBbox(bbox);
      };
      // An unsaved draft already in the tool goes through the same confirm as
      // any other way of leaving it.
      if (routeDraft.active && routeDraft.points.length > 0) {
        handleCancelRouteDraw(arm);
      } else {
        arm();
      }
    },
    [fitCameraToBbox, handleCancelRouteDraw, measureDraft, routeDraft],
  );

  /** "Draw one on the map" arriving from a canyon page. */
  const drawRouteNonce = drawRouteFor?.nonce ?? null;
  const handledDrawNonce = useRef<number | null>(null);
  useEffect(() => {
    if (!drawRouteFor || !draftRestoreDone) return;
    if (handledDrawNonce.current === drawRouteFor.nonce) return;
    handledDrawNonce.current = drawRouteFor.nonce;
    const arm = () => {
      measureDraft.close();
      routeDraft.open();
      setEditingRouteId(null);
      setDraftCanyonId(drawRouteFor.canyonId);
    };
    if (routeDraft.active && routeDraft.points.length > 0) {
      handleCancelRouteDraw(arm);
    } else {
      arm();
    }
  }, [
    draftRestoreDone,
    drawRouteFor,
    drawRouteNonce,
    handleCancelRouteDraw,
    measureDraft,
    routeDraft,
  ]);

  const editRouteNonce = editRoute?.nonce ?? null;
  const handledEditNonce = useRef<number | null>(null);
  useEffect(() => {
    if (!editRoute || !draftRestoreDone) return;
    if (handledEditNonce.current === editRoute.nonce) return;
    const target = routes.data?.find((r) => r.id === editRoute.routeId);
    // The mirror may not have loaded yet; leave the request unhandled so the
    // next render with rows tries again.
    if (!target) return;
    handledEditNonce.current = editRoute.nonce;
    openRouteForEditing(target);
  }, [
    draftRestoreDone,
    editRoute,
    editRouteNonce,
    openRouteForEditing,
    routes.data,
  ]);

  const findRoute = (id: string | null) =>
    (id && routes.data?.find((route) => route.id === id)) || null;
  const statsRoute = findRoute(statsRouteId);
  const optionsRoute = findRoute(optionsRouteId);
  const linkingRoute = findRoute(linkingRouteId);

  /**
   * Pinch-to-zoom while following, driven from JS instead of by MapLibre.
   *
   * MapLibre zooms about the midpoint between the fingers, and there is no way
   * to tell it otherwise from React Native: the focal point it uses is
   * `constantFocalPoint` if the host app set one and the gesture's own focus
   * otherwise, and MLRN exposes no way to set the former. So a pinch always
   * translates the map, and "keep following" could only ever mean letting it
   * drift and then yanking it back when the fingers lifted — which is what the
   * first version did, and it read as the map fighting you: the view slid, then
   * snapped, and the zoom it settled on was not always the one you had let go
   * at, because the corrective stop and the gesture's own inertia both wrote
   * the camera.
   *
   * Instead the root view CLAIMS the responder the moment a second finger lands
   * while following. MapLibre gets an ACTION_CANCEL, never starts a scale
   * gesture, and this drives the camera directly: centre pinned to the latest
   * fix, zoom from the ratio of finger separation to where it started. Nothing
   * translates, nothing snaps back, and the zoom on release is exactly the last
   * one written.
   *
   * Only while following, and only for two fingers — everywhere else MapLibre
   * keeps its gestures untouched.
   */
  const shouldDrivePinch = useCallback((touchCount: number): boolean => {
    return (
      followModeRef.current !== "off" && touchCount >= 2 && latestFix.current != null
    );
  }, []);

  const touchSeparation = (
    touches: { pageX: number; pageY: number }[],
  ): number => {
    const [a, b] = touches;
    return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
  };

  /** Angle of the line between the two fingers, degrees, clockwise-positive. */
  const touchAngleDeg = (touches: { pageX: number; pageY: number }[]): number => {
    const [a, b] = touches;
    return (Math.atan2(b.pageY - a.pageY, b.pageX - a.pageX) * 180) / Math.PI;
  };

  const observeTouches = useCallback(
    (event: GestureResponderEvent, isTouchStart: boolean): boolean => {
      const { touches } = event.nativeEvent;
      // ONE FINGER: watch it for a drag, because while following MapLibre is not
      // watching for one. Its pan is off (see `scrollEnabled`), so the drag that
      // means "stop following" has to be recognised here and answered by
      // handing pan back, rather than by MapLibre panning and this screen
      // noticing afterwards.
      //
      // Anchored on a ONE-FINGER touch START, the only event that says "a new
      // gesture begins". There is no matching end — these two capture props
      // fire on start and move only, which is what left the old `firstTouchAt`
      // holding a timestamp from a gesture several seconds back — so every
      // reset here has to hang off a start.
      if (touches.length > 1) gestureHadTwoFingers.current = true;
      if (touches.length === 1) {
        const [only] = touches;
        // A touch start with exactly one finger down is the only thing that
        // begins a gesture; everything else is a continuation of one.
        if (isTouchStart) {
          panOrigin.current = { x: only.pageX, y: only.pageY };
          gestureHadTwoFingers.current = false;
        } else if (
          !gestureHadTwoFingers.current &&
          panOrigin.current !== null &&
          followModeRef.current !== "off" &&
          Math.hypot(
            only.pageX - panOrigin.current.x,
            only.pageY - panOrigin.current.y,
          ) > PAN_SLOP_DP
        ) {
          // The ref as well as the state: `scrollEnabled` needs the render, but
          // everything else in this file reads the ref, and the next touch
          // event arrives long before the commit.
          followModeRef.current = "off";
          setFollowMode("off");
          userMovedCamera.current = true;
        }
      }
      if (!shouldDrivePinch(touches.length)) return false;
      // Hands pitch back as well — the one two-finger gesture MapLibre still has
      // while following. Scale, rotate and pan are already off it.
      setTwoFingerLock(true);
      // Separation of zero (both fingers on the same pixel) would make every
      // later ratio infinite; let MapLibre have that gesture instead.
      const distance = touchSeparation(touches);
      if (distance < 1) return false;
      pinchStart.current = {
        distance,
        angleDeg: touchAngleDeg(touches),
        zoom: zoomRef.current,
        heading: headingRef.current,
      };
      return true;
    },
    [shouldDrivePinch],
  );

  const handlePinchMove = useCallback(
    (event: GestureResponderEvent) => {
      const start = pinchStart.current;
      const { touches } = event.nativeEvent;
      if (!start || touches.length < 2 || !latestFix.current) return;
      const distance = touchSeparation(touches);
      if (distance < 1) return;
      // Doubling the separation is one zoom level, which is what the gesture
      // means everywhere else on the phone.
      const zoom = Math.min(
        MAX_PINCH_ZOOM,
        Math.max(MIN_PINCH_ZOOM, start.zoom + Math.log2(distance / start.distance)),
      );
      zoomRef.current = zoom;
      // ROTATION IS PART OF THE SAME GESTURE. No real pinch is a pure scale —
      // fingers always turn a few degrees — and while MapLibre owned that
      // rotation it was a second camera driver on the same two fingers, which
      // is what made follow mode let go "sometimes": the pinch stayed locked,
      // the incidental twist did not. Both axes are driven here now, from one
      // start reference, so a twist is either applied or ignored on purpose.
      //
      // Screen y grows downward, so the finger angle increases CLOCKWISE and
      // the camera bearing (which way the top of the screen faces) has to move
      // the other way for the map to turn with the fingers.
      //
      // Course-up is the deliberate exception: its heading belongs to the
      // compass, so two fingers there scale and nothing else. Turning the map
      // by hand while it is meant to be facing where you are looking is two
      // answers to one question.
      // A locked map scales and nothing else — the same shape as course-up's
      // exception, for the opposite reason. Read through a ref: this callback is
      // memoised for the life of the gesture handlers.
      const rotating = followModeRef.current === "follow" && !northUpLockedRef.current;
      const heading = rotating
        ? normalizeBearing(start.heading - (touchAngleDeg(touches) - start.angleDeg))
        : null;
      if (heading != null) headingRef.current = heading;
      setCameraStop({
        // The fix, unmoved — the whole point of following, and now the only
        // thing that ever writes this screen's centre during a pinch. Nothing
        // else can have moved the map to recover from: MapLibre's pan is off
        // for the whole of follow mode.
        centerCoordinate: latestFix.current,
        zoomLevel: zoom,
        ...(heading != null ? { heading } : {}),
        // No animation: the fingers ARE the animation. Anything else lags the
        // gesture and reads as the map resisting.
        animationDuration: 0,
      });
    },
    [setCameraStop],
  );

  const endPinch = useCallback(() => {
    pinchStart.current = null;
    setTwoFingerLock(false);
  }, []);

  // Live camera → the scale bar only, at gesture rate. Coordinates stay in
  // component state only — never logged (privacy rule).
  //
  // This is also where a follow mode ends. Panning while the camera is being
  // driven is a fight the user cannot win: every fix (and, in course-up, every
  // compass sample at ~20 Hz) writes a camera stop that snaps the map back
  // mid-gesture, so the map reads as broken rather than as locked. The gesture
  // wins — `isUserInteraction` is false for our own stops, so the recentres
  // and rotations this screen asks for can't cancel themselves.
  //
  // Course-up's rotation is left applied: yanking the map back to north under
  // a thumb that is mid-pan is a second unrequested camera move. The native
  // compass ornament resets north on tap.
  const handleRegionIsChanging = useCallback(
    (feature: {
      geometry: { coordinates: number[] };
      properties: { zoomLevel: number; isUserInteraction: boolean };
    }) => {
      scaleBarRef.current?.update(
        feature.geometry.coordinates[1],
        feature.properties.zoomLevel,
      );
      if (feature.properties.isUserInteraction) {
        // Also the open-on-your-location effect's stop signal: once the user
        // has moved the map themselves, a fix that arrives late must not take
        // the camera back off them.
        userMovedCamera.current = true;
        // Only a ONE-FINGER drag means "take me somewhere else". A two-finger
        // gesture is scale and rotation, both of which this screen is driving
        // itself, so it must not be read as a request to be let go of.
        //
        // The test is "am I driving a pinch right now", not a finger tally:
        // the tally was reset by `onRegionDidChange`, and the pinch handler's
        // own camera writes fire that on every move — so mid-pinch the counter
        // was 0 and any interaction event MapLibre still emitted (an
        // incidental rotation, most often) dropped follow.
        if (followModeRef.current !== "off" && pinchStart.current === null) {
          // The ref too, not just the state: this fires many times per gesture
          // and state only lands on the next render.
          followModeRef.current = "off";
          setFollowMode("off");
        }
      }
    },
    [],
  );

  // Settled camera readout. Coordinates stay in component state only — never
  // logged (privacy rule).
  const handleRegionDidChange = useCallback(
    (feature: {
      geometry: { coordinates: number[] };
      properties: { zoomLevel: number; heading: number };
    }) => {
      const latitude = feature.geometry.coordinates[1];
      const longitude = feature.geometry.coordinates[0];
      const { zoomLevel } = feature.properties;
      if (!Number.isFinite(latitude) || !Number.isFinite(zoomLevel)) return;
      scaleBarRef.current?.update(latitude, zoomLevel);
      // The move that just settled is done with; drop its stop so a re-render
      // can't replay it (see stopNeedsReset).
      if (stopNeedsReset.current) {
        stopNeedsReset.current = false;
        cameraRef.current?.setCamera({ animationDuration: 0 });
      }
      // MID-PINCH, STOP HERE. Every move this screen drives writes a camera
      // stop, and every stop settles into this handler — so carrying on would
      // re-render a 2700-line component on every frame of the gesture, which
      // is the jitter that made a pinch feel like two things fighting. The
      // scale bar is already fed from `onRegionIsChanging` through its ref;
      // the readout and the viewport catch up on the settle after release.
      if (pinchStart.current !== null) return;
      // Running camera, for the NEXT pinch to start its scale and rotation from
      // whatever is actually on screen — but ONLY when this screen is not the
      // thing driving the camera.
      //
      // This is what made a second pinch jump back a couple of zoom levels
      // before it started. Every frame of a gesture writes a camera stop, every
      // stop settles into this handler, and those settles arrive late, coalesced
      // and occasionally out of order — so one carrying a zoom from early in the
      // last gesture could land here afterwards and overwrite the value the next
      // `observeTouches` reads as its starting point. The first frame of that
      // pinch then snapped the map back to it.
      //
      // While following, MapLibre's own zoom and rotate gestures are disabled,
      // so nothing but this screen can change either — which makes our own
      // record (kept by `setCameraStop`) authoritative and every report back
      // redundant. Skipping them here is not an optimisation: a stale report is
      // strictly worse than no report.
      if (followModeRef.current === "off" || acceptSettleCamera.current) {
        acceptSettleCamera.current = false;
        zoomRef.current = zoomLevel;
        if (Number.isFinite(feature.properties.heading)) {
          headingRef.current = feature.properties.heading;
        }
      }
      // What is actually on screen, for the offline notice. Async, and asked
      // of the map rather than derived, because a rotated view's extent is not
      // its centre plus its zoom.
      void mapRef.current
        ?.getVisibleBounds()
        .then((bounds) => {
          if (!bounds) return;
          const [[neLng, neLat], [swLng, swLat]] = bounds;
          setViewportBbox((prev) =>
            prev &&
            prev.north === neLat &&
            prev.east === neLng &&
            prev.south === swLat &&
            prev.west === swLng
              ? prev
              : { north: neLat, east: neLng, south: swLat, west: swLng },
          );
        })
        .catch(console.error);
      setCamera((prev) =>
        prev.zoom === zoomLevel &&
        prev.latitude === latitude &&
        prev.longitude === longitude
          ? // Same readout ⇒ same render output. Bailing keeps a stop replay
            // (which reports the unchanged region again) from re-rendering and
            // replaying forever.
            prev
          : {
              zoom: zoomLevel,
              latitude: latitude as number,
              longitude: longitude as number,
            },
      );
    },
    [],
  );

  // Place search result: recentre without changing zoom intent drastically.
  const handleSelectPlace = useCallback((latitude: number, longitude: number) => {
    setFollowMode("off");
    setCameraStop({
      centerCoordinate: [longitude, latitude],
      zoomLevel: 13,
      animationDuration: 800,
    });
  }, [setCameraStop]);

  /**
   * Put the latest fix back under the crosshair, at the standard scale
   * (FOLLOW_ZOOM — set there, in both directions, never relative to where the
   * camera happened to be).
   *
   * `heading` rotates in the same stop rather than a second one; a stop
   * REPLACES its predecessor, so two writes would cancel each other.
   */
  const recentre = useCallback(
    (heading?: number) => {
      if (!latestFix.current) return;
      setCameraStop({
        centerCoordinate: latestFix.current,
        zoomLevel: FOLLOW_ZOOM,
        ...(heading != null ? { heading: normalizeBearing(heading) } : {}),
        animationDuration: 600,
      });
    },
    [setCameraStop],
  );

  /**
   * Enter course-up's opening rotation, but not until React has committed.
   *
   * The rotation and the disappearance of the native compass ornament are
   * driven by two different mechanisms — an imperative camera stop and a
   * `compassEnabled` prop — and calling the first from the tap handler ran it
   * against the second. From north the ornament is faded out, so it FADED IN
   * as the map turned and then blinked away when the prop landed; from an
   * already-rotated map it hung around, needle swinging, until the same commit.
   * Either way the user sees a control appear or persist for a moment in the
   * one mode where it must not exist.
   *
   * A layout effect is the ordering guarantee: React runs it after the commit
   * that carries `compassEnabled={false}` to the native view, and before the
   * frame is painted. The nonce (rather than keying on `followMode`) is what
   * makes the slow path work too — a heading fetched from the sensor arrives
   * after that commit has already happened, and needs its own trigger.
   */
  const pendingPovHeading = useRef<number | undefined>(undefined);
  const [povRecentreNonce, setPovRecentreNonce] = useState(0);
  const requestPovRecentre = useCallback((heading: number | undefined) => {
    pendingPovHeading.current = heading;
    setPovRecentreNonce((nonce) => nonce + 1);
  }, []);
  useLayoutEffect(() => {
    if (povRecentreNonce === 0) return;
    recentre(pendingPovHeading.current);
  }, [povRecentreNonce, recentre]);

  /**
   * Start the compass watcher if it isn't already running. Two independent
   * things want it — the location arrow / course-up camera, and the compass
   * tape, which runs with no fix at all — so ownership sits here rather than
   * inside the locate-me flow.
   */
  const ensureHeadingWatch = useCallback(async () => {
    // `watchHeadingAsync` is awaited, so a second caller arriving during that
    // await would subscribe a second time and never be able to remove it.
    if (headingWatch.current || headingWatchStarting.current) return;
    headingWatchStarting.current = true;
    try {
      // Compass heading — which way the user is FACING. It orients the location
      // arrow, the compass tape and, in course-up, the whole map, so it is
      // smoothed rather than gated (see heading.ts: the old ≥3° deadband turned
      // a wobble into a staircase). trueHeading needs a location fix for
      // declination; when it is unavailable (reported as -1) resolveTrueHeading
      // corrects the magnetic reading rather than passing it off as true —
      // everything else on this screen, including the navigate-to chip and the
      // tape's labels, is true north.
      headingWatch.current = await Location.watchHeadingAsync((heading) => {
        const raw = resolveTrueHeading(heading);
        if (raw == null) return;
        const next = smoothHeading(smoothedHeading.current, raw);
        smoothedHeading.current = next;

        // The sensor runs ~10 Hz; the arrow only needs ~20 fps of it, and every
        // update re-renders this screen.
        const now = Date.now();
        if (now - lastHeadingRender.current >= HEADING_RENDER_MS) {
          lastHeadingRender.current = now;
          setUserHeading(next);
        }

        // Course-up: turn the map with them. Below a degree of change this is
        // sensor noise, and a camera commit per sample makes the map seasick.
        if (followModeRef.current !== "course-up") return;
        const previous = lastPovBearing.current;
        if (previous != null && Math.abs(shortestAngleDelta(previous, next)) < 1) return;
        lastPovBearing.current = next;
        setCameraStop({
          heading: normalizeBearing(next),
          // Carry the position too: this stop REPLACES whatever the last one was,
          // and at ~20 writes a second it would otherwise cancel every recentre
          // the location watcher asked for.
          ...(latestFix.current ? { centerCoordinate: latestFix.current } : {}),
          animationDuration: HEADING_RENDER_MS,
        });
      });
    } finally {
      headingWatchStarting.current = false;
    }
  }, [setCameraStop]);

  // The compass tape's own subscription. Permission is CHECKED, never requested
  // here — a map that asks for location the moment it opens is the prompt every
  // user learns to deny. Settings does the asking when the switch goes on, and
  // locate-me does it on demand; until then the tape simply doesn't draw.
  useEffect(() => {
    if (compassEnabled) {
      Location.getForegroundPermissionsAsync()
        .then(({ status }) => {
          if (status === "granted") return ensureHeadingWatch();
        })
        .catch(console.error);
      return;
    }
    // Switched off: drop the sensor unless the location marker still needs it.
    if (locationWatch.current) return;
    headingWatch.current?.remove();
    headingWatch.current = null;
    setUserHeading(null);
    smoothedHeading.current = null;
  }, [compassEnabled, ensureHeadingWatch]);

  const handleLocateMe = useCallback(async () => {
    if (!(await ensureForegroundLocationPermission())) return;
    // Drive the dot from expo-location directly — MLRN's built-in
    // UserLocation engine produced no updates on-device (silent), and we
    // need expo-location's watcher for Stage 7 track recording anyway.
    if (locationWatch.current) {
      // Cycle the follow mode; the last step stops the watchers.
      // Every mode change also RECENTRES. Fixes only arrive every few seconds
      // (and only after 5 m of movement), so without this the map stayed
      // wherever the user had panned it until they walked somewhere — which
      // reads as the follow button doing nothing at all.
      if (followModeRef.current === "off") {
        setFollowMode("follow");
        recentre();
        return;
      }
      if (followModeRef.current === "follow") {
        // North-up locked means the map may not turn, and course-up is nothing
        // but turning the map — so the cycle skips it rather than offering a
        // mode that would have to ignore the lock to work.
        if (northUpLockedRef.current) {
          setFollowMode("off");
          return;
        }
        setFollowMode("course-up");
        // The ref too: the heading callback reads it, and state lands a render
        // later — a sample arriving in between would be dropped as "not
        // course-up" and the map would wait for the one after it.
        followModeRef.current = "course-up";
        lastPovBearing.current = null;
        // Rotate from a heading we ALREADY have rather than waiting to be told
        // one. Android's heading watcher reports on change, so a phone lying
        // still on a rock emits nothing for seconds after the user asks to face
        // their direction — the map just sat north-up, which reads as the mode
        // not working. Last smoothed sample first, a one-shot sensor read if
        // there has never been one, and only then fall through to the watcher.
        let heading = smoothedHeading.current;
        if (heading == null) {
          heading = await currentHeading();
          if (heading != null) smoothedHeading.current = heading;
        }
        if (heading != null) lastPovBearing.current = heading;
        // NOT recentre(heading) — see the layout effect below. Turning the map
        // from here races the render that takes the compass ornament off it.
        requestPovRecentre(heading ?? undefined);
        return;
      }
      // Third tap drops follow but KEEPS the dot and its watchers: "don't
      // chase me" is a different request from "stop showing me", and a
      // canyoner who wants to look at the next drop still wants to see where
      // they are. Stopping the watchers is what leaving the screen does.
      setFollowMode("off");
      setCameraStop({ heading: 0, animationDuration: 300 });
      return;
    }
    setFollowMode("follow");
    firstFix.current = true;

    const applyFix = (position: Location.LocationObject, fly: boolean) => {
      const coord: [number, number] = [
        position.coords.longitude,
        position.coords.latitude,
      ];
      setUserCoord(coord);
      latestFix.current = coord;
      const mode = followModeRef.current;
      if (fly && firstFix.current) {
        firstFix.current = false;
        setCameraStop({
          centerCoordinate: coord,
          zoomLevel: FOLLOW_ZOOM,
          animationDuration: 1200,
        });
      } else if (mode !== "off") {
        // NOT WHILE A PINCH IS DRIVING THE CAMERA. This is a 600 ms ANIMATED
        // stop, and `handlePinchMove` writes 0 ms stops at gesture rate from the
        // same latest fix — so a fix landing mid-gesture starts a half-second
        // animation that the next finger frame overrides, then the one after,
        // and the map stutters for as long as the animation had left to run.
        // It is the same two-drivers-on-one-camera fault that took rotation off
        // MapLibre (see handlePinchMove), one axis over.
        //
        // Nothing is lost by skipping it: every pinch frame carries
        // `centerCoordinate: latestFix.current`, which this callback has already
        // updated, so the map is pinned to the new fix within a frame anyway.
        if (pinchStart.current) return;
        // Course-up rotation is driven by the COMPASS, not by the fix's course
        // over ground: the user wants the map to face where they are looking,
        // which on a scramble is often not where they last moved (and course
        // is reported as -1 whenever they stand still). The heading watcher
        // below owns that rotation; this only recentres.
        setCameraStop({ centerCoordinate: coord, animationDuration: 600 });
      }
    };

    // Instant feedback from the OS's cached fix (fused provider keeps a
    // recent network/wifi position even indoors) — the watcher then refines.
    const lastKnown = await Location.getLastKnownPositionAsync();
    if (lastKnown) applyFix(lastKnown, true);

    // Balanced = fused wifi/cell + GPS. High (GPS-priority) starves indoors
    // and the callback never fires — the original silent-failure mode.
    locationWatch.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 3000,
        distanceInterval: 5,
      },
      (position) => applyFix(position, true),
    );

    await ensureHeadingWatch();
  }, [ensureHeadingWatch, recentre, requestPovRecentre, setCameraStop]);

  /**
   * Navigate to a spot: distance + bearing from every new fix, in the chip at
   * the top of the map.
   *
   * A SYNTHETIC waypoint rather than a saved one — the chip only ever reads
   * name/lat/lon off its target, and pointing at a spot must not silently write
   * a row into the user's synced waypoints. Shared by the tap sheet, the
   * press-and-hold sheet and the press-and-hold shortcut, so all three produce
   * the same thing.
   */
  const navigateToPoint = useCallback(
    (point: { latitude: number; longitude: number }) => {
      setNavTarget({
        id: `map-point-${Date.now()}`,
        name: "Tapped point",
        lon: point.longitude,
        lat: point.latitude,
        createdAt: new Date().toISOString(),
      });
      // A bearing with nothing to measure it from is a dead chip.
      if (!locationWatch.current) handleLocateMe();
    },
    [handleLocateMe],
  );

  /**
   * Start drawing a route from a spot. An ALREADY-open draft is appended to
   * rather than replaced: the alternative is a press-and-hold that silently
   * bins a half-drawn route, which is the one thing the draft tool's own exit
   * confirm exists to prevent.
   */
  const startRouteDrawAt = useCallback(
    (point: { latitude: number; longitude: number }) => {
      // A FRESH draft is opened already holding the point, not opened and then
      // added to: `addToolPoint` reads `activeDraft`, which is derived state and
      // is still null in this render — the tool armed and the point vanished.
      // Seeding costs nothing else, because snapping only fills BETWEEN a
      // previous vertex and this one and there is no previous vertex.
      if (!routeDraft.active) {
        measureDraft.close();
        setEditingRouteId(null);
        routeDraft.open({ points: [[point.longitude, point.latitude]] });
        return;
      }
      void addToolPoint(point.longitude, point.latitude);
    },
    [addToolPoint, measureDraft, routeDraft],
  );

  /**
   * Start measuring from a spot. Same shape as `startRouteDrawAt` — and the
   * same seeding reason — differing only in which of the two point tools opens,
   * because they are one implementation (DESIGN.md §2).
   */
  const startMeasureAt = useCallback(
    (point: { latitude: number; longitude: number }) => {
      if (!measureDraft.active) {
        // Route draft holds work worth confirming before it is binned; measure
        // arms once that confirm has resolved, exactly as the tool button does.
        if (routeDraft.active) {
          handleCancelRouteDraw(() =>
            measureDraft.open({ points: [[point.longitude, point.latitude]] }),
          );
          return;
        }
        measureDraft.open({ points: [[point.longitude, point.latitude]] });
        return;
      }
      void addToolPoint(point.longitude, point.latitude);
    },
    [addToolPoint, handleCancelRouteDraw, measureDraft, routeDraft],
  );

  /**
   * Press-and-hold. `ask` opens the sheet that has always been here; the rest
   * are the same four outcomes without it, for people who only ever pick one
   * (Settings → Map).
   *
   * Declared down here, after the actions it dispatches to: every branch is one
   * of them, and a dispatcher that has to be defined before its own targets ends
   * up being a ref full of late-bound callbacks.
   */
  const handleMapLongPress = useCallback(
    (feature: GeoJSON.Feature) => {
      if (feature.geometry.type !== "Point") return;
      const [lon, lat] = feature.geometry.coordinates as [number, number];
      // While either point tool is armed, press-and-hold near the line means
      // "add a point here" — the mobile stand-in for dragging the line on web.
      // Only when it lands near the line; anywhere else follows the preference.
      if (insertAnchorNear(lon, lat)) return;
      const point = { latitude: lat, longitude: lon };
      switch (longPressAction) {
        case "waypoint":
          dropWaypointAt(point);
          return;
        case "navigate":
          navigateToPoint(point);
          return;
        case "route":
          startRouteDrawAt(point);
          return;
        case "measure":
          startMeasureAt(point);
          return;
        case "canyon":
          // Straight to the form: with no sheet open there is no Modal to
          // collide with, so this is the one branch that skips the park-and-
          // reopen dance the sheet needs (DESIGN.md §6).
          setAddCanyonAt(point);
          return;
        default:
          setLongPressPoint(point);
      }
    },
    [
      dropWaypointAt,
      insertAnchorNear,
      longPressAction,
      navigateToPoint,
      startMeasureAt,
      startRouteDrawAt,
    ],
  );

  const handleStartRecording = useCallback(async () => {
    if (!(await ensureForegroundLocationPermission())) return;
    try {
      await startTrackRecording();
      // Recording without seeing yourself is disorienting — start the dot +
      // follow if it isn't already running.
      if (!locationWatch.current) handleLocateMe();
    } catch (err) {
      console.error(err);
      Alert.alert("Recording error", "Couldn't start recording.");
    }
  }, [handleLocateMe]);

  const handleWaypointPress = useCallback(
    (waypoint: Waypoint) => {
      // Same reason as a canyon pin: while a tool is armed, a marker under the
      // thumb places a point rather than opening its menu.
      if (collectingPoints) {
        void addToolPoint(waypoint.lon, waypoint.lat);
        return;
      }
      Alert.alert(waypoint.name, undefined, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            setNavTarget((current) =>
              current?.id === waypoint.id ? null : current,
            );
            deleteWaypointLocal(waypoint.id).catch(console.error);
          },
        },
        {
          text: "Navigate",
          onPress: () => {
            setNavTarget(waypoint);
            if (!locationWatch.current) handleLocateMe();
          },
        },
      ]);
    },
    [addToolPoint, collectingPoints, handleLocateMe],
  );

  // The layer sheet groups these two ways at once — by layer across every area,
  // and by area — so each entry carries both its area and its layer rather than
  // one pre-joined label to be parsed back apart.
  const overlayList = mergedOverlays.jobs.flatMap((job) =>
    job.layers.map((layer) => ({
      key: `${job.jobId}/${layer.name}`,
      areaId: job.jobId,
      areaLabel: job.name ?? job.jobId.slice(0, 8),
      layer: layer.name,
      layerLabel:
        TOPO_LAYERS.find((meta) => meta.name === layer.name)?.label ?? layer.name,
    })),
  );

  // Chrome geometry. Notices clear the search row so an expanded search bar
  // never covers them; the scale bar runs from the left edge up to the floating
  // button column on the right.
  // With a tool armed the search pill is gone, so the stack starts in its
  // place rather than below where it would have been.
  const noticeTop = collectingPoints
    ? insets.top + CHROME_GAP
    : insets.top + CHROME_GAP + SEARCH_SIZE + spacing(1);
  const scaleBarMaxWidth =
    windowWidth - FAB_SIZE - CHROME_GAP * 3 - spacing(1);
  // The handedness swap, in three places that must agree: the JS action column,
  // the JS instruments, and MapLibre's own compass ornament (position 2 is
  // bottom-left, 3 is bottom-right). Absolute offsets rather than a flex
  // direction because all three are absolutely positioned against the map.
  const controlsOnLeft = controlSide === "left";
  /**
   * How high MapLibre's compass ornament has to sit to clear the instruments
   * under it. Derived from what is actually DRAWN — the tape only renders with
   * the compass on and a heading to show, the bar only with the scale bar on —
   * rather than from a constant that assumes both. Turning either off used to
   * leave the ornament floating above an empty gap.
   *
   * This is a preference read, NOT a measurement: `CHROME_BOTTOM`'s comment
   * warns off `onLayout`-driven offsets because they stick when the thing they
   * measured goes away. These are discrete values known before the frame is
   * drawn, so there is nothing to get stuck.
   */
  const instrumentsBottom = spacing(1);
  const ornamentMarginY =
    instrumentsBottom +
    (scaleBarEnabled ? SCALE_BAR_HEIGHT + INSTRUMENT_GAP : 0) +
    (compassEnabled ? COMPASS_STRIP_HEIGHT + INSTRUMENT_GAP : 0);
  const controlsEdge = controlsOnLeft
    ? { left: CHROME_GAP, right: undefined }
    : { right: CHROME_GAP, left: undefined };
  const instrumentsEdge = controlsOnLeft
    ? { right: CHROME_GAP, left: undefined, alignItems: "flex-end" as const }
    : { left: CHROME_GAP, right: undefined, alignItems: "flex-start" as const };
  // Fixed rather than run to the button column: the tape is a glance-at
  // reference, not a ruler, and a strip that changes width with the phone
  // changes how many degrees a thumb-width represents. Only narrow screens
  // shrink it.
  const compassWidth = Math.min(scaleBarMaxWidth, COMPASS_STRIP_WIDTH);
  /**
   * The one sentence the map says about its own basemap, or null for silence.
   *
   * Silence is the common case and has to stay cheap to reach: online with a
   * working source, or offline standing on tiles you saved.
   */
  const noticeText: string | null = (() => {
    if (connectivity === "online") {
      return basemapResolved.every((r) => r.status !== "ok")
        ? "This basemap is unavailable."
        : null;
    }
    if (coverageHere.current) return null;
    return coverageHere.others.length > 0
      ? "Offline — switch to a basemap you saved for this area."
      : "Offline — no downloaded basemap for this area.";
  })();

  const attributionText = basemapResolved
    .map((r) => (r.status === "ok" ? r.attribution : null))
    .filter(Boolean)
    .join(" · ");

  // Hold the map until the bundled glyph/sprite install settles (first launch:
  // one-time extraction, a second or two; after that: a marker check). Mounting
  // earlier would bake the remote glyph URLs into the style and force a full
  // style rebuild when the local ones arrive.
  if (!mapReady) {
    return <View style={styles.root} />;
  }

  return (
    <View
      style={styles.root}
      // Capture phase, so a touch is seen on its way DOWN to the map. It
      // returns false — declining the responder and leaving MapLibre's
      // gestures untouched — in every case except a two-finger gesture while
      // following, which it claims and drives itself (see handlePinchMove).
      onStartShouldSetResponderCapture={(event) => observeTouches(event, true)}
      onMoveShouldSetResponderCapture={(event) => observeTouches(event, false)}
      onResponderMove={handlePinchMove}
      onResponderRelease={endPinch}
      onResponderTerminate={endPinch}
      // Nothing takes a pinch off us halfway through.
      onResponderTerminationRequest={() => false}
    >
      <MapView
        ref={mapRef}
        style={styles.map}
        mapStyle={shellStyle}
        attributionEnabled={false}
        logoEnabled={false}
        // The compass is the NATIVE ornament: it tracks the camera frame by
        // frame, fades itself out at north, and resets north on tap — all
        // things the JS button did badly or not at all (it only redrew once a
        // gesture settled, and a rotated Feather glyph is not a needle).
        // Bottom-left (position 2), above the JS instruments — it answers a
        // different question from the compass tape (which way the MAP faces, vs
        // which way the USER does), so both are on screen at once. The margin is
        // a static clearance for the tape + scale bar rather than a measured
        // one: an ornament margin that moves with a toggle re-commits a native
        // view prop for a 46 px gap nobody notices. There is still no native
        // scale bar in v10, so that one stays drawn in JS.
        // HIDDEN IN COURSE-UP, and not only because tapping it snapped the
        // map back to north against the mode that was steering it — a fight
        // the compass won for exactly as long as it took the next sensor
        // sample to arrive. In that mode the map's heading IS the user's
        // heading, which the compass tape along the bottom already reports, so
        // the ornament has nothing left to say that isn't said better below.
        compassEnabled={followMode !== "course-up"}
        // Follows the instruments to whichever edge they are on (see
        // `instrumentsEdge`): 2 is bottom-left, 3 bottom-right.
        compassViewPosition={controlsOnLeft ? 3 : 2}
        compassViewMargins={{ x: CHROME_GAP, y: ornamentMarginY }}
        // BOTH two-finger gestures are MapLibre's only when nothing is being
        // followed. While following, this screen drives scale and rotation
        // together from one start reference (see handlePinchMove), and leaving
        // either with MapLibre would put two drivers on the same two fingers —
        // which is exactly how an incidental twist during a pinch used to
        // shake follow mode loose. Pan stays MapLibre's throughout: a
        // one-finger drag still pans, and still means "stop following".
        zoomEnabled={followMode === "off"}
        rotateEnabled={followMode === "off" && !northUpLocked}
        // PAN IS OFF FOR THE WHOLE OF FOLLOW MODE, not just during a pinch.
        //
        // MapLibre's move detector arms on the FIRST finger down and tracks the
        // focal point of whatever is touching; when a second finger lands, that
        // focal point jumps from the first finger to the midpoint of the two —
        // half the finger separation, in one frame — and MapLibre applies the
        // jump as a pan. `handlePinchMove` then writes the centre back to the
        // fix, and that pair IS the pan-then-snap a mistimed pinch showed.
        // Measured: 3-7 MapLibre camera reports per mistimed pinch against 0
        // for a clean one, which is the same split the eye sees.
        //
        // Taking the gesture away for the duration was tried first and cannot
        // work: `twoFingerLock` is React state, so `scrollEnabled` reaches the
        // native view 48-92 ms after the second finger lands (measured), and the
        // jump is in the first frame. The detector has to be disarmed BEFORE the
        // gesture starts, which means for as long as the map is following.
        //
        // The cost is that a one-finger drag no longer pans by itself while
        // following — `observeTouches` recognises it and drops follow, which
        // hands pan straight back. That costs a frame or two of deadband at the
        // start of a drag-to-stop-following, on the gesture least able to
        // notice it.
        scrollEnabled={followMode === "off" && !twoFingerLock}
        pitchEnabled={!twoFingerLock}
        onRegionIsChanging={handleRegionIsChanging}
        onRegionDidChange={handleRegionDidChange}
        onPress={handleMapPress}
        onLongPress={handleMapLongPress}
      >
        <Camera
          ref={cameraRef}
          defaultSettings={CAMERA_DEFAULTS}
        />
        {/* Bundled point-feature icons for vector overlays. */}
        <TopoIconImages />
        {/* Locate-me sprites: the facing arrow, and the beam behind it.
            The arrow is registered SDF, which is what makes `iconColor` (and
            with it the Settings → Map colour choice) apply to it at all — a
            plain image is drawn with its own pixels. SDF reads the alpha channel
            as a shape, so the arrow's own blue is discarded and its white edge
            comes back as `iconHaloColor` below; the beam stays a plain image,
            because its whole substance is a soft alpha gradient that a distance
            field would flatten into a hard triangle. */}
        <Images
          images={{
            "user-heading-beam": require("../../assets/user-heading.png"),
            "user-arrow": {
              source: require("../../assets/user-arrow.png"),
              sdf: true,
            },
          }}
        />

        {/* layerIndex pins z-order across remounts: a swapped basemap source
            re-adds its layer at the TOP of the stack, burying the canyon
            layers — explicit indexes (background=0, basemap band from 1,
            overlays above the band) keep the basemap underneath while canyon
            layers stay on top. The Protomaps band is ~70 layers wide, so the
            overlay base index depends on the active basemap. */}
        {basemapResolved.map((resolved) =>
          resolved.status === "ok" ? (
            <ResolvedSource key={resolved.key} resolved={resolved}>
              {resolved.sourceType === "vector" ? (
                <ProtomapsLayers
                  flavor={PROTOMAPS_FLAVOR}
                  sourceID={sourceIdFor(resolved.key)}
                  startIndex={1}
                />
              ) : (
                <RasterLayer
                  id={`basemap-layer-${resolved.key}`}
                  layerIndex={1}
                  style={{ rasterOpacity: 1 }}
                />
              )}
            </ResolvedSource>
          ) : null,
        )}

        {/* The edge of what this phone actually holds. Above the basemap band
            and below everything else, so canyon pins, tracks and imports stay
            visible over the blanked ground. */}
        {offlineMask ? (
          <ShapeSource id="offline-mask" shape={offlineMask}>
            <FillLayer
              id="offline-mask-fill"
              layerIndex={maskLayerIndex}
              style={{ fillColor: theme.primary, fillOpacity: 1 }}
            />
          </ShapeSource>
        ) : null}

        {/* Topo overlays: raster = one translucent RasterLayer; vector =
            the full contour/feature layer stack styled by the user's
            server-side vectorStyle (web parity via buildTopoVectorLayerDefs). */}
        {overlayRenderPlan.plans.flatMap(({ ref, start }) =>
          resolveMapSource(ref, ctx).map((resolved) =>
            resolved.status === "ok" ? (
              <ResolvedSource key={resolved.key} resolved={resolved}>
                {ref.format === "vector" ? (
                  <TopoVectorOverlay
                    kind={overlayKind(ref)}
                    idPrefix={`topo-${resolved.key}`}
                    sourceID={sourceIdFor(resolved.key)}
                    startIndex={start}
                    vectorStyle={vectorStyle}
                  />
                ) : (
                  <RasterLayer
                    id={`topo-layer-${resolved.key}`}
                    layerIndex={start}
                    style={{ rasterOpacity: 0.8 }}
                  />
                )}
              </ResolvedSource>
            ) : null,
          ),
        )}

        {/* GeoPDF imports (Stage 6): device-tiled MBTiles rendered through
            the resolver's local-artifact path — one translucent RasterLayer
            per ready import, above the overlay band. */}
        {readyGeoPdfImports.map((geoPdf, geoPdfPosition) =>
          resolveMapSource(
            { kind: "geopdf-import", importId: geoPdf.id },
            ctx,
          ).map((resolved) =>
            resolved.status === "ok" ? (
              <ResolvedSource key={resolved.key} resolved={resolved}>
                <RasterLayer
                  id={`geopdf-layer-${geoPdf.id}`}
                  layerIndex={overlayRenderPlan.nextIndex + geoPdfPosition}
                  style={{ rasterOpacity: geoPdf.opacity }}
                />
              </ResolvedSource>
            ) : null,
          ),
        )}

        {/* Vector imports (Stage 5): device-local GeoJSON from user files,
            pinned above the overlay band, below the canyon layers. Each
            import is one ShapeSource read straight off disk. */}
        {visibleImports.map((imported, importPosition) => {
          const base =
            overlayRenderPlan.nextIndex +
            readyGeoPdfImports.length +
            importPosition * 3;
          return (
            <ShapeSource
              key={imported.id}
              id={`import-${imported.id}`}
              url={`file://${imported.path}`}
            >
              <FillLayer
                id={`import-fill-${imported.id}`}
                layerIndex={base}
                filter={["==", "$type", "Polygon"] as never}
                style={{ fillColor: imported.color, fillOpacity: 0.2 }}
              />
              <LineLayer
                id={`import-line-${imported.id}`}
                layerIndex={base + 1}
                filter={
                  ["any", ["==", "$type", "LineString"], ["==", "$type", "Polygon"]] as never
                }
                style={{
                  lineColor: imported.color,
                  lineWidth: 3,
                  lineOpacity: 0.9,
                  lineJoin: "round",
                  lineCap: "round",
                }}
              />
              <CircleLayer
                id={`import-point-${imported.id}`}
                layerIndex={base + 2}
                filter={["==", "$type", "Point"] as never}
                style={{
                  circleRadius: 5,
                  circleColor: imported.color,
                  circleStrokeColor: "#ffffff",
                  circleStrokeWidth: 1.5,
                }}
              />
            </ShapeSource>
          );
        })}

        {/* A trip's route attachment, shown transiently. Mounted alongside the
            recorded tracks so it sits in the same band, under the canyons. */}
        {shownRoute ? (
          <RouteMapLayer
            request={shownRoute}
            onLoaded={(bbox) => {
              // Fit once per request. The layer can re-resolve its file for
              // reasons that have nothing to do with the user (a re-render, a
              // remount), and refitting then yanks the camera back mid-pan —
              // the map became impossible to explore around the route.
              if (fittedRouteNonce.current === shownRoute.nonce) return;
              fittedRouteNonce.current = shownRoute.nonce;
              fitCameraToBbox(bbox, 60);
            }}
            onFailed={(message) => {
              setShownRoute(null);
              setRouteError(message);
            }}
          />
        ) : null}

        {/* Every canyon route at once (layers sheet → Layers → Canyon routes).
            Mirror-backed, so it draws with no signal for any file this phone
            has fetched; mounted before the canyon pins so the pins stay on
            top of their own lines. */}
        {showCanyonRoutes ? <CanyonRoutesLayer onStatus={setRoutesStatus} /> : null}

        {/* Recorded tracks + waypoints (Stage 7): unpinned, mounted before
            the canyon sources so canyons draw on top. */}
        <TrackMapLayers
          tracks={tracks}
          waypoints={waypoints}
          liveCoord={userCoord}
          onWaypointPress={handleWaypointPress}
        />

        {/* Navigate-to-waypoint sight line: latest fix → target. */}
        {navTarget && userCoord ? (
          <ShapeSource
            id="nav-line"
            shape={{
              type: "Feature",
              geometry: {
                type: "LineString",
                coordinates: [userCoord, [navTarget.lon, navTarget.lat]],
              },
              properties: {},
            }}
          >
            <LineLayer
              id="nav-line-layer"
              style={{
                lineColor: "#4285F4",
                lineWidth: 2,
                lineOpacity: 0.8,
                lineDasharray: [2, 2],
              }}
            />
          </ShapeSource>
        ) : null}

        {/* Canyon overlays: authed API GeoJSON — never baked into tiles
            (privacy rule). Shared first so owned draws on top. */}
        <ShapeSource id="shared-canyons" shape={sharedFc} onPress={handleCanyonPress}>
          <CircleLayer
            id="shared-canyon-circles"
            style={{
              circleRadius: 6,
              circleColor: SHARED_CANYON_COLOR,
              circleStrokeColor: "#ffffff",
              circleStrokeWidth: 1.5,
            }}
          />
          <SymbolLayer
            id="shared-canyon-labels"
            style={{
              textField: CANYON_LABEL_EXPR as unknown as string,
              textFont: ["Noto Sans Medium"],
              textSize: 12,
              textColor: theme.textPrimary,
              textHaloColor: theme.bonus2,
              textHaloWidth: 1,
              textAnchor: "top",
              textOffset: [0, 0.8],
            }}
          />
        </ShapeSource>
        <ShapeSource id="owned-canyons" shape={ownedFc} onPress={handleCanyonPress}>
          <CircleLayer
            id="canyon-circles"
            style={{
              circleRadius: 6,
              circleColor: OWNED_CANYON_COLOR,
              circleStrokeColor: "#ffffff",
              circleStrokeWidth: 1.5,
            }}
          />
          <SymbolLayer
            id="canyon-labels"
            style={{
              textField: CANYON_LABEL_EXPR as unknown as string,
              textFont: ["Noto Sans Medium"],
              textSize: 12,
              textColor: theme.textPrimary,
              textHaloColor: theme.bonus2,
              textHaloWidth: 1,
              textAnchor: "top",
              textOffset: [0, 0.8],
            }}
          />
        </ShapeSource>

        {showRoutes ? (
          <RoutesLayer
            routes={routes.data ?? []}
            hiddenRouteId={editingRouteId}
            // While a tool is collecting points every tap belongs to the tool —
            // opening a stats sheet mid-draw would steal the point being placed.
            onPressRoute={collectingPoints ? undefined : setStatsRouteId}
          />
        ) : null}

        {/* The route being drawn — solid. */}
        {drawingRoute ? (
          <RouteDraftLayer
            idPrefix="route-draft"
            draft={routeDraft.draft ?? emptyDraft}
            dotted={false}
            {...anchorHandlers(routeDraft)}
          />
        ) : null}

        {/* The measured line — dotted, and otherwise the same tool. */}
        {measuring ? (
          <RouteDraftLayer
            idPrefix="measure-draft"
            draft={measureDraft.draft ?? emptyDraft}
            dotted
            {...anchorHandlers(measureDraft)}
          />
        ) : null}

        {/* The spot the user tapped. Deliberately NOT a waypoint pin: a
            waypoint is a thing they created and kept, this is a cursor. A small
            ringed dot reads as "here is where you pointed" and disappears the
            moment the panel is dismissed. */}
        {tappedPoint ? (
          <ShapeSource
            id="tapped-point"
            shape={{
              type: "Feature",
              geometry: {
                type: "Point",
                coordinates: [tappedPoint.longitude, tappedPoint.latitude],
              },
              properties: {},
            }}
          >
            <CircleLayer
              id="tapped-point-dot"
              style={{
                circleRadius: 5,
                circleColor: theme.accent,
                circleStrokeColor: "#ffffff",
                circleStrokeWidth: 2,
              }}
            />
          </ShapeSource>
        ) : null}

        {/* Own location marker (expo-location watcher). Unpinned ⇒ renders
            above everything, like the canyon layers. No accuracy halo: it was a
            translucent disc the size of a suburb that told the user nothing
            actionable and hid the map under itself. */}
        {userCoord ? (
          <ShapeSource
            id="user-location"
            shape={{
              type: "Feature",
              geometry: { type: "Point", coordinates: userCoord },
              properties: {},
            }}
          >
            {userHeading != null ? (
              // Direction beam under the arrow. Map-aligned, so it points at
              // real-world bearings even when the map itself is rotated.
              <SymbolLayer
                id="user-location-heading"
                style={{
                  iconImage: "user-heading-beam",
                  iconRotate: userHeading,
                  iconRotationAlignment: "map",
                  iconAllowOverlap: true,
                  iconIgnorePlacement: true,
                }}
              />
            ) : null}
            {/* An arrow, not a dot: a dot says where you are and a compass
                says which way north is, and the user is left to combine them
                while standing on a ledge. The arrow answers both at once —
                which is why the heading watcher now runs for as long as the
                marker is on screen, not only in course-up. */}
            <SymbolLayer
              id="user-location-dot"
              style={{
                iconImage: "user-arrow",
                iconSize: 0.28,
                iconRotate: userHeading ?? 0,
                iconRotationAlignment: "map",
                iconAllowOverlap: true,
                iconIgnorePlacement: true,
                // The user's colour, and a white edge under it so no choice has
                // to carry its own contrast — the arrow sits on imagery, rock
                // and water, and "white" would vanish on a limestone slab
                // without it.
                iconColor: MARKER_COLORS[markerColorId],
                // White on white is no edge at all, so the one achromatic
                // choice takes a dark one instead.
                iconHaloColor: markerColorId === "white" ? "#1A1A1A" : "#FFFFFF",
                iconHaloWidth: 1.2,
              }}
            />
          </ShapeSource>
        ) : null}
      </MapView>

      {/* Place search: collapsed button top-left, expands to a full-width bar.
          Hidden while a point-collecting tool is armed — search is not usable
          mid-draw, and its slot is where the tool's own toolbar goes, which is
          what keeps the HUD from eating a third of the map. */}
      {!collectingPoints ? (
        <MapSearchBar topInset={insets.top} onSelectPlace={handleSelectPlace} />
      ) : null}

      {/* Everything that talks to the user from the top of the map stacks in
          one column, so a second message can never land on top of the first. */}
      <View style={[styles.noticeStack, { top: noticeTop }]} pointerEvents="box-none">
        {/* The recording panel leads the stack: while a track is running it is
            the most important thing on the screen, and up here it competes
            with no other chrome (see mapChrome's CHROME_BOTTOM). */}
        {activeTrack ? <TrackRecordingControls activeTrack={activeTrack} /> : null}

        {/* Measure HUD — the same panel as route draw, minus Save. */}
        {measuring ? (
          <DraftToolPanel
            tool="measure"
            points={measureDraft.points}
            anchorCount={measureDraft.anchors.length}
            canUndo={measureDraft.canUndo}
            atCap={measureDraft.atCap}
            editingName={null}
            saving={false}
            onUndo={measureDraft.undo}
            onClear={measureDraft.clear}
            snapMode={snapMode}
            onSnapModeChange={handleSnapModeChange}
            onDiscard={measureDraft.close}
          />
        ) : null}

        {/* Route draw HUD — only while the tool is armed. */}
        {drawingRoute ? (
          <DraftToolPanel
            tool="route"
            points={routeDraft.points}
            anchorCount={routeDraft.anchors.length}
            canUndo={routeDraft.canUndo}
            atCap={routeDraft.atCap}
            editingName={
              editingRouteId
                ? (routes.data?.find((r) => r.id === editingRouteId)?.name ?? null)
                : null
            }
            saving={savingRoute}
            onUndo={routeDraft.undo}
            onClear={routeDraft.clear}
            snapMode={snapMode}
            onSnapModeChange={handleSnapModeChange}
            onSave={() => setNamingRoute(true)}
            onDiscard={() => handleCancelRouteDraw()}
          />
        ) : null}

        {/* Offline/unavailable basemap notice (fail visibly, never silently).

            Three states, and which one shows is decided by what overlaps the
            VIEWPORT, not by what the resolver managed to resolve — see
            `coverageHere`. Online it can only mean the source itself is down.

            A plain banner, not a button. It sat one tap from the layers sheet
            and the layers sheet is one tap from anywhere, so the shortcut
            bought nothing and cost the two words it took to advertise itself —
            which wrapped the banner onto a second line — plus a mystery sheet
            for anyone who brushed it while panning. */}
        {noticeText ? (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>{noticeText}</Text>
          </View>
        ) : null}

        {/* Error surfaces: background failures, non-blocking. */}
        {canyons.error ? (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>{canyons.error}</Text>
          </View>
        ) : null}

        {routeError ? (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>{routeError}</Text>
          </View>
        ) : null}

        {/* A map that quietly hides pins is a map you can't trust. Says how many
            are missing, and the dismiss IS the way out — clearing it turns the
            Canyons screen's "show only these" option back off. */}
        {withholdingCanyons ? (
          <View style={styles.filterBadge}>
            <Feather name="filter" size={14} color={theme.accent} />
            {/* Two lines: this sentence grows with the user's text size, and a
                badge that says "Showing 5 of 2…" is a warning nobody can act on. */}
            <Text style={styles.filterBadgeText} numberOfLines={2}>
              {`Showing ${mapFilter.visibleIds?.length ?? 0} of ${mapFilter.totalCount} canyons`}
            </Text>
            <IconButton
              icon="x"
              size={16}
              accessibilityLabel="Show all canyons again"
              onPress={() => setCanyonMapFilterEnabled(false)}
            />
          </View>
        ) : null}

        {/* A download keeps running while the user walks around the map, so it
            reports here rather than only on the screen that started it. */}
        {downloadJob ? (
          <View style={styles.filterBadge}>
            <Feather name="download" size={14} color={theme.accent} />
            <Text style={styles.filterBadgeText} numberOfLines={2}>
              {downloadJob.progress.tilesTotal > 0
                ? `Saving maps · ${Math.round(
                    (downloadJob.progress.tilesDone /
                      downloadJob.progress.tilesTotal) *
                      100,
                  )}%`
                : "Saving maps…"}
            </Text>
          </View>
        ) : null}

        {/* Says what is on the map that the user didn't put there, and gives
            them one tap to take it off again. */}
        {shownRoute ? (
          <View style={styles.routeBadge}>
            <Feather name="map" size={14} color={ROUTE_COLOR} />
            <Text style={styles.routeBadgeText} numberOfLines={1}>
              {shownRoute.filename}
            </Text>
            <IconButton
              icon="x"
              size={16}
              accessibilityLabel="Stop showing this route"
              onPress={() => setShownRoute(null)}
            />
          </View>
        ) : null}
      </View>

      {/* One column of actions on one edge; the OTHER edge belongs to the map's
          own instruments (native compass + compass tape + scale bar). Which is
          which is the user's (Settings → Map): the two swap as a pair, because
          the point of the setting is which side the thumb reaches, and leaving
          the instruments put would only move the buttons on top of them. */}
      <View style={[styles.controls, controlsEdge]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Choose layers"
          style={styles.controlButton}
          onPress={() => setPickerOpen(true)}
        >
          <Feather name="layers" size={FAB_ICON} color={theme.textPrimary} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={LOCATE_LABEL[followMode]}
          style={[styles.controlButton, followMode !== "off" && styles.controlActive]}
          onPress={handleLocateMe}
        >
          {/* Three states, three glyphs: an arrow you are not following, a
              crosshair locked on you, a compass rose when the map itself turns
              to face where you are looking. Colour alone said "active" but
              never said WHICH active. */}
          <Feather
            name={LOCATE_ICON[followMode]}
            size={FAB_ICON}
            color={theme.textPrimary}
            // The arrow glyph's ink sits up-and-right of its box centre, so a
            // geometrically centred icon reads off-centre — nudge it back.
            style={followMode === "off" ? styles.locateIcon : undefined}
          />
        </Pressable>
        {/* Map tools behind one button. Turning MEASURE off discards its
            points — a measurement is a question you asked once, not an asset.
            Route draw is the opposite and asks before discarding. */}
        <MapToolGroup
          side={controlsOnLeft ? "left" : "right"}
          open={toolsOpen}
          activeTool={measuring ? "measure" : drawingRoute ? "route" : null}
          onToggleOpen={() => setToolsOpen((open) => !open)}
          onPickTool={handlePickTool}
        />
        {!activeTrack ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Record track"
            style={styles.controlButton}
            onPress={handleStartRecording}
          >
            {/* Drawn rather than a Feather glyph: the icon font gives no
                control over ring thickness or a nested fill. */}
            <View style={styles.recordRing}>
              <View style={styles.recordCore} />
            </View>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Map data attribution"
          style={styles.miniButton}
          onPress={() => setAttributionOpen(true)}
        >
          <Feather name="info" size={MINI_FAB_ICON} color={theme.textPrimary} />
        </Pressable>
      </View>

      {/* The map's own instruments, stacked along the bottom edge opposite the
          buttons: which way the user is facing, then how far things are. */}
      <View style={[styles.instruments, instrumentsEdge]} pointerEvents="none">
        <CompassStrip
          heading={compassEnabled ? userHeading : null}
          width={compassWidth}
          reference={northReference}
        />
        {scaleBarEnabled ? (
          <ScaleBar
            ref={scaleBarRef}
            latitude={camera.latitude}
            zoom={camera.zoom}
            maxWidth={scaleBarMaxWidth}
          />
        ) : null}
      </View>

      {/* Navigate-to-waypoint readout: live distance + bearing from the
          latest fix. Static labels only — coordinates never rendered. */}
      {navTarget ? (
        <View style={[styles.navChip, { top: noticeTop }]}>
          {/* The distance and bearing live at the end of this line, so a
              one-line cap cuts off the half that changes. */}
          <Text style={styles.noticeText} numberOfLines={2}>
            {navTarget.name}
            {navDistanceM != null && navBearingDeg != null
              ? ` · ${formatDistanceM(navDistanceM)} · ${compassPointFor(
                  navBearingDeg,
                )} ${Math.round(navBearingDeg)}°`
              : " · waiting for GPS…"}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Stop navigating"
            onPress={() => setNavTarget(null)}
            hitSlop={8}
          >
            <Text style={styles.deleteText}>✕</Text>
          </Pressable>
        </View>
      ) : null}

      {/* Attribution is required by the providers but ate the bottom of the
          map; it now lives behind the (i) button. */}
      <BottomSheet
        visible={namingRoute}
        onClose={() => setNamingRoute(false)}
        title="Name this route"
      >
        <RouteNameForm
          initialName={
            editingRouteId
              ? (routes.data?.find((r) => r.id === editingRouteId)?.name ?? "")
              : ""
          }
          saving={savingRoute}
          onSubmit={(name) => void handleSaveRoute(name)}
        />
      </BottomSheet>

      <BottomSheet
        visible={attributionOpen}
        onClose={() => setAttributionOpen(false)}
        title="Map data"
      >
        <Text style={styles.attributionText}>
          {attributionText.length > 0
            ? attributionText
            : "No attribution reported for the active basemap."}
        </Text>
        {/* The layer picker ships a sample tile of every basemap, including the
            ones that aren't currently drawn — their licences permit that with
            credit, so the credit lives here rather than nowhere. */}
        <Text style={styles.attributionText}>{BASEMAP_THUMB_CREDIT}</Text>
      </BottomSheet>

      {/* Tap: "what's there?" — the question that comes before the long
          press's "something goes here". */}
      <MapPointSheet
        point={tappedPoint}
        userCoord={userCoord}
        onClose={() => setTappedPoint(null)}
        onNavigate={navigateToPoint}
        onDropWaypoint={dropWaypointAt}
      />

      {/* Press-and-hold: a waypoint is a scratch mark, a canyon is a record.
          The canyon form can't open from here directly — a second Modal over the
          first doesn't hold focus — so the point is parked and picked up in
          `onClosed`. */}
      <BottomSheet
        visible={longPressPoint !== null}
        onClose={() => setLongPressPoint(null)}
        onClosed={() => {
          const point = pendingCanyonPoint.current;
          if (!point) return;
          pendingCanyonPoint.current = null;
          setAddCanyonAt(point);
        }}
        title="What goes here?"
      >
        {/* The gap is the sheet-list convention (MapPointSheet, SavedScreen):
            rows flush against each other read as one slab rather than four
            targets. */}
        <View style={styles.sheetBody}>
          <Row
            icon="map-pin"
            title="Drop a waypoint"
            onPress={() => {
              const point = longPressPoint;
              setLongPressPoint(null);
              if (point) dropWaypointAt(point);
            }}
          />
          <Row
            icon="navigation"
            title="Navigate here"
            onPress={() => {
              const point = longPressPoint;
              setLongPressPoint(null);
              if (point) navigateToPoint(point);
            }}
          />
          <Row
            icon="pen-tool"
            title="Draw a route from here"
            onPress={() => {
              const point = longPressPoint;
              setLongPressPoint(null);
              if (point) startRouteDrawAt(point);
            }}
          />
          {/* MaterialCommunityIcons, as everywhere else measure appears: Feather
              has no ruler, and the near misses read as "resize" (DESIGN.md §2). */}
          <Row
            leading={<MeasureGlyph />}
            title="Measure from here"
            onPress={() => {
              const point = longPressPoint;
              setLongPressPoint(null);
              if (point) startMeasureAt(point);
            }}
          />
          <Row
            icon="plus-circle"
            title="Add a canyon"
            subtitle="With this position filled in"
            onPress={() => {
              pendingCanyonPoint.current = longPressPoint;
              setLongPressPoint(null);
            }}
          />
        </View>
      </BottomSheet>

      <CanyonEditSheet
        visible={addCanyonAt !== null}
        initialCoords={addCanyonAt}
        onClose={() => setAddCanyonAt(null)}
        onSaved={(text) => notify(text, "info")}
        onFailed={(text) => notify(text, "error")}
      />

      {/* Route sheets: stats → options → link, each opening the next and
          closing itself, so only one is ever on screen. */}
      <RouteStatsSheet
        route={statsRoute}
        visible={statsRoute !== null}
        onClose={() => setStatsRouteId(null)}
        onViewOptions={() => {
          setOptionsRouteId(statsRouteId);
          setStatsRouteId(null);
        }}
      />

      <RouteOptionsSheet
        route={optionsRoute}
        visible={optionsRoute !== null}
        onClose={() => setOptionsRouteId(null)}
        onViewStats={() => {
          setStatsRouteId(optionsRouteId);
          setOptionsRouteId(null);
        }}
        onShowOnMap={() => {
          const bbox =
            optionsRoute &&
            bboxOfPoints(optionsRoute.points.map(([lon, lat]) => ({ lon, lat })));
          setOptionsRouteId(null);
          if (bbox) fitCameraToBbox(bbox);
        }}
        onEdit={() => {
          const target = optionsRoute;
          setOptionsRouteId(null);
          if (target) openRouteForEditing(target);
        }}
        onLinkCanyon={() => {
          setLinkingRouteId(optionsRouteId);
          setOptionsRouteId(null);
        }}
        onInfo={(text) => notify(text, "info")}
        onError={(text) => notify(text, "error")}
      />

      <LinkCanyonSheet
        route={linkingRoute}
        visible={linkingRoute !== null}
        onClose={() => setLinkingRouteId(null)}
        onInfo={(text) => notify(text, "info")}
        onError={(text) => notify(text, "error")}
      />

      <Toast message={toast} onDismissed={() => setToast(null)} />

      <MapLayersSheet
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        connectivity={connectivity}
        basemapId={basemapId}
        onBasemapChange={chooseBasemap}
        artifacts={artifacts}
        overlays={overlayList}
        enabledOverlays={enabledOverlays}
        onToggleOverlay={toggleOverlay}
        mutedAreas={mutedAreas}
        onSetAreasMuted={setAreasMuted}
        geoPdfImports={geoPdfImports}
        onGeoPdfChange={(id, patch) => {
          updateGeoPdfImport(id, patch).catch(console.error);
        }}
        imports={imports}
        onImportVisibility={(id, visible) => {
          setVectorImportVisible(id, visible).catch(console.error);
        }}
        tracks={tracks}
        onTrackVisibility={(id, visible) => {
          updateTrack(id, { visible }).catch(console.error);
        }}
        showCanyonRoutes={showCanyonRoutes}
        onShowCanyonRoutesChange={setShowCanyonRoutes}
        routesStatus={routesStatus}
        canyonRouteHue={OWNED_CANYON_COLOR}
        showRoutes={showRoutes}
        onShowRoutesChange={setShowRoutes}
        routeCount={routes.data?.length ?? 0}
        offlineOnly={offlineOnly}
        onOfflineOnlyChange={setOfflineOnly}
        onSaveArea={() => {
          setPickerOpen(false);
          onSaveMapsOffline?.({
            basemapId,
            center: [camera.longitude, camera.latitude],
            zoom: camera.zoom,
          });
        }}
        onShowOnMap={(bbox) => {
          setPickerOpen(false);
          fitCameraToBbox(bbox);
        }}
        onOpenSaved={(category) => {
          setPickerOpen(false);
          onOpenSaved?.(category);
        }}
      />
    </View>
  );
}

/**
 * Name-the-route form, rendered INSIDE the sheet rather than as its own modal —
 * same reasoning as SavedScreen's RenameForm: the sheet is already open and
 * focused, so the keyboard rises with the form instead of shoving a settled
 * sheet upward a beat later.
 */
function RouteNameForm({
  initialName,
  saving,
  onSubmit,
}: {
  initialName: string;
  saving: boolean;
  onSubmit: (name: string) => void;
}) {
  const [draft, setDraft] = useState(initialName);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    // autoFocus runs before the field is attached and is unreliable here.
    // The rAF alone was not enough either: this form lives inside a Modal that
    // slides in, and a focus landed mid-animation is dropped — so the sheet
    // opened with no keyboard and the first tap went into raising it. Retry
    // once the slide is done; focusing an already-focused field is a no-op.
    // Retried rather than attempted once: the sheet is a Modal that slides in,
    // and a focus landed before its window is attached is dropped silently —
    // the sheet then opens with no keyboard and the first tap goes into raising
    // one. Keeps trying until the field reports focus, then stops.
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (inputRef.current?.isFocused() || attempts > 12) {
        clearInterval(timer);
        return;
      }
      inputRef.current?.focus();
    }, 120);
    return () => clearInterval(timer);
  }, []);

  const trimmed = draft.trim();
  const tooLong = trimmed.length > ROUTE_NAME_MAX_LENGTH;
  const commit = () => {
    if (!trimmed || tooLong || saving) return;
    onSubmit(trimmed);
  };

  return (
    <View style={styles.nameForm}>
      <TextField
        label="Name"
        value={draft}
        onChangeText={setDraft}
        inputRef={inputRef}
        returnKeyType="done"
        onSubmitEditing={commit}
        error={
          tooLong ? `Must be at most ${ROUTE_NAME_MAX_LENGTH} characters` : undefined
        }
      />
      <Button
        label={saving ? "Saving…" : "Save"}
        icon="check"
        disabled={!trimmed || tooLong || saving}
        onPress={commit}
      />
    </View>
  );
}

/**
 * The measure tool's icon in a `Row`'s identity tile. Hand-built rather than
 * passed as `Row.icon` because that prop takes a Feather name, and measure is
 * the one glyph Feather doesn't have (DESIGN.md §2 — a second family is allowed
 * only for a glyph it lacks). Mirrors `Row`'s own tile exactly.
 */
function MeasureGlyph() {
  return (
    <View style={styles.measureTile}>
      <MaterialCommunityIcons name="ruler" size={20} color={theme.accent} />
    </View>
  );
}

const styles = StyleSheet.create({
  // The field and its Save button were flush against each other, which read as
  // one control and put the button under the thumb aiming for the input.
  nameForm: { gap: spacing(2) },
  root: { flex: 1, backgroundColor: theme.primary },
  map: { flex: 1 },
  noticeStack: {
    position: "absolute",
    left: spacing(2),
    right: spacing(2),
    gap: spacing(1),
  },
  notice: {
    alignSelf: "center",
    backgroundColor: scrim.heavy,
    borderRadius: radius.md,
    paddingHorizontal: spacing(2),
    paddingVertical: spacing(1),
  },
  noticeText: { color: theme.textPrimary, fontSize: fontSize.sm },
  // Takes the slack so the dismiss sits at the pill's right edge rather than
  // floating next to the text.
  filterBadgeText: { flex: 1, color: theme.textPrimary, fontSize: fontSize.sm },
  sheetBody: { gap: spacing(1) },
  measureTile: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: withAlpha(theme.accent, 0.16),
  },
  controls: {
    position: "absolute",
    right: CHROME_GAP,
    bottom: CHROME_BOTTOM,
    gap: spacing(1),
    alignItems: "center",
  },
  controlButton: {
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    backgroundColor: theme.secondary,
    alignItems: "center",
    justifyContent: "center",
  },
  miniButton: {
    width: MINI_FAB_SIZE,
    height: MINI_FAB_SIZE,
    borderRadius: MINI_FAB_SIZE / 2,
    backgroundColor: theme.secondary,
    alignItems: "center",
    justifyContent: "center",
  },
  controlActive: { backgroundColor: theme.accent },
  locateIcon: { marginTop: 3, marginLeft: -3 },
  recordRing: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 4,
    borderColor: theme.warning,
    alignItems: "center",
    justifyContent: "center",
  },
  recordCore: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: theme.warning,
  },
  // Same pill shape as the route badge, in the accent rather than the route
  // colour — both are "something is being done to this map".
  filterBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(1),
    paddingLeft: spacing(1.5),
    paddingRight: spacing(0.5),
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: withAlpha(theme.accent, 0.5),
    backgroundColor: withAlpha(theme.primary, 0.92),
  },
  routeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(1),
    paddingLeft: spacing(1.5),
    paddingRight: spacing(0.5),
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: withAlpha(ROUTE_COLOR, 0.5),
    backgroundColor: withAlpha(theme.primary, 0.92),
  },
  routeBadgeText: {
    flex: 1,
    color: theme.textPrimary,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  instruments: {
    position: "absolute",
    left: CHROME_GAP,
    bottom: spacing(1),
    alignItems: "flex-start",
    gap: INSTRUMENT_GAP,
  },
  navChip: {
    position: "absolute",
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(1.5),
    backgroundColor: "rgba(0,0,0,0.7)",
    borderRadius: radius.md,
    paddingHorizontal: spacing(2),
    paddingVertical: spacing(1),
  },
  attributionText: {
    color: theme.textMuted,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.regular,
  },
  deleteText: { color: theme.warning, fontSize: fontSize.sm, fontWeight: "600" },
});
