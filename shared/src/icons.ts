/**
 * ICONS — one idea, one icon, declared once for both clients.
 *
 * Logjam Web draws Lucide; Logjam GPS draws Feather (a font: fast in long lists,
 * no native dependency) and, ONLY where Feather has nothing that says the idea,
 * MaterialCommunityIcons (`mci:<name>`, already inside `@expo/vector-icons`).
 * Where both sets have the same picture the two values are the same name.
 *
 * Rules the guard tests hold (`frontend/src/ui/icons.test.ts`,
 * `mobile/src/ui/icons.test.ts`, `shared/src/icons.test.ts`):
 * - every value resolves in its client's glyph set;
 * - no two ideas share a glyph on either client (one glyph, one idea);
 * - a trip type's glyph (`TRIP_TYPE_ICON_KEYS`) is not a UI idea's glyph.
 *
 * Screens never import a glyph: they render `<Icon idea="…" />` from the kit.
 * Place types and trip types are their own USER-PICKED vocabularies
 * (`PLACE_TYPE_ICON_KEYS`, `TRIP_TYPE_ICON_KEYS`) and resolve through their own
 * helpers.
 */

/** A Lucide icon's kebab-case name (`circle-check`). Resolved by the web test. */
export type LucideKebabName = string;
/** A Feather glyph name, or `mci:<name>` for MaterialCommunityIcons. */
export type GpsGlyph = string;

