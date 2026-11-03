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

/** The share of the map's height that stays clear of the sheet and the fit's own padding. */
const MIN_VISIBLE = 0.35;

/**
 * The height of the map the narrow bottom sheet hides once it settles, so a
 * place can be centred above it or a fit padded by it. Read from the sheet's
 * own target transform (its CSS transition is still running when a place opens
 * from a peek); zero where there is no sheet. Capped: a full-height sheet hides
 * the whole map and no padding saves the pin from that. `fitPadding` is what
 * the caller adds around it; the cap leaves `MIN_VISIBLE` of the height beyond
 * both, so a short (landscape) viewport still has room to fit.
 */
export function sheetCoverPx(viewportHeight: number, fitPadding = 0): number {
  const sheet = document.querySelector<HTMLElement>(`[${BOTTOM_SHEET_ATTR}]`);
  const top = /translateY\((-?[\d.]+)px\)/.exec(sheet?.style.transform ?? "");
  if (!top) return 0;
  const cap = Math.min(
    viewportHeight * 0.7,
    viewportHeight * (1 - MIN_VISIBLE) - fitPadding,
  );
  return Math.max(0, Math.min(viewportHeight - Number(top[1]), cap));
}
