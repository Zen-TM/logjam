import { useCallback, useEffect, useState } from "react";

/**
 * A page's side sheet: whether it is open, plus the two things that must happen
 * every time it opens or closes — the map's chrome slides clear of it
 * (`--map-inset-left` is derived from `data-sheet-open` on `#map`), and on
 * narrow web the bottom sheet grows to full so the sheet has room.
 *
 * Both pages that have a sheet call this rather than repeating the plumbing.
 * Repeating it is exactly how Logs' date sheet ended up opening without the
 * map's chrome moving over, while Places' did (operator, 2026-09-16).
 */
export function usePanelSheet({
  onOpenChange,
  onExpandSheet,
}: {
  /** Told on every change, so the shell can inset the map. */
  onOpenChange: (open: boolean) => void;
  /** Narrow web: grow the bottom sheet to full. */
  onExpandSheet?: () => void;
}): { sheetOpen: boolean; openSheet: (open: boolean) => void } {
  const [sheetOpen, setSheetOpen] = useState(false);

  const openSheet = useCallback(
    (open: boolean) => {
      setSheetOpen(open);
      onOpenChange(open);
      if (open) onExpandSheet?.();
    },
    [onOpenChange, onExpandSheet],
  );

  // The page can be closed with its sheet still open; the map must not stay
  // inset for a sheet that is no longer on screen.
  useEffect(() => () => onOpenChange(false), [onOpenChange]);

  return { sheetOpen, openSheet };
}
