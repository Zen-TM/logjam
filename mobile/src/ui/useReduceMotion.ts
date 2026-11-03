import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo } from "react-native";

/** The system's "Remove animations" setting, live. */
export function useReduceMotion(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => alive && setOn(value))
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setOn,
    );
    return () => {
      alive = false;
      subscription.remove();
    };
  }, []);
  return on;
}

/** The same, read at the moment of use without re-rendering. */
export function useReduceMotionRef() {
  const on = useReduceMotion();
  const ref = useRef(on);
  useEffect(() => {
    ref.current = on;
  }, [on]);
  return ref;
}
