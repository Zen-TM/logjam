// The way in: one button that sends the browser to the provider's own sign-in
// and sign-up page. Logjam Web handles no password; the address that page shows
// is the provider's, and it sends the browser back here signed in (useAuth).
//
// Built on the kit like every other surface (frontend/DESIGN.md). The error goes
// directly above the button it belongs to (shared/DESIGN.md §11), never at the
// top of the form.
import { useState, type ReactNode } from "react";
import classes from "./SignIn.module.css";
import Footer from "./Footer";
import SignInTerrain from "./SignInTerrain";
import useSignInArea from "./useSignInArea";
import { FRIENDS, NSW_5M } from "@logjam/shared";
import { pendingFriendInvite } from "../pendingFriendInvite";
import BrandMark from "./brand/BrandMark";
import BrandWordmark from "./brand/BrandWordmark";
import { Button, ErrorBanner } from "../ui";

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
      A private map and logbook for canyoning in New South Wales. Other people
      see a place only when you share it with them.
    </p>
  );
}

function SignIn({
  error,
  onSignIn,
}: {
  error: string | null;
  onSignIn: () => Promise<void>;
}) {
  const [redirecting, setRedirecting] = useState(false);

  async function handleSignIn() {
    setRedirecting(true);
    // On success the browser is already leaving; only a failure comes back.
    await onSignIn();
    setRedirecting(false);
  }

  return (
    <Frame>
      <div className={classes.form}>
        <Brand />
        <Intro />
        {pendingFriendInvite() && (
          <p className={classes.successBanner} role="status">
            {FRIENDS.copy.inviteSignIn}
          </p>
        )}
        {error && <ErrorBanner message={error} />}
        <Button
          variant="filled"
          busy={redirecting}
          onClick={handleSignIn}
          className={classes.submit}
        >
          Sign in or create an account
        </Button>
      </div>
    </Frame>
  );
}

export default SignIn;
