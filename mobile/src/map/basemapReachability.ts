// Whether each online basemap's tile server answers. Logjam GPS's swatches are
// bundled pictures (BasemapThumb), so a swatch load proves nothing; instead
// the Basemap tab asks each server for one tile when it opens. MapLibre RN
// does not hand tile errors to JS, so the open of the tab is the only moment
// an outage is found.
import { useEffect, useState } from "react";
import {
  BASEMAP_CATALOG,
  serverAnswers,
  withBasemapDown,
} from "@logjam/shared";

import { DEFAULT_BASEMAP, MOBILE_BASEMAPS } from "./basemapMeta";
import type { BasemapId } from "./sourceResolver";

// The Katoomba tile the bundled swatches are cut from.
const PROBE_TILE = { z: 13, x: 7516, y: 4911 };

/** The fetched basemaps. The drawn one is read from our own archive and has no
 *  third-party server to probe. */
export const PROBED_BASEMAPS = MOBILE_BASEMAPS.filter(
  (id) => BASEMAP_CATALOG.find((e) => e.id === id)?.kind === "raster",
);

function probeUrl(id: BasemapId): string {
  const entry = BASEMAP_CATALOG.find((e) => e.id === id);
  if (!entry) throw new Error(`Unknown basemap id: ${id}`);
  return entry.urlTemplate
    .replace("{z}", String(PROBE_TILE.z))
    .replace("{x}", String(PROBE_TILE.x))
    .replace("{y}", String(PROBE_TILE.y));
}

/** What stands in for `picked` while its server is down: the default, or the
 *  drawn basemap when the pick is the default or the default is down too (a
 *  SIX outage takes out topo and imagery together). */
export function basemapFallbackFor(
  picked: BasemapId,
  down: ReadonlySet<BasemapId>,
): BasemapId {
  return picked === DEFAULT_BASEMAP || down.has(DEFAULT_BASEMAP)
    ? "protomaps"
    : DEFAULT_BASEMAP;
}

/** The basemaps whose server did not answer. Probes on mount, whenever the
 *  phone comes online and whenever `probeKey` changes (the Layers sheet
 *  opening); an offline phone marks nothing down. */
export function useDownBasemaps(
  online: boolean,
  probeKey?: unknown,
): ReadonlySet<BasemapId> {
  const [down, setDown] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    if (!online) return;
    let cancelled = false;
    for (const id of PROBED_BASEMAPS) {
      void serverAnswers(probeUrl(id)).then((ok) => {
        if (!cancelled) setDown((prev) => withBasemapDown(prev, id, !ok));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [online, probeKey]);
  return online ? (down as ReadonlySet<BasemapId>) : EMPTY;
}

const EMPTY: ReadonlySet<BasemapId> = new Set();
