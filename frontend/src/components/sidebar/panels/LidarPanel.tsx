import { useState, useEffect, useCallback, useRef } from "react";
import { Switch, LinearProgress } from "@mui/material";
import { ChevronDown, Lock, X } from "lucide-react";
import classes from "./LidarPanel.module.css";
import { apiFetch, useVectorStyle } from "../../../canyonUtils";
import { messageFromError } from "../../../errors/messageFromError";
import { useToast } from "../../feedback/ToastProvider";
import type { TopoJob, TopoTemplate, GeoJsonPolygon } from "../../dialogs/TopoDialog";
import type { CompletedTopoJob } from "../../../topoLayerTypes";
import TopoTemplateEditDialog from "../../dialogs/TopoTemplateEditDialog";
import TopoExportDialog from "../../dialogs/TopoExportDialog";
import VectorContoursForm from "./vectorStyles/VectorContoursForm";
import VectorFeaturesForm from "./vectorStyles/VectorFeaturesForm";
import type { VectorStyleSettings } from "@logjam/shared";

const VECTOR_STYLE_SAVE_DEBOUNCE_MS = 400;


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
  onDismissActiveJob,
  onOpenTopoWithTemplate,
  onQuotaChanged,
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
  onDismissActiveJob: (jobId: string) => void;
  onOpenTopoWithTemplate: (templateId: string) => void;
  onQuotaChanged: () => void;
}) {
  const toast = useToast();

  // Templates
  const [templates, setTemplates] = useState<TopoTemplate[]>([]);
  const [templateFetchCount, setTemplateFetchCount] = useState(0);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [templateEditOpen, setTemplateEditOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<TopoTemplate | null>(null);
  const [deletingTemplateId, setDeletingTemplateId] = useState<string | null>(null);

  // Vector styles accordion — live, per-user, debounced PUT
  const [vectorStylesOpen, setVectorStylesOpen] = useState(false);
  const [vectorStyleTab, setVectorStyleTab] = useState<"contours" | "features">("contours");
  const vectorStyleHook = useVectorStyle(true);
  const [draftVectorStyle, setDraftVectorStyle] = useState<VectorStyleSettings | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Seed the editable draft from the server-loaded value, but never blow away
  // an in-flight edit by re-syncing after the hook refetches (e.g. after a
  // save round-trip — saved value equals draft already).
  useEffect(() => {
    if (vectorStyleHook.vectorStyle && draftVectorStyle === null) {
      setDraftVectorStyle(vectorStyleHook.vectorStyle);
    }
  }, [vectorStyleHook.vectorStyle, draftVectorStyle]);

  const scheduleVectorStyleSave = useCallback((next: VectorStyleSettings) => {
    setDraftVectorStyle(next);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      vectorStyleHook.save(next).catch((err) => {
        console.error(err);
        toast.error(messageFromError(err, "Couldn't save vector style."));
      });
    }, VECTOR_STYLE_SAVE_DEBOUNCE_MS);
  }, [vectorStyleHook, toast]);

  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
  }, []);

  // Topo jobs accordion
  const [jobsOpen, setJobsOpen] = useState(false);
  const [deletingJobId, setDeletingJobId] = useState<string | null>(null);

  // Active jobs: show first 3, rest behind disclosure
  const [showAllActive, setShowAllActive] = useState(false);

  // Export dialog — one open at a time, keyed by job
  const [exportJob, setExportJob] = useState<CompletedTopoJob | null>(null);

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
            {draftVectorStyle === null ? (
              <div className={classes.emptyHint}>
                {vectorStyleHook.error ?? "Loading…"}
              </div>
            ) : vectorStyleTab === "contours" ? (
              <VectorContoursForm
                value={draftVectorStyle.contours}
                onChange={(next) =>
                  scheduleVectorStyleSave({ ...draftVectorStyle, contours: next })
                }
              />
            ) : (
              <VectorFeaturesForm
                value={draftVectorStyle.features}
                onChange={(next) =>
                  scheduleVectorStyleSave({ ...draftVectorStyle, features: next })
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
      />
    </div>
  );
}

export default LidarPanel;
