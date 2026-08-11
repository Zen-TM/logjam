import { StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";

import { fontSize, radius, spacing, theme } from "../theme";

type TextFieldProps = {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  // Per-field validation message (web FieldError equivalent); null renders nothing.
  error?: string | null;
  /**
   * Handle on the underlying input. `autoFocus` is unreliable for a field that
   * mounts inside an animating modal — the window isn't focusable yet, so the
   * keyboard never comes up. Callers in that situation keep a ref and call
   * `.focus()` once the animation has settled.
   */
  inputRef?: React.Ref<TextInput>;
} & Pick<
  TextInputProps,
  | "secureTextEntry"
  | "autoCapitalize"
  | "autoComplete"
  | "keyboardType"
  | "placeholder"
  | "textContentType"
  | "autoFocus"
  | "onSubmitEditing"
  | "returnKeyType"
  | "multiline"
>;

export function TextField({
  label,
  value,
  onChangeText,
  error,
  multiline,
  inputRef,
  ...inputProps
}: TextFieldProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        ref={inputRef}
        style={[styles.input, multiline && styles.multiline]}
        value={value}
        onChangeText={onChangeText}
        placeholderTextColor={theme.textMuted}
        accessibilityLabel={label}
        multiline={multiline}
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
  multiline: { minHeight: 96, textAlignVertical: "top" },
  error: { fontSize: fontSize.sm, color: theme.warning },
});
