import { useState, useEffect, useCallback, useMemo } from "react";
import type { ReactNode } from "react";
import { Switch } from "@mui/material";
import { ChevronDown, Lock, Download, Share2, Trash2 } from "lucide-react";
import classes from "./LidarPanel.module.css";
import {
  apiFetch,
  deleteTopoExport,
  getEntityShares,
  shareEntityWith,
  unshareEntityWith,
  type TFriend,
} from "../../../canyonUtils";
import { messageFromError } from "../../../errors/messageFromError";
import { useToast } from "../../feedback/ToastProvider";
import { JobRibbonStack, JobRibbon, minutesEta } from "../../feedback/JobRibbon";
import type { TopoJob, TopoTemplate, GeoJsonPolygonal } from "../../dialogs/TopoDialog";
import { fetchTopoTemplates } from "../../dialogs/topoTemplatesFetch";
import type { CompletedTopoJob } from "../../../topoLayerTypes";
import TopoTemplateEditDialog from "../../dialogs/TopoTemplateEditDialog";
import TopoExportDialog from "../../dialogs/TopoExportDialog";
import VectorContoursForm from "./vectorStyles/VectorContoursForm";
import VectorFeaturesForm from "./vectorStyles/VectorFeaturesForm";
import VectorLabelSizeForm from "./vectorStyles/VectorLabelSizeForm";
import ConfirmDialog from "../../dialogs/ConfirmDialog";
import ShareDialog from "../../dialogs/ShareDialog";
import type { VectorStyleSettings, TopoExportJobView } from "@logjam/shared";

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

function jobEtaLabel(job: TopoJob): string {
  if (job.status === "uploading") return "Uploading…";
  if (job.status === "pending") return "Queued";
  if (job.status === "processing") {
    if (job.estimatedSeconds != null && job.estimatedSeconds > 0) {
      const mins = Math.ceil(job.estimatedSeconds / 60);
      return `~${mins} min`;
    }
    return "Processing…";
  }
  if (job.status === "failed") return "Failed";
  return "";
}

const switchSx = (color: string) => ({
  "& .MuiSwitch-switchBase.Mui-checked": { color },
  "& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track": {
    backgroundColor: color,
  },
});

