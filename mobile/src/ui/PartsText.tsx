import type { GridReferencePart } from "@logjam/shared";
import { Text } from "react-native";

import { makeStyles, muted } from "../theme";

/**
 * A value inside a `Text`, its runs drawn apart: a grid reference's 100 km
 * square figures and its 10 m and 1 m figures a size down and dimmed, as on
 * Logjam Web. Visual only: the caller's accessibility label reads the plain
 * value.
 */
export function PartsText({
  value,
  parts,
  setApartRole,
}: {
  value: string;
  parts?: readonly GridReferencePart[];
  /** The role a size down from the caller's: `rowTitle` under a `heading`
   *  value, `detail` under a `rowTitle` row. */
  setApartRole: "rowTitle" | "detail";
}) {
  const styles = useStyles();
  if (!parts) return <>{value}</>;
  return (
    <>
      {parts.map((part, index) =>
        part.square || part.metres ? (
          <Text key={index} style={styles[setApartRole]}>
            {part.text}
          </Text>
        ) : (
          part.text
        ),
      )}
    </>
  );
}

// A nested `Text` cannot be raised or spaced, so Logjam GPS only sizes and dims them.
const useStyles = makeStyles((theme, textRole) => ({
  rowTitle: muted(theme, textRole.rowTitle),
  detail: muted(theme, textRole.detail),
}));
