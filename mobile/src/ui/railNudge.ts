// Where a scroll rail moves to show its selected chip; `ChipRail` draws it.

/**
 * Where a rail scrolls to show its selected chip whole: the new offset, null
 * when it already is, undefined while the chip or the rail's width is not
 * known yet (layout has not run). The visible band stops at the fades, drawn
 * only where there is more rail beyond them. Guard: railNudge.test.ts.
 */
export function railNudge(
  chip: { x: number; width: number } | undefined,
  viewport: { x: number; width: number },
  fade: number,
): number | null | undefined {
  if (chip === undefined || viewport.width <= 0) return undefined;
  const { x, width } = viewport;
  const bandStart = x > 1 ? x + fade : x;
  const bandEnd = x + width - fade;
  if (chip.x < bandStart) return Math.max(0, chip.x - fade);
  if (chip.x + chip.width > bandEnd) return chip.x + chip.width - width + fade;
  return null;
}
