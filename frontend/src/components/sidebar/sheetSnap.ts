import { createContext, useContext } from "react";
import type { SheetSnap } from "./BottomSheet";

/**
 * The snap point of the narrow bottom sheet a page is drawn in, or null where
 * the page sits beside the map. A page that has less to say at a peek (a
 * drawing tool: `map/draftTool.tsx`) reads it instead of being told by every
 * caller.
 */
export const SheetSnapContext = createContext<SheetSnap | null>(null);

export function useSheetAtPeek(): boolean {
  return useContext(SheetSnapContext) === "peek";
}

/** Marks the bottom sheet's element, for `sheetCoverPx`. */
export const BOTTOM_SHEET_ATTR = "data-bottom-sheet";

/**
 * The height of the map the narrow bottom sheet hides once it settles, so a
 * fit can pad the camera by it. Read from the sheet's own target transform
 * (its CSS transition is still running when a place opens from a peek); zero
 * where there is no sheet. Capped: a full-height sheet hides the whole map and
 * no padding saves the pin from that.
 */
export function sheetCoverPx(viewportHeight: number): number {
  const sheet = document.querySelector<HTMLElement>(`[${BOTTOM_SHEET_ATTR}]`);
  const top = /translateY\((-?[\d.]+)px\)/.exec(sheet?.style.transform ?? "");
  if (!top) return 0;
  return Math.min(
    Math.max(viewportHeight - Number(top[1]), 0),
    viewportHeight * 0.7,
  );
}
