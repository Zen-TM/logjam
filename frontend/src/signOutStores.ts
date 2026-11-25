// The browser-side keys that hold what a user typed, picked or looked at,
// removed wherever someone is known signed out (useAuth.ts: `endSession`, the
// sign-in screen, an expired session, every sign-in) so the next person at
// this browser does not inherit them. The pending deep links are the
// exception: they wait for the sign-in, so only `endSession` removes them. A key is in one of three places: here, cleared by
// the module that owns it (trip draft, recent searches, pending invites), or
// kept on purpose in KEPT of storageKeys.test.ts. That test scans the source
// for every key written and fails on one that is in none.
export const CLEARED_ON_SIGN_OUT: readonly string[] = [
  // Where the user last looked on the map.
  "logjam.mapView",
  // Layout of the last GeoPDF.
  "logjam.geoPdf.lastSettings",
  // "Shared places on the PDF" is an opt-in that defaults off: left behind,
  // it would open on for the next user.
  "logjam.geoPdf.showOwnedPlaces",
  "logjam.geoPdf.showSharedPlaces",
  // Session filters and search boxes: place names the user typed, and the
  // filters that hide the next user's places.
  "logjam.filters",
  "logjam.logsView",
  "logjam.placeSearch",
  "logjam.waySearch",
  "logjam.wayKind",
  "logjam.tripSearch",
  "logjam.tripDateFrom",
  "logjam.tripDateTo",
  "logjam.tripTypeFilter",
  "logjam.tripAttributeFilters",
  "logjam.tripIncludeUnknowns",
];

/** A completion-email deep link waiting for its opener's sign-in: written on
 *  mount, read after the sign-in, so the sign-in paths must leave it. */
export const PENDING_DEEP_LINKS: readonly string[] = [
  "pendingTopoJobId",
  "pendingTopoDownload",
  "pendingExportId",
];

export function clearKeptStores(deepLinksToo = false): void {
  const keys = deepLinksToo
    ? [...CLEARED_ON_SIGN_OUT, ...PENDING_DEEP_LINKS]
    : CLEARED_ON_SIGN_OUT;
  for (const area of ["localStorage", "sessionStorage"] as const) {
    for (const key of keys) {
      try {
        window[area].removeItem(key);
      } catch {
        // Storage blocked: nothing was written either.
      }
    }
  }
}
