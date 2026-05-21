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
import LockIcon from "@mui/icons-material/Lock";
import { apiFetch } from "../../canyonUtils";
import { messageFromError } from "../../errors/messageFromError";
import { ErrorBanner } from "../feedback/ErrorBanner";
import type { TopoTemplate } from "./TopoDialog";
import classes from "./GeoPdfTemplatesDialog.module.css";

function relativeDate(iso: string | null): string {
  if (!iso) return "";
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

function TopoTemplatesDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [templates, setTemplates] = useState<TopoTemplate[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await apiFetch<TopoTemplate[]>("/topo-templates");
      setTemplates(list);
    } catch (err) {
      console.error(err);
      setError(messageFromError(err, "Couldn't load templates."));
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setError(null);
    void refresh();
  }, [open, refresh]);

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await apiFetch(`/topo-templates/${id}`, { method: "DELETE" });
        setTemplates((prev) => prev.filter((t) => t.id !== id));
        setDeletingId(null);
      } catch (err) {
        console.error(err);
        setError(messageFromError(err, "Couldn't delete template. Please try again."));
      }
    },
    [],
  );

  const handleRename = useCallback(
    async (id: string) => {
      const next = renameDraft.trim();
      if (!next) return;
      try {
        await apiFetch(`/topo-templates/${id}`, {
          method: "PATCH",
          body: { name: next },
        });
        setRenamingId(null);
        setRenameDraft("");
        await refresh();
      } catch (err) {
        console.error(err);
        setError(messageFromError(err, "Couldn't rename template."));
      }
    },
    [renameDraft, refresh],
  );

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
        Topo Templates
        <IconButton
          size="small"
          onClick={onClose}
          sx={{ color: "var(--theme-text-primary)" }}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers sx={{ borderColor: "rgba(255,255,255,0.1)" }}>
        {error && <ErrorBanner message={error} />}
        <div className={classes.templateList}>
          {templates.length === 0 && (
            <div className={classes.emptyMessage}>No saved templates</div>
          )}
          {templates.map((t) => (
            <div key={t.id} className={classes.templateItem}>
              {t.isSystem && (
                <LockIcon fontSize="small" sx={{ opacity: 0.6 }} />
              )}
              {renamingId === t.id ? (
                <input
                  autoFocus
                  className={classes.templateName}
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onBlur={() => handleRename(t.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRename(t.id);
                    if (e.key === "Escape") setRenamingId(null);
                  }}
                  style={{
                    background: "transparent",
                    border: "1px solid var(--theme-accent)",
                    color: "var(--theme-text-primary)",
                    padding: "2px 6px",
                  }}
                />
              ) : (
                <span className={classes.templateName}>{t.name}</span>
              )}
              <span className={classes.templateDate}>
                {t.isSystem ? "system" : relativeDate(t.updatedAt)}
              </span>
              {t.isSystem ? null : deletingId === t.id ? (
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
                    onClick={() => {
                      setRenamingId(t.id);
                      setRenameDraft(t.name);
                    }}
                  >
                    Rename
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

export default TopoTemplatesDialog;
