import { useState, useEffect } from "react";
import { getCustomFieldImpact, type CustomFieldEntityKind } from "../../canyonUtils";
import { messageFromError } from "../../errors/messageFromError";

/**
 * Impact count for a custom field: how many of the user's rows (trip logs or
 * canyons, per `entity`) carry a value for `fieldKey`. Fetched from the server
 * (the client's row lists are capped, so a client-side count could undercount).
 * Drives the warning shown in the rename/delete confirm dialogs — pass `null`
 * for `fieldKey` while no confirm is open.
 *
 * Returns `count: null` while loading (or when `fieldKey` is null); `error` is
 * user-facing via messageFromError.
 */
export function useCustomFieldImpact(
  entity: CustomFieldEntityKind,
  fieldKey: string | null,
): {
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
    const noun = entity === "canyon" ? "canyons" : "trips";
    getCustomFieldImpact(entity, fieldKey)
      .then(({ count: impactCount }) => {
        if (!cancelled) setCount(impactCount);
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled)
          setError(
            messageFromError(err, `Couldn't check how many ${noun} use this field.`),
          );
      });
    return () => {
      cancelled = true;
    };
  }, [entity, fieldKey]);

  return { count, error };
}
