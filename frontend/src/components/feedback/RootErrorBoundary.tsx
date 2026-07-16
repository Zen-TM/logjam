import { Component, type ErrorInfo, type ReactNode } from "react";
import { signOut } from "aws-amplify/auth";
import { clearTripDraft } from "../../tripDraft";
import BrandMark from "../brand/BrandMark";
import classes from "./RootErrorBoundary.module.css";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

// Top-level safety net. React unmounts the entire component tree on an uncaught
// render/lifecycle error (a blank white screen — what the toast render loop
// produced); this renders a recoverable fallback instead. It catches only
// render and lifecycle throws, NOT event handlers or async rejections, which
// still need local try/catch. It is a backstop, not a fix — the underlying
// cause should still be addressed. It sits above the theme/auth providers, so
// the fallback styles itself from the static design tokens in index.css rather
// than theme context (which may be the thing that failed).
export class RootErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // A render error + component stack carry no user data — safe to log.
    console.error("Unhandled render error:", error, info.componentStack);
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  private handleSignOut = async (): Promise<void> => {
    // Best-effort: clear the session in case a corrupt auth state caused the
    // crash, then reload to a clean sign-in. Reload regardless of outcome
    // (signOut throws in fake-auth dev, where Amplify isn't configured).
    // This is a second sign-out path that bypasses useAuth, so it repeats the
    // draft clear — a draft must not outlive the session down *any* exit.
    clearTripDraft();
    try {
      await signOut();
    } catch (err) {
      console.error(err);
    }
    window.location.reload();
  };

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className={classes.overlay} role="alert">
        <div className={classes.card}>
          <BrandMark className={classes.brandMark} />
          <h1 className={classes.heading}>Something went wrong</h1>
          <p className={classes.message}>
            The app hit an unexpected error. Reloading usually fixes it. If it
            keeps happening, sign out and back in.
          </p>
          <div className={classes.actions}>
            <button
              type="button"
              className={classes.reloadButton}
              onClick={this.handleReload}
            >
              Reload
            </button>
            <button
              type="button"
              className={classes.signOutButton}
              onClick={this.handleSignOut}
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }
}
