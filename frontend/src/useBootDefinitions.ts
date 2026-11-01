import { useEffect } from "react";
import type { ScopedCustomFieldDef } from "@logjam/shared";
import { getCustomFields, getPlaceTypes, type TPlaceType } from "./placeUtils";

/**
 * The boot-time fetches of the user's field definitions and place types.
 * `enabled` is the consent gate's `loadsUserData`, never `authenticated`: it
 * flips true once consent settles, so the data loads without a reload
 * (frontend/AGENTS.md, src/useBootDefinitions.test.ts).
 *
 * The place definitions come from the row-grain endpoint because only it
 * carries the scoping. Best-effort: a failure leaves the forms with the
 * built-in fields alone, and the panels show their own error states.
 */
export function useBootDefinitions(
  enabled: boolean,
  setPlaceCustomFieldDefs: (defs: ScopedCustomFieldDef[]) => void,
  setCustomFieldDefs: (defs: ScopedCustomFieldDef[]) => void,
  setPlaceTypes: (types: TPlaceType[]) => void,
) {
  useEffect(() => {
    if (!enabled) return;
    getCustomFields("place").then(setPlaceCustomFieldDefs).catch(console.error);
    getCustomFields("trip-log").then(setCustomFieldDefs).catch(console.error);
    getPlaceTypes().then(setPlaceTypes).catch(console.error);
  }, [enabled, setPlaceCustomFieldDefs, setCustomFieldDefs, setPlaceTypes]);
}
