import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo } from "react-native";

/**
 * Whether the device asks for less motion: Android's "Remove animations", iOS's
 * "Reduce Motion". A sheet, toast or tray that would slide then appears where
 * it ends up.
 *
 * Returns a boolean to render with. Animations started from a callback made
 * once (a sheet's slide, a toast's swipe) cannot read a changing value, so
 * `useReducedMotionRef` hands them a ref that stays current.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((on) => {
      if (live) setReduced(on);
    });
    const sub = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduced,
    );
    return () => {
      live = false;
      sub.remove();
    };
  }, []);
  return reduced;
}

/** `useReducedMotion` as a ref, for a callback created once. */
export function useReducedMotionRef() {
  const reduced = useReducedMotion();
  const ref = useRef(reduced);
  useEffect(() => {
    ref.current = reduced;
  });
  return ref;
}
