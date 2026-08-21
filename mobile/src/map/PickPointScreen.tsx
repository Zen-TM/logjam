// "Select on map" — put a marker where the thing is, and hand the coordinates
// back to the form that asked.
//
// TWO forms ask: adding a canyon (Canyons tab) and typing a waypoint from a
// coordinate (Saved tab). One screen, because "where is it" is the same
// question and a second copy is how the two would end up with different
// basemaps and different reference layers.
//
// A SCREEN, not a mode of the add sheet, and that is forced rather than chosen:
// a `BottomSheet` is an RN `Modal`, which renders in its own window above the
// whole app, so a map drawn behind it would be invisible. Navigating away is
// what lets the map have the screen — and the form is not lost, because
// the host screen keeps its sheet mounted and re-opens it in the state the user
// left it (see `resuming` in `CanyonEditSheet`).
//
// WHAT IT DRAWS, and why that list:
//
//   Basemaps — all of them, down the side, because which rendering you are
//     looking at is most of what makes a spot identifiable. A cliffline on the
//     topo, a creek junction on the imagery and a track on the vector map are
//     three different ways to be sure, and switching between them is the whole
//     reason this screen is not just a coordinate field.
//   Your own things — canyons, waypoints, tracks and routes, all on. They are
//     the reference that answers "is this the one I already have?" and "does
//     this line go where I think it does".
//   NOT GeoPDFs, and not the topo overlay band. A GeoPDF is an opaque sheet of
//     paper over the map — exactly what you do not want while aiming at a
//     point — and the overlay band's layer-index allocation belongs to
//     `MapScreen`, where it is arithmetic against the basemap's own layer
//     count. Neither is worth a switch here: a picker that needs configuring
//     before it can be used is a second screen wearing one screen's clothes.
//
// PRIVACY: canyon names and coordinates are drawn from the local mirror and
// never leave the device. The picked point is returned in memory
// (`pickedPoint.ts`) and reaches the server only if the user saves the canyon,
// through the outbox's authed push like any other write.
import { useCallback, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { NativeSyntheticEvent } from "react-native";
import {
  Camera,
  GeoJSONSource,
  Layer,
  Map,
  type MapRef,
  type PressEvent,
} from "@maplibre/maplibre-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { config } from "../config";
import { fontSize, fontWeight, radius, scrim, spacing, theme } from "../theme";
import { Button } from "../ui";
import { useMirrorCanyons, useMirrorRoutes, useMirrorWaypoints } from "../sync/useSyncQueries";
import { useMapArtifacts } from "../offline/useMapArtifacts";
import { useConnectivity } from "./connectivity";
import { useTracks } from "../tracks/useTracks";
import { waypointSymbol } from "./waypointSymbol";
import { BasemapThumb } from "./BasemapThumb";
import { MOBILE_BASEMAPS } from "./basemapMeta";
import { readBasemapPreference } from "./basemapPreference";
import { useBasemapAssets } from "./basemap/basemapAssets";
import { ProtomapsLayers } from "./basemap/ProtomapsLayers";
import { buildShellStyle } from "./basemap/shellStyle";
import {
  CanyonPinsLayer,
  toCanyonFeatureCollection,
} from "./CanyonPinsLayer";
import { readLastMapCamera } from "./lastCamera";
import { DEFAULT_CENTER, DEFAULT_ZOOM } from "./mapChrome";
import { ResolvedSource, sourceIdFor } from "./ResolvedSource";
import { RoutesLayer } from "./RoutesLayer";
import {
  resolveMapSource,
  type BasemapId,
  type ResolveContext,
} from "./sourceResolver";
import { TrackMapLayers } from "../tracks/TrackMapLayers";
import type { Waypoint } from "../tracks/tracksDb";

/** The selection ring's width, and the amount its radius has to exceed the
 *  thumb's for the two curves to sit concentric. */
const THUMB_RING = 2;

/** Matches `MapScreen`'s — the two maps must render the same vector basemap. */
const PROTOMAPS_FLAVOR = "light" as const;

/** Zoom for a picker opened on a coordinate someone already typed: close enough
 *  to see which side of the creek the point is on. */
const TYPED_POINT_ZOOM = 15;

export type PickedPoint = { latitude: number; longitude: number };

export function PickPointScreen({
  initialPoint,
  subject,
  hideWaypointId = null,
  onCancel,
  onConfirm,
}: {
  /** A coordinate already in the form, if any — the picker opens on it with the
   *  marker already placed, so "nudge what I typed" is one drag. */
  initialPoint: PickedPoint | null;
  /**
   * What is being placed, for the hint: "Tap where the canyon is". Naming the
   * thing matters because the screen is reached from two different forms and
   * arrives with no other context on it.
   */
  subject: "canyon" | "waypoint";
  /**
   * The waypoint being MOVED, which must not draw itself.
   *
   * Its pin sits exactly where the dropped point starts, so leaving it in put a
   * labelled waypoint under the cursor that does not move with it — two markers
   * for one thing, the stale one wearing the name. Every OTHER waypoint stays:
   * "not on top of the one next to it" is half of why this screen exists.
   */
  hideWaypointId?: string | null;
  onCancel: () => void;
  onConfirm: (point: PickedPoint) => void;
}) {
  const insets = useSafeAreaInsets();
  // Read once: `initialViewState` is only honoured on the first render, and
  // re-reading the module store mid-session would move a map the user is
  // already panning. Same rule as RegionDownloadScreen.
  const lastCamera = useRef(readLastMapCamera()).current;
  const [basemapId, setBasemapId] = useState<BasemapId>(
    () => lastCamera?.basemapId ?? readBasemapPreference(),
  );
  const [picked, setPicked] = useState<PickedPoint | null>(initialPoint);
  const mapRef = useRef<MapRef>(null);

  const startCenter: [number, number] = initialPoint
    ? [initialPoint.longitude, initialPoint.latitude]
    : (lastCamera?.center ?? DEFAULT_CENTER);
  const startZoom = initialPoint
    ? TYPED_POINT_ZOOM
    : (lastCamera?.zoom ?? DEFAULT_ZOOM);

  const basemapAssets = useBasemapAssets();
  const shellStyle = useMemo(
    () => buildShellStyle(basemapAssets.localBaseUrl, PROTOMAPS_FLAVOR),
    [basemapAssets.localBaseUrl],
  );

  // Saved regions count here exactly as they do on the map: a picker that only
  // worked with signal would be useless at the trailhead, which is where a
  // canyon most often gets added.
  const { artifacts } = useMapArtifacts();
  const connectivity = useConnectivity();
  const ctx: ResolveContext = useMemo(
    () => ({ connectivity, artifacts, cdnBaseUrl: config.topoCdnBaseUrl }),
    [connectivity, artifacts],
  );
  const basemapResolved = useMemo(
    () => resolveMapSource({ kind: "basemap", basemapId }, ctx),
    [basemapId, ctx],
  );

  const canyons = useMirrorCanyons();
  const ownedFc = useMemo(
    () =>
      toCanyonFeatureCollection(
        (canyons.data ?? []).filter((canyon) => canyon.syncRole === "owner"),
      ),
    [canyons.data],
  );
  const sharedFc = useMemo(
    () =>
      toCanyonFeatureCollection(
        (canyons.data ?? []).filter((canyon) => canyon.syncRole === "shared"),
      ),
    [canyons.data],
  );

  const mirrorWaypoints = useMirrorWaypoints();
  const waypoints: Waypoint[] = useMemo(
    () =>
      (mirrorWaypoints.data ?? [])
        .filter((wp) => wp.id !== hideWaypointId)
        .map((wp) => ({
          id: wp.id,
          name: wp.name,
          lon: wp.longitude,
          lat: wp.latitude,
          createdAt: wp.createdAt,
          color: waypointSymbol(wp).color,
        })),
    [hideWaypointId, mirrorWaypoints.data],
  );
  const { tracks } = useTracks();
  const routes = useMirrorRoutes();

  const markerShape = useMemo<GeoJSON.FeatureCollection | null>(
    () =>
      picked
        ? {
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                properties: {},
                geometry: {
                  type: "Point",
                  coordinates: [picked.longitude, picked.latitude],
                },
              },
            ],
          }
        : null,
    [picked],
  );

  // A plain tap places the point. No press-and-hold: this screen does exactly
  // one thing, so making the gesture a deliberate one would be ceremony — and
  // the two buttons below are what makes a mis-tap free to correct.
  const handleMapPress = useCallback(
    (event: NativeSyntheticEvent<PressEvent>) => {
      const [longitude, latitude] = event.nativeEvent.lngLat;
      setPicked({ latitude, longitude });
    },
    [],
  );

  return (
    <View style={styles.root}>
      <Map
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        mapStyle={shellStyle}
        attribution={false}
        logo={false}
        compass={false}
        onPress={handleMapPress}
      >
        <Camera initialViewState={{ center: startCenter, zoom: startZoom }} />

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
                  key={`pick-basemap-${resolved.key}`}
                  type="raster"
                  id={`pick-basemap-${resolved.key}`}
                  layerIndex={1}
                  style={{ rasterOpacity: 1 }}
                />
              )}
            </ResolvedSource>
          ) : null,
        )}

        {/* Reference only — none of these is pressable here, because every tap
            on this screen means "the canyon is there". */}
        <TrackMapLayers
          tracks={tracks}
          waypoints={waypoints}
          liveCoord={null}
          showTracks
          onWaypointPress={noop}
          onTrackPress={noop}
        />
        <RoutesLayer routes={routes.data ?? EMPTY_ROUTES} hiddenRouteId={null} />
        <CanyonPinsLayer ownedFc={ownedFc} sharedFc={sharedFc} idPrefix="pick-" />

        {/* The dropped point: a ringed dot in the accent — the same cursor the
            map draws for "here is where you pointed", not a canyon pin. Nothing
            has been saved yet, and a pin would say otherwise. */}
        {markerShape ? (
          <GeoJSONSource id="pick-point" data={markerShape}>
            <Layer
              key="pick-point-dot"
              type="circle"
              id="pick-point-dot"
              style={{
                circleRadius: 8,
                circleColor: theme.accent,
                circleStrokeColor: "#ffffff",
                circleStrokeWidth: 3,
              }}
            />
          </GeoJSONSource>
        ) : null}
      </Map>

      {/* Basemaps down the side the action column is NOT on, mirroring the map
          screen's own split so the two feel like the same map. */}
      <View style={[styles.basemaps, { top: insets.top + spacing(2) }]}>
        {MOBILE_BASEMAPS.map((id) => (
          <Pressable
            key={id}
            accessibilityRole="button"
            accessibilityLabel={`Use the ${id} basemap`}
            accessibilityState={{ selected: id === basemapId }}
            style={[styles.thumb, id === basemapId && styles.thumbActive]}
            onPress={() => setBasemapId(id)}
          >
            <BasemapThumb basemapId={id} />
          </Pressable>
        ))}
      </View>

      <View style={[styles.hint, { top: insets.top + spacing(2) }]} pointerEvents="none">
        <Text style={styles.hintText}>
          {picked ? "Tap again to move the point" : `Tap where the ${subject} is`}
        </Text>
      </View>

      {/* NO `insets.bottom` here: this screen is pushed inside a tab stack, so
          the tab bar is already sitting below it and has already taken the
          gesture inset. Adding it again floated the buttons a full navigation
          bar's height above the tabs. */}
      <View style={styles.actions}>
        <View style={styles.action}>
          <Button label="Cancel" variant="outlineAccent" onPress={onCancel} />
        </View>
        <View style={styles.action}>
          <Button
            label="Use this point"
            icon="check"
            // Absent-minded taps aside, there is nothing to confirm without a
            // point — and a button that exists only to refuse is worse than a
            // disabled one saying why (DESIGN.md §7), which is what the hint
            // above is for.
            disabled={picked == null}
            onPress={() => picked && onConfirm(picked)}
          />
        </View>
      </View>
    </View>
  );
}

function noop() {}

/** Stable empty list — a fresh `[]` per render defeats RoutesLayer's memo. */
const EMPTY_ROUTES: never[] = [];

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.primary },
  basemaps: {
    position: "absolute",
    right: spacing(2),
    gap: spacing(1),
  },
  // The ring has to be ROUNDER than the tile it wraps, by exactly its own
  // width, or its corners cut across the thumb's — a 4 px ring around an 8 px
  // tile left a visible notch at each corner.
  thumb: {
    borderRadius: radius.md + THUMB_RING,
    borderWidth: THUMB_RING,
    borderColor: "transparent",
    overflow: "hidden",
  },
  thumbActive: { borderColor: theme.accent },
  hint: {
    position: "absolute",
    left: spacing(2),
    backgroundColor: scrim.heavy,
    borderRadius: radius.md,
    paddingHorizontal: spacing(2),
    paddingVertical: spacing(1),
  },
  hintText: {
    color: theme.textPrimary,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  actions: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    gap: spacing(1.5),
    paddingHorizontal: spacing(2),
    paddingVertical: spacing(1.5),
    backgroundColor: theme.primary,
  },
  action: { flex: 1 },
});
