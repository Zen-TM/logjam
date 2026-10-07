import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { spacing } from "../theme";

/**
 * The last thing in a list: the same button its empty state offers ("Add a
 * place", "Log a trip"), so adding is where the eye ends up after scrolling to
 * the bottom, not only when there is nothing to scroll. The name and the job
 * are Logjam Web's `ListEnd`.
 */
export function ListEnd({ children }: { children: ReactNode }) {
  return <View style={styles.end}>{children}</View>;
}

const styles = StyleSheet.create({
  end: { alignItems: "center", paddingVertical: spacing(2) },
});
