import { useState, useEffect, useCallback } from "react";
import type { ReactNode } from "react";
import { ChevronDown, Download, Trash2 } from "lucide-react";
import classes from "./GeoPdfsPanel.module.css";
import { apiFetch, useGeoPdfJobs, deleteGeoPdfJob } from "../../../canyonUtils";
import { messageFromError } from "../../../errors/messageFromError";
import { useToast } from "../../feedback/ToastProvider";
import ConfirmDialog from "../../dialogs/ConfirmDialog";
import type { GeoPdfTemplate } from "../../dialogs/GeoPdfDialog";

/** Descriptor for the shared confirm dialog — one delete kind at a time. */
type PendingDelete = {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  onConfirm: () => Promise<void> | void;
};

function formatBytes(n: number | null): string {
  if (n === null) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function GeoPdfsPanel({
  onOpenGeoPdf,
  onOpenGeoPdfWithTemplate,
  onEditGeoPdfTemplate,
  onCreateGeoPdfTemplate,
  refetchTrigger,
  geoPdfJobsRefetch,
}: {
  onOpenGeoPdf: () => void;
  onOpenGeoPdfWithTemplate: (id: string) => void;
  onEditGeoPdfTemplate: (template: GeoPdfTemplate) => void;
  onCreateGeoPdfTemplate: () => void;
  refetchTrigger: number;
  geoPdfJobsRefetch: number;
}) {
  const toast = useToast();
  const [templates, setTemplates] = useState<GeoPdfTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchCount] = useState(0);

  // Accordion state
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [jobsOpen, setJobsOpen] = useState(false);

  // Single shared delete-confirmation dialog, reused for templates and
  // generated GeoPDFs. `confirmBusy` disables the dialog while the action runs.
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const { jobs, loading: jobsLoading, error: jobsError, refetch: refetchJobs } = useGeoPdfJobs(true);

  useEffect(() => {
    if (geoPdfJobsRefetch > 0) refetchJobs();
  }, [geoPdfJobsRefetch, refetchJobs]);

  useEffect(() => {
    if (jobsError) toast.error(jobsError);
  }, [jobsError, toast]);

  const handleDeleteJob = useCallback(
    async (id: string) => {
      try {
        await deleteGeoPdfJob(id);
        refetchJobs();
      } catch (err) {
        console.error(err);
        toast.error(messageFromError(err, "Couldn't delete GeoPDF."));
      }
    },
    [refetchJobs, toast],
  );

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
      } catch (err) {
        console.error(err);
        toast.error(messageFromError(err, "Couldn't delete template. Please try again."));
      }
    },
    [toast],
  );

  // Runs the pending delete's action with the dialog in a busy state, then
  // closes the dialog. The handlers above swallow their own errors (toast), so
  // we always close on settle.
  const runConfirm = useCallback(async () => {
    if (!pendingDelete) return;
    setConfirmBusy(true);
    try {
      await pendingDelete.onConfirm();
    } finally {
      setConfirmBusy(false);
      setPendingDelete(null);
    }
  }, [pendingDelete]);

  return (
    <div className={classes.root}>
      <button className={classes.primaryButton} onClick={onOpenGeoPdf}>
        Download Area as GeoPDF
      </button>
      <button className={classes.outlineButton} onClick={onCreateGeoPdfTemplate}>
        + Create Template
      </button>

      <div className={classes.accordion}>
        <button
          className={classes.accordionHeader}
          onClick={() => setTemplatesOpen((v) => !v)}
          aria-expanded={templatesOpen}
        >
          <span>Templates ({templates.length})</span>
          <ChevronDown
            size={14}
            className={`${classes.chevron} ${templatesOpen ? classes.chevronOpen : ""}`}
          />
        </button>
        {templatesOpen && (
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

              <button
                className={classes.actionButton}
                onClick={() => onEditGeoPdfTemplate(t)}
              >
                Edit
              </button>
              <button
                className={classes.iconDeleteButton}
                onClick={() =>
                  setPendingDelete({
                    title: `Delete template “${t.name}”?`,
                    message:
                      "This template will be permanently deleted. This cannot be undone.",
                    onConfirm: () => handleDelete(t.id),
                  })
                }
                title="Delete template"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
        )}
      </div>

      <div className={classes.accordion}>
        <button
          className={classes.accordionHeader}
          onClick={() => setJobsOpen((v) => !v)}
          aria-expanded={jobsOpen}
        >
          <span>Generated PDFs ({jobs.length})</span>
          <ChevronDown
            size={14}
            className={`${classes.chevron} ${jobsOpen ? classes.chevronOpen : ""}`}
          />
        </button>
        {jobsOpen && (
          <div className={classes.accordionBody}>
            {jobsLoading && jobs.length === 0 && (
              <div className={classes.emptyHint}>Loading…</div>
            )}
            {!jobsLoading && jobs.length === 0 && (
              <div className={classes.emptyHint}>No GeoPDFs generated yet.</div>
            )}
            {jobs.map((job) => {
              const isComplete = job.status === "completed" && !!job.downloadUrl;
              const isFailed = job.status === "failed";
              const isInProgress = job.status === "queued" || job.status === "running";
              const statusLabel =
                job.status === "queued" ? "Queued"
                : job.status === "running" ? "Generating…"
                : job.status === "failed" ? "Failed"
                : "Ready";
              const metaParts = [
                statusLabel,
                ...(job.resultBytes !== null ? [formatBytes(job.resultBytes)] : []),
                timeAgo(job.createdAt),
              ];
              // Include the time of day: the API view exposes no extent/paper/
              // scale metadata, so untitled same-day rows were otherwise
              // indistinguishable "GeoPDF · 9 Jul 2026" repeats (GEOPDF-2).
              // createdAt is a true timestamp — local-TZ display is correct.
              const dateStr = new Date(job.createdAt).toLocaleString(undefined, {
                day: "numeric",
                month: "short",
                year: "numeric",
                hour: "numeric",
                minute: "2-digit",
              });
              return (
                <div key={job.id} className={classes.jobItem}>
                  <div className={classes.jobMain}>
                    <span className={classes.jobLabel}>
                      {job.title ? (
                        <>
                          <span className={classes.jobTitle}>{job.title}</span>
                          <span className={classes.jobDate}>· {dateStr}</span>
                        </>
                      ) : (
                        <>GeoPDF · {dateStr}</>
                      )}
                    </span>
                    <span
                      className={isFailed ? classes.jobMetaFailed : classes.jobMeta}
                      title={isFailed && job.errorMessage ? job.errorMessage : undefined}
                    >
                      {metaParts.join(" · ")}
                    </span>
                  </div>
                  {isComplete && (
                    <a
                      className={classes.iconDownloadButton}
                      href={job.downloadUrl!}
                      download
                      title="Download"
                    >
                      <Download size={14} />
                    </a>
                  )}
                  {!isInProgress && (
                    <button
                      className={classes.iconDeleteButton}
                      onClick={() =>
                        setPendingDelete({
                          title: `Delete GeoPDF · ${dateStr}?`,
                          message:
                            "This generated GeoPDF will be permanently deleted. This cannot be undone.",
                          onConfirm: () => handleDeleteJob(job.id),
                        })
                      }
                      title="Delete"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={pendingDelete != null}
        title={pendingDelete?.title ?? ""}
        message={pendingDelete?.message}
        confirmLabel={pendingDelete?.confirmLabel}
        busy={confirmBusy}
        onConfirm={runConfirm}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
}

export default GeoPdfsPanel;
