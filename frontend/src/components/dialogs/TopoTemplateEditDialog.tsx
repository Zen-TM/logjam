import { useState, useEffect } from "react";
import { useIsMobile } from "../../useIsMobile";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  IconButton,
  TextField,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { apiFetch } from "../../canyonUtils";
import { messageFromError } from "../../errors/messageFromError";
import { ErrorBanner } from "../feedback/ErrorBanner";
import {
  RASTER_TEMPLATE_DEFAULTS,
  cloneRasterTemplateSettings,
  type RasterTemplateSettings,
} from "@logjam/shared";
import AdvancedSettings from "./topoSettings/AdvancedSettings";
import type { TopoTemplate } from "./TopoDialog";

function TopoTemplateEditDialog({
  open,
  onClose,
  editingTemplate,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  editingTemplate: TopoTemplate | null;
  onSaved: () => void;
}) {
  const isMobile = useIsMobile();
  const [name, setName] = useState("");
  const [settings, setSettings] = useState<RasterTemplateSettings>(() =>
    cloneRasterTemplateSettings(RASTER_TEMPLATE_DEFAULTS),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (editingTemplate) {
      setName(editingTemplate.name);
      setSettings(cloneRasterTemplateSettings(editingTemplate.config));
    } else {
      setName("");
      setSettings(cloneRasterTemplateSettings(RASTER_TEMPLATE_DEFAULTS));
    }
  }, [open, editingTemplate]);

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    setError(null);
    try {
      if (editingTemplate) {
        await apiFetch(`/topo-templates/${editingTemplate.id}`, {
          method: "PATCH",
          body: { name: trimmed, config: settings },
        });
      } else {
        await apiFetch("/topo-templates", {
          method: "POST",
          body: { name: trimmed, config: settings },
        });
      }
      onSaved();
      onClose();
    } catch (err) {
      console.error(err);
      setError(messageFromError(err, "Couldn't save template. Please try again."));
    } finally {
      setSaving(false);
    }
  }

  const inputSx = {
    "& .MuiInputBase-input": { color: "var(--theme-text-primary)" },
    "& .MuiInputLabel-root": { color: "var(--theme-text-muted)" },
    "& .MuiInputLabel-root.Mui-focused": { color: "var(--theme-accent)" },
    "& .MuiOutlinedInput-notchedOutline": { borderColor: "var(--theme-accent)" },
  };

  return (
    <Dialog
      fullScreen={isMobile}
      open={open}
      onClose={saving ? undefined : onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          backgroundColor: "var(--theme-primary)",
          color: "var(--theme-text-primary)",
          maxHeight: "85vh",
        },
      }}
    >
      <DialogTitle
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          pb: 1,
        }}
      >
        {editingTemplate ? "Edit Template" : "New Template"}
        <IconButton
          size="small"
          onClick={onClose}
          disabled={saving}
          sx={{ color: "var(--theme-text-primary)" }}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers sx={{ borderColor: "rgba(255,255,255,0.1)" }}>
        {error && <ErrorBanner message={error} />}
        <TextField
          label="Template name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          size="small"
          fullWidth
          sx={{ ...inputSx, mb: 2 }}
        />
        <AdvancedSettings value={settings} onChange={setSettings} />
      </DialogContent>

      <DialogActions>
        <Button
          onClick={onClose}
          disabled={saving}
          sx={{ color: "var(--theme-text-primary)" }}
        >
          Cancel
        </Button>
        <Button
          variant="contained"
          color="secondary"
          disabled={saving || !name.trim()}
          onClick={handleSave}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default TopoTemplateEditDialog;
