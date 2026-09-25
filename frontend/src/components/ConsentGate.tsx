import { useState } from "react";
import {
  CURRENT_CONSENT_VERSION,
  PENDING_CONSENT_STORAGE_KEY,
} from "../consent";
import { recordConsent, type TUser } from "../placeUtils";
import { messageFromError } from "../errors/messageFromError";
import { ErrorBanner } from "./feedback/ErrorBanner";
import BrandMark from "./brand/BrandMark";
import { Button, Checkbox } from "../ui";
import classes from "./ConsentGate.module.css";

/**
 * Full-screen blocking re-consent surface (PRIV-002). Rendered instead of the
 * app shell when the signed-in user's recorded consentVersion is stale or
 * absent — fulfils the privacy.html / tos.html promise that users are asked
 * to re-consent on next sign-in after a material change. Deliberately not a
 * dismissible dialog: the only ways out are agreeing or signing out.
 *
 * As on the sign-up form, the links to read sit BESIDE the tick rather than
 * inside its label: a link inside a `<label>` toggles the control it labels,
 * so opening the terms would answer the question about them.
 */
function ConsentGate({
  onAccepted,
  onSignOut,
}: {
  onAccepted: (user: TUser) => void;
  onSignOut: () => void;
}) {
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAgree(): Promise<void> {
    setSubmitting(true);
    setError(null);
    try {
      const user = await recordConsent(CURRENT_CONSENT_VERSION);
      localStorage.removeItem(PENDING_CONSENT_STORAGE_KEY);
      // Parent swaps in the updated user, unmounting this gate — no state
      // updates after this point.
      onAccepted(user);
    } catch (err) {
      console.error(err);
      setError(
        messageFromError(err, "Couldn't record your consent. Please try again."),
      );
      setSubmitting(false);
    }
  }

  return (
    <div className={classes.container}>
      <div className={classes.card}>
        <BrandMark className={classes.brandMark} />
        <h1 className={classes.title}>Updated terms</h1>
        <p className={classes.body}>
          Logjam&apos;s Terms of Use and Privacy Policy have changed (last updated{" "}
          {CURRENT_CONSENT_VERSION}). Please review them and confirm your agreement
          to keep using Logjam.
        </p>
        <p className={classes.legal}>
          <a href="/tos.html" target="_blank" rel="noopener noreferrer">
            Read the Terms of Use
          </a>
          {" · "}
          <a href="/privacy.html" target="_blank" rel="noopener noreferrer">
            Read the Privacy Policy
          </a>
        </p>
        <Checkbox
          label="I agree to the updated Terms and acknowledge the Privacy Policy."
          checked={agreed}
          onChange={setAgreed}
        />
        {error && <ErrorBanner message={error} onRetry={handleAgree} />}
        <Button
          variant="filled"
          className={classes.action}
          onClick={handleAgree}
          disabled={!agreed}
          busy={submitting}
        >
          Agree and continue
        </Button>
        <Button className={classes.action} onClick={onSignOut} disabled={submitting}>
          Sign out
        </Button>
      </div>
    </div>
  );
}

export default ConsentGate;
