// "Also copy its photos": the switch every copy of a place offers, pre-set
// from the account's remembered `copyPlaceMedia`, and flipping it writes the
// new default back. A friend's place (CopySheet) and a plan's (Save a copy)
// both ask it this way.
import { useCallback, useState } from "react";
import { messageFromError } from "@logjam/shared";

import { apiFetch } from "../api/apiFetch";
import { fetchCurrentUser, useApiQuery } from "../api/queries";
import type { TUser } from "../api/types";
import { useAccountState } from "../auth/AccountStateContext";

/** `[withMedia, toggle]` for a sheet that is open while `active`. */
export function useRememberedCopyMedia(active: boolean): [boolean, () => void] {
  const { accountState } = useAccountState();
  // Gated on `active` as well as on having an account: the sheets that use
  // this stay MOUNTED between openings, so an ungated query would fetch on
  // every mount for a panel nobody opened. (`/users/me` is cached for 60 s in
  // apiFetch, which makes the open itself free anyway.)
  const userQuery = useApiQuery(
    fetchCurrentUser,
    "Couldn't load your settings.",
    active && accountState !== "guest",
  );
  // Undefined until the account answers; the switch renders from the same
  // default the server would apply, so it never shows a position that is a lie.
  const remembered = userQuery.data?.uiPreferences?.copyPlaceMedia ?? true;
  const [copyMedia, setCopyMedia] = useState<boolean | null>(null);
  // Re-seeded on each open, and when the account's answer lands while open.
  const seedKey = active ? remembered : null;
  const [seededFor, setSeededFor] = useState<boolean | null>(null);
  if (seedKey !== seededFor) {
    setSeededFor(seedKey);
    if (seedKey !== null) setCopyMedia(seedKey);
  }

  /** Flipping the switch also moves the remembered default — that IS the memory. */
  const toggle = useCallback(() => {
    setCopyMedia((current) => {
      const next = !(current ?? true);
      apiFetch<TUser>("/users/me", {
        method: "PATCH",
        body: { copyPlaceMedia: next },
      }).catch((err: unknown) => {
        // The copy still honours THIS sheet's answer (it is sent explicitly),
        // so a failed save costs the memory, not the action.
        console.error(messageFromError(err, "Couldn't save that preference."));
      });
      return next;
    });
  }, []);

  return [copyMedia ?? true, toggle];
}
