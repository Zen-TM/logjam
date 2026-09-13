import { StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";

import { fontSize, radius, spacing, theme } from "../theme";
import { FieldError } from "./FieldError";

type TextFieldProps = {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  /** This field's validation message (DESIGN.md §8, "Form errors"): drawn
   *  under the input, which takes a warning border. Null renders nothing. */
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
  // A search field wants it off — autocorrect on a username is a wrong guess
  // the user then has to undo.
  | "autoCorrect"
  | "autoComplete"
  | "keyboardType"
  | "placeholder"
  | "textContentType"
  | "autoFocus"
  | "onSubmitEditing"
  | "returnKeyType"
  | "multiline"
  | "editable"
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
  // `editable={false}` is a DISABLED field, not a live one that silently
  // ignores taps — same convention as `Row`'s and `IconButton`'s `disabled`
  // (dim, don't hide). Undeclared `editable` (the common case) stays full
  // opacity.
  const disabled = inputProps.editable === false;
  return (
    <View style={[styles.container, disabled && styles.disabled]}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        ref={inputRef}
        style={[styles.input, multiline && styles.multiline, error ? styles.inputError : null]}
        value={value}
        onChangeText={onChangeText}
        placeholderTextColor={theme.textMuted}
        accessibilityLabel={label}
        multiline={multiline}
        {...inputProps}
      />
      <FieldError message={error} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing(0.5) },
  // Matches `Row`'s/`Button`'s disabled dim (0.45) — see the note above.
  disabled: { opacity: 0.45 },
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
  // Findable while scrolling a long form, not only once the line under it is read.
  inputError: { borderColor: theme.warning },
});
