// The units the user chose (`uiPreferences.units`), kept on the phone as last
// seen so figures read right with no signal, and for a guest, who has no
// account to send it to. Null until chosen: the home region's units apply
// (`unitsOf`, shared/src/units.ts). `useDisplayUnits` is where a formatter's
// module state is set from it.
import { useSyncExternalStore } from "react";
import {
  choosesUnits,
  isUnits,
  setDisplayUnits,
  unitsOf,
  type Units,
} from "@logjam/shared";

import { apiFetch } from "./api/apiFetch";
import { readPref, writePref } from "./prefsDb";
import { useRegions } from "./regionsPreference";

const UNITS_PREF_KEY = "units";

let current: Units | null | undefined;
let sending = false;
const listeners = new Set<() => void>();

function stored(): Units | null {
  try {
    const value: unknown = JSON.parse(readPref(UNITS_PREF_KEY) ?? "null");
    return isUnits(value) ? value : null;
  } catch {
    return null;
  }
}

/** The units chosen on this phone or by the account, or null. */
export function readChosenUnits(): Units | null {
  // `undefined` is "not read yet": none chosen (null) is remembered too, so a
  // render reads storage once, not every time.
  if (current === undefined) current = stored();
  return current;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

function keep(units: Units | null): void {
  if (units === readChosenUnits()) return;
  current = units;
  writePref(UNITS_PREF_KEY, JSON.stringify(units));
  for (const listener of listeners) listener();
}

/**
 * Whether a choice is on its way to the account. The row holds while it is,
 * and `chooseUnits` refuses a second choice: a late failure would put back a
 * value the account no longer holds, and two sends can land out of order. It
 * lives here, not in the screen, so leaving Settings does not forget it.
 */
export const isSendingUnits = (): boolean => sending;

export function useUnitsSending(): boolean {
  return useSyncExternalStore(subscribe, isSendingUnits);
}

function setSending(value: boolean): void {
  sending = value;
  for (const listener of listeners) listener();
}

/**
 * The units figures are written in now. Called while rendering the root, so
 * every formatter below reads them on this render, and the root renders again
 * when the choice or the chosen regions change.
 */
export function useDisplayUnits(): Units {
  const chosen = useSyncExternalStore(subscribe, readChosenUnits);
  const regions = useRegions();
  const units = unitsOf({ units: chosen ?? undefined, regions });
  setDisplayUnits(units);
  return units;
}

/** Take the account's choice (absent: none, as the API stores it). */
export function keepAccountUnits(fetched: unknown): void {
  keep(isUnits(fetched) ? fetched : null);
}

/** Back to none: the sign-out wipe, so the next account never reads in this one's units. */
export function forgetUnits(): void {
  keep(null);
}

/**
 * Keep a choice made on this phone and, signed in, send it to the account.
 * Returns false only when the send failed, and then the previous choice is
 * back. A guest sends nothing (ADR 0007). A choice already stored, or one made
 * while another is being sent, does nothing and returns true.
 */
export async function chooseUnits(
  units: Units,
  signedIn: boolean,
): Promise<boolean> {
  const before = readChosenUnits();
  if (sending || !choosesUnits(before, units)) return true;
  keep(units);
  if (!signedIn) return true;
  setSending(true);
  try {
    await apiFetch("/users/me", { method: "PATCH", body: { units } });
    return true;
  } catch (err) {
    console.error(err);
    keep(before);
    return false;
  } finally {
    setSending(false);
  }
}
