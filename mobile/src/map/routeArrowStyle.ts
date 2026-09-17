// The direction arrows drawn along a route line, as a pure style builder.
//
// The arrowhead itself, the segment split and the sizes both clients must agree
// on live in `@logjam/shared` (`routeArrow.ts`) — Logjam Web draws the same
// arrows and used to draw them with a text glyph, which is the fault documented
// there. What stays here is the MLRN-shaped style object, because MapLibre
// Native and MapLibre GL JS spell their layer properties differently.
//
// Split out of `RouteDraftLayer` (which pulls in React Native and MLRN) so the
// style can be asserted in a plain node test — the same split
// `topoVectorLayers.ts` uses.
import type {
  FilterSpecification,
  SymbolLayerStyle,
} from "@maplibre/maplibre-react-native";
import {
  ARROW_FEATURE_KIND,
  ROUTE_ARROW_ICON_SIZE,
  ROUTE_ARROW_IMAGE,
} from "@logjam/shared";

import { theme } from "../theme";

// Re-exported so this module stays the one import for a layer that draws
// arrows, rather than every call site reaching into two packages.
export {
  ARROW_FEATURE_KIND,
  ROUTE_ARROW_IMAGE,
  ROUTE_ARROW_MIN_ZOOM,
  arrowSegmentFeatures,
} from "@logjam/shared";

/**
 * Which way the line runs, as arrows along it — MapLibre spaces and rotates
 * them itself, so they re-space as you zoom and cost no React views (the
 * markers this replaced were re-created on every drag frame, which is what made
 * dragging an anchor stutter).
 *
 * A STYLE, not a component of ours, and three things here are load-bearing:
 *
 * - The layer has to be a DIRECT child of its `GeoJSONSource`. MLRN injects
 *   `source` onto the source's immediate children with `cloneElement`, so a
 *   layer wrapped in a component of ours never learns which source it belongs
 *   to, falls back to the default source id and draws nothing.
 * - The image must be registered as **SDF**. `iconColor` and `iconHaloColor`
 *   are ignored for an ordinary bitmap, so a non-SDF arrow would be one fixed
 *   colour for every route — the per-feature `["get", "routeColor"]` expression
 *   below only works because the image is a distance field the GPU tints.
 * - `iconAllowOverlap`/`iconIgnorePlacement` so an arrow never loses a
 *   placement contest with a street label, and `iconKeepUpright` off (the
 *   default, stated because it matters) because an arrow that flips itself to
 *   stay readable is then pointing the wrong way.
 */
export function routeArrowStyle(
  color: SymbolLayerStyle["iconColor"],
  spacing = 90,
): SymbolLayerStyle {
  return {
    symbolPlacement: "line",
    symbolSpacing: spacing,
    iconImage: ROUTE_ARROW_IMAGE,
    iconSize: ROUTE_ARROW_ICON_SIZE,
    iconColor: color,
    iconHaloColor: theme.primary,
    iconHaloWidth: 1,
    iconAllowOverlap: true,
    iconIgnorePlacement: true,
    iconKeepUpright: false,
    iconRotationAlignment: "map",
    iconPitchAlignment: "map",
  };
}

/** Draws arrows; skips the segment features. */
export const ARROW_LAYER_FILTER: FilterSpecification = [
  "==",
  ["get", "kind"],
  ARROW_FEATURE_KIND,
];

/** Draws the route itself; skips the segment features. */
export const ROUTE_LAYER_FILTER: FilterSpecification = [
  "!=",
  ["get", "kind"],
  ARROW_FEATURE_KIND,
];
