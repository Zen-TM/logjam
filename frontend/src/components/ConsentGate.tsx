import { useState } from "react";
import { isValidUsername, USERNAME_HINT, USERNAME_RULE } from "@logjam/shared";
import { recordConsent, type TUser } from "../placeUtils";
import { messageFromError } from "../errors/messageFromError";
import { ApiError } from "../errors/ApiError";
import BrandMark from "./brand/BrandMark";
import TermsTick from "./TermsTick";
import { Button, Checkbox, ErrorBanner, TextField } from "../ui";
import classes from "./ConsentGate.module.css";

/**
 * Full-screen blocking re-consent surface. Rendered instead of the
 * Logjam Web shell when the signed-in user's recorded consentVersion is stale
 * or absent — fulfils the privacy.html / tos.html promise that users are asked
 * to re-consent on next sign-in after a material change. Deliberately not a
 * dismissible dialog: the only ways out are agreeing or signing out.
 *
 * A brand-new account (no consent recorded) lands here too when it signed up
 * on a provider's page, which cannot ask what Logjam Web's sign-up form does:
 * it is welcomed rather than told the terms changed, and picks its username and
 * confirms its age here, in the same request that records the consent.
 *
 * The links to read are in the tick's own sentence (TermsTick), and opening one
 * does not answer the question about it.
 */
function ConsentGate({
  consentVersion,
  newAccount,
  currentUsername,
  onAccepted,
  onSignOut,
}: {
  /** The version the server named, which is the only one it will record. */
  consentVersion: string;
  /** No consent is recorded yet: the first sign-in of an account. */
  newAccount: boolean;
  /** The neutral name the API gave the account, offered as the default. */
  currentUsername: string;
  onAccepted: (user: TUser) => void;
  onSignOut: () => void;
}) {
  const [agreed, setAgreed] = useState(false);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [username, setUsername] = useState(currentUsername);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAgree(): Promise<void> {
    if (newAccount && !isValidUsername(username)) {
      setUsernameError(USERNAME_RULE);
      return;
    }
    if (!agreed) {
      setError(
        newAccount
          ? "Agree to the Terms of Use and Privacy Policy to continue."
          : "Tick the box to agree to the updated terms.",
      );
      return;
    }
    if (newAccount && !ageConfirmed) {
      setError("Confirm you are 18 or older to continue.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const user = newAccount
        ? await recordConsent(consentVersion, username.trim())
        : await recordConsent(consentVersion);
      // Parent swaps in the updated user, unmounting this gate — no state
      // updates after this point.
      onAccepted(user);
    } catch (err) {
      console.error(err);
      const message = messageFromError(
        err,
        "Couldn't record your consent. Please try again.",
      );
      // A refused username belongs to its field and clears on edit
      // (shared/DESIGN.md §11, §12); it is not worth a retry.
      if (
        newAccount &&
        err instanceof ApiError &&
        [400, 409].includes(err.status)
      ) {
        setUsernameError(message);
      } else {
        setError(message);
      }
      setSubmitting(false);
    }
  }

  return (
    <div className={classes.container}>
      <div className={classes.card}>
        <BrandMark className={classes.brandMark} />
        <h1 className={classes.title}>
          {newAccount ? "Welcome to Logjam" : "Updated terms"}
        </h1>
        <p className={classes.body}>
          {newAccount
            ? "Choose your public display name and review the terms to finish creating your account."
            : `Logjam's Terms of Use and Privacy Policy have changed (last updated ${consentVersion}). Please review them and confirm your agreement to keep using Logjam.`}
        </p>
        {newAccount && (
          <TextField
            label="Username"
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
              setUsernameError(null);
            }}
            error={usernameError}
            hint={USERNAME_HINT}
            autoComplete="username"
            disabled={submitting}
          />
        )}
        <TermsTick
          updated={!newAccount}
          checked={agreed}
          onChange={(next) => {
            setAgreed(next);
            setError(null);
          }}
        />
        {newAccount && (
          <Checkbox
            label="I confirm I am 18 years of age or older."
            checked={ageConfirmed}
            onChange={(next) => {
              setAgeConfirmed(next);
              setError(null);
            }}
          />
        )}
        {error && (
          <ErrorBanner
            message={error}
            onRetry={
              agreed && (!newAccount || ageConfirmed) ? handleAgree : undefined
            }
          />
        )}
        <Button
          variant="filled"
          className={classes.action}
          onClick={handleAgree}
          busy={submitting}
        >
          Agree and continue
        </Button>
        <Button
          className={classes.action}
          onClick={onSignOut}
          disabled={submitting}
          disabledReason="Recording your agreement…"
        >
          Sign out
        </Button>
      </div>
    </div>
  );
}

export default ConsentGate;
