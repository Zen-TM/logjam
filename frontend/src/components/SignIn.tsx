import { useState } from "react";
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
  goToSignUp,
  goToSignIn,
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
  goToSignUp: () => void;
  goToSignIn: () => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

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
          <Button
            type="submit"
            variant="contained"
            fullWidth
            disabled={submitting}
          >
            {submitting ? "Verifying..." : "Verify"}
          </Button>
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
