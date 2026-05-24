import { useState, useEffect, useCallback } from "react";
import classes from "./GeoPdfsPanel.module.css";
import { apiFetch } from "../../../canyonUtils";
import { messageFromError } from "../../../errors/messageFromError";
import { useToast } from "../../feedback/ToastProvider";
import type { GeoPdfTemplate } from "../../dialogs/GeoPdfDialog";

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

function GeoPdfsPanel({
  onOpenGeoPdf,
  onOpenGeoPdfWithTemplate,
  onEditGeoPdfTemplate,
  onCreateGeoPdfTemplate,
  refetchTrigger,
}: {
  onOpenGeoPdf: () => void;
  onOpenGeoPdfWithTemplate: (id: string) => void;
  onEditGeoPdfTemplate: (template: GeoPdfTemplate) => void;
  onCreateGeoPdfTemplate: () => void;
  refetchTrigger: number;
}) {
  const toast = useToast();
  const [templates, setTemplates] = useState<GeoPdfTemplate[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [fetchCount] = useState(0);

  const loadTemplates = useCallback(async () => {
    try {
      const list = await apiFetch<GeoPdfTemplate[]>("/geo-pdf-templates");
      setTemplates(list);
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, "Couldn't load GeoPDF templates."));
    }
  }, [toast]);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates, fetchCount, refetchTrigger]);

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await apiFetch(`/geo-pdf-templates/${id}`, { method: "DELETE" });
        setTemplates((prev) => prev.filter((t) => t.id !== id));
        setDeletingId(null);
      } catch (err) {
        console.error(err);
        toast.error(messageFromError(err, "Couldn't delete template. Please try again."));
      }
    },
    [toast],
  );

  return (
    <div className={classes.root}>
      <button className={classes.primaryButton} onClick={onOpenGeoPdf}>
        Download Area as GeoPDF
      </button>
      <button className={classes.outlineButton} onClick={onCreateGeoPdfTemplate}>
        + Create Template
      </button>

      {templates.length > 0 && (
        <>
          <div className={classes.sectionLabel}>Templates</div>
          <div className={classes.templateList}>
            {templates.map((t) => (
              <div key={t.id} className={classes.templateItem}>
                <button
                  className={classes.templateName}
                  onClick={() => onOpenGeoPdfWithTemplate(t.id)}
                  title="Open download dialog with this template"
                >
                  {t.name}
                </button>
                <span className={classes.templateDate}>{relativeDate(t.updatedAt)}</span>
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
                      onClick={() => onEditGeoPdfTemplate(t)}
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
        </>
      )}
    </div>
  );
}

export default GeoPdfsPanel;
