// Map core (Stage 2, online) — full-bleed map with raster basemaps, canyon
// overlay (owned vs shared theming), raster topo overlays, tap → detail,
// locate-me. Every tile source flows through the resolver so Stage 4 offline
// downloads change data, not this screen.
//
// Deferred to the vector-overlay pass: contours/features PMTiles layers with
// the applyVectorPaint port (raster overlays render now); Protomaps vector
// basemap awaits the operator's CDN extract.
import { useCallback, useMemo, useRef, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import {
  Camera,
  CircleLayer,
  MapView,
  RasterLayer,
  ShapeSource,
  SymbolLayer,
  UserLocation,
} from "@maplibre/maplibre-react-native";
import * as Location from "expo-location";
import { BASEMAP_CATALOG } from "@logjam/shared";

import { apiFetch } from "../api/apiFetch";
import { getCanyons, getSharedCanyons, useApiQuery } from "../api/queries";
import type { TCanyon } from "../api/types";
import { config } from "../config";
import { fontSize, radius, spacing, theme } from "../theme";
import { useConnectivity } from "./connectivity";
import { ResolvedSource } from "./ResolvedSource";
import {
  resolveMapSource,
  type BasemapId,
  type ResolveContext,
} from "./sourceResolver";
import {
  composeTopoOverlayRefs,
  type CompletedOverlaysResponse,
} from "./topoOverlays";

// Same shell approach as web Map.tsx: empty style + glyphs only; every source
// and layer is declarative on top. Must be an OBJECT — a JSON string is
// treated as a style URL by the native side, which drops the glyphs entry and
// silently kills every SymbolLayer's text.
const SHELL_STYLE = {
  version: 8,
  sources: {},
  layers: [
    // A background layer so the style is never empty — matches the primary
    // surface colour while tiles load.
    { id: "background", type: "background", paint: { "background-color": "#4E4944" } },
  ],
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
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

export function MapScreen({
  onOpenCanyon,
}: {
  onOpenCanyon: (canyonId: string, name: string) => void;
}) {
  const connectivity = useConnectivity();
  const [basemapId, setBasemapId] = useState<BasemapId>("six-topo");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [enabledOverlays, setEnabledOverlays] = useState<ReadonlySet<string>>(new Set());
  const cameraRef = useRef<React.ComponentRef<typeof Camera>>(null);
  const [followUser, setFollowUser] = useState(false);
  const [locationGranted, setLocationGranted] = useState(false);

  const owned = useApiQuery(getCanyons, "Couldn't load canyons.");
  const shared = useApiQuery(getSharedCanyons, "Couldn't load shared canyons.");
  const overlays = useApiQuery(getCompletedOverlays, "Couldn't load topo overlays.");

  const ctx: ResolveContext = useMemo(
    () => ({
      connectivity,
      artifacts: [], // Stage 4 fills the downloads registry
      cdnBaseUrl: config.topoCdnBaseUrl,
    }),
    [connectivity],
  );

  const basemapResolved = useMemo(
    () => resolveMapSource({ kind: "basemap", basemapId }, ctx),
    [basemapId, ctx],
  );

  const overlayRefs = useMemo(
    () =>
      overlays.data
        ? composeTopoOverlayRefs(overlays.data, enabledOverlays)
        : [],
    [overlays.data, enabledOverlays],
  );

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

  const handleLocateMe = useCallback(async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") return;
    setLocationGranted(true);
    setFollowUser(true);
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
        style={styles.map}
        mapStyle={SHELL_STYLE}
        attributionEnabled={false}
        logoEnabled={false}
        onPress={() => setFollowUser(false)}
      >
        <Camera
          ref={cameraRef}
          defaultSettings={{ centerCoordinate: DEFAULT_CENTER, zoomLevel: DEFAULT_ZOOM }}
          followUserLocation={followUser}
          followZoomLevel={13}
        />

        {/* layerIndex pins z-order across remounts: a swapped basemap source
            re-adds its layer at the TOP of the stack, burying the canyon
            layers — explicit indexes (background=0, basemap=1, overlays 2+)
            keep rasters underneath while canyon layers stay on top. */}
        {basemapResolved.map((resolved) =>
          resolved.status === "ok" ? (
            <ResolvedSource key={resolved.key} resolved={resolved}>
              <RasterLayer
                id={`basemap-layer-${resolved.key}`}
                layerIndex={1}
                style={{ rasterOpacity: 1 }}
              />
            </ResolvedSource>
          ) : null,
        )}

        {/* Raster topo overlays (vector overlays land with the paint port). */}
        {overlayRefs
          .filter((ref) => ref.format === "raster")
          .flatMap((ref, refIndex) =>
            resolveMapSource(ref, ctx).map((resolved) =>
              resolved.status === "ok" ? (
                <ResolvedSource key={resolved.key} resolved={resolved}>
                  <RasterLayer
                    id={`topo-layer-${resolved.key}`}
                    layerIndex={2 + refIndex}
                    style={{ rasterOpacity: 0.8 }}
                  />
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
              // KNOWN ISSUE (Stage 2): SymbolLayer text does not render in the
              // MLRN 10.4.2 Android dev-client — zero glyph fetches even with a
              // literal textField, on both architectures. Circles/tap work.
              // Tracked in PROGRESS.md; revisit with a minimal repro / MLRN
              // upgrade. Code below is the intended label spec.
              textField: CANYON_LABEL_EXPR as unknown as string,
              textFont: ["Open Sans Semibold"],
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
              // KNOWN ISSUE (Stage 2): SymbolLayer text does not render in the
              // MLRN 10.4.2 Android dev-client — zero glyph fetches even with a
              // literal textField, on both architectures. Circles/tap work.
              // Tracked in PROGRESS.md; revisit with a minimal repro / MLRN
              // upgrade. Code below is the intended label spec.
              textField: CANYON_LABEL_EXPR as unknown as string,
              textFont: ["Open Sans Semibold"],
              textSize: 12,
              textColor: theme.textPrimary,
              textHaloColor: theme.bonus2,
              textHaloWidth: 1,
              textAnchor: "top",
              textOffset: [0, 0.8],
            }}
          />
        </ShapeSource>

        {locationGranted ? <UserLocation /> : null}
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
                        {overlay.format === "vector" ? "  (vector — soon)" : ""}
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
  pickerLabel: { color: theme.textPrimary, fontSize: fontSize.base },
  pickerLabelActive: { color: theme.accent, fontWeight: "600" },
  pickerLabelDisabled: { color: theme.textMuted },
});
