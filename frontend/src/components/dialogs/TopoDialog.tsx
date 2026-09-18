// Makes a LiDAR topo: the question is "what do I want covered, and what am I
// giving it to work from?".
//
// The data itself comes from ELVIS, the federal elevation portal — Logjam never
// holds the state's LiDAR, the user orders the tiles they want and uploads the
// ZIP that arrives. That errand is several steps long and is needed once, so it
// lives in a sub-view of this dialog rather than above the thing it explains
// (DESIGN.md §6: a picker inside a dialog swaps the body and backs out to the
// form). The raster settings are the other sub-view.
import { useState, useRef, Fragment, useEffect, useCallback } from "react";
import { CircleCheckBig, ExternalLink, Info, Settings2, SquareDashed, Upload } from "lucide-react";
import {
  apiFetch,
  fetchComputeEstimate,
  fetchCurrentUser,
  putToPresignedUrl,
} from "../../placeUtils";
import { messageFromError } from "../../errors/messageFromError";
import { ErrorBanner } from "../feedback/ErrorBanner";
import { useUnsavedChangesGuard } from "../../useUnsavedChangesGuard";
import ConfirmDialog from "./ConfirmDialog";
import type { TBbox } from "../map/Map";
import {
  parseZipCentralDirectory,
  classifyElvisEntries,
  ElvisZipError,
  RASTER_TEMPLATE_DEFAULTS,
  AUTO_EXPORT_DEFAULTS,
  cloneRasterTemplateSettings,
  slopeBandsError,
  hillshadeSettingsError,
  estimateElvisTileCount,
  formatCredits,
  regionNameFromSurvey,
  type ElvisStats,
  type RasterTemplateSettings,
  type AutoExportSettings,
} from "@logjam/shared";
import {
  Button,
  ChipRail,
  Dialog,
  ProgressBar,
  SectionHeader,
  Select,
  StatusPill,
  TextField,
} from "../../ui";
import AdvancedSettings from "./topoSettings/AdvancedSettings";
import { SETTINGS_TABS, type SettingsTab } from "./topoSettings/settingsTabs";
import { nextTopoName } from "./jobName";
import { fetchTopoTemplates } from "./topoTemplatesFetch";
import { formatAreaKm2 } from "./formatArea";
import { bboxAreaKm2, downloadBboxShapefile } from "./bboxShapefile";
import classes from "./TopoDialog.module.css";

export type TopoTemplate = {
  id: string;
  name: string;
  isSystem: boolean;
  config: RasterTemplateSettings;
  autoExport: AutoExportSettings | null;
  createdAt: string | null;
  updatedAt: string | null;
};

type Phase = "form" | "uploading" | "finalizing" | "done";
/** The form, or one of the two things it sends you off to do. */
type Mode = "form" | "instructions" | "settings";

const DEFAULT_TEMPLATE_ID = "default";

// Deep-copy a template's auto-export slice (or fall back to defaults for older
// templates saved before the feature existed) so edits don't mutate the cached
// template list.
function cloneAutoExport(value: AutoExportSettings | null): AutoExportSettings {
  if (!value) return { ...AUTO_EXPORT_DEFAULTS };
  return { ...value, layers: [...value.layers] };
}

// ── Types ────────────────────────────────────────────────────────────────────

export type TopoJobStatus =
  | "uploading"
  | "pending"
  | "processing"
  | "complete"
  | "failed";

// Footprint geometry types are canonical in topoLayerTypes; re-exported here so
// existing `from "../dialogs/TopoDialog"` imports keep working.
export type { GeoJsonPolygonal } from "../../topoLayerTypes";
import type { GeoJsonPolygonal } from "../../topoLayerTypes";

export type TopoJob = {
  id: string;
  status: TopoJobStatus;
  name: string | null;
  footprint: GeoJsonPolygonal | null;
  tileCount: number | null;
  estimatedSeconds: number | null;
  layerOptions: string[] | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  /** Owner-only: absent from a job shared WITH the user, because raw bucket
   *  keys can name a place (see serializeTopoJobFor in api/routes/topoJobs). */
  s3OutputKeys?:
    | { name: string; mbtilesKey: string; pmtilesKey: string | null }[]
    | null;
  /** Owner vs recipient — a job shared WITH the user is read-only. */
  syncRole: "owner" | "shared";
};

