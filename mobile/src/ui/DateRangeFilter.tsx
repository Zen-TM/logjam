import { Text, View } from "react-native";
import { dateSummary, formatDateKey } from "@logjam/shared";

import { formRhythm, spacing, makeStyles } from "../theme";
import { Chip } from "./Chip";

/**
 * A date range as two tappable bounds. The picker itself is a mode of the
 * sheet that owns this row (`onPick` asks for it), because a calendar is too
 * tall to sit inline and a sheet never stacks on a sheet.
 *
 * In the kit because a built-in date (Added, Updated) and a date ATTRIBUTE
 * are the same question, drawn the same way.
 */
export function DateRangeFilter({
  label,
  value,
  onPick,
  onClear,
  fromLabel = "From",
  toLabel = "To",
  clearLabel = "Clear",
}: {
  label: string;
  value: readonly [string | null, string | null] | null;
  onPick: (bound: 0 | 1) => void;
  onClear: () => void;
  fromLabel?: string;
  toLabel?: string;
  clearLabel?: string;
}) {
  const styles = useStyles();

  const from = value?.[0] ?? null;
  const to = value?.[1] ?? null;
  const active = from != null || to != null;
  return (
    <View style={styles.block}>
      <View style={styles.header}>
        <Text style={styles.label}>{label}</Text>
        <Text style={[styles.value, active && styles.valueActive]}>
          {dateSummary(value)}
        </Text>
      </View>
      <View style={styles.chips}>
        <Chip
          label={from ? `${fromLabel} ${shortDate(from)}` : fromLabel}
          active={from != null}
          onPress={() => onPick(0)}
        />
        <Chip
          label={to ? `${toLabel} ${shortDate(to)}` : toLabel}
          active={to != null}
          onPress={() => onPick(1)}
        />
        {active ? <Chip label={clearLabel} onPress={onClear} /> : null}
      </View>
    </View>
  );
}

function shortDate(key: string): string {
  return formatDateKey(`${key}T00:00:00.000Z`);
}

const useStyles = makeStyles((theme, textRole) => ({
  block: { gap: formRhythm.label },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  label: { ...textRole.control, color: theme.text },
  value: { ...textRole.bodySmall, color: theme.textMuted },
  // Words are text-coloured; the weight says it is set.
  valueActive: { ...textRole.control, color: theme.text },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing(1) },
}));
