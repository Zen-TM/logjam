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
import { Alert, Linking, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import {
  Camera,
  CircleLayer,
  Images,
  MapView,
  RasterLayer,
  ShapeSource,
  SymbolLayer,
} from "@maplibre/maplibre-react-native";
import * as Location from "expo-location";
import {
  BASEMAP_CATALOG,
  VECTOR_STYLE_DEFAULTS,
  messageFromError,
} from "@logjam/shared";

import { apiFetch } from "../api/apiFetch";
import {
  getCanyons,
  getSharedCanyons,
  getVectorStyle,
  useApiQuery,
} from "../api/queries";
import type { TCanyon } from "../api/types";
import { config } from "../config";
import { fontSize, radius, spacing, theme } from "../theme";
import {
  deleteRegionArtifact,
  downloadProtomapsRegion,
} from "../offline/regionDownloads";
import { useMapArtifacts } from "../offline/useMapArtifacts";
import { ProtomapsLayers, protomapsLayerCount } from "./basemap/ProtomapsLayers";
import { useConnectivity } from "./connectivity";
import { ResolvedSource, sourceIdFor } from "./ResolvedSource";
import {
  resolveMapSource,
  type BasemapId,
  type ResolveContext,
} from "./sourceResolver";
import {
  composeTopoOverlayRefs,
  type CompletedOverlaysResponse,
  type TopoOverlayRef,
} from "./topoOverlays";
import { buildTopoVectorLayerDefs } from "./topoVectorLayers";
import { TopoIconImages, TopoVectorOverlay } from "./TopoVectorOverlay";

// Same shell approach as web Map.tsx: empty style + glyphs/sprite only; every
// source and layer is declarative on top. Must be an OBJECT — a JSON string is
// treated as a style URL by the native side, which drops the glyphs entry and
// silently kills every SymbolLayer's text.
//
// Glyphs + sprite come from the Protomaps basemaps-assets host (fonts: the
// Noto Sans stacks the generated basemap layers reference — canyon labels use
// the same stack so one glyph source serves everything). No user data rides
// these requests. Stage 4 bundles the assets in-app (file:// URLs, stage4a
// §8.3); a CDN mirror under master/basemap/assets/ is the flagged operator
// follow-up for a self-hosted online posture.
const BASEMAP_ASSETS_BASE = "https://protomaps.github.io/basemaps-assets";
// Light flavor everywhere for now — matches the paper-topo look of the SIX
// rasters; the dark JSON ships alongside for a later theme pass.
const PROTOMAPS_FLAVOR = "light" as const;
const SHELL_STYLE = {
  version: 8,
  sources: {},
  layers: [
    // A background layer so the style is never empty — matches the primary
    // surface colour while tiles load.
    { id: "background", type: "background", paint: { "background-color": "#4E4944" } },
  ],
  glyphs: `${BASEMAP_ASSETS_BASE}/fonts/{fontstack}/{range}.pbf`,
  sprite: `${BASEMAP_ASSETS_BASE}/sprites/v4/${PROTOMAPS_FLAVOR}`,
};

// Blue Mountains default view (matches the app's home turf).
const DEFAULT_CENTER: [number, number] = [150.31, -33.7];
const DEFAULT_ZOOM = 9;

// Web canyon colours (Map.tsx applyCanyonThemePaint fallbacks).
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
}: {
  onOpenCanyon: (canyonId: string, name: string) => void;
}) {
  // "Offline maps only" forces the resolver to local artifacts even with
  // signal — battery saver + predictability in the field.
  const [offlineOnly, setOfflineOnly] = useState(false);
  const connectivity = useConnectivity(offlineOnly);
  const artifacts = useMapArtifacts();
  const [basemapId, setBasemapId] = useState<BasemapId>("six-topo");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [regionStatus, setRegionStatus] = useState<string | null>(null);
  const mapRef = useRef<React.ComponentRef<typeof MapView>>(null);
  const [enabledOverlays, setEnabledOverlays] = useState<ReadonlySet<string>>(new Set());
  const cameraRef = useRef<React.ComponentRef<typeof Camera>>(null);
  const [followUser, setFollowUser] = useState(false);
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

  const owned = useApiQuery(getCanyons, "Couldn't load canyons.");
  const shared = useApiQuery(getSharedCanyons, "Couldn't load shared canyons.");
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

  const overlayRefs = useMemo(
    () =>
      overlays.data
        ? composeTopoOverlayRefs(overlays.data, enabledOverlays)
        : [],
    [overlays.data, enabledOverlays],
  );

  // Contiguous layerIndex allocation above the basemap band: raster overlays
  // take one slot, vector overlays exactly as many slots as their layer defs —
  // no gaps, so no index ever exceeds the mounted layer count.
  const overlayRenderPlan = useMemo(() => {
    let next = overlayBaseIndex;
    return overlayRefs.map((ref) => {
      const start = next;
      next +=
        ref.format === "vector"
          ? buildTopoVectorLayerDefs(overlayKind(ref), vectorStyle).length
          : 1;
      return { ref, start };
    });
  }, [overlayRefs, overlayBaseIndex, vectorStyle]);

  const ownedFc = useMemo(
    () => toFeatureCollection(owned.data?.data ?? []),
    [owned.data],
  );
  const sharedFc = useMemo(
    () => toFeatureCollection(shared.data ?? []),
    [shared.data],
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

  // Download the visible map area as a Protomaps offline region (stage4a
  // §7.2). The bbox goes to the API in a POST body only; see regionDownloads.
  const handleDownloadCurrentArea = useCallback(async () => {
    try {
      setRegionStatus("Preparing region…");
      const bounds = await mapRef.current?.getVisibleBounds();
      if (!bounds) throw new Error("Map not ready");
      const [[neLng, neLat], [swLng, swLat]] = bounds;
      const bbox = { west: swLng, south: swLat, east: neLng, north: neLat };
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
  }, []);

  const regionArtifacts = artifacts.filter((a) => a.kind === "basemap-region");

  const handleLocateMe = useCallback(async () => {
    // Non-prompting check first: requestForegroundPermissionsAsync has been
    // observed to hang on-device even when the permission is already granted.
    let { status, canAskAgain } = await Location.getForegroundPermissionsAsync();
    if (status !== "granted") {
      ({ status, canAskAgain } = await Location.requestForegroundPermissionsAsync());
    }
    if (status !== "granted") {
      // Android silently auto-denies after one refusal (canAskAgain=false) —
      // the only path back is app settings. Never fail silently.
      Alert.alert(
        "Location permission needed",
        canAskAgain
          ? "Allow location access to show your position on the map."
          : "Location was previously denied. Enable it for Logjam in system settings.",
        canAskAgain
          ? undefined
          : [
              { text: "Cancel", style: "cancel" },
              { text: "Open settings", onPress: () => Linking.openSettings() },
            ],
      );
      return;
    }
    // Drive the dot from expo-location directly — MLRN's built-in
    // UserLocation engine produced no updates on-device (silent), and we
    // need expo-location's watcher for Stage 7 track recording anyway.
    if (locationWatch.current) {
      // Toggle off.
      locationWatch.current.remove();
      locationWatch.current = null;
      headingWatch.current?.remove();
      headingWatch.current = null;
      setUserHeading(null);
      setFollowUser(false);
      return;
    }
    setFollowUser(true);
    firstFix.current = true;

    const applyFix = (position: Location.LocationObject, fly: boolean) => {
      const coord: [number, number] = [
        position.coords.longitude,
        position.coords.latitude,
      ];
      setUserCoord(coord);
      setUserAccuracyM(position.coords.accuracy ?? null);
      if (fly && firstFix.current) {
        firstFix.current = false;
        cameraRef.current?.setCamera({
          centerCoordinate: coord,
          zoomLevel: 14,
          animationDuration: 1200,
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

  const overlayList = overlays.data
    ? overlays.data.jobs.flatMap((job) =>
        job.layers.map((layer) => ({
          key: `${job.jobId}/${layer.name}`,
          label: `${job.name ?? job.jobId.slice(0, 8)} — ${layer.name}`,
          format: layer.format,
        })),
      )
    : [];

  return (
    <View style={styles.root}>
      <MapView
        ref={mapRef}
        style={styles.map}
        mapStyle={SHELL_STYLE}
        attributionEnabled={false}
        logoEnabled={false}
        onPress={() => setFollowUser(false)}
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
        {overlayRenderPlan.flatMap(({ ref, start }) =>
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
      {owned.error ? (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>{owned.error}</Text>
        </View>
      ) : null}

      <View style={styles.controls}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Choose layers"
          style={styles.controlButton}
          onPress={() => setPickerOpen(true)}
        >
          <Text style={styles.controlGlyph}>≡</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Locate me"
          style={[styles.controlButton, followUser && styles.controlActive]}
          onPress={handleLocateMe}
        >
          <Text style={styles.controlGlyph}>◎</Text>
        </Pressable>
      </View>

      {/* Attribution (plain text, required by providers). */}
      <View style={styles.attribution} pointerEvents="none">
        <Text style={styles.attributionText} numberOfLines={2}>
          {basemapResolved
            .map((r) => (r.status === "ok" ? r.attribution : null))
            .filter(Boolean)
            .join(" · ")}
        </Text>
      </View>

      <Modal
        visible={pickerOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setPickerOpen(false)}
      >
        <Pressable style={styles.pickerBackdrop} onPress={() => setPickerOpen(false)}>
          <View style={styles.pickerSheet}>
            <Text style={styles.pickerHeading}>Basemap</Text>
            {[...BASEMAP_CATALOG.map((e) => ({ id: e.id as BasemapId, name: e.name }))].map(
              (entry) => {
                const unavailable =
                  connectivity !== "online" &&
                  !BASEMAP_CATALOG.find((e) => e.id === entry.id)?.offlineCapable;
                return (
                  <Pressable
                    key={entry.id}
                    disabled={unavailable}
                    accessibilityRole="button"
                    onPress={() => {
                      setBasemapId(entry.id);
                      setPickerOpen(false);
                    }}
                    style={styles.pickerRow}
                  >
                    <Text
                      style={[
                        styles.pickerLabel,
                        entry.id === basemapId && styles.pickerLabelActive,
                        unavailable && styles.pickerLabelDisabled,
                      ]}
                    >
                      {entry.name}
                      {unavailable ? "  (online only)" : ""}
                    </Text>
                  </Pressable>
                );
              },
            )}
            <Text style={styles.pickerHeading}>Offline maps</Text>
            <Pressable
              accessibilityRole="switch"
              accessibilityState={{ checked: offlineOnly }}
              onPress={() => setOfflineOnly((v) => !v)}
              style={styles.pickerRow}
            >
              <Text style={[styles.pickerLabel, offlineOnly && styles.pickerLabelActive]}>
                {offlineOnly ? "☑" : "☐"} Offline maps only
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={connectivity !== "online"}
              onPress={handleDownloadCurrentArea}
              style={styles.pickerRow}
            >
              <Text
                style={[
                  styles.pickerLabel,
                  connectivity !== "online" && styles.pickerLabelDisabled,
                ]}
              >
                ⤓ Download current area (Topo Vector)
              </Text>
            </Pressable>
            {regionStatus ? (
              <Text style={styles.pickerStatus}>{regionStatus}</Text>
            ) : null}
            {regionArtifacts.map((artifact) => (
              <View key={artifact.id} style={styles.pickerRegionRow}>
                <Text style={styles.pickerLabel}>
                  ▣ Saved region · {(artifact.sizeBytes / 1024 / 1024).toFixed(1)} MB
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Delete saved region"
                  onPress={() => {
                    deleteRegionArtifact(artifact.id).catch(console.error);
                  }}
                >
                  <Text style={styles.pickerDelete}>Delete</Text>
                </Pressable>
              </View>
            ))}
            {overlayList.length > 0 ? (
              <>
                <Text style={styles.pickerHeading}>Topo overlays</Text>
                {overlayList.map((overlay) => {
                  const enabled = enabledOverlays.has(overlay.key);
                  return (
                    <Pressable
                      key={overlay.key}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: enabled }}
                      onPress={() =>
                        setEnabledOverlays((prev) => {
                          const next = new Set(prev);
                          if (enabled) next.delete(overlay.key);
                          else next.add(overlay.key);
                          return next;
                        })
                      }
                      style={styles.pickerRow}
                    >
                      <Text
                        style={[styles.pickerLabel, enabled && styles.pickerLabelActive]}
                      >
                        {enabled ? "☑" : "☐"} {overlay.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </>
            ) : null}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.primary },
  map: { flex: 1 },
  notice: {
    position: "absolute",
    top: spacing(2),
    alignSelf: "center",
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: radius.md,
    paddingHorizontal: spacing(2),
    paddingVertical: spacing(1),
  },
  noticeText: { color: theme.textPrimary, fontSize: fontSize.sm },
  controls: {
    position: "absolute",
    right: spacing(2),
    bottom: spacing(5),
    gap: spacing(1),
  },
  controlButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: theme.secondary,
    alignItems: "center",
    justifyContent: "center",
  },
  controlActive: { backgroundColor: theme.accent },
  controlGlyph: { color: theme.textPrimary, fontSize: 22 },
  attribution: {
    position: "absolute",
    bottom: spacing(0.5),
    left: spacing(1),
    right: spacing(1),
  },
  attributionText: { color: theme.textMuted, fontSize: 9 },
  pickerBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  pickerSheet: {
    backgroundColor: theme.primary,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing(2),
    gap: spacing(0.5),
    maxHeight: "70%",
  },
  pickerHeading: {
    fontSize: fontSize.xs,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    color: theme.textMuted,
    marginTop: spacing(1),
  },
  pickerRow: { paddingVertical: spacing(1) },
  pickerRegionRow: {
    paddingVertical: spacing(1),
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  pickerStatus: { color: theme.textMuted, fontSize: fontSize.sm },
  pickerDelete: { color: theme.warning, fontSize: fontSize.sm, fontWeight: "600" },
  pickerLabel: { color: theme.textPrimary, fontSize: fontSize.base },
  pickerLabelActive: { color: theme.accent, fontWeight: "600" },
  pickerLabelDisabled: { color: theme.textMuted },
});
