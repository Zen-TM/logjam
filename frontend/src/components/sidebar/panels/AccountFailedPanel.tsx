import { ErrorState, Hero } from "../../../ui";
import { PANEL_TITLES, type PanelId } from "../panels";

// Our words: the server's ("User not found") says nothing a user can act on.
const ACCOUNT_LOAD_FAILED = "Couldn't load your account.";

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
