import { useState } from "react";
import {
  CUSTOM_FIELD_TYPES,
  customFieldDisplayLabel,
  isSystemFieldDef,
  renameCustomFieldLabel,
  type TripLogCustomFieldDef,
  type ScopedCustomFieldDef,
} from "@logjam/shared";
import {
  updateCustomField,
  type CustomFieldEntityKind,
} from "../../../placeUtils";
import ConfirmDialog from "../../dialogs/ConfirmDialog";
import DeleteCustomFieldDialog from "../../dialogs/DeleteCustomFieldDialog";
import AddCustomFieldDialog from "../../dialogs/AddCustomFieldDialog";
import { useCustomFieldImpact } from "../../dialogs/useCustomFieldImpact";
import type { TPlaceType } from "../../../placeUtils";
import { messageFromError } from "../../../errors/messageFromError";
import { ErrorBanner } from "../../feedback/ErrorBanner";
import classes from "./AccountPanel.module.css";

// Entity → the User.uiPreferences key its defs persist under, and copy nouns.
const ENTITY_META: Record<
  CustomFieldEntityKind,
  { prefsKey: "tripLogCustomFields" | "placeCustomFields"; rowNoun: string }
> = {
  "trip-log": { prefsKey: "tripLogCustomFields", rowNoun: "trip" },
  place: { prefsKey: "placeCustomFields", rowNoun: "place" },
};

function customFieldTypeName(type: TripLogCustomFieldDef["type"]): string {
  return CUSTOM_FIELD_TYPES.find((t) => t.value === type)?.label ?? type;
}

/**
 * Account-panel section for managing one family of custom fields (trip-log or
 * place). Lists the definitions, renames them inline (keeping the field `key`
 * stable, with an impact-count confirm), deletes them via the shared
 * DeleteCustomFieldDialog (server strips values from every row), and creates new
 * ones via AddCustomFieldDialog. Rename/delete/create all persist through the
 * shared machinery, then propagate the updated defs up via `onDefsChange` so
 * open dialogs stay in sync.
 */
