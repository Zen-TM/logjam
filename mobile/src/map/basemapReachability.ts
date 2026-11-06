// Whether each online basemap's tile server answers. Logjam GPS's swatches are
// bundled pictures (BasemapThumb), so a swatch load proves nothing; instead
// the Basemap tab asks each server for one tile when it opens. MapLibre RN
// does not hand tile errors to JS, so the open of the tab is the only moment
// an outage is found.
import { useCallback, useEffect, useRef, useState } from "react";
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

/** The basemaps whose server did not answer, and `probe`, which asks again (the
 *  Layers sheet opening). Probes on mount and whenever the phone comes online;
 *  an offline phone marks nothing down. */
export function useDownBasemaps(online: boolean): {
  down: ReadonlySet<BasemapId>;
  probe: () => void;
} {
  const [down, setDown] = useState<ReadonlySet<string>>(() => new Set());
  // The verdict so far, so an answer that changes nothing never reaches
  // setDown: React calls the component for a same-value set while a render is
  // pending, and here that component is MapScreen.
  const verdict = useRef<ReadonlySet<string>>(down);
  // The latest probe's number. An older probe that answers late would put its
  // stale verdict over a newer one, so only the latest may write.
  const latest = useRef(0);
  const probe = useCallback(() => {
    if (!online) return;
    const mine = ++latest.current;
    for (const id of PROBED_BASEMAPS) {
      void serverAnswers(probeUrl(id)).then((ok) => {
        if (latest.current !== mine) return;
        const next = withBasemapDown(verdict.current, id, !ok);
        if (next === verdict.current) return;
        verdict.current = next;
        setDown(next);
      });
    }
  }, [online]);
  useEffect(() => {
    probe();
    return () => {
      latest.current += 1;
    };
  }, [probe]);
  return { down: online ? (down as ReadonlySet<BasemapId>) : EMPTY, probe };
}

const EMPTY: ReadonlySet<BasemapId> = new Set();
