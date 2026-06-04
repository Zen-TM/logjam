import { useState, useEffect, useCallback, useMemo } from "react";
import { Switch, LinearProgress } from "@mui/material";
import { ChevronDown, Lock, X, Download, Trash2 } from "lucide-react";
import classes from "./LidarPanel.module.css";
import { apiFetch, deleteTopoExport } from "../../../canyonUtils";
import { messageFromError } from "../../../errors/messageFromError";
import { useToast } from "../../feedback/ToastProvider";
import type { TopoJob, TopoTemplate, GeoJsonPolygon } from "../../dialogs/TopoDialog";
import type { CompletedTopoJob } from "../../../topoLayerTypes";
import TopoTemplateEditDialog from "../../dialogs/TopoTemplateEditDialog";
import TopoExportDialog from "../../dialogs/TopoExportDialog";
import VectorContoursForm from "./vectorStyles/VectorContoursForm";
import VectorFeaturesForm from "./vectorStyles/VectorFeaturesForm";
import type { VectorStyleSettings, TopoExportJobView } from "@logjam/shared";


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
  topoExports,
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
}: {
  activeTopoJobs: TopoJob[];
  completedTopoJobs: CompletedTopoJob[];
  topoExports: TopoExportJobView[];
  onRefetchTopoExports: () => void;
  lidarJobToggles: Record<string, boolean>;
  setLidarJobToggles: (
    v: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>),
  ) => void;
  onOpenTopo: () => void;
  onTopoFlyTarget: (footprint: GeoJsonPolygon) => void;
  onRefetchCompletedTopoJobs: () => void;
  onDismissActiveJob: (jobId: string) => void;
  onOpenTopoWithTemplate: (templateId: string) => void;
  onQuotaChanged: () => void;
  vectorStyle: VectorStyleSettings | null;
  onVectorStyleChange: (next: VectorStyleSettings) => void;
}) {
  const toast = useToast();

  // Templates
  const [templates, setTemplates] = useState<TopoTemplate[]>([]);
  const [templateFetchCount, setTemplateFetchCount] = useState(0);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [templateEditOpen, setTemplateEditOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<TopoTemplate | null>(null);
  const [deletingTemplateId, setDeletingTemplateId] = useState<string | null>(null);

  // Vector styles accordion — controlled by App; edits apply live to the map
  // (optimistic) and the server PUT is debounced inside useLiveVectorStyle.
  const [vectorStylesOpen, setVectorStylesOpen] = useState(false);
  const [vectorStyleTab, setVectorStyleTab] = useState<"contours" | "features">("contours");

  // Topo jobs accordion
  const [jobsOpen, setJobsOpen] = useState(false);
  const [deletingJobId, setDeletingJobId] = useState<string | null>(null);

  // Active jobs: show first 3, rest behind disclosure
  const [showAllActive, setShowAllActive] = useState(false);

  // Export dialog — one open at a time, keyed by job
  const [exportJob, setExportJob] = useState<CompletedTopoJob | null>(null);

  // Exports accordion
  const [exportsOpen, setExportsOpen] = useState(false);
  const [deletingExportId, setDeletingExportId] = useState<string | null>(null);

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

  const loadTemplates = useCallback(async () => {
    try {
      const list = await apiFetch<TopoTemplate[]>("/topo-templates");
      setTemplates(list);
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, "Couldn't load topo templates."));
    }
  }, [toast]);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates, templateFetchCount]);

  const handleDeleteTemplate = useCallback(
    async (id: string) => {
      try {
        await apiFetch(`/topo-templates/${id}`, { method: "DELETE" });
        setTemplates((prev) => prev.filter((t) => t.id !== id));
        setDeletingTemplateId(null);
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
        setDeletingJobId(null);
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
      setDeletingExportId(id);
      try {
        await deleteTopoExport(id);
        onRefetchTopoExports();
        onQuotaChanged();
      } catch (err) {
        console.error(err);
        toast.error(messageFromError(err, "Couldn't delete export."));
      } finally {
        setDeletingExportId(null);
      }
    },
    [onRefetchTopoExports, onQuotaChanged, toast],
  );

  // Active jobs with cap-and-disclose
  const activeVisible = showAllActive ? activeTopoJobs : activeTopoJobs.slice(0, 3);
  const hasMoreActive = !showAllActive && activeTopoJobs.length > 3;

  return (
    <div className={classes.root}>
      {/* Active jobs — full-width ribbon(s) flush with panel header */}
      {activeTopoJobs.length > 0 && (
        <div className={classes.ribbonStack}>
          {activeVisible.map((job) => {
            const isFailed = job.status === "failed";
            return (
              <div key={job.id} className={classes.ribbon}>
                <div className={classes.ribbonHead}>
                  <span className={classes.ribbonName}>{job.name ?? "Unnamed"}</span>
                  {isFailed && (
                    <button
                      className={classes.ribbonDismiss}
                      onClick={() => onDismissActiveJob(job.id)}
                      title="Dismiss"
                    >
                      <X size={12} />
                    </button>
                  )}
                  <span className={isFailed ? classes.ribbonEtaFailed : classes.ribbonEta}>
                    {jobEtaLabel(job)}
                  </span>
                </div>
                {isFailed ? (
                  <LinearProgress
                    variant="determinate"
                    value={100}
                    sx={{ "& .MuiLinearProgress-bar": { backgroundColor: "var(--theme-warning)" } }}
                  />
                ) : (
                  <LinearProgress />
                )}
              </div>
            );
          })}
          {hasMoreActive && (
            <button
              className={classes.showAllButton}
              onClick={() => setShowAllActive(true)}
            >
              Show all ({activeTopoJobs.length})
            </button>
          )}
        </div>
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
          <span>Templates ({templates.filter((t) => !t.isSystem).length})</span>
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
                  deletingTemplateId === t.id ? (
                    <div className={classes.confirmRow}>
                      <span className={classes.confirmText}>Delete?</span>
                      <button className={classes.confirmYes} onClick={() => handleDeleteTemplate(t.id)}>Yes</button>
                      <button className={classes.confirmNo} onClick={() => setDeletingTemplateId(null)}>No</button>
                    </div>
                  ) : (
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
                        className={classes.deleteButton}
                        onClick={() => setDeletingTemplateId(t.id)}
                      >
                        Delete
                      </button>
                    </>
                  )
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
                      if (job.footprint) onTopoFlyTarget(job.footprint as GeoJsonPolygon);
                    }}
                    title="Fly to this topo on map"
                  >
                    <span className={classes.jobLabel}>{label}</span>
                    {subtitle && (
                      <span className={classes.jobSubtitle}>{subtitle}</span>
                    )}
                  </button>
                  {deletingJobId === job.jobId ? (
                    <div className={classes.confirmRow}>
                      <span className={classes.confirmText}>Delete?</span>
                      <button className={classes.confirmYes} onClick={() => handleDeleteJob(job.jobId)}>Yes</button>
                      <button className={classes.confirmNo} onClick={() => setDeletingJobId(null)}>No</button>
                    </div>
                  ) : (
                    <>
                      <button
                        className={classes.actionButton}
                        onClick={() => setExportJob(job)}
                        title="Export…"
                      >
                        Export…
                      </button>
                      <button
                        className={classes.deleteButton}
                        onClick={() => setDeletingJobId(job.jobId)}
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Exports accordion */}
      <div className={classes.accordion}>
        <button
          className={classes.accordionHeader}
          onClick={() => setExportsOpen((v) => !v)}
          aria-expanded={exportsOpen}
        >
          <span>Exports ({topoExports.length})</span>
          <ChevronDown
            size={14}
            className={`${classes.chevron} ${exportsOpen ? classes.chevronOpen : ""}`}
          />
        </button>
        {exportsOpen && (
          <div className={classes.accordionBody}>
            {topoExports.length === 0 && (
              <div className={classes.emptyHint}>No exports yet.</div>
            )}
            {topoExports.map((ex) => {
              const isComplete = ex.status === "completed" && !!ex.downloadUrl;
              const isFailed = ex.status === "failed";
              const isInProgress = ex.status === "queued" || ex.status === "running";
              const jobLabel = jobNameById.get(ex.sourceJobIds[0]) ?? "Deleted job";
              const metaParts = [
                ex.format.toUpperCase(),
                ex.status,
                ...(ex.resultBytes !== null ? [formatBytes(ex.resultBytes)] : []),
                timeAgo(ex.createdAt),
              ];
              return (
                <div key={ex.id} className={classes.exportItem}>
                  <div className={classes.exportMain}>
                    <span className={classes.exportLabel}>{jobLabel}</span>
                    <span
                      className={isFailed ? classes.exportMetaFailed : classes.exportMeta}
                      title={isFailed && ex.errorMessage ? ex.errorMessage : undefined}
                    >
                      {metaParts.join(" · ")}
                    </span>
                  </div>
                  {isComplete && (
                    <a
                      className={classes.iconDownloadButton}
                      href={ex.downloadUrl!}
                      download
                      title="Download"
                    >
                      <Download size={14} />
                    </a>
                  )}
                  {!isInProgress && (
                    <button
                      className={classes.iconDeleteButton}
                      onClick={() => handleDeleteExport(ex.id)}
                      disabled={deletingExportId === ex.id}
                      title="Delete export"
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
    </div>
  );
}

export default LidarPanel;
