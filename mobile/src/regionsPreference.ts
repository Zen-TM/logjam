// The regions the user chose (`uiPreferences.regions`): what Logjam GPS offers
// (the basemap picker today), never what draws or answers for a location
// (shared/src/regions.ts). Kept on the phone as last seen, so the picker is
// right with no signal, and for a guest, who has no account to send it to.
import { useSyncExternalStore } from "react";
import { normalizeRegionIds } from "@logjam/shared";

import { apiFetch } from "./api/apiFetch";
import { readPref, writePref } from "./prefsDb";

const REGIONS_PREF_KEY = "regions";

let current: string[] | null = null;
let sending = false;
const listeners = new Set<() => void>();

function stored(): string[] {
  try {
    return normalizeRegionIds(JSON.parse(readPref(REGIONS_PREF_KEY) ?? "null"));
  } catch {
    return normalizeRegionIds(null);
  }
}

/** The chosen region ids now: as last kept, or the default. */
export function readRegions(): string[] {
  return (current ??= stored());
}

export function useRegions(): string[] {
  return useSyncExternalStore(subscribe, readRegions);
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/**
 * Whether a choice is on its way to the account. The screens hold their
 * switches while it is: a second choice could be rolled back by the first's
 * failure, and two sends can land out of order.
 */
export const isSendingRegions = (): boolean => sending;

export function useRegionsSending(): boolean {
  return useSyncExternalStore(subscribe, isSendingRegions);
}

function keep(ids: string[]): void {
  if (JSON.stringify(ids) === JSON.stringify(readRegions())) return;
  current = ids;
  writePref(REGIONS_PREF_KEY, JSON.stringify(ids));
  for (const listener of listeners) listener();
}

function setSending(value: boolean): void {
  sending = value;
  for (const listener of listeners) listener();
}

/** Take the account's choice (absent reads as the default, as the API does). */
export function keepAccountRegions(fetched: unknown): void {
  keep(normalizeRegionIds(fetched));
}

/** Back to the default: the sign-out wipe, so the next account never sees this one's choice. */
export function forgetRegions(): void {
  keep(normalizeRegionIds(null));
}

/**
 * Keep a choice made on this phone and, signed in, send it to the account.
 * Returns whether it reached the account (true for a guest, who sends
 * nothing: ADR 0007). A failed send puts the previous choice back, so the
 * phone never holds a choice the account does not. One send at a time: the
 * screens disable their switches while `useRegionsSending()` (the test holds them to it).
 */
export async function chooseRegions(
  ids: readonly string[],
  signedIn: boolean,
): Promise<boolean> {
  const before = readRegions();
  const next = normalizeRegionIds(ids);
  keep(next);
  if (!signedIn) return true;
  setSending(true);
  try {
    await apiFetch("/users/me", { method: "PATCH", body: { regions: next } });
    return true;
  } catch (err) {
    console.error(err);
    keep(before);
    return false;
  } finally {
    setSending(false);
  }
}
