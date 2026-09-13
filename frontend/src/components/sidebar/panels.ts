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
  | "route-detail";

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
  "route-detail": "Route",
};

/** A page with two views swaps its content in place under one rail of chips,
 *  rather than being two pages. */
export type LogsView = "logs" | "stats";
export type MapsView = "geopdfs" | "lidar";
