import { FRIENDS, FRIEND_SHARES } from "./friends.js";
import { STATS } from "./stats.js";
import { SEND_COPY, SHARE_SHEET } from "./share.js";
import { MAP_LAYERS } from "./mapLayers.js";
import { MAP_OVERLAYS } from "./mapOverlays.js";
import { MAP_POINT } from "./mapPoint.js";
import { ACCOUNT } from "./account.js";
import { SETTINGS } from "./settings.js";
import { INBOX } from "./inbox.js";
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
export * from "./inbox.js";
export * from "./friends.js";
export * from "./settings.js";
export * from "./account.js";
export * from "./mapLayers.js";
export * from "./mapOverlays.js";
export * from "./mapPoint.js";
export * from "./share.js";
export * from "./stats.js";
export * from "./wayVerbs.js";

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
  INBOX,
  FRIENDS,
  FRIEND_SHARES,
  SETTINGS,
  ACCOUNT,
  MAP_LAYERS,
  MAP_OVERLAYS,
  MAP_POINT,
  SHARE_SHEET,
  SEND_COPY,
  STATS,
];
