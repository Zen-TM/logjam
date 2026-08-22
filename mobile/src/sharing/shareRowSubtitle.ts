// Why the "Share with a friend" row says what it says.
//
// Its own module, free of React Native imports, so it can be unit-tested —
// `useSharing` pulls in the RN runtime, and vitest cannot parse React Native's
// Flow sources. Same split, and the same reason, as `map/elevationSources.ts`.
import type { CapabilityStatus } from "../auth/capabilities";
import { unavailableReasonText } from "../auth/capabilities";

/** Just the fields the subtitle depends on, so tests need no hook. */
export type ShareRowState = {
  shareStatus: CapabilityStatus;
  loadFailed: boolean;
  recipients: unknown[] | null;
};

/**
 * ORDER IS THE POINT. A closed door names itself first (DESIGN.md §10:
 * needs-account beats needs-connection, and both beat anything derived from
 * data we could not fetch) — telling a guest "not shared with anyone yet" is a
 * claim about a list we never loaded.
 */
export function shareRowSubtitle(state: ShareRowState): string | undefined {
  if (state.shareStatus.status === "unavailable") {
    return unavailableReasonText(state.shareStatus.reason);
  }
  if (state.loadFailed) return "Can't reach your account right now";
  if (state.recipients === null) return "Loading…";
  if (state.recipients.length === 0) return "Not shared with anyone yet";
  return undefined;
}
