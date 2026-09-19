// The way in: sign in, sign up, verify an email, and reset a forgotten
// password. One component, five states, because they hand values to each other
// — the password typed on the sign-up form is what verifies the account a
// moment later without the user ever seeing the sign-in screen again.
//
// Built on the kit like every other surface (frontend/DESIGN.md). Two notes
// that are design decisions rather than mechanics:
//
//  - **The Terms and Privacy links sit BESIDE the consent tick, not inside its
//    label.** A link inside a `<label>` toggles the control it labels, so
//    reading the terms used to tick (or untick) the box that says you agree
//    with them.
//  - **The error goes directly above the button it belongs to** (§8), never at
//    the top of the form, and a field's own complaint goes under the field.
import { useState, useEffect } from "react";
import classes from "./SignIn.module.css";
import type { AuthState } from "../useAuth";
import { ErrorBanner } from "./feedback/ErrorBanner";
import { isValidEmailFormat } from "../emailValidation";
import Footer from "./Footer";
import BrandMark from "./brand/BrandMark";
import BrandWordmark from "./brand/BrandWordmark";
import { CURRENT_CONSENT_VERSION, PENDING_CONSENT_STORAGE_KEY } from "../consent";
import { Button, Checkbox, TextField } from "../ui";

const PASSWORD_HINT = "At least 8 characters, with an upper and a lower case letter, a number and a symbol.";

function Brand() {
  return (
    <div className={classes.brand}>
      <BrandMark className={classes.brandMark} />
      <BrandWordmark className={classes.brandWordmark} />
    </div>
  );
}

