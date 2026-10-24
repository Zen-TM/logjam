import { MAP_MEASURE } from "@logjam/shared";

/**
 * The pages of Logjam Web. One per question a user arrives with:
 * Places · Logs (and Stats) · Ways (routes, tracks, imports) · Maps (GeoPDFs,
 * LiDAR topos) · Friends, then Inbox · Account · Settings. What is on the map
 * is not a page: it is the Layers control over the map.
 */
export type PanelId =
  | "places"
  | "logs"
  | "ways"
  | "maps"
  | "friends"
  | "inbox"
  | "account"
  | "settings"
  // Opened programmatically (a pin, a row, a route line) — never a nav item.
  | "place-detail"
  | "trip-detail"
  | "way-detail"
  // The route tool, as a page rather than a card over the map: the map is the
  // canvas and nothing should float on it while a line is being drawn.
  | "way-draw"
  // The measure tool, a page for the same reason. It is armed exactly while
  // this page is open: nothing is kept, so leaving the page is leaving the tool.
  | "measure";

/** The pages that are an armed drawing tool (`map/draftTool.tsx`). On narrow
 *  web they open their sheet at the peek, so the map is there to press. */
const DRAFT_PANELS: readonly PanelId[] = ["way-draw", "measure"];
export const isDraftPanel = (panel: PanelId | null) =>
  panel !== null && DRAFT_PANELS.includes(panel);

/** How much of a drawing tool's sheet shows at its peek, in px: the grab bar,
 *  the hero (57, or 73 for a finger) and one row, which is `DraftPeek`. Taller
 *  than a title's peek, which would show the hero and none of the readout. */
export const DRAFT_PEEK_REVEAL_PX = 152;

/** Each page's name — its header, and the document title while it is open. */
export const PANEL_TITLES: Record<PanelId, string> = {
  places: "Places",
  logs: "Logs",
  ways: "Ways",
  maps: "Maps",
  friends: "Friends",
  inbox: "Inbox",
  account: "Account",
  settings: "Settings",
  "place-detail": "Place",
  "trip-detail": "Trip",
  "way-detail": "Way",
  "way-draw": "Draw a route",
  measure: MAP_MEASURE.title,
};

/** A page with two views swaps its content in place under one rail of chips,
 *  rather than being two pages. */
export type LogsView = "logs" | "stats";
export type MapsView = "geopdfs" | "exports" | "lidar";
