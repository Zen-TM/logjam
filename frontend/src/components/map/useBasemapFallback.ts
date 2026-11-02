import {
  basemapFallbackNotice,
  basemapToShow,
  withBasemapDown,
} from "@logjam/shared";
import { useCallback, useEffect, useState } from "react";
import { useToast } from "../feedback/ToastProvider";

const FALLBACK = "protomaps";

/**
 * The basemap to draw for `pickedId`: the default while the pick's tile server
 * is down, with a toast saying so. The pick itself is kept, so it returns with
 * its server.
 */
export function useBasemapFallback(
  pickedId: string,
  layers: readonly { id: string; name: string }[],
) {
  const toast = useToast();
  const [down, setDown] = useState<ReadonlySet<string>>(() => new Set());
  const setHealth = useCallback((id: string, isDown: boolean) => {
    setDown((prev) => withBasemapDown(prev, id, isDown));
  }, []);
  const shownLayerId = basemapToShow(pickedId, down, FALLBACK);
  const fellBack = shownLayerId !== pickedId;
  useEffect(() => {
    if (!fellBack) return;
    const name = (id: string) => layers.find((l) => l.id === id)?.name ?? id;
    toast.error(basemapFallbackNotice(name(pickedId), name(FALLBACK)));
  }, [fellBack, pickedId, layers, toast]);
  return { shownLayerId, down, setHealth };
}
