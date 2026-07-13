import { useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  IconButton,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import {
  buildCustomFieldDef,
  type TripLogCustomFieldDef,
  type TripLogCustomFieldType,
} from "@logjam/shared";
import { updateUserPreferences, type CustomFieldEntityKind } from "../../canyonUtils";
import { messageFromError } from "../../errors/messageFromError";
import AddCustomFieldForm from "./AddCustomFieldForm";

// Entity → the User.uiPreferences key its defs live under, and the noun the
// add-form uses ("This field will be created for all <noun>.").
const ENTITY_META: Record<
  CustomFieldEntityKind,
  { prefsKey: "tripLogCustomFields" | "canyonCustomFields"; noun: string }
> = {
  "trip-log": { prefsKey: "tripLogCustomFields", noun: "trip logs" },
  canyon: { prefsKey: "canyonCustomFields", noun: "canyons" },
};

/**
 * MUI dialog that hosts the shared AddCustomFieldForm so a custom field can be
 * created from the Account panel (which, being a sidebar panel, can't render
 * MUI form controls itself). Owns the add-form draft state, runs the same
 * `buildCustomFieldDef` validation the CanyonDialog/TripLogDialog add-forms use,
 * persists the new def to User.uiPreferences, and reports the updated def list.
 */
function AddCustomFieldDialog({
  open,
  entity,
  existingDefs,
  onClose,
  onAdded,
}: {
  open: boolean;
  entity: CustomFieldEntityKind;
  existingDefs: TripLogCustomFieldDef[];
  onClose: () => void;
  onAdded: (defs: TripLogCustomFieldDef[]) => void;
}) {
  const [label, setLabel] = useState("");
  const [type, setType] = useState<TripLogCustomFieldType>("string");
  const [bounded, setBounded] = useState(false);
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const meta = ENTITY_META[entity];

  function reset() {
    setLabel("");
    setType("string");
    setBounded(false);
    setMin("");
    setMax("");
    setError(null);
  }

  function handleClose() {
    if (adding) return;
    reset();
    onClose();
  }

  async function handleAdd() {
    const result = buildCustomFieldDef({ label, type, bounded, min, max }, existingDefs);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setAdding(true);
    setError(null);
    try {
      const updatedDefs = [...existingDefs, result.def];
      await updateUserPreferences({ [meta.prefsKey]: updatedDefs });
      onAdded(updatedDefs);
      reset();
      onClose();
    } catch (err) {
      console.error(err);
      setError(messageFromError(err, "Couldn't save custom field. Please try again."));
    } finally {
      setAdding(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={adding ? undefined : handleClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          backgroundColor: "var(--theme-primary)",
          color: "var(--theme-text-primary)",
        },
      }}
    >
      <DialogTitle
        sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", pb: 1 }}
      >
        Add custom field
        <IconButton
          aria-label="Close dialog"
          size="small"
          onClick={handleClose}
          sx={{ color: "var(--theme-text-primary)" }}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ borderColor: "rgba(255,255,255,0.1)" }}>
        <AddCustomFieldForm
          entityNoun={meta.noun}
          label={label}
          onLabelChange={setLabel}
          type={type}
          onTypeChange={setType}
          onAdd={handleAdd}
          onCancel={handleClose}
          adding={adding}
          error={error}
          bounds={{
            bounded,
            onBoundedChange: setBounded,
            min,
            onMinChange: setMin,
            max,
            onMaxChange: setMax,
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

export default AddCustomFieldDialog;
