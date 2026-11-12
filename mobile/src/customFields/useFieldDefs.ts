// The definitions in force on this install, as a hook — the read half of
// `fieldDefsStore`.
//
// One source now, for both account states: the local mirror. It is watched
// rather than read once, via `onMirrorChanged` — which both a local write
// (`saveFieldDefs`) and a delta pull fire — so a field added in Settings, or
// added in a browser and pulled in while the screen stayed mounted, shows up
// in the trip form without a remount.
//
// Reading definitions is purely local and never depends on the network,
// with no account-specific fetch to fail or diverge from.
import { useEffect, useState } from "react";
import type { CustomFieldEntity, ScopedCustomFieldDef } from "@logjam/shared";

import { onMirrorChanged } from "../sync/syncDb";
import { loadFieldDefs } from "./fieldDefsStore";

export type FieldDefsState = {
  defs: ScopedCustomFieldDef[];
  /** Optimistic local update after a save, so a form that just saved can show
   *  the new list without waiting for the mirror notification to land. The
   *  store is still the thing that persisted it. */
  setDefs: (next: ScopedCustomFieldDef[]) => void;
};

export function useFieldDefs(entity: CustomFieldEntity): FieldDefsState {
  const [defs, setDefs] = useState<ScopedCustomFieldDef[]>([]);

  useEffect(() => {
    const read = () => {
      loadFieldDefs(entity).then(setDefs).catch(console.error);
    };
    read();
    return onMirrorChanged(read);
  }, [entity]);

  return { defs, setDefs };
}
