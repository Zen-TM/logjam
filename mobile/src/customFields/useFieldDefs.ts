// The definitions in force on this install, as a hook — the read half of
// `fieldDefsStore`.
//
// One source now, for both account states: the local mirror. It is watched
// rather than read once, via `onMirrorChanged` — which both a local write
// (`saveFieldDefs`) and a delta pull fire — so a field added in Settings, or
// added in a browser and pulled in while the screen stayed mounted, shows up
// in the trip form without a remount.
//
// This used to hold a second path for linked users that re-seeded from
// `/users/me`, with the account list serialized into a dependency key to spot
// changes. That is gone with the storage change: there is no account list to
// diverge from any more, and no fetch to fail, which is why `error` is gone
// too — reading definitions can no longer depend on the network.
import { useEffect, useState } from "react";
import type { CustomFieldEntity, TripLogCustomFieldDef } from "@logjam/shared";

import { onMirrorChanged } from "../sync/syncDb";
import { loadFieldDefs } from "./fieldDefsStore";

export type FieldDefsState = {
  defs: TripLogCustomFieldDef[];
  /** Optimistic local update after a save, so a form that just saved can show
   *  the new list without waiting for the mirror notification to land. The
   *  store is still the thing that persisted it. */
  setDefs: (next: TripLogCustomFieldDef[]) => void;
};

export function useFieldDefs(entity: CustomFieldEntity): FieldDefsState {
  const [defs, setDefs] = useState<TripLogCustomFieldDef[]>([]);

  useEffect(() => {
    const read = () => {
      loadFieldDefs(entity).then(setDefs).catch(console.error);
    };
    read();
    return onMirrorChanged(read);
  }, [entity]);

  return { defs, setDefs };
}
