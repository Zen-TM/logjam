// Click-anchor-click box drawing on the main map, for every surface that wants
// an area: the topo job's bbox, the canyon multi-select, and the Canyons
// filter's area.
//
// ONE implementation. The first two shipped as two ~110-line copies that
// differed only in what they did with the finished box — same anchor, same
// overlay, same Escape handling, same teardown — so a fix to one (the overlay
// tracking map pans, say) reached the other only if someone remembered.
//
// The gesture is click-anchor-click rather than press-drag-release because the
// map owns press-drag for panning, and there is no modifier key that is safe
// across platforms. Escape cancels an anchored box; the second click commits.
// Deliberately NOT confirm/cancel buttons: on a pointer device the box is
// visible under the cursor the whole time, so the second click is already the
// confirmation. (Touch has no hover and so needs a different gesture entirely —
// that is what Logjam GPS's `SelectionFrame` is, and why it is not this.)
//
// PRIVACY: the box exists in the DOM and in the caller's state. Nothing logs.
import { useEffect, useRef } from "react";
import type maplibregl from "maplibre-gl";
import type { RegionBbox } from "@logjam/shared";

import { boxOverlayRect, cornersToBbox } from "./boxDraw";

export function useBoxDraw({
  map,
  enabled,
  onBox,
}: {
  /** Null until the map has loaded; the hook simply does nothing until then. */
  map: maplibregl.Map | null;
  enabled: boolean;
  onBox: (bbox: RegionBbox) => void;
}): void {
  // Through a ref so a caller can pass an inline arrow without tearing the
  // listeners down and rebuilding them on every render — which, mid-gesture,
  // would drop the anchored corner.
  const onBoxRef = useRef(onBox);
  useEffect(() => {
    onBoxRef.current = onBox;
  }, [onBox]);

  useEffect(() => {
    if (!map) return;
    const container = map.getCanvasContainer();

    if (!enabled) {
      map.getCanvas().style.cursor = "";
      return;
    }

    map.getCanvas().style.cursor = "crosshair";

    // The first corner is kept as GEOGRAPHIC coordinates, not pixels, so the
    // overlay stays over the same ground while the map pans and zooms under it.
    let anchor: { lng: number; lat: number } | null = null;
    let box: HTMLDivElement | null = null;

    // Held in the closure so the map's own 'move' can redraw the overlay
    // without a cursor event to read a position from.
    let lastCursorX = 0;
    let lastCursorY = 0;

    function updateOverlay(cursorX: number, cursorY: number) {
      if (!anchor || !box || !map) return;
      const rect = container.getBoundingClientRect();
      const anchorPx = map.project([anchor.lng, anchor.lat]);
      const overlay = boxOverlayRect(
        { x: anchorPx.x, y: anchorPx.y },
        { x: cursorX, y: cursorY },
        rect,
      );
      box.style.left = `${overlay.left}px`;
      box.style.top = `${overlay.top}px`;
      box.style.width = `${overlay.width}px`;
      box.style.height = `${overlay.height}px`;
    }

    function onMouseMove(event: MouseEvent) {
      lastCursorX = event.clientX;
      lastCursorY = event.clientY;
      updateOverlay(event.clientX, event.clientY);
    }

    function onMapMove() {
      updateOverlay(lastCursorX, lastCursorY);
    }

    function cancelSelection() {
      if (box) {
        box.remove();
        box = null;
      }
      anchor = null;
      document.removeEventListener("mousemove", onMouseMove);
      map?.off("move", onMapMove);
    }

    function onClick(event: MouseEvent) {
      if (!map) return;
      const rect = container.getBoundingClientRect();
      const point = map.unproject([
        event.clientX - rect.left,
        event.clientY - rect.top,
      ]);

      if (!anchor) {
        anchor = { lng: point.lng, lat: point.lat };
        lastCursorX = event.clientX;
        lastCursorY = event.clientY;

        box = document.createElement("div");
        box.style.position = "absolute";
        box.style.border = "2px dashed var(--theme-accent)";
        box.style.backgroundColor =
          "color-mix(in srgb, var(--theme-accent) 20%, transparent)";
        box.style.pointerEvents = "none";
        box.style.zIndex = "10";
        container.appendChild(box);

        document.addEventListener("mousemove", onMouseMove);
        map.on("move", onMapMove);
        return;
      }

      const bbox = cornersToBbox(anchor, point);
      cancelSelection();
      onBoxRef.current(bbox);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") cancelSelection();
    }

    container.addEventListener("click", onClick);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      container.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousemove", onMouseMove);
      map.off("move", onMapMove);
      if (box) box.remove();
      map.getCanvas().style.cursor = "";
    };
  }, [map, enabled]);
}
