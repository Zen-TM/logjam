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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
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
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import * as FileSystem from "expo-file-system";
import * as Location from "expo-location";
import {
  VECTOR_STYLE_DEFAULTS,
  compassPointFor,
  formatDistanceM,
  haversineMeters,
  initialBearingDegrees,
  messageFromError,
} from "@logjam/shared";

import { apiFetch } from "../api/apiFetch";
import { getVectorStyle, useApiQuery } from "../api/queries";
import type { TCanyon } from "../api/types";
import { useMirrorCanyons, useMirrorWaypoints } from "../sync/useSyncQueries";
import { config } from "../config";
import { fontSize, fontWeight, radius, scrim, spacing, theme, withAlpha } from "../theme";
import { MapSearchBar } from "./MapSearchBar";
import { ScaleBar, type ScaleBarHandle } from "./ScaleBar";
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
import { offlineCoverageMask } from "./offlineMask";
import { BottomSheet } from "../ui/BottomSheet";
import { IconButton } from "../ui/IconButton";
import { Row } from "../ui/Row";
import { Toast, type ToastMessage } from "../ui/Toast";
import { BASEMAP_THUMB_CREDIT } from "./BasemapThumb";
import { CanyonRoutesLayer, type CanyonRoutesStatus } from "./CanyonRoutesLayer";
import { MapLayersSheet } from "./MapLayersSheet";
import { CanyonEditSheet } from "../canyons/CanyonEditSheet";
import {
  isWithholdingCanyons,
  setCanyonMapFilterEnabled,
  useCanyonMapFilter,
} from "../canyons/canyonMapFilter";
import { updateGeoPdfImport } from "../geopdf/geoPdfImportsDb";
import { GEOPDF_ERRORS, importGeoPdfBytes } from "../geopdf/importPipeline";
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
import { createWaypointLocal, deleteWaypointLocal } from "../sync/outbox";
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

/** A bare lat/lng, as the map hands one back from a long press. */
type MapPoint = { latitude: number; longitude: number };

const CAMERA_DEFAULTS = {
  centerCoordinate: DEFAULT_CENTER,
  zoomLevel: DEFAULT_ZOOM,
};

// Bearing to 0..360 so "is the map facing north" is a single comparison.
function normalizeBearing(heading: number): number {
  if (!Number.isFinite(heading)) return 0;
  return ((heading % 360) + 360) % 360;
}

// A remount (tab switch) re-fires Linking.getInitialURL with the same intent
// URI — imports must not run twice for one "Open in Logjam".
const handledIntentUrls = new Set<string>();

