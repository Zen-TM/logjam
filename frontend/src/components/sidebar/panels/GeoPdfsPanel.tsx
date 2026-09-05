import { useState, useEffect, useCallback, useMemo } from "react";
import type { ReactNode } from "react";
import { ChevronDown, Download, Share2, Trash2, X } from "lucide-react";
import classes from "./GeoPdfsPanel.module.css";
import {
  apiFetch,
  useGeoPdfJobs,
  deleteGeoPdfJob,
  getEntityShares,
  shareEntityWith,
  unshareEntityWith,
  type TFriend,
} from "../../../canyonUtils";
import { messageFromError } from "../../../errors/messageFromError";
import { useToast } from "../../feedback/ToastProvider";
import { JobRibbonStack, JobRibbon, minutesEta } from "../../feedback/JobRibbon";
import ConfirmDialog from "../../dialogs/ConfirmDialog";
import ShareDialog from "../../dialogs/ShareDialog";
import RemoveSharedButton from "../../common/RemoveSharedButton";
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

// Timestamped fallback label for an untitled GeoPDF job — e.g.
// "GeoPDF · 9 Jul 2026, 3:41 pm". createdAt is a true timestamp (not a
// date-only value) so local-TZ display is correct without "timeZone: UTC".
function geoPdfDateStr(createdAt: string): string {
  return new Date(createdAt).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function GeoPdfsPanel({
  onOpenGeoPdf,
  onOpenGeoPdfWithTemplate,
  onEditGeoPdfTemplate,
  onCreateGeoPdfTemplate,
  refetchTrigger,
  geoPdfJobsRefetch,
  friends,
}: {
  onOpenGeoPdf: () => void;
  onOpenGeoPdfWithTemplate: (id: string) => void;
  onEditGeoPdfTemplate: (template: GeoPdfTemplate) => void;
  onCreateGeoPdfTemplate: () => void;
  refetchTrigger: number;
  geoPdfJobsRefetch: number;
  /** Friends a generated GeoPDF can be shared with. */
  friends: TFriend[];
}) {
  const toast = useToast();
  const [templates, setTemplates] = useState<GeoPdfTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchCount] = useState(0);

  // Accordion state
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [jobsOpen, setJobsOpen] = useState(false);

  // In-progress/failed job ribbons: show first 3, rest behind disclosure.
  const [showAllActive, setShowAllActive] = useState(false);

  // Single shared delete-confirmation dialog, reused for templates and
  // generated GeoPDFs. `confirmBusy` disables the dialog while the action runs.
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  // Non-null = the GeoPDF whose share dialog is open, carrying the same label
  // the row shows so the dialog title matches what was clicked.
  const [shareJob, setShareJob] = useState<{ id: string; label: string } | null>(
    null,
  );
  const { jobs, total: jobsTotal, loading: jobsLoading, error: jobsError, refetch: refetchJobs } = useGeoPdfJobs(true);

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

  // Ribbons for in-progress/failed jobs — completed jobs live only in the
  // Generated PDFs accordion below. `jobs` already comes createdAt desc from
  // GET /geo-pdf (orderBy: { createdAt: "desc" }), and filtering preserves
  // that order, so no re-sort is needed here.
  const activeJobRibbons = useMemo(
    () =>
      jobs
        .filter((job) => job.status !== "completed")
        .map((job) => {
          const failed = job.status === "failed";
          const etaLabel =
            job.status === "queued"
              ? "Queued"
              : job.status === "running"
                ? minutesEta(job.estimatedSeconds, "Generating…")
                : "Failed";
          return {
            key: job.id,
            props: {
              name: job.title ?? `GeoPDF · ${geoPdfDateStr(job.createdAt)}`,
              chip: "GEOPDF",
              etaLabel,
              failed,
              errorMessage: job.errorMessage,
              onDismiss: failed ? () => void handleDeleteJob(job.id) : undefined,
            },
          };
        }),
    [jobs, handleDeleteJob],
  );
  const activeRibbonsVisible = showAllActive ? activeJobRibbons : activeJobRibbons.slice(0, 3);
  const hasMoreActiveRibbons = !showAllActive && activeJobRibbons.length > 3;

  // Generated PDFs accordion shows completed rows only — in-progress/failed
  // ones render as ribbons above.
  const completedJobs = useMemo(
    () => jobs.filter((job) => job.status === "completed"),
    [jobs],
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
      {/* In-progress/failed GeoPDF jobs — full-width ribbon(s) flush with
          panel header */}
      {activeJobRibbons.length > 0 && (
        <JobRibbonStack
          showAllCount={hasMoreActiveRibbons ? activeJobRibbons.length : undefined}
          onShowAll={() => setShowAllActive(true)}
        >
          {activeRibbonsVisible.map((entry) => (
            <JobRibbon key={entry.key} {...entry.props} />
          ))}
        </JobRibbonStack>
      )}

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
          <span>Generated PDFs ({completedJobs.length})</span>
          <ChevronDown
            size={14}
            className={`${classes.chevron} ${jobsOpen ? classes.chevronOpen : ""}`}
          />
        </button>
        {jobsOpen && (
          <div className={classes.accordionBody}>
            {/* The server caps the GeoPDF list; warn when it's a truncated view
                of the true total so older PDFs aren't silently hidden (UX-002). */}
            {jobsTotal != null && jobsTotal > jobs.length && (
              <div className={classes.truncationNote}>
                Showing your {jobs.length} most recent GeoPDFs of {jobsTotal}.
                Older ones aren&rsquo;t loaded.
              </div>
            )}
            {jobsLoading && completedJobs.length === 0 && (
              <div className={classes.emptyHint}>Loading…</div>
            )}
            {!jobsLoading && completedJobs.length === 0 && (
              <div className={classes.emptyHint}>No GeoPDFs generated yet.</div>
            )}
            {completedJobs.map((job) => {
              const metaParts = [
                ...(job.resultBytes !== null ? [formatBytes(job.resultBytes)] : []),
                timeAgo(job.createdAt),
              ];
              // Include the time of day: the API view exposes no extent/paper/
              // scale metadata, so untitled same-day rows were otherwise
              // indistinguishable "GeoPDF · 9 Jul 2026" repeats (GEOPDF-2).
              const dateStr = geoPdfDateStr(job.createdAt);
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
                    <span className={classes.jobMeta}>{metaParts.join(" · ")}</span>
                  </div>
                  {job.downloadUrl && (
                    <a
                      className={classes.iconDownloadButton}
                      href={job.downloadUrl}
                      download
                      title="Download"
                    >
                      <Download size={14} />
                    </a>
                  )}
                  {/* Owner-only. A GeoPDF shared with you is readable and
                      downloadable but not yours to share on or delete, and the
                      API answers both with 403 — so the buttons are withheld
                      rather than offered and refused (the rule RouteDetailPanel
                      already follows). */}
                  {job.syncRole === "owner" && (
                    <>
                      <button
                        className={classes.iconDownloadButton}
                        onClick={() =>
                          setShareJob({ id: job.id, label: job.title ?? `GeoPDF · ${dateStr}` })
                        }
                        title="Share with a friend"
                      >
                        <Share2 size={14} />
                      </button>
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
                    </>
                  )}
                  {/* The recipient's half of that pair. A GeoPDF has no canyon
                      to inherit visibility from, so a row that is not yours is
                      always yours to remove. */}
                  {job.syncRole !== "owner" && (
                    <RemoveSharedButton
                      kindLabel="GeoPDF"
                      itemName={job.title ?? `GeoPDF · ${dateStr}`}
                      className={classes.iconDownloadButton}
                      title="Remove this shared GeoPDF"
                      remove={() => unshareEntityWith("geoPdfJob", job.id, "me")}
                      onRemoved={refetchJobs}
                    >
                      <X size={14} />
                    </RemoveSharedButton>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {shareJob && (
        <ShareDialog
          title={`Share ${shareJob.label}`}
          blurb={
            <>
              Recipients can view and download this GeoPDF. They cannot delete
              it, and you can unshare at any time.
            </>
          }
          friends={friends}
          open
          onClose={() => setShareJob(null)}
          listShares={() => getEntityShares("geoPdfJob", shareJob.id)}
          share={(userId) => shareEntityWith("geoPdfJob", shareJob.id, userId)}
          unshare={(userId) => unshareEntityWith("geoPdfJob", shareJob.id, userId)}
        />
      )}

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
