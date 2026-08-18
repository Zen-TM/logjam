// "Show on map" arrival marker: a brief pulsed outline of the extent the user
// was sent to.
//
// Fitting the camera answers "here it is" only if the user already knows what
// they are looking at; arriving from Saved on a screen full of ridgelines, the
// rectangle they asked for is indistinguishable from the ground around it. This
// draws it for ~2.5 s and then removes itself.
//
// MEMOISED WITH ITS OWN STATE, on purpose. MapScreen re-renders at compass
// cadence (up to ~5/s with the tape or locate-me running) and the same rule that
// keeps TrackLine's geometry out of that render applies here: the animation
// clock lives in this component, so a pulse costs ~31 renders of one small
// subtree instead of adding a second 12 Hz driver to the whole map.
//
// PRIVACY: the bbox arrives as a prop, stays in this component, and is never
// logged.
import { memo, useEffect, useMemo, useState } from "react";
import { GeoJSONSource, Layer } from "@maplibre/maplibre-react-native";

import { theme } from "../theme";
import {
  FOCUS_PULSE_FRAME_MS,
  FOCUS_PULSE_MS,
  focusPulseOpacity,
} from "./focusPulse";

/** Below this span an extent is a point, not an area (~1 m) — the same test
 *  `fitCameraToBbox` applies, for the same reason. */
const DEGENERATE_DEGREES = 1e-5;

/** Radius of the point pulse, in screen pixels — about a fingertip, which is
 *  the scale at which "here" is legible without hiding what is under it. */
const POINT_RADIUS = 26;

export const FocusPulse = memo(function FocusPulse({
  bbox,
  nonce,
}: {
  bbox: [number, number, number, number];
  /** A repeat "show on map" for the same asset re-arms the animation. */
  nonce: number;
}) {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    setElapsedMs(0);
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      setElapsedMs(elapsed);
      if (elapsed >= FOCUS_PULSE_MS) clearInterval(timer);
    }, FOCUS_PULSE_FRAME_MS);
    return () => clearInterval(timer);
  }, [nonce]);

  const [west, south, east, north] = bbox;
  // A WAYPOINT or a canyon is focused as a single point, and a zero-area
  // polygon draws nothing at all — so that case gets a circle instead of being
  // skipped. It is the case that needs the pulse MOST: a rectangle at least has
  // corners to notice, a point has nothing.
  const degenerate =
    east - west < DEGENERATE_DEGREES && north - south < DEGENERATE_DEGREES;

  const shape = useMemo<GeoJSON.Feature>(
    () => ({
      type: "Feature",
      properties: {},
      geometry: degenerate
        ? { type: "Point", coordinates: [(west + east) / 2, (south + north) / 2] }
        : {
            type: "LineString",
            coordinates: [
              [west, south],
              [east, south],
              [east, north],
              [west, north],
              [west, south],
            ],
          },
    }),
    [degenerate, west, south, east, north],
  );

  if (elapsedMs >= FOCUS_PULSE_MS) return null;
  const opacity = focusPulseOpacity(elapsedMs);

  return (
    // Unpinned (no layerIndex), like the track and location layers: it sits
    // above the basemap band and above everything else for the two seconds it
    // exists. Claiming an index inside the overlay band would mean shifting
    // every overlay's index as it mounts and unmounts, for a transient marker.
    <GeoJSONSource id="focus-pulse" data={shape}>
      {degenerate ? (
        <Layer
          key="focus-pulse-point"
          type="circle"
          id="focus-pulse-point"
          style={{
            circleRadius: POINT_RADIUS,
            circleColor: "transparent",
            circleStrokeColor: theme.accent,
            circleStrokeWidth: 3,
            circleStrokeOpacity: opacity,
          }}
        />
      ) : (
        <Layer
          key="focus-pulse-outline"
          type="line"
          id="focus-pulse-outline"
          style={{
            lineColor: theme.accent,
            lineWidth: 3,
            lineOpacity: opacity,
            lineJoin: "round",
          }}
        />
      )}
    </GeoJSONSource>
  );
});
