// The place pins: a dot and a name per place, shared first so owned draws on
// top of it.
//
// Extracted from `MapScreen` when the place point-picker needed the same pins
// as reference ("is there already a place there?" is most of what a picker is
// for). One definition, so the two maps cannot disagree about what a place
// looks like — the same rule `assetActions.ts` follows for verbs.
//
// PRIVACY: place names and coordinates come from the authed API and the local
// mirror, and are NEVER baked into a tile (root CLAUDE.md). Both sources here
// are client-side GeoJSON handed straight to MapLibre; nothing about them is
// logged or sent anywhere.
import { memo } from "react";
import type { NativeSyntheticEvent } from "react-native";
import {
  GeoJSONSource,
  Layer,
  type PressEventWithFeatures,
} from "@maplibre/maplibre-react-native";

import { SHARED_PLACE_COLOR, SYSTEM_PLACE_TYPES } from "@logjam/shared";

import { theme } from "../theme";

/**
 * The ink, exported because rows and chips elsewhere match the map.
 *
 * `OWNED_PLACE_COLOR` is no longer what a pin is drawn in — a pin's fill is
 * its TYPE's colour now, and this is the fallback for a place whose type this
 * device has not pulled yet, plus the hue of the "My places" row. It is the
 * Canyon type's own colour rather than a literal, because a fallback that does
 * not appear in the palette is a thirteenth colour nothing checks.
 *
 * Ownership moved to the RING, which is the axis that has only two values, and
 * `SHARED_PLACE_COLOR` is RESERVED — never a type colour, or a shared Marker
 * would be a dot and a ring of the same hue. It is re-exported here because
 * every map file already imports its ink from this module.
 */
export const OWNED_PLACE_COLOR = SYSTEM_PLACE_TYPES[0].color;
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

const LABEL_STYLE = {
  textField: PLACE_LABEL_EXPR as unknown as string,
  textFont: ["Noto Sans Medium"],
  textSize: 12,
  textColor: theme.textPrimary,
  textHaloColor: theme.bonus2,
  textHaloWidth: 1,
  textAnchor: "top" as const,
  textOffset: [0, 0.8],
};

export type PlaceFeatureCollection = {
  type: "FeatureCollection";
  features: {
    type: "Feature";
    id: string;
    geometry: { type: "Point"; coordinates: [number, number] };
    properties: { id: string; name: string; color: string };
  }[];
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
   * (mobile/CLAUDE.md), so the second map passes its own prefix.
   */
  idPrefix?: string;
}) {
  return (
    <>
      <GeoJSONSource
        id={`${idPrefix}shared-places`}
        data={sharedFc}
        onPress={onPress}
      >
        {/* WIDER THAN AN OWNED PIN, deliberately. A place someone shared with
            you and your own copy of it very often sit on the SAME coordinate —
            that is what "copy" means — and owned draws on top, so an equal
            circle vanished completely underneath it and the layer looked
            broken. The extra 3 px leaves the shared pin's ring showing around
            your own dot, which is both the only hint that two things are
            stacked there and the part of the pin a thumb can land on to open
            the shared one. */}
        <Layer
          key={`${idPrefix}shared-place-circles`}
          type="circle"
          id={`${idPrefix}shared-place-circles`}
          // FILL = TYPE, RING = SHARED (§2.8). Colour used to encode ownership
          // and now cannot: it is saying which KIND of place this is, on both
          // maps, for every type the user has invented. So "someone shared this
          // with me" moved to the ring, which is the axis with two values.
          style={{
            circleRadius: 9,
            circleColor: ["get", "color"] as unknown as string,
            circleStrokeColor: SHARED_PLACE_COLOR,
            circleStrokeWidth: 3,
          }}
        />
        <Layer
          key={`${idPrefix}shared-place-labels`}
          type="symbol"
          id={`${idPrefix}shared-place-labels`}
          // Pushed clear of an owned label, and exempt from collision, for the
          // same reason the circle is wider: stacked on one coordinate the two
          // labels collide, and MapLibre places symbol layers top-down — so
          // the owned label, being the higher layer, wins every time and the
          // shared place loses both its dot and its name. The offset keeps
          // the pair legible; `textAllowOverlap` is what stops the one the
          // user cannot otherwise see from being the one that is dropped.
          style={{ ...LABEL_STYLE, textOffset: [0, 2.6], textAllowOverlap: true }}
        />
      </GeoJSONSource>
      <GeoJSONSource
        id={`${idPrefix}owned-places`}
        data={ownedFc}
        onPress={onPress}
      >
        <Layer
          key={`${idPrefix}place-circles`}
          type="circle"
          id={`${idPrefix}place-circles`}
          style={{
            circleRadius: 6,
            circleColor: ["get", "color"] as unknown as string,
            // White, not a colour: an owned pin's ring is a separator against
            // the map, not a second piece of information.
            circleStrokeColor: "#ffffff",
            circleStrokeWidth: 1.5,
          }}
        />
        <Layer
          key={`${idPrefix}place-labels`}
          type="symbol"
          id={`${idPrefix}place-labels`}
          style={LABEL_STYLE}
        />
      </GeoJSONSource>
    </>
  );
});

/**
 * The shape both maps hand this component.
 *
 * `typeColors` maps a place type id to its colour. A place whose type is not
 * in it — one created on another device and not pulled yet — draws in the
 * fallback rather than vanishing or drawing transparent: an unknown type is a
 * gap in the vocabulary, not a reason to hide a place from someone standing
 * next to it.
 */
export function toPlaceFeatureCollection(
  places: {
    id: string;
    name: string;
    latitude: number;
    longitude: number;
    placeTypeId?: string;
  }[],
  typeColors: Record<string, string> = {},
): PlaceFeatureCollection {
  return {
    type: "FeatureCollection",
    features: places.map((place) => ({
      type: "Feature" as const,
      id: place.id,
      geometry: {
        type: "Point" as const,
        coordinates: [place.longitude, place.latitude] as [number, number],
      },
      properties: {
        id: place.id,
        name: place.name,
        color:
          (place.placeTypeId ? typeColors[place.placeTypeId] : undefined) ??
          OWNED_PLACE_COLOR,
      },
    })),
  };
}
