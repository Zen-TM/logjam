import { StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";

import { fontSize, radius, spacing, theme } from "../theme";

type TextFieldProps = {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  // Per-field validation message (web FieldError equivalent); null renders nothing.
  error?: string | null;
} & Pick<
  TextInputProps,
  | "secureTextEntry"
  | "autoCapitalize"
  | "autoComplete"
  | "keyboardType"
  | "textContentType"
  | "autoFocus"
  | "onSubmitEditing"
  | "returnKeyType"
>;

export function TextField({ label, value, onChangeText, error, ...inputProps }: TextFieldProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholderTextColor={theme.textMuted}
        accessibilityLabel={label}
        {...inputProps}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing(0.5) },
  label: {
    fontSize: fontSize.xs,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    color: theme.textMuted,
  },
  input: {
    borderWidth: 1,
    borderColor: theme.accent,
    borderRadius: radius.md,
    paddingVertical: spacing(1.25),
    paddingHorizontal: spacing(1.5),
    fontSize: fontSize.base,
    color: theme.textPrimary,
  },
  error: { fontSize: fontSize.sm, color: theme.warning },
});