export const ICONS = {
  // — verbs: what a control does —
  add: { web: "plus", gps: "plus" },
  close: { web: "x", gps: "x" }, // close a surface, clear a field, cancel a job
  back: { web: "arrow-left", gps: "arrow-left" },
  forward: { web: "arrow-right", gps: "arrow-right" },
  done: { web: "check", gps: "check" }, // done, save, apply
  edit: { web: "pencil", gps: "edit-2" },
  delete: { web: "trash-2", gps: "trash-2" },
  undo: { web: "corner-up-left", gps: "corner-up-left" },
  search: { web: "search", gps: "search" },
  filter: { web: "sliders-vertical", gps: "sliders" }, // sort and filter
  selectAll: { web: "square-check", gps: "check-square" },
  multiSelect: { web: "list-checks", gps: "mci:format-list-checks" },
  copy: { web: "copy", gps: "copy" }, // copy, save a copy
  moveCopy: { web: "archive", gps: "archive" }, // save a copy and remove the original
  send: { web: "send", gps: "send" },
  shareFriend: { web: "share-2", gps: "share-2" },
  unshare: { web: "user-minus", gps: "user-minus" }, // unshare, remove a friend
  export: { web: "share", gps: "share" }, // write a new file
  download: { web: "download", gps: "download" }, // stored bytes
  saveOffline: { web: "cloud-download", gps: "download-cloud" },
  upload: { web: "upload", gps: "upload" }, // import or upload a file
  link: { web: "link", gps: "link" },
  unlink: { web: "link-2-off", gps: "mci:link-off" },
  openExternal: { web: "external-link", gps: "external-link" },
  show: { web: "eye", gps: "eye" },
  hide: { web: "eye-off", gps: "eye-off" },
  refresh: { web: "refresh-cw", gps: "refresh-cw" },
  retry: { web: "rotate-ccw", gps: "rotate-ccw" },
  merge: { web: "git-merge", gps: "git-merge" },
  replace: { web: "repeat", gps: "repeat" },
  reverse: { web: "arrow-left-right", gps: "mci:swap-horizontal" },
  draw: { web: "pen-tool", gps: "pen-tool" },
  measure: { web: "ruler", gps: "mci:ruler" },
  pickArea: { web: "square-dashed", gps: "mci:selection" },
  scan: { web: "scan", gps: "maximize" },
  zoomIn: { web: "zoom-in", gps: "zoom-in" },
  zoomOut: { web: "zoom-out", gps: "zoom-out" },
  navigateTo: { web: "navigation", gps: "navigation" },
  locate: { web: "locate-fixed", gps: "crosshair" },
  following: { web: "locate", gps: "mci:crosshairs-gps" },
  compass: { web: "compass", gps: "compass" },
  northUp: { web: "arrow-up", gps: "arrow-up" },
  play: { web: "play", gps: "play" },
  pause: { web: "pause", gps: "pause" },
  signOut: { web: "log-out", gps: "log-out" },
  accept: { web: "user-check", gps: "user-check" },
  ignore: { web: "user-x", gps: "user-x" },
  addFriend: { web: "user-plus", gps: "user-plus" },
  loading: { web: "loader", gps: "loader" },
  dragHandle: { web: "grip-vertical", gps: "mci:drag-vertical" },

  // — structure: where the user is, and how it opens —
  disclosure: { web: "chevron-right", gps: "chevron-right" }, // opens a sub-view
  expand: { web: "chevron-down", gps: "chevron-down" },
  collapse: { web: "chevron-up", gps: "chevron-up" },
  overflow: { web: "ellipsis-vertical", gps: "more-vertical" }, // a thing's verbs
  moreTab: { web: "ellipsis", gps: "more-horizontal" },

  // — states and feedback —
  success: { web: "circle-check", gps: "check-circle" }, // ok, done, chosen
  unselected: { web: "circle", gps: "circle" },
  warning: { web: "triangle-alert", gps: "alert-triangle" }, // problem, warning, error
  info: { web: "info", gps: "info" },
  help: { web: "circle-help", gps: "help-circle" },
  pending: { web: "clock", gps: "clock" },
  offline: { web: "cloud-off", gps: "cloud-off" },
  sync: { web: "cloud", gps: "cloud" },
  uploading: { web: "cloud-upload", gps: "upload-cloud" },
  missingMedia: { web: "image-off", gps: "mci:image-off" },
  favourite: { web: "star", gps: "star" },
  private: { web: "lock", gps: "lock" },

  // — things: what a row or tile is —
  map: { web: "map", gps: "map" }, // a map, the Maps tab, show on map
  place: { web: "map-pin", gps: "map-pin" },
  trip: { web: "book-open", gps: "book-open" },
  saved: { web: "folder", gps: "folder" }, // Saved: everything kept on this phone
  route: { web: "route", gps: "mci:vector-polyline" },
  track: { web: "activity", gps: "activity" },
  waypoint: { web: "git-commit", gps: "git-commit" },
  importedFile: { web: "file-plus", gps: "file-plus" },
  geoPdf: { web: "file-text", gps: "file-text" },
  lidar: { web: "mountain", gps: "mci:terrain" },
  layers: { web: "layers", gps: "layers" }, // the layer picker
  template: { web: "layout-template", gps: "layout" },
  notes: { web: "align-left", gps: "align-left" },
  stats: { web: "chart-column", gps: "bar-chart-2" },
  friends: { web: "users", gps: "users" },
  account: { web: "circle-user", gps: "user" },
  notifications: { web: "bell", gps: "bell" },
  settings: { web: "settings", gps: "settings" },
  email: { web: "mail", gps: "mail" },
  tag: { web: "tag", gps: "tag" },
  date: { web: "calendar", gps: "calendar" },
  photo: { web: "image", gps: "image" },
  camera: { web: "camera", gps: "camera" },
  video: { web: "video", gps: "video" },
  attachment: { web: "paperclip", gps: "paperclip" },
  flag: { web: "flag", gps: "flag" },
  device: { web: "hard-drive", gps: "hard-drive" }, // local storage
  phone: { web: "smartphone", gps: "smartphone" },
  typography: { web: "type", gps: "type" },
  colour: { web: "palette", gps: "mci:palette" },
  sensors: { web: "cpu", gps: "cpu" },
  elevation: { web: "trending-up", gps: "trending-up" },
  scaleBar: { web: "ruler-dimension-line", gps: "mci:ruler-square" },
} as const satisfies Record<string, { web: LucideKebabName; gps: GpsGlyph }>;

export type IconIdea = keyof typeof ICONS;
