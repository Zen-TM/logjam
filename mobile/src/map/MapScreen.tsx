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
} from "@maplibre/maplibre-react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import * as FileSystem from "expo-file-system";
import * as Location from "expo-location";
import NetInfo from "@react-native-community/netinfo";
import {
  BASEMAP_CATALOG,
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
import { ScaleBar } from "./ScaleBar";
import { RouteMapLayer, ROUTE_COLOR, type RouteRequest } from "../media/RouteMapLayer";
import {
  CHROME_GAP,
  FAB_ICON,
  FAB_SIZE,
  MINI_FAB_ICON,
  MINI_FAB_SIZE,
} from "./mapChrome";
import { BottomSheet } from "../ui/BottomSheet";
import { Card } from "../ui/Card";
import { IconButton } from "../ui/IconButton";
import { Row } from "../ui/Row";
import { SectionHeader } from "../ui/SectionHeader";
import { SegmentedControl } from "../ui/SegmentedControl";
import { StatusPill } from "../ui/StatusPill";
import { Toggle } from "../ui/Toggle";
import { updateGeoPdfImport } from "../geopdf/geoPdfImportsDb";
import { GEOPDF_ERRORS, RESIDUAL_WARN_FRACTION, importGeoPdfBytes } from "../geopdf/importPipeline";
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
import { downloadProtomapsRegion } from "../offline/regionDownloads";
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

// Blue Mountains default view (matches the app's home turf).
const DEFAULT_CENTER: [number, number] = [150.31, -33.7];
const DEFAULT_ZOOM = 9;

// Bearing to 0..360 so "is the map facing north" is a single comparison.
function normalizeBearing(heading: number): number {
  if (!Number.isFinite(heading)) return 0;
  return ((heading % 360) + 360) % 360;
}

// How far off north before the compass button appears. A degree of slop keeps
// it from flickering in on rounding noise after a reset.
const COMPASS_VISIBLE_DEG = 1;

// Web canyon colours (Map.tsx applyCanyonThemePaint fallbacks).
// GeoPDF overlay opacity presets (spec asks 0–100%; steps avoid a native
// slider dep and gesture conflicts inside the scrolling picker sheet).
const GEOPDF_OPACITY_STEPS = [0.2, 0.4, 0.6, 0.8, 1] as const;

// A remount (tab switch) re-fires Linking.getInitialURL with the same intent
// URI — imports must not run twice for one "Open in Logjam".
const handledIntentUrls = new Set<string>();

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
  focus,
  route,
}: {
  onOpenCanyon: (canyonId: string, name: string) => void;
  // Opens the Saved tab from the trimmed layer sheet's "Manage in Saved" link.
  onOpenSaved?: () => void;
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
  const [regionStatus, setRegionStatus] = useState<string | null>(null);
  // Camera readout for the JS-drawn chrome: the scale bar needs zoom+latitude,
  // the compass button needs the bearing. Fed by onRegionDidChange (fires when
  // a gesture settles), seeded with the default camera.
  const [camera, setCamera] = useState({
    zoom: DEFAULT_ZOOM,
    latitude: DEFAULT_CENTER[1],
    bearing: 0,
  });
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
  // Stage 7 follow modes: follow recenters on each fix (north-up); course-up
  // additionally rotates the map to the direction of travel. The locate
  // button cycles off → follow → course-up → off.
  const [followMode, setFollowMode] = useState<"off" | "follow" | "course-up">(
    "off",
  );
  const followModeRef = useRef(followMode);
  followModeRef.current = followMode;
  const [userCoord, setUserCoord] = useState<[number, number] | null>(null);
  const [userAccuracyM, setUserAccuracyM] = useState<number | null>(null);
  const [userHeading, setUserHeading] = useState<number | null>(null);
  const locationWatch = useRef<Location.LocationSubscription | null>(null);
  const headingWatch = useRef<Location.LocationSubscription | null>(null);
  const lastHeadingUpdate = useRef(0);
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

  // First free layerIndex above the active basemap's layer band.
  const overlayBaseIndex =
    1 +
    (basemapId === "protomaps" ? protomapsLayerCount(PROTOMAPS_FLAVOR) : 1);

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

  const ownedFc = useMemo(
    () =>
      toFeatureCollection(
        (canyons.data ?? []).filter((c) => c.syncRole === "owner"),
      ),
    [canyons.data],
  );
  const sharedFc = useMemo(
    () =>
      toFeatureCollection(
        (canyons.data ?? []).filter((c) => c.syncRole === "shared"),
      ),
    [canyons.data],
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

  // Wi-Fi-only download default (stage4a §5.6 policy, applied to both task
  // kinds): on cellular, downloads need an explicit per-download opt-in.
  const confirmCellularOk = useCallback(async (): Promise<boolean> => {
    const netState = await NetInfo.fetch();
    if (netState.type !== "cellular") return true;
    return new Promise((resolve) => {
      Alert.alert(
        "Use mobile data?",
        "You're not on Wi-Fi. Download over mobile data?",
        [
          { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
          { text: "Download", onPress: () => resolve(true) },
        ],
        { cancelable: true, onDismiss: () => resolve(false) },
      );
    });
  }, []);

  // Download the visible map area as a Protomaps offline region (stage4a
  // §7.2). The bbox goes to the API in a POST body only; see regionDownloads.
  const handleDownloadCurrentArea = useCallback(async () => {
    try {
      if (!(await confirmCellularOk())) return;
      setRegionStatus("Preparing region…");
      const bounds = await mapRef.current?.getVisibleBounds();
      if (!bounds) throw new Error("Map not ready");
      const [[neLng, neLat], [swLng, swLat]] = bounds;
      const bbox = { west: swLng, south: swLat, east: neLng, north: neLat };
      // Overlap warning: downloading an area a saved region already fully
      // covers is usually a mis-tap, not intent.
      const alreadyCovered = artifacts.some(
        (a) =>
          a.kind === "basemap-region" &&
          a.bbox != null &&
          bbox.west >= a.bbox[0] &&
          bbox.south >= a.bbox[1] &&
          bbox.east <= a.bbox[2] &&
          bbox.north <= a.bbox[3],
      );
      if (alreadyCovered) {
        const proceed = await new Promise<boolean>((resolve) => {
          Alert.alert(
            "Area already saved",
            "A saved region already covers this area. Download it again anyway?",
            [
              { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
              { text: "Download", onPress: () => resolve(true) },
            ],
            { cancelable: true, onDismiss: () => resolve(false) },
          );
        });
        if (!proceed) {
          setRegionStatus(null);
          return;
        }
      }
      await downloadProtomapsRegion(bbox, (p) =>
        setRegionStatus(
          `Downloading… ${Math.min(100, Math.round((p.bytesDone / p.bytesTotal) * 100))}%`,
        ),
      );
      setRegionStatus("Region saved for offline use.");
    } catch (err) {
      console.error(err);
      setRegionStatus(
        messageFromError(err, "Couldn't download this area. Try a smaller one."),
      );
    }
  }, [confirmCellularOk, artifacts]);

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
  const savedTracks = tracks.filter((track) => track.state === "done");
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

  const handleMapLongPress = useCallback(
    (feature: GeoJSON.Feature) => {
      if (feature.geometry.type !== "Point") return;
      const [lon, lat] = feature.geometry.coordinates as [number, number];
      Alert.alert("Drop waypoint here?", undefined, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Drop waypoint",
          onPress: () => {
            createWaypointLocal({
              name: `Waypoint ${waypoints.length + 1}`,
              latitude: lat,
              longitude: lon,
            }).catch(console.error);
          },
        },
      ]);
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
            const [west, south, east, north] = outcome.record.bbox;
            cameraRef.current?.fitBounds([east, north], [west, south], 40, 600);
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
          const [west, south, east, north] = record.bbox;
          cameraRef.current?.fitBounds([east, north], [west, south], 40, 600);
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
    [imports.length],
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
    const [west, south, east, north] = focus.bbox;
    cameraRef.current?.fitBounds([east, north], [west, south], 40, 600);
  }, [focus?.nonce, focus]);

  // Camera readout for the scale bar + compass. Coordinates stay in component
  // state only — never logged (privacy rule).
  const handleRegionDidChange = useCallback(
    (feature: {
      geometry: { coordinates: number[] };
      properties: { zoomLevel: number; heading: number };
    }) => {
      const latitude = feature.geometry.coordinates[1];
      const { zoomLevel, heading } = feature.properties;
      if (!Number.isFinite(latitude) || !Number.isFinite(zoomLevel)) return;
      setCamera({
        zoom: zoomLevel,
        latitude: latitude as number,
        bearing: normalizeBearing(heading),
      });
    },
    [],
  );

  // Compass tap: rotate back to north-up. Course-up follow would immediately
  // re-rotate on the next fix, so drop to plain follow as well.
  const handleResetNorth = useCallback(() => {
    setFollowMode((mode) => (mode === "course-up" ? "follow" : mode));
    cameraRef.current?.setCamera({ heading: 0, animationDuration: 300 });
    setCamera((prev) => ({ ...prev, bearing: 0 }));
  }, []);

  // Place search result: recentre without changing zoom intent drastically.
  const handleSelectPlace = useCallback((latitude: number, longitude: number) => {
    setFollowMode("off");
    cameraRef.current?.setCamera({
      centerCoordinate: [longitude, latitude],
      zoomLevel: 13,
      animationDuration: 800,
    });
  }, []);

  const handleLocateMe = useCallback(async () => {
    if (!(await ensureForegroundLocationPermission())) return;
    // Drive the dot from expo-location directly — MLRN's built-in
    // UserLocation engine produced no updates on-device (silent), and we
    // need expo-location's watcher for Stage 7 track recording anyway.
    if (locationWatch.current) {
      // Cycle the follow mode; the last step stops the watchers.
      if (followModeRef.current === "off") {
        setFollowMode("follow");
        return;
      }
      if (followModeRef.current === "follow") {
        setFollowMode("course-up");
        return;
      }
      locationWatch.current.remove();
      locationWatch.current = null;
      headingWatch.current?.remove();
      headingWatch.current = null;
      setUserHeading(null);
      setFollowMode("off");
      // Leave course-up's rotation behind — back to north-up.
      cameraRef.current?.setCamera({ heading: 0, animationDuration: 300 });
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
      setUserAccuracyM(position.coords.accuracy ?? null);
      const mode = followModeRef.current;
      if (fly && firstFix.current) {
        firstFix.current = false;
        cameraRef.current?.setCamera({
          centerCoordinate: coord,
          zoomLevel: 14,
          animationDuration: 1200,
        });
      } else if (mode !== "off") {
        // Course over ground comes from the fix (heading ⇒ movement
        // direction); reported as -1 when stationary — keep the rotation.
        const course = position.coords.heading;
        cameraRef.current?.setCamera({
          centerCoordinate: coord,
          animationDuration: 600,
          ...(mode === "course-up" && course != null && course >= 0
            ? { heading: course }
            : {}),
        });
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

    // Compass heading for the direction beam. The magnetometer streams
    // ~10 Hz — throttle to ≥200 ms and ≥3° so the map isn't re-rendered at
    // sensor rate. trueHeading needs a location for declination; fall back
    // to magnetic when it's unavailable (reported as -1).
    headingWatch.current = await Location.watchHeadingAsync((heading) => {
      const value =
        heading.trueHeading >= 0 ? heading.trueHeading : heading.magHeading;
      const now = Date.now();
      if (now - lastHeadingUpdate.current < 200) return;
      setUserHeading((prev) => {
        if (prev != null && Math.abs(value - prev) < 3) return prev;
        lastHeadingUpdate.current = now;
        return value;
      });
    });
  }, []);

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
  const noticeTop = insets.top + CHROME_GAP + FAB_SIZE + spacing(1);
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
        // Native ornaments off: the compass can only be pinned to one of four
        // corners and can't be restyled or stacked with our chrome, and v10
        // has no scale-bar ornament at all — both are drawn in JS instead.
        compassEnabled={false}
        onRegionDidChange={handleRegionDidChange}
        onPress={() => setFollowMode("off")}
        onLongPress={handleMapLongPress}
      >
        <Camera
          ref={cameraRef}
          defaultSettings={{ centerCoordinate: DEFAULT_CENTER, zoomLevel: DEFAULT_ZOOM }}
        />
        {/* Bundled point-feature icons for vector overlays. */}
        <TopoIconImages />
        {/* Direction beam sprite for the locate-me marker. */}
        <Images
          images={{ "user-heading-beam": require("../../assets/user-heading.png") }}
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
            onLoaded={([west, south, east, north]) =>
              cameraRef.current?.fitBounds([east, north], [west, south], 60, 600)
            }
            onFailed={(message) => {
              setShownRoute(null);
              setRouteError(message);
            }}
          />
        ) : null}

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

        {/* Own blue-dot location marker (expo-location watcher; accuracy
            halo scales with the reported radius). Unpinned ⇒ renders above
            everything, like the canyon layers. */}
        {userCoord ? (
          <ShapeSource
            id="user-location"
            shape={{
              type: "Feature",
              geometry: { type: "Point", coordinates: userCoord },
              properties: {},
            }}
          >
            <CircleLayer
              id="user-location-halo"
              style={{
                circleRadius: Math.min(40, Math.max(14, (userAccuracyM ?? 30) / 3)),
                circleColor: "#4285F4",
                circleOpacity: 0.2,
              }}
            />
            {userHeading != null ? (
              // Direction beam under the dot; rotates with the compass and
              // stays map-aligned so it points at real-world bearings even
              // when the map itself is rotated.
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
            <CircleLayer
              id="user-location-dot"
              style={{
                circleRadius: 7,
                circleColor: "#4285F4",
                circleStrokeColor: "#ffffff",
                circleStrokeWidth: 2,
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
          accessibilityLabel="Locate me"
          style={[styles.controlButton, followMode !== "off" && styles.controlActive]}
          onPress={handleLocateMe}
        >
          {/* The arrow glyph's ink sits up-and-right of its box centre, so a
              geometrically centred icon reads off-centre — nudge it back. */}
          <Feather
            name="navigation"
            size={FAB_ICON}
            color={theme.textPrimary}
            style={styles.locateIcon}
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
      </View>

      {/* Bottom-left chrome: compass (only off-north) above the attribution
          button, with the scale bar along the bottom edge. */}
      <View style={styles.leftControls}>
        {camera.bearing > COMPASS_VISIBLE_DEG &&
        camera.bearing < 360 - COMPASS_VISIBLE_DEG ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Face map north"
            style={styles.controlButton}
            onPress={handleResetNorth}
          >
            <Feather
              name="compass"
              size={FAB_ICON}
              color={theme.textPrimary}
              style={{ transform: [{ rotate: `${-camera.bearing}deg` }] }}
            />
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

      {/* Says what is on the map that the user didn't put there, and gives them
          one tap to take it off again. */}
      <View style={styles.scaleBarWrap}>
        <ScaleBar
          latitude={camera.latitude}
          zoom={camera.zoom}
          maxWidth={scaleBarMaxWidth}
        />
      </View>

      {activeTrack ? <TrackRecordingControls activeTrack={activeTrack} /> : null}

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
      </BottomSheet>

      <BottomSheet
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="Map layers"
      >
        <SectionHeader label="Basemap" />
        <SegmentedControl
          options={BASEMAP_CATALOG.map((entry) => ({
            value: entry.id as BasemapId,
            label: entry.name,
            disabled: connectivity !== "online" && !entry.offlineCapable,
          }))}
          value={basemapId}
          onChange={setBasemapId}
        />

        <SectionHeader label="Offline maps" />
        <Card style={styles.sheetRow}>
          <Text style={styles.rowLabel}>Offline maps only</Text>
          <Toggle
            value={offlineOnly}
            onValueChange={setOfflineOnly}
            accessibilityLabel="Offline maps only"
          />
        </Card>
        <Pressable
          accessibilityRole="button"
          disabled={connectivity !== "online"}
          onPress={handleDownloadCurrentArea}
          style={({ pressed }) => [styles.actionRow, pressed && styles.pressed]}
        >
          <View style={styles.actionRowInner}>
            <Feather
              name="download"
              size={16}
              color={connectivity !== "online" ? theme.textMuted : theme.accent}
            />
            <Text
              style={[
                styles.actionLabel,
                connectivity !== "online" && styles.disabledText,
              ]}
            >
              Download current area
            </Text>
          </View>
        </Pressable>
        {regionStatus ? <Text style={styles.statusText}>{regionStatus}</Text> : null}
        <Row
          title="Manage offline maps in Saved"
          subtitle="Downloads, GeoPDFs, imports, tracks"
          accessibilityLabel="Manage offline maps in Saved"
          right={<Feather name="chevron-right" size={20} color={theme.textMuted} />}
          onPress={() => {
            setPickerOpen(false);
            onOpenSaved?.();
          }}
        />

        {overlayList.length > 0 ? (
          <>
            <SectionHeader label="Topo overlays" />
            {overlayList.map((overlay) => {
              const enabled = enabledOverlays.has(overlay.key);
              const saved = artifacts.find(
                (a) => a.kind === "topo-overlay" && a.logicalKey === overlay.key,
              );
              return (
                <Card key={overlay.key} style={styles.sheetRow}>
                  <View style={styles.rowMain}>
                    <Text style={styles.rowLabel} numberOfLines={1}>
                      {overlay.label}
                    </Text>
                    {saved ? <StatusPill label="Offline" tone="accent" /> : null}
                  </View>
                  <Toggle
                    value={enabled}
                    onValueChange={() => toggleOverlay(overlay.key)}
                    accessibilityLabel={`Show ${overlay.label}`}
                  />
                </Card>
              );
            })}
          </>
        ) : null}

        <SectionHeader label="Imports" />
        {imports.map((imported) => (
          <Card key={imported.id} style={styles.sheetRow}>
            <View style={[styles.dot, { backgroundColor: imported.color }]} />
            <View style={styles.rowMain}>
              <Text style={styles.rowLabel} numberOfLines={1}>
                {imported.name}
              </Text>
            </View>
            <Toggle
              value={imported.visible}
              onValueChange={() => {
                setVectorImportVisible(imported.id, !imported.visible).catch(
                  console.error,
                );
              }}
              accessibilityLabel={`Show ${imported.name}`}
            />
          </Card>
        ))}

        {geoPdfImports.some((gp) => gp.state === "ready") ? (
          <>
            <SectionHeader label="GeoPDF maps" />
            {geoPdfImports
              .filter((gp) => gp.state === "ready")
              .map((geoPdf) => (
                <View key={geoPdf.id} style={styles.stackRow}>
                  <Card style={styles.sheetRow}>
                    <View style={styles.rowMain}>
                      <Text style={styles.rowLabel} numberOfLines={1}>
                        {geoPdf.label}
                      </Text>
                    </View>
                    <Toggle
                      value={geoPdf.visible}
                      onValueChange={() => {
                        updateGeoPdfImport(geoPdf.id, {
                          visible: !geoPdf.visible,
                        }).catch(console.error);
                      }}
                      accessibilityLabel={`Show ${geoPdf.label}`}
                    />
                  </Card>
                  {geoPdf.residualFraction != null &&
                  geoPdf.residualFraction > RESIDUAL_WARN_FRACTION ? (
                    <Text style={styles.statusText}>
                      ⚠ Georeferencing in this file is imprecise — positions may
                      be off.
                    </Text>
                  ) : null}
                  {geoPdf.visible ? (
                    <View style={styles.opacityWrap}>
                      <Text style={styles.rowSub}>Opacity</Text>
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
                        onChange={(next) => {
                          updateGeoPdfImport(geoPdf.id, {
                            opacity: Number(next),
                          }).catch(console.error);
                        }}
                      />
                    </View>
                  ) : null}
                </View>
              ))}
          </>
        ) : null}

        <SectionHeader label="Tracks" />
        {savedTracks.length === 0 ? (
          <Text style={styles.statusText}>
            Record a track with the record button on the map.
          </Text>
        ) : null}
        {savedTracks.map((track) => (
          <Card key={track.id} style={styles.sheetRow}>
            <View style={[styles.dot, { backgroundColor: track.color }]} />
            <View style={styles.rowMain}>
              <Text style={styles.rowLabel} numberOfLines={1}>
                {track.name}
              </Text>
              <Text style={styles.rowSub}>{formatDistanceM(track.distanceM)}</Text>
            </View>
            <Toggle
              value={track.visible}
              onValueChange={() => {
                updateTrack(track.id, { visible: !track.visible }).catch(
                  console.error,
                );
              }}
              accessibilityLabel={`Show ${track.name}`}
            />
          </Card>
        ))}
      </BottomSheet>
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
  controls: {
    position: "absolute",
    right: CHROME_GAP,
    bottom: CHROME_GAP + spacing(4),
    gap: spacing(1),
  },
  // Bottom-left stack sits clear of the scale bar that runs along the very
  // bottom edge.
  leftControls: {
    position: "absolute",
    left: CHROME_GAP,
    bottom: CHROME_GAP + spacing(4),
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
  // Layer-sheet rows (content lives in the shared BottomSheet). A row is a Card
  // laid out horizontally: main text block (flex) + optional pill/action + the
  // trailing Toggle.
  sheetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(1.5),
    marginTop: spacing(1),
  },
  rowMain: { flex: 1, gap: spacing(0.5) },
  rowLabel: { color: theme.textPrimary, fontSize: fontSize.base, fontWeight: "600" },
  rowSub: { color: theme.textMuted, fontSize: fontSize.xs },
  stackRow: { gap: spacing(0.5) },
  actionRow: { minHeight: 44, justifyContent: "center", marginTop: spacing(1) },
  actionRowInner: { flexDirection: "row", alignItems: "center", gap: spacing(1) },
  actionLabel: { color: theme.accent, fontSize: fontSize.base, fontWeight: "600" },
  pressed: { opacity: 0.7 },
  deleteText: { color: theme.warning, fontSize: fontSize.sm, fontWeight: "600" },
  disabledText: { color: theme.textMuted },
  statusText: { color: theme.textMuted, fontSize: fontSize.sm, marginTop: spacing(0.5) },
  dot: { width: 12, height: 12, borderRadius: 6 },
  opacityWrap: { gap: spacing(0.5) },
});
