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
  Fragment,
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  Alert,
  AppState,
  BackHandler,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type GestureResponderEvent,
  type NativeSyntheticEvent,
  type TextInput,
} from "react-native";
import {
  Camera,
  GeoJSONSource,
  Images,
  Layer,
  Map,
  type CameraStop,
  type MapRef,
  type PressEvent,
  type PressEventWithFeatures,
  type ViewStateChangeEvent,
} from "@maplibre/maplibre-react-native";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useIsFocused } from "@react-navigation/native";
import * as FileSystem from "expo-file-system/legacy";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import * as Location from "expo-location";
import { DeviceMotion, Magnetometer, type DeviceMotionMeasurement } from "expo-sensors";
import {
  DEM_ATTRIBUTION,
  TOPO_LAYERS,
  TRACK_MIME_TYPES,
  VECTOR_STYLE_DEFAULTS,
  compassPointFor,
  distinctTripTypes,
  draftAnchorIndices,
  draftPoints,
  emptyDraft,
  formatDistanceM,
  haversineMeters,
  initialBearingDegrees,
  isValidLatitude,
  isValidLongitude,
  messageFromError,
  ROUTE_NAME_MAX_LENGTH,
  nearestSegment,
  snapSegment,
  type SnapMode,
} from "@logjam/shared";

import { apiFetch } from "../api/apiFetch";
import { bboxOfPoints, type Bbox } from "../saved/bboxOfPoints";
import type { SavedItemReveal } from "../saved/SavedScreen";
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
import {
  useMirrorCanyons,
  useMirrorTrips,
  useMirrorCanyonTracks,
  useMirrorWaypoints,
  useMirrorRoutes,
} from "../sync/useSyncQueries";
import { config } from "../config";
import {
  assetHue,
  fontSize,
  fontWeight,
  radius,
  scrim,
  spacing,
  theme,
  withAlpha,
} from "../theme";
import { MapSearchBar, type SavedSearchItem } from "./MapSearchBar";
import {
  CanyonPinsLayer,
  OWNED_CANYON_COLOR,
  SHARED_CANYON_COLOR,
  toCanyonFeatureCollection,
} from "./CanyonPinsLayer";
import { SpeedElevationChip, READOUT_CHIP_HEIGHT } from "./SpeedElevationChip";
import { sampleElevations } from "../offline/demLookup";
import {
  deriveSpeedMps,
  publishLiveReadout,
  type ReadoutFix,
} from "./liveReadout";
import {
  routeActions,
  trackActions,
  vectorImportActions,
  waypointActions,
} from "../saved/assetActions";
import { ScaleBar, SCALE_BAR_HEIGHT, type ScaleBarHandle } from "./ScaleBar";
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
  HEADING_SENSOR_MS,
  HEADING_TICK_MS,
  POV_DEADBAND_DEG,
  EMPTY_FIELD_WINDOW,
  NO_COMPASS_CALIBRATION,
  addFieldSample,
  compassProbeIsUrgent,
  createHeadingFilter,
  declinationNeedsRefresh,
  deviceSampleTimeMs,
  fieldStrengthUt,
  foldCompassProbe,
  headingFromDeviceRotation,
  magneticInterference,
  publishCompassProbe,
  headingSettled,
  learnDeclination,
  noteDeclinationFix,
  useHasLiveHeading,
  useQuantisedLiveHeading,
  noteHeadingSample,
  normalizeBearing,
  povCameraCenter,
  povStopDurationMs,
  publishHeading,
  resolveTrueHeading,
  shortestAngleDelta,
  stepHeadingFilter,
  useLiveHeading,
} from "./heading";
import {
  CompassStrip,
  COMPASS_STRIP_HEIGHT,
  COMPASS_STRIP_WIDTH,
} from "./CompassStrip";
import { isCompassEnabled } from "./compassPreference";
import {
  isNorthUpLocked,
  isScaleBarEnabled,
  isSpeedElevationEnabled,
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
import { FocusPulse } from "./FocusPulse";
import { MapToolGroup, type MapTool } from "./MapToolGroup";
import { RouteDraftLayer } from "./RouteDraftLayer";
import { RoutesLayer } from "./RoutesLayer";
import type { MirrorCanyon, MirrorRoute, MirrorWaypoint } from "../sync/mirrorStore";
import { RouteOptionsSheet } from "../routes/RouteOptionsSheet";
import { BottomSheet } from "../ui/BottomSheet";
import { Button } from "../ui/Button";
import { TextField } from "../ui/TextField";
import { IconButton } from "../ui/IconButton";
import { Row } from "../ui/Row";
import { Toast, type ToastMessage } from "../ui/Toast";
import { BASEMAP_THUMB_CREDIT } from "./BasemapThumb";
import { CanyonRoutesLayer, type CanyonRoutesStatus } from "./CanyonRoutesLayer";
import { MapLayersSheet, type LayerToggleEntry } from "./MapLayersSheet";
import { waypointSymbol } from "./waypointSymbol";
import { WaypointSheet } from "./WaypointSheet";
import type { WaypointFormDraft } from "../waypoints/waypointSheetBodies";
import { takePickedPoint } from "./pickedPoint";
import { MapPointSheet, type MapPoint } from "./MapPointSheet";
import { CanyonEditSheet } from "../canyons/CanyonEditSheet";
import { fillRouteSlot } from "../canyons/fillRouteSlot";
import { routeSlotOccupant } from "../canyons/routeSlot";
import { CanyonOptionsSheet } from "../canyons/CanyonOptionsSheet";
import { TripEditSheet } from "../logs/TripEditSheet";
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
import { ImportOptionsSheet } from "../imports/ImportOptionsSheet";
import {
  classifyIncomingBytes,
  isFileIntentUrl,
  syntheticNameFor,
} from "../imports/incomingIntent";
import { useVectorImports } from "../imports/useVectorImports";
import { importVectorSource } from "../imports/vectorImports";
import { updateTrack, type Track, type Waypoint } from "../tracks/tracksDb";
import {
  createWaypointLocal,
  createRouteLocal,
  updateRouteLocal,
} from "../sync/outbox";
import {
  reconcileTrackRecording,
  refreshActiveTrackStats,
  continueTrackRecording,
  startTrackRecording,
} from "../tracks/trackRecorder";
import { TrackMapLayers } from "../tracks/TrackMapLayers";
import { TrackOptionsSheet } from "../tracks/TrackOptionsSheet";
import { confirmFinishRecording } from "../tracks/finishRecordingPrompt";
import { RecordButton } from "../tracks/RecordButton";
import { RecordingSheet } from "../tracks/RecordingSheet";
import {
  isRecordingWriteFailing,
  onTrackWriteHealthChanged,
} from "../tracks/trackWriteQueue";
import { useTracks } from "../tracks/useTracks";
import { ensureForegroundLocationPermission } from "./locationPermission";
import { listEnabledOverlayKeys, setOverlayEnabled } from "../offline/registryDb";
import {
  useRegionDownloads,
} from "../offline/regionDownloadQueue";
import { groupRegionJobs } from "../offline/regionDownloadGroups";
import { useMapArtifacts } from "../offline/useMapArtifacts";
import { useBasemapAssets } from "./basemap/basemapAssets";
import { ProtomapsLayers, protomapsLayerCount } from "./basemap/ProtomapsLayers";
import { buildShellStyle } from "./basemap/shellStyle";
import { withDefaultEasing } from "./cameraStop";
import {
  ANCHOR_DROP_SELECT_MS,
  anchorIndexAtPress,
  pressIsOnAnchor,
} from "./anchorHit";
import { degreesPerDp } from "./scaleBar";
import { stopSourcePress } from "./sourcePress";
import { useConnectivity } from "./connectivity";
import { rememberMapCamera } from "./lastCamera";
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
import {
  MAX_PINCH_ZOOM,
  useMapPinchGesture,
  type FollowMode,
} from "./useMapPinchGesture";
import {
  isDoubleTap,
  ZOOM_RAMP_MS,
  zoomRampValue,
  type TapSample,
} from "./doubleTap";
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
/** Room needed on the left of a point before its delete button fits there:
 *  the 44 dp button, its 26 dp gap and a margin off the screen edge. */
const ANCHOR_DELETE_FLIP_DP = 78;

const DEGENERATE_BBOX_DEGREES = 1e-5;
const SINGLE_POINT_ZOOM = 14;

/**
 * Frame-rate ceiling for the map.
 *
 * 60, not the display's own 120: the second 60 frames buy nothing on a map of
 * contour lines and cost the GPU the same as the first. 30 was tried and read
 * as laggy under a fast pan, which is the one moment the map has to feel
 * attached to the finger.
 *
 * This is a smoothness knob, not really a battery one. MapLibre draws only when
 * something invalidates it, so the cap does nothing at all while the map sits
 * still, and only halves the cost of the seconds in which the user is actually
 * moving it — a rounding error next to the screen being lit at all.
 */
const MAP_MAX_FPS = 60;

const CAMERA_DEFAULTS = {
  center: DEFAULT_CENTER,
  zoom: DEFAULT_ZOOM,
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

/** How near the drawn line a press-and-hold must land to insert a point, in DP. */
const LINE_GRAB_DP = 24;

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


/** Gap between the stacked instruments, and the same value their container uses. */
const INSTRUMENT_GAP = spacing(0.75);

/**
 * How long to wait for a `rotation` reading before deciding the device has no
 * rotation vector. Generous next to the ~133 ms the sensor actually reports at:
 * a false positive here costs a phone the good sensor for the rest of the
 * session, and a false negative costs a second of no compass on the handful of
 * phones without a gyroscope.
 */
const ROTATION_VECTOR_GRACE_MS = 1500;

/**
 * The compass-calibration probe: how long each one listens, and how often it
 * runs while the compass is in use.
 *
 * A PROBE RATHER THAN A WATCH, because the accuracy is only reachable through
 * `expo-location`'s heading watcher (see heading.ts) and leaving that running
 * would re-register the magnetometer for the whole session — the cost the
 * DeviceMotion swap was partly meant to avoid. Two seconds every two minutes is
 * nothing, and calibration does not degrade faster than that.
 *
 * The window takes the BEST accuracy it sees rather than the first: expo's
 * `mAccuracy` starts at 0 (`unreliable`) and is only corrected when Android
 * fires `onAccuracyChanged`, which can land after the first heading event. The
 * first sample would therefore report a false fault on a healthy compass.
 */
const COMPASS_PROBE_WINDOW_MS = 2000;
/**
 * Two cadences. The slow one is the resting cost; the urgent one applies while
 * a warning is up or being confirmed (`compassProbeIsUrgent`), so a successful
 * figure-of-eight clears the banner in seconds rather than in minutes — which
 * is the half of the timing the user actually notices.
 */
const COMPASS_PROBE_INTERVAL_MS = 120_000;
const COMPASS_PROBE_URGENT_MS = 6_000;

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

function getCompletedOverlays(): Promise<CompletedOverlaysResponse> {
  return apiFetch<CompletedOverlaysResponse>("/topo-jobs/completed-overlays");
}

/** Stable identity for the waypoints-off case: a fresh `[]` per render would
 *  re-commit every marker prop on a layer that is drawing nothing. */
const EMPTY_WAYPOINTS: Waypoint[] = [];

// Contour layers get contour styling; every other vector layer is the OSM
// features set (web parity: `id.includes("contours")`).
function overlayKind(ref: TopoOverlayRef): "contours" | "features" {
  return ref.layer === "contours" ? "contours" : "features";
}

/**
 * The user's own position marker.
 *
 * Its own memoised component, subscribed to the live heading (heading.ts)
 * rather than taking it as a prop, because it is one of exactly two things that
 * redraw at compass rate. Inside MapScreen's body a sample re-rendered the
 * whole map — see the note on `publishHeading`.
 *
 * Unpinned ⇒ renders above everything, like the canyon layers. No accuracy
 * halo: it was a translucent disc the size of a suburb that told the user
 * nothing actionable and hid the map under itself.
 */
const UserLocationMarker = memo(function UserLocationMarker({
  coord,
  markerColorId,
  lockUpright,
}: {
  coord: [number, number];
  markerColorId: MarkerColorId;
  /**
   * Course-up: draw the arrow straight up the SCREEN instead of at its bearing
   * on the map.
   *
   * In this mode the two are the same thing — the map is turned to the heading,
   * so a map-aligned arrow at that heading points up anyway — except that they
   * are driven by two different animators. The camera's rotation is a native
   * linear ramp between ticks; the icon's `iconRotate` is a discrete prop that
   * lands once per tick. The arrow therefore twitches against a map that is
   * gliding under it, which is exactly the mode in which the arrow is being
   * stared at. Pinning it to the viewport removes the disagreement rather than
   * trying to synchronise two clocks.
   */
  lockUpright: boolean;
}) {
  // Course-up draws a constant, so it must not subscribe to the VALUE — the
  // ticker publishes ~30 times a second and this component commits a
  // GeoJSONSource plus two symbol layers to MLRN on every render. Same split as
  // LiveCompassStrip below, for the same reason.
  return lockUpright ? (
    <UprightUserMarker coord={coord} markerColorId={markerColorId} />
  ) : (
    <BearingUserMarker coord={coord} markerColorId={markerColorId} />
  );
});

const UprightUserMarker = memo(function UprightUserMarker(props: UserMarkerProps) {
  // Only "is there a heading at all" can change here, which is twice a session.
  return <UserMarkerLayers {...props} heading={useHasLiveHeading() ? 0 : null} upright />;
});

const BearingUserMarker = memo(function BearingUserMarker(props: UserMarkerProps) {
  return <UserMarkerLayers {...props} heading={useLiveHeading()} upright={false} />;
});

type UserMarkerProps = { coord: [number, number]; markerColorId: MarkerColorId };

function UserMarkerLayers({
  coord,
  markerColorId,
  heading,
  upright,
}: UserMarkerProps & { heading: number | null; upright: boolean }) {
  const rotationAlignment = upright ? ("viewport" as const) : ("map" as const);
  // MLRN's GeoJSONSource JSON.stringifies `data` on every render it lets
  // through, so this must not be an object literal in the JSX.
  const shape = useMemo(
    () =>
      ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: coord },
        properties: {},
      }) as GeoJSON.Feature<GeoJSON.Point>,
    [coord],
  );
  return (
    <GeoJSONSource id="user-location" data={shape}>
      {/* An arrow, not a dot: a dot says where you are and a compass says which
          way north is, and the user is left to combine them while standing on a
          ledge. The arrow answers both at once — which is why the heading
          watcher runs for as long as the marker is on screen, not only in
          course-up. */}
      <Layer
        key="user-location-dot"
        type="symbol"
        id="user-location-dot"
        style={{
          // One baked PNG per colour (USER_MARKER_IMAGES) rather than a
          // single SDF sprite recoloured via iconColor — see that constant
          // for why.
          iconImage: `user-arrow-${markerColorId}`,
          iconSize: 0.42,
          iconRotate: heading ?? 0,
          iconRotationAlignment: rotationAlignment,
          iconAllowOverlap: true,
          iconIgnorePlacement: true,
        }}
      />
    </GeoJSONSource>
  );
}

/**
 * Locate-me sprite: one baked PNG per Settings → Map colour (MARKER_COLORS),
 * picked by `iconImage` — not a single image recoloured at runtime via SDF.
 *
 * SDF was the first approach (one image, `sdf: true`, `iconColor`/
 * `iconHaloColor` at the layer) and it rendered wrong: MapLibre's SDF path
 * expects the source alpha channel to encode a genuine distance field with a
 * broad gradient, and `user-arrow.png` was a normal icon with an ordinary
 * ~1px anti-aliased edge — fed through the SDF renderer that edge came back
 * as a ragged, semi-transparent fringe rather than a clean halo (worse at
 * the larger 0.42 iconSize than it was at 0.28). The colour set is small and
 * fixed (six entries, `mapPreferences.ts`), so baking each one — fill plus a
 * properly anti-aliased outline, generated once and committed as a PNG — is
 * both simpler and correct, at the cost of one extra registered image per
 * colour instead of one.
 *
 * Module constant + memo: as an inline object literal this re-registered
 * every image with the native map on every render of the screen.
 *
 * The `require` calls have to stay static string literals — Metro resolves
 * assets at bundle time and can't follow a templated path — so this can't be
 * built by mapping over MARKER_COLOR_ORDER; a new colour needs a line here
 * too. The `Record<...MarkerColorId>` annotation is the check that catches a
 * forgotten one: a colour missing its `user-arrow-<id>` entry fails
 * typecheck rather than falling back to nothing at runtime.
 */
