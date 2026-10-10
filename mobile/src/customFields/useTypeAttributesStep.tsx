import type { ReactNode } from "react";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import {
  ATTRIBUTE_NOUN,
  defsForType,
  NEW_TYPE_ATTRIBUTES,
  placeAttributesTitle,
  SETTINGS_LIST,
  type ScopedCustomFieldDef,
} from "@logjam/shared";

import { spacing } from "../theme";
import { Button } from "../ui";
import { CustomFieldList, useCustomFieldForm } from "./CustomFieldsEditor";
import { useFieldDefs } from "./useFieldDefs";

/**
 * The step a new place type leads into (`stepAfterPlaceTypeSave`): the
 * attributes a place of it shows, and a form that adds one already scoped to
 * it. A hook returning the parts of a sheet, like the two forms it sits
 * between, so each host swaps its one sheet's content instead of opening a
 * second (DESIGN.md).
 *
 * The list and the form are two modes of the step, held here so both hosts
 * (Settings, and the Places rail's "New type") get the same walk.
 */
export function useTypeAttributesStep({
  type,
  onDone,
}: {
  /** null while the step is not showing. */
  type: { id: string; name: string } | null;
  onDone: () => void;
}): {
  title: string;
  body: ReactNode;
  footer: ReactNode;
  /** Set inside the form: back to the list. */
  onBack: (() => void) | undefined;
  /** A drag or a backdrop tap: out of the form, or past the step. */
  onClose: () => void;
} {
  const { defs, setDefs } = useFieldDefs("place");
  // null = the list; otherwise the form, adding (`editing: null`) or changing.
  const [form, setForm] = useState<{
    editing: ScopedCustomFieldDef | null;
  } | null>(null);
  const toList = () => setForm(null);

  const fieldForm = useCustomFieldForm({
    open: form !== null,
    entity: "place",
    defs,
    editing: form?.editing ?? null,
    initialTypeId: type?.id,
    // No toast: the sheet is still up and would cover it, and the row
    // appearing in the list is the confirmation.
    onSaved: (next) => setDefs(next),
    onDone: toList,
  });

  const title = form?.editing
    ? form.editing.label
    : form
      ? `New place ${ATTRIBUTE_NOUN.one}`
      : placeAttributesTitle(type?.name ?? null);

  if (form) {
    return {
      title,
      body: fieldForm.body,
      footer: fieldForm.footer,
      onBack: toList,
      onClose: toList,
    };
  }
  return {
    title,
    body: (
      <CustomFieldList
        entity="place"
        defs={type ? defsForType(defs, type.id) : []}
        onEdit={(def) => setForm({ editing: def })}
        emptyHint={NEW_TYPE_ATTRIBUTES.hint}
      />
    ),
    footer: (
      <View style={styles.actions}>
        <View style={styles.action}>
          <Button
            label={NEW_TYPE_ATTRIBUTES.done}
            variant="outlineAccent"
            onPress={onDone}
          />
        </View>
        <View style={styles.action}>
          <Button
            label={SETTINGS_LIST.copy.addAttribute}
            icon="add"
            onPress={() => setForm({ editing: null })}
          />
        </View>
      </View>
    ),
    onBack: undefined,
    onClose: onDone,
  };
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", gap: spacing(1) },
  action: { flex: 1 },
});
