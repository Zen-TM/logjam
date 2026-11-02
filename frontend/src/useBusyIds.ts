import { useState } from "react";

/** The controls whose write is in flight, each by its own id: one write
 *  finishing frees its own control, never another still working.
 *  Guard: plans.render.test.tsx (two invites at once). */
export function useBusyIds() {
  const [ids, setIds] = useState<ReadonlySet<string>>(new Set());
  return {
    isBusy: (id: string | null | undefined) => id != null && ids.has(id),
    start: (id: string) => setIds((was) => new Set(was).add(id)),
    stop: (id: string) =>
      setIds((was) => {
        const next = new Set(was);
        next.delete(id);
        return next;
      }),
  };
}