export type DownloadUrl = {
  name: string;
  mbtilesUrl: string;
  pmtilesUrl: string | null;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function TopoDialog({
  open,
  onClose,
  onSelectBbox,
  awaitingBbox,
  pendingBbox,
  onJobCreated,
  initialTemplateId,
  existingTopoNames,
  onTemplateSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSelectBbox: () => void;
  /** True while the map is waiting for the box to be drawn — this dialog is
   *  closed for the duration, and what is typed in it must survive that. */
  awaitingBbox: boolean;
  pendingBbox: TBbox | null;
  onJobCreated: (job: TopoJob) => void;
  initialTemplateId?: string | null;
  existingTopoNames: string[];
  /** Notifies the owner that the inline "Save as template" created a template,
   *  so panel-side template lists can refetch (TOPO-1). */
  onTemplateSaved?: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  // Submission lifecycle: form → uploading (determinate PUT) → finalizing
  // (server validate + ECS launch) → done (in-dialog success).
  const [phase, setPhase] = useState<Phase>("form");
  const [mode, setMode] = useState<Mode>("form");
  const [uploadedBytes, setUploadedBytes] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const [submittedJob, setSubmittedJob] = useState<TopoJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [validating, setValidating] = useState(false);
  const [stats, setStats] = useState<ElvisStats | null>(null);
  // Topo name: prefilled from the survey region after upload, but a name the
  // user types (topoNameTouched) is never overwritten by autofill.
  const [topoName, setTopoName] = useState("");
  const [topoNameTouched, setTopoNameTouched] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [creditsUsed, setCreditsUsed] = useState<number | null>(null);
  const [creditsQuota, setCreditsQuota] = useState<number | null>(null);
  const [creditsResetAt, setCreditsResetAt] = useState<string | null>(null);
  // What THIS job is projected to cost, from POST /compute-estimate. Null until
  // the ZIP has been validated (the tile count is the estimator's only input),
  // or when the server has too little history to have an opinion.
  const [jobCredits, setJobCredits] = useState<number | null>(null);
  // The server's own verdict on whether this submission would be refused.
  // Preferred over recomputing used + cost > quota on the client, so there is
  // one rule for the decision rather than two that can disagree.
  const [jobWouldExceed, setJobWouldExceed] = useState(false);
  const [storageUsed, setStorageUsed] = useState<number | null>(null);
  const [storageQuota, setStorageQuota] = useState<number | null>(null);

  // Advanced settings + templates
  const [settings, setSettings] = useState<RasterTemplateSettings>(() => cloneRasterTemplateSettings(RASTER_TEMPLATE_DEFAULTS));
  const [autoExport, setAutoExport] = useState<AutoExportSettings>(() => ({ ...AUTO_EXPORT_DEFAULTS }));
  const [templates, setTemplates] = useState<TopoTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(DEFAULT_TEMPLATE_ID);
  const [saveAsName, setSaveAsName] = useState("");
  const [showSaveAs, setShowSaveAs] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("hillshade");

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Closing empties the form — but going off to draw the area CLOSES this
  // dialog too, and comes back to it (App reopens on `onBboxSelected`). Emptying
  // it then threw away the ZIP the user had already chosen, their name and their
  // settings, silently and without the unsaved-changes confirm, because App's
  // own close never goes through the guard. `awaitingBbox` is the difference
  // between the two, and it is App's to tell us: it is false again whether the
  // box was drawn or the pick was abandoned, so a genuinely abandoned dialog
  // still empties.
  useEffect(() => {
    if (open || awaitingBbox) return;
    setFile(null);
    setPhase("form");
    setMode("form");
    setUploadedBytes(0);
    setTotalBytes(0);
    setSubmittedJob(null);
    setError(null);
    setDragging(false);
    setValidating(false);
    setStats(null);
    setTopoName("");
    setTopoNameTouched(false);
    setValidationError(null);
    setSettings(cloneRasterTemplateSettings(RASTER_TEMPLATE_DEFAULTS));
    setAutoExport({ ...AUTO_EXPORT_DEFAULTS });
    setSelectedTemplateId(DEFAULT_TEMPLATE_ID);
    setSaveAsName("");
    setShowSaveAs(false);
    setSettingsTab("hillshade");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [open, awaitingBbox]);

  const refreshTemplates = useCallback(async () => {
    try {
      const list = await fetchTopoTemplates();
      setTemplates(list);
      return list;
    } catch (e) {
      console.error(e);
      return [] as TopoTemplate[];
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    refreshTemplates().then((list) => {
      if (initialTemplateId) {
        const t = list.find((x) => x.id === initialTemplateId);
        if (t) {
          setSelectedTemplateId(t.id);
          setSettings(cloneRasterTemplateSettings(t.config));
          setAutoExport(cloneAutoExport(t.autoExport));
        }
      }
    });
  }, [open, refreshTemplates, initialTemplateId]);

  function selectTemplate(id: string) {
    setSelectedTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (t) {
      setSettings(cloneRasterTemplateSettings(t.config));
      setAutoExport(cloneAutoExport(t.autoExport));
    }
  }

  const settingsInvalid =
    slopeBandsError(settings.slope.bands) != null || hillshadeSettingsError(settings.hillshade) != null;

  async function handleSaveAsTemplate() {
    const name = saveAsName.trim();
    if (!name) return;
    try {
      const created = await apiFetch<TopoTemplate>("/topo-templates", {
        method: "POST",
        body: { name, config: settings, autoExport },
      });
      setSaveAsName("");
      setShowSaveAs(false);
      await refreshTemplates();
      setSelectedTemplateId(created.id);
      // Panel-side template lists render from their own state — tell the owner
      // so they refresh without a page reload (TOPO-1).
      onTemplateSaved?.();
    } catch (e) {
      console.error(e);
      setError(messageFromError(e, "Couldn't save template."));
    }
  }

  // Tile count driving the cost projection: the ZIP's verified count once one
  // has been validated, else the drawn area's conservative estimate so the
  // warning appears before the user goes off to download gigabytes from ELVIS.
  const area = pendingBbox ? bboxAreaKm2(pendingBbox) : null;
  const estimatedTiles = area != null ? estimateElvisTileCount(area) : null;
  const activeTileCount = stats?.tileCount ?? estimatedTiles;

  // Credits are not derivable client-side: the tiles-to-seconds rate is fitted
  // server-side from recent real runtimes, so the projection has to be asked
  // for. Cheap (two DB reads, nothing written) and re-asked whenever the tile
  // count changes.
  useEffect(() => {
    if (!open || !activeTileCount) {
      setJobCredits(null);
      setJobWouldExceed(false);
      return;
    }
    let cancelled = false;
    fetchComputeEstimate({ kind: "topo", tileCount: activeTileCount })
      .then((estimate) => {
        if (cancelled) return;
        setJobCredits(estimate.credits);
        setJobWouldExceed(estimate.wouldExceed);
        // The estimate response carries a fresher balance than the one loaded
        // when the dialog opened, so adopt it rather than keeping two views.
        setCreditsUsed(estimate.used);
        setCreditsQuota(estimate.quota);
        setCreditsResetAt(estimate.resetAt);
      })
      // Same best-effort stance as the balance fetch below: display and
      // client-side gating only, the server still enforces on submit.
      .catch((err) => console.error(err));
    return () => {
      cancelled = true;
    };
  }, [open, activeTileCount]);

  useEffect(() => {
    if (!open) return;
    fetchCurrentUser()
      .then((u) => {
        setCreditsUsed(u.monthlyComputeUsage);
        setCreditsQuota(u.monthlyComputeCredits);
        setCreditsResetAt(u.monthlyComputeResetAt);
        setStorageUsed(u.storageUsedBytes);
        setStorageQuota(u.storageQuotaBytes);
      })
      // Best-effort: quota display/gating only — a failure here leaves
      // creditsUsed/creditsQuota null (the client-side checks then skip,
      // and the server still enforces the quota on submit), so it's not worth
      // a toast, but FEUI-011 wants the failure at least visible in the console
      // rather than fully silent.
      .catch((err) => console.error(err));
  }, [open]);

  useEffect(() => {
    if (!file) {
      setStats(null);
      setValidationError(null);
      return;
    }
    let cancelled = false;
    setValidating(true);
    setStats(null);
    setValidationError(null);
    (async () => {
      try {
        const tailSize = Math.min(65536, file.size);
        const tail = await file
          .slice(file.size - tailSize, file.size)
          .arrayBuffer();
        const entries = parseZipCentralDirectory(
          new Uint8Array(tail),
          file.size,
        );
        const s = classifyElvisEntries(entries);
        if (!cancelled) setStats(s);
      } catch (e) {
        if (!cancelled) {
          setValidationError(
            e instanceof ElvisZipError
              ? e.message
              : "Could not read this ZIP file.",
          );
        }
      } finally {
        if (!cancelled) setValidating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file]);

  // Prefill the topo name from the survey region once a ZIP is parsed, unless
  // the user has already typed one. Re-fills on a new upload only while
  // untouched.
  useEffect(() => {
    if (!stats || topoNameTouched) return;
    const region = regionNameFromSurvey(stats.surveyNames[0] ?? "");
    if (region) setTopoName(nextTopoName(region, existingTopoNames));
  }, [stats, topoNameTouched, existingTopoNames]);

  function onFilePicked(picked: File) {
    if (!picked.name.toLowerCase().endsWith(".zip")) {
      setValidationError("Please select a .zip file.");
      return;
    }
    setFile(picked);
    setError(null);
  }

  async function handleSubmit() {
    if (!file || !stats) return;
    setError(null);

    if (storageUsed !== null && storageQuota !== null && storageUsed >= storageQuota) {
      setError("Storage quota is full. Free space by deleting old topo jobs before submitting a new one.");
      return;
    }

    if (creditsUsed !== null && creditsQuota !== null && jobCredits !== null) {
      if (creditsUsed + jobCredits > creditsQuota) {
        const remaining = Math.max(0, creditsQuota - creditsUsed);
        const resetStr = creditsResetAt
          ? ` Allowance resets ${new Date(creditsResetAt).toLocaleDateString("en-AU", { month: "short", day: "numeric" })}.`
          : "";
        setError(
          `Not enough processing credits. This job needs about ${formatCredits(jobCredits)} but only ${formatCredits(remaining)} remain.${resetStr}`,
        );
        return;
      }
    }

    setUploadedBytes(0);
    setTotalBytes(file.size);
    setPhase("uploading");
    try {
      const { jobId, uploadUrl } = await apiFetch<{
        jobId: string;
        uploadUrl: string;
      }>("/topo-jobs", {
        method: "POST",
        body: {
          tileCount: stats.tileCount || null,
          jobName: topoName.trim() || stats.surveyNames[0] || null,
          filename: file.name,
          settings,
          autoExport,
        },
      });

      await putToPresignedUrl(uploadUrl, file, "application/zip", (loaded, total) => {
        setUploadedBytes(loaded);
        setTotalBytes(total);
      });

      setPhase("finalizing");
      await apiFetch(`/topo-jobs/${jobId}/start`, { method: "POST" });

      const newJob = await apiFetch<TopoJob>(`/topo-jobs/${jobId}`);
      onJobCreated(newJob);
      setSubmittedJob(newJob);
      setPhase("done");
    } catch (e: unknown) {
      console.error(e);
      setError(messageFromError(e, "Submission failed. Please try again."));
      // File preserved so the ErrorBanner's Retry can resubmit.
      setPhase("form");
    }
  }

  function performClose() {
    // Block closing mid-upload — there's no resumable state to return to.
    if (phase === "uploading" || phase === "finalizing") return;
    onClose();
  }

  // Dirty once a ZIP has been picked and not yet submitted — losing a queued
  // multi-GB upload to a stray Esc is real lost work. Deliberately keyed to the
  // file only: settings/name have an async baseline (a template can apply after
  // open via initialTemplateId, and picking a template mutates settings), so a
  // settings snapshot would false-positive; the confirm copy is narrowed to
  // match exactly what this guards. Once submission starts (uploading/
  // finalizing) close is already blocked above; once done there's nothing left
  // to lose.
  const isDirty = phase === "form" && file != null;
  const guard = useUnsavedChangesGuard(isDirty, performClose);

  const uploading = phase === "uploading" || phase === "finalizing";
  const uploadPct = totalBytes > 0 ? Math.min(100, Math.round((uploadedBytes / totalBytes) * 100)) : 0;
  const backToForm = () => {
    setMode("form");
    setShowSaveAs(false);
    setSaveAsName("");
  };

  const title =
    phase === "uploading"
      ? "Uploading"
      : phase === "finalizing"
        ? "Almost there"
        : phase === "done"
          ? "On its way"
          : mode === "instructions"
            ? "Getting LiDAR from ELVIS"
            : mode === "settings"
              ? "How this topo is drawn"
              : "Make a LiDAR topo";

  return (
    <>
      <Dialog
        open={open}
        title={title}
        size="large"
        dismissible={!uploading}
        // Inside a sub-view every way out means "back to the form", never
        // "throw away the ZIP I just chose".
        onClose={mode === "form" ? guard.requestClose : backToForm}
        toolbar={
          mode === "settings" && !uploading && phase !== "done" ? (
            <>
              <div className={classes.saveAsLine}>
                {showSaveAs ? (
                  <>
                    <TextField
                      label="Template name"
                      hideLabel
                      className={classes.saveAsField}
                      placeholder="Name this template"
                      value={saveAsName}
                      autoFocus
                      onChange={(event) => setSaveAsName(event.target.value)}
                    />
                    <Button
                      variant="filled"
                      compact
                      disabled={!saveAsName.trim() || settingsInvalid}
                      onClick={handleSaveAsTemplate}
                    >
                      Save
                    </Button>
                    <Button compact onClick={() => { setShowSaveAs(false); setSaveAsName(""); }}>
                      Cancel
                    </Button>
                  </>
                ) : (
                  <Button compact variant="outline" onClick={() => setShowSaveAs(true)}>
                    Save as a template
                  </Button>
                )}
              </div>
              <ChipRail
                label="Settings group"
                options={SETTINGS_TABS}
                value={settingsTab}
                onChange={setSettingsTab}
              />
            </>
          ) : undefined
        }
        footer={
          uploading ? undefined : phase === "done" ? (
            <Button variant="filled" onClick={onClose}>
              Done
            </Button>
          ) : mode !== "form" ? (
            <Button variant="filled" onClick={backToForm}>
              Back to the form
            </Button>
          ) : (
            <>
              <Button onClick={guard.requestClose}>Cancel</Button>
              <Button
                variant="filled"
                onClick={handleSubmit}
                disabled={
                  !file ||
                  validating ||
                  !stats ||
                  !!validationError ||
                  settingsInvalid ||
                  (creditsUsed !== null &&
                    creditsQuota !== null &&
                    jobCredits !== null &&
                    creditsUsed + jobCredits > creditsQuota)
                }
              >
                Make it
              </Button>
            </>
          )
        }
      >
        {uploading ? (
          <div className={classes.working}>
            <p className={classes.workingLine}>
              {phase === "uploading"
                ? "Uploading your LiDAR. Keep this window open until it finishes."
                : "Uploaded. Checking it over and starting your topo…"}
            </p>
            <ProgressBar
              label={phase === "uploading" ? "Upload progress" : "Starting your topo"}
              value={phase === "uploading" ? uploadPct : undefined}
            />
            {phase === "uploading" && (
              <p className={classes.workingDetail}>
                {(uploadedBytes / 1e6).toFixed(1)} of {(totalBytes / 1e6).toFixed(1)} MB
                {totalBytes > 0 ? ` · ${uploadPct}%` : ""}
              </p>
            )}
          </div>
        ) : phase === "done" ? (
          <div className={classes.done}>
            <CircleCheckBig size={40} aria-hidden className={classes.doneGlyph} />
            <p className={classes.doneName}>{submittedJob?.name ?? "Your topo"} is being made</p>
            <p className={classes.workingDetail}>
              {stats?.tileCount
                ? `${stats.tileCount} tile${stats.tileCount > 1 ? "s" : ""} queued. `
                : ""}
              We'll let you know when it's ready. You can close this.
            </p>
          </div>
        ) : mode === "instructions" ? (
          <ElvisInstructions
            pendingBbox={pendingBbox}
            area={area}
            onSelectBbox={onSelectBbox}
            warnCredits={jobWouldExceed && stats === null}
          />
        ) : mode === "settings" ? (
          <AdvancedSettings
            tab={settingsTab}
            value={settings}
            onChange={setSettings}
            autoExport={autoExport}
            onAutoExportChange={setAutoExport}
          />
        ) : (
          <>
            <p className={classes.wideHint}>This is easier on a bigger screen.</p>

            {(validationError || error) && <ErrorBanner message={validationError ?? error!} />}

            {/* The ZIP is the whole point of the dialog, so it is the first
                thing in it; the errand that produces one is a step away. */}
            <div
              className={classes.drop}
              data-dragging={dragging || undefined}
              data-loaded={file ? true : undefined}
              role="button"
              tabIndex={0}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                setDragging(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const dropped = e.dataTransfer.files[0];
                if (dropped) onFilePicked(dropped);
              }}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
            >
              <Upload size={28} aria-hidden className={classes.dropGlyph} />
              <span className={classes.dropLine}>
                {file ? file.name : "Drop your ELVIS ZIP here, or choose a file"}
              </span>
              <span className={classes.dropHint}>
                {file ? "Choose a different file" : "Just as it arrived from ELVIS — no need to unzip it"}
              </span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".zip"
                hidden
                onChange={(e) => {
                  const picked = e.target.files?.[0];
                  if (picked) onFilePicked(picked);
                  e.target.value = "";
                }}
              />
            </div>

            <div className={classes.errandLine}>
              <Button icon={Info} compact variant="outline" onClick={() => setMode("instructions")}>
                Haven't got one? Order LiDAR from ELVIS
              </Button>
            </div>

            {validating && (
              <p className={classes.workingDetail} role="status">
                Reading your ZIP…
              </p>
            )}

            {stats && !validating && <ZipSummary stats={stats} creditsUsed={creditsUsed} creditsQuota={creditsQuota} jobCredits={jobCredits} />}

            {/* Two short answers about the same topo: one line holds both. */}
            <div className={classes.nameRow}>
            <TextField
              label="Name"
              placeholder="Name this topo"
              value={topoName}
              onChange={(e) => {
                setTopoName(e.target.value);
                setTopoNameTouched(true);
              }}
            />

            <Select
              label="Template"
              value={selectedTemplateId}
              onChange={(e) => selectTemplate(e.target.value)}
            >
              {/* Until /topo-templates resolves, render the synthetic system
                  Default entry (always first in the server list) so the initial
                  value "default" is never out of range (TOPO-3). */}
              {templates.length === 0 ? (
                <option value={DEFAULT_TEMPLATE_ID}>Default (system)</option>
              ) : (
                templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.isSystem ? " (system)" : ""}
                  </option>
                ))
              )}
            </Select>
            </div>

            <div className={classes.errandLine}>
              <Button icon={Settings2} compact variant="outline" onClick={() => setMode("settings")}>
                How this topo is drawn
              </Button>
              {settingsInvalid && <StatusPill label="A setting needs fixing" tone="warning" />}
            </div>
          </>
        )}
      </Dialog>

      <ConfirmDialog
        open={guard.guardOpen}
        title="Discard unsaved changes?"
        message="Your loaded file will be lost."
        confirmLabel="Discard"
        confirmColor="error"
        onConfirm={guard.confirmDiscard}
        onClose={guard.cancelDiscard}
      />
    </>
  );
}

/** What the ZIP turned out to hold, and what making it will cost. */
function ZipSummary({
  stats,
  creditsUsed,
  creditsQuota,
  jobCredits,
}: {
  stats: ElvisStats;
  creditsUsed: number | null;
  creditsQuota: number | null;
  jobCredits: number | null;
}) {
  const rows: ([string, string] | null)[] = [
    ["Survey", stats.surveyNames.join(", ") || "—"],
    ["Mode", stats.modeLabel],
    ["Tiles", String(stats.tileCount)],
    stats.lazCount > 0
      ? [
          "Point clouds",
          stats.overlappingSurveys
            ? `${stats.lazCount}× .laz over ${stats.tileCount} area${stats.tileCount > 1 ? "s" : ""}`
            : `${stats.lazCount}× .laz`,
        ]
      : null,
    stats.demCount > 0
      ? [
          "DEM",
          `${stats.demCount}× .tif${stats.demResolutionMeters != null ? ` @ ${stats.demResolutionMeters}m` : ""}`,
        ]
      : null,
    ["Size", formatBytes(stats.uncompressedBytes)],
    // Unambiguous quota copy (TOPO-8): creditsUsed already includes any
    // queued/running jobs (the server sums non-failed jobs this month), so show
    // the current figure and the projection side by side instead of a bare
    // "N / Q after this job".
    creditsUsed !== null && creditsQuota !== null
      ? [
          "Credits",
          jobCredits !== null
            ? `${formatCredits(creditsUsed)} of ${formatCredits(creditsQuota)} used this month · about ${formatCredits(jobCredits)} for this one`
            : `${formatCredits(creditsUsed)} of ${formatCredits(creditsQuota)} used this month · we can't tell yet what this one will cost`,
        ]
      : null,
  ];

  return (
    <div className={classes.summary}>
      <dl className={classes.summaryGrid}>
        {rows
          .filter((row): row is [string, string] => row !== null)
          .map(([label, value]) => (
            <Fragment key={label}>
              <dt className={classes.summaryLabel}>{label}</dt>
              <dd className={classes.summaryValue}>{value}</dd>
            </Fragment>
          ))}
      </dl>
      {stats.derivativeTifCount > 0 && (
        <p className={classes.summaryNote}>
          {stats.derivativeTifCount} ready-made raster
          {stats.derivativeTifCount > 1 ? "s" : ""} in here (hillshade and the like) will be
          ignored — yours are drawn from the survey itself.
        </p>
      )}
      {stats.overlappingSurveys && (
        <p className={classes.summaryNote}>
          More than one survey covers this ground. The best of them is used for each layer —
          the densest for terrain, the most recent for vegetation — at no extra cost.
        </p>
      )}
    </div>
  );
}

/**
 * The errand: draw the area, take its shapefile to ELVIS, order the tiles.
 * Numbered, because it is done in order and in another tab.
 */
function ElvisInstructions({
  pendingBbox,
  area,
  onSelectBbox,
  warnCredits,
}: {
  pendingBbox: TBbox | null;
  area: number | null;
  onSelectBbox: () => void;
  warnCredits: boolean;
}) {
  return (
    <ol className={classes.steps}>
      <li className={classes.step}>
        <div className={classes.stepBody}>
        <SectionHeader title="Mark out what you want covered" />
        <div className={classes.stepControls}>
          <Button icon={SquareDashed} compact variant="outline" onClick={onSelectBbox}>
            {pendingBbox ? "Draw it again" : "Draw the area"}
          </Button>
          {pendingBbox && area != null && <StatusPill label={formatAreaKm2(area)} />}
          {pendingBbox && (
            <Button compact variant="outline" onClick={() => downloadBboxShapefile(pendingBbox)}>
              Download its shapefile
            </Button>
          )}
        </div>
        {warnCredits && (
          <p className={classes.stepWarning}>
            An area this size may cost more credits than you have left this month. Try a smaller
            one.
          </p>
        )}
        </div>
      </li>

      <li className={classes.step}>
        <div className={classes.stepBody}>
        <SectionHeader title="Order the tiles from ELVIS" />
        <p className={classes.stepLine}>
          In ELVIS, choose <strong>Order Data</strong>, then <strong>Load File</strong> and give
          it the shapefile. Then press <strong>Search</strong>.
        </p>
        <div className={classes.stepControls}>
          <Button
            icon={ExternalLink}
            compact
            variant="outline"
            onClick={() => window.open("https://elevation.fsdf.org.au/", "_blank", "noopener,noreferrer")}
          >
            Open the ELVIS portal
          </Button>
        </div>
        </div>
      </li>

      <li className={classes.step}>
        <div className={classes.stepBody}>
        <SectionHeader title="Take the point clouds" />
        <p className={classes.stepLine}>
          Under <strong>NSW Government — Spatial Services</strong> → <strong>Point Clouds</strong>,
          beside <strong>AHD</strong>, press <strong>Select all</strong>, or select the specific
          tiles you want.
        </p>
        <p className={classes.stepLine}>
          Alternatively, select only DEM files for a faster but less precise topo with no
          vegetation layer.
        </p>
        </div>
      </li>

      <li className={classes.step}>
        <div className={classes.stepBody}>
        <SectionHeader title="Have it sent to you" />
        <p className={classes.stepLine}>
          Under <strong>Industry</strong>, choose <strong>Recreation</strong>. Enter your email
          and press <strong>Order datasets</strong>. ELVIS emails you a link to the ZIP — that
          ZIP is what you bring back here.
        </p>
        </div>
      </li>
    </ol>
  );
}
