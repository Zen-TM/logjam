// Which background triggers `AppShell` arms for an account state. A guest arms
// none of the account-backed ones (sync, GeoPDF and topo auto-download): they
// could only 401, and sync not running is what makes guest mode "don't sync
// yet" (ADR 0007). The place registry refresh is armed for everyone: the file
// is public and comes from the CDN, not our API (ADR 0034).
//
// The registrars are passed in so a test needs none of the native modules they
// pull. Guard: `shellTriggers.test.ts`.
import type { AccountState } from "./auth/capabilities";

type Register = () => () => void;

export function registerShellTriggers(
  accountState: AccountState,
  registrars: {
    sync: Register;
    geoPdfAutoDownload: Register;
    topoAutoDownload: Register;
    placeRegistryRefresh: Register;
  },
): () => void {
  const cleanups = [registrars.placeRegistryRefresh()];
  if (accountState !== "guest") {
    cleanups.push(
      registrars.sync(),
      registrars.geoPdfAutoDownload(),
      registrars.topoAutoDownload(),
    );
  }
  return () => cleanups.forEach((cleanup) => cleanup());
}