type FollowMode = "off" | "follow" | "course-up";

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
  focus?: { bbox: [number, number, number, number]; nonce: number } | null;
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
  const [basemapId, setBasemapId] = useState<BasemapId>("six-topo");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [attributionOpen, setAttributionOpen] = useState(false);
  // Press-and-hold target, and the point handed to the canyon form once that
  // sheet has actually closed (never two sheets at once — DESIGN.md §6).
  const [longPressPoint, setLongPressPoint] = useState<MapPoint | null>(null);
  const [addCanyonAt, setAddCanyonAt] = useState<MapPoint | null>(null);
  const pendingCanyonPoint = useRef<MapPoint | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const toastNonce = useRef(0);
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
  const scaleBarRef = useRef<ScaleBarHandle>(null);
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
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
  useFocusEffect(
    useCallback(() => {
      listEnabledOverlayKeys()
        .then((keys) => setEnabledOverlays(new Set(keys)))
        .catch(console.error);
    }, []),
  );
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
    cameraRef.current.setCamera(stop);
  }, []);
  const fitCameraToBbox = useCallback(
    (bbox: [number, number, number, number], padding = 40) => {
      if (!cameraRef.current) return;
      const [west, south, east, north] = bbox;
      stopNeedsReset.current = true;
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
  const [userCoord, setUserCoord] = useState<[number, number] | null>(null);
  const [userHeading, setUserHeading] = useState<number | null>(null);
  // Latest fix, in a ref as well as in state: entering a follow mode has to
  // recentre NOW, from the sensor callback's own value, not on the next render.
  const latestFix = useRef<[number, number] | null>(null);
  const locationWatch = useRef<Location.LocationSubscription | null>(null);
  const headingWatch = useRef<Location.LocationSubscription | null>(null);
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
  const overlays = useApiQuery(getCompletedOverlays, "Couldn't load topo overlays.");
  // Server-side vector style (same one the web map + exports use); defaults
  // until it loads / when offline.
  const vectorStyleQuery = useApiQuery(getVectorStyle, "Couldn't load map style.");
  const vectorStyle = vectorStyleQuery.data ?? VECTOR_STYLE_DEFAULTS;

  const ctx: ResolveContext = useMemo(
    () => ({
      connectivity,
      artifacts,
      cdnBaseUrl: config.topoCdnBaseUrl,
    }),
    [connectivity, artifacts],
  );

  const basemapResolved = useMemo(
    () => resolveMapSource({ kind: "basemap", basemapId }, ctx),
    [basemapId, ctx],
  );

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
    basemapId === "protomaps"
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
    () => composeTopoOverlayRefs(mergedOverlays, enabledOverlays),
    [mergedOverlays, enabledOverlays],
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

  const handleCanyonPress = useCallback(
    (event: { features?: { properties?: Record<string, unknown> | null }[] }) => {
      const props = event.features?.[0]?.properties;
      if (props && typeof props.id === "string" && typeof props.name === "string") {
        onOpenCanyon(props.id, props.name);
      }
    },
    [onOpenCanyon],
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
  const handleMapLongPress = useCallback((feature: GeoJSON.Feature) => {
    if (feature.geometry.type !== "Point") return;
    const [lon, lat] = feature.geometry.coordinates as [number, number];
    setLongPressPoint({ latitude: lat, longitude: lon });
  }, []);

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
  // Self-contained (no shared busy/status state with the sheet or Saved's
  // import management — this is a background, no-UI-affordance import path):
  // a successful import shows itself by re-centering the map; the atypical
  // outcomes (already-imported / paused) get a one-off Alert since there's no
  // sheet status line left on this screen to carry the message.
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
          const fullB64 = await FileSystem.readAsStringAsync(url, {
            encoding: FileSystem.EncodingType.Base64,
          });
          const bytes = Uint8Array.from(atob(fullB64), (c) => c.charCodeAt(0));
          const outcome = await importGeoPdfBytes(
            "Shared map",
            bytes,
            () => {},
            { cancelled: false },
          );
          if (outcome.status === "imported" && outcome.record.bbox) {
            fitCameraToBbox(outcome.record.bbox);
          } else if (outcome.status === "existing") {
            Alert.alert("Already imported", "This GeoPDF is already in Saved.");
          } else if (outcome.status === "paused") {
            Alert.alert(
              "Import paused",
              "Finish importing this GeoPDF from the Saved tab.",
            );
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

  // "Show on map" arrival: fit the requested asset's bbox. Keyed on the nonce
  // so tapping the same asset again refocuses, and so a re-render with the
  // same params doesn't fight the user's own panning.
  useEffect(() => {
    if (!focus) return;
    fitCameraToBbox(focus.bbox);
  }, [focus?.nonce, focus, fitCameraToBbox]);

  // Live camera → the scale bar only, at gesture rate. Coordinates stay in
  // component state only — never logged (privacy rule).
  const handleRegionIsChanging = useCallback(
    (feature: {
      geometry: { coordinates: number[] };
      properties: { zoomLevel: number };
    }) => {
      scaleBarRef.current?.update(
        feature.geometry.coordinates[1],
        feature.properties.zoomLevel,
      );
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

  /** Put the latest fix back under the crosshair, at the zoom they are at. */
  const recentre = useCallback(() => {
    if (!latestFix.current) return;
    setCameraStop({ centerCoordinate: latestFix.current, animationDuration: 600 });
  }, [setCameraStop]);

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
        setFollowMode("course-up");
        lastPovBearing.current = null;
        recentre();
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
          zoomLevel: 14,
          animationDuration: 1200,
        });
      } else if (mode !== "off") {
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

    // Compass heading — which way the user is FACING. It orients the location
    // arrow and, in course-up, the whole map, so it is smoothed rather than
    // gated (see heading.ts: the old ≥3° deadband turned a wobble into a
    // staircase). trueHeading needs a location fix for declination; when it is
    // unavailable (reported as -1) resolveTrueHeading corrects the magnetic
    // reading rather than passing it off as true — everything else on this
    // screen, including the navigate-to chip, is true north.
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
  }, [recentre, setCameraStop]);

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
    [handleLocateMe],
  );

  const overlayList = mergedOverlays.jobs.flatMap((job) =>
    job.layers.map((layer) => ({
      key: `${job.jobId}/${layer.name}`,
      label: `${job.name ?? job.jobId.slice(0, 8)} — ${layer.name}`,
      jobId: job.jobId,
      layer: layer.name,
      format: layer.format,
      pmtilesUrl: layer.pmtilesUrl,
    })),
  );

  // Chrome geometry. Notices clear the search row so an expanded search bar
  // never covers them; the scale bar runs from the left edge up to the floating
  // button column on the right.
  const noticeTop = insets.top + CHROME_GAP + SEARCH_SIZE + spacing(1);
  const scaleBarMaxWidth =
    windowWidth - FAB_SIZE - CHROME_GAP * 3 - spacing(1);
  const attributionText = basemapResolved
    .map((r) => (r.status === "ok" ? r.attribution : null))
    .filter(Boolean)
    .join(" · ");

  // Hold the map until the bundled glyph/sprite install settles (first launch:
  // one-time extraction, a second or two; after that: a marker check). Mounting
  // earlier would bake the remote glyph URLs into the style and force a full
  // style rebuild when the local ones arrive.
  if (basemapAssets.localBaseUrl == null && !basemapAssets.failed) {
    return <View style={styles.root} />;
  }

  return (
    <View style={styles.root}>
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
        // Bottom-left (position 2), above the scale bar. There is still no
        // native scale bar in v10, so that one stays drawn in JS.
        compassEnabled
        compassViewPosition={2}
        compassViewMargins={{ x: CHROME_GAP, y: CHROME_BOTTOM }}
        onRegionIsChanging={handleRegionIsChanging}
        onRegionDidChange={handleRegionDidChange}
        onPress={() => setFollowMode("off")}
        onLongPress={handleMapLongPress}
      >
        <Camera
          ref={cameraRef}
          defaultSettings={CAMERA_DEFAULTS}
        />
        {/* Bundled point-feature icons for vector overlays. */}
        <TopoIconImages />
        {/* Locate-me sprites: the facing arrow, and the beam behind it. */}
        <Images
          images={{
            "user-heading-beam": require("../../assets/user-heading.png"),
            "user-arrow": require("../../assets/user-arrow.png"),
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
              }}
            />
          </ShapeSource>
        ) : null}
      </MapView>

      {/* Place search: collapsed button top-left, expands to a full-width bar. */}
      <MapSearchBar topInset={insets.top} onSelectPlace={handleSelectPlace} />

      {/* Everything that talks to the user from the top of the map stacks in
          one column, so a second message can never land on top of the first. */}
      <View style={[styles.noticeStack, { top: noticeTop }]} pointerEvents="box-none">
        {/* The recording panel leads the stack: while a track is running it is
            the most important thing on the screen, and up here it competes
            with no other chrome (see mapChrome's CHROME_BOTTOM). */}
        {activeTrack ? <TrackRecordingControls activeTrack={activeTrack} /> : null}

        {/* Offline/unavailable basemap notice (fail visibly, never silently). */}
        {basemapResolved.every((r) => r.status !== "ok") ? (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>
              {connectivity === "online"
                ? "This basemap is unavailable."
                : "Offline — no downloaded basemap for this area."}
            </Text>
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
            <Text style={styles.filterBadgeText} numberOfLines={1}>
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
            <Text style={styles.filterBadgeText} numberOfLines={1}>
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

      {/* One column of actions on the right; the left edge belongs to the map's
          own instruments (native compass + scale bar). */}
      <View style={styles.controls}>
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

      <View style={styles.scaleBarWrap}>
        <ScaleBar
          ref={scaleBarRef}
          latitude={camera.latitude}
          zoom={camera.zoom}
          maxWidth={scaleBarMaxWidth}
        />
      </View>

      {/* Navigate-to-waypoint readout: live distance + bearing from the
          latest fix. Static labels only — coordinates never rendered. */}
      {navTarget ? (
        <View style={[styles.navChip, { top: noticeTop }]}>
          <Text style={styles.noticeText} numberOfLines={1}>
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
          icon="plus-circle"
          title="Add a canyon"
          subtitle="With this position filled in"
          onPress={() => {
            pendingCanyonPoint.current = longPressPoint;
            setLongPressPoint(null);
          }}
        />
      </BottomSheet>

      <CanyonEditSheet
        visible={addCanyonAt !== null}
        initialCoords={addCanyonAt}
        onClose={() => setAddCanyonAt(null)}
        onSaved={(text) => notify(text, "info")}
        onFailed={(text) => notify(text, "error")}
      />

      <Toast message={toast} onDismissed={() => setToast(null)} />

      <MapLayersSheet
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        connectivity={connectivity}
        basemapId={basemapId}
        onBasemapChange={setBasemapId}
        artifacts={artifacts}
        overlays={overlayList}
        enabledOverlays={enabledOverlays}
        onToggleOverlay={toggleOverlay}
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

const styles = StyleSheet.create({
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
  scaleBarWrap: {
    position: "absolute",
    left: CHROME_GAP,
    bottom: spacing(1),
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
