import type { LoadState } from "@logjam/shared";
import type { ComponentProps, ReactNode } from "react";
import { ActivityIndicator, Text, View } from "react-native";

import { spacing, makeStyles, useTheme, muted } from "../theme";
import { Button } from "./Button";
import { Icon, type Glyph } from "./Icon";

// Full-screen data states: loading, empty and error are mandatory on every
// data surface.

// `label` says what is loading ("Loading your places…"), as on Logjam Web: a
// load that names itself is a load a screen reader can announce.
export function LoadingState({ label }: { label?: string }) {
  const theme = useTheme();
  const styles = useStyles();

  return (
    <View
      style={styles.container}
      accessibilityRole="progressbar"
      accessibilityLabel={label ?? "Loading"}
      accessibilityState={{ busy: true }}
    >
      <ActivityIndicator size="large" color={theme.accent} />
      {label ? <Text style={styles.hint}>{label}</Text> : null}
    </View>
  );
}

/**
 * What an empty list says and the way in (shared/DESIGN.md §11): a glyph, what
 * would be here, and the one button that fills it (or clears the filter that
 * emptied it). `disabledReason` is drawn under a disabled action. Every list
 * uses this; a screen never draws its own (`designRules.test.ts`).
 */
export function EmptyState({
  title,
  hint,
  icon,
  action,
}: {
  title: string;
  hint?: string;
  icon?: Glyph;
  action?: Pick<
    ComponentProps<typeof Button>,
    "label" | "onPress" | "icon" | "variant" | "disabledReason"
  >;
}) {
  const theme = useTheme();
  const styles = useStyles();

  return (
    <View style={styles.container}>
      {icon ? <Icon idea={icon} size={28} color={theme.accent} /> : null}
      <Text style={styles.title}>{title}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      {action ? (
        <Button
          {...action}
          disabled={action.disabledReason != null}
          disabledReason={action.disabledReason ?? ""}
        />
      ) : null}
      {action?.disabledReason ? (
        <Text style={styles.hint}>{action.disabledReason}</Text>
      ) : null}
    </View>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  const styles = useStyles();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{message}</Text>
      {onRetry ? (
        <Button label="Try again" variant="outlineAccent" onPress={onRetry} />
      ) : null}
    </View>
  );
}

/**
 * What a list's body is while its data is `state`: the loading line, the
 * failure with Try again, the `empty` state when there is one, or `children`.
 * A failed load never reaches `empty` (shared/DESIGN.md §11), so the one place
 * that chooses is here, not in each screen. Logjam Web's `ListBody` is the same.
 */
export function ListBody({
  state,
  loadingLabel,
  error,
  onRetry,
  empty,
  children,
}: {
  state: LoadState;
  loadingLabel?: string;
  /** Our sentence for a load that failed ("Couldn't load your inbox"). */
  error: string | null;
  onRetry?: () => void;
  /** Drawn instead of `children` when the data is in hand and there is nothing to list. */
  empty?: ReactNode;
  children: ReactNode;
}) {
  if (state === "loading") return <LoadingState label={loadingLabel} />;
  if (state === "failed")
    return (
      <ErrorState message={error ?? "Couldn't load this."} onRetry={onRetry} />
    );
  return <>{empty ?? children}</>;
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
  title: { ...textRole.rowTitle, color: theme.text, textAlign: "center" },
  hint: { ...muted(theme, textRole.detail), textAlign: "center" },
}));
