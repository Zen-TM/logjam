// The place pins: a dot and a name per place, shared first so owned draws on
// top of it. A shared place gets the same dot as an owned one plus a person
// badge, a visited one a tick badge; the badge is also the only part of a
// shared place a thumb can reach when your own copy sits on the same coordinate.
//
// Extracted from `MapScreen` when the place point-picker needed the same pins
// as reference ("is there already a place there?" is most of what a picker is
// for). One definition, so the two maps cannot disagree about what a place
// looks like — the same rule `assetActions.ts` follows for verbs.
//
// PRIVACY: place names and coordinates come from the authed API and the local
// mirror, and are NEVER baked into a tile (root AGENTS.md). Both sources here
// are client-side GeoJSON handed straight to MapLibre; nothing about them is
// logged or sent anywhere.
import { PLAN_DIM } from "../plans/planMap";
import { memo } from "react";
import type { NativeSyntheticEvent } from "react-native";
import {
  GeoJSONSource,
  Images,
  Layer,
  type PressEventWithFeatures,
} from "@maplibre/maplibre-react-native";

import {
  SHARED_PLACE_COLOR,
  MAP_INK,
  PIN_CASING_COLOR,
  PIN_CASING_WIDTH,
  PIN_HALO_COLOR,
  pinHaloRadius,
  PLACE_BADGE_OFFSET,
  PLACE_BADGE_SHARED_IMAGE,
  PLACE_BADGE_SIZE,
  PLACE_BADGE_URIS,
  PLACE_BADGE_VISITED_IMAGE,
  MAP_LABEL_MIN_ZOOM,
} from "@logjam/shared";

import { PIN_LABEL_TEXT } from "./mapLabelText";
import type { PlaceFeatureCollection } from "./placeFeatures";

export {
  OWNED_PLACE_COLOR,
  toPlaceFeatureCollection,
  type PlaceFeatureCollection,
} from "./placeFeatures";

/**
 * The ink, exported because rows and chips elsewhere match the map.
 *
 * `OWNED_PLACE_COLOR` is the fallback for a place whose type this
 * device has not pulled yet (a pin's fill is otherwise its TYPE's colour),
 * plus the hue of the "My places" row. It is the Canyon type's own colour
 * rather than a literal, because a fallback that does not appear in the
 * palette is a thirteenth colour nothing checks.
 *
 * Sharing is shown on the BADGE, which is the axis that has only two values,
 * and `SHARED_PLACE_COLOR` is RESERVED — never a type colour (guard:
 * shared/src/placeTypes.test.ts), or a shared Marker would be a dot and a
 * badge of the same hue. It is re-exported here because every map file already
 * imports its ink from this module.
 */
export { SHARED_PLACE_COLOR };

const MAX_LABEL_CHARS = 40;

/**
 * Truncate in the STYLE rather than in the data: the label expression runs
 * per-feature on the native side, so a long name costs no JS.
 */
export const PLACE_LABEL_EXPR = [
  "case",
  [">", ["length", ["get", "name"]], MAX_LABEL_CHARS],
  ["concat", ["slice", ["get", "name"], 0, MAX_LABEL_CHARS], "…"],
  ["get", "name"],
];

const MUTED_OPACITY = [
  "case",
  ["==", ["get", "muted"], true],
  PLAN_DIM,
  1,
] as unknown as number;

const PIN_RADIUS = 6;

// The pin's white halo, a disc under it (`mapPin.ts`: a circle layer draws one
// stroke). The same opacity as the pin, so a muted pin fades whole.
const HALO_STYLE = {
  circleRadius: pinHaloRadius(PIN_RADIUS),
  circleColor: PIN_HALO_COLOR,
  circleOpacity: MUTED_OPACITY,
};

// Bitmaps, not SDFs: a badge is a coloured disc with a white glyph and rim.
const BADGE_IMAGES = Object.fromEntries(
  Object.entries(PLACE_BADGE_URIS).map(([name, uri]) => [
    name,
    { source: { uri } },
  ]),
);

// The status badge at a pin's upper-right rim: a person for shared, a tick for
// visited. It sticks out past the dot, so it is still there to see and press
// when the user's own copy sits on the same coordinate and covers the dot.
const BADGE_STYLE = {
  iconSize: PLACE_BADGE_SIZE,
  iconOffset: PLACE_BADGE_OFFSET,
  iconAllowOverlap: true,
  iconIgnorePlacement: true,
  iconOpacity: MUTED_OPACITY,
};

