export type PanelId =
  | "layers"
  | "canyons"
  | "geopdfs"
  | "lidar"
  | "trip-logs"
  | "analytics"
  | "friends"
  | "notifications"
  | "account"
  | "canyon-detail"
  // Opened programmatically from a map click, like canyon-detail — never a
  // nav item (NavItemId excludes both).
  | "route-detail";