function LidarPanel({
  activeTopoJobs,
  completedTopoJobs,
  friends,
  topoExports,
  topoExportsTotal,
  onRefetchTopoExports,
  lidarJobToggles,
  setLidarJobToggles,
  onOpenTopo,
  onTopoFlyTarget,
  onRefetchCompletedTopoJobs,
  onDismissActiveJob,
  onOpenTopoWithTemplate,
  onQuotaChanged,
  vectorStyle,
  onVectorStyleChange,
  templateRefetchTrigger,
}: {
  activeTopoJobs: TopoJob[];
  completedTopoJobs: CompletedTopoJob[];
  /** Friends a completed topo can be shared with. */
  friends: TFriend[];
  topoExports: TopoExportJobView[];
  topoExportsTotal: number | null;
  onRefetchTopoExports: () => void;
  lidarJobToggles: Record<string, boolean>;
  setLidarJobToggles: (
    v: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>),
  ) => void;
  onOpenTopo: () => void;
  onTopoFlyTarget: (footprint: GeoJsonPolygonal) => void;
  onRefetchCompletedTopoJobs: () => void;
  onDismissActiveJob: (jobId: string) => void;
  onOpenTopoWithTemplate: (templateId: string) => void;
  onQuotaChanged: () => void;
  vectorStyle: VectorStyleSettings | null;
  onVectorStyleChange: (next: VectorStyleSettings) => void;
  templateRefetchTrigger: number;
}) {
  const toast = useToast();

  // Templates
  const [templates, setTemplates] = useState<TopoTemplate[]>([]);
  const [templateFetchCount, setTemplateFetchCount] = useState(0);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [templateEditOpen, setTemplateEditOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<TopoTemplate | null>(null);

  // Single shared delete-confirmation dialog, reused for templates, topo jobs,
  // and exports. `confirmBusy` disables the dialog while the action runs.
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  // Non-null = the topo whose share dialog is open, with the label already
  // resolved (the row computes it from name-or-date and we want the same words).
  const [shareJob, setShareJob] = useState<{ id: string; label: string } | null>(
    null,
  );
  const [confirmBusy, setConfirmBusy] = useState(false);

  // Vector styles accordion — controlled by App; edits apply live to the map
  // (optimistic) and the server PUT is debounced inside useLiveVectorStyle.
  const [vectorStylesOpen, setVectorStylesOpen] = useState(false);
  const [vectorStyleTab, setVectorStyleTab] = useState<"contours" | "features">("contours");

  // Topo jobs accordion
  const [jobsOpen, setJobsOpen] = useState(false);

  // Active jobs: show first 3, rest behind disclosure
  const [showAllActive, setShowAllActive] = useState(false);

  // Export dialog — one open at a time, keyed by job
  const [exportJob, setExportJob] = useState<CompletedTopoJob | null>(null);

  // Exports accordion
  const [exportsOpen, setExportsOpen] = useState(false);

  // Resolve an export's source job to a display name. The source job may have
  // been deleted since the export was created.
  const jobNameById = useMemo(() => {
    const byId = new Map<string, string>();
    for (const job of completedTopoJobs) {
      const dateStr = new Date(job.createdAt).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
      byId.set(job.jobId, job.name ?? dateStr);
    }
    return byId;
  }, [completedTopoJobs]);

  // Exports accordion shows completed rows only — in-progress/failed ones
  // render as ribbons above.
  const completedExports = useMemo(
    () => topoExports.filter((ex) => ex.status === "completed"),
    [topoExports],
  );

  const loadTemplates = useCallback(async () => {
    try {
      // Concurrent-duplicate-safe fetch shared with TopoDialog (TOPO-6).
      const list = await fetchTopoTemplates();
      setTemplates(list);
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, "Couldn't load topo templates."));
    }
  }, [toast]);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates, templateFetchCount, templateRefetchTrigger]);

  // Templates can be created outside this panel (TopoDialog's inline "Save as
  // template") — refresh whenever the accordion is opened so the list is never
  // a reload behind (TOPO-1).
  useEffect(() => {
    if (templatesOpen) void loadTemplates();
  }, [templatesOpen, loadTemplates]);

  const handleDeleteTemplate = useCallback(
    async (id: string) => {
      try {
        await apiFetch(`/topo-templates/${id}`, { method: "DELETE" });
        setTemplates((prev) => prev.filter((t) => t.id !== id));
      } catch (err) {
        console.error(err);
        toast.error(messageFromError(err, "Couldn't delete template. Please try again."));
      }
    },
    [toast],
  );

  const handleDeleteJob = useCallback(
    async (jobId: string) => {
      try {
        await apiFetch(`/topo-jobs/${jobId}`, { method: "DELETE" });
        setLidarJobToggles((prev) => {
          const next = { ...prev };
          delete next[jobId];
          return next;
        });
        onRefetchCompletedTopoJobs();
        onQuotaChanged();
      } catch (err) {
        console.error(err);
        toast.error(messageFromError(err, "Couldn't delete LiDAR topo. Please try again."));
      }
    },
    [toast, setLidarJobToggles, onRefetchCompletedTopoJobs, onQuotaChanged],
  );

  const handleDeleteExport = useCallback(
    async (id: string) => {
      try {
        await deleteTopoExport(id);
        onRefetchTopoExports();
        onQuotaChanged();
      } catch (err) {
        console.error(err);
        toast.error(messageFromError(err, "Couldn't delete export."));
      }
    },
    [onRefetchTopoExports, onQuotaChanged, toast],
  );

  // Ribbon dismiss for a failed export — deletes the row outright (no
  // confirm) since a failed export holds no result bytes, so unlike
  // handleDeleteExport there's no quota to refresh.
  const handleDismissExport = useCallback(
    async (id: string) => {
      try {
        await deleteTopoExport(id);
        onRefetchTopoExports();
      } catch (err) {
        console.error(err);
        toast.error(messageFromError(err, "Couldn't dismiss export."));
      }
    },
    [onRefetchTopoExports, toast],
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

  // Merged ribbon list: in-progress/failed topo jobs + in-progress/failed
  // exports (completed exports live only in the Exports accordion below),
  // newest first — matches the previous topo-only prepend ordering.
  const jobRibbons = useMemo(() => {
    const topoEntries = activeTopoJobs.map((job) => {
      const failed = job.status === "failed";
      return {
        key: `topo-${job.id}`,
        createdAt: job.createdAt,
        props: {
          name: job.name ?? "Unnamed",
          chip: "TOPO",
          etaLabel: jobEtaLabel(job),
          failed,
          onDismiss: failed ? () => onDismissActiveJob(job.id) : undefined,
        },
      };
    });
    const exportEntries = topoExports
      .filter((ex) => ex.status !== "completed")
      .map((ex) => {
        const failed = ex.status === "failed";
        const etaLabel =
          ex.status === "queued"
            ? "Queued"
            : ex.status === "running"
              ? minutesEta(ex.estimatedSeconds, "Exporting…")
              : "Failed";
        return {
          key: `export-${ex.id}`,
          createdAt: ex.createdAt,
          props: {
            name: jobNameById.get(ex.sourceJobIds[0]) ?? "Deleted job",
            chip: `EXPORT · ${ex.format.toUpperCase()}`,
            etaLabel,
            failed,
            errorMessage: ex.errorMessage,
            onDismiss: failed ? () => void handleDismissExport(ex.id) : undefined,
          },
        };
      });
    return [...topoEntries, ...exportEntries].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }, [activeTopoJobs, topoExports, jobNameById, onDismissActiveJob, handleDismissExport]);

  // Ribbons with cap-and-disclose
  const ribbonsVisible = showAllActive ? jobRibbons : jobRibbons.slice(0, 3);
  const hasMoreRibbons = !showAllActive && jobRibbons.length > 3;

  return (
    <div className={classes.root}>
      {/* In-progress/failed topo jobs + exports — full-width ribbon(s) flush
          with panel header */}
      {jobRibbons.length > 0 && (
        <JobRibbonStack
          showAllCount={hasMoreRibbons ? jobRibbons.length : undefined}
          onShowAll={() => setShowAllActive(true)}
        >
          {ribbonsVisible.map((entry) => (
            <JobRibbon key={entry.key} {...entry.props} />
          ))}
        </JobRibbonStack>
      )}

      {/* Primary actions */}
      <button className={classes.primaryButton} onClick={onOpenTopo}>
        Generate LiDAR Topo
      </button>
      <button
        className={classes.outlineButton}
        onClick={() => {
          setEditingTemplate(null);
          setTemplateEditOpen(true);
        }}
      >
        + Create Template
      </button>

      {/* Templates accordion */}
      <div className={classes.accordion}>
        <button
          className={classes.accordionHeader}
          onClick={() => setTemplatesOpen((v) => !v)}
          aria-expanded={templatesOpen}
        >
          {/* Count everything the list renders, including the system Default
              row, so the header can't say "(0)" above a non-empty list (TOPO-5). */}
          <span>Templates ({templates.length})</span>
          <ChevronDown
            size={14}
            className={`${classes.chevron} ${templatesOpen ? classes.chevronOpen : ""}`}
          />
        </button>
        {templatesOpen && (
          <div className={classes.accordionBody}>
            {templates.length === 0 && (
              <div className={classes.emptyHint}>No templates yet.</div>
            )}
            {templates.map((t) => (
              <div key={t.id} className={classes.templateItem}>
                {t.isSystem && <Lock size={12} className={classes.lockIcon} />}
                <button
                  className={classes.templateName}
                  onClick={() => onOpenTopoWithTemplate(t.id)}
                  title="Open generate dialog with this template"
                >
                  {t.name}
                </button>

                {!t.isSystem && (
                  <>
                    <button
                      className={classes.actionButton}
                      onClick={() => {
                        setEditingTemplate(t);
                        setTemplateEditOpen(true);
                      }}
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
                          onConfirm: () => handleDeleteTemplate(t.id),
                        })
                      }
                      title="Delete template"
                    >
                      <Trash2 size={14} />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Vector styles accordion */}
      <div className={classes.accordion}>
        <button
          className={classes.accordionHeader}
          onClick={() => setVectorStylesOpen((v) => !v)}
          aria-expanded={vectorStylesOpen}
        >
          <span>Vector styles</span>
          <ChevronDown
            size={14}
            className={`${classes.chevron} ${vectorStylesOpen ? classes.chevronOpen : ""}`}
          />
        </button>
        {vectorStylesOpen && (
          <div className={classes.accordionBody}>
            {vectorStyle !== null && (
              <VectorLabelSizeForm
                value={vectorStyle.labelScale ?? 1}
                onChange={(next) =>
                  onVectorStyleChange({ ...vectorStyle, labelScale: next })
                }
              />
            )}
            <div className={classes.vectorStyleTabs}>
              <button
                className={`${classes.vectorStyleTab} ${vectorStyleTab === "contours" ? classes.vectorStyleTabActive : ""}`}
                onClick={() => setVectorStyleTab("contours")}
              >
                Contours
              </button>
              <button
                className={`${classes.vectorStyleTab} ${vectorStyleTab === "features" ? classes.vectorStyleTabActive : ""}`}
                onClick={() => setVectorStyleTab("features")}
              >
                Features
              </button>
            </div>
            {vectorStyle === null ? (
              <div className={classes.emptyHint}>Loading…</div>
            ) : vectorStyleTab === "contours" ? (
              <VectorContoursForm
                value={vectorStyle.contours}
                onChange={(next) =>
                  onVectorStyleChange({ ...vectorStyle, contours: next })
                }
              />
            ) : (
              <VectorFeaturesForm
                value={vectorStyle.features}
                onChange={(next) =>
                  onVectorStyleChange({ ...vectorStyle, features: next })
                }
              />
            )}
          </div>
        )}
      </div>

      {/* My LiDAR Topos accordion */}
      <div className={classes.accordion}>
        <button
          className={classes.accordionHeader}
          onClick={() => setJobsOpen((v) => !v)}
          aria-expanded={jobsOpen}
        >
          <span>My LiDAR Topos ({completedTopoJobs.length})</span>
          <ChevronDown
            size={14}
            className={`${classes.chevron} ${jobsOpen ? classes.chevronOpen : ""}`}
          />
        </button>
        {jobsOpen && (
          <div className={classes.accordionBody}>
            {completedTopoJobs.length === 0 && (
              <div className={classes.emptyHint}>No completed topos yet.</div>
            )}
            {completedTopoJobs.map((job) => {
              const dateStr = new Date(job.createdAt).toLocaleDateString(undefined, {
                day: "numeric",
                month: "short",
                year: "numeric",
              });
              const label = job.name ?? dateStr;
              const subtitle = job.name ? dateStr : null;
              // A topo shared WITH this user is read-only: the API refuses the
              // write, so the UI must not offer it (same rule RouteDetailPanel
              // states for shared routes).
              const isOwner = job.syncRole === "owner";
              return (
                <div key={job.jobId} className={classes.jobItem}>
                  <Switch
                    size="small"
                    checked={lidarJobToggles[job.jobId] ?? true}
                    onChange={(_, v) =>
                      setLidarJobToggles((prev) => ({ ...prev, [job.jobId]: v }))
                    }
                    sx={switchSx("var(--theme-secondary)")}
                  />
                  <button
                    className={classes.jobName}
                    onClick={() => {
                      if (job.footprint) onTopoFlyTarget(job.footprint);
                    }}
                    title="Fly to this topo on map"
                  >
                    <span className={classes.jobLabel}>{label}</span>
                    {subtitle && (
                      <span className={classes.jobSubtitle}>{subtitle}</span>
                    )}
                  </button>
                  {/* Export is NOT owner-gated: a recipient can already see
                      the overlay, and POST /topo-exports accepts a shared
                      source job, creating the export under the recipient's own
                      account. Share/Delete below stay owner-only. */}
                  <button
                    className={classes.actionButton}
                    onClick={() => setExportJob(job)}
                    title="Export"
                  >
                    Export
                  </button>
                  {isOwner && (
                    <button
                      className={classes.actionButton}
                      onClick={() => setShareJob({ id: job.jobId, label })}
                      title="Share with a friend"
                    >
                      <Share2 size={14} />
                    </button>
                  )}
                  {isOwner && (
                    <button
                      className={classes.iconDeleteButton}
                      onClick={() =>
                        setPendingDelete({
                          title: `Delete “${label}”?`,
                          message:
                            "This LiDAR topo will be permanently deleted. This cannot be undone.",
                          onConfirm: () => handleDeleteJob(job.jobId),
                        })
                      }
                      title="Delete LiDAR topo"
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

      {/* Exports accordion — completed only; in-progress/failed exports
          render as ribbons above instead. */}
      <div className={classes.accordion}>
        <button
          className={classes.accordionHeader}
          onClick={() => setExportsOpen((v) => !v)}
          aria-expanded={exportsOpen}
        >
          <span>Exports ({completedExports.length})</span>
          <ChevronDown
            size={14}
            className={`${classes.chevron} ${exportsOpen ? classes.chevronOpen : ""}`}
          />
        </button>
        {exportsOpen && (
          <div className={classes.accordionBody}>
            {/* Matches the server-side TOPO_EXPORT_TTL_MS sweep (7 days). */}
            <div className={classes.emptyHint}>Exports are kept for 7 days.</div>
            {/* The server caps the exports list; warn when it's a truncated view
                of the true total so older exports aren't silently hidden (UX-002). */}
            {topoExportsTotal != null && topoExportsTotal > topoExports.length && (
              <div className={classes.truncationNote}>
                Showing your {topoExports.length} most recent exports of{" "}
                {topoExportsTotal}. Older ones aren&rsquo;t loaded.
              </div>
            )}
            {completedExports.length === 0 && (
              <div className={classes.emptyHint}>No exports yet.</div>
            )}
            {completedExports.map((ex) => {
              const jobLabel = jobNameById.get(ex.sourceJobIds[0]) ?? "Deleted job";
              const metaParts = [
                ex.format.toUpperCase(),
                ...(ex.resultBytes !== null ? [formatBytes(ex.resultBytes)] : []),
                timeAgo(ex.createdAt),
              ];
              return (
                <div key={ex.id} className={classes.exportItem}>
                  <div className={classes.exportMain}>
                    <span className={classes.exportLabel}>{jobLabel}</span>
                    <span className={classes.exportMeta}>{metaParts.join(" · ")}</span>
                  </div>
                  {ex.downloadUrl && (
                    <a
                      className={classes.iconDownloadButton}
                      href={ex.downloadUrl}
                      download
                      title="Download"
                    >
                      <Download size={14} />
                    </a>
                  )}
                  <button
                    className={classes.iconDeleteButton}
                    onClick={() =>
                      setPendingDelete({
                        title: `Delete export “${jobLabel}”?`,
                        message:
                          "This export will be permanently deleted. This cannot be undone.",
                        onConfirm: () => handleDeleteExport(ex.id),
                      })
                    }
                    title="Delete export"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <TopoTemplateEditDialog
        open={templateEditOpen}
        onClose={() => setTemplateEditOpen(false)}
        editingTemplate={editingTemplate}
        onSaved={() => setTemplateFetchCount((n) => n + 1)}
      />

      <TopoExportDialog
        open={exportJob !== null}
        onClose={() => setExportJob(null)}
        job={exportJob}
        onExportQueued={onRefetchTopoExports}
      />

      {shareJob && (
        <ShareDialog
          title={`Share ${shareJob.label}`}
          blurb={
            <>
              Recipients can view and download this LiDAR topo. They cannot
              delete or re-export it as their own, and you can unshare at any
              time.
            </>
          }
          friends={friends}
          open
          onClose={() => setShareJob(null)}
          listShares={() => getEntityShares("topoJob", shareJob.id)}
          share={(userId) => shareEntityWith("topoJob", shareJob.id, userId)}
          unshare={(userId) => unshareEntityWith("topoJob", shareJob.id, userId)}
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

export default LidarPanel;
