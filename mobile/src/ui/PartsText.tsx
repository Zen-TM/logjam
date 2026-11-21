import type { GridReferencePart } from "@logjam/shared";
import { Text } from "react-native";

import { makeStyles } from "../theme";

/**
 * A value inside a `Text`, its runs drawn apart: a grid reference's 100 km
 * square figures dimmed, as on Logjam Web. Visual only: the caller's
 * accessibility label reads the plain value.
 */
export function PartsText({
  value,
  parts,
}: {
  value: string;
  parts?: readonly GridReferencePart[];
}) {
  const styles = useStyles();
  if (!parts) return <>{value}</>;
  return (
    <>
      {parts.map((part, index) =>
        part.square ? (
          <Text key={index} style={styles.square}>
            {part.text}
          </Text>
        ) : (
          part.text
        ),
      )}
    </>
  );
}

const useStyles = makeStyles((theme) => ({
  square: { color: theme.textMuted },
}));
