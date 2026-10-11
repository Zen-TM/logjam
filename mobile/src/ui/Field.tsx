import { StyleSheet, Text, View } from "react-native";

import { formRhythm, opacity, textRole } from "../theme";
import { FieldError } from "./FieldError";
import { fieldLabel } from "./fieldLabel";

/**
 * A labelled control at the form rhythm: label, the control, an optional hint,
 * then its error, each `formRhythm.label` apart. Every field of a form is
 * drawn by this (`TextField` is one), so the gap between a label and its
 * control is one number (shared/DESIGN.md §2). Logjam Web's twin is the
 * `Field` inside `TextField.tsx`.
 *
 * `aside` shares the label's line, at its end: a reading of the control
 * ("z14 · ≈ 4 m per pixel").
 */
export function Field({
  label,
  hint,
  error,
  aside,
  disabled,
  children,
}: {
  label: string;
  /** One plain sentence under the control saying what it means or takes. */
  hint?: string;
  /** This control's validation message, drawn by `FieldError`. */
  error?: string | null;
  aside?: React.ReactNode;
  /** Dims the whole field: the kit's one disabled look (`opacity.disabled`). */
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <View style={[styles.field, disabled && styles.disabled]}>
      {aside != null ? (
        <View style={styles.head}>
          <Text style={fieldLabel}>{label}</Text>
          {aside}
        </View>
      ) : (
        <Text style={fieldLabel}>{label}</Text>
      )}
      {children}
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      <FieldError message={error} />
    </View>
  );
}

/** A form's fields, one `formRhythm.field` apart. */
export function FormStack({ children }: { children: React.ReactNode }) {
  return <View style={styles.stack}>{children}</View>;
}

const styles = StyleSheet.create({
  field: { gap: formRhythm.label },
  stack: { gap: formRhythm.field },
  disabled: { opacity: opacity.disabled },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: formRhythm.field,
  },
  hint: textRole.hint,
});
