// What a given install can actually do right now — the single source of the
// guest-mode gating matrix.
//
// The app runs in one of two account states. A **guest** has no Logjam account:
// canyons, trips, waypoints, tracks and photos live only in the on-device
// SQLite stores, the sync engine is never started, and everything that needs a
// server is visibly disabled. A **linked** install has a Cognito account and
// behaves as the app always has.
//
// Two axes gate a feature, and they are not the same thing:
//  - `needs-account`: no amount of signal will help; the user has to create or
//    link an account.
//  - `needs-connection`: they have an account, they're just offline right now.
//
// **`needs-account` always wins.** Telling a guest to "connect" is a dead end —
// they can be on full-strength wifi and the feature still won't work — so the
// account reason is reported even when the device is also offline.
//
// Pure and storage-free on purpose: mobile's test setup is plain vitest with no
// jsdom or testing-library, so this branching is only testable if it lives away
// from the React tree. Callers pass the two facts in; this file holds no state.
//
// Renders through the existing `Row` `disabled` + reason-in-subtitle convention
// (src/ui/Row.tsx), the same shape `map/sourceResolver.ts` already uses for
// unavailable tile sources.

export type AccountState = "guest" | "linked";

/**
 * A server-backed feature that can be gated. Anything absent from this union
 * works for a guest — canyons, trip logs, waypoints, media capture, tracks,
 * local GeoPDF import, measure, compass and raster offline regions are all
 * fully local and must never be routed through here.
 */
export type Capability =
  /** Per-canyon sharing with another Logjam user. */
  | "sharing"
  /** Friend list, requests and search. */
  | "friends"
  /** Notification inbox. Cache-first once linked, so it reads offline. */
  | "inbox"
  /** Server-rendered LiDAR overlays (GET /topo-jobs/completed-overlays). */
  | "lidarOverlays"
  /** GeoPDFs generated on the user's web account. A LOCAL pdf import is not this. */
  | "accountGeoPdf"
  /** The Protomaps vector clip (POST /basemap/region-clip). Raster regions are NOT this. */
  | "vectorRegionDownload"
  /** Preferences stored on the user record (PATCH /users/me). */
  | "serverPrefs"
  /** Custom-field DEFINITIONS, which live on the user record. Values on a trip are local. */
  | "customFieldDefs"
  /** Push-token registration (POST /devices). */
  | "pushNotifications"
  /** Manually running a sync cycle. */
  | "syncNow"
  /**
   * The Offline & Storage settings tab. The switches are device prefs, but they
   * govern account-backed downloads (finished GeoPDFs, LiDAR topos) and sync —
   * none of which a guest has — so the whole tab is account-gated.
   */
  | "offlineSettings";

export type CapabilityStatus =
  | { status: "available" }
  | { status: "unavailable"; reason: UnavailableReason };

export type UnavailableReason = "needs-account" | "needs-connection";

/**
 * Every gated capability needs an account. They differ only in whether they
 * additionally need live connectivity: `inbox` reads the local notifications
 * cache, so a linked user offline still gets something useful.
 */
const NEEDS_CONNECTION: Record<Capability, boolean> = {
  sharing: true,
  friends: true,
  inbox: false,
  lidarOverlays: true,
  accountGeoPdf: true,
  vectorRegionDownload: true,
  serverPrefs: true,
  customFieldDefs: true,
  pushNotifications: true,
  syncNow: true,
  offlineSettings: false,
};

export function capabilityStatus(
  capability: Capability,
  accountState: AccountState,
  online: boolean,
): CapabilityStatus {
  // Account first, unconditionally — see the header note on precedence.
  if (accountState === "guest") {
    return { status: "unavailable", reason: "needs-account" };
  }
  if (NEEDS_CONNECTION[capability] && !online) {
    return { status: "unavailable", reason: "needs-connection" };
  }
  return { status: "available" };
}

/**
 * The canonical user-facing strings, so "Needs an account" is spelled one way
 * across every screen (mobile/DESIGN.md §10 reason-in-subtitle).
 */
export function unavailableReasonText(reason: UnavailableReason): string {
  return reason === "needs-account" ? "Needs an account" : "Needs a connection";
}

/**
 * What a capability is CALLED, for copy that has to name it. Only spelled here,
 * for the same reason the two reason strings are.
 */
const CAPABILITY_LABEL: Record<Capability, string> = {
  sharing: "Sharing a canyon",
  friends: "Friends",
  inbox: "The inbox",
  lidarOverlays: "LiDAR overlays",
  accountGeoPdf: "Account GeoPDFs",
  vectorRegionDownload: "The vector map download",
  serverPrefs: "This preference",
  customFieldDefs: "Custom fields",
  pushNotifications: "Push notifications",
  syncNow: "Syncing",
  offlineSettings: "Offline and storage settings",
};

/**
 * The screen-level counterpart of `capabilityRowProps`: copy for a whole screen
 * a guest cannot use, and the signal that its mount-time fetches must not fire
 * (mobile/CLAUDE.md — a guaranteed-401 per screen open is a battery cost and a
 * permanently red sync health line). Null means "go ahead".
 *
 * Only `needs-account` blocks a whole screen. A linked user offline keeps the
 * screen's own offline handling — the inbox reads its cache, Friends shows the
 * failure with a retry — so `online` is not a parameter: passing `true` here
 * leaves the account axis as the only one that can block.
 */
export function capabilityScreenBlock(
  capability: Capability,
  accountState: AccountState,
): { title: string; hint: string } | null {
  if (capabilityStatus(capability, accountState, true).status === "available") {
    return null;
  }
  return {
    title: unavailableReasonText("needs-account"),
    hint: `${CAPABILITY_LABEL[capability]} lives on a Logjam account. Everything already on this phone keeps working without one.`,
  };
}

/**
 * Convenience for the overwhelmingly common call site: a `Row` that wants a
 * `disabled` flag and a subtitle. `subtitle` is undefined when available, so it
 * can be spread over a row that has its own subtitle without clobbering it.
 */
export function capabilityRowProps(
  capability: Capability,
  accountState: AccountState,
  online: boolean,
): { disabled: boolean; subtitle?: string } {
  const result = capabilityStatus(capability, accountState, online);
  return result.status === "available"
    ? { disabled: false }
    : { disabled: true, subtitle: unavailableReasonText(result.reason) };
}
