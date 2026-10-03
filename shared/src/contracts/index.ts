import { PLACE_PAGE } from "./placePage.js";
import { TRIP_PAGE } from "./tripPage.js";
import { TRIPS_ADD, TRIPS_FILTER_SHEET, TRIPS_LIST } from "./tripLogs.js";
import { PLACES_FILTER_SHEET } from "./placesFilterSheet.js";
import { PLACES_ADD, PLACES_LIST } from "./placesList.js";
import type { ScreenContract } from "./types.js";

export * from "./types.js";
export * from "./placesList.js";
export * from "./placesFilterSheet.js";
export * from "./placeVerbs.js";
export * from "./placePage.js";
export * from "./tripVerbs.js";
export * from "./tripPage.js";
export * from "./tripLogs.js";

/** Every screen contract, so `contracts.test.ts` checks a new one unasked. */
export const SCREEN_CONTRACTS: readonly ScreenContract[] = [
  PLACES_LIST,
  PLACES_ADD,
  PLACES_FILTER_SHEET,
  PLACE_PAGE,
  TRIP_PAGE,
  TRIPS_LIST,
  TRIPS_ADD,
  TRIPS_FILTER_SHEET,
];
