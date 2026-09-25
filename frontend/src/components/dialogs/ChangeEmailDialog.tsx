import { useId, useState } from "react";
import { updateUserAttribute, confirmUserAttribute } from "aws-amplify/auth";
import { messageFromError } from "../../errors/messageFromError";
import { ErrorBanner } from "../feedback/ErrorBanner";
import { isValidEmailFormat } from "../../emailValidation";
import { Button, Dialog, TextField } from "../../ui";
import classes from "./ChangeEmailDialog.module.css";

type Stage = "input" | "verify" | "done";

const TITLES: Record<Stage, string> = {
  input: "Change email",
  verify: "Verify new email",
  done: "Email updated",
};

/**
 * Two steps, because Cognito owns the email and verifies it: ask for the new
 * address, then confirm with the code sent TO that address. The step is state,
 * never a second dialog — the same shape Logjam GPS's email sheet has.
 */
function ChangeEmailDialog({
  open,
  onClose,
  onSuccess,
  currentEmail = "",
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: (newEmail: string) => void;
  currentEmail?: string;
}) {
  return open ? (
    <ChangeEmailForm onClose={onClose} onSuccess={onSuccess} currentEmail={currentEmail} />
  ) : null;
}

/** Mounted on open, so the stage and the typing start fresh each time. */
function ChangeEmailForm({
  onClose,
  onSuccess,
  currentEmail,
}: {
  onClose: () => void;
  onSuccess: (newEmail: string) => void;
  currentEmail: string;
}) {
  const formId = useId();
  const [stage, setStage] = useState<Stage>("input");
  const [newEmail, setNewEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The address is this one field's problem, so it is reported under it
  // (DESIGN.md §8) — before Cognito is called at all.
  const [emailError, setEmailError] = useState<string | null>(null);
  // Captured when the code is sent, so the verify step can name the address it
  // went to even while the field is being retyped.
  const [pendingEmail, setPendingEmail] = useState("");

  async function handleSendCode() {
    const trimmed = newEmail.trim();
    if (!trimmed) {
      setEmailError("Enter your new email address.");
      return;
    }
    if (!isValidEmailFormat(trimmed)) {
      setEmailError("Enter a valid email address.");
      return;
    }
    if (currentEmail && trimmed.toLowerCase() === currentEmail.toLowerCase()) {
      setEmailError("That's already your email address.");
      return;
    }
    setEmailError(null);
    setBusy(true);
    setError(null);
    try {
      await updateUserAttribute({ userAttribute: { attributeKey: "email", value: trimmed } });
      setPendingEmail(trimmed);
      setStage("verify");
    } catch (err) {
      console.error(err);
      setError(messageFromError(err, "Couldn't send the verification code. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  async function handleResend() {
    setBusy(true);
    setError(null);
    try {
      await updateUserAttribute({
        userAttribute: { attributeKey: "email", value: pendingEmail },
      });
    } catch (err) {
      console.error(err);
      setError(messageFromError(err, "Couldn't resend the verification code. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirm() {
    const trimmedCode = code.trim();
    if (!trimmedCode) return;
    setBusy(true);
    setError(null);
    try {
      await confirmUserAttribute({
        userAttributeKey: "email",
        confirmationCode: trimmedCode,
      });
      setStage("done");
      onSuccess(pendingEmail);
    } catch (err) {
      console.error(err);
      setError(messageFromError(err, "Incorrect or expired code. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      title={TITLES[stage]}
      onClose={onClose}
      dismissible={!busy}
      footer={
        stage === "done" ? (
          <Button variant="filled" onClick={onClose}>
            Close
          </Button>
        ) : (
          <>
            <Button onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            {stage === "verify" && (
              <Button onClick={handleResend} disabled={busy}>
                Resend code
              </Button>
            )}
            <Button
              type="submit"
              form={formId}
              variant="filled"
              busy={busy}
              disabled={stage === "input" ? !newEmail.trim() : !code.trim()}
            >
              {stage === "input" ? "Send code" : "Confirm"}
            </Button>
          </>
        )
      }
    >
      <form
        id={formId}
        className={classes.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (stage === "input") handleSendCode();
          else if (stage === "verify") handleConfirm();
        }}
      >
        {stage === "input" && (
          <>
            <p className={classes.note}>
              We send a code to the new address to check it reaches you. You sign in with it
              from then on.
            </p>
            <TextField
              label="New email"
              type="email"
              value={newEmail}
              onChange={(event) => {
                setNewEmail(event.target.value);
                if (emailError) setEmailError(null);
              }}
              error={emailError}
              disabled={busy}
              data-autofocus
            />
          </>
        )}

        {stage === "verify" && (
          <>
            <p className={classes.note}>
              A code went to <b className={classes.address}>{pendingEmail}</b>. Check the spam
              folder if it hasn't arrived.
            </p>
            <TextField
              label="Verification code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              maxLength={10}
              inputMode="numeric"
              autoComplete="one-time-code"
              disabled={busy}
              data-autofocus
            />
          </>
        )}

        {stage === "done" && (
          <p className={classes.note}>
            Your email is now <b className={classes.address}>{pendingEmail}</b>. Sign in with it
            next time.
          </p>
        )}

        {error && <ErrorBanner message={error} />}
      </form>
    </Dialog>
  );
}

export default ChangeEmailDialog;