const LABEL_STYLE = {
  textField: PLACE_LABEL_EXPR as unknown as string,
  ...PIN_LABEL_TEXT,
  // Drawn on the basemap, not the page, so fixed whatever the scheme.
  textColor: MAP_INK.label,
  textHaloColor: MAP_INK.casing,
  textHaloWidth: 1,
  textAnchor: "top" as const,
  textOffset: [0, 0.8],
};

export const PlacePinsLayer = memo(function PlacePinsLayer({
  ownedFc,
  sharedFc,
  onPress,
  idPrefix = "",
}: {
  ownedFc: PlaceFeatureCollection;
  sharedFc: PlaceFeatureCollection;
  /** Absent where a tap on a pin means nothing (the point picker). */
  onPress?: (event: NativeSyntheticEvent<PressEventWithFeatures>) => void;
  /**
   * Distinguishes two mounted copies. MLRN freezes a layer's id on first
   * render and throws if a fiber is later rendered with a different one — two
   * maps alive at once with the same layer ids is the shape of that crash
   * (ADR 0015), so the second map passes its own prefix.
   */
  idPrefix?: string;
}) {
  return (
    <>
      <Images images={BADGE_IMAGES} />
      <GeoJSONSource
        id={`${idPrefix}shared-places`}
        data={sharedFc}
        onPress={onPress}
      >
        <Layer
          key={`${idPrefix}shared-place-halo`}
          type="circle"
          id={`${idPrefix}shared-place-halo`}
          style={HALO_STYLE}
        />
        <Layer
          key={`${idPrefix}shared-place-circles`}
          type="circle"
          id={`${idPrefix}shared-place-circles`}
          // Identical to an owned pin, deliberately: the badge says what is
          // different about this place, so the dot does not have to.
          style={{
            circleRadius: PIN_RADIUS,
            circleColor: ["get", "color"] as unknown as string,
            circleStrokeColor: PIN_CASING_COLOR,
            circleStrokeWidth: PIN_CASING_WIDTH,
            circleOpacity: MUTED_OPACITY,
            circleStrokeOpacity: MUTED_OPACITY,
          }}
        />
        <Layer
          type="symbol"
          key={`${idPrefix}shared-place-badges`}
          id={`${idPrefix}shared-place-badges`}
          style={{ ...BADGE_STYLE, iconImage: PLACE_BADGE_SHARED_IMAGE }}
        />
        <Layer
          key={`${idPrefix}shared-place-labels`}
          type="symbol"
          id={`${idPrefix}shared-place-labels`}
          minzoom={MAP_LABEL_MIN_ZOOM}
          // Pushed clear of an owned label, and exempt from collision, for the
          // same reason the badge exists: stacked on one coordinate the two
          // labels collide, and MapLibre places symbol layers top-down — so
          // the owned label, being the higher layer, wins every time and the
          // shared place loses both its dot and its name. The offset keeps
          // the pair legible; `textAllowOverlap` is what stops the one the
          // user cannot otherwise see from being the one that is dropped. The
          // label hangs off a 6 px dot; an offset measured for a larger pin
          // would leave the name floating away from its pin.
          style={{
            ...LABEL_STYLE,
            textOpacity: MUTED_OPACITY,
            textOffset: [0, 2.0],
            textAllowOverlap: true,
          }}
        />
      </GeoJSONSource>
      <GeoJSONSource
        id={`${idPrefix}owned-places`}
        data={ownedFc}
        onPress={onPress}
      >
        <Layer
          key={`${idPrefix}place-halo`}
          type="circle"
          id={`${idPrefix}place-halo`}
          style={HALO_STYLE}
        />
        <Layer
          key={`${idPrefix}place-circles`}
          type="circle"
          id={`${idPrefix}place-circles`}
          style={{
            circleRadius: PIN_RADIUS,
            circleColor: ["get", "color"] as unknown as string,
            // A separator against the map, not a second piece of information.
            circleStrokeColor: PIN_CASING_COLOR,
            circleStrokeWidth: PIN_CASING_WIDTH,
            // `muted`: the user's own, faint beside a plan's in plan mode.
            circleOpacity: MUTED_OPACITY,
            circleStrokeOpacity: MUTED_OPACITY,
          }}
        />
        <Layer
          type="symbol"
          key={`${idPrefix}visited-place-badges`}
          id={`${idPrefix}visited-place-badges`}
          filter={["==", ["get", "visited"], true]}
          style={{ ...BADGE_STYLE, iconImage: PLACE_BADGE_VISITED_IMAGE }}
        />
        <Layer
          key={`${idPrefix}place-labels`}
          type="symbol"
          id={`${idPrefix}place-labels`}
          minzoom={MAP_LABEL_MIN_ZOOM}
          style={{ ...LABEL_STYLE, textOpacity: MUTED_OPACITY }}
        />
      </GeoJSONSource>
    </>
  );
});
