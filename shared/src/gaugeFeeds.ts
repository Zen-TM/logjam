// Which gauge feed a client reads (ADR 0044): the one its region declares in
// `Region.gauges`. The map reads the feed of the region it shows, a place the
// feed of the region its coordinates fall in, and a region with none has no
// gauges, so nothing is fetched there. Guard: `gaugeFeeds.test.ts`.
import { TRIP_GAUGE_MAX } from "./gauges.js";
import {
  REGIONS,
  regionAt,
  regionInView,
  type LonLatBox,
  type Region,
} from "./regions.js";

/** A region's gauge feed prefix, or null where it has none. Whether a region
 *  has gauges is whether this is not null: both clients ask it here (guards:
 *  `frontend/src/components/gauges/gauges.test.tsx`, "asks whether the region in
 *  view has a feed the way the map does"; `mobile/src/gauges/gauges.test.ts`,
 *  "reads the feed of the region the map shows, only while the layer is on"). */
export const gaugeFeedOf = (region: Region | null): string | null =>
  region?.gauges ?? null;

/** The feed of the region a map shows, or null: no region there, or none with a feed. */
export function gaugeFeedIn(
  view: LonLatBox | null | undefined,
  regions: readonly Region[] = REGIONS,
): string | null {
  return gaugeFeedOf(view ? regionInView(view, regions) : null);
}

/** The feed that holds a place's gauge: that of the region its coordinates fall in. */
export function gaugeFeedAt(
  longitude: number,
  latitude: number,
  regions: readonly Region[] = REGIONS,
): string | null {
  return gaugeFeedOf(regionAt(longitude, latitude, regions));
}

type GaugePlace = {
  longitude: number;
  latitude: number;
  gaugeId?: string | null;
};
type FeedGauges = { feed: string; gaugeIds: string[] };

function group(
  places: readonly GaugePlace[],
  regions: readonly Region[],
  max: number,
): FeedGauges[] {
  const byFeed = new Map<string, string[]>();
  const seen = new Set<string>();
  for (const { gaugeId, longitude, latitude } of places) {
    if (!gaugeId || seen.has(gaugeId) || seen.size === max) continue;
    const feed = gaugeFeedAt(longitude, latitude, regions);
    if (!feed) continue;
    seen.add(gaugeId);
    byFeed.set(feed, [...(byFeed.get(feed) ?? []), gaugeId]);
  }
  return [...byFeed].map(([feed, gaugeIds]) => ({ feed, gaugeIds }));
}

/**
 * The gauges of some places, each under the feed of its place's region, in
 * order. A place outside every feed adds nothing.
 */
export const gaugeIdsByFeed = (
  places: readonly GaugePlace[],
  regions: readonly Region[] = REGIONS,
): FeedGauges[] => group(places, regions, Infinity);

/** `gaugeIdsByFeed` for a trip's reading: at most `TRIP_GAUGE_MAX` gauges in all, counting only those kept. */
export const tripGaugeIdsByFeed = (
  places: readonly GaugePlace[],
  regions: readonly Region[] = REGIONS,
): FeedGauges[] => group(places, regions, TRIP_GAUGE_MAX);
