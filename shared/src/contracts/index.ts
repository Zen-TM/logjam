import { PLACES_FILTER_SHEET } from "./placesFilterSheet.js";
import { PLACES_ADD, PLACES_LIST } from "./placesList.js";
import type { ScreenContract } from "./types.js";

export * from "./types.js";
export * from "./placesList.js";
export * from "./placesFilterSheet.js";
export * from "./placeVerbs.js";

/** Every screen contract, so `contracts.test.ts` checks a new one unasked. */
export const SCREEN_CONTRACTS: readonly ScreenContract[] = [
  PLACES_LIST,
  PLACES_ADD,
  PLACES_FILTER_SHEET,
];
