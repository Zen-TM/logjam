// The definitions in force on this install, as a hook — the read half of
// `fieldDefsStore`, wired to whichever source that file says applies.
//
// Both sources are watched, not polled once: a guest's list lives in the local
// KV and is re-read on `onMirrorChanged` (which `writeLocalFieldDefs` fires), a
// linked user's arrives with `/users/me` and is re-seeded whenever a refetch
// moves it. Without either, adding a field in Settings left the trip form
// showing the old list until the screen was remounted.
//
// `setDefs` exists so a form that has just saved can show the new list without
// waiting for a round trip; the store is still the thing that persisted it.
import { useEffect, useState } from "react";
import type { TripLogCustomFieldDef } from "@logjam/shared";

import {
  customFieldDefsOf,
  fetchCurrentUser,
  useApiQuery,
  type CustomFieldEntity,
} from "../api/queries";
import { useAccountState } from "../auth/AccountStateContext";
import { onMirrorChanged } from "../sync/syncDb";
import { readLocalFieldDefs } from "./fieldDefsStore";

export type FieldDefsState = {
  defs: TripLogCustomFieldDef[];
  /** Optimistic local update after a save. Does not persist — the store does. */
  setDefs: (next: TripLogCustomFieldDef[]) => void;
  /** Why the ACCOUNT list couldn't be read. Always null for a guest. */
  error: string | null;
};

export function useFieldDefs(entity: CustomFieldEntity): FieldDefsState {
  const { accountState } = useAccountState();
  const guest = accountState === "guest";
  const [defs, setDefs] = useState<TripLogCustomFieldDef[]>([]);
  // Disabled for a guest: they have no account to 401 against, and a guaranteed
  // failure per screen open is a battery cost (mobile/CLAUDE.md).
  const userQuery = useApiQuery(fetchCurrentUser, "Couldn't load your fields.", !guest);

  useEffect(() => {
    if (!guest) return;
    const read = () => {
      readLocalFieldDefs(entity).then(setDefs).catch(console.error);
    };
    read();
    return onMirrorChanged(read);
  }, [entity, guest]);

  // Re-seed on the VALUE, not on `user.id` — which never changes for a signed-in
  // user, so defs edited on another device and pulled in by a refetch while the
  // screen stayed mounted were silently dropped. The serialized list is the key
  // because a refetch mints a fresh object even when nothing moved.
  const accountDefsKey = userQuery.data
    ? JSON.stringify(customFieldDefsOf(userQuery.data, entity))
    : null;
  useEffect(() => {
    if (accountDefsKey == null) return;
    setDefs(JSON.parse(accountDefsKey) as TripLogCustomFieldDef[]);
  }, [accountDefsKey]);

  return { defs, setDefs, error: guest ? null : userQuery.error };
}
