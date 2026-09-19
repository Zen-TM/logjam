import { useState } from "react";
import { EllipsisVertical, Lock, Pencil, Plus, Tag, Trash2 } from "lucide-react";
import {
  ATTRIBUTE_NOUN,
  buildCustomFieldDef,
  CUSTOM_FIELD_TYPES,
  customFieldDisplayLabel,
  isSystemFieldDef,
  type ScopedCustomFieldDef,
  type TripLogCustomFieldDef,
  type TripLogCustomFieldType,
} from "@logjam/shared";
import {
  createCustomField,
  updateCustomField,
  type CustomFieldEntityKind,
} from "../../../placeUtils";
import DeleteCustomFieldDialog from "../../dialogs/DeleteCustomFieldDialog";
import AddCustomFieldForm from "../../dialogs/AddCustomFieldForm";
import { useCustomFieldImpact } from "../../dialogs/useCustomFieldImpact";
import type { TPlaceType } from "../../../placeUtils";
import { messageFromError } from "../../../errors/messageFromError";
import {
  Button,
  Dialog,
  Hero,
  IconButton,
  IconTile,
  Menu,
  Row,
  SectionHeader,
} from "../../../ui";
import classes from "./ListPage.module.css";

function customFieldTypeName(type: TripLogCustomFieldDef["type"]): string {
  return CUSTOM_FIELD_TYPES.find((option) => option.value === type)?.label ?? type;
}

