// What a given install can actually do right now — the single source of the
// guest-mode gating matrix.
//
// Logjam GPS runs in one of two account states. A **guest** has no Logjam account:
// places, trips, waypoints, tracks and photos live only in the on-device
// SQLite stores, the sync engine is never started, and everything that needs a
// server is visibly disabled. A **linked** install has a Cognito account and
// behaves as Logjam GPS always has.
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
// Sharing has a THIRD axis nobody else has — `needs-upload`, below — and it
// sits LAST in that order. See `shareCapabilityStatus`.
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
 * works for a guest — places, trip logs, waypoints, media capture, tracks,
 * local GeoPDF import, measure, compass, raster offline regions and the user's
 * own custom fields are all fully local and must never be routed through here.
 * So is the Offline & Storage tab: it holds device settings a guest needs, and
 * sorts its own rows (`screens/settings/offlineRows.ts`).
 */
export type Capability =
  /** Sharing a place, waypoint, route, topo or GeoPDF with another user. */
  | "sharing"
  /** Friend list, requests and search. */
  | "friends"
  /**
   * Notification inbox. Cache-first once linked, so it READS offline — but the
   * accept/decline it now carries for friend requests and received files are
   * online-only and dim themselves per row (NotificationsScreen), which is why
   * the capability itself does not need a connection.
   */
  | "inbox"
  /**
   * Trip plans. Read from the plans cache once linked, so the list and a plan
   * opened before READ offline; every write in a plan is online-only and dims
   * itself where it is drawn (`plans/`).
   */
  | "plans"
  /** Server-rendered LiDAR overlays (GET /topo-jobs/completed-overlays). */
  | "lidarOverlays"
  /** GeoPDFs generated on the user's Logjam Web account. A LOCAL pdf import is not this. */
  | "accountGeoPdf"
  /** Location search through our API (POST /places/search), for a phone
   *  without the place registry. Searching the phone's own copy is not this. */
  | "placeSearch"
  /** Preferences stored on the user record (PATCH /users/me). */
  | "serverPrefs"
  /** Push-token registration (POST /devices). */
  | "pushNotifications"
  /** Manually running a sync cycle. */
  | "syncNow";

export type CapabilityStatus =
  | { status: "available" }
  | { status: "unavailable"; reason: UnavailableReason };

export type UnavailableReason =
  | "needs-account"
  | "needs-connection"
  /**
   * The row exists on THIS PHONE only: its `create` op is still in the outbox,
   * so the server has never heard of it. Sharing-specific — see
   * `shareCapabilityStatus`. Temporary, and it resolves itself.
   */
  | "needs-upload";

/**
 * Every gated capability needs an account. They differ only in whether they
 * additionally need live connectivity: `inbox` reads the local notifications
 * cache, so a linked user offline still gets something useful.
 */
const NEEDS_CONNECTION: Record<Capability, boolean> = {
  sharing: true,
  friends: true,
  inbox: false,
  plans: false,
  lidarOverlays: true,
  accountGeoPdf: true,
  placeSearch: true,
  serverPrefs: true,
  pushNotifications: true,
  syncNow: true,
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
 * across every screen (mobile/DESIGN.md reason-in-subtitle).
 */
export function unavailableReasonText(reason: UnavailableReason): string {
  switch (reason) {
    case "needs-account":
      return "Needs an account";
    case "needs-connection":
      return "Needs a connection";
    case "needs-upload":
      return "Needs to sync first";
  }
}

/**
 * What a capability is CALLED, for copy that has to name it. Only spelled here,
 * for the same reason the two reason strings are.
 */
const CAPABILITY_LABEL: Record<Capability, string> = {
  sharing: "Sharing",
  friends: "Friends",
  inbox: "The inbox",
  plans: "Plans",
  lidarOverlays: "LiDAR overlays",
  accountGeoPdf: "Account GeoPDFs",
  placeSearch: "Location search",
  serverPrefs: "This preference",
  pushNotifications: "Push notifications",
  syncNow: "Syncing",
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
    hint: `${CAPABILITY_LABEL[capability]} needs a Logjam account. Your data on this phone still works.`,
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
  return statusRowProps(capabilityStatus(capability, accountState, online));
}

/**
 * The change-email row. Fake auth (dev only) never configures Amplify, which
 * is what changing an email calls, so the row says why it is dimmed instead of
 * failing on press.
 */
export function changeEmailRowProps(
  online: boolean,
  authMode: "cognito" | "fake",
): { disabled: boolean; subtitle?: string } {
  if (authMode === "fake") {
    return { disabled: true, subtitle: "Not available under fake sign-in." };
  }
  return capabilityRowProps("serverPrefs", "linked", online);
}

/**
 * The same `Row` shape for a status that did NOT come from `capabilityStatus` —
 * today only sharing's, which has an axis the capability matrix cannot express.
 * One implementation, so a third reason can never render as a dimmed row with
 * no subtitle on one surface and a worded one on another.
 */
export function statusRowProps(status: CapabilityStatus): {
  disabled: boolean;
  subtitle?: string;
} {
  return status.status === "available"
    ? { disabled: false }
    : { disabled: true, subtitle: unavailableReasonText(status.reason) };
}

/**
 * Sharing's own status, with the third axis: does the ACCOUNT hold this row
 * yet?
 *
 * A live share is a grant on a server row (`POST /shares`, `/places/:id/share`),
 * so a route drawn in the field whose `create` op is still in the outbox has
 * nothing to grant access to — the recipients lookup 404s and the grant would
 * too. Callers pass the fact in (`sync/outbox.ts` `pendingCreateIds`); this
 * file stays storage-free.
 *
 * NOT "Send a copy". That verb ships a local FILE and never needs the entity to
 * exist server-side, so a recording made ten seconds ago can be sent — routing
 * it through here would withhold a verb that works.
 *
 * PRECEDENCE: account, then connection, then upload. `needs-connection` wins
 * over `needs-upload` because offline BOTH are true and only one of them is
 * something the user can act on: the outbox is waiting on the same connection,
 * so "wait for it to sync" is advice with no next step, and it would have one
 * sheet giving two different explanations for one outage. `needs-upload` is
 * therefore only ever reported when connectivity is NOT the blocker — online,
 * account linked, queue not yet drained — which is the only state where "it
 * hasn't gone up yet" is news.
 */
export function shareCapabilityStatus(
  accountState: AccountState,
  online: boolean,
  onServer: boolean,
): CapabilityStatus {
  const base = capabilityStatus("sharing", accountState, online);
  if (base.status !== "available") return base;
  return onServer ? base : { status: "unavailable", reason: "needs-upload" };
}

/**
 * Custom fields are NOT a gated capability on EITHER axis, and this is where
 * that decision is written down.
 *
 * Definitions are rows in the local mirror, written through the outbox like a
 * place or a waypoint (`customFields/fieldDefsStore.ts`), so adding, renaming
 * and deleting a field works with no account and with no signal. There is
 * therefore nothing left for this function to return, and it is kept only so
 * the decision has a place to be stated and a test to pin it.
 * Undefined means "go ahead", to match `capabilityRowProps`' subtitle contract.
 */
export function fieldDefsBlockedReason(
  _accountState: AccountState,
  _online: boolean,
): string | undefined {
  return undefined;
}
