import { useState, useEffect, useCallback } from "react";
import { Switch, LinearProgress } from "@mui/material";
import { ChevronDown, Lock } from "lucide-react";
import classes from "./LidarPanel.module.css";
import { apiFetch } from "../../../canyonUtils";
import { messageFromError } from "../../../errors/messageFromError";
import { useToast } from "../../feedback/ToastProvider";
import type { TopoJob, TopoTemplate, GeoJsonPolygon } from "../../dialogs/TopoDialog";
import type { CompletedTopoJob } from "../../../topoLayerTypes";
import TopoTemplateEditDialog from "../../dialogs/TopoTemplateEditDialog";

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
  lidarJobToggles,
  setLidarJobToggles,
  onOpenTopo,
  onTopoFlyTarget,
  onRefetchCompletedTopoJobs,
  onOpenTopoWithTemplate,
}: {
  activeTopoJobs: TopoJob[];
  completedTopoJobs: CompletedTopoJob[];
  lidarJobToggles: Record<string, boolean>;
  setLidarJobToggles: (
    v: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>),
  ) => void;
  onOpenTopo: () => void;
  onTopoFlyTarget: (footprint: GeoJsonPolygon) => void;
  onRefetchCompletedTopoJobs: () => void;
  onOpenTopoWithTemplate: (templateId: string) => void;
}) {
  const toast = useToast();

  // Templates
  const [templates, setTemplates] = useState<TopoTemplate[]>([]);
  const [templateFetchCount, setTemplateFetchCount] = useState(0);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [templateEditOpen, setTemplateEditOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<TopoTemplate | null>(null);
  const [deletingTemplateId, setDeletingTemplateId] = useState<string | null>(null);

  // Topo jobs accordion
  const [jobsOpen, setJobsOpen] = useState(false);
  const [deletingJobId, setDeletingJobId] = useState<string | null>(null);

  // Active jobs: show first 3, rest behind disclosure
  const [showAllActive, setShowAllActive] = useState(false);

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
      } catch (err) {
        console.error(err);
        toast.error(messageFromError(err, "Couldn't delete LiDAR topo. Please try again."));
      }
    },
    [toast, setLidarJobToggles, onRefetchCompletedTopoJobs],
  );

  // Active jobs with cap-and-disclose
  const activeVisible = showAllActive ? activeTopoJobs : activeTopoJobs.slice(0, 3);
  const hasMoreActive = !showAllActive && activeTopoJobs.length > 3;

  return (
    <div className={classes.root}>
      {/* Active jobs section — only shown when jobs are running */}
      {activeTopoJobs.length > 0 && (
        <div className={classes.activeSection}>
          <div className={classes.sectionLabel}>Active</div>
          {activeVisible.map((job) => (
            <div key={job.id} className={classes.activeJobRow}>
              <div className={classes.activeJobName}>
                {job.name ?? "Unnamed"}
              </div>
              <div className={classes.activeJobMeta}>
                <span className={classes.activeJobStatus}>
                  {job.status === "uploading" ? "Uploading" :
                   job.status === "pending" ? "Queued" :
                   job.status === "processing" ? "Processing" :
                   job.status === "failed" ? "Failed" : job.status}
                </span>
                {job.status === "processing" && (
                  <LinearProgress
                    variant="indeterminate"
                    sx={{
                      flex: 1,
                      height: 3,
                      borderRadius: 2,
                      backgroundColor: "rgba(255,255,255,0.1)",
                      "& .MuiLinearProgress-bar": { backgroundColor: "var(--theme-accent)" },
                    }}
                  />
                )}
                <span className={classes.activeJobEta}>{jobEtaLabel(job)}</span>
              </div>
            </div>
          ))}
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
                <span className={classes.templateDate}>
                  {t.isSystem ? "system" : relativeDate(t.updatedAt)}
                </span>
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
                    <button
                      className={classes.deleteButton}
                      onClick={() => setDeletingJobId(job.jobId)}
                    >
                      Delete
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
    </div>
  );
}

export default LidarPanel;
