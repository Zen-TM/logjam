import { useState, useEffect } from "react";
import { getCustomFieldImpact } from "../../canyonUtils";
import { messageFromError } from "../../errors/messageFromError";

/**
 * Impact count for a custom trip field: how many of the user's trip logs carry
 * a value for `fieldKey`. Fetched from the server (the client's trip-log list
 * is capped, so a client-side count could undercount). Drives the warning shown
 * in the rename/delete confirm dialogs — pass `null` while no confirm is open.
 *
 * Returns `count: null` while loading (or when `fieldKey` is null); `error` is
 * user-facing via messageFromError.
 */
export function useCustomFieldImpact(fieldKey: string | null): {
  count: number | null;
  error: string | null;
} {
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCount(null);
    setError(null);
    if (!fieldKey) return;
    let cancelled = false;
    getCustomFieldImpact(fieldKey)
      .then(({ tripLogCount }) => {
        if (!cancelled) setCount(tripLogCount);
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled)
          setError(messageFromError(err, "Couldn't check how many trips use this field."));
      });
    return () => {
      cancelled = true;
    };
  }, [fieldKey]);

  return { count, error };
}
