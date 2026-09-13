import { useLayoutEffect, type RefObject } from "react";

// Positioning for everything the kit floats in the browser's top layer (menus,
// popovers, tooltips). The top layer is what escapes a panel's `overflow`, so a
// row menu is never clipped by the list it belongs to; the price is that the
// element no longer flows beside its trigger and has to be placed by hand.

export type Placement =
  | "bottom-start"
  | "bottom-end"
  | "top-start"
  | "top-end"
  | "right-start"
  | "left-start";

type Box = { top: number; left: number; right: number; bottom: number };
type Size = { width: number; height: number };

/** Never closer than this to a viewport edge. */
const VIEWPORT_MARGIN = 8;

/**
 * Where to put a floating box of `size` beside `anchor`. Flips to the opposite
 * side only when the preferred side runs off the viewport AND the other side
 * has room, then clamps into the viewport either way — a menu partly over its
 * trigger is usable, a menu off-screen is not.
 */
export function floatingPosition(
  anchor: Box,
  size: Size,
  viewport: Size,
  placement: Placement,
  gap = 8,
): { top: number; left: number } {
  const [side, align] = placement.split("-") as ["bottom" | "top" | "right" | "left", "start" | "end"];
  const fitsBelow = anchor.bottom + gap + size.height <= viewport.height - VIEWPORT_MARGIN;
  const fitsAbove = anchor.top - gap - size.height >= VIEWPORT_MARGIN;
  const fitsRight = anchor.right + gap + size.width <= viewport.width - VIEWPORT_MARGIN;
  const fitsLeft = anchor.left - gap - size.width >= VIEWPORT_MARGIN;

  let top: number;
  let left: number;
  if (side === "bottom" || side === "top") {
    left = align === "start" ? anchor.left : anchor.right - size.width;
    const below = anchor.bottom + gap;
    const above = anchor.top - gap - size.height;
    if (side === "bottom") top = !fitsBelow && fitsAbove ? above : below;
    else top = !fitsAbove && fitsBelow ? below : above;
  } else {
    top = anchor.top;
    const right = anchor.right + gap;
    const leftSide = anchor.left - gap - size.width;
    if (side === "right") left = !fitsRight && fitsLeft ? leftSide : right;
    else left = !fitsLeft && fitsRight ? right : leftSide;
  }

  const clamp = (value: number, extent: number, limit: number) =>
    Math.min(Math.max(value, VIEWPORT_MARGIN), Math.max(VIEWPORT_MARGIN, limit - extent - VIEWPORT_MARGIN));
  return {
    top: clamp(top, size.height, viewport.height),
    left: clamp(left, size.width, viewport.width),
  };
}

/** Keeps an open floating element pinned to its anchor through resizes,
 *  scrolls (of any ancestor) and changes to its own size. */
export function useAnchoredPosition(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  floatingRef: RefObject<HTMLElement | null>,
  placement: Placement,
  gap?: number,
): void {
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = anchorRef.current;
      const floating = floatingRef.current;
      if (!anchor || !floating) return;
      const { top, left } = floatingPosition(
        anchor.getBoundingClientRect(),
        floating.getBoundingClientRect(),
        { width: window.innerWidth, height: window.innerHeight },
        placement,
        gap,
      );
      floating.style.top = `${top}px`;
      floating.style.left = `${left}px`;
    };
    place();
    const observer = new ResizeObserver(place);
    if (floatingRef.current) observer.observe(floatingRef.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, anchorRef, floatingRef, placement, gap]);
}
