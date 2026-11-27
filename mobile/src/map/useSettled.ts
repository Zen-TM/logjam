import { useEffect, useState } from "react";

/**
 * `value`, held back by `ms` after it last changed so a burst of changes (a
 * drag) shows only where it rests. A null passes through at once: a layer
 * that stops being drawn does not wait.
 */
export function useSettled<T>(value: T | null, ms: number): T | null {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return value === null ? null : settled;
}
