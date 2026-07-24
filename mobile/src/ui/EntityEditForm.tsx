// Generic modal edit form for synced entities (canyon / trip). Driven by a
// field spec so both screens share one form; on save it diffs the inputs
// against the initial values and hands back ONLY the changed fields, which
// the caller enqueues through the outbox (updateCanyonLocal / updateTripLocal).
// Number fields normalize empty → null; required text guards against clearing
// a mandatory field (e.g. canyon name).
import { useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { fontSize, radius, spacing, theme } from "../theme";

export type EditFieldSpec = {
  key: string;
  label: string;
  kind: "text" | "multiline" | "number";
  value: string | number | null;
  /** Text/multiline only: reject clearing to empty. */
  required?: boolean;
  /** Number only: reject non-integer input. */
  integer?: boolean;
};

/** Render a field's stored value as the text the input starts with. */
function toInput(value: string | number | null): string {
  return value == null ? "" : String(value);
}

export function EntityEditForm({
  visible,
  title,
  fields,
  onCancel,
  onSave,
}: {
  visible: boolean;
  title: string;
  fields: EditFieldSpec[];
  onCancel: () => void;
  onSave: (changed: Record<string, unknown>) => Promise<void> | void;
}) {
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const insets = useSafeAreaInsets();

  // Seed the inputs from the field spec each time the form opens.
  useEffect(() => {
    if (!visible) return;
    const seeded: Record<string, string> = {};
    for (const field of fields) seeded[field.key] = toInput(field.value);
    setInputs(seeded);
    setErrors({});
    setSaving(false);
  }, [visible, fields]);

  const setValue = (key: string, text: string) =>
    setInputs((prev) => ({ ...prev, [key]: text }));

  const handleSave = async () => {
    const changed: Record<string, unknown> = {};
    const nextErrors: Record<string, string> = {};

    for (const field of fields) {
      const raw = (inputs[field.key] ?? "").trim();

      if (field.kind === "number") {
        const parsed = raw === "" ? null : Number(raw);
        if (parsed !== null && !Number.isFinite(parsed)) {
          nextErrors[field.key] = "Enter a number.";
          continue;
        }
        if (parsed !== null && field.integer && !Number.isInteger(parsed)) {
          nextErrors[field.key] = "Enter a whole number.";
          continue;
        }
        if (parsed !== (field.value ?? null)) changed[field.key] = parsed;
        continue;
      }

      // text / multiline
      if (field.required && raw === "") {
        nextErrors[field.key] = "Required.";
        continue;
      }
      const next = raw === "" ? null : raw;
      if (next !== (field.value ?? null)) changed[field.key] = next;
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    if (Object.keys(changed).length === 0) {
      onCancel();
      return;
    }

    setSaving(true);
    try {
      await onSave(changed);
      onCancel();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        {/* Stop touches inside the sheet from dismissing it. Pad the bottom
            past the gesture-nav inset so the actions clear the screen edge. */}
        <Pressable
          style={[styles.sheet, { paddingBottom: spacing(2) + insets.bottom }]}
          onPress={() => {}}
        >
          {/* Actions live in a TOP bar so they never sit under the gesture-nav
              inset (or a dev-only bottom banner). Cancel · title · Save. */}
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              onPress={onCancel}
              disabled={saving}
              hitSlop={8}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => void handleSave()}
              disabled={saving}
              hitSlop={8}
            >
              <Text style={styles.saveText}>{saving ? "Saving…" : "Save"}</Text>
            </Pressable>
          </View>
          <ScrollView
            contentContainerStyle={styles.fields}
            keyboardShouldPersistTaps="handled"
          >
            {fields.map((field) => (
              <View key={field.key} style={styles.field}>
                <Text style={styles.label}>{field.label}</Text>
                <TextInput
                  style={[styles.input, field.kind === "multiline" && styles.multiline]}
                  value={inputs[field.key] ?? ""}
                  onChangeText={(text) => setValue(field.key, text)}
                  accessibilityLabel={field.label}
                  placeholderTextColor={theme.textMuted}
                  multiline={field.kind === "multiline"}
                  keyboardType={field.kind === "number" ? "numeric" : "default"}
                />
                {errors[field.key] ? (
                  <Text style={styles.error}>{errors[field.key]}</Text>
                ) : null}
              </View>
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: theme.secondary,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing(2),
    gap: spacing(2),
    maxHeight: "85%",
  },
  title: {
    flex: 1,
    textAlign: "center",
    fontSize: fontSize.base,
    fontWeight: "700",
    color: theme.textPrimary,
  },
  cancelText: { fontSize: fontSize.base, color: theme.textMuted },
  saveText: { fontSize: fontSize.base, fontWeight: "700", color: theme.accent },
  fields: { gap: spacing(1.5), paddingBottom: spacing(1) },
  field: { gap: spacing(0.5) },
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
  actions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing(1),
  },
});
