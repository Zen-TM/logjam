import { useState, useEffect, type Dispatch, type SetStateAction } from "react";

/**
 * `useState` mirrored into a Web Storage area, JSON-encoded.
 *
 * `storage` picks the polarity, and that choice is a product decision, not a
 * technical one:
 *
 * - `localStorage` (default) — a **preference**. Something the user chose and
 *   expects to find again next month: active base layer, sort order, overlay
 *   toggles.
 * - `sessionStorage` — an **ephemeral filter**. Something that must survive a
 *   remount (sidebar panels unmount on close) or a tab switch, but must NOT
 *   greet the user weeks later: search boxes, date ranges. A month-old filter
 *   reads as "my canyons are missing", not as a favour (UX finding 5).
 *
 * Storage is resolved lazily inside the try/catch blocks so an environment
 * without web storage (SSR, hardened private mode) lands in the existing catch
 * rather than throwing a ReferenceError before reaching it.
 *
 * The storage area is read once on mount, like `key` — no call site swaps
 * either at runtime.
 */
export function useStoredState<T>(
  key: string,
  defaultValue: T,
  storage?: Storage,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = (storage ?? localStorage).getItem(key);
      if (raw === null) return defaultValue;
      return JSON.parse(raw) as T;
    } catch {
      try {
        (storage ?? localStorage).removeItem(key);
      } catch {
        // quota or security restriction — ignore
      }
      return defaultValue;
    }
  });

  useEffect(() => {
    try {
      (storage ?? localStorage).setItem(key, JSON.stringify(value));
    } catch (err) {
      console.warn(`useStoredState: failed to persist "${key}"`, err);
    }
  }, [key, value, storage]);

  return [value, setValue];
}
