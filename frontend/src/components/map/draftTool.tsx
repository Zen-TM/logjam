// What the two point-drawing tools share beside the map: the route tool
// (`routes/RouteDrawPanel.tsx`) and the measure tool (`MeasurePanel.tsx`) are
// one interaction, so the parts that would otherwise be written twice are here.
import { useEffect, useState } from "react";
import type { SnapMode } from "@logjam/shared";
import { Select } from "../../ui";

/** How long the line must sit still before its terrain is read. A profile per
 *  placed vertex would be one request per click; this asks once the user pauses,
 *  which is when they are looking at the figures anyway. */
const PROFILE_SETTLE_MS = 700;

/**
 * The line as it was when the user last paused, or null while it has no two
 * ends. Profiling the live draft would fire a request per click and re-render
 * the figures mid-gesture.
 *
 * SEEDED with the line as it arrives, when there is one: opening the editor on
 * an existing route is not a pause to wait out.
 */
export function useSettledLine(
  points: [number, number][],
): [number, number][] | null {
  const [settled, setSettled] = useState<[number, number][] | null>(() =>
    points.length >= 2 ? points : null,
  );
  // No line, nothing to profile: dropped during render, not after a pause.
  // (A pending timer for the last line is cleared by the effect's cleanup.)
  if (points.length < 2 && settled !== null) setSettled(null);
  useEffect(() => {
    if (points.length < 2) return;
    const timer = window.setTimeout(
      () => setSettled(points),
      PROFILE_SETTLE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [points]);
  return settled;
}

/**
 * Ctrl+Z / Cmd+Z while a drawing tool is mounted, which is exactly while a
 * draft exists. It defers to a focused field so it can never eat an undo meant
 * for typing.
 */
export function useUndoKey(onUndo: () => void) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "z" && event.key !== "Z") return;
      if (!event.ctrlKey && !event.metaKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      event.preventDefault();
      onUndo();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onUndo]);
}

/** What the next segment follows. A tool's own setting, so it lives in the
 *  tool's footer and not in Layers (shared/DESIGN.md §15). */
export function SnapSelect({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: SnapMode;
  disabled?: boolean;
  onChange: (mode: SnapMode) => void;
}) {
  return (
    <Select
      label={label}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value as SnapMode)}
    >
      <option value="off">Nothing (straight lines)</option>
      <option value="trails">Trails</option>
      <option value="waterways">Creeks &amp; rivers</option>
      <option value="both">Trails, creeks &amp; rivers</option>
    </Select>
  );
}
