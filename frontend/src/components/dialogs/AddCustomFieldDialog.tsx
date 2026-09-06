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
  type ScopedCustomFieldDef,
  type TripLogCustomFieldDef,
  type TripLogCustomFieldType,
} from "@logjam/shared";
import { createCustomField, type CustomFieldEntityKind } from "../../placeUtils";
import { messageFromError } from "../../errors/messageFromError";
import AddCustomFieldForm from "./AddCustomFieldForm";

// Entity → the noun the add-form uses ("This field will be created for all
// <noun>."). The `uiPreferences` key that used to live here went with the
// whole-list write path: definitions are rows, addressed by key.
const ENTITY_NOUN: Record<CustomFieldEntityKind, string> = {
  "trip-log": "trip logs",
  place: "places",
};

/**
 * MUI dialog that hosts the shared AddCustomFieldForm so a custom field can be
 * created from the Account panel (which, being a sidebar panel, can't render
 * MUI form controls itself). Owns the add-form draft state, runs the same
 * `buildCustomFieldDef` validation the PlaceDialog/TripLogDialog add-forms use,
 * persists the new def to User.uiPreferences, and reports the updated def list.
 */
function AddCustomFieldDialog({
  open,
  entity,
  existingDefs,
  placeTypes,
  onClose,
  onAdded,
}: {
  open: boolean;
  entity: CustomFieldEntityKind;
  existingDefs: TripLogCustomFieldDef[];
  /** Offered as the scoping choice for a PLACE field. Absent for trip logs,
   *  whose fields are scoped by the types of the places a trip links (§2.7),
   *  so they are created for every type. */
  placeTypes?: { id: string; name: string }[];
  onClose: () => void;
  onAdded: (defs: ScopedCustomFieldDef[]) => void;
}) {
  const [label, setLabel] = useState("");
  const [type, setType] = useState<TripLogCustomFieldType>("string");
  const [bounded, setBounded] = useState(false);
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTypeIds, setSelectedTypeIds] = useState<string[]>([]);
  // Defaults to "all types" for a field created from the account panel: the
  // user is defining a field with no place in front of them, so the honest
  // default is the one that shows it everywhere rather than nowhere.
  const [appliesToAllTypes, setAppliesToAllTypes] = useState(true);

  function reset() {
    setLabel("");
    setType("string");
    setBounded(false);
    setMin("");
    setMax("");
    setError(null);
    setSelectedTypeIds([]);
    setAppliesToAllTypes(true);
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
      // ROW-GRAIN. The whole-list PATCH is gone (see placeUtils.ts): it could
      // not express the scoping, so every save through it wiped the scoping
      // off every definition.
      const updatedDefs = await createCustomField(entity, result.def, {
        appliesToAllTypes,
        ...(appliesToAllTypes ? {} : { placeTypeIds: selectedTypeIds }),
      });
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
          entityNoun={ENTITY_NOUN[entity]}
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
      </DialogContent>
    </Dialog>
  );
}

export default AddCustomFieldDialog;
