import { useEffect, useRef } from "react";

/**
 * Runs `reapply` when `key` changes while `active` (3D is on), so terrain is
 * drawn again from the new set of sharpened areas or the region now shown
 * (`terrainReapplyKey`). Not on mount: 3D starts off, and switching it on reads
 * the current ones.
 */
export function useTerrainReapply(
  key: string,
  active: boolean,
  reapply: () => void,
): void {
  const latest = useRef({ active, reapply });
  useEffect(() => {
    latest.current = { active, reapply };
  });
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (latest.current.active) latest.current.reapply();
  }, [key]);
}
