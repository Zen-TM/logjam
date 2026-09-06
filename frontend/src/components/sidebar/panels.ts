export type PanelId =
  | "layers"
  | "places"
  | "geopdfs"
  | "lidar"
  | "routes"
  | "trip-logs"
  | "analytics"
  | "friends"
  | "notifications"
  | "account"
  | "place-detail"
  // Opened programmatically from a map click, like place-detail — never a
  // nav item (NavItemId excludes both).
  | "route-detail";
