// The canyon pins: a dot and a name per canyon, shared first so owned draws on
// top of it.
//
// Extracted from `MapScreen` when the canyon point-picker needed the same pins
// as reference ("is there already a canyon there?" is most of what a picker is
// for). One definition, so the two maps cannot disagree about what a canyon
// looks like — the same rule `assetActions.ts` follows for verbs.
//
// PRIVACY: canyon names and coordinates come from the authed API and the local
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

import { theme } from "../theme";

/** The ink, exported because rows and chips elsewhere match the map. */
export const OWNED_CANYON_COLOR = "#f97316";
export const SHARED_CANYON_COLOR = "#629bf8";

const MAX_LABEL_CHARS = 40;

/**
 * Truncate in the STYLE rather than in the data: the label expression runs
 * per-feature on the native side, so a long name costs no JS.
 */
export const CANYON_LABEL_EXPR = [
  "case",
  [">", ["length", ["get", "name"]], MAX_LABEL_CHARS],
  ["concat", ["slice", ["get", "name"], 0, MAX_LABEL_CHARS], "…"],
  ["get", "name"],
];

const LABEL_STYLE = {
  textField: CANYON_LABEL_EXPR as unknown as string,
  textFont: ["Noto Sans Medium"],
  textSize: 12,
  textColor: theme.textPrimary,
  textHaloColor: theme.bonus2,
  textHaloWidth: 1,
  textAnchor: "top" as const,
  textOffset: [0, 0.8],
};

export type CanyonFeatureCollection = {
  type: "FeatureCollection";
  features: {
    type: "Feature";
    id: string;
    geometry: { type: "Point"; coordinates: [number, number] };
    properties: { id: string; name: string };
  }[];
};

export const CanyonPinsLayer = memo(function CanyonPinsLayer({
  ownedFc,
  sharedFc,
  onPress,
  idPrefix = "",
}: {
  ownedFc: CanyonFeatureCollection;
  sharedFc: CanyonFeatureCollection;
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
        id={`${idPrefix}shared-canyons`}
        data={sharedFc}
        onPress={onPress}
      >
        {/* WIDER THAN AN OWNED PIN, deliberately. A canyon someone shared with
            you and your own copy of it very often sit on the SAME coordinate —
            that is what "copy" means — and owned draws on top, so an equal
            circle vanished completely underneath it and the layer looked
            broken. The extra 3 px leaves a blue ring around the orange dot,
            which is both the only hint that two things are stacked there and
            the part of the pin a thumb can land on to open the shared one. */}
        <Layer
          key={`${idPrefix}shared-canyon-circles`}
          type="circle"
          id={`${idPrefix}shared-canyon-circles`}
          style={{
            circleRadius: 9,
            circleColor: SHARED_CANYON_COLOR,
            circleStrokeColor: "#ffffff",
            circleStrokeWidth: 1.5,
          }}
        />
        <Layer
          key={`${idPrefix}shared-canyon-labels`}
          type="symbol"
          id={`${idPrefix}shared-canyon-labels`}
          // Pushed clear of an owned label, and exempt from collision, for the
          // same reason the circle is wider: stacked on one coordinate the two
          // labels collide, and MapLibre places symbol layers top-down — so
          // the owned label, being the higher layer, wins every time and the
          // shared canyon loses both its dot and its name. The offset keeps
          // the pair legible; `textAllowOverlap` is what stops the one the
          // user cannot otherwise see from being the one that is dropped.
          style={{ ...LABEL_STYLE, textOffset: [0, 2.6], textAllowOverlap: true }}
        />
      </GeoJSONSource>
      <GeoJSONSource
        id={`${idPrefix}owned-canyons`}
        data={ownedFc}
        onPress={onPress}
      >
        <Layer
          key={`${idPrefix}canyon-circles`}
          type="circle"
          id={`${idPrefix}canyon-circles`}
          style={{
            circleRadius: 6,
            circleColor: OWNED_CANYON_COLOR,
            circleStrokeColor: "#ffffff",
            circleStrokeWidth: 1.5,
          }}
        />
        <Layer
          key={`${idPrefix}canyon-labels`}
          type="symbol"
          id={`${idPrefix}canyon-labels`}
          style={LABEL_STYLE}
        />
      </GeoJSONSource>
    </>
  );
});

/** The shape both maps hand this component. */
export function toCanyonFeatureCollection(
  canyons: { id: string; name: string; latitude: number; longitude: number }[],
): CanyonFeatureCollection {
  return {
    type: "FeatureCollection",
    features: canyons.map((canyon) => ({
      type: "Feature" as const,
      id: canyon.id,
      geometry: {
        type: "Point" as const,
        coordinates: [canyon.longitude, canyon.latitude] as [number, number],
      },
      properties: { id: canyon.id, name: canyon.name },
    })),
  };
}