function SignIn({
  authState,
  error,
  onSignIn,
  onSignUp,
  onConfirmSignUp,
  onResendCode,
  onForgotPassword,
  onConfirmForgotPassword,
  goToSignUp,
  goToSignIn,
  goToForgotPassword,
}: {
  authState: AuthState;
  error: string | null;
  onSignIn: (username: string, password: string) => Promise<boolean>;
  onSignUp: (
    username: string,
    password: string,
    email: string,
    name: string,
  ) => Promise<void>;
  onConfirmSignUp: (code: string, password: string) => Promise<void>;
  onResendCode: () => Promise<{ ok: boolean; error?: string }>;
  onForgotPassword: (email: string) => Promise<void>;
  onConfirmForgotPassword: (code: string, newPassword: string) => Promise<boolean>;
  goToSignUp: () => void;
  goToSignIn: () => void;
  goToForgotPassword: () => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [resetSuccess, setResetSuccess] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resendSuccess, setResendSuccess] = useState(false);
  const [consented, setConsented] = useState(false);
  const [ageConfirmed, setAgeConfirmed] = useState(false);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  async function handleResendCode() {
    setLocalError(null);
    setResendSuccess(false);
    setResendCooldown(30);
    const result = await onResendCode();
    if (result.ok) {
      setResendSuccess(true);
    } else {
      setLocalError(result.error ?? "Couldn't resend code.");
      setResendCooldown(0);
    }
  }

  const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^a-zA-Z\d]).{8,}$/;

  const displayError = localError || error;

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);
    if (!isValidEmailFormat(email)) {
      setEmailError("Enter a valid email address.");
      return;
    }
    setEmailError(null);
    setSubmitting(true);
    await onSignIn(email, password);
    setSubmitting(false);
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);
    if (!isValidEmailFormat(email)) {
      setEmailError("Enter a valid email address.");
      return;
    }
    setEmailError(null);
    if (password !== confirmPassword) {
      setLocalError("Passwords do not match");
      return;
    }
    if (!PASSWORD_REGEX.test(password)) {
      setLocalError("Password must be at least 8 characters and include uppercase, lowercase, number, and symbol");
      return;
    }
    if (!consented) {
      setLocalError("You must agree to the Terms and Privacy Policy");
      return;
    }
    if (!ageConfirmed) {
      setLocalError("You must confirm you are 18 or older");
      return;
    }
    setSubmitting(true);
    try {
      await onSignUp(username, password, email, name);
      localStorage.setItem(PENDING_CONSENT_STORAGE_KEY, CURRENT_CONSENT_VERSION);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);
    setSubmitting(true);
    // Pass the password still held from the signUp form (this component never
    // unmounts across signUp → confirmSignUp) so useAuth can auto-login the
    // just-verified account without ever flashing the sign-in screen.
    await onConfirmSignUp(code, password);
    setSubmitting(false);
  }

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);
    if (!isValidEmailFormat(email)) {
      setEmailError("Enter a valid email address.");
      return;
    }
    setEmailError(null);
    setSubmitting(true);
    await onForgotPassword(email);
    setSubmitting(false);
  }

  async function handleConfirmForgotPassword(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);
    if (newPassword !== confirmNewPassword) {
      setLocalError("Passwords do not match");
      return;
    }
    if (!PASSWORD_REGEX.test(newPassword)) {
      setLocalError("Password must be at least 8 characters and include uppercase, lowercase, number, and symbol");
      return;
    }
    setSubmitting(true);
    const succeeded = await onConfirmForgotPassword(code, newPassword);
    setSubmitting(false);
    if (succeeded) setResetSuccess(true);
  }

  if (authState === "confirmSignUp") {
    return (
      <div className={classes.container}>
        <form className={classes.form} noValidate onSubmit={handleConfirm}>
          <Brand />
          <p className={classes.subtitle}>
            Check your email for a verification code (check spam)
          </p>
          <TextField
            label="Verification code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
            autoFocus
            autoComplete="one-time-code"
            inputMode="numeric"
          />
          {displayError && <ErrorBanner message={displayError} />}
          {resendSuccess && (
            <p className={classes.successBanner} role="status">
              New code sent — check your email (check spam).
            </p>
          )}
          <Button type="submit" variant="filled" busy={submitting} className={classes.submit}>
            {submitting ? "Verifying…" : "Verify"}
          </Button>
          <Button
            type="button"
            disabled={resendCooldown > 0}
            onClick={handleResendCode}
            className={classes.submit}
          >
            {resendCooldown > 0 ? `Resend code (${resendCooldown}s)` : "Resend code"}
          </Button>
        </form>
        <div className={classes.footerWrap}><Footer /></div>
      </div>
    );
  }

  if (authState === "forgotPassword") {
    return (
      <div className={classes.container}>
        <form className={classes.form} noValidate onSubmit={handleForgotPassword}>
          <Brand />
          <p className={classes.subtitle}>
            Enter your email and we&apos;ll send you a reset code
          </p>
          <TextField
            label="Email"
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setEmailError(null); }}
            error={emailError}
            required
            autoFocus
            autoComplete="email"
          />
          {displayError && <ErrorBanner message={displayError} />}
          <Button type="submit" variant="filled" busy={submitting} className={classes.submit}>
            {submitting ? "Sending…" : "Send reset code"}
          </Button>
          <p className={classes.switchText}>
            <button type="button" className={classes.link} onClick={goToSignIn}>
              Back to sign in
            </button>
          </p>
        </form>
        <div className={classes.footerWrap}><Footer /></div>
      </div>
    );
  }

  if (authState === "confirmForgotPassword") {
    return (
      <div className={classes.container}>
        <form className={classes.form} noValidate onSubmit={handleConfirmForgotPassword}>
          <Brand />
          <p className={classes.subtitle}>
            Check your email for a reset code, then choose a new password
          </p>
          <TextField
            label="Reset code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
            autoFocus
            autoComplete="one-time-code"
            inputMode="numeric"
          />
          <TextField
            label="New password"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            hint={PASSWORD_HINT}
            autoComplete="new-password"
          />
          <TextField
            label="Confirm new password"
            type="password"
            value={confirmNewPassword}
            onChange={(e) => setConfirmNewPassword(e.target.value)}
            required
            autoComplete="new-password"
          />
          {displayError && <ErrorBanner message={displayError} />}
          <Button type="submit" variant="filled" busy={submitting} className={classes.submit}>
            {submitting ? "Resetting…" : "Reset password"}
          </Button>
          <p className={classes.switchText}>
            <button type="button" className={classes.link} onClick={goToSignIn}>
              Back to sign in
            </button>
          </p>
        </form>
        <div className={classes.footerWrap}><Footer /></div>
      </div>
    );
  }

  if (authState === "signUp") {
    return (
      <div className={classes.container}>
        <form className={classes.form} noValidate onSubmit={handleSignUp}>
          <Brand />
          <TextField
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
            autoComplete="name"
          />
          <TextField
            label="Email"
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setEmailError(null); }}
            error={emailError}
            required
            autoComplete="email"
          />
          <TextField
            label="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            hint="What friends see when you share a place with them."
            autoComplete="username"
          />
          <TextField
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            hint={PASSWORD_HINT}
            autoComplete="new-password"
          />
          <TextField
            label="Confirm password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            autoComplete="new-password"
          />
          <div className={classes.consent}>
            <Checkbox
              label="I agree to the Terms of Use and acknowledge the Privacy Policy."
              checked={consented}
              onChange={setConsented}
            />
            {/* Beside the tick, never inside its label: a link in a label
                toggles the control it labels, so reading the terms would
                change the answer to the question about them. */}
            <p className={classes.legal}>
              <a href="/tos.html" target="_blank" rel="noopener noreferrer">Read the Terms of Use</a>
              {" · "}
              <a href="/privacy.html" target="_blank" rel="noopener noreferrer">Read the Privacy Policy</a>
            </p>
            <Checkbox
              label="I confirm I am 18 years of age or older."
              checked={ageConfirmed}
              onChange={setAgeConfirmed}
            />
          </div>
          {displayError && <ErrorBanner message={displayError} />}
          <Button
            type="submit"
            variant="filled"
            busy={submitting}
            disabled={!consented || !ageConfirmed}
            className={classes.submit}
          >
            {submitting ? "Creating account…" : "Sign up"}
          </Button>
          <p className={classes.switchText}>
            Already have an account?{" "}
            <button type="button" className={classes.link} onClick={goToSignIn}>
              Sign in
            </button>
          </p>
        </form>
        <div className={classes.footerWrap}><Footer /></div>
      </div>
    );
  }

  // Default: signIn
  return (
    <div className={classes.container}>
      <form className={classes.form} noValidate onSubmit={handleSignIn}>
        <Brand />
        {resetSuccess && (
          <p className={classes.successBanner} role="status">
            Password reset — please sign in.
          </p>
        )}
        <TextField
          label="Email"
          type="email"
          value={email}
          onChange={(e) => { setEmail(e.target.value); setResetSuccess(false); setEmailError(null); }}
          error={emailError}
          required
          autoFocus
          autoComplete="email"
        />
        <TextField
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="current-password"
        />
        {displayError && <ErrorBanner message={displayError} />}
        <Button type="submit" variant="filled" busy={submitting} className={classes.submit}>
          {submitting ? "Signing in…" : "Sign in"}
        </Button>
        <p className={classes.switchText}>
          <button type="button" className={classes.link} onClick={goToForgotPassword}>
            Forgot password?
          </button>
        </p>
        <p className={classes.switchText}>
          Don&apos;t have an account?{" "}
          <button type="button" className={classes.link} onClick={goToSignUp}>
            Sign up
          </button>
        </p>
      </form>
      <div className={classes.footerWrap}><Footer /></div>
    </div>
  );
}

export default SignIn;
