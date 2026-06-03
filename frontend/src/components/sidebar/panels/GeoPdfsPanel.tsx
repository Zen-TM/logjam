import { useState, useEffect, useCallback } from "react";
import { LinearProgress } from "@mui/material";
import classes from "./GeoPdfsPanel.module.css";
import { apiFetch } from "../../../canyonUtils";
import { messageFromError } from "../../../errors/messageFromError";
import { useToast } from "../../feedback/ToastProvider";
import type { GeoPdfTemplate, GeoPdfJob } from "../../dialogs/GeoPdfDialog";


function GeoPdfsPanel({
  onOpenGeoPdf,
  onOpenGeoPdfWithTemplate,
  onEditGeoPdfTemplate,
  onCreateGeoPdfTemplate,
  refetchTrigger,
  geoPdfJobs = [],
}: {
  onOpenGeoPdf: () => void;
  onOpenGeoPdfWithTemplate: (id: string) => void;
  onEditGeoPdfTemplate: (template: GeoPdfTemplate) => void;
  onCreateGeoPdfTemplate: () => void;
  refetchTrigger: number;
  geoPdfJobs?: GeoPdfJob[];
}) {
  const toast = useToast();
  const [templates, setTemplates] = useState<GeoPdfTemplate[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchCount] = useState(0);

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const list = await apiFetch<GeoPdfTemplate[]>("/geo-pdf-templates");
      setTemplates(list);
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, "Couldn't load GeoPDF templates."));
    } finally {
      setLoading(false);
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
      {geoPdfJobs.length > 0 && (
        <div className={classes.activeSection}>
          <div className={classes.sectionLabel}>Active</div>
          {geoPdfJobs.map((job) => (
            <div key={job.id} className={classes.activeJobRow}>
              <div className={classes.activeJobName}>{job.configSummary}</div>
              <LinearProgress
                variant="indeterminate"
                sx={{
                  height: 3,
                  borderRadius: 2,
                  backgroundColor: "rgba(255,255,255,0.1)",
                  "& .MuiLinearProgress-bar": { backgroundColor: "var(--theme-accent)" },
                }}
              />
              <div className={classes.activeJobStatus}>
                {job.status === "submitting" ? "Submitting…" : "Generating…"}
              </div>
            </div>
          ))}
        </div>
      )}
      <button className={classes.primaryButton} onClick={onOpenGeoPdf}>
        Download Area as GeoPDF
      </button>
      <button className={classes.outlineButton} onClick={onCreateGeoPdfTemplate}>
        + Create Template
      </button>

      <div className={classes.accordion}>
        <div className={classes.accordionHeader}>
          Templates ({templates.length})
        </div>
        <div className={classes.accordionBody}>
          {loading ? (
            <div className={classes.emptyHint}>Loading templates…</div>
          ) : (
            templates.length === 0 && (
              <div className={classes.emptyHint}>No templates yet.</div>
            )
          )}
          {templates.map((t) => (
            <div key={t.id} className={classes.templateItem}>
              <button
                className={classes.templateName}
                onClick={() => onOpenGeoPdfWithTemplate(t.id)}
                title="Open download dialog with this template"
              >
                {t.name}
              </button>

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
      </div>
    </div>
  );
}

export default GeoPdfsPanel;
