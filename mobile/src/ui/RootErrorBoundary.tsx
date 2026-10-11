import { Component, type ErrorInfo, type ReactNode } from "react";
import * as Sentry from "@sentry/react-native";
import * as Updates from "expo-updates";
import { Text, View } from "react-native";

import { fontSize, spacing, makeStyles } from "../theme";
import { Button } from "./Button";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

// Top-level safety net, mirroring the web RootErrorBoundary. React unmounts the
// whole tree on an uncaught render/lifecycle error; on a phone in a place that
// is a blank screen with no console and no way back. It catches render and
// lifecycle throws only — event handlers and async rejections still need local
// try/catch.
//
// It sits ABOVE the auth and app-lock gates, so the fallback uses theme tokens
// and no app state (the state may be what failed). Restart goes through
// Updates.reloadAsync (the RN equivalent of window.location.reload); in a dev
// build with updates disabled that throws, so the catch falls back to clearing
// the error and re-rendering in place.
export class RootErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // A render error + component stack carry no place data, and Sentry's
    // beforeSend scrubber (sentry/scrubEvent.ts) runs over it regardless.
    console.error("Unhandled render error:", error, info.componentStack);
    Sentry.captureException(error);
  }

  private handleRestart = async (): Promise<void> => {
    try {
      await Updates.reloadAsync();
    } catch (err) {
      console.error(err);
      this.setState({ hasError: false });
    }
  };

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    return <Fallback onRestart={this.handleRestart} />;
  }
}

// A function component because a class cannot call the styles hook.
function Fallback({ onRestart }: { onRestart: () => void }) {
  const styles = useStyles();
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Something went wrong</Text>
      <Text style={styles.message}>
        Logjam GPS hit an unexpected error. Restarting it usually fixes it.
      </Text>
      <Button label="Restart" variant="outlineAccent" onPress={onRestart} />
    </View>
  );
}

const useStyles = makeStyles((theme, textRole) => ({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing(3),
    gap: spacing(2),
    backgroundColor: theme.page,
  },
  title: {
    ...textRole.title,
    color: theme.text,
    textAlign: "center",
  },
  message: {
    fontSize: fontSize.sm,
    color: theme.textMuted,
    textAlign: "center",
  },
}));
