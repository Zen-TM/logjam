// River gauges as the map's search box sees them. Matched on the phone, from
// the public file, so a query about one sends nothing.
import { GAUGES, gaugeDisplayName, MAP_INK, type Gauge } from "@logjam/shared";

import type { SavedSearchItem } from "../map/MapSearchBar";
import { bboxOfPoints } from "../saved/bboxOfPoints";

export function gaugeSearchItems(gauges: readonly Gauge[]): SavedSearchItem[] {
  return gauges.map((gauge) => ({
    key: `gauge:${gauge.id}`,
    icon: "gauge",
    hue: MAP_INK.gauge,
    title: gaugeDisplayName(gauge.name),
    kindLabel: GAUGES.title,
    gaugeId: gauge.id,
    resolveBbox: async () => bboxOfPoints([{ lon: gauge.lon, lat: gauge.lat }]),
  }));
}
