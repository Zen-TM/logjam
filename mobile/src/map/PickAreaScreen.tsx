// "Area on map" — frame a box of country, and hand it back to the Canyons
// filter that asked for it.
//
// A SCREEN, not a mode of the filter sheet, and forced for the same reason
// `PickPointScreen` is one: a `BottomSheet` is an RN `Modal`, rendering in its
// own window above the whole app, so a map drawn behind it would be invisible.
// The sheet re-opens in the state the user left it when the picker returns.
//
// THE GESTURE IS THE DOWNLOAD SCREEN'S, not the web's. Logjam Web draws a box
// by clicking one corner and then the other, which works there because the
// pointer hovers and the box can be seen growing under it. A finger does not
// hover: tap-anchor-tap would show nothing at all between the two taps. So this
// reuses `SelectionFrame` — a frame that is visible and adjustable from the
// moment the screen opens, with the map panning and pinching underneath it.
// That component carries a lot of hard-won detail (pixel-snapped scrim panels,
// gesture handlers that must not be rebuilt mid-drag, `pointerEvents` that
// leave the map draggable through the dimmed area); reusing it gets all of it.
//
// WHAT IT DRAWS: canyon pins, and NOTHING else — no waypoints, no ways, no
// basemap rail. `PickPointScreen` carries all of those because its question is
// "is this the thing I already have?", which is about individual objects a
// metre apart. This screen's question is "which canyons", answered at
// kilometres, so everything else is clutter over the box being drawn.
//
// The basemap rail in particular was tried and removed. Anything pinned to a
// screen edge is an obstacle to a frame whose handles live on those edges: a
// rail top-right puts pressable thumbs exactly where the right handle travels
// as the frame is reshaped, and a handle under a thumb cannot be grabbed back.
// Clamping the frame away from it then silently narrowed a restored area on a
// round trip that changed nothing. The basemap carries over from the map the
// user was last looking at (`lastCamera`), which is the one they know.
//
// PRIVACY: canyon positions are drawn from the local mirror and never leave the
// device. The framed box is returned in memory (`pickedArea.ts`) and reaches
// nothing but the filter state on the screen that asked.
import { useCallback, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { LayoutChangeEvent } from "react-native";
import {
  Camera,
  Layer,
  Map,
  type LngLatBounds,
  type MapRef,
} from "@maplibre/maplibre-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { RegionBbox } from "@logjam/shared";

import { config } from "../config";
import { fontSize, fontWeight, radius, scrim, spacing, theme } from "../theme";
import { Button } from "../ui";
import { useMirrorCanyons } from "../sync/useSyncQueries";
import { useMapArtifacts } from "../offline/useMapArtifacts";
import { useConnectivity } from "./connectivity";
import { readBasemapPreference } from "./basemapPreference";
import { useBasemapAssets } from "./basemap/basemapAssets";
import { ProtomapsLayers } from "./basemap/ProtomapsLayers";
import { buildShellStyle } from "./basemap/shellStyle";
import { CanyonPinsLayer, toCanyonFeatureCollection } from "./CanyonPinsLayer";
import { readLastMapCamera } from "./lastCamera";
import { DEFAULT_CENTER, DEFAULT_ZOOM } from "./mapChrome";
import { ResolvedSource, sourceIdFor } from "./ResolvedSource";
import { SelectionFrame } from "./SelectionFrame";
import {
  bboxToFrame,
  defaultFrameInsets,
  frameToBbox,
  type FrameInsets,
  type FrameViewport,
} from "./regionFrame";
import { resolveMapSource, type BasemapId, type ResolveContext } from "./sourceResolver";

/** Matches `MapScreen`'s — every map in the app renders the same vector basemap. */
const PROTOMAPS_FLAVOR = "light" as const;

/**
 * Breathing room around a restored area, so the frame that comes back has
 * somewhere to be.
 *
 * Fitting the camera to the saved box EXACTLY is the obvious thing and the
 * wrong one: the box then fills the viewport, `bboxToFrame` answers with zero
 * insets, and the frame lands flush with the screen edges — no scrim, no
 * outline you can see, and four handles half off the screen with nothing to
 * drag them by. Padding the fit zooms out just enough that the same box sits
 * inside the view with its handles in reach. It changes the camera only; the
 * area itself still comes back exactly as it was saved.
 */
const RESTORE_PADDING = 56;


export function PickAreaScreen({
  initialArea,
  onCancel,
  onConfirm,
}: {
  /**
   * The area the filter already holds, if any. The picker opens ON it, with the
   * frame around it, so adjusting an area is a drag rather than a redraw — and
   * so there is a way to SEE which area is being filtered on at all. Every
   * other filter shows its own value back; without this one this one could not.
   */
  initialArea: RegionBbox | null;
  onCancel: () => void;
  onConfirm: (area: RegionBbox) => void;
}) {
  const insets = useSafeAreaInsets();
  // Read once: `initialViewState` is honoured on the first render only, and
  // re-reading the module store mid-session would move a map the user is
  // already panning. Same rule as PickPointScreen and RegionDownloadScreen.
  const lastCamera = useRef(readLastMapCamera()).current;
  // Fixed for the life of the screen: the basemap the user was last looking at,
  // with no way to change it here (see the header for why there is no rail).
  const basemapId: BasemapId = lastCamera?.basemapId ?? readBasemapPreference();
  const mapRef = useRef<MapRef>(null);

  const [size, setSize] = useState({ width: 0, height: 0 });
  const [frame, setFrame] = useState<FrameInsets | null>(null);
  const [viewport, setViewport] = useState<FrameViewport | null>(null);

  const basemapAssets = useBasemapAssets();
  const shellStyle = useMemo(
    () => buildShellStyle(basemapAssets.localBaseUrl, PROTOMAPS_FLAVOR),
    [basemapAssets.localBaseUrl],
  );

  // Saved regions count here as they do everywhere else: a picker that needed
  // signal would be useless at the trailhead.
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

  // Stable identity: SelectionFrame's gesture handlers are rebuilt whenever
  // this changes, and rebuilding one mid-drag detaches the native gesture and
  // snaps the frame back. See that component's header.
  const handleFrameChange = useCallback((next: FrameInsets) => {
    setFrame(next);
  }, []);

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize({ width, height });
    // Always give the frame a value, even when an area is being restored: the
    // restore needs the map's settled bounds, which arrive later, and a screen
    // that shows no frame until then reads as broken. The camera already opens
    // on the saved area, so the opening frame is close to the final one and the
    // correction is a nudge rather than a jump.
    setFrame((current) => current ?? defaultFrameInsets({ width, height }));
  }, []);

  // One-shot: the saved area is placed under the frame the first time the map
  // reports real bounds. Repeating it on every region change would drag the
  // frame back over the box each time the user panned away from it.
  const restoredRef = useRef(initialArea == null);

  // The map's own bounds are the rectangle the frame is measured against. The
  // conversion is synchronous, so the box keeps up with a drag.
  const applyBounds = useCallback(
    (bounds: LngLatBounds) => {
      if (size.width === 0) return;
      const [west, south, east, north] = bounds;
      const next: FrameViewport = {
        north,
        south,
        east,
        west,
        width: size.width,
        height: size.height,
      };
      setViewport(next);
      if (!restoredRef.current && initialArea) {
        restoredRef.current = true;
        setFrame(bboxToFrame(next, initialArea));
      }
    },
    [size.width, size.height, initialArea],
  );

  const area: RegionBbox | null =
    viewport && frame ? frameToBbox(viewport, frame) : null;

  // Opening the camera on the saved area rather than computing a centre and a
  // zoom for it: `bounds` lets the map do the fitting, and `bboxToFrame` then
  // works from whatever bounds it actually settled on, so the aspect-ratio
  // difference between the box and the screen needs no arithmetic here.
  const initialViewState = initialArea
    ? {
        bounds: [
          initialArea.west,
          initialArea.south,
          initialArea.east,
          initialArea.north,
        ] as LngLatBounds,
        padding: {
          top: RESTORE_PADDING,
          right: RESTORE_PADDING,
          bottom: RESTORE_PADDING,
          left: RESTORE_PADDING,
        },
      }
    : {
        center: lastCamera?.center ?? DEFAULT_CENTER,
        zoom: lastCamera?.zoom ?? DEFAULT_ZOOM,
      };

  return (
    <View style={styles.root}>
      <View style={StyleSheet.absoluteFill} onLayout={handleLayout}>
        <Map
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          mapStyle={shellStyle}
          attribution={false}
          logo={false}
          compass={false}
          // North-up only: the frame maths reads axis-aligned visible bounds,
          // which a rotated or pitched view invalidates — `getVisibleBounds`
          // returns the box AROUND a rotated view, and no linear mapping undoes
          // that. Same constraint as RegionDownloadScreen.
          touchRotate={false}
          touchPitch={false}
          // The settled bounds ride the event, so no native call and no race
          // against the map's creation.
          onRegionDidChange={(event) => applyBounds(event.nativeEvent.bounds)}
        >
          <Camera initialViewState={initialViewState} />

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
                    key={`pick-area-basemap-${resolved.key}`}
                    type="raster"
                    id={`pick-area-basemap-${resolved.key}`}
                    layerIndex={1}
                    style={{ rasterOpacity: 1 }}
                  />
                )}
              </ResolvedSource>
            ) : null,
          )}

          <CanyonPinsLayer
            ownedFc={ownedFc}
            sharedFc={sharedFc}
            idPrefix="pick-area-"
          />
        </Map>

        {frame && size.width > 0 ? (
          <SelectionFrame insets={frame} size={size} onChange={handleFrameChange} />
        ) : null}
      </View>

      <View style={[styles.hint, { top: insets.top + spacing(2) }]} pointerEvents="none">
        <Text style={styles.hintText}>
          Move the map, drag the edges to frame an area
        </Text>
      </View>

      {/* NO `insets.bottom`: this screen is pushed inside a tab stack, so the
          tab bar below it has already taken the gesture inset. */}
      <View style={styles.actions}>
        <View style={styles.action}>
          <Button label="Cancel" variant="outlineAccent" onPress={onCancel} />
        </View>
        <View style={styles.action}>
          <Button
            label="Use this area"
            icon="check"
            // Null only until the map has reported its first bounds — a second
            // or two on launch, not a state the user can get stuck in.
            disabled={area == null}
            onPress={() => area && onConfirm(area)}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.primary },
  hint: {
    position: "absolute",
    left: spacing(2),
    right: spacing(2),
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
