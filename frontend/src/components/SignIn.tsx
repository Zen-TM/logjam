import { useState, useEffect } from "react";
import { TextField, Button } from "@mui/material";
import classes from "./SignIn.module.css";
import type { AuthState } from "../useAuth";
import { ErrorBanner } from "./feedback/ErrorBanner";

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
  onSignIn: (username: string, password: string) => Promise<void>;
  onSignUp: (
    username: string,
    password: string,
    email: string,
    name: string,
  ) => Promise<void>;
  onConfirmSignUp: (code: string) => Promise<void>;
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
  const [resetSuccess, setResetSuccess] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resendSuccess, setResendSuccess] = useState(false);

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

  const displayError = localError || error;

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);
    setSubmitting(true);
    await onSignIn(email, password);
    setSubmitting(false);
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);
    if (password !== confirmPassword) {
      setLocalError("Passwords do not match");
      return;
    }
    if (password.length < 8) {
      setLocalError("Password must be at least 8 characters");
      return;
    }
    setSubmitting(true);
    await onSignUp(username, password, email, name);
    setSubmitting(false);
  }

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);
    setSubmitting(true);
    await onConfirmSignUp(code);
    setSubmitting(false);
  }

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);
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
    if (newPassword.length < 8) {
      setLocalError("Password must be at least 8 characters");
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
        <form className={classes.form} onSubmit={handleConfirm}>
          <h1 className={classes.title}>Logjam</h1>
          <p className={classes.subtitle}>
            Check your email for a verification code
          </p>
          <TextField
            label="Verification code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            size="small"
            fullWidth
            required
            autoFocus
          />
          {displayError && <ErrorBanner message={displayError} />}
          {resendSuccess && (
            <p className={classes.successBanner}>New code sent — check your email.</p>
          )}
          <Button
            type="submit"
            variant="contained"
            fullWidth
            disabled={submitting}
          >
            {submitting ? "Verifying..." : "Verify"}
          </Button>
          <Button
            type="button"
            variant="text"
            fullWidth
            disabled={resendCooldown > 0}
            onClick={handleResendCode}
          >
            {resendCooldown > 0 ? `Resend code (${resendCooldown}s)` : "Resend code"}
          </Button>
        </form>
      </div>
    );
  }

  if (authState === "forgotPassword") {
    return (
      <div className={classes.container}>
        <form className={classes.form} onSubmit={handleForgotPassword}>
          <h1 className={classes.title}>Logjam</h1>
          <p className={classes.subtitle}>
            Enter your email and we&apos;ll send you a reset code
          </p>
          <TextField
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            size="small"
            fullWidth
            required
            autoFocus
          />
          {displayError && <ErrorBanner message={displayError} />}
          <Button
            type="submit"
            variant="contained"
            fullWidth
            disabled={submitting}
          >
            {submitting ? "Sending..." : "Send reset code"}
          </Button>
          <p className={classes.switchText}>
            <button type="button" className={classes.link} onClick={goToSignIn}>
              Back to sign in
            </button>
          </p>
        </form>
      </div>
    );
  }

  if (authState === "confirmForgotPassword") {
    return (
      <div className={classes.container}>
        <form className={classes.form} onSubmit={handleConfirmForgotPassword}>
          <h1 className={classes.title}>Logjam</h1>
          <p className={classes.subtitle}>
            Check your email for a reset code, then choose a new password
          </p>
          <TextField
            label="Reset code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            size="small"
            fullWidth
            required
            autoFocus
          />
          <TextField
            label="New password"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            size="small"
            fullWidth
            required
            helperText="At least 8 characters"
          />
          <TextField
            label="Confirm new password"
            type="password"
            value={confirmNewPassword}
            onChange={(e) => setConfirmNewPassword(e.target.value)}
            size="small"
            fullWidth
            required
          />
          {displayError && <ErrorBanner message={displayError} />}
          <Button
            type="submit"
            variant="contained"
            fullWidth
            disabled={submitting}
          >
            {submitting ? "Resetting..." : "Reset password"}
          </Button>
          <p className={classes.switchText}>
            <button type="button" className={classes.link} onClick={goToSignIn}>
              Back to sign in
            </button>
          </p>
        </form>
      </div>
    );
  }

  if (authState === "signUp") {
    return (
      <div className={classes.container}>
        <form className={classes.form} onSubmit={handleSignUp}>
          <h1 className={classes.title}>Logjam</h1>
          <TextField
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            size="small"
            fullWidth
            required
            autoFocus
          />
          <TextField
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            size="small"
            fullWidth
            required
          />
          <TextField
            label="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            size="small"
            fullWidth
            required
          />
          <TextField
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            size="small"
            fullWidth
            required
          />
          <TextField
            label="Confirm password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            size="small"
            fullWidth
            required
          />
          {displayError && <ErrorBanner message={displayError} />}
          <Button
            type="submit"
            variant="contained"
            fullWidth
            disabled={submitting}
          >
            {submitting ? "Creating account..." : "Sign up"}
          </Button>
          <p className={classes.switchText}>
            Already have an account?{" "}
            <button type="button" className={classes.link} onClick={goToSignIn}>
              Sign in
            </button>
          </p>
        </form>
      </div>
    );
  }

  // Default: signIn
  return (
    <div className={classes.container}>
      <form className={classes.form} onSubmit={handleSignIn}>
        <h1 className={classes.title}>Logjam</h1>
        {resetSuccess && (
          <p className={classes.successBanner}>Password reset — please sign in.</p>
        )}
        <TextField
          label="Email"
          type="email"
          value={email}
          onChange={(e) => { setEmail(e.target.value); setResetSuccess(false); }}
          size="small"
          fullWidth
          required
          autoFocus
        />
        <TextField
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          size="small"
          fullWidth
          required
        />
        {displayError && <ErrorBanner message={displayError} />}
        <Button
          type="submit"
          variant="contained"
          fullWidth
          disabled={submitting}
        >
          {submitting ? "Signing in..." : "Sign in"}
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
    </div>
  );
}

export default SignIn;