const USER_MARKER_IMAGES: Record<`user-arrow-${MarkerColorId}`, { source: number }> = {
  "user-arrow-blue": { source: require("../../assets/user-arrow-blue.png") },
  "user-arrow-amber": { source: require("../../assets/user-arrow-amber.png") },
  "user-arrow-red": { source: require("../../assets/user-arrow-red.png") },
  "user-arrow-green": { source: require("../../assets/user-arrow-green.png") },
  "user-arrow-violet": { source: require("../../assets/user-arrow-violet.png") },
  "user-arrow-white": { source: require("../../assets/user-arrow-white.png") },
};

const UserMarkerImages = memo(function UserMarkerImages() {
  return <Images images={USER_MARKER_IMAGES} />;
});

/** The compass tape, on the same subscription and for the same reason. */
const SubscribedCompassStrip = memo(function SubscribedCompassStrip({
  width,
  reference,
}: {
  width: number;
  reference: NorthReference;
}) {
  const heading = useQuantisedLiveHeading();
  return <CompassStrip heading={heading} width={width} reference={reference} />;
});

/**
 * The switch sits OUTSIDE the subscription, so a tape that is turned off (the
 * default) is not re-rendered by every sample just to throw the value away.
 */
const LiveCompassStrip = memo(function LiveCompassStrip({
  enabled,
  width,
  reference,
}: {
  enabled: boolean;
  width: number;
  reference: NorthReference;
}) {
  if (!enabled) return <CompassStrip heading={null} width={width} reference={reference} />;
  return <SubscribedCompassStrip width={width} reference={reference} />;
});

