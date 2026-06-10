import { useState } from "react";
import { Button } from "@mui/material";
import {
  CURRENT_CONSENT_VERSION,
  PENDING_CONSENT_STORAGE_KEY,
} from "../consent";
import { recordConsent, type TUser } from "../canyonUtils";
import { messageFromError } from "../errors/messageFromError";
import { ErrorBanner } from "./feedback/ErrorBanner";
import classes from "./ConsentGate.module.css";

/**
 * Full-screen blocking re-consent surface (PRIV-002). Rendered instead of the
 * app shell when the signed-in user's recorded consentVersion is stale or
 * absent — fulfils the privacy.html / tos.html promise that users are asked
 * to re-consent on next sign-in after a material change. Deliberately not a
 * dismissible dialog: the only ways out are agreeing or signing out.
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
        <h1 className={classes.title}>Updated terms</h1>
        <p className={classes.body}>
          The Logjam{" "}
          <a href="/tos.html" target="_blank" rel="noopener noreferrer">
            Terms of Use
          </a>{" "}
          and{" "}
          <a href="/privacy.html" target="_blank" rel="noopener noreferrer">
            Privacy Policy
          </a>{" "}
          have changed (last updated {CURRENT_CONSENT_VERSION}). Please review
          them and confirm your agreement to keep using Logjam.
        </p>
        <label className={classes.consentRow}>
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
          />
          <span>
            I agree to the updated Terms and acknowledge the Privacy Policy.
          </span>
        </label>
        {error && <ErrorBanner message={error} onRetry={handleAgree} />}
        <Button
          variant="contained"
          fullWidth
          onClick={handleAgree}
          disabled={!agreed || submitting}
        >
          {submitting ? "Saving..." : "Agree & continue"}
        </Button>
        <Button
          fullWidth
          onClick={onSignOut}
          disabled={submitting}
          sx={{ color: "var(--theme-text-primary)" }}
        >
          Sign out
        </Button>
      </div>
    </div>
  );
}

export default ConsentGate;
