// Pure GeoJSON shaping for the place pins; kept out of PlacePinsLayer.tsx so
// it loads without the native map module (placeFeatures.test.ts).
import { SYSTEM_PLACE_TYPES } from "@logjam/shared";

export const OWNED_PLACE_COLOR = SYSTEM_PLACE_TYPES[0].color;

export type PlaceFeatureCollection = {
  type: "FeatureCollection";
  features: {
    type: "Feature";
    id: string;
    geometry: { type: "Point"; coordinates: [number, number] };
    properties: {
      id: string;
      name: string;
      color: string;
      visited?: boolean;
    };
  }[];
};

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
  visitedIds?: ReadonlySet<string>,
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
        visited: visitedIds?.has(place.id) ?? false,
        color:
          (place.placeTypeId ? typeColors[place.placeTypeId] : undefined) ??
          OWNED_PLACE_COLOR,
      },
    })),
  };
}
