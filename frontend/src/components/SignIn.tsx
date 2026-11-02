// The way in. Under a Cognito issuer: sign in, sign up, verify an email, and
// reset a forgotten password, on this page (ADR 0045). One component, five
// states, because they hand values to each other — the password typed on the
// sign-up form is what verifies the account a moment later without the user
// ever seeing the sign-in screen again. Under any other issuer: one button to
// the provider's page, which is also where a Cognito sign-in goes when these
// forms cannot finish it (useAuth).
//
// Built on the kit like every other surface (frontend/DESIGN.md). **The error
// goes directly above the button it belongs to** (shared/DESIGN.md §11), never
// at the top of the form, and a field's own complaint goes under the field.
import { useState, useEffect, useRef, type ReactNode } from "react";
import classes from "./SignIn.module.css";
import { isValidEmailFormat } from "../emailValidation";
import { messageFromError } from "../errors/messageFromError";
import {
  confirmForgotPassword,
  confirmSignUp,
  forgotPassword,
  hasCognitoAccount,
  resendSignUpCode,
  signUp,
} from "../auth/oidc";
import Footer from "./Footer";
import SignInTerrain from "./SignInTerrain";
import TermsTick from "./TermsTick";
import useSignInArea from "./useSignInArea";
import {
  FRIENDS,
  isValidUsername,
  NSW_5M,
  TRIP_PLAN_JOIN,
  USERNAME_HINT,
  USERNAME_RULE,
  USERNAME_TAKEN,
} from "@logjam/shared";
import { usernameAvailable } from "../placeUtils";
import { friendInvite, planInvite } from "../pendingInvite";
import BrandMark from "./brand/BrandMark";
import BrandWordmark from "./brand/BrandWordmark";
import { Button, Checkbox, TextField, ErrorBanner } from "../ui";

const PASSWORD_HINT =
  "At least 8 characters, with an upper and a lower case letter, a number and a symbol.";

function Brand() {
  return (
    <div className={classes.brand}>
      <BrandMark className={classes.brandMark} />
      <BrandWordmark className={classes.brandWordmark} />
    </div>
  );
}

function Frame({ children }: { children: ReactNode }) {
  const area = useSignInArea();
  return (
    <div className={classes.container}>
      <SignInTerrain area={area} />
      <main className={classes.panel}>
        {children}
        <div className={classes.footer}>
          <Footer />
          {/* The terrain's licence credit (ADR 0031) on a phone, where the
              card covers the corner the credit sits in when wide. Its line
              for the area's name is kept from the start, so the card does not
              move when the name arrives. */}
          <p className={classes.credit}>
            <span className={classes.creditPlace}>{area?.terrain.name}</span>
            {NSW_5M.credit}
          </p>
        </div>
      </main>
    </div>
  );
}

function Intro() {
  return (
    <p className={classes.intro}>
      A private map and logbook for canyoning in New South Wales.
    </p>
  );
}

function InviteNote() {
  return (
    <>
      {friendInvite.pending() && (
        <p className={classes.successBanner} role="status">
          {FRIENDS.copy.inviteSignIn}
        </p>
      )}
      {planInvite.pending() && (
        <p className={classes.successBanner} role="status">
          {TRIP_PLAN_JOIN.copy.signIn}
        </p>
      )}
    </>
  );
}

function RedirectCard({
  error,
  onRedirect,
}: {
  error: string | null;
  onRedirect: () => Promise<void>;
}) {
  const [redirecting, setRedirecting] = useState(false);

  async function handleClick() {
    setRedirecting(true);
    // On success the browser is already leaving; only a failure comes back.
    await onRedirect();
    setRedirecting(false);
  }

  return (
    <Frame>
      <div className={classes.form}>
        <Brand />
        <Intro />
        <InviteNote />
        {error && <ErrorBanner message={error} />}
        <Button
          variant="filled"
          busy={redirecting}
          onClick={handleClick}
          className={classes.submit}
        >
          Sign in or create an account
        </Button>
      </div>
    </Frame>
  );
}

type Screen =
  | "signIn"
  | "signUp"
  | "confirmSignUp"
  | "forgotPassword"
  | "confirmForgotPassword";

