import { useState } from "react";
import { EllipsisVertical, Lock, Plus, Tag, Trash2 } from "lucide-react";
import {
  ATTRIBUTE_NOUN,
  buildCustomFieldDef,
  CUSTOM_FIELD_TYPES,
  customFieldDisplayLabel,
  isSystemFieldDef,
  renameCustomFieldLabel,
  type ScopedCustomFieldDef,
  type TripLogCustomFieldDef,
  type TripLogCustomFieldType,
} from "@logjam/shared";
import {
  createCustomField,
  updateCustomField,
  type CustomFieldEntityKind,
} from "../../../placeUtils";
import ConfirmDialog from "../../dialogs/ConfirmDialog";
import DeleteCustomFieldDialog from "../../dialogs/DeleteCustomFieldDialog";
import AddCustomFieldForm from "../../dialogs/AddCustomFieldForm";
import { useCustomFieldImpact } from "../../dialogs/useCustomFieldImpact";
import type { TPlaceType } from "../../../placeUtils";
import { messageFromError } from "../../../errors/messageFromError";
import {
  Button,
  Hero,
  IconButton,
  IconTile,
  Menu,
  Row,
  SectionHeader,
  TextField,
} from "../../../ui";
import classes from "./ListPage.module.css";

function customFieldTypeName(type: TripLogCustomFieldDef["type"]): string {
  return CUSTOM_FIELD_TYPES.find((option) => option.value === type)?.label ?? type;
}

/**
 * One family of the user's own attributes — trip or place — as a page inside
 * Settings.
 *
 * BUILT-INS LAST, and with no verbs. A system definition belongs to no account:
 * the server looks a key up under the CALLER's id, so `PATCH` and `DELETE` are
 * both 404 on one, and offering Rename beside it produced "Custom field not
 * found" every time (fixed 2026-09-18). A row with no action reads as a fact;
 * a row whose action fails reads as a bug.
 *
 * A rename keeps the definition's `key`, so the values stay attached to it —
 * which is why the confirm is informational rather than a warning, and why it
 * still states how many rows are affected.
 */
