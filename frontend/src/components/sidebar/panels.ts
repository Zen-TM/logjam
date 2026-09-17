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
  | "way-detail"
  // The route tool, as a page rather than a card over the map: the map is the
  // canvas and nothing should float on it while a line is being drawn.
  | "way-draw";

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
  "way-detail": "Way",
  "way-draw": "Draw a route",
};

/** A page with two views swaps its content in place under one rail of chips,
 *  rather than being two pages. */
export type LogsView = "logs" | "stats";
export type MapsView = "geopdfs" | "lidar";
