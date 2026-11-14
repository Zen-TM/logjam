import {
  basemapFallbackNotice,
  basemapToShow,
  vectorBasemapIn,
  withBasemapDown,
} from "@logjam/shared";
import { useCallback, useEffect, useState } from "react";
import { useToast } from "../feedback/ToastProvider";

/**
 * The basemap to draw for `pickedId`: the vector map while the pick's tile
 * server is down, with a toast saying so, where `layers` offer it (a view
 * outside its archive has no other basemap to fall to, so the pick stays). The
 * pick itself is kept, so it returns with its server.
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
  const fallback = vectorBasemapIn(layers.map((layer) => layer.id)) ?? pickedId;
  const shownLayerId = basemapToShow(pickedId, down, fallback);
  const fellBack = shownLayerId !== pickedId;
  useEffect(() => {
    if (!fellBack) return;
    const name = (id: string) => layers.find((l) => l.id === id)?.name ?? id;
    toast.error(basemapFallbackNotice(name(pickedId), name(fallback)));
  }, [fellBack, pickedId, fallback, layers, toast]);
  return { shownLayerId, down, setHealth };
}
