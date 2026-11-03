import { ErrorState, Hero } from "../../../ui";
import { PANEL_TITLES, type PanelId } from "../panels";

// The lists wait on the account load (frontend/AGENTS.md: no user data loads
// before it settles), so one that failed leaves each of them with nothing to
// show but "Loading…". They say it once instead.
const WAITS_ON_ACCOUNT: readonly PanelId[] = [
  "places",
  "logs",
  "ways",
  "plans",
  "friends",
  "inbox",
];

// Our words: the server's ("User not found") says nothing a user can act on.
export const ACCOUNT_LOAD_FAILED = "Couldn't load your account.";

export const waitsOnAccount = (panel: PanelId | null) =>
  panel !== null && WAITS_ON_ACCOUNT.includes(panel);

export default function AccountFailedPanel({
  panel,
  onRetry,
}: {
  panel: PanelId;
  onRetry: () => void;
}) {
  return (
    <>
      <Hero title={PANEL_TITLES[panel]} />
      <ErrorState message={ACCOUNT_LOAD_FAILED} onRetry={onRetry} />
    </>
  );
}
