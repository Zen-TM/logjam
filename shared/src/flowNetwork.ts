/**
 * The flow network lookup: how much land drains through a point on the map.
 * The API reads the flow network layer (topo/build_flow_network.py, a
 * GeoPackage of creek segments carrying catchment area) and answers POST
 * /flow-network/lookup with a FlowNetworkLookup. The point travels in the
 * body, never the URL: where someone is looking gives away where they go.
 */

/** POST /flow-network/lookup body. */
export type FlowNetworkLookupRequest = {
  longitude: number;
  latitude: number;
  /** Also return every creek segment upstream of the snapped point. */
  upstream?: boolean;
};

/** One upstream creek segment, as a GeoJSON LineString feature. */
export type FlowNetworkSegmentFeature = {
  type: "Feature";
  geometry: { type: "LineString"; coordinates: [number, number][] };
  properties: { catchmentKm2: number; streamOrder: number };
};

export type FlowNetworkUpstream = {
  lines: { type: "FeatureCollection"; features: FlowNetworkSegmentFeature[] };
  /** [west, south, east, north] of the lines. */
  bbox: [number, number, number, number];
  /**
   * Set when the catchment had more segments than FLOW_NETWORK_UPSTREAM_CAP:
   * creeks below this Strahler order were left out to fit.
   */
  trimmedBelowOrder?: number;
};

export type FlowNetworkLookup =
  | {
      status: "found";
      /** The point on the creek that was measured, which a click rarely hits. */
      snapped: { longitude: number; latitude: number };
      distanceM: number;
      catchmentKm2: number;
      streamOrder: number;
      /**
       * Which way the water runs at the snapped point, in whole degrees
       * clockwise from north. Absent from an API that predates it, and on a
       * segment too short to have a direction.
       */
      downstreamBearing?: number;
      /**
       * Another creek in snapping range draining at least
       * FLOW_NETWORK_BIGGER_FACTOR times more: near a confluence the nearest
       * creek may not be the one meant.
       */
      biggerNearby?: { catchmentKm2: number };
      upstream?: FlowNetworkUpstream;
      /** The credit ADR 0031 asks for wherever DEM-derived figures show. */
      attribution: string;
    }
  | { status: "no-creek"; attribution: string }
  /** Outside every basin the layer has been built for. */
  | { status: "not-covered"; attribution: string };

/** How far from a click a creek may be and still count, in metres. */
export const FLOW_NETWORK_SNAP_M = 50;
/** A creek this many times bigger in range is worth mentioning. */
export const FLOW_NETWORK_BIGGER_FACTOR = 3;
/** The most upstream segments one response carries. */
export const FLOW_NETWORK_UPSTREAM_CAP = 4000;