export function MapScreen({
  onOpenCanyon,
  onOpenSaved,
  onSaveMapsOffline,
  onPickPoint,
  focus,
  editRoute,
  drawRouteFor,
  continueTrack,
  startRecording,
  navigateWaypoint,
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
  /**
   * Open the full-screen point picker for the waypoint form, starting on
   * `from` when the form already holds a coordinate. The answer comes back
   * through `map/pickedPoint.ts`, collected when this screen regains focus —
   * the same round trip the Saved tab's form makes.
   */
  onPickPoint: (
    from: { latitude: number; longitude: number } | null,
    /** The waypoint being moved, so the picker can leave its pin off. */
    hideWaypointId?: string,
  ) => void;
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
    /** Which saved item this is, to toggle its layer on before flying. */
    reveal?: SavedItemReveal;
  } | null;
  // "Edit points" from the Saved tab: arm the draw tool on a saved route. An
  // id only — the geometry comes from the mirror.
  editRoute?: { routeId: string; nonce: number } | null;
  // "Draw one on the map": arm the tool. From a canyon it carries that
  // canyon's id and saves into its route slot; from the Saved tab's add sheet
  // `canyonId` is null and the route belongs to nothing until the user links
  // it.
  drawRouteFor?: { canyonId: string | null; nonce: number } | null;
  // "Continue recording" from the Saved tab: pick a finished track back up. An
  // id only; the row comes from this screen's own list. It lands here rather
  // than being done on Saved because arming the recorder needs the location
  // prompt (which cannot be raised from a sheet) and because the map is what
  // has to end up in recording mode.
  continueTrack?: { trackId: string; nonce: number } | null;
  // "Record a track" from the Saved tab's add sheet. Same reasoning as
  // `continueTrack`: the prompt and the recording mode both belong here.
  startRecording?: { nonce: number } | null;
  // "Navigate to this waypoint" from the Saved tab. An id only — the point
  // comes from the mirror this screen already reads, so no coordinate travels
  // in navigation params.
  navigateWaypoint?: { waypointId: string; nonce: number } | null;
}) {
  // "Offline maps only" forces the resolver to local artifacts even with
  // signal — battery saver + predictability in the field.
  const [offlineOnly, setOfflineOnly] = useState(false);
  const connectivity = useConnectivity(offlineOnly);
  /** Mirror for `noteReadoutFix`, memoised once — see `dotWantedRef`. */
  const offlineOnlyRef = useRef(offlineOnly);
  offlineOnlyRef.current = offlineOnly;
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
  // Whether the Map (and therefore the camera) is mounted at all — the same
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
   *  apart so dropping a handle doesn't select it. */
  /** When the last real anchor DROP happened, so the select it fires can be
   *  told from a fresh tap. See `ANCHOR_DROP_SELECT_MS`. */
  const anchorDropAt = useRef(0);
  /** The anchor the user has tapped, in the ARMED tool's draft.
   *
   *  A tap on a handle picks it out and the panel grows a "Remove point"
   *  button; a tap anywhere else lets it go. One piece of state for both tools,
   *  because only one of them is ever armed. This replaced a modal confirm
   *  raised from the annotation's `onSelect`, which the user never found —
   *  selecting first is what makes the delete deliberate, so the dialog had
   *  nothing left to add. */
  const [selectedAnchor, setSelectedAnchor] = useState<number | null>(null);
  /**
   * Which side of the picked anchor its delete button sits on. Decided from
   * where the finger landed: the button goes to the LEFT of the point, except
   * near the left edge of the screen, where a left-hand button would be drawn
   * half off it. Screen x arrives in dp — MLRN divides the native press point
   * by the display density before emitting it (MLRNMapView.kt).
   */
  const [selectedAnchorSide, setSelectedAnchorSide] = useState<"left" | "right">(
    "left",
  );
  /** Below this much room on the left, the button flips to the other side:
   *  the button itself plus its gap plus a margin off the edge. */
  const anchorDeleteSideFor = useCallback(
    (screenXDp: number | null): "left" | "right" =>
      screenXDp != null && screenXDp < ANCHOR_DELETE_FLIP_DP ? "right" : "left",
    [],
  );
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
  /** A selection is an INDEX, so anything that changes how many anchors there
   *  are can slide it onto a different point — undo, clear, delete, a new tap,
   *  an insert, switching tools. Dropping it on any count change is one rule
   *  instead of six, and a drag (which never changes the count) keeps it. */
  const anchorCount = activeDraft?.anchors.length ?? 0;
  useEffect(() => {
    setSelectedAnchor(null);
  }, [anchorCount]);
  const routes = useMirrorRoutes();
  // The user's own drawn routes, on by default: they are few, they are theirs,
  // and the map is where they are for. The switch lives in the layers sheet.
  const [showRoutes, setShowRoutes] = useState(true);
  // Tracks master switch, on by default. A boolean (not derived from the track
  // rows' `visible`) so it toggles smoothly and stays toggleable with zero
  // tracks — the layer sheet's Tracks switch drives this directly.
  const [showTracks, setShowTracks] = useState(true);
  // Tapping a route opens its OPTIONS — the same panel Saved's ⋯ opens, with
  // the stats a sub-mode one row in (DESIGN.md §7: the same object offers the
  // same panel wherever it is tapped). Two sheets, one at a time, each holding
  // the id rather than the row — the row comes from the mirror so it stays
  // current if a sync lands while a sheet is open.
  const [optionsRouteId, setOptionsRouteId] = useState<string | null>(null);
  // Set when the draw was started from a canyon page; consumed by the save.
  const [draftCanyonId, setDraftCanyonId] = useState<string | null>(null);
  /** The colour the draft will SAVE with, picked in the tool panel.
   *
   *  Null means "not chosen in this session", which is why the save writes the
   *  field only when it is set: a draft restored after the app was killed comes
   *  back with an `editingRouteId` and no colour, and writing null there would
   *  quietly strip the colour off the route being edited. The palette can only
   *  set a colour, never clear one, so nothing is lost by the gate. */
  const [draftColor, setDraftColor] = useState<string | null>(null);
  // "Canyon routes" layer (web parity), off by default: it is a lot of ink to
  // add to a map unasked, and the layers sheet is where it belongs.
  const [showCanyonRoutes, setShowCanyonRoutes] = useState(false);
  // The rest of the layer masters. Every kind drawn over the basemap now has
  // one, INCLUDING the three that never had a switch at all (own canyons,
  // shared canyons, waypoints) — a map you cannot take the pins off is a map
  // that cannot be read at a canyon's entrance, where they all overlap.
  //
  // Booleans in this screen's state, deliberately, and not derived from the
  // items' own `visible` columns: a master has to toggle with zero items behind
  // it (the layers tab lists every kind whether or not the phone holds any),
  // and a switch whose value comes back from an async DB write lags the thumb.
  // The per-item columns still exist and are still ANDed in below — they are
  // written from Saved now rather than from the map.
  const [showOwnedCanyons, setShowOwnedCanyons] = useState(true);
  const [showSharedCanyons, setShowSharedCanyons] = useState(true);
  const [showWaypoints, setShowWaypoints] = useState(true);
  const [showGeoPdfs, setShowGeoPdfs] = useState(true);
  const [showVectorImports, setShowVectorImports] = useState(true);
  const [showOverlays, setShowOverlays] = useState(true);
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
  // Hand the settled camera to the module store the offline-download screen
  // reads, so it opens on this ground whether it was reached from here or from
  // the Saved tab (which has no camera of its own). Memory only — see
  // lastCamera.ts.
  useEffect(() => {
    rememberMapCamera({
      center: [camera.longitude, camera.latitude],
      zoom: camera.zoom,
      basemapId,
    });
  }, [camera, basemapId]);
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
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  /**
   * How tall the map is, for course-up's forward camera offset. The window,
   * not a measured view: the Map is the whole screen behind the chrome, and
   * a ref rather than a dep so `setCameraStop` stays stable.
   */
  const mapHeight = useRef(windowHeight);
  mapHeight.current = windowHeight;
  // What new segments follow. Device-scoped and persisted, read once so the
  // tool is armed correctly on its first frame.
  const [snapMode, setSnapMode] = useState<SnapMode>(readSnapMode);
  const handleSnapModeChange = useCallback((mode: SnapMode) => {
    setSnapMode(mode);
    // Best-effort: a device that refuses to store the preference still gets
    // the behaviour for this session.
    writeSnapMode(mode);
  }, []);
  const mapRef = useRef<MapRef>(null);
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
  const [speedElevationEnabled, setSpeedElevationEnabled] = useState(
    isSpeedElevationEnabled,
  );
  /** Mirror for `noteReadoutFix`, memoised once — see `dotWantedRef`. */
  const speedElevationEnabledRef = useRef(speedElevationEnabled);
  speedElevationEnabledRef.current = speedElevationEnabled;
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
      setSpeedElevationEnabled(isSpeedElevationEnabled());
      // Back from the point picker. `takePickedPoint` consumes the value, so a
      // later ordinary return to the map cannot re-apply a coordinate that has
      // since been typed over. The sheet reopens by itself: `openWaypoint` was
      // left standing, only hidden.
      if (waypointPickerAwayRef.current) {
        setWaypointPickerAway(false);
        const point = takePickedPoint();
        if (point) setWaypointPicked(point);
      }
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
    if (typeof stop.zoom === "number") zoomRef.current = stop.zoom;
    if (typeof stop.bearing === "number") headingRef.current = stop.bearing;
    // Restores MLRN 10's implicit ease, which MLRN 11 turned into a jump —
    // applied here rather than at ~15 call sites. See `cameraStop.ts`.
    const eased = withDefaultEasing(stop);
    // Nothing on this screen writes a bounds stop (`fitCameraToBbox` calls
    // fitBounds directly), but CameraStop covers both shapes, so the centre
    // has to be narrowed out of the union before it can be read.
    // Course-up puts the user three quarters of the way down the screen, by
    // looking at a point AHEAD of them rather than at them (heading.ts,
    // POV_USER_SCREEN_FRACTION). Applied here so it covers every stop that
    // carries a target — the rotation ticker's, the fix recentre, a pinch frame
    // — and, more to the point, so leaving the mode un-does it everywhere at
    // once. MapLibre's camera padding would have been the obvious tool and is
    // not usable: Android only applies it on a stop that has a target, so it
    // survives the ones that don't and the map stays offset after course-up.
    const target = "center" in eased ? eased.center : undefined;
    void cameraRef.current.setStop(
      followModeRef.current === "course-up" && target
        ? ({
            ...eased,
            center: povCameraCenter(
              target as [number, number],
              eased.bearing ?? headingRef.current,
              eased.zoom ?? zoomRef.current,
              mapHeight.current,
            ),
          } as CameraStop)
        : eased,
    );
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
        void cameraRef.current.setStop({
          center: [(west + east) / 2, (south + north) / 2],
          zoom: SINGLE_POINT_ZOOM,
          duration: 600,
          // Explicit for the same reason as `setCameraStop`'s default: this
          // call bypasses that helper, and an omitted easing is a jump.
          easing: "ease",
        });
        return;
      }
      // Bounds are west, south, east, north (GeoJSON order) in MLRN 11 — the
      // same numbers this function already takes as its bbox.
      cameraRef.current.fitBounds(bbox, {
        padding: { top: padding, right: padding, bottom: padding, left: padding },
        duration: 600,
      });
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
  const [userCoord, setUserCoord] = useState<[number, number] | null>(null);
  // The heading itself is NOT state here: it is published to heading.ts and
  // read by the two components that draw it (see `publishHeading`). Keeping it
  // in this screen's state re-rendered the whole map on every compass sample.
  // Latest fix, in a ref as well as in state: entering a follow mode has to
  // recentre NOW, from the sensor callback's own value, not on the next render.
  const latestFix = useRef<[number, number] | null>(null);
  // The heading chase (heading.ts). Samples go in from the sensor callback, the
  // display comes out of a fixed-rate ticker; both live in refs because both
  // run outside React's render cycle.
  const headingFilter = useRef(createHeadingFilter());
  const headingTicker = useRef<ReturnType<typeof setInterval> | null>(null);
  /** The double-tap-to-zoom ramp (see `zoomRampValue`) — a short-lived
   *  requestAnimationFrame loop, one-shot per double tap. A FRAME loop rather
   *  than an interval because the ramp jumps the camera per frame instead of
   *  animating it (see `startZoomRamp`), so the display's clock is the one that
   *  matters. */
  const zoomRampFrame = useRef<number | null>(null);
  const lastPovBearing = useRef<number | null>(null);
  /** When the last course-up camera stop was written, for its duration. */
  const lastPovWriteAt = useRef(0);
  // False, now that the marker is on from the start: a true here would fly the
  // camera to FOLLOW_ZOOM on the first fix of every launch, yanking a map the
  // user never asked to be moved. Nothing is lost — the locate button reaches
  // `recentre`, which already carries FOLLOW_ZOOM, so asking to be taken to
  // yourself still zooms.
  //
  // ponytail: with `dotWanted` never false, this ref and the tail of
  // `handleLocateMe` that sets it are unreachable, as is `applyFix`'s
  // `!dotWantedRef.current` guard and the `dotWanted &&` in the marker's JSX.
  // Left in place deliberately rather than unpicked in the same commit that
  // changed the behaviour; collapse them once this has been in the field.
  const firstFix = useRef(false);

  // Unmount teardown for the sensors is the effects' own cleanup below. It used
  // to be a screen-level effect plus an `unmounted` flag checked at every
  // assignment, because both subscriptions are assigned from an `await` and one
  // resolving after teardown is a sensor held for the life of the process
  // (MLIFE-007). Each effect now carries that guard itself, for its own
  // teardown — which is a blur or a background as well as an unmount.

  // Canyon overlay reads the offline mirror (Stage 8): instant, and the map
  // keeps its pins in airplane mode.
  const canyons = useMirrorCanyons();
  // Every canyon route ATTACHMENT on the account. Read here rather than beside
  // its tally below, because the route tool's save consults it to see what it
  // would displace (routeSlot.ts) and that runs earlier in this component.
  const { data: canyonTrackMedia } = useMirrorCanyonTracks(TRACK_MIME_TYPES);
  // Only for the trip form a canyon pin can open — the type vocabulary is the
  // user's own history, and a form that offered fewer types here than on the
  // Logs tab would be the same drift this sheet exists to remove.
  const trips = useMirrorTrips();
  const tripTypes = useMemo(
    () => distinctTripTypes(trips.data ?? []),
    [trips.data],
  );
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
      // applied after the "what" (topoAreaMuting.ts). The kind's own master is
      // a third gate ON TOP of both, so switching the band off and on again
      // brings back exactly the layer/area picks that were showing.
      showOverlays
        ? composeTopoOverlayRefs(mergedOverlays, enabledOverlays).filter(
            (ref) => !mutedAreas.has(ref.jobId),
          )
        : [],
    [mergedOverlays, enabledOverlays, mutedAreas, showOverlays],
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

  const ownedCanyons = useMemo(
    () => (canyons.data ?? []).filter((c) => c.syncRole === "owner"),
    [canyons.data],
  );
  const sharedCanyons = useMemo(
    () => (canyons.data ?? []).filter((c) => c.syncRole === "shared"),
    [canyons.data],
  );
  // The layer master and the Canyons screen's filter are separate gates and
  // stay separate: the filter is "these particular canyons", the switch is
  // "canyons at all", and folding one into the other would have turning the
  // pins back on silently discard a filter the user set on another screen.
  const ownedFc = useMemo(
    () =>
      toCanyonFeatureCollection(
        showOwnedCanyons
          ? ownedCanyons.filter(
              (c) => allowedCanyonIds === null || allowedCanyonIds.has(c.id),
            )
          : [],
      ),
    [allowedCanyonIds, ownedCanyons, showOwnedCanyons],
  );
  const sharedFc = useMemo(
    () =>
      toCanyonFeatureCollection(
        showSharedCanyons
          ? sharedCanyons.filter(
              (c) => allowedCanyonIds === null || allowedCanyonIds.has(c.id),
            )
          : [],
      ),
    [allowedCanyonIds, sharedCanyons, showSharedCanyons],
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

  /** Drag and tap wiring for one draft's handles.
   *
   *  The drag PREVIEWS on every frame (so the line follows the finger) and
   *  COMMITS once on the drop — one undo step per gesture, one persisted write,
   *  and one round of snapping rather than one per frame. */
  const anchorHandlers = useCallback(
    (handle: RouteDraftHandle) => ({
      onAnchorDrag: (index: number, point: [number, number]) => {
        handle.previewAnchorAt(index, point);
      },
      onAnchorDragEnd: (index: number, point: [number, number]) => {
        handle.moveAnchorAt(index, point);
        snapAroundAnchor(handle, index, point);
        // The drop also fires a press; this keeps it from picking the handle
        // straight back up. A WINDOW, not a flag: the flag this replaces was
        // only ever cleared by the next press, so a drop that produced none
        // left it armed and swallowed the user's next real tap.
        anchorDropAt.current = Date.now();
      },
      // The main way an anchor gets selected — a tap INSIDE the 34 dp handle
      // never reaches the map at all (the annotation consumes it), so the map's
      // own hit test only covers the ring outside it. Whichever fires, the same
      // index ends up selected.
      onAnchorPress: (index: number, screenXDp: number | null) => {
        if (Date.now() - anchorDropAt.current < ANCHOR_DROP_SELECT_MS) return;
        setSelectedAnchor(index);
        setSelectedAnchorSide(anchorDeleteSideFor(screenXDp));
      },
    }),
    [anchorDeleteSideFor, snapAroundAnchor],
  );

  /** Delete the picked point, from the panel's "Remove point". No confirm: the
   *  selection is the deliberate step the old modal stood in for, and Undo
   *  takes it back. */
  const removeSelectedAnchor = useCallback(() => {
    if (selectedAnchor === null || !activeDraft) return;
    activeDraft.deleteAnchorAt(selectedAnchor);
    setSelectedAnchor(null);
  }, [activeDraft, selectedAnchor]);

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
        setDraftColor(null);
        if (typeof then === "function") then();
      };
      if (routeDraft.points.length === 0) {
        discard();
        return;
      }
      // TWO cases, and the wrong sentence is a lie in one of them. Drawing a
      // new route, the points ARE what is lost. Editing a saved one, they are
      // not: the stored route is untouched until Save, so the honest promise is
      // that it stays as it was — "the points you placed will be lost" reads as
      // if the route itself is going.
      if (editingRouteId) {
        Alert.alert("Discard changes?", "The saved route is left as it was.", [
          { text: "Keep editing", style: "cancel" },
          { text: "Discard changes", style: "destructive", onPress: discard },
        ]);
        return;
      }
      Alert.alert("Discard this route?", "The points you placed will be lost.", [
        { text: "Keep drawing", style: "cancel" },
        { text: "Discard", style: "destructive", onPress: discard },
      ]);
    },
    [editingRouteId, routeDraft],
  );

  /** Clear confirms for the ROUTE tool, and only there.
   *
   *  Clear empties minutes of drawing from a button one thumb-width from Undo,
   *  and a fat finger is not a decision. Measure's Clear stays immediate — the
   *  panel's own header says why: a measurement is a question asked once, and a
   *  confirm on it is friction for nothing. An empty draft has nothing to lose,
   *  so it just clears (the button is disabled there anyway). */
  const handleClearRouteDraw = useCallback(() => {
    if (routeDraft.points.length === 0) {
      routeDraft.clear();
      return;
    }
    Alert.alert(
      "Clear all points?",
      "The line is emptied and the tool stays open. Undo brings the points back.",
      [
        { text: "Keep the points", style: "cancel" },
        { text: "Clear points", style: "destructive", onPress: routeDraft.clear },
      ],
    );
  }, [routeDraft]);

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
          await updateRouteLocal(editingRouteId, {
            name,
            points,
            anchors,
            ...(draftColor ? { color: draftColor } : {}),
          });
        } else if (draftCanyonId) {
          // Drawn INTO a canyon's route slot, which may have filled since the
          // pen was armed (from another device, or from the canyon screen).
          // The confirm and the swap order are routeSlot.ts's, exactly as they
          // are for the four sources that write immediately — this one just
          // asks at the moment it finally writes.
          const filled = await fillRouteSlot({
            canyonName:
              canyons.data?.find((canyon) => canyon.id === draftCanyonId)?.name ??
              "This canyon",
            source: "draw",
            occupant: routeSlotOccupant(
              draftCanyonId,
              routes.data ?? [],
              canyonTrackMedia ?? [],
            ),
            write: () =>
              createRouteLocal({
                name,
                points,
                anchors,
                ...(draftColor ? { color: draftColor } : {}),
                canyonId: draftCanyonId,
              }),
          });
          // Cancelled the displacement confirm: the draft stays exactly as it
          // was, so the user can pick a different name or back out themselves.
          if (!filled) return;
        } else {
          await createRouteLocal({
            name,
            points,
            anchors,
            ...(draftColor ? { color: draftColor } : {}),
          });
        }
        setNamingRoute(false);
        routeDraft.close();
        setEditingRouteId(null);
        setDraftCanyonId(null);
        setDraftColor(null);
      } catch (err) {
        console.error(err);
        Alert.alert("Route error", "Couldn't save that route.");
      } finally {
        setSavingRoute(false);
      }
    },
    [
      canyonTrackMedia,
      canyons.data,
      draftCanyonId,
      draftColor,
      editingRouteId,
      routeDraft,
      routes.data,
    ],
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
      // Tolerance in degrees, derived from the current zoom so the reach feels
      // the same however far in you are. `degreesPerDp` owns the conversion —
      // this used to inline a 256-based world size AND divide by the display
      // density, which made every reach here roughly three quarters of what it
      // said (see scaleBar.ts).
      const perDp = degreesPerDp(camera.zoom);
      // A press-and-hold ON an anchor is the start of a DRAG, and MLRN 11
      // delivers it here as well as to the annotation (see anchorHit.ts).
      // Consume it: returning true stops the long-press falling through to the
      // waypoint/navigate/route actions as well as skipping the insert.
      if (pressIsOnAnchor(activeDraft.draft.anchors, [lon, lat], perDp)) {
        return true;
      }
      const near = nearestSegment(activeDraft.draft, [lon, lat]);
      if (!near) return false;
      if (near.distanceDegrees > perDp * LINE_GRAB_DP) return false;
      activeDraft.insertAnchorAt(near.index, [lon, lat]);
      return true;
    },
    [activeDraft, camera.zoom],
  );

  /** Which anchor of the armed draft a press landed on, if any. Shares the
   *  zoom-derived tolerance with `insertAnchorNear` — the reach has to feel the
   *  same whichever gesture is asking. */
  const pressedAnchorIndex = useCallback(
    (lon: number, lat: number): number | null => {
      if (!activeDraft?.draft) return null;
      return anchorIndexAtPress(
        activeDraft.draft.anchors,
        [lon, lat],
        degreesPerDp(camera.zoom),
      );
    },
    [activeDraft, camera.zoom],
  );

  const lastTap = useRef<TapSample | null>(null);
  /** Set when the SECOND tap of a double tap is still to arrive at
   *  `handleMapPress` — see the retroactive dismissal below. */
  const swallowNextPress = useRef(false);

  const handleMapPress = useCallback(
    (event: NativeSyntheticEvent<PressEvent>) => {
      const [lon, lat] = event.nativeEvent.lngLat;
      // The second tap of a double tap already did its work (it zoomed); it
      // must not also ask what is under the finger. Cleared here rather than on
      // a timer, so exactly one press is swallowed however long MapLibre takes
      // to deliver it.
      if (swallowNextPress.current) {
        swallowNextPress.current = false;
        return;
      }
      // A tool armed owns every tap; nothing else on this handler runs.
      if (collectingPoints) {
        // A tap that lands ON an existing anchor SELECTS it rather than
        // appending — it used to stack a duplicate vertex straight on top of
        // the handle the user was aiming at. The hit test is the map's own,
        // not the annotation's `onSelect`, so the selection does not depend on
        // that callback firing (see anchorHit.ts).
        const hit = pressedAnchorIndex(lon, lat);
        if (hit !== null) {
          setSelectedAnchor(hit);
          setSelectedAnchorSide(anchorDeleteSideFor(event.nativeEvent.point?.[0] ?? null));
          return;
        }
        setSelectedAnchor(null);
        void addToolPoint(lon, lat);
        return;
      }
      // A tap is not a pan, so it no longer stops follow mode. It used to,
      // which meant looking at anything cost you the lock — and now that a tap
      // opens the point panel, "what is that spot" would end with the map no
      // longer following you.
      setTappedPoint({ latitude: lat, longitude: lon });
    },
    [addToolPoint, anchorDeleteSideFor, collectingPoints, pressedAnchorIndex],
  );

  const handleCanyonPress = useCallback(
    (event: NativeSyntheticEvent<PressEventWithFeatures>) => {
      stopSourcePress(event);
      // The pin no longer swallows the press for us (MLRN 11 bubbles it), so
      // while a point-collecting tool is armed this has to place the point
      // itself — otherwise tapping near a canyon does nothing and reads as
      // broken.
      if (collectingPoints) {
        const [lon, lat] = event.nativeEvent.lngLat;
        void addToolPoint(lon, lat);
        return;
      }
      const props = event.nativeEvent.features[0]?.properties;
      // The OPTIONS sheet, not the detail screen: the same six verbs the
      // Canyons list offers, with "Open canyon" first because that is what this
      // tap used to do (DESIGN.md §7). Held as an id so an edit made from
      // inside the sheet re-renders it rather than showing a stale copy.
      if (props && typeof props.id === "string") setOptionsCanyonId(props.id);
    },
    [addToolPoint, collectingPoints],
  );

  /** One canyon's verbs, from its pin. */
  const [optionsCanyonId, setOptionsCanyonId] = useState<string | null>(null);
  const optionsCanyon =
    (canyons.data ?? []).find((row) => row.id === optionsCanyonId) ?? null;
  /** The two verbs that need a FORM. Each is a sheet of its own, so the
   *  options sheet closes before one opens (DESIGN.md §6). */
  const [editingCanyon, setEditingCanyon] = useState<MirrorCanyon | null>(null);
  const [loggingCanyon, setLoggingCanyon] = useState<MirrorCanyon | null>(null);

  /** A recorded line's own verbs, from the map (DESIGN.md §7: the same object
   *  wherever it is listed) — what a TAP on the line opens, with the stats a
   *  sub-mode one row in. Held as an id, so an edit made inside the sheet
   *  re-renders it rather than showing the copy the line was tapped with. */
  const [optionsTrackId, setOptionsTrackId] = useState<string | null>(null);
  const [recordingSheetOpen, setRecordingSheetOpen] = useState(false);
  const handleTrackPress = useCallback(
    (track: Track, coordinates?: { latitude: number; longitude: number }) => {
      // Same rule as a canyon pin: the line swallows the press before the map
      // sees it, so while a tool is collecting points it has to place the point
      // itself — otherwise tapping near a track does nothing and reads as
      // broken.
      if (collectingPoints) {
        if (coordinates) {
          void addToolPoint(coordinates.longitude, coordinates.latitude);
        }
        return;
      }
      setOptionsTrackId(track.id);
    },
    [addToolPoint, collectingPoints],
  );

  /**
   * Stop the double-tap zoom ramp, if one is running. Idempotent — called on
   * every new double tap (supersede) as well as from the cleanup effect below
   * (mode change / focus loss), so it must be safe to call with nothing to
   * cancel.
   */
  const cancelZoomRamp = useCallback(() => {
    if (zoomRampFrame.current == null) return;
    cancelAnimationFrame(zoomRampFrame.current);
    zoomRampFrame.current = null;
  }, []);

  /**
   * Drive the zoom from `zoomRef.current` to `targetZoom` in short linear
   * ticks instead of one animated `setCameraStop` — see `zoomRampValue` in
   * doubleTap.ts for why one stop visibly slides the marker in course-up.
   * Every tick re-reads `latestFix.current`, so a fix landing mid-ramp is
   * folded in rather than fought.
   */
  const startZoomRamp = useCallback(
    (targetZoom: number) => {
      cancelZoomRamp();
      const startZoom = zoomRef.current;
      const startedAt = Date.now();
      const writeFrame = () => {
        const now = Date.now();
        const elapsed = now - startedAt;
        const zoom = zoomRampValue(startZoom, targetZoom, elapsed, ZOOM_RAMP_MS);
        if (latestFix.current) {
          // ONE CAMERA WRITER AT A TIME. `tickHeading` stands down for the
          // length of the ramp (see there), so this stop carries the BEARING as
          // well as the centre and the zoom.
          const bearing =
            followModeRef.current === "course-up" ? headingFilter.current.value : null;
          // DURATION 0 — A JUMP PER FRAME, exactly like the pinch
          // (`useMapPinchGesture`), and for the same reason. An ANIMATED stop
          // per tick is what made this jitter: a stop does not blend into the
          // one in flight, it calls `cancelTransitions()` and starts a fresh
          // ease from wherever the last one had reached, so a stream of them is
          // a restart every tick — the map alternately eases and is yanked,
          // which reads exactly as the two-mechanisms-fighting it was. With no
          // animation there is nothing to cancel: each frame simply IS the
          // camera, the pinch's proven-smooth shape for the same job.
          setCameraStop({
            center: latestFix.current,
            zoom,
            ...(bearing != null ? { bearing: normalizeBearing(bearing) } : {}),
            duration: 0,
          });
          if (bearing != null) {
            lastPovBearing.current = bearing;
            lastPovWriteAt.current = now;
          }
        }
        if (elapsed >= ZOOM_RAMP_MS) {
          cancelZoomRamp();
          return;
        }
        // Driven by the display's own clock rather than a timer: with a jump
        // per frame the frame RATE is the smoothness, and a setInterval slower
        // than the display quantises the zoom into visible steps.
        zoomRampFrame.current = requestAnimationFrame(writeFrame);
      };
      writeFrame();
    },
    [cancelZoomRamp, latestFix, setCameraStop, zoomRef],
  );

  /**
   * DOUBLE-TAP TO ZOOM, WHILE FOLLOWING — the gesture MapLibre lost when this
   * screen took its zoom away.
   *
   * `touchZoom` is false for the whole of follow mode (the pinch is ours; two
   * drivers on the same two fingers is what used to shake follow loose), and
   * double-tap is one of MapLibre's zoom gestures rather than a separate press
   * handler — so it went with it, and the only way to zoom in without a second
   * finger was to leave the mode. Recognised here instead, from the same
   * capture-phase touch stream the pan detector uses: this claims nothing (the
   * capture handler still returns `observeTouches`' answer, so MapLibre's own
   * gestures are untouched) and it drops no follow mode — a double tap is not
   * a pan, exactly as a single tap is not.
   *
   * Off while a point-collecting tool is armed: two taps there are two points,
   * and the tool owns every tap on the map (see `handleMapPress`).
   */
  const observeDoubleTap = useCallback(
    (event: GestureResponderEvent) => {
      const { touches } = event.nativeEvent;
      // A pinch is not two taps, and the tail of one must not become the first
      // half of the next: only a lone finger landing starts or completes this.
      if (touches.length !== 1) {
        lastTap.current = null;
        return;
      }
      const [only] = touches;
      const tap: TapSample = {
        x: only.pageX,
        y: only.pageY,
        timeMs: Date.now(),
      };
      if (
        followModeRef.current === "off" ||
        collectingPoints ||
        !latestFix.current
      ) {
        lastTap.current = tap;
        return;
      }
      if (!isDoubleTap(lastTap.current, tap)) {
        lastTap.current = tap;
        return;
      }
      // A third tap must start a fresh pair, not extend this one.
      lastTap.current = null;
      // The first tap already opened the point sheet (a tap-up fires
      // `onPress` well inside the 300 ms window), so the double tap has to
      // take it back — the alternative, holding every single tap for 300 ms to
      // see whether a second arrives, puts a visible lag on the commonest
      // gesture on the screen to pay for the rarer one. The sheet closes with
      // its own animation, which is what the user reads as "no, the other
      // thing".
      setTappedPoint(null);
      swallowNextPress.current = true;
      // One level, about the followed position — ramped rather than a single
      // animated stop (see `startZoomRamp`), which is what keeps the marker
      // still in course-up while the zoom changes.
      startZoomRamp(Math.min(MAX_PINCH_ZOOM, zoomRef.current + 1));
    },
    [collectingPoints, followModeRef, latestFix, startZoomRamp, zoomRef],
  );

  // Stage 4b topo overlays + Stage 5 vector-import file management (save
  // offline / import file / delete) relocated to SavedScreen — viewport-
  // independent asset management. This screen keeps only the per-asset
  // visibility toggles (registry/hooks below feed both screens).
  const { imports } = useVectorImports();
  const visibleImports = showVectorImports
    ? imports.filter((imported) => imported.visible)
    : [];

  // Stage 6: GeoPDF imports. Import/resume/account-import/delete relocated
  // to SavedScreen (viewport-independent management); this screen keeps only
  // the ready layers it renders.
  const { geoPdfImports } = useGeoPdfImports();
  const readyGeoPdfs = geoPdfImports.filter((gp) => gp.state === "ready");
  const readyGeoPdfImports = showGeoPdfs
    ? readyGeoPdfs.filter((gp) => gp.visible)
    : [];

  // Stage 7: track recording + waypoints + navigate-to-point. The recorder
  // itself lives in tracks/trackRecorder (background task); this screen only
  // starts it and renders state. (The start/navigate callbacks live below
  // handleLocateMe — they depend on it.)
  const { tracks } = useTracks();
  // Live region downloads, so the map can report one that is still running.
  // The whole queue, not just the active job: what the user wants to know is
  // how much of the RUN they asked for is left (see the banner below).
  const regionJobs = useRegionDownloads();
  const downloadProgress = useMemo(() => {
    const live = groupRegionJobs(regionJobs).filter((group) => !group.settled);
    if (live.length === 0) return null;
    const total = live.reduce((sum, group) => sum + group.jobs.length, 0);
    const ready = live.reduce((sum, group) => sum + group.ready, 0);
    return `Downloading maps · ${Math.min(ready + 1, total)} of ${total}`;
  }, [regionJobs]);
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
        color: waypointSymbol(wp).color,
      })),
    [mirrorWaypoints.data],
  );
  const activeTrack =
    tracks.find(
      (track) => track.state === "recording" || track.state === "paused",
    ) ?? null;
  /** Finished recordings — what the Tracks layer draws, and its tally. */
  const savedTracks = tracks.filter((track) => track.state === "done");
  // How many canyons have a route file on this phone. Counted here rather than
  // taken from `routesStatus`, which only exists while the layer is MOUNTED —
  // the row has to state its tally with the switch off, which is exactly when
  // someone is deciding whether to turn it on.
  const canyonRouteCount = canyonTrackMedia?.length ?? 0;

  /**
   * The two route toggles split by WHAT THE ROUTE BELONGS TO, not by how it
   * was made.
   *
   * "Canyon routes" is every route attached to a canyon — the GPX and KML
   * files counted above, and drawn routes carrying a `canyonId`. "My routes"
   * is what is attached to nothing. Splitting it the other way (drawn vs
   * imported) put a canyon's own line under a switch labelled for loose
   * routes, so turning canyon routes off still drew half of them.
   */
  const standaloneRoutes = useMemo(
    () => (routes.data ?? []).filter((route) => route.canyonId == null),
    [routes.data],
  );
  const canyonLinkedRoutes = useMemo(
    () => (routes.data ?? []).filter((route) => route.canyonId != null),
    [routes.data],
  );
  // One list for one layer: RoutesLayer draws whatever it is handed, and which
  // switch put a route in here is not its business.
  const visibleRoutes = useMemo(
    () => [
      ...(showRoutes ? standaloneRoutes : []),
      ...(showCanyonRoutes ? canyonLinkedRoutes : []),
    ],
    [canyonLinkedRoutes, showCanyonRoutes, showRoutes, standaloneRoutes],
  );

  // Locking north-up straightens a map that is already turned. Without this the
  // setting reads as broken for as long as the user leaves the screen rotated:
  // the gesture stops working, but the map stays askew with no way back to north
  // except the compass ornament they may have turned off.
  useEffect(() => {
    if (!northUpLocked) return;
    setCameraStop({ bearing: 0, duration: 300 });
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

  // The double-tap zoom ramp is a few loose interval ticks (see
  // `startZoomRamp`); a follow-mode change, the screen losing focus, or
  // unmount mid-ramp must not leave it writing camera stops nobody asked for
  // any more. A fresh double tap already supersedes it (`startZoomRamp`
  // cancels first) — this is the "the user left" half.
  useEffect(() => cancelZoomRamp, [followMode, mapFocused, cancelZoomRamp]);
  // Which waypoint's sheet is open, and whether it should land on the edit
  // form (a fresh drop) rather than the verb list (a tap on an existing pin).
  const [openWaypoint, setOpenWaypoint] = useState<{
    id: string;
    autoEdit: boolean;
  } | null>(null);
  /**
   * The waypoint form's round trip to the point picker.
   *
   * The sheet is an RN Modal and would cover a full-screen map, so it closes on
   * the way out and its body unmounts with it — `waypointDraft` is what makes
   * that lossless and `waypointPicked` is what comes back. Same shape as the
   * Saved tab's, for the same reason.
   */
  const [waypointDraft, setWaypointDraft] = useState<WaypointFormDraft | null>(null);
  const [waypointPicked, setWaypointPicked] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [waypointPickerAway, setWaypointPickerAway] = useState(false);
  /** Read by the focus effect, which must not re-subscribe when it changes. */
  const waypointPickerAwayRef = useRef(waypointPickerAway);
  waypointPickerAwayRef.current = waypointPickerAway;

  /** Which waypoint the form is on, for the picker request below — a ref so
   *  that callback stays stable across opening one. */
  const openWaypointId = useRef<string | null>(null);
  openWaypointId.current = openWaypoint?.id ?? null;

  /** Leave for the picker, carrying what the form has in it. */
  const openWaypointPicker = useCallback(
    (current: WaypointFormDraft) => {
      // EMPTY IS NOT ZERO: `Number("")` is 0, and 0/0 is a real place off the
      // coast of Africa — a blank pair must open the picker with no marker.
      const latitude = Number(current.latitude.trim());
      const longitude = Number(current.longitude.trim());
      const from =
        current.latitude.trim() !== "" &&
        current.longitude.trim() !== "" &&
        isValidLatitude(latitude) &&
        isValidLongitude(longitude)
          ? { latitude, longitude }
          : null;
      setWaypointDraft(current);
      setWaypointPicked(null);
      setWaypointPickerAway(true);
      // Reopening lands on the FORM rather than the verb list: the user is
      // mid-edit, and the trip to the map is one step of that edit.
      setOpenWaypoint((open) => (open ? { ...open, autoEdit: true } : open));
      onPickPoint(from, openWaypointId.current ?? undefined);
    },
    [onPickPoint],
  );
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

  // MLRN's GeoJSONSource JSON.stringifies `data` on every render it lets
  // through, and an object literal in the JSX defeats its memo outright — so
  // both of these small sources were re-serialised and re-committed to the
  // native map on every render of this screen. They change when their inputs
  // do, and not otherwise.
  const navLineShape = useMemo(
    () =>
      navTarget && userCoord
        ? ({
            type: "Feature",
            geometry: {
              type: "LineString",
              coordinates: [userCoord, [navTarget.lon, navTarget.lat]],
            },
            properties: {},
          } as GeoJSON.Feature<GeoJSON.LineString>)
        : null,
    [navTarget, userCoord],
  );
  const tappedPointShape = useMemo(
    () =>
      tappedPoint
        ? ({
            type: "Feature",
            geometry: {
              type: "Point",
              coordinates: [tappedPoint.longitude, tappedPoint.latitude],
            },
            properties: {},
          } as GeoJSON.Feature<GeoJSON.Point>)
        : null,
    [tappedPoint],
  );

  // Reconcile a recording that outlived the app (kill/reboot) — marks it
  // paused when the platform task died, stops an orphaned task.
  //
  // On every return to the foreground, not only on mount: this screen mounts
  // once per process (bottom-tab navigator), so a service killed by an OEM
  // battery manager or by Doze while the app stayed mounted left the HUD
  // claiming to record until the next cold launch (MLIFE-006).
  //
  // It also settles the stats the backgrounded recorder deliberately did not
  // compute (see refreshTrackStats): the HUD's distance and ascent are right by
  // the time the user has finished looking at the screen unlock.
  useEffect(() => {
    const reconcile = () => {
      reconcileTrackRecording()
        .then(() => refreshActiveTrackStats())
        .catch(console.error);
    };
    reconcile();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") reconcile();
    });
    return () => subscription.remove();
  }, []);

  // A press-and-hold is "something goes here". Two things can: a waypoint (a
  // scratch mark) and a canyon (a real record). A sheet rather than an Alert now
  // that there is more than one — Android's Alert drops buttons past three, and
  // these entries carry glyphs and a subtitle (DESIGN.md §6).
  const notify = useCallback((text: string, tone: "info" | "error") => {
    toastNonce.current += 1;
    setToast({ text, tone, nonce: toastNonce.current });
  }, []);

  // The drop itself never waits on a form: the waypoint is written first, then
  // its sheet opens on the name field. Cancelling the form leaves a saved,
  // auto-named waypoint rather than losing the mark.
  const dropWaypointAt = useCallback(
    (point: { latitude: number; longitude: number }) => {
      createWaypointLocal({
        name: `Waypoint ${waypoints.length + 1}`,
        latitude: point.latitude,
        longitude: point.longitude,
      })
        .then((id) => setOpenWaypoint({ id, autoEdit: true }))
        .catch(console.error);
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
  // Mount-only, and yields to an explicit destination: arriving with a
  // "Show on map" bbox means the user asked for somewhere specific, and that
  // beats where they happen to be standing.
  const openedWithDestination = useRef(focus != null);
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
          center: [position.coords.longitude, position.coords.latitude],
          zoom: FOLLOW_ZOOM,
          // Instant when it came from the cache; a fetched fix animates in so
          // the jump reads as the map answering, not as a glitch.
          duration: 0,
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

  /** The extent to outline on arrival, and the request it came from. Component
   *  state, never logged (privacy rule). */
  const [focusPulse, setFocusPulse] = useState<{
    bbox: [number, number, number, number];
    nonce: number;
  } | null>(null);

  // "Show on map" arrival: fit the requested asset's bbox. Keyed on the nonce
  // so tapping the same asset again refocuses, and so a re-render with the
  // same params doesn't fight the user's own panning.
  useEffect(() => {
    if (!focus) return;
    // Basemap first, camera second: they commit in the same render either way,
    // and the ordering says which one is the correction.
    if (focus.basemapId) chooseBasemap(focus.basemapId);
    // Make the asset's layer visible before flying to it, or the camera lands
    // on an empty patch. A region's "layer" IS the basemap (handled above);
    // everything else toggles its own kind on.
    if (focus.reveal) {
      switch (focus.reveal.category) {
        case "track":
          // The item's own visible flag is necessary but not sufficient — a
          // saved track also needs the Tracks master switch on (bug 6's
          // showTracks), or it stays hidden regardless.
          setShowTracks(true);
          updateTrack(focus.reveal.key, { visible: true }).catch(console.error);
          break;
        case "route":
          setShowRoutes(true);
          break;
        case "geoPdf":
          updateGeoPdfImport(focus.reveal.key, { visible: true }).catch(console.error);
          break;
        case "import":
          setVectorImportVisible(focus.reveal.key, true).catch(console.error);
          break;
        case "overlay": {
          // Reveal the whole job: every layer enabled and the area unmuted.
          // SavedScreen's item key for this category is `overlay:<jobId>`
          // (SavedScreen.tsx's registry-row prefix) — strip it back to the raw
          // jobId that mergedOverlays.jobs and setAreasMuted both key on.
          const jobId = focus.reveal.key.replace(/^overlay:/, "");
          for (const job of mergedOverlays.jobs) {
            if (job.jobId !== jobId) continue;
            for (const layer of job.layers) {
              const key = `${job.jobId}/${layer.name}`;
              setEnabledOverlays((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
              setOverlayEnabled(key, true).catch(console.error);
            }
          }
          setAreasMuted([jobId], false);
          break;
        }
        case "region":
        case "waypoint":
          // A region's layer is the basemap (above); a waypoint always draws.
          break;
      }
    }
    // Being asked to look at something else ENDS follow mode, exactly as a
    // place search does (handleSelectPlace). While following, the fix watcher
    // writes a camera stop per sample, so the fit below was overwritten within
    // a frame: tapping "Show on map" — or a canyon's route attachment — did
    // nothing at all, silently, for as long as the dot was on.
    setFollowMode("off");
    fitCameraToBbox(focus.bbox);
    // …and say WHICH rectangle — but only for a saved REGION, the one asset
    // whose extent is a meaningful box. A pulsing rectangle around a pin, a
    // line or a canyon point is noise (the asset itself is already the shape).
    // `basemapId` is the region signal: Saved only sets it on a downloaded
    // region (SavedItem.focusBasemapId).
    if (focus.basemapId) {
      setFocusPulse({ bbox: focus.bbox, nonce: focus.nonce });
    }
  }, [focus?.nonce, focus, chooseBasemap, fitCameraToBbox, mergedOverlays, setAreasMuted]);

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
        setDraftColor(target.color ?? null);
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
      setDraftColor(null);
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
  const optionsRoute = findRoute(optionsRouteId);

  // The two-finger gesture and the drag that ends a follow mode — the whole of
  // the touch-responder contract, in its own file (see useMapPinchGesture).
  const { twoFingerLock, pinchStart, observeTouches, handlePinchMove, endPinch } =
    useMapPinchGesture({
      followModeRef,
      setFollowMode,
      latestFix,
      zoomRef,
      headingRef,
      northUpLockedRef,
      userMovedCamera,
      setCameraStop,
    });

  // Live camera → the scale bar only, at gesture rate. Coordinates stay in
  // component state only — never logged (privacy rule).
  //
  // This is also where a follow mode ends. Panning while the camera is being
  // driven is a fight the user cannot win: every fix (and, in course-up, every
  // compass sample) writes a camera stop that snaps the map back
  // mid-gesture, so the map reads as broken rather than as locked. The gesture
  // wins — `isUserInteraction` is false for our own stops, so the recentres
  // and rotations this screen asks for can't cancel themselves.
  //
  // Course-up's rotation is left applied: yanking the map back to north under
  // a thumb that is mid-pan is a second unrequested camera move. The native
  // compass ornament resets north on tap.
  const handleRegionIsChanging = useCallback(
    (event: NativeSyntheticEvent<ViewStateChangeEvent>) => {
      const { center, zoom, userInteraction } = event.nativeEvent;
      scaleBarRef.current?.update(center[1], zoom);
      if (userInteraction) {
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
    [pinchStart],
  );

  // Settled camera readout. Coordinates stay in component state only — never
  // logged (privacy rule).
  const handleRegionDidChange = useCallback(
    (event: NativeSyntheticEvent<ViewStateChangeEvent>) => {
      const { center, zoom, bearing, bounds } = event.nativeEvent;
      const [longitude, latitude] = center;
      if (!Number.isFinite(latitude) || !Number.isFinite(zoom)) return;
      scaleBarRef.current?.update(latitude, zoom);
      // The move that just settled is done with; drop its stop so a re-render
      // can't replay it (see stopNeedsReset).
      if (stopNeedsReset.current) {
        stopNeedsReset.current = false;
        void cameraRef.current?.setStop({ duration: 0 });
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
        zoomRef.current = zoom;
        if (Number.isFinite(bearing)) headingRef.current = bearing;
      }
      // What is actually on screen, for the offline notice. Carried on the
      // settle event itself rather than derived, because a rotated view's
      // extent is not its centre plus its zoom. (Under MLRN 10 this was an
      // async getVisibleBounds() round trip per settle; the event brings it.)
      const [west, south, east, north] = bounds;
      setViewportBbox((prev) =>
        prev &&
        prev.north === north &&
        prev.east === east &&
        prev.south === south &&
        prev.west === west
          ? prev
          : { north, east, south, west },
      );
      setCamera((prev) =>
        prev.zoom === zoom &&
        prev.latitude === latitude &&
        prev.longitude === longitude
          ? // Same readout ⇒ same render output. Bailing keeps a stop replay
            // (which reports the unchanged region again) from re-rendering and
            // replaying forever.
            prev
          : {
              zoom,
              latitude: latitude as number,
              longitude: longitude as number,
            },
      );
    },
    [pinchStart],
  );

  // Place search result: recentre without changing zoom intent drastically.
  const handleSelectPlace = useCallback((latitude: number, longitude: number) => {
    setFollowMode("off");
    setCameraStop({
      center: [longitude, latitude],
      zoom: 13,
      duration: 800,
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
        center: latestFix.current,
        zoom: FOLLOW_ZOOM,
        ...(heading != null ? { bearing: normalizeBearing(heading) } : {}),
        duration: 600,
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
   * Derive the real magnetic declination for where the user actually is.
   *
   * `DeviceMotion` reports against MAGNETIC north and knows nothing about
   * location, so without this the heading is corrected by a single constant
   * good only inside NSW. One `getHeadingAsync` gives both norths and their
   * difference is Android's own `GeomagneticField` value — see
   * `learnDeclination`.
   *
   * Triggered by TRAVEL, not by a clock: declination is a function of position,
   * and its drift over time is ~0.1°/year, so there is no staleness a TTL would
   * catch and no reason to refresh a phone sitting in one valley all week.
   * `noteDeclinationFix` records the position first so a failed or
   * permission-denied read does not retry on every one of the 3 s fixes.
   */
  const declinationInFlight = useRef(false);
  const refreshDeclination = useCallback((coord: [number, number]) => {
    const [longitude, latitude] = coord;
    if (!declinationNeedsRefresh(latitude, longitude)) return;
    // ONE OUTSTANDING READ, AND THE POSITION IS RECORDED ONLY ON SUCCESS.
    // `getHeadingAsync` does not resolve until a sample arrives with better
    // than low accuracy or six have been seen (expo-location's Location.js),
    // and samples need 2° of movement — so on a phone sitting still it can
    // simply never return, holding an accelerometer + magnetometer
    // registration open while it waits. Recording the position up front (the
    // first version of this) meant one such stall pinned the app to the NSW
    // constant until the user travelled 55 km. Recording on success instead
    // would retry on every 3 s fix and stack up those registrations, so the
    // in-flight guard is what makes retrying safe: at most one ever exists,
    // and the first one to resolve wins.
    if (declinationInFlight.current) return;
    declinationInFlight.current = true;
    void Location.getHeadingAsync()
      .then((sample) => {
        if (learnDeclination(sample)) noteDeclinationFix(latitude, longitude);
      })
      .catch((err: unknown) => console.error(err))
      .finally(() => {
        declinationInFlight.current = false;
      });
  }, []);

  /**
   * Fold one fix into the dot and, in a follow mode, into the camera.
   */
  const applyFix = useCallback(
    (coord: [number, number]) => {
      setUserCoord(coord);
      latestFix.current = coord;
      refreshDeclination(coord);
      // The readout's switch can be the ONLY reason this watcher is running
      // (see the effect below), and in that case none of what follows applies:
      // there is no dot to move and no camera to recentre, and flying to the
      // first fix would yank a map the user never asked to be moved.
      if (!dotWantedRef.current) return;
      const mode = followModeRef.current;
      if (firstFix.current) {
        firstFix.current = false;
        setCameraStop({
          center: coord,
          zoom: FOLLOW_ZOOM,
          duration: 1200,
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
        // `center: latestFix.current`, which this callback has already
        // updated, so the map is pinned to the new fix within a frame anyway.
        if (pinchStart.current) return;
        // Course-up rotation is driven by the COMPASS, not by the fix's course
        // over ground: the user wants the map to face where they are looking,
        // which on a scramble is often not where they last moved (and course
        // is reported as -1 whenever they stand still). The heading sample
        // handler owns that rotation; this only recentres.
        setCameraStop({ center: coord, duration: 600 });
      }
    },
    [setCameraStop, pinchStart, refreshDeclination],
  );

  /**
   * One frame of the compass: advance the chase, publish it, and in course-up
   * turn the map.
   *
   * THE DISPLAY RUNS ON THIS CLOCK, NOT THE SENSOR'S. Sensor samples are
   * irregular (see heading.ts), and driving the camera off them made the
   * rotation speed up and slow down inside a single turn — every segment was a
   * different length, so every segment ran at a different angular velocity. A
   * fixed tick makes every camera segment identical, which is what a constant
   * rotation actually requires, and it drives the tape off the same value in
   * the same frame so the two agree.
   */
  const stopHeadingTicker = useCallback(() => {
    if (headingTicker.current == null) return;
    clearInterval(headingTicker.current);
    headingTicker.current = null;
  }, []);
  const tickHeading = useCallback(() => {
    const now = Date.now();
    const next = stepHeadingFilter(headingFilter.current, now);
    if (next == null) return;
    publishHeading(next);

    // Course-up: turn the map with them, LINEARLY and over exactly one tick.
    // See the camera note in heading.ts for why the curve is the whole problem.
    // The deadband is what lets a phone held still write nothing at all, and
    // the ticker stopping below is what keeps the renderer idle in this mode.
    // ONE CAMERA WRITER AT A TIME. While the double-tap zoom ramp is running it
    // owns the camera and carries this bearing itself (`startZoomRamp`); a stop
    // written from here would cancel the ramp's transition mid-flight, and vice
    // versa, which is what made a double tap in course-up read as two
    // mechanisms fighting. The heading still ticks and is still PUBLISHED above
    // — the arrow and the compass tape must not freeze.
    if (followModeRef.current === "course-up" && zoomRampFrame.current == null) {
      const previous = lastPovBearing.current;
      if (
        previous == null ||
        Math.abs(shortestAngleDelta(previous, next)) >= POV_DEADBAND_DEG
      ) {
        const sinceLastWrite =
          lastPovWriteAt.current === 0 ? HEADING_TICK_MS : now - lastPovWriteAt.current;
        lastPovWriteAt.current = now;
        lastPovBearing.current = next;
        setCameraStop({
          bearing: normalizeBearing(next),
          // Carry the position too: this stop REPLACES whatever the last one
          // was, and it would otherwise cancel every recentre a fix asked for.
          ...(latestFix.current ? { center: latestFix.current } : {}),
          duration: povStopDurationMs(sinceLastWrite),
          easing: "linear",
        });
      }
    }

    // Arrived. Stop the timer rather than keep waking to move nothing — the
    // next sample that moves the target starts it again.
    if (headingSettled(headingFilter.current)) stopHeadingTicker();
  }, [setCameraStop, stopHeadingTicker]);
  const startHeadingTicker = useCallback(() => {
    if (headingTicker.current != null) return;
    // Run one immediately: the first sample of a session should reach the arrow
    // now, not a tick from now.
    tickHeading();
    if (headingSettled(headingFilter.current)) return;
    headingTicker.current = setInterval(tickHeading, HEADING_TICK_MS);
  }, [tickHeading]);

  /**
   * One compass sample. It moves the TARGET only — see `tickHeading` for the
   * display.
   *
   * The rotation vector is referenced to MAGNETIC north, so the reading is
   * declination-corrected on the way in (`headingFromDeviceRotation`) —
   * everything else on this screen, including the navigate-to chip and the
   * tape's labels, is true north.
   */
  const handleHeadingSample = useCallback(
    (rotation: DeviceMotionMeasurement["rotation"] | null) => {
      const raw = headingFromDeviceRotation(rotation);
      if (raw == null) return;
      // Timed by the SENSOR, not by arrival — see `deviceSampleTimeMs`. The
      // dispatch interval is a throttle we chose and would otherwise quantise
      // every gap the rate estimate is built from.
      const at = deviceSampleTimeMs(
        headingFilter.current,
        rotation?.timestamp,
        Date.now(),
      );
      if (!noteHeadingSample(headingFilter.current, raw, at)) return;
      startHeadingTicker();
    },
    [startHeadingTicker],
  );

  /**
   * The same thing off `expo-location`'s heading watcher, for a phone with no
   * gyroscope (see the sensor effect). Everything downstream is identical; only
   * the source and its timing differ, and that watcher has no sample timestamp
   * to offer, so arrival time is all there is.
   */
  const handleLegacyHeadingSample = useCallback(
    (sample: Location.LocationHeadingObject) => {
      // This source DOES know true north when it has a fix, so take the real
      // declination from it while we are here (see `learnDeclination`).
      learnDeclination(sample);
      const raw = resolveTrueHeading(sample);
      if (raw == null) return;
      if (!noteHeadingSample(headingFilter.current, raw, Date.now())) return;
      startHeadingTicker();
    },
    [startHeadingTicker],
  );

  // ── sensor lifecycle ───────────────────────────────────────────────────────
  //
  // THE SENSORS RUN ONLY WHILE THIS TAB IS FOCUSED AND THE APP IS IN THE
  // FOREGROUND. This screen mounts once per process (bottom tabs) and in
  // practice never unmounts, and nothing used to stop either watcher: one
  // locate-me tap left a GPS fix every 3 s, and the magnetometer and
  // accelerometer behind it, running for the rest of the process — on every
  // other tab, and with the phone asleep in a pack all day. That is the idle
  // drain, and neither sensor can draw anything the user can see while it is
  // happening.
  //
  // Both are owned by effects rather than by imperative start/stop helpers with
  // their own "already starting" flags. That is not a style choice: the
  // subscriptions are awaited, so every hand-rolled version of this has to
  // invent its own guard for a watcher that resolves after the reason for it
  // went away, and the ones here kept disagreeing with each other about whether
  // "the dot is on" meant a subscription object or a user's intention.
  // `!== "background"`, not `=== "active"`: Android reports `"unknown"` until
  // the first AppState event, and the bundle can evaluate before the activity
  // resumes. Reading that as inactive would leave `sensorsActive` false for the
  // whole launch if the resume event had already fired before this mounted — no
  // dot, no compass, no course-up, self-healing only after a real background
  // cycle. Fail open, the same direction syncEngine's retry gate chose.
  const [appActive, setAppActive] = useState(
    () => AppState.currentState !== "background",
  );
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) =>
      setAppActive(state === "active"),
    );
    return () => subscription.remove();
  }, []);
  const sensorsActive = mapFocused && appActive;

  /**
   * Whether the marker is shown. ALWAYS TRUE once the map exists.
   *
   * It used to start false and be raised by the locate button or by starting a
   * recording, which meant a marker that came and went for reasons the user
   * could not see — most visibly across an app restart, where the recording
   * survived (the record button reads the database) and this did not. "Where
   * am I" is not a mode a map should make you ask for.
   *
   * The cost is the position watcher running whenever the map tab is focused
   * AND foregrounded — never with the screen off, and never on another tab.
   * Measured against the same field session: the watcher bills ~7.9 mAh/hour
   * while the map is open, and the SCREEN that has to be on for the map to be
   * looked at bills ~49 mAh/hour. Six times more, for the privilege of seeing
   * the map at all. This is not where a field day is lost.
   *
   * Kept as state rather than deleted outright because `handleLocateMe` and
   * `applyFix` still branch on it, and the follow-mode cycle needs the
   * distinction between "showing you" and "chasing you".
   */
  const [dotWanted, setDotWanted] = useState(true);
  /** Mirror for `applyFix`, which is memoised once and must not be rebuilt on
   *  every change of this — every rebuild tears the GPS watcher down and
   *  starts a new one. */
  const dotWantedRef = useRef(dotWanted);
  dotWantedRef.current = dotWanted;

  /**
   * Why a position watcher is running at all.
   *
   * TWO reasons now, not one: the location dot, and the speed + elevation chip
   * (Settings → Map), which needs a fix and has no other source for one. The
   * chip's switch is off by default and its settings row says it keeps GPS
   * running, because this is the one preference in the app that turns a sensor
   * on for as long as the map is open without anything appearing on the map to
   * account for it.
   */
  const fixWanted = dotWanted || speedElevationEnabled;

  /**
   * Fold one position into the speed/elevation chip.
   *
   * The heights come from the DEM FIRST and the handset second, for the reason
   * `TrackStatsBody` gives at length: a DEM is deterministic where GPS altitude
   * re-reads the same spot with metres of independent error. Saved regions
   * answer with no request at all; the public tiles fill in elsewhere unless
   * the user is simulating offline. The chip says which surface answered.
   *
   * The GPS altitude is published IMMEDIATELY and the terrain reading replaces
   * it when it arrives — a number that is a little wrong now beats a dash that
   * becomes a number in 200 ms, and outside DEM coverage the dash would be
   * permanent.
   *
   * PRIVACY: `sampleElevations` sends TILE INDICES (a ~4.9 km cell) to the
   * public terrarium bucket and nothing else, on the same client-direct path
   * the region download already uses. Never logged. Nothing about the fix
   * reaches our API from here.
   */
  const previousReadoutFix = useRef<ReadoutFix | null>(null);
  const readoutSeq = useRef(0);
  const noteReadoutFix = useCallback(
    (position: Location.LocationObject) => {
      if (!speedElevationEnabledRef.current) return;
      const fix: ReadoutFix = {
        lon: position.coords.longitude,
        lat: position.coords.latitude,
        speedMps: position.coords.speed,
        atMs: position.timestamp,
      };
      const speedMps = deriveSpeedMps(fix, previousReadoutFix.current);
      previousReadoutFix.current = fix;
      publishLiveReadout({
        speedMps,
        elevationM: position.coords.altitude,
        fromTerrain: false,
        atMs: fix.atMs,
      });

      // Guarded by a sequence number: tile reads resolve out of order, and a
      // late answer for a fix two positions ago would overwrite the current
      // one with the height of somewhere the user has left.
      const seq = (readoutSeq.current += 1);
      // `distanceM` describes a position's place along a LINE; a lone point is
      // at zero of one.
      sampleElevations([{ lon: fix.lon, lat: fix.lat, distanceM: 0 }], {
        allowNetwork: !offlineOnlyRef.current,
      })
        .then(([elevationM]) => {
          if (seq !== readoutSeq.current || elevationM == null) return;
          publishLiveReadout({
            speedMps,
            elevationM,
            fromTerrain: true,
            atMs: fix.atMs,
          });
        })
        // No detail: the error could carry a tile index, which is a position.
        .catch(() => undefined);
    },
    [],
  );

  // The dot's own position watcher.
  //
  // It stays at 3 s whether or not a track is recording, deliberately. The
  // recording fix rate does NOT govern it: this is the marker a person reads to
  // answer "where am I", and a marker that is two minutes stale is answering a
  // different question. The cost is bounded by the lifecycle above — the
  // watcher only exists while the map tab is focused AND the app is in the
  // foreground, which is the phone out of the pack with the screen on, and the
  // screen dominates the power bill in that state anyway.
  //
  // What that costs during a recording, stated plainly: Android's fused
  // provider serves concurrent clients at the fastest interval any of them
  // asked for, so while the map is open the recording runs at 3 s too,
  // whatever the fix rate says. The fix-rate setting therefore governs the
  // recording's battery cost for the (large) majority of a trip when the map
  // is not on screen, and not while the user is looking at it.
  useEffect(() => {
    if (!sensorsActive || !fixWanted) return;
    let subscription: Location.LocationSubscription | null = null;
    let cancelled = false;
    void (async () => {
      // Instant feedback from the OS's cached fix (the fused provider keeps a
      // recent network/wifi position even indoors) — the watcher then refines.
      const lastKnown = await Location.getLastKnownPositionAsync().catch(
        () => null,
      );
      if (cancelled) return;
      if (lastKnown) {
        // The readout gets it too, and for the same reason the dot does: a
        // chip showing two dashes until the first watch callback lands reads
        // as broken, and indoors that callback can be minutes away. A cached
        // fix is stale by definition, which is exactly what `atMs` and the
        // staleness rule are for — the height still stands, the speed does not.
        noteReadoutFix(lastKnown);
        applyFix([lastKnown.coords.longitude, lastKnown.coords.latitude]);
      }
      // Balanced = fused wifi/cell + GPS. High (GPS-priority) starves indoors
      // and the callback never fires — the original silent-failure mode.
      const started = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 3000,
          distanceInterval: 5,
        },
        (position) => {
          noteReadoutFix(position);
          applyFix([position.coords.longitude, position.coords.latitude]);
        },
      ).catch((err: unknown) => {
        console.error(err);
        return null;
      });
      // Resolved after the effect was torn down: nothing else will ever remove
      // it, so the GPS request would outlive the screen (MLIFE-007).
      if (!started) return;
      if (cancelled) started.remove();
      else subscription = started;
    })();
    return () => {
      cancelled = true;
      subscription?.remove();
      subscription = null;
      // A stopped watcher has no readout: leaving the tab must not leave the
      // chip reporting the speed it saw on the way out.
      publishLiveReadout(null);
      previousReadoutFix.current = null;
    };
  }, [sensorsActive, fixWanted, applyFix, noteReadoutFix]);

  // The compass. Wanted by the tape (which runs with no fix at all) and by the
  // location arrow.
  //
  // DEVICE MOTION, NOT LOCATION. `rotation.alpha` is Android's gyro-fused
  // TYPE_ROTATION_VECTOR (see heading.ts) — six times the sample rate of
  // `expo-location`'s heading watcher and, more importantly, immune to the hand
  // acceleration that made the old accelerometer+magnetometer fusion report a
  // backwards turn at the start of a real one.
  //
  // It also needs NO PERMISSION, so the location-permission check this effect
  // used to carry is gone, and with it the `permissionNonce` that existed only
  // to re-run that check after a grant made on another screen. The tape and the
  // arrow's bearing now work on a fresh install with location denied — only the
  // DOT needs a fix, and its own watcher above still asks for one.
  //
  // `userCoord`, not `dotWanted`: the arrow does not mount until there is a
  // position (see the marker in the JSX), so between the locate-me tap and the
  // first fix — which indoors can be never — the sensors, the bridge traffic
  // and the ticker would all run with nothing on screen consuming any of it.
  const headingWanted = compassEnabled || (dotWanted && userCoord != null);
  useEffect(() => {
    if (!sensorsActive || !headingWanted) return;
    DeviceMotion.setUpdateInterval(HEADING_SENSOR_MS);
    let live = true;
    // NO ROTATION VECTOR MEANS NO GYROSCOPE, and there are Android phones
    // without one. `DeviceMotion` still dispatches (the accelerometer is
    // universal) but never carries `rotation`, so the compass would simply
    // never appear — a regression against the expo-location watcher, which
    // managed accelerometer+magnetometer alone. Falling back on the ABSENCE OF
    // DATA rather than on `isAvailableAsync` is deliberate: that probe demands
    // all five of DeviceMotion's sensors, four of which the framework
    // synthesises, so it can answer false on hardware that would have worked.
    // Waiting for the thing we actually need cannot be wrong, and costs a
    // second of no compass on the phones that need the fallback.
    let sawRotation = false;
    let fallback: Location.LocationSubscription | null = null;
    const subscription = DeviceMotion.addListener((motion) => {
      if (motion.rotation) sawRotation = true;
      handleHeadingSample(motion.rotation);
    });
    const probe = setTimeout(() => {
      if (!live || sawRotation) return;
      void Location.getForegroundPermissionsAsync()
        .then(async ({ status }) => {
          if (!live || status !== "granted") return;
          const started = await Location.watchHeadingAsync((sample) => {
            handleLegacyHeadingSample(sample);
          }).catch((err: unknown) => {
            console.error(err);
            return null;
          });
          if (!started) return;
          if (live) fallback = started;
          else started.remove();
        })
        .catch((err: unknown) => console.error(err));
    }, ROTATION_VECTOR_GRACE_MS);
    return () => {
      live = false;
      clearTimeout(probe);
      fallback?.remove();
      fallback = null;
      subscription.remove();
      // Drop the reading with the sensor. A heading is a claim about which way
      // the phone is pointing RIGHT NOW; kept across a suspend it draws the
      // arrow and the tape at the bearing the user was facing when they put the
      // phone away, and `handleLocateMe` would rotate the map into course-up
      // from that stale value rather than reading the sensor afresh.
      //
      // The ticker goes with it — it is a 31 Hz timer, and one left running
      // behind a blurred tab is the same fault as a live sensor.
      stopHeadingTicker();
      headingFilter.current = createHeadingFilter();
      lastPovBearing.current = null;
      lastPovWriteAt.current = 0;
      publishHeading(null);
    };
  }, [
    sensorsActive,
    headingWanted,
    handleHeadingSample,
    handleLegacyHeadingSample,
    stopHeadingTicker,
  ]);

  /**
   * Is the phone's compass calibrated? Sampled, not watched — see
   * COMPASS_PROBE_WINDOW_MS for why, and heading.ts for why this is the only
   * place the answer exists.
   *
   * State rather than the heading store: it changes a few times an hour, so a
   * screen re-render is the right cost, unlike the bearing itself.
   *
   * Needs location permission, which the compass otherwise does not. Without it
   * there is simply no reading and no banner — the map is no worse off than it
   * was, it just cannot warn.
   */
  const [compassCalibration, setCompassCalibration] = useState(NO_COMPASS_CALIBRATION);
  const [fieldWindow, setFieldWindow] = useState(EMPTY_FIELD_WINDOW);
  // In the dep array so the cadence changes with the verdict. It flips at most
  // once per transition, and the restart's immediate probe is exactly what a
  // transition wants.
  const compassProbeUrgent = compassProbeIsUrgent(compassCalibration);
  useEffect(() => {
    if (!sensorsActive || !headingWanted) return;
    let live = true;
    let subscription: Location.LocationSubscription | null = null;
    let fieldProbe: { remove: () => void } | null = null;
    let closeAt: ReturnType<typeof setTimeout> | undefined;

    const probe = () => {
      // Never two at once, and never one left open: each probe closes its own
      // watcher on a timer rather than waiting for a sample that a still phone
      // will never send.
      if (fieldProbe) return;
      let best: number | null = null;
      // The magnetic environment, over the same window. Needs no permission and
      // no heading events, so unlike the accuracy flag it still reports on a
      // phone sitting perfectly still.
      let field = EMPTY_FIELD_WINDOW;
      const magnetometer = Magnetometer.addListener((sample) => {
        field = addFieldSample(field, fieldStrengthUt(sample));
      });
      fieldProbe = magnetometer;
      // Closes on the clock whatever the heading watcher managed, because the
      // magnetometer half does not depend on it: location permission can be
      // denied and `watchHeadingAsync` can report nothing, and the field
      // reading is still worth having.
      closeAt = setTimeout(() => {
        subscription?.remove();
        subscription = null;
        magnetometer.remove();
        fieldProbe = null;
        if (!live) return;
        // Heard nothing at all? Say nothing. A phone lying still emits no
        // heading events, and silence is not a fault.
        setCompassCalibration((current) => foldCompassProbe(current, best));
        setFieldWindow(field);
        // ...and where Settings can read it, so "is my compass all right" has
        // an answer somewhere on the device.
        publishCompassProbe(best, field);
      }, COMPASS_PROBE_WINDOW_MS);
      void (async () => {
        const { status } = await Location.getForegroundPermissionsAsync().catch(
          () => ({ status: "denied" as const }),
        );
        if (!live || status !== "granted") return;
        const started = await Location.watchHeadingAsync((sample) => {
          best = Math.max(best ?? sample.accuracy, sample.accuracy);
        }).catch((err: unknown) => {
          console.error(err);
          return null;
        });
        if (!started) return;
        if (!live) {
          started.remove();
          return;
        }
        subscription = started;
      })();
    };

    probe();
    const repeat = setInterval(
      probe,
      compassProbeUrgent ? COMPASS_PROBE_URGENT_MS : COMPASS_PROBE_INTERVAL_MS,
    );
    return () => {
      live = false;
      clearInterval(repeat);
      clearTimeout(closeAt);
      subscription?.remove();
      subscription = null;
      fieldProbe?.remove();
      fieldProbe = null;
    };
  }, [sensorsActive, headingWanted, compassProbeUrgent]);

  const handleLocateMe = useCallback(async () => {
    if (!(await ensureForegroundLocationPermission())) return;
    // Drive the dot from expo-location directly — MLRN's built-in
    // UserLocation engine produced no updates on-device (silent), and we
    // need expo-location's watcher for Stage 7 track recording anyway.
    //
    // The test is the user's INTENTION, not whether a subscription object
    // happens to exist: the watcher is torn down and rebuilt whenever the tab
    // blurs, the app backgrounds or a recording starts, and a tap landing in
    // one of those windows used to take the cold-start branch — flying the
    // camera to FOLLOW_ZOOM and throwing away the zoom the user had set.
    if (dotWanted) {
      // Cycle the follow mode. Every mode change also RECENTRES: fixes arrive
      // seconds to minutes apart, so without this the map stayed wherever the
      // user had panned it until they walked somewhere — which reads as the
      // follow button doing nothing at all.
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
        // No gap to measure yet: without this the first stop of a new
        // course-up session would animate over however long ago the last one
        // was, which is the whole session for anyone re-entering the mode.
        lastPovWriteAt.current = 0;
        // Rotate from a heading we ALREADY have rather than waiting to be told
        // one. Android's heading watcher reports on change, so a phone lying
        // still on a rock emits nothing for seconds after the user asks to face
        // their direction — the map just sat north-up, which reads as the mode
        // not working. Last smoothed sample first, a one-shot sensor read if
        // there has never been one, and only then fall through to the watcher.
        let heading = headingFilter.current.value;
        if (heading == null) {
          heading = await currentHeading();
          if (heading != null) {
            noteHeadingSample(headingFilter.current, heading, Date.now());
            headingFilter.current.value = normalizeBearing(heading);
          }
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
      // The ref too, and BEFORE recentre(): setCameraStop reads
      // followModeRef (not the state) to decide whether to re-apply the
      // course-up forward offset, and the ref only follows state on the next
      // render — recentre() runs synchronously against the stale "course-up"
      // value otherwise, re-offsetting the very stop meant to undo it.
      followModeRef.current = "off";
      // Leaving course-up also drops its forward camera offset: recentre on the
      // fix AND re-orient north, so the map isn't left pointing north at a spot
      // three quarters of the way past the user.
      recentre(0);
      return;
    }
    setFollowMode("follow");
    firstFix.current = true;
    // The effects above own the subscriptions; this is the request they answer.
    // The compass comes with it — the arrow is a heading as much as a position.
    setDotWanted(true);
  }, [dotWanted, recentre, requestPovRecentre]);

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
      if (!dotWanted) handleLocateMe();
    },
    [dotWanted, handleLocateMe],
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
    (event: NativeSyntheticEvent<PressEvent>) => {
      const [lon, lat] = event.nativeEvent.lngLat;
      // While either point tool is armed, press-and-hold near the line means
      // "add a point here" — the mobile stand-in for dragging the line on web.
      // Only when it lands near the line; anywhere else follows the preference.
      if (insertAnchorNear(lon, lat)) return;
      // Drawing or measuring: every other long-press outcome (waypoint, navigate,
      // start route/measure, add canyon, "This point" sheet) is a bug mid-draw —
      // press-and-hold off the line does nothing while a tool is armed.
      if (collectingPoints) return;
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
      collectingPoints,
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
      if (!dotWanted) handleLocateMe();
      // A pulsing dot is not a discoverable button. Said once, at the only
      // moment it is useful, rather than left as chrome for the whole trip.
      notify("Recording — tap the dot for stats.", "info");
    } catch (err) {
      console.error(err);
      Alert.alert("Recording error", "Couldn't start recording.");
    }
  }, [dotWanted, handleLocateMe, notify]);

  /**
   * Pick a finished recording back up, from its own options sheet.
   *
   * Everything `handleStartRecording` does around the recorder itself applies
   * here too — the permission has to be asked for OUTSIDE the sheet, and
   * recording without seeing yourself is disorienting — so this is that flow
   * with a different verb in the middle rather than a second version of it.
   */
  const handleContinueRecording = useCallback(
    async (track: Track) => {
      if (!(await ensureForegroundLocationPermission())) return;
      try {
        await continueTrackRecording(track);
        if (!dotWanted) handleLocateMe();
        notify(`Recording again — “${track.name}” continues.`, "info");
      } catch (err) {
        console.error(err);
        Alert.alert(
          "Recording error",
          // The one failure worth naming: another recording is already running,
          // and the fix is the user's to make.
          messageFromError(err, "Couldn't continue that recording."),
        );
      }
    },
    [dotWanted, handleLocateMe, notify],
  );

  // The Saved tab's "Continue recording", arriving as a navigation param.
  // Below the handler it calls, and keyed on a nonce so asking twice for the
  // same track works while a re-render does not repeat it.
  const continueTrackNonce = continueTrack?.nonce ?? null;
  const handledContinueNonce = useRef<number | null>(null);
  useEffect(() => {
    if (!continueTrack) return;
    if (handledContinueNonce.current === continueTrack.nonce) return;
    const target = tracks.find((track) => track.id === continueTrack.trackId);
    // The track list is read asynchronously; leave the request unhandled so the
    // next render with rows tries again (same rule as `editRoute` above).
    if (!target) return;
    handledContinueNonce.current = continueTrack.nonce;
    void handleContinueRecording(target);
  }, [continueTrack, continueTrackNonce, handleContinueRecording, tracks]);

  /**
   * Point the bearing line at one waypoint — what "Navigate to this waypoint"
   * does, from the map's own sheet AND from the Saved tab's copy of it.
   */
  const startNavigatingTo = useCallback(
    (waypoint: MirrorWaypoint) => {
      setNavTarget({
        id: waypoint.id,
        name: waypoint.name,
        lon: waypoint.longitude,
        lat: waypoint.latitude,
        createdAt: waypoint.createdAt,
      });
      // A bearing with no "you are here" is half a navigation aid.
      if (!dotWanted) handleLocateMe();
    },
    [dotWanted, handleLocateMe],
  );

  // The Saved tab's "Navigate to this waypoint", arriving as a navigation
  // param. Same nonce shape as `continueTrack` above, and the same rule: a
  // request the mirror cannot answer yet is left for the next render with rows.
  const navigateWaypointNonce = navigateWaypoint?.nonce ?? null;
  const handledNavigateNonce = useRef<number | null>(null);
  useEffect(() => {
    if (!navigateWaypoint) return;
    if (handledNavigateNonce.current === navigateWaypoint.nonce) return;
    const target = (mirrorWaypoints.data ?? []).find(
      (row) => row.id === navigateWaypoint.waypointId,
    );
    if (!target) return;
    handledNavigateNonce.current = navigateWaypoint.nonce;
    startNavigatingTo(target);
  }, [
    mirrorWaypoints.data,
    navigateWaypoint,
    navigateWaypointNonce,
    startNavigatingTo,
  ]);

  // The Saved tab's "Record a track", same shape as the one above with nothing
  // to look up first.
  const startRecordingNonce = startRecording?.nonce ?? null;
  const handledStartNonce = useRef<number | null>(null);
  useEffect(() => {
    if (startRecordingNonce == null) return;
    if (handledStartNonce.current === startRecordingNonce) return;
    handledStartNonce.current = startRecordingNonce;
    void handleStartRecording();
  }, [handleStartRecording, startRecordingNonce]);

  /**
   * An imported file's own verbs, from the map. Held as an id for the same
   * reason a track's is: the row comes from `useVectorImports`, so a rename or
   * a visibility flip made inside the sheet re-renders it.
   */
  const [optionsImportId, setOptionsImportId] = useState<string | null>(null);
  const handleImportPress = useCallback(
    (importId: string, event: NativeSyntheticEvent<PressEvent>) => {
      // FIRST, before any early return — MLRN 11 bubbles a source press to the
      // map as well, so a handler that bails without this leaks the tap into
      // the map's own handler (map/sourcePress.ts).
      stopSourcePress(event);
      // Same rule as a canyon pin and a track line: while a point-collecting
      // tool is armed the feature under the thumb has to place the point
      // itself, or tapping near an import does nothing and reads as broken.
      if (collectingPoints) {
        const [lon, lat] = event.nativeEvent.lngLat;
        void addToolPoint(lon, lat);
        return;
      }
      setOptionsImportId(importId);
    },
    [addToolPoint, collectingPoints],
  );

  const handleWaypointPress = useCallback(
    (waypoint: Waypoint) => {
      // Same reason as a canyon pin: while a tool is armed, a marker under the
      // thumb places a point rather than opening its menu.
      if (collectingPoints) {
        void addToolPoint(waypoint.lon, waypoint.lat);
        return;
      }
      setOpenWaypoint({ id: waypoint.id, autoEdit: false });
    },
    [addToolPoint, collectingPoints],
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

  /**
   * What the search box can find on this phone.
   *
   * Composed from the same lists the layers above are counted from, in the
   * order a tie is broken in (`localSearch.ts` keeps it): canyons, then
   * waypoints, then the recorded and drawn lines. Extents resolve lazily
   * through the SAME descriptors Saved uses (`assetActions.ts`) — one
   * definition of "where is this thing", not a second one for search.
   *
   * PRIVACY: names and coordinates stay in this array. Nothing here is sent
   * anywhere; the geocoder only ever sees the typed string.
   */
  const savedSearchItems: SavedSearchItem[] = useMemo(
    () => [
      ...ownedCanyons.map((canyon) => ({
        key: `canyon:${canyon.id}`,
        icon: "map-pin" as const,
        hue: OWNED_CANYON_COLOR,
        title: canyon.name,
        kindLabel: "Canyon",
        alternates: canyon.altNames,
        resolveBbox: async () =>
          bboxOfPoints([{ lon: canyon.longitude, lat: canyon.latitude }]),
      })),
      ...sharedCanyons.map((canyon) => ({
        key: `canyon:${canyon.id}`,
        icon: "share-2" as const,
        hue: SHARED_CANYON_COLOR,
        title: canyon.name,
        kindLabel: "Shared canyon",
        alternates: canyon.altNames,
        resolveBbox: async () =>
          bboxOfPoints([{ lon: canyon.longitude, lat: canyon.latitude }]),
      })),
      ...(mirrorWaypoints.data ?? []).map((waypoint) => ({
        key: `waypoint:${waypoint.id}`,
        icon: "flag" as const,
        hue: assetHue.waypoint,
        title: waypoint.name,
        kindLabel: "Waypoint",
        alternates: waypoint.tags,
        resolveBbox: waypointActions(waypoint).resolveBbox,
      })),
      ...savedTracks.map((track) => ({
        key: `track:${track.id}`,
        icon: "activity" as const,
        hue: assetHue.track,
        title: track.name,
        kindLabel: "Track",
        resolveBbox: trackActions(track).resolveBbox,
      })),
      ...(routes.data ?? []).map((route) => ({
        key: `route:${route.id}`,
        icon: "pen-tool" as const,
        hue: assetHue.route,
        title: route.name,
        kindLabel: "Route",
        resolveBbox: routeActions(route).resolveBbox,
      })),
      ...imports.map((imported) => ({
        key: `import:${imported.id}`,
        icon: "file-plus" as const,
        hue: assetHue.import,
        title: imported.name,
        kindLabel: "Imported file",
        resolveBbox: vectorImportActions(imported).resolveBbox,
      })),
    ],
    [ownedCanyons, sharedCanyons, mirrorWaypoints.data, savedTracks, routes.data, imports],
  );

  /**
   * The Layers tab, composed here because this is where every count and every
   * switch already lives. Order is the reading order of the map: the things the
   * user made or saved first, the imported files after, and the topo band last
   * (it is the only row that opens — see MapLayersSheet's header).
   *
   * Hues match the ink the map actually draws with, so a row and its layer are
   * recognisably the same thing.
   */
  const layerToggles: LayerToggleEntry[] = [
    {
      key: "canyons",
      icon: "map-pin",
      hue: OWNED_CANYON_COLOR,
      title: "My canyons",
      count: ownedCanyons.length,
      value: showOwnedCanyons,
      onChange: setShowOwnedCanyons,
    },
    {
      key: "shared-canyons",
      icon: "share-2",
      hue: SHARED_CANYON_COLOR,
      title: "Shared canyons",
      count: sharedCanyons.length,
      value: showSharedCanyons,
      onChange: setShowSharedCanyons,
    },
    {
      key: "waypoints",
      icon: "flag",
      hue: assetHue.waypoint,
      title: "Waypoints",
      count: waypoints.length,
      value: showWaypoints,
      onChange: setShowWaypoints,
    },
    {
      key: "routes",
      icon: "pen-tool",
      hue: assetHue.route,
      title: "My routes",
      count: standaloneRoutes.length,
      value: showRoutes,
      onChange: setShowRoutes,
    },
    {
      key: "canyon-routes",
      icon: "git-commit",
      hue: OWNED_CANYON_COLOR,
      title: "Canyon routes",
      count: canyonRouteCount + canyonLinkedRoutes.length,
      // The layer's own report of what it could not draw. Present only while
      // it is on AND something is missing — a map drawing less than it says
      // has to say so (DESIGN.md §8), and the rest of the time there is
      // nothing to report.
      note:
        showCanyonRoutes && routesStatus && routesStatus.unavailable > 0
          ? `${routesStatus.unavailable} not downloaded yet`
          : undefined,
      value: showCanyonRoutes,
      onChange: setShowCanyonRoutes,
    },
    {
      key: "vector-imports",
      icon: "file-plus",
      hue: assetHue.import,
      title: "Imported ways",
      count: imports.length,
      value: showVectorImports,
      onChange: setShowVectorImports,
    },
    {
      key: "tracks",
      icon: "activity",
      hue: assetHue.track,
      title: "Tracks",
      count: savedTracks.length,
      value: showTracks,
      onChange: setShowTracks,
    },
    {
      key: "geopdfs",
      icon: "file-text",
      hue: assetHue.geoPdf,
      title: "GeoPDF maps",
      count: readyGeoPdfs.length,
      value: showGeoPdfs,
      onChange: setShowGeoPdfs,
    },
  ];

  // Chrome geometry. Notices clear the search row so an expanded search bar
  // never covers them; the scale bar runs from the left edge up to the floating
  // button column on the right.
  // The top row is occupied whether or not the search pill is in it: the
  // record button sits in the opposite corner and stays through a tool, a
  // recording being the one thing that must remain stoppable while measuring.
  // Clears the top row of chrome — search pill on one side, record button on
  // the other. While a tool is collecting points BOTH of those are gone
  // (they'd only be in the way mid-draw), so the stack takes their place
  // instead of leaving the draw/measure card floating below an empty row.
  const noticeTop = collectingPoints
    ? insets.top + CHROME_GAP
    : insets.top + CHROME_GAP + SEARCH_SIZE + spacing(1);
  const recordingWriteFailing = useSyncExternalStore(
    onTrackWriteHealthChanged,
    isRecordingWriteFailing,
  );
  const scaleBarMaxWidth =
    windowWidth - FAB_SIZE - CHROME_GAP * 3 - spacing(1);
  // The handedness swap, in three places that must agree: the JS action column,
  // the JS instruments, and MapLibre's own compass ornament (position 2 is
  // bottom-left, 3 is bottom-right). Absolute offsets rather than a flex
  // direction because all three are absolutely positioned against the map.
  const controlsOnLeft = controlSide === "left";
  /**
   * How high MapLibre's compass ornament sits, clearing the instruments below
   * it in the same corner.
   *
   * MEASURED, NOT RESERVED: it counts only the instruments actually switched
   * on, so the ornament sits on top of the stack rather than floating a gap
   * above it whenever one of the three is off.
   *
   * It reserves a switched-on instrument even in the moments it draws nothing
   * (the tape renders null until the first heading sample, the chip is present
   * from the start), because the preference is the stable thing and a margin
   * that flickers with a sensor is worse than a margin that is briefly tall.
   */
  const instrumentsBottom = spacing(1);
  const ornamentMarginY =
    instrumentsBottom +
    (scaleBarEnabled ? SCALE_BAR_HEIGHT + INSTRUMENT_GAP : 0) +
    (compassEnabled ? COMPASS_STRIP_HEIGHT + INSTRUMENT_GAP : 0) +
    (speedElevationEnabled ? READOUT_CHIP_HEIGHT + INSTRUMENT_GAP : 0);
  /**
   * When the location marker has to be re-inserted to stay on top.
   *
   * MLRN adds an unpinned layer at the TOP of the style, in mount order — so a
   * layer that mounts later than the marker draws over it, and several here
   * mount late by nature: a track line appears when a recording starts, a
   * layer switch turns a whole group on, the pen arms mid-session. The marker
   * was mounted last and still ended up under the track the user was recording.
   *
   * Changing this key unmounts and re-adds the two top layers, which puts them
   * back on top of whatever just arrived. It is a string of everything BELOW
   * them that can mount or unmount; the layers under `layerIndex` (basemap,
   * topo band, GeoPDFs, imports) are pinned by index and cannot climb, so they
   * are deliberately not in it. Anything unpinned added to this map later
   * belongs here too.
   */
  const topStackKey = [
    showTracks ? tracks.map((track) => track.id).join(",") : "",
    waypoints.length > 0,
    showRoutes,
    showCanyonRoutes,
    showWaypoints,
    drawingRoute,
    measuring,
    navLineShape != null,
    focusPulse?.nonce ?? "",
  ].join("|");
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
      // The double-tap detector reads the same stream and claims nothing — the
      // answer handed back is still `observeTouches`', so MapLibre keeps every
      // gesture it would otherwise have had.
      onStartShouldSetResponderCapture={(event) => {
        observeDoubleTap(event);
        return observeTouches(event, true);
      }}
      onMoveShouldSetResponderCapture={(event) => observeTouches(event, false)}
      onResponderMove={handlePinchMove}
      onResponderRelease={endPinch}
      onResponderTerminate={endPinch}
      // Nothing takes a pinch off us halfway through.
      onResponderTerminationRequest={() => false}
    >
      <Map
        ref={mapRef}
        style={styles.map}
        mapStyle={shellStyle}
        attribution={false}
        logo={false}
        // The compass is the NATIVE ornament: it tracks the camera frame by
        // frame, fades itself out at north, and resets north on tap — all
        // things the JS button did badly or not at all (it only redrew once a
        // gesture settled, and a rotated Feather glyph is not a needle).
        // Bottom-left (position 2), above the JS instruments — it answers a
        // different question from the compass tape (which way the MAP faces, vs
        // which way the USER does), so both are on screen at once. The margin is
        // clearance measured from the instruments actually switched on (see
        // `ornamentMarginY`), so the ornament tracks the top of the stack.
        // MLRN 11 does have a native scale bar, but Android only puts it
        // top-left, so ours stays drawn in JS.
        // HIDDEN IN COURSE-UP, and not only because tapping it snapped the
        // map back to north against the mode that was steering it — a fight
        // the compass won for exactly as long as it took the next sensor
        // sample to arrive. In that mode the map's heading IS the user's
        // heading, which the compass tape along the bottom already reports, so
        // the ornament has nothing left to say that isn't said better below.
        compass={followMode !== "course-up"}
        // Follows the instruments to whichever edge they are on (see
        // `instrumentsEdge`) — the position IS the margin in MLRN 11, which
        // takes corner insets rather than a corner index plus an x/y pair.
        compassPosition={
          controlsOnLeft
            ? { bottom: ornamentMarginY, right: CHROME_GAP }
            : { bottom: ornamentMarginY, left: CHROME_GAP }
        }
        // BOTH two-finger gestures are MapLibre's only when nothing is being
        // followed. While following, this screen drives scale and rotation
        // together from one start reference (see handlePinchMove), and leaving
        // either with MapLibre would put two drivers on the same two fingers —
        // which is exactly how an incidental twist during a pinch used to
        // shake follow mode loose. Pan stays MapLibre's throughout: a
        // one-finger drag still pans, and still means "stop following".
        touchZoom={followMode === "off"}
        touchRotate={followMode === "off" && !northUpLocked}
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
        // work: `twoFingerLock` is React state, so `dragPan` reaches the
        // native view 48-92 ms after the second finger lands (measured), and the
        // jump is in the first frame. The detector has to be disarmed BEFORE the
        // gesture starts, which means for as long as the map is following.
        //
        // The cost is that a one-finger drag no longer pans by itself while
        // following — `observeTouches` recognises it and drops follow, which
        // hands pan straight back. That costs a frame or two of deadband at the
        // start of a drag-to-stop-following, on the gesture least able to
        // notice it.
        dragPan={followMode === "off" && !twoFingerLock}
        touchPitch={!twoFingerLock}
        // The renderer's ceiling, not its target: MapLibre only draws when
        // something invalidates it, and this caps how often that may become a
        // frame. Uncapped it follows the display — 120 Hz on a modern phone —
        // so a pan costs twice what it needs to on a map of contour lines.
        preferredFramesPerSecond={MAP_MAX_FPS}
        onRegionIsChanging={handleRegionIsChanging}
        onRegionDidChange={handleRegionDidChange}
        onPress={handleMapPress}
        onLongPress={handleMapLongPress}
      >
        <Camera
          ref={cameraRef}
          initialViewState={CAMERA_DEFAULTS}
        />
        {/* Bundled point-feature icons for vector overlays. */}
        <TopoIconImages />
        {/* Locate-me sprite: one baked PNG per Settings → Map colour choice
            (see UserMarkerImages) — picked by iconImage, not recoloured at
            runtime. */}
        <UserMarkerImages />

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
                <Layer
                  key={`basemap-layer-${resolved.key}`}
                  type="raster"
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
          <GeoJSONSource id="offline-mask" data={offlineMask}>
            <Layer
              key="offline-mask-fill"
              type="fill"
              id="offline-mask-fill"
              layerIndex={maskLayerIndex}
              style={{ fillColor: theme.primary, fillOpacity: 1 }}
            />
          </GeoJSONSource>
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
                  <Layer
                    key={`topo-layer-${resolved.key}`}
                    type="raster"
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
                <Layer
                  key={`geopdf-layer-${geoPdf.id}`}
                  type="raster"
                  id={`geopdf-layer-${geoPdf.id}`}
                  layerIndex={overlayRenderPlan.nextIndex + geoPdfPosition}
                  // FULL, not `geoPdf.opacity`. Nothing writes that column
                  // since the layers sheet lost its opacity rail, so reading it
                  // only meant imports made before that change stayed
                  // permanently washed out with no control to fix them. A
                  // future opacity control re-wires this line and the default
                  // in importPipeline together.
                  style={{ rasterOpacity: 1 }}
                />
              </ResolvedSource>
            ) : null,
          ),
        )}

        {/* Vector imports (Stage 5): device-local GeoJSON from user files,
            pinned above the overlay band, below the canyon layers. Each
            import is one GeoJSONSource read straight off disk. */}
        {visibleImports.map((imported, importPosition) => {
          const base =
            overlayRenderPlan.nextIndex +
            readyGeoPdfImports.length +
            importPosition * 3;
          return (
            <GeoJSONSource
              key={imported.id}
              id={`import-${imported.id}`}
              data={`file://${imported.path}`}
              onPress={(event) => handleImportPress(imported.id, event)}
            >
              <Layer
                key={`import-fill-${imported.id}`}
                type="fill"
                id={`import-fill-${imported.id}`}
                layerIndex={base}
                filter={["==", "$type", "Polygon"] as never}
                style={{ fillColor: imported.color, fillOpacity: 0.2 }}
              />
              <Layer
                key={`import-line-${imported.id}`}
                type="line"
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
              <Layer
                key={`import-point-${imported.id}`}
                type="circle"
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
            </GeoJSONSource>
          );
        })}

        {/* Every canyon route at once (layers sheet → Layers → Canyon routes).
            Mirror-backed, so it draws with no signal for any file this phone
            has fetched; mounted before the canyon pins so the pins stay on
            top of their own lines. */}
        {showCanyonRoutes ? <CanyonRoutesLayer onStatus={setRoutesStatus} /> : null}

        {/* Recorded tracks + waypoints (Stage 7): unpinned, mounted before
            the canyon sources so canyons draw on top. */}
        <TrackMapLayers
          tracks={tracks}
          waypoints={showWaypoints ? waypoints : EMPTY_WAYPOINTS}
          liveCoord={userCoord}
          showTracks={showTracks}
          onWaypointPress={handleWaypointPress}
          onTrackPress={handleTrackPress}
        />

        {/* Navigate-to-waypoint sight line: latest fix → target. */}
        {navLineShape ? (
          <GeoJSONSource id="nav-line" data={navLineShape}>
            <Layer
              key="nav-line-layer"
              type="line"
              id="nav-line-layer"
              style={{
                lineColor: "#4285F4",
                lineWidth: 2,
                lineOpacity: 0.8,
                lineDasharray: [2, 2],
              }}
            />
          </GeoJSONSource>
        ) : null}

        {/* Canyon overlays: authed API GeoJSON — never baked into tiles
            (privacy rule). Shared under owned; one definition, also drawn by
            the canyon point-picker (CanyonPinsLayer). */}
        <CanyonPinsLayer
          ownedFc={ownedFc}
          sharedFc={sharedFc}
          onPress={handleCanyonPress}
        />

        {visibleRoutes.length > 0 ? (
          <RoutesLayer
            routes={visibleRoutes}
            hiddenRouteId={editingRouteId}
            // While a tool is collecting points every tap belongs to the tool —
            // opening an options sheet mid-draw would steal the point being
            // placed.
            onPressRoute={collectingPoints ? undefined : setOptionsRouteId}
          />
        ) : null}

        {/* The route being drawn — solid. */}
        {drawingRoute ? (
          <RouteDraftLayer
            idPrefix="route-draft"
            color={draftColor ?? undefined}
            selectedIndex={selectedAnchor}
            selectedSide={selectedAnchorSide}
            onRemoveSelected={selectedAnchor === null ? undefined : removeSelectedAnchor}
            draft={routeDraft.draft ?? emptyDraft}
            dotted={false}
            degreesPerDp={degreesPerDp(camera.zoom)}
            {...anchorHandlers(routeDraft)}
          />
        ) : null}

        {/* The measured line — dotted, and otherwise the same tool. */}
        {measuring ? (
          <RouteDraftLayer
            idPrefix="measure-draft"
            // `activeDraft` prefers the route draft, so a selection belongs to
            // measure only while route draw is off.
            selectedIndex={drawingRoute ? null : selectedAnchor}
            selectedSide={selectedAnchorSide}
            onRemoveSelected={
              drawingRoute || selectedAnchor === null ? undefined : removeSelectedAnchor
            }
            draft={measureDraft.draft ?? emptyDraft}
            dotted
            degreesPerDp={degreesPerDp(camera.zoom)}
            {...anchorHandlers(measureDraft)}
          />
        ) : null}

        {/* WHERE YOU ARE, AND WHERE YOU JUST POINTED — the two things that must
            never be drawn under anything else, re-inserted as a pair whenever
            the stack below them changes (see `topStackKey`). Order within the
            pair is the z-order: the marker, then the cursor over it. */}
        <Fragment key={topStackKey}>
          {/* Own location marker (expo-location watcher) — see
              UserLocationMarker above for why it is its own component. */}
          {dotWanted && userCoord ? (
            <UserLocationMarker
              coord={userCoord}
              markerColorId={markerColorId}
              lockUpright={followMode === "course-up"}
            />
          ) : null}

          {/* The spot the user tapped. Deliberately NOT a waypoint pin: a
              waypoint is a thing they created and kept, this is a cursor. A
              small ringed dot reads as "here is where you pointed" and
              disappears the moment the panel is dismissed. */}
          {tappedPointShape ? (
            <GeoJSONSource id="tapped-point" data={tappedPointShape}>
              <Layer
                key="tapped-point-dot"
                type="circle"
                id="tapped-point-dot"
                style={{
                  circleRadius: 5,
                  circleColor: theme.accent,
                  circleStrokeColor: "#ffffff",
                  circleStrokeWidth: 2,
                }}
              />
            </GeoJSONSource>
          ) : null}
        </Fragment>

        {/* The extent a "show on map" sent us to, outlined for ~2.5 s. Mounted
            last so it is over the basemap band and everything above it; it owns
            its own animation clock, so nothing here re-renders with it. */}
        {focusPulse ? (
          <FocusPulse bbox={focusPulse.bbox} nonce={focusPulse.nonce} />
        ) : null}
      </Map>

      {/* Place search: collapsed button top-left, expands to a full-width bar.
          Hidden while a point-collecting tool is armed — search is not usable
          mid-draw, and its slot is where the tool's own toolbar goes, which is
          what keeps the HUD from eating a third of the map. */}
      {!collectingPoints ? (
        <MapSearchBar
          topInset={insets.top}
          // Opposite the action column: the two top-corner controls flip with
          // the user's handedness together, or they end up in the same corner.
          side={controlsOnLeft ? "right" : "left"}
          reservedWidth={SEARCH_SIZE + CHROME_GAP}
          savedItems={savedSearchItems}
          onSelectPlace={handleSelectPlace}
          onSelectSaved={(item) => {
            item
              .resolveBbox()
              .then((bbox) => {
                // Nothing to fly to (a track whose points went with a wipe) is
                // not an error worth a toast — the row simply cannot answer.
                if (bbox) fitCameraToBbox(bbox);
              })
              .catch((err: unknown) => console.error(err));
          }}
        />
      ) : null}

      {/* The record button holds the corner the search pill does not, and
          leaves with it while a tool is collecting points: the draw/measure
          card now sits under this row, and a HUD that has to dodge a button
          gets pushed down the screen instead of using it. Recording is not
          interrupted by the button going away — it keeps running, and the card
          is dismissed in one tap. */}
      {collectingPoints ? null : (
      <View
        style={[
          styles.recordSlot,
          { top: insets.top + CHROME_GAP },
          controlsOnLeft ? { left: CHROME_GAP } : { right: CHROME_GAP },
        ]}
      >
        <RecordButton
          state={activeTrack?.state === "done" ? null : (activeTrack?.state ?? null)}
          // The same gate the sensors run behind: no frames for a screen
          // nobody is looking at (mobile/CLAUDE.md, Battery).
          animate={sensorsActive}
          onPress={() => {
            if (activeTrack) {
              setRecordingSheetOpen(true);
              return;
            }
            // Explicitly closed, not merely left alone: a recording discarded
            // from inside the sheet unmounts it while this flag is still true,
            // and the next one would then open onto a panel nobody asked for.
            setRecordingSheetOpen(false);
            void handleStartRecording();
          }}
          // Finishing must never require finding the panel first — cold hands,
          // wet phone, a party waiting. Same confirm as the sheet's button.
          onLongPress={
            activeTrack ? () => confirmFinishRecording(activeTrack.id) : undefined
          }
        />
      </View>
      )}

      {/* Everything that talks to the user from the top of the map stacks in
          one column, so a second message can never land on top of the first. */}
      <View style={[styles.noticeStack, { top: noticeTop }]} pointerEvents="box-none">
        {/* The recording's numbers live behind the record button now, but this
            one line cannot: a recorder that is not saving points must say so
            without being asked (MLIFE-001). Everything else about a running
            recording is a tap away; this is the exception. */}
        {activeTrack && recordingWriteFailing ? (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>
              Points aren&apos;t being saved — finish the recording and check
              free space.
            </Text>
          </View>
        ) : null}

        {/* Measure HUD — the same panel as route draw, minus Save. */}
        {measuring ? (
          <DraftToolPanel
            allowNetwork={!offlineOnly}
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
            allowNetwork={!offlineOnly}
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
            onClear={handleClearRouteDraw}
            snapMode={snapMode}
            onSnapModeChange={handleSnapModeChange}
            onSave={() => setNamingRoute(true)}
            onDiscard={() => handleCancelRouteDraw()}
            onReverse={routeDraft.reverse}
            color={draftColor}
            onColorChange={setDraftColor}
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
        {/* SAY THAT THE MODE IS ON, because everything it causes looks like a
            fault otherwise: the basemap notice below says "Offline" on a phone
            with full bars, and elevation stops answering outside saved areas.
            Sits above that notice so the cause is read before the consequence.

            Deliberately worded as SIMULATING: the phone is not offline, we are
            pretending, and the user is the one who asked us to. */}
        {offlineOnly ? (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>
              Simulating offline mode — using only what is saved on this phone
            </Text>
          </View>
        ) : null}

        {noticeText ? (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>{noticeText}</Text>
          </View>
        ) : null}

        {/* The compass is confidently wrong and nothing else on screen would
            say so — every app on the phone reads the same miscalibrated
            magnetometer, so "the other map app agrees" is not reassurance. The
            arrow, the tape and course-up are all as wrong as each other, which
            is why this sits with the map's own notices rather than next to any
            one of them. Clears itself on the next probe that reads clean. */}
        {headingWanted && magneticInterference(fieldWindow) ? (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>
              Something magnetic is affecting the compass — move the phone away
              from metal
            </Text>
          </View>
        ) : headingWanted && compassCalibration.warning ? (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>
              Compass needs calibrating — wave the phone in a figure 8
            </Text>
          </View>
        ) : null}

        {/* Error surfaces: background failures, non-blocking. */}
        {canyons.error ? (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>{canyons.error}</Text>
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
            reports here rather than only from the Saved tab.

            Counts finished MAPS, not a percentage: the queue runs one job per
            basemap in sequence, so a percentage crossed 100 % and restarted at
            zero once per chosen map — which reads as the download failing and
            starting over. "2 of 4" only ever goes up. Same banner as the other
            map notices; it used to be an accent-outlined pill that matched
            nothing else on the screen. */}
        {downloadProgress ? (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>{downloadProgress}</Text>
          </View>
        ) : null}
      </View>

      {/* One column of actions on one edge; the OTHER edge belongs to the map's
          own instruments (native compass + compass tape + scale bar). Which is
          which is the user's (Settings → Map): the two swap as a pair, because
          the point of the setting is which side the thumb reaches, and leaving
          the instruments put would only move the buttons on top of them. */}
      <View style={[styles.controls, controlsEdge]}>
        {/* THE TOOL GROUP IS AT THE TOP OF THE COLUMN, and that is a layout
            constraint rather than a preference. Its tray opens SIDEWAYS, across
            the map towards the opposite edge — which is where the instruments
            live. Third from the bottom, the tray ran straight through the
            speed/elevation chip; from the top it clears the whole stack. It is
            also the least-reached button of the four, so the two that are
            reached (layers, locate) keep the thumb end of the column. */}
        <MapToolGroup
          side={controlsOnLeft ? "left" : "right"}
          open={toolsOpen}
          activeTool={measuring ? "measure" : drawingRoute ? "route" : null}
          onToggleOpen={() => setToolsOpen((open) => !open)}
          onPickTool={handlePickTool}
        />
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
        {/* Above the compass and the scale bar: the stack reads bottom-up from
            "how far" through "which way" to "how fast and how high", and the
            two that were here first must not move when this one is switched
            on. It subscribes to its own value — a fix must not re-render this
            screen (mobile/CLAUDE.md, Battery). */}
        {speedElevationEnabled ? <SpeedElevationChip active={sensorsActive} /> : null}
        <LiveCompassStrip
          enabled={compassEnabled}
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
        {/* Elevation is derived from a DIFFERENT source than whatever basemap
            is drawn — every height in the app (point readout, route profile,
            gain/loss) comes from it, online or off, so its credit is
            unconditional rather than tied to the active layer. */}
        <Text style={styles.attributionText}>{DEM_ATTRIBUTION}</Text>
      </BottomSheet>

      {/* One waypoint's verbs, tags and canyon links. Looked up from the
          mirror by id rather than held as an object, so an edit made inside
          the sheet re-renders it instead of showing the stale copy the pin
          was tapped with. */}
      <WaypointSheet
        // Open from the moment a pin is tapped until the sheet is dismissed —
        // the trip to the point picker hides it without closing it.
        visible={openWaypoint !== null}
        waypoint={
          // Hidden, not closed, while its form is away at the point picker:
          // the sheet is a Modal and would cover the picker's map.
          openWaypoint && !waypointPickerAway
            ? ((mirrorWaypoints.data ?? []).find(
                (row) => row.id === openWaypoint.id,
              ) ?? null)
            : null
        }
        userCoord={userCoord}
        autoEdit={openWaypoint?.autoEdit ?? false}
        draft={waypointDraft}
        picked={waypointPicked}
        onPickOnMap={openWaypointPicker}
        onClose={() => {
          setOpenWaypoint(null);
          setWaypointDraft(null);
          setWaypointPicked(null);
        }}
        onNavigate={startNavigatingTo}
        onInfo={(message) => notify(message, "info")}
        onError={(message) => notify(message, "error")}
      />

      {/* Tap: "what's there?" — the question that comes before the long
          press's "something goes here". */}
      <MapPointSheet
        allowNetwork={!offlineOnly}
        point={tappedPoint}
        userCoord={userCoord}
        onClose={() => setTappedPoint(null)}
        onNavigate={navigateToPoint}
        onDropWaypoint={dropWaypointAt}
        onInfo={(text) => notify(text, "info")}
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

      {/* ONE form for both modes (DESIGN.md §7): a long-press drops a new
          canyon here, and "Edit canyon" in the pin's options sheet reopens the
          same fields on an existing one. The two states are mutually exclusive
          — each entry point clears the other. */}
      <CanyonEditSheet
        visible={addCanyonAt !== null || editingCanyon !== null}
        canyon={editingCanyon}
        initialCoords={addCanyonAt}
        onClose={() => {
          setAddCanyonAt(null);
          setEditingCanyon(null);
        }}
        onSaved={(text) => notify(text, "info")}
        onFailed={(text) => notify(text, "error")}
      />

      {/* One canyon's verbs, from the pin the user tapped — the same sheet the
          Canyons list opens, minus its "Show on map" row. */}
      <CanyonOptionsSheet
        canyon={optionsCanyon}
        visible={optionsCanyon !== null}
        onClose={() => setOptionsCanyonId(null)}
        onOpenCanyon={(canyon) => onOpenCanyon(canyon.id, canyon.name)}
        onLogTrip={(canyon) => {
          setAddCanyonAt(null);
          setLoggingCanyon(canyon);
        }}
        onEdit={(canyon) => {
          setAddCanyonAt(null);
          setEditingCanyon(canyon);
        }}
        onInfo={(text) => notify(text, "info")}
        onError={(text) => notify(text, "error")}
      />

      {/* Logging from a pin: the same trip form the Canyons list opens, with
          this canyon already linked. */}
      <TripEditSheet
        online={connectivity === "online"}
        visible={loggingCanyon !== null}
        canyons={canyons.data ?? []}
        initialCanyons={
          loggingCanyon ? [{ id: loggingCanyon.id, name: loggingCanyon.name }] : undefined
        }
        existingTypes={tripTypes}
        onClose={() => setLoggingCanyon(null)}
        onSaved={(text) => notify(text, "info")}
        onFailed={(text) => notify(text, "error")}
      />

      {/* Tapping a route line opens its VERBS; the stats are a sub-mode one tap
          in (DESIGN.md §7). No "Show on map" row here — the user is looking at
          the line they just tapped. */}
      <RouteOptionsSheet
        route={optionsRoute}
        visible={optionsRoute !== null}
        onClose={() => setOptionsRouteId(null)}
        allowNetwork={!offlineOnly}
        onEdit={() => {
          const target = optionsRoute;
          setOptionsRouteId(null);
          if (target) openRouteForEditing(target);
        }}
        onInfo={(text) => notify(text, "info")}
        onError={(text) => notify(text, "error")}
      />

      {/* One recorded track's verbs — the same list Saved offers, from the
          line the user actually tapped. */}
      {/* The live recording's numbers and verbs. It renders nothing at all
          without an active track, so finishing from inside it takes the sheet
          with it — the alert has already confirmed, and there is nothing left
          to slide away from. */}
      <RecordingSheet
        activeTrack={activeTrack ?? null}
        visible={recordingSheetOpen && activeTrack != null}
        onClose={() => setRecordingSheetOpen(false)}
        allowNetwork={!offlineOnly}
      />

      {/* A finished track's verbs, from the line the user tapped. Its stats are
          a sub-mode one tap in, and there is no "Show on map" row — the line is
          already on screen. */}
      <TrackOptionsSheet
        track={tracks.find((track) => track.id === optionsTrackId) ?? null}
        visible={optionsTrackId !== null}
        onClose={() => setOptionsTrackId(null)}
        allowNetwork={!offlineOnly}
        onContinueRecording={(track) => void handleContinueRecording(track)}
        onInfo={(text) => notify(text, "info")}
        onError={(text) => notify(text, "error")}
      />

      {/* An imported file's verbs, from the features the user tapped. Same
          sheet Saved's ⋯ opens, minus its "Show on map" row. */}
      <ImportOptionsSheet
        imported={imports.find((row) => row.id === optionsImportId) ?? null}
        visible={optionsImportId !== null}
        onClose={() => setOptionsImportId(null)}
        allowNetwork={!offlineOnly}
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
        layers={layerToggles}
        showOverlays={showOverlays}
        onShowOverlaysChange={setShowOverlays}
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
  // Centred, because the banner is centre-anchored (`alignSelf`) and grows
  // around its own midline — left-aligned text in a box that moves under it
  // reads as drifting, and these wrap to two lines at large text sizes.
  noticeText: { color: theme.textPrimary, fontSize: fontSize.sm, textAlign: "center" },
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
  // Top corner, on the action column's edge. It is the one control that has to
  // be findable while a recording runs, so it does not live in the column that
  // scrolls tools sideways over itself.
  recordSlot: { position: "absolute" },
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
  // Pill shape for "something is being done to this map" notices.
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