/**
 * One family of the user's own attributes — trip or place — as a page inside
 * Settings.
 *
 * The page is a LIST, and making or changing one is a DIALOG, which is what
 * every other "new one of these" in Logjam Web is. It was a form in a card
 * inside the panel for adding and a row that turned into a text field for
 * renaming: two shapes invented here and used nowhere else.
 *
 * BUILT-INS LAST, and with no verbs. A system definition belongs to no account:
 * the server looks a key up under the CALLER's id, so `PATCH` and `DELETE` are
 * both 404 on one, and offering Rename beside it produced "Custom field not
 * found" every time (fixed 2026-09-18). A row with no action reads as a fact;
 * a row whose action fails reads as a bug.
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
  /** Offered as the scoping choice when a PLACE attribute is created or
   *  changed. Absent for trip attributes, which are scoped by the places a trip
   *  links rather than chosen. */
  placeTypes?: TPlaceType[];
  onBack: () => void;
}) {
  /** The dialog's subject: an existing attribute, or a new one. */
  const [editing, setEditing] = useState<ScopedCustomFieldDef | "new" | null>(null);
  const [deletingDef, setDeletingDef] = useState<TripLogCustomFieldDef | null>(null);

  const own = defs.filter((def) => !isSystemFieldDef(def));
  const system = defs.filter(isSystemFieldDef);

  return (
    <div className={classes.root}>
      <Hero
        title={title}
        onBack={onBack}
        backLabel="Back to Settings"
        actions={
          <Button compact variant="outline" icon={Plus} onClick={() => setEditing("new")}>
            Add
          </Button>
        }
      />

      <div className={classes.list}>
        {loading ? (
          <p className={classes.state}>Loading…</p>
        ) : (
          <>
            {own.length === 0 && (
              <p className={classes.note}>
                Add your own {ATTRIBUTE_NOUN.one} to record on every {rowNoun} — water level,
                say, or party size.
              </p>
            )}
            {/* "Yours" only earns a line when there is a "Built in" opposite
                it. Every system definition is place-scoped, so a trip's list
                is nothing but the user's own, and a heading dividing a list
                from nothing states a contrast that is not there. */}
            {own.length > 0 && system.length > 0 && (
              <SectionHeader title="Yours" count={own.length} />
            )}

            {own.map((def) => (
              <Row
                key={def.key}
                leading={<IconTile icon={Tag} hue="var(--theme-accent)" />}
                title={customFieldDisplayLabel(def)}
                subtitle={rowSubtitle(def, placeTypes)}
                description={`Opens this ${ATTRIBUTE_NOUN.one} for editing`}
                onOpen={() => setEditing(def)}
                trailing={
                  /* The destructive verb lives in the ⋯: warning as TEXT on a
                     card measures 3.8:1 (Basalt), and the menu's surface is
                     where it clears 4.5 (`scripts/wcag-contrast.mjs`). */
                  <Menu
                    label={`Actions for ${def.label}`}
                    title={def.label}
                    placement="bottom-end"
                    entries={[
                      /* The row opens it too. The menu still names the verb:
                         a ⋯ that holds only the destructive one is a menu
                         you learn to avoid. */
                      {
                        id: "edit",
                        label: `Edit ${ATTRIBUTE_NOUN.one}`,
                        icon: Pencil,
                        onSelect: () => setEditing(def),
                      },
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
            ))}

            {system.length > 0 && (
              <>
                <SectionHeader title="Built in" count={system.length} />
                {system.map((def) => (
                  <Row
                    key={def.key}
                    leading={<IconTile icon={Lock} hue="var(--theme-bonus-2)" />}
                    title={customFieldDisplayLabel(def)}
                    subtitle={rowSubtitle(def, placeTypes)}
                  />
                ))}
              </>
            )}
          </>
        )}
      </div>

      {/* Mounted only while open, so it starts from the definition every time
          rather than from whatever the last edit left behind. */}
      {editing !== null && (
        <AttributeDialog
          entity={entity}
          rowNoun={rowNoun}
          def={editing === "new" ? null : editing}
          defs={defs}
          placeTypes={placeTypes}
          onSaved={(updated) => {
            onDefsChange(updated);
            setEditing(null);
          }}
          onClose={() => setEditing(null)}
        />
      )}

      <DeleteCustomFieldDialog
        entity={entity}
        def={deletingDef}
        onClose={() => setDeletingDef(null)}
        onDeleted={(remaining) => onDefsChange(remaining)}
      />
    </div>
  );
}

/** What kind of answer it takes, and — for a place attribute — which types ask
 *  it. Scope is the half of a definition a user cannot see from the form it
 *  produces, so the list says it. */
function rowSubtitle(def: ScopedCustomFieldDef, placeTypes?: TPlaceType[]): string {
  const type = customFieldTypeName(def.type);
  if (!placeTypes) return type;
  if (def.appliesToAllTypes) return `${type} · all types`;
  const names = placeTypes
    .filter((placeType) => def.placeTypeIds.includes(placeType.id))
    .map((placeType) => placeType.name);
  if (names.length === 0) return `${type} · no types`;
  return `${type} · ${names.join(", ")}`;
}

/**
 * Make one, or change one. The same form either way — the fields ARE the
 * definition — on the shared `AddCustomFieldForm`, so Settings, a place's own
 * dialog and a trip's cannot drift (UX-002/003).
 *
 * The TYPE is fixed once values exist under it: the server would take the
 * patch, and every answer already recorded would stay in the old shape. A
 * rename is safe by contrast, because the `key` never moves — which is what
 * the impact line says rather than warns.
 */
function AttributeDialog({
  entity,
  rowNoun,
  def,
  defs,
  placeTypes,
  onSaved,
  onClose,
}: {
  entity: CustomFieldEntityKind;
  rowNoun: string;
  /** null = making a new one. */
  def: ScopedCustomFieldDef | null;
  defs: ScopedCustomFieldDef[];
  placeTypes?: TPlaceType[];
  onSaved: (defs: ScopedCustomFieldDef[]) => void;
  onClose: () => void;
}) {
  const [label, setLabel] = useState(def?.label ?? "");
  const [type, setType] = useState<TripLogCustomFieldType>(def?.type ?? "string");
  const [bounded, setBounded] = useState(def?.min != null && def?.max != null);
  const [min, setMin] = useState(def?.min != null ? String(def.min) : "");
  const [max, setMax] = useState(def?.max != null ? String(def.max) : "");
  const [selectedTypeIds, setSelectedTypeIds] = useState<string[]>(def?.placeTypeIds ?? []);
  // A NEW attribute defaults to "all types": the user is defining one with no
  // place in front of them, so the honest default shows it everywhere rather
  // than nowhere.
  const [appliesToAllTypes, setAppliesToAllTypes] = useState(def?.appliesToAllTypes ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { count: impactCount } = useCustomFieldImpact(entity, def?.key ?? null);

  async function handleSave() {
    // Validated against every OTHER definition: a rename that keeps the same
    // label would otherwise collide with itself.
    const result = buildCustomFieldDef(
      { label, type, bounded, min, max },
      defs.filter((other) => other.key !== def?.key),
    );
    if ("error" in result) {
      setError(result.error);
      return;
    }
    const scoping =
      placeTypes && entity === "place"
        ? {
            appliesToAllTypes,
            ...(appliesToAllTypes ? {} : { placeTypeIds: selectedTypeIds }),
          }
        : {};
    setSaving(true);
    setError(null);
    try {
      // ROW-GRAIN, both ways. The whole-list PATCH is gone (see placeUtils.ts):
      // it could not express the scoping, so every save through it wiped the
      // scoping off every definition.
      const updated = def
        ? await updateCustomField(entity, def.key, {
            label: result.def.label,
            // NO `min`/`max`. The edit form does not offer bounds, so it must
            // not carry an answer about them: the server merges what it is
            // sent (`patch.min !== undefined ? … : existing.min`), and sending
            // the unbounded form's empty pair would have quietly stripped the
            // range off every bounded attribute the moment its name changed.
            ...scoping,
          })
        : await createCustomField(entity, result.def, scoping);
      onSaved(updated);
    } catch (err) {
      console.error(err);
      setError(messageFromError(err, `Couldn't save that ${ATTRIBUTE_NOUN.one}.`));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      title={def ? `Edit "${def.label}"` : `New ${rowNoun} ${ATTRIBUTE_NOUN.one}`}
      onClose={onClose}
      dismissible={!saving}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="filled"
            busy={saving}
            disabled={!label.trim()}
            onClick={handleSave}
          >
            {def ? "Save" : `Add ${ATTRIBUTE_NOUN.one}`}
          </Button>
        </>
      }
    >
      <AddCustomFieldForm
        asDialogBody
        typeLocked={def !== null}
        label={label}
        onLabelChange={(value) => {
          setLabel(value);
          if (error) setError(null);
        }}
        type={type}
        onTypeChange={setType}
        onAdd={handleSave}
        onCancel={onClose}
        adding={saving}
        error={error}
        /* Bounds are set when the attribute is made and not after: a range is
           part of the shape its stored answers were accepted under, and
           tightening one retroactively would mark values invalid that nothing
           will ever re-ask. Editing offers the name and the scope. */
        bounds={
          def
            ? undefined
            : {
                bounded,
                onBoundedChange: setBounded,
                min,
                onMinChange: setMin,
                max,
                onMaxChange: setMax,
              }
        }
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
      {def && <p className={classes.dialogNote}>{impactSentence(impactCount, rowNoun)}</p>}
    </Dialog>
  );
}

/** How much of the user's own data already answers this. A statement, not a
 *  warning: the values are keyed by something no edit here moves, so nothing
 *  this dialog can do will lose them. */
function impactSentence(count: number | null, rowNoun: string): string {
  if (count === null) return `Checking how many ${rowNoun}s use it…`;
  if (count === 0) return `No ${rowNoun} has a value for this ${ATTRIBUTE_NOUN.one} yet.`;
  return `${count} ${count === 1 ? rowNoun : `${rowNoun}s`} ${
    count === 1 ? "has" : "have"
  } a value for this ${ATTRIBUTE_NOUN.one}.`;
}

export default CustomFieldSection;
