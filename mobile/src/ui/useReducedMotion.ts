import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo } from "react-native";

/**
 * Whether the device asks for less motion: Android's "Remove animations", iOS's
 * "Reduce Motion". A sheet, toast or tray that would slide then appears where
 * it ends up.
 *
 * The last answer is kept at module level, so a sheet that mounts and animates
 * in its first frame already knows it: only the very first mount after the app
 * starts, before the OS has answered, can play its motion once.
 *
 * Returns a boolean to render with. Animations started from a callback made
 * once (a sheet's slide, a toast's swipe) cannot read a changing value, so
 * `useReducedMotionRef` hands them a ref that stays current.
 */
let lastKnown = false;

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(lastKnown);
  useEffect(() => {
    let live = true;
    const set = (on: boolean) => {
      lastKnown = on;
      if (live) setReduced(on);
    };
    void AccessibilityInfo.isReduceMotionEnabled().then(set);
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", set);
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
