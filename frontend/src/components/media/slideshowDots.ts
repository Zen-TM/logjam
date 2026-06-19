// Pure pagination-dot model for the canyon slideshow. A canyon can have many
// photos, so the dot strip must never overflow: we render at most `maxDots`
// dots as a window centred on the active slide, shrinking the window-edge dots
// when more slides exist beyond them (the common carousel-pagination pattern).

export type DotSize = "small" | "medium" | "full";

export interface SlideshowDot {
  index: number;
  size: DotSize;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function slideshowDots(
  count: number,
  activeIndex: number,
  maxDots: number,
): SlideshowDot[] {
  if (count <= 0) return [];
  const active = clamp(activeIndex, 0, count - 1);

  // Few enough slides to show one dot each.
  if (count <= maxDots) {
    return Array.from({ length: count }, (_, index) => ({
      index,
      size: index === active ? "full" : "medium",
    }));
  }

  // Window of `maxDots` consecutive slides centred on the active one, clamped so
  // it never runs past either end.
  const start = clamp(active - Math.floor(maxDots / 2), 0, count - maxDots);
  const end = start + maxDots - 1;
  const hasMoreBefore = start > 0;
  const hasMoreAfter = end < count - 1;

  const dots: SlideshowDot[] = [];
  for (let index = start; index <= end; index++) {
    let size: DotSize;
    if (index === active) size = "full";
    else if ((index === start && hasMoreBefore) || (index === end && hasMoreAfter))
      size = "small";
    else size = "medium";
    dots.push({ index, size });
  }
  return dots;
}