function CustomFieldSection({
  entity,
  title,
  rowNoun,
  loading,
  defs,
  onDefsChange,
  placeTypes,
  onBack,
}: {
  entity: CustomFieldEntityKind;
  title: string;
  /** What one ROW of this entity is called, for the impact sentence. */
  rowNoun: string;
  // Owning user not yet loaded — show a loading state instead of the list.
  loading: boolean;
  // Scoped for places, plain for trip logs — the page only reads the label and
  // key, so it takes whichever the caller holds and hands back what the server
  // returned rather than a locally-edited copy.
  defs: ScopedCustomFieldDef[];
  onDefsChange: (defs: ScopedCustomFieldDef[]) => void;
  /** Offered as the scoping choice when a PLACE attribute is created. Absent
   *  for trip attributes, which are scoped by the places a trip links rather
   *  than chosen. */
  placeTypes?: TPlaceType[];
  onBack: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<ScopedCustomFieldDef | null>(null);
  const [renameInput, setRenameInput] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  // Set when the rename passes validation; holds the confirm's copy while the
  // user decides.
  const [pendingRename, setPendingRename] = useState<{
    key: string;
    oldLabel: string;
    newLabel: string;
  } | null>(null);
  const [renameSaving, setRenameSaving] = useState(false);
  const [deletingDef, setDeletingDef] = useState<TripLogCustomFieldDef | null>(null);

  const { count: impactCount, error: impactError } = useCustomFieldImpact(
    entity,
    pendingRename?.key ?? null,
  );

  function submitRename(def: ScopedCustomFieldDef) {
    const result = renameCustomFieldLabel(defs, def.key, renameInput);
    if ("error" in result) {
      setRenameError(result.error);
      return;
    }
    if (result.defs === defs || renameInput.trim() === def.label) {
      // Unchanged — nothing to save.
      setRenaming(null);
      return;
    }
    setPendingRename({ key: def.key, oldLabel: def.label, newLabel: renameInput.trim() });
  }

  async function confirmRename() {
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
      setRenaming(null);
    } catch (err) {
      console.error(err);
      setPendingRename(null);
      setRenameError(messageFromError(err, `Couldn't rename that ${ATTRIBUTE_NOUN.one}.`));
    } finally {
      setRenameSaving(false);
    }
  }

  if (adding) {
    return (
      <AddAttributePage
        entity={entity}
        rowNoun={rowNoun}
        existingDefs={defs}
        placeTypes={placeTypes}
        onAdded={(updated) => {
          onDefsChange(updated);
          setAdding(false);
        }}
        onBack={() => setAdding(false)}
      />
    );
  }

  const own = defs.filter((def) => !isSystemFieldDef(def));
  const system = defs.filter(isSystemFieldDef);

  return (
    <div className={classes.root}>
      <Hero
        title={title}
        onBack={onBack}
        backLabel="Back to Settings"
        actions={
          <Button compact variant="outline" icon={Plus} onClick={() => setAdding(true)}>
            Add
          </Button>
        }
      />

      <div className={classes.list}>
        {loading ? (
          <p className={classes.state}>Loading…</p>
        ) : (
          <>
            {own.length === 0 ? (
              <p className={classes.note}>
                Add your own {ATTRIBUTE_NOUN.one} to record on every {rowNoun} — water level,
                say, or party size.
              </p>
            ) : (
              <SectionHeader title="Yours" count={own.length} />
            )}

            {own.map((def) =>
              renaming?.key === def.key ? (
                <div key={def.key} className={classes.inlineEdit}>
                  <TextField
                    label={`Rename ${def.label}`}
                    value={renameInput}
                    onChange={(event) => {
                      setRenameInput(event.target.value);
                      if (renameError) setRenameError(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") submitRename(def);
                      if (event.key === "Escape") setRenaming(null);
                    }}
                    error={renameError}
                    maxLength={64}
                    disabled={renameSaving}
                    autoFocus
                  />
                  <div className={classes.inlineActions}>
                    <Button compact onClick={() => setRenaming(null)} disabled={renameSaving}>
                      Cancel
                    </Button>
                    <Button
                      compact
                      variant="filled"
                      busy={renameSaving}
                      onClick={() => submitRename(def)}
                    >
                      Save
                    </Button>
                  </div>
                </div>
              ) : (
                <Row
                  key={def.key}
                  leading={<IconTile icon={Tag} hue="var(--theme-accent)" />}
                  title={customFieldDisplayLabel(def)}
                  subtitle={customFieldTypeName(def.type)}
                  description="Opens the name for editing"
                  onOpen={() => {
                    setRenaming(def);
                    setRenameInput(def.label);
                    setRenameError(null);
                  }}
                  trailing={
                    /* The destructive verb lives in the ⋯: warning as TEXT on a
                       card measures 3.8:1 (Basalt), and the menu's surface is
                       where it clears 4.5 (`scripts/wcag-contrast.mjs`). */
                    <Menu
                      label={`Actions for ${def.label}`}
                      title={def.label}
                      placement="bottom-end"
                      entries={[
                        {
                          id: "delete",
                          label: `Delete ${ATTRIBUTE_NOUN.one}`,
                          icon: Trash2,
                          danger: true,
                          onSelect: () => setDeletingDef(def),
                        },
                      ]}
                      trigger={(props) => (
                        <IconButton
                          {...props}
                          icon={EllipsisVertical}
                          label={`Actions for ${def.label}`}
                        />
                      )}
                    />
                  }
                />
              ),
            )}

            {system.length > 0 && (
              <>
                <SectionHeader title="Built in" count={system.length} />
                {system.map((def) => (
                  <Row
                    key={def.key}
                    leading={<IconTile icon={Lock} hue="var(--theme-bonus-2)" />}
                    title={customFieldDisplayLabel(def)}
                    subtitle={customFieldTypeName(def.type)}
                  />
                ))}
              </>
            )}
          </>
        )}
      </div>

      {/* Rename impact confirm — values stay linked (the key is stable), so
          this states a number rather than warning about a loss. */}
      <ConfirmDialog
        open={pendingRename !== null}
        title={`Rename "${pendingRename?.oldLabel ?? ""}"?`}
        message={
          <>
            It becomes "{pendingRename?.newLabel ?? ""}".{" "}
            {impactSentence(impactCount, impactError, rowNoun)}
          </>
        }
        confirmLabel="Rename"
        confirmColor="secondary"
        busy={renameSaving}
        onConfirm={confirmRename}
        onClose={() => {
          if (!renameSaving) setPendingRename(null);
        }}
      />

      <DeleteCustomFieldDialog
        entity={entity}
        def={deletingDef}
        onClose={() => setDeletingDef(null)}
        onDeleted={(remaining) => onDefsChange(remaining)}
      />
    </div>
  );
}

/** What renaming does to the rows that already answered it. Never a warning:
 *  the values keep their key and appear under the new name. */
function impactSentence(count: number | null, error: string | null, rowNoun: string): string {
  if (error) return "Existing values are kept and appear under the new name.";
  if (count === null) return `Checking how many ${rowNoun}s use it…`;
  if (count === 0) return `No ${rowNoun} has a value for it yet.`;
  return `${count} ${count === 1 ? rowNoun : `${rowNoun}s`} ${
    count === 1 ? "has" : "have"
  } a value for it — kept, and shown under the new name.`;
}

/**
 * Adding one, as a page rather than a dialog: the form is the same
 * `AddCustomFieldForm` a place's and a trip's own form open inline, so the
 * three cannot drift (UX-002/003), and it carries its own Cancel and Add.
 */
function AddAttributePage({
  entity,
  rowNoun,
  existingDefs,
  placeTypes,
  onAdded,
  onBack,
}: {
  entity: CustomFieldEntityKind;
  rowNoun: string;
  existingDefs: ScopedCustomFieldDef[];
  placeTypes?: TPlaceType[];
  onAdded: (defs: ScopedCustomFieldDef[]) => void;
  onBack: () => void;
}) {
  const [label, setLabel] = useState("");
  const [type, setType] = useState<TripLogCustomFieldType>("string");
  const [bounded, setBounded] = useState(false);
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTypeIds, setSelectedTypeIds] = useState<string[]>([]);
  // Defaults to "all types" for an attribute created here: the user is defining
  // one with no place in front of them, so the honest default is the one that
  // shows it everywhere rather than nowhere.
  const [appliesToAllTypes, setAppliesToAllTypes] = useState(true);

  async function handleAdd() {
    const result = buildCustomFieldDef({ label, type, bounded, min, max }, existingDefs);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // ROW-GRAIN. The whole-list PATCH is gone (see placeUtils.ts): it could
      // not express the scoping, so every save through it wiped the scoping
      // off every definition.
      const updated = await createCustomField(entity, result.def, {
        appliesToAllTypes,
        ...(appliesToAllTypes ? {} : { placeTypeIds: selectedTypeIds }),
      });
      onAdded(updated);
    } catch (err) {
      console.error(err);
      setError(messageFromError(err, `Couldn't save that ${ATTRIBUTE_NOUN.one}.`));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={classes.root}>
      <Hero
        title={`New ${rowNoun} ${ATTRIBUTE_NOUN.one}`}
        onBack={onBack}
        backLabel="Back to the list"
      />
      <div className={classes.list}>
        <AddCustomFieldForm
          entityNoun={`${rowNoun}s`}
          label={label}
          onLabelChange={setLabel}
          type={type}
          onTypeChange={setType}
          onAdd={handleAdd}
          onCancel={onBack}
          adding={saving}
          error={error}
          bounds={{
            bounded,
            onBoundedChange: setBounded,
            min,
            onMinChange: setMin,
            max,
            onMaxChange: setMax,
          }}
          scope={
            placeTypes && entity === "place"
              ? {
                  types: placeTypes,
                  selectedTypeIds,
                  onSelectedTypeIdsChange: setSelectedTypeIds,
                  appliesToAllTypes,
                  onAppliesToAllTypesChange: setAppliesToAllTypes,
                }
              : undefined
          }
        />
      </div>
    </div>
  );
}

export default CustomFieldSection;
