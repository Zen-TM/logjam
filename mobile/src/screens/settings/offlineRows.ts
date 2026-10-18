// Which rows of Settings → Offline and storage a guest can use. The tab opens
// for everyone: most switches are device preferences, but each one that governs
// an account-backed job (finished GeoPDFs and topos, syncing, media uploads) is
// dead for a guest and says "Needs an account" in place of its subtitle
// (shared/DESIGN.md §5: disabled when it could apply once an account is linked).
// "Photos with copied places" is not here: it is a server preference and already
// gated by `serverPrefs`.
//
// Pure for the same reason `auth/capabilities.ts` is: mobile tests have no React
// tree. `Record` makes a new row a type error until it is sorted.
// Guard: `offlineRows.test.ts`.
import type { AccountState } from "../../auth/capabilities";
import type { MeteredJob } from "../../offline/networkPolicy";

export type OfflineRow = "autoGeoPdf" | "autoTopo" | MeteredJob;

const NEEDS_ACCOUNT: Record<OfflineRow, boolean> = {
  autoGeoPdf: true,
  autoTopo: true,
  geoPdfDownload: true,
  topoDownload: true,
  // The registry is a public file a guest fetches too (ADR 0034).
  placeNames: false,
  sync: true,
  mediaUpload: true,
};

/** True when the row cannot be used in this account state. */
export function offlineRowNeedsAccount(
  row: OfflineRow,
  accountState: AccountState,
): boolean {
  return accountState === "guest" && NEEDS_ACCOUNT[row];
}
