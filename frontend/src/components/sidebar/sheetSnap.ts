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
