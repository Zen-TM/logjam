import { useEffect, useState } from "react";

// Under this height (200% zoom on a laptop) the same fraction shows about one
// row under the page's own chrome, so "half" is as tall as "full".
const SHORT_VIEWPORT_PX = 500;

/** The window's height, and whether it is short enough that "half" is "full". */
export type Viewport = { height: number; short: boolean };

/** Track the window reactively (orientation change, address-bar toggle).
 *  `short` is judged on the tallest the window has been at its current width:
 *  an on-screen keyboard shrinks the height and not the width, and must not
 *  turn a phone into a 200%-zoom laptop. Zoom changes the width, so it resets. */
export function useViewport(): Viewport {
  const read = () => {
    const { innerWidth: width, innerHeight: height } =
      typeof window === "undefined"
        ? ({ innerWidth: 390, innerHeight: 800 } as const)
        : window;
    return { width, height, tallest: height };
  };
  const [seen, setSeen] = useState(read);
  useEffect(() => {
    function onResize() {
      setSeen((before) => {
        const next = read();
        return next.width === before.width
          ? { ...next, tallest: Math.max(next.height, before.tallest) }
          : next;
      });
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return { height: seen.height, short: seen.tallest < SHORT_VIEWPORT_PX };
}
