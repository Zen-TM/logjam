import type { TripLogCustomFieldType } from "@logjam/shared";
import { CUSTOM_FIELD_TYPES } from "@logjam/shared";
import { sanitizeNumericInput } from "../../numberInput";
import { ErrorBanner } from "../feedback/ErrorBanner";
import { Button, Checkbox, ChipRail, SectionHeader, TextField } from "../../ui";
import classes from "./AddCustomFieldForm.module.css";

/** What the user calls this shape — "Text", "Yes / No". */
function customFieldTypeName(type: TripLogCustomFieldType): string {
  return CUSTOM_FIELD_TYPES.find((option) => option.value === type)?.label ?? type;
}

/**
 * The attribute form, shared between PlaceDialog, TripLogDialog and Settings'
 * add/edit dialogs, so the four cannot drift (UX-002/UX-003).
 *
 * TWO SHAPES, one form. Inside a place's or a trip's own dialog it is a card
 * with its own heading and buttons, opened beneath the fields it will join.
 * From Settings it IS the dialog (`asDialogBody`) — a form in a card inside a
 * panel had no precedent anywhere else in the app, and every other "make one of
 * these" in Logjam Web is a dialog.
 *
 * Bounds (min/max) are opt-in via the `bounds` prop group. The bounds row only
 * renders for integer/float types.
 */
function AddCustomFieldForm({
  label,
  onLabelChange,
  type,
  onTypeChange,
  onAdd,
  onCancel,
  adding,
  error,
  bounds,
  scope,
  asDialogBody = false,
  typeLocked = false,
}: {
  label: string;
  onLabelChange: (value: string) => void;
  type: TripLogCustomFieldType;
  onTypeChange: (type: TripLogCustomFieldType) => void;
  onAdd: () => void;
  onCancel: () => void;
  adding: boolean;
  error?: string | null;
  bounds?: {
    bounded: boolean;
    onBoundedChange: (bounded: boolean) => void;
    min: string;
    onMinChange: (value: string) => void;
    max: string;
    onMaxChange: (value: string) => void;
  };
  /**
   * WHERE the field appears. Omitted where the answer is not the user's to
   * make (a field added from a place's own form belongs to that place's type).
   *
   * "All types" is a FLAG, not every box ticked: a field scoped by ticking
   * each type that exists today would silently fail to apply to one created
   * tomorrow, and the user who meant "all" would never find out.
   */
  scope?: {
    types: { id: string; name: string }[];
    selectedTypeIds: string[];
    onSelectedTypeIdsChange: (ids: string[]) => void;
    appliesToAllTypes: boolean;
    onAppliesToAllTypesChange: (value: boolean) => void;
  };
  /** This form IS a dialog's body: the host supplies the surface, the title
   *  and the buttons, so the card, the heading and the action row come off. */
  asDialogBody?: boolean;
  /** Editing an existing attribute. The type is what its stored values are
   *  shaped like, so it is shown and not offered — a string that becomes a
   *  number leaves every answer already recorded unreadable. */
  typeLocked?: boolean;
}) {
  const isNumeric = type === "integer" || type === "float";
  const showBounds = bounds != null && isNumeric;

  // This sub-form renders inside the host dialog's <form>, so a bare Enter in
  // any of its single-line inputs would submit the *dialog* — saving the trip
  // or place the user is still filling in, which is not what "Enter" means
  // while you're typing a field label. Swallow it and run the sub-form's own
  // primary action instead, guarded by the same condition as the Add button so
  // Enter can't add a field the button wouldn't.
  //
  // Bound to the text inputs rather than the wrapper: the type select does its
  // own Enter handling, and a container-level handler would fire on top of it.
  function handleFieldKeyDown(event: React.KeyboardEvent) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (adding || !label.trim()) return;
    onAdd();
  }

  return (
    <div className={asDialogBody ? classes.dialogBody : classes.addFieldForm}>
      {!asDialogBody && <SectionHeader title="New attribute" />}
      {/* WHAT it is, then WHERE it appears: the name is the decision being
          made, and a list of types above an empty label field asks the second
          question first. */}
      <TextField
        label="Label"
        value={label}
        onChange={(event) => onLabelChange(event.target.value)}
        onKeyDown={handleFieldKeyDown}
        placeholder="e.g. Group size"
        data-autofocus={asDialogBody || undefined}
      />
      {typeLocked ? (
        /* A control that cannot be operated is not a control. The type is a
           FACT about an attribute that already has answers stored in its
           shape, so it reads as one — the same call the built-in rows make. */
        <div className={classes.staticField}>
          <span className={classes.groupLabel}>Type</span>
          <span>{customFieldTypeName(type)}</span>
          <p className={classes.note}>
            An attribute's type can't change once it exists — its answers are already
            stored in that shape.
          </p>
        </div>
      ) : (
        <div className={classes.typeField}>
          <span className={classes.groupLabel}>Type</span>
          <ChipRail
            label="Type"
            options={CUSTOM_FIELD_TYPES.map((option) => ({
              value: option.value,
              label: option.label,
            }))}
            value={type}
            onChange={onTypeChange}
          />
        </div>
      )}
      {showBounds && (
        <div className={classes.boundsRow}>
          <Checkbox label="Bounded" checked={bounds.bounded} onChange={bounds.onBoundedChange} />
          <TextField
            label="Min"
            className={classes.grow}
            value={bounds.min}
            onChange={(event) => bounds.onMinChange(sanitizeNumericInput(event.target.value, type as "integer" | "float"))}
            onKeyDown={handleFieldKeyDown}
            disabled={!bounds.bounded}
            inputMode={type === "integer" ? "numeric" : "decimal"}
          />
          <TextField
            label="Max"
            className={classes.grow}
            value={bounds.max}
            onChange={(event) => bounds.onMaxChange(sanitizeNumericInput(event.target.value, type as "integer" | "float"))}
            onKeyDown={handleFieldKeyDown}
            disabled={!bounds.bounded}
            inputMode={type === "integer" ? "numeric" : "decimal"}
          />
        </div>
      )}
      {scope && (
        <div role="group" aria-label="Where it appears" className={classes.scope}>
          <span className={classes.groupLabel}>Where it appears</span>
          <Checkbox
            label="All types, including ones I add later"
            checked={scope.appliesToAllTypes}
            onChange={scope.onAppliesToAllTypesChange}
          />
          {!scope.appliesToAllTypes &&
            scope.types.map((placeType) => (
              <Checkbox
                key={placeType.id}
                label={placeType.name}
                checked={scope.selectedTypeIds.includes(placeType.id)}
                onChange={(checked) =>
                  scope.onSelectedTypeIdsChange(
                    checked
                      ? [...scope.selectedTypeIds, placeType.id]
                      : scope.selectedTypeIds.filter((id) => id !== placeType.id),
                  )
                }
              />
            ))}
        </div>
      )}
      {error && <ErrorBanner message={error} />}
      {!asDialogBody && (
        <div className={classes.actionsRow}>
          <Button compact onClick={onCancel} disabled={adding}>
            Cancel
          </Button>
          <Button compact variant="filled" busy={adding} disabled={!label.trim()} onClick={onAdd}>
            Add attribute
          </Button>
        </div>
      )}
    </div>
  );
}

export default AddCustomFieldForm;