function CognitoForms({
  error,
  onPasswordSignIn,
}: {
  error: string | null;
  onPasswordSignIn: (
    email: string,
    password: string,
    newAccountUsername?: string,
  ) => Promise<void>;
}) {
  const [screen, setScreen] = useState<Screen>(
    // Someone opening a plan invite has usually never signed up.
    planInvite.pending() ? "signUp" : "signIn",
  );
  // Set only once the sign-up form, ticks and all, has been accepted: it is what
  // records consent at first sign-in, so whatever is typed in the field isn't.
  const [signedUpUsername, setSignedUpUsername] = useState<string>();
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
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const usernameNow = useRef("");
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
    try {
      await resendSignUpCode(email);
      setResendSuccess(true);
    } catch (err) {
      console.error(err);
      setLocalError(
        messageFromError(err, "Couldn't resend code. Please try again."),
      );
      setResendCooldown(0);
    }
  }

  const PASSWORD_REGEX =
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^a-zA-Z\d]).{8,}$/;

  const displayError = localError || error;

  function goTo(next: Screen) {
    setLocalError(null);
    setCode("");
    setScreen(next);
  }

  async function usernameIsFree(): Promise<boolean> {
    const asked = username;
    const free = await usernameAvailable(asked.trim());
    // The field may have moved on while this was out.
    if (!free && asked === usernameNow.current) {
      setUsernameError(USERNAME_TAKEN);
    }
    return free;
  }

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);
    if (!isValidEmailFormat(email)) {
      setEmailError("Enter a valid email address.");
      return;
    }
    setEmailError(null);
    // Unchecked by `noValidate`, and Cognito's refusal of a blank would hand
    // over to the provider's page.
    if (!password) {
      setLocalError("Enter your password.");
      return;
    }
    setSubmitting(true);
    try {
      await onPasswordSignIn(email, password);
    } catch (err) {
      // Signed up, never entered the code: send one and ask for it here.
      if (err instanceof Error && err.name === "UserNotConfirmedException") {
        setSignedUpUsername(undefined);
        goTo("confirmSignUp");
        await resendSignUpCode(email).catch((resendErr) => {
          console.error(resendErr);
          setLocalError(
            messageFromError(
              resendErr,
              "Couldn't resend code. Please try again.",
            ),
          );
        });
      } else {
        console.error(err);
        setLocalError(
          messageFromError(err, "Sign in failed. Please try again."),
        );
      }
    }
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
    if (!isValidUsername(username)) {
      setUsernameError(USERNAME_RULE);
      return;
    }
    setUsernameError(null);
    if (password !== confirmPassword) {
      setLocalError("Passwords do not match");
      return;
    }
    if (!PASSWORD_REGEX.test(password)) {
      setLocalError(
        "Password must be at least 8 characters and include uppercase, lowercase, number, and symbol",
      );
      return;
    }
    if (!consented) {
      setLocalError("Agree to the Terms of Use and Privacy Policy to sign up.");
      return;
    }
    if (!ageConfirmed) {
      setLocalError("Confirm you are 18 or older to sign up.");
      return;
    }
    setSubmitting(true);
    if (!(await usernameIsFree())) {
      setSubmitting(false);
      return;
    }
    try {
      await signUp(email, password, name);
      setSignedUpUsername(username);
      goTo("confirmSignUp");
    } catch (err) {
      console.error(err);
      setLocalError(messageFromError(err, "Sign up failed. Please try again."));
    }
    setSubmitting(false);
  }

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);
    setSubmitting(true);
    try {
      await confirmSignUp(email, code);
    } catch (err) {
      console.error(err);
      setLocalError(
        messageFromError(err, "Confirmation failed. Please try again."),
      );
      setSubmitting(false);
      return;
    }
    // The password is still held from the signUp form (this component never
    // unmounts across signUp → confirmSignUp), so the just-verified account
    // signs in without ever flashing the sign-in screen. After a reload it
    // isn't, and the sign-in screen asks for it.
    try {
      await onPasswordSignIn(email, password, signedUpUsername);
    } catch (err) {
      console.error(err);
      goTo("signIn");
      setLocalError(messageFromError(err, "Sign in failed. Please try again."));
    }
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
    try {
      await forgotPassword(email);
      goTo("confirmForgotPassword");
    } catch (err) {
      console.error(err);
      setLocalError(
        messageFromError(err, "Couldn't send reset code. Please try again."),
      );
    }
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
      setLocalError(
        "Password must be at least 8 characters and include uppercase, lowercase, number, and symbol",
      );
      return;
    }
    setSubmitting(true);
    try {
      await confirmForgotPassword(email, code, newPassword);
      setResetSuccess(true);
      goTo("signIn");
    } catch (err) {
      console.error(err);
      setLocalError(
        messageFromError(err, "Couldn't reset password. Please try again."),
      );
    }
    setSubmitting(false);
  }

  if (screen === "confirmSignUp") {
    return (
      <Frame>
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
          <Button
            type="submit"
            variant="filled"
            busy={submitting}
            className={classes.submit}
          >
            {submitting ? "Verifying…" : "Verify"}
          </Button>
          <Button
            type="button"
            disabled={resendCooldown > 0}
            disabledReason={`Wait ${resendCooldown}s before asking again`}
            onClick={handleResendCode}
            className={classes.submit}
          >
            {resendCooldown > 0
              ? `Resend code (${resendCooldown}s)`
              : "Resend code"}
          </Button>
        </form>
      </Frame>
    );
  }

  if (screen === "forgotPassword") {
    return (
      <Frame>
        <form
          className={classes.form}
          noValidate
          onSubmit={handleForgotPassword}
        >
          <Brand />
          <p className={classes.subtitle}>
            Enter your email and we&apos;ll send you a reset code
          </p>
          <TextField
            label="Email"
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setEmailError(null);
            }}
            error={emailError}
            required
            autoFocus
            autoComplete="email"
          />
          {displayError && <ErrorBanner message={displayError} />}
          <Button
            type="submit"
            variant="filled"
            busy={submitting}
            className={classes.submit}
          >
            {submitting ? "Sending…" : "Send reset code"}
          </Button>
          <p className={classes.switchText}>
            <button
              type="button"
              className={classes.link}
              onClick={() => goTo("signIn")}
            >
              Back to sign in
            </button>
          </p>
        </form>
      </Frame>
    );
  }

  if (screen === "confirmForgotPassword") {
    return (
      <Frame>
        <form
          className={classes.form}
          noValidate
          onSubmit={handleConfirmForgotPassword}
        >
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
          <Button
            type="submit"
            variant="filled"
            busy={submitting}
            className={classes.submit}
          >
            {submitting ? "Resetting…" : "Reset password"}
          </Button>
          <p className={classes.switchText}>
            <button
              type="button"
              className={classes.link}
              onClick={() => goTo("signIn")}
            >
              Back to sign in
            </button>
          </p>
        </form>
      </Frame>
    );
  }

  if (screen === "signUp") {
    return (
      <Frame>
        <form className={classes.form} noValidate onSubmit={handleSignUp}>
          <Brand />
          <Intro />
          <InviteNote />
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
            onChange={(e) => {
              setEmail(e.target.value);
              setEmailError(null);
            }}
            error={emailError}
            required
            autoComplete="email"
          />
          <TextField
            label="Username"
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
              usernameNow.current = e.target.value;
              setUsernameError(null);
            }}
            onBlur={() => {
              if (isValidUsername(username)) void usernameIsFree();
            }}
            error={usernameError}
            required
            hint={USERNAME_HINT}
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
            <TermsTick checked={consented} onChange={setConsented} />
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
            className={classes.submit}
          >
            {submitting ? "Creating account…" : "Sign up"}
          </Button>
          <p className={classes.switchText}>
            Already have an account?{" "}
            <button
              type="button"
              className={classes.link}
              onClick={() => goTo("signIn")}
            >
              Sign in
            </button>
          </p>
        </form>
      </Frame>
    );
  }

  // Default: signIn
  return (
    <Frame>
      <form className={classes.form} noValidate onSubmit={handleSignIn}>
        <Brand />
        <Intro />
        <InviteNote />
        {resetSuccess && (
          <p className={classes.successBanner} role="status">
            Password reset — please sign in.
          </p>
        )}
        <TextField
          label="Email"
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setResetSuccess(false);
            setEmailError(null);
          }}
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
        <Button
          type="submit"
          variant="filled"
          busy={submitting}
          className={classes.submit}
        >
          {submitting ? "Signing in…" : "Sign in"}
        </Button>
        <p className={classes.switchText}>
          <button
            type="button"
            className={classes.link}
            onClick={() => goTo("forgotPassword")}
          >
            Forgot password?
          </button>
        </p>
        <p className={classes.switchText}>
          Don&apos;t have an account?{" "}
          <button
            type="button"
            className={classes.link}
            onClick={() => goTo("signUp")}
          >
            Sign up
          </button>
        </p>
      </form>
    </Frame>
  );
}

function SignIn({
  error,
  onRedirect,
  onPasswordSignIn,
}: {
  error: string | null;
  onRedirect: () => Promise<void>;
  onPasswordSignIn: (
    email: string,
    password: string,
    newAccountUsername?: string,
  ) => Promise<void>;
}) {
  return hasCognitoAccount() ? (
    <CognitoForms error={error} onPasswordSignIn={onPasswordSignIn} />
  ) : (
    <RedirectCard error={error} onRedirect={onRedirect} />
  );
}

export default SignIn;
