/**
 * A scheme colour as MapLibre needs it: a literal, read off the root when a
 * layer is painted. The layer keeps the value, so a scheme change repaints it
 * (the "logjam-theme-change" listener in Map.tsx).
 */
export function readCssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}
