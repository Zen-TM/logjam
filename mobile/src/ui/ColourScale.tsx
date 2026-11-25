import { LinearGradient } from "expo-linear-gradient";
import { Text, View } from "react-native";

import { makeStyles, muted, radius, spacing } from "../theme";

/**
 * A colour key drawn as one strip with its numbers evenly spaced under it, as
 * a weather map's scale is (the weather bar). The same component as Logjam
 * Web's `ColourScale`. The stops are opaque; between two the strip mixes
 * linearly, which is how the map mixes them too. Hidden from a screen reader:
 * a caller keeps the key in words elsewhere.
 */
export function ColourScale({
  stops,
}: {
  stops: readonly { label: string; colour: string }[];
}) {
  const styles = useStyles();
  const colors = stops.map((s) => s.colour);
  return (
    <View
      style={styles.scale}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <LinearGradient
        style={styles.strip}
        colors={colors as [string, string, ...string[]]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
      />
      <View style={styles.ticks}>
        {stops.map((s) => (
          <Text key={s.label} style={styles.tick}>
            {s.label}
          </Text>
        ))}
      </View>
    </View>
  );
}

const useStyles = makeStyles((theme, textRole) => ({
  scale: { alignSelf: "stretch", gap: spacing(0.25) },
  strip: {
    height: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: theme.line,
  },
  ticks: { flexDirection: "row", justifyContent: "space-between" },
  tick: { ...muted(theme, textRole.meta), fontVariant: ["tabular-nums"] },
}));
