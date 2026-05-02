import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  IconButton,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { apiFetch } from "../../canyonUtils";
import type { GeoPdfTemplateConfig } from "./GeoPdfDialog";
import classes from "./GeoPdfTemplatesDialog.module.css";

export type GeoPdfTemplate = {
  id: string;
  name: string;
  config: GeoPdfTemplateConfig;
  createdAt: string;
  updatedAt: string;
};

function relativeDate(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function GeoPdfTemplatesDialog({
  open,
  onClose,
  onEditTemplate,
}: {
  open: boolean;
  onClose: () => void;
  onEditTemplate: (template: GeoPdfTemplate | null) => void;
}) {
  const [templates, setTemplates] = useState<GeoPdfTemplate[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    apiFetch<GeoPdfTemplate[]>("/geo-pdf-templates")
      .then(setTemplates)
      .catch(() => {});
  }, [open]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await apiFetch(`/geo-pdf-templates/${id}`, { method: "DELETE" });
      setTemplates((prev) => prev.filter((t) => t.id !== id));
      setDeletingId(null);
    } catch {
      // ignore
    }
  }, []);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          backgroundColor: "var(--theme-primary)",
          color: "var(--theme-text-primary)",
          maxHeight: "70vh",
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
        GeoPDF Templates
        <IconButton
          size="small"
          onClick={onClose}
          sx={{ color: "var(--theme-text-primary)" }}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers sx={{ borderColor: "rgba(255,255,255,0.1)" }}>
        <Button
          variant="outlined"
          size="small"
          onClick={() => onEditTemplate(null)}
          sx={{
            color: "var(--theme-accent)",
            borderColor: "var(--theme-accent)",
            mb: 1.5,
            "&:hover": {
              borderColor: "var(--theme-accent)",
              backgroundColor:
                "color-mix(in srgb, var(--theme-accent) 12%, transparent)",
            },
          }}
        >
          + New Template
        </Button>

        <div className={classes.templateList}>
          {templates.length === 0 && (
            <div className={classes.emptyMessage}>No saved templates</div>
          )}
          {templates.map((t) => (
            <div key={t.id} className={classes.templateItem}>
              <span className={classes.templateName}>{t.name}</span>
              <span className={classes.templateDate}>
                {relativeDate(t.updatedAt)}
              </span>
              {deletingId === t.id ? (
                <div className={classes.confirmRow}>
                  <span className={classes.confirmText}>Delete?</span>
                  <button
                    className={classes.confirmYes}
                    onClick={() => handleDelete(t.id)}
                  >
                    Yes
                  </button>
                  <button
                    className={classes.confirmNo}
                    onClick={() => setDeletingId(null)}
                  >
                    No
                  </button>
                </div>
              ) : (
                <>
                  <button
                    className={classes.actionButton}
                    onClick={() => onEditTemplate(t)}
                  >
                    Edit
                  </button>
                  <button
                    className={classes.deleteButton}
                    onClick={() => setDeletingId(t.id)}
                  >
                    Delete
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} sx={{ color: "var(--theme-text-primary)" }}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default GeoPdfTemplatesDialog;
