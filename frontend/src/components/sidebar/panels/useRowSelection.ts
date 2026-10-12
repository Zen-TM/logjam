import { useCallback, useEffect, useRef, useState } from "react";
import { idRange } from "./placesModel";

/**
 * A list's multi-select (DESIGN.md): tick a row's tile, shift-click for a
 * range, Esc clears, Ctrl/Cmd-A picks every row the list shows. Attach `rootRef`
 * to the panel so the keys only act while focus is in it.
 *
 * Picked ids that stop being rows (a friend just removed) drop out on their
 * own, so a bulk verb never reaches something the user can no longer see.
 */
export function useRowSelection(rowIds: readonly string[]) {
  const rootRef = useRef<HTMLDivElement>(null);
  const anchor = useRef<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const selectedIds = picked.filter((id) => rowIds.includes(id));
  const selecting = selectedIds.length > 0;

  const clear = useCallback(() => {
    setPicked([]);
    anchor.current = null;
  }, []);

  const toggle = (id: string, extendRange: boolean) => {
    if (extendRange && anchor.current) {
      const range = idRange(rowIds, anchor.current, id);
      setPicked((current) => [...new Set([...current, ...range])]);
    } else {
      setPicked((current) =>
        current.includes(id)
          ? current.filter((other) => other !== id)
          : [...current, id],
      );
    }
    anchor.current = id;
  };

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !selecting) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, [role='menu']")) return;
      if (event.key === "Escape") {
        event.preventDefault();
        clear();
      } else if (
        event.key.toLowerCase() === "a" &&
        (event.ctrlKey || event.metaKey)
      ) {
        event.preventDefault();
        setPicked([...rowIds]);
      }
    };
    root.addEventListener("keydown", onKeyDown);
    return () => root.removeEventListener("keydown", onKeyDown);
  }, [selecting, rowIds, clear]);

  return { rootRef, selectedIds, selecting, toggle, clear };
}
