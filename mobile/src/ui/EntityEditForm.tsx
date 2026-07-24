// Generic modal edit form for synced entities (canyon / trip). Driven by a
// field spec so both screens share one form; on save it diffs the inputs
// against the initial values and hands back ONLY the changed fields, which
// the caller enqueues through the outbox (updateCanyonLocal / updateTripLocal).
// Number fields normalize empty → null; required text guards against clearing
// a mandatory field (e.g. canyon name).
import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { fontSize, fontWeight, hitSlop, radius, scrim, spacing, theme } from "../theme";
import { TextField } from "./TextField";

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
              hitSlop={hitSlop}
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
              hitSlop={hitSlop}
            >
              <Text style={styles.saveText}>{saving ? "Saving…" : "Save"}</Text>
            </Pressable>
          </View>
          <ScrollView
            contentContainerStyle={styles.fields}
            keyboardShouldPersistTaps="handled"
          >
            {fields.map((field) => (
              <TextField
                key={field.key}
                label={field.label}
                value={inputs[field.key] ?? ""}
                onChangeText={(text) => setValue(field.key, text)}
                error={errors[field.key] ?? null}
                multiline={field.kind === "multiline"}
                keyboardType={field.kind === "number" ? "numeric" : "default"}
              />
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
    backgroundColor: scrim.heavy,
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
    fontWeight: fontWeight.bold,
    color: theme.textPrimary,
  },
  cancelText: { fontSize: fontSize.base, color: theme.textMuted },
  saveText: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: theme.accent },
  fields: { gap: spacing(1.5), paddingBottom: spacing(1) },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing(1),
  },
});