function CustomFieldSection({
  entity,
  sectionLabel,
  tooltip,
  emptyText,
  loading,
  defs,
  onDefsChange,
  placeTypes,
}: {
  entity: CustomFieldEntityKind;
  sectionLabel: string;
  tooltip: string;
  emptyText: string;
  // Owning user not yet loaded — show a loading state instead of the list.
  loading: boolean;
  // Scoped for places, plain for trip logs — the section only reads the label
  // and key, so it takes whichever the caller holds and hands back what the
  // server returned rather than a locally-edited copy.
  defs: ScopedCustomFieldDef[];
  onDefsChange: (defs: ScopedCustomFieldDef[]) => void;
  /** Passed through to the add dialog's scoping choice. Absent for trip-log
   *  fields, which are scoped by the places a trip links rather than chosen. */
  placeTypes?: TPlaceType[];
}) {
  const meta = ENTITY_META[entity];

  const [renamingFieldKey, setRenamingFieldKey] = useState<string | null>(null);
  const [renameInput, setRenameInput] = useState("");
  const [renameFieldError, setRenameFieldError] = useState<string | null>(null);
  // Set when the rename passes validation; holds the already-renamed defs
  // awaiting the user's confirm.
  const [pendingRename, setPendingRename] = useState<{
    key: string;
    oldLabel: string;
    newLabel: string;
  } | null>(null);
  const [renameSaving, setRenameSaving] = useState(false);
  const [deletingFieldDef, setDeletingFieldDef] = useState<TripLogCustomFieldDef | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const { count: renameImpactCount, error: renameImpactError } = useCustomFieldImpact(
    entity,
    pendingRename?.key ?? null,
  );

  // BUILT-INS LAST, and with no verbs — the same two rules the phone's list
  // follows, for the same reason. A system definition belongs to no account:
  // `PATCH`/`DELETE /custom-fields/:entity/:key` look the key up under the
  // caller's id, miss, and answer 404, so Rename and Delete on the ten built-in
  // place attributes failed with "Custom field not found" every time. A row
  // with no action reads as a fact; a row whose action fails reads as a bug.
  // The order the server sent still decides within each half, so this is a
  // stable partition rather than a sort.
  const ordered = [...defs.filter((def) => !isSystemFieldDef(def)), ...defs.filter(isSystemFieldDef)];

  function startRenameField(def: TripLogCustomFieldDef) {
    setRenamingFieldKey(def.key);
    setRenameInput(def.label);
    setRenameFieldError(null);
  }

  function cancelRenameField() {
    setRenamingFieldKey(null);
    setRenameInput("");
    setRenameFieldError(null);
  }

  function handleRenameFieldSubmit(def: TripLogCustomFieldDef) {
    const result = renameCustomFieldLabel(defs, def.key, renameInput);
    if ("error" in result) {
      setRenameFieldError(result.error);
      return;
    }
    if (result.defs === defs || renameInput.trim() === def.label) {
      // Unchanged — nothing to save.
      cancelRenameField();
      return;
    }
    setPendingRename({
      key: def.key,
      oldLabel: def.label,
      newLabel: renameInput.trim(),
    });
  }

  async function handleConfirmRename() {
    if (!pendingRename) return;
    setRenameSaving(true);
    try {
      // ROW-GRAIN: one PATCH addressed by KEY. The whole-list write is gone,
      // and it would have wiped the scoping off every definition — the key is
      // deliberately not writable, so a rename moves the label and the stored
      // values stay attached to it.
      const updated = await updateCustomField(entity, pendingRename.key, {
        label: pendingRename.newLabel,
      });
      onDefsChange(updated);
      setPendingRename(null);
      cancelRenameField();
    } catch (err) {
      console.error(err);
      setPendingRename(null);
      setRenameFieldError(
        messageFromError(err, "Couldn't rename the custom field. Please try again."),
      );
    } finally {
      setRenameSaving(false);
    }
  }

  const impactSuffix = renameImpactError
    ? `Couldn't check how many ${meta.rowNoun}s use this field, but renaming is safe — `
    : renameImpactCount === null
      ? `Checking how many ${meta.rowNoun}s use it… `
      : renameImpactCount === 0
        ? `No ${meta.rowNoun}s currently have a value for this field. `
        : `${renameImpactCount} ${meta.rowNoun}${renameImpactCount === 1 ? "" : "s"} ${
            renameImpactCount === 1 ? "has" : "have"
          } a value for this field — `;

  return (
    <>
      <span className={classes.sectionLabel} title={tooltip}>
        {sectionLabel}
      </span>
      <div className={classes.divider} />
      {loading ? (
        <p className={classes.state}>Loading...</p>
      ) : (
        <>
          {defs.length === 0 ? (
            <p className={classes.state}>{emptyText}</p>
          ) : (
            ordered.map((def) =>
              renamingFieldKey === def.key ? (
                <div key={def.key} className={classes.fieldEdit}>
                  <input
                    className={classes.usernameInput}
                    aria-label={`Rename field ${def.label}`}
                    value={renameInput}
                    onChange={(e) => setRenameInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRenameFieldSubmit(def);
                      if (e.key === "Escape") cancelRenameField();
                    }}
                    autoFocus
                    maxLength={64}
                    disabled={renameSaving}
                  />
                  <div className={classes.usernameActions}>
                    <button
                      className={classes.saveUsernameBtn}
                      onClick={() => handleRenameFieldSubmit(def)}
                      disabled={renameSaving}
                    >
                      {renameSaving ? "Saving…" : "Save"}
                    </button>
                    <button
                      className={classes.cancelUsernameBtn}
                      onClick={cancelRenameField}
                      disabled={renameSaving}
                    >
                      Cancel
                    </button>
                  </div>
                  {renameFieldError && <ErrorBanner message={renameFieldError} />}
                </div>
              ) : (
                <div key={def.key} className={classes.fieldRow}>
                  <div className={classes.fieldInfo}>
                    <span className={classes.fieldName}>{customFieldDisplayLabel(def)}</span>
                    <span className={classes.fieldType}>
                      {isSystemFieldDef(def) ? "Built-in · " : ""}
                      {customFieldTypeName(def.type)}
                    </span>
                  </div>
                  {!isSystemFieldDef(def) && (
                    <>
                      <button
                        className={classes.renameFieldBtn}
                        onClick={() => startRenameField(def)}
                      >
                        Rename
                      </button>
                      <button
                        className={classes.deleteFieldBtn}
                        onClick={() => setDeletingFieldDef(def)}
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              ),
            )
          )}
          <button className={classes.addFieldBtn} onClick={() => setAddOpen(true)}>
            Add field
          </button>
        </>
      )}

      {/* Rename impact confirm — values stay linked (the field's key is stable),
          so this is informational, not destructive. */}
      <ConfirmDialog
        open={pendingRename !== null}
        title={`Rename "${pendingRename?.oldLabel ?? ""}"?`}
        message={
          <>
            The field will be renamed to "{pendingRename?.newLabel ?? ""}".{" "}
            {impactSuffix}
            {(renameImpactError || (renameImpactCount !== null && renameImpactCount > 0)) &&
              "existing values are kept and will appear under the new name."}
          </>
        }
        confirmLabel="Rename"
        confirmColor="secondary"
        busy={renameSaving}
        onConfirm={handleConfirmRename}
        onClose={() => {
          if (!renameSaving) setPendingRename(null);
        }}
      />

      <DeleteCustomFieldDialog
        entity={entity}
        def={deletingFieldDef}
        onClose={() => setDeletingFieldDef(null)}
        onDeleted={(remaining) => onDefsChange(remaining)}
      />

      <AddCustomFieldDialog
        open={addOpen}
        entity={entity}
        existingDefs={defs}
        placeTypes={placeTypes}
        onClose={() => setAddOpen(false)}
        onAdded={(updated) => onDefsChange(updated)}
      />
    </>
  );
}

export default CustomFieldSection;
