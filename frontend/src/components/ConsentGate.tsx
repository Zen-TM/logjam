import { useState } from "react";
import {
  consentFormProblem,
  consentSubmitFailure,
  offersRegionChoice,
  REGION_CHOICE,
  regionChoiceProblem,
  REGIONS,
  SIGN_IN_COPY,
  USERNAME_HINT,
  type Region,
} from "@logjam/shared";
import { messageFromError } from "../errors/messageFromError";
import {
  recordConsent,
  updateUserPreferences,
  type TUser,
} from "../placeUtils";
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
 * Once there is more than one region, a new account is then asked where it
 * canyons (REGION_CHOICE), in the same card.
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
  regions = REGIONS,
}: {
  /** The version the server named, which is the only one it will record. */
  consentVersion: string;
  /** No consent is recorded yet: the first sign-in of an account. */
  newAccount: boolean;
  /** The neutral name the API gave the account, offered as the default. */
  currentUsername: string;
  onAccepted: (user: TUser) => void;
  onSignOut: () => void;
  /** The regions to ask about; only a test passes more than the real ones. */
  regions?: readonly Region[];
}) {
  const [agreed, setAgreed] = useState(false);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [username, setUsername] = useState(currentUsername);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [askingRegions, setAskingRegions] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);

  async function handleRegions(): Promise<void> {
    // Pressing Continue is how the user learns what is missing (shared/DESIGN.md §5).
    const problem = regionChoiceProblem(chosen);
    if (problem) {
      setError(problem);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      onAccepted(await updateUserPreferences({ regions: chosen }));
    } catch (err) {
      console.error(err);
      setError(messageFromError(err, REGION_CHOICE.saveFailed));
      setSubmitting(false);
    }
  }

  async function handleAgree(): Promise<void> {
    const problem = consentFormProblem({
      newAccount,
      username,
      agreed,
      ageConfirmed,
    });
    if (problem?.field === "username") {
      setUsernameError(problem.message);
      return;
    }
    if (problem) {
      setError(problem.message);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const user = newAccount
        ? await recordConsent(consentVersion, username.trim())
        : await recordConsent(consentVersion);
      if (newAccount && offersRegionChoice(regions)) {
        setAskingRegions(true);
        setSubmitting(false);
        return;
      }
      // Parent swaps in the updated user, unmounting this gate — no state
      // updates after this point.
      onAccepted(user);
    } catch (err) {
      console.error(err);
      // A refused username belongs to its field and clears on edit
      // (shared/DESIGN.md §11, §12); it is not worth a retry.
      const failure = consentSubmitFailure(err, newAccount);
      if (failure.field === "username") setUsernameError(failure.message);
      else setError(failure.message);
      setSubmitting(false);
    }
  }

  if (askingRegions) {
    return (
      <div className={classes.container}>
        <div className={classes.card}>
          <BrandMark className={classes.brandMark} />
          <h1 className={classes.title}>{REGION_CHOICE.title}</h1>
          <p className={classes.body}>{REGION_CHOICE.hint}</p>
          {regions.map((region) => (
            <Checkbox
              key={region.id}
              label={region.name}
              checked={chosen.includes(region.id)}
              onChange={(next) => {
                setChosen((prev) =>
                  next
                    ? [...prev, region.id]
                    : prev.filter((id) => id !== region.id),
                );
                setError(null);
              }}
            />
          ))}
          {error && (
            <ErrorBanner
              message={error}
              onRetry={chosen.length > 0 ? handleRegions : undefined}
            />
          )}
          <Button
            variant="filled"
            className={classes.action}
            onClick={handleRegions}
            busy={submitting}
          >
            {REGION_CHOICE.continue}
          </Button>
          <Button
            className={classes.action}
            onClick={onSignOut}
            disabled={submitting}
            disabledReason="Saving your regions…"
          >
            Sign out
          </Button>
        </div>
      </div>
    );
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
            : `Logjam's Terms of Use and Privacy Policy have changed (last updated ${consentVersion}). Review them and confirm your agreement to keep using Logjam.`}
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
            label={SIGN_IN_COPY.ageConfirm}
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
