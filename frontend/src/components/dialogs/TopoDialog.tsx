// Sharpens an area: the question is "what do I want covered, and what am I
// giving it to work from?".
//
// The data itself comes from the region's portal (`Region.sharpen.portal`:
// ELVIS, the federal elevation portal, in New South Wales) — Logjam never holds
// the survey, the user gets the tiles they want and uploads the ZIP. ELVIS's
// errand is several steps long and is needed once, so it lives in a sub-view of
// this dialog rather than above the thing it explains (DESIGN.md: a picker
// inside a dialog swaps the body and backs out to the form); a portal with no
// errand of its own gets a short sub-view. Where the region has no sharpening
// the dialog says so and offers nothing.
import { useState, useRef, Fragment, useEffect } from "react";
import {
  apiFetch,
  fetchComputeEstimate,
  fetchCurrentUser,
} from "../../placeUtils";
import type { TBbox } from "../map/Map";
import {
  abandonConfirm,
  readZipEntries,
  classifyElvisEntries,
  ElvisZipError,
  estimateElvisTileCount,
  formatCreditsLike,
  formatCreditsOf,
  formatArea,
  formatMinutes,
  regionNameFromSurvey,
  LIDAR_JOB_COPY,
  MAP_TERRAIN,
  plural,
  rich,
  t,
  type ElvisStats,
  formatDayMonth,
  localDay,
  type SharpenOffer,
  type SharpenPortal,
  formatFixedMetres,
} from "@logjam/shared";
import {
  Button,
  Dialog,
  ProgressBar,
  SectionHeader,
  StatusPill,
  TextField,
  Icon,
  ErrorBanner,
  FieldError,
  Checkbox,
} from "../../ui";
import { Rich } from "../../ui/rich";
import { nextTopoName } from "./jobName";
import { bboxAreaKm2, downloadBboxShapefile } from "./bboxShapefile";
import { submitFailureMessage, useTopoUpload } from "./topoUpload";
import { sharpenJobRequest } from "./sharpenJob";
import classes from "./TopoDialog.module.css";

type Phase = "form" | "uploading" | "finalizing" | "done";
/** The form, or the errand it sends you off to do. */
type Mode = "form" | "instructions";

const HELD_REASON_ID = "topo-held-reason";
const STRONG = { strong: (text: string) => <strong>{text}</strong> };
const KEPT_FOR_RESUME = t`Kept as first sent, so Make it carries on the upload; to change it, choose the ZIP again.`;

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
  existingTopoNames,
  offer,
}: {
  open: boolean;
  onClose: () => void;
  onSelectBbox: () => void;
  /** True while the map is waiting for the box to be drawn — this dialog is
   *  closed for the duration, and what is typed in it must survive that. */
  awaitingBbox: boolean;
  pendingBbox: TBbox | null;
  onJobCreated: (job: TopoJob) => void;
  existingTopoNames: string[];
  /** What sharpening offers here: the portal to name, or why there is none.
   *  The offer for a drawn area or the map (`sharpenOfferFor`), or the one a
   *  link to an existing job computed (`sharpenOfferForJob`). */
  offer: SharpenOffer;
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
  const [jobSeconds, setJobSeconds] = useState<number | null>(null);
  // The server's own verdict on whether this submission would be refused.
  // Preferred over recomputing used + cost > quota on the client, so there is
  // one rule for the decision rather than two that can disagree.
  const [jobWouldExceed, setJobWouldExceed] = useState(false);
  const [storageUsed, setStorageUsed] = useState<number | null>(null);
  const [storageQuota, setStorageQuota] = useState<number | null>(null);

  // The one styled layer a job can make, off unless asked.
  const [vegetation, setVegetation] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const upload = useTopoUpload();

  // Closing empties the form — but going off to draw the area CLOSES this
  // dialog too, and comes back to it (App reopens on `onBboxSelected`). Emptying
  // it in that case would throw away the ZIP the user had already chosen,
  // their name and their tick, silently and without the unsaved-changes
  // confirm, because App's own close never goes through the guard. `awaitingBbox`
  // is the difference between the two, and it is App's to tell us: it is false
  // again whether the box was drawn or the pick was abandoned, so a genuinely
  // abandoned dialog still empties. Done during render, when the dialog becomes
  // genuinely closed. (The file input needs no clearing: the closed Dialog
  // unmounts it.)
  const closedForGood = !open && !awaitingBbox;
  const [wasClosedForGood, setWasClosedForGood] = useState(closedForGood);
  if (closedForGood !== wasClosedForGood) {
    setWasClosedForGood(closedForGood);
    if (closedForGood) resetForm();
  }
  // A job whose upload failed and was given up on is deleted, not left
  // "uploading" in the list. (Here, not in resetForm: that runs during
  // render.)
  const { discard } = upload;
  useEffect(() => {
    if (!closedForGood) return;
    discard();
  }, [closedForGood, discard]);

  function resetForm() {
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
    setVegetation(false);
  }

  // Tile count driving the cost projection: the ZIP's verified count once one
  // has been validated, else the drawn area's conservative estimate so the
  // warning appears before the user goes off to download gigabytes from ELVIS.
  const area = pendingBbox ? bboxAreaKm2(pendingBbox) : null;
  const estimatedTiles = area != null ? estimateElvisTileCount(area) : null;
  const activeTileCount =
    offer.mode === "upload" ? (stats?.tileCount ?? estimatedTiles) : null;

  // Credits are not derivable client-side: the tiles-to-seconds rate is fitted
  // server-side from recent real runtimes, so the projection has to be asked
  // for. Cheap (two DB reads, nothing written) and re-asked whenever the tile
  // count changes. No count (or a closed dialog) clears the projection, during
  // render when either changes.
  const [estimateKey, setEstimateKey] = useState({ open, activeTileCount });
  if (
    open !== estimateKey.open ||
    !Object.is(activeTileCount, estimateKey.activeTileCount)
  ) {
    setEstimateKey({ open, activeTileCount });
    if (!open || !activeTileCount) {
      setJobCredits(null);
      setJobSeconds(null);
      setJobWouldExceed(false);
    }
  }
  useEffect(() => {
    if (!open || !activeTileCount) return;
    let cancelled = false;
    fetchComputeEstimate({ kind: "topo", tileCount: activeTileCount })
      .then((estimate) => {
        if (cancelled) return;
        setJobCredits(estimate.credits);
        setJobSeconds(estimate.estimatedSeconds);
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
      // a toast, but log the failure in the console rather than leaving it
      // fully silent.
      .catch((err) => console.error(err));
  }, [open]);

  // A new file (or none) clears the last one's verdict, during render; the
  // effect reads the new one.
  const [validatedFile, setValidatedFile] = useState(file);
  if (file !== validatedFile) {
    setValidatedFile(file);
    setStats(null);
    setValidationError(null);
    if (file) setValidating(true);
  }
  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    (async () => {
      try {
        const entries = await readZipEntries(
          file.size,
          async (start, end) =>
            new Uint8Array(await file.slice(start, end).arrayBuffer()),
        );
        const s = classifyElvisEntries(entries);
        if (!cancelled) setStats(s);
      } catch (e) {
        if (!cancelled) {
          setValidationError(
            e instanceof ElvisZipError
              ? e.sentence
              : t`Could not read this ZIP file.`,
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
  // untouched. Adjusted during render: it follows stats and the name list.
  const region =
    stats && !topoNameTouched
      ? regionNameFromSurvey(stats.surveyNames[0] ?? "")
      : null;
  const prefilledName = region ? nextTopoName(region, existingTopoNames) : null;
  if (prefilledName !== null && prefilledName !== topoName) {
    setTopoName(prefilledName);
  }

  function onFilePicked(picked: File) {
    if (!picked.name.toLowerCase().endsWith(".zip")) {
      setValidationError(t`Select a .zip file.`);
      return;
    }
    // A new ZIP is a new job: the stopped one is let go, and with it the lock
    // on its name and settings.
    upload.discard();
    setFile(picked);
    setError(null);
  }

  async function handleSubmit() {
    if (offer.mode !== "upload") return;
    if (!file || !stats) {
      setError(t`Choose your LiDAR ZIP first.`);
      return;
    }
    // validationError is already in the banner above the form.
    if (validationError) return;
    setError(null);

    if (
      storageUsed !== null &&
      storageQuota !== null &&
      storageUsed >= storageQuota
    ) {
      setError(
        t`Storage quota is full. Free space by deleting old LiDAR maps before submitting a new one.`,
      );
      return;
    }

    if (creditsUsed !== null && creditsQuota !== null && jobCredits !== null) {
      if (creditsUsed + jobCredits > creditsQuota) {
        const remaining = Math.max(0, creditsQuota - creditsUsed);
        const needs = formatCreditsLike(jobCredits, creditsQuota);
        const left = formatCreditsLike(remaining, creditsQuota);
        setError(
          creditsResetAt
            ? t`Not enough processing credits. This job needs about ${needs} but only ${left} remain. Allowance resets ${formatDayMonth(localDay(new Date(creditsResetAt)))}.`
            : t`Not enough processing credits. This job needs about ${needs} but only ${left} remain.`,
        );
        return;
      }
    }

    setUploadedBytes(0);
    setTotalBytes(file.size);
    setPhase("uploading");
    let uploaded = false;
    try {
      // On a resubmit after a failure this carries on with the same job, so
      // the name and tick are the ones it was first sent with.
      const jobId = await upload.submit(
        file,
        {
          tileCount: stats.tileCount || null,
          jobName: topoName.trim() || stats.surveyNames[0] || null,
          filename: file.name,
          ...sharpenJobRequest(vegetation && offer.vegetation, stats.lazCount),
        },
        {
          progress: (sent, total) => {
            setUploadedBytes(sent);
            setTotalBytes(total);
          },
          uploaded: () => {
            uploaded = true;
            setPhase("finalizing");
          },
        },
      );

      const newJob = await apiFetch<TopoJob>(`/topo-jobs/${jobId}`);
      onJobCreated(newJob);
      setSubmittedJob(newJob);
      setPhase("done");
    } catch (e: unknown) {
      console.error(e);
      setError(submitFailureMessage(e, uploaded));
      // File preserved so Make it can resubmit.
      setPhase("form");
    }
  }

  function performClose() {
    // Block closing mid-upload: closing gives up on the upload.
    if (phase === "uploading" || phase === "finalizing") return;
    onClose();
  }

  // Dirty once a ZIP has been picked and not yet submitted — losing a queued
  // multi-GB upload to a stray Esc is real lost work. Keyed to the file only,
  // and the confirm copy is narrowed to match. Once submission starts (uploading/
  // finalizing) close is already blocked above; once done there's nothing left
  // to lose.
  const isDirty = phase === "form" && file != null;

  const uploading = phase === "uploading" || phase === "finalizing";
  const uploadPct =
    totalBytes > 0
      ? Math.min(100, Math.round((uploadedBytes / totalBytes) * 100))
      : 0;
  const backToForm = () => setMode("form");

  const jobCopy = LIDAR_JOB_COPY;
  const portal = offer.mode === "upload" ? offer.portal : null;
  const off = phase === "form" && offer.mode === "off";
  const title =
    phase === "uploading"
      ? t`Uploading`
      : phase === "finalizing"
        ? t`Almost there`
        : phase === "done"
          ? t`On its way`
          : mode === "instructions" && portal
            ? t`Getting LiDAR from ${portal.name}`
            : jobCopy.make;

  return (
    <>
      <Dialog
        open={open}
        title={title}
        size="large"
        dismissible={!uploading}
        // Inside a sub-view every way out means "back to the form", never
        // "throw away the ZIP I just chose".
        onClose={mode === "form" || off ? performClose : backToForm}
        discard={
          isDirty && mode === "form" && !off
            ? abandonConfirm("request", true)
            : null
        }
        // Where sharpening is off the dialog has nothing to send or go back
        // to: the header's Close is its way out.
        footer={(requestClose) =>
          uploading ? undefined : phase === "done" ? (
            <Button variant="filled" onClick={onClose}>{t`Done`}</Button>
          ) : off ? undefined : mode !== "form" && portal ? (
            <Button
              variant="filled"
              onClick={backToForm}
            >{t`Back to the form`}</Button>
          ) : (
            <>
              <Button onClick={requestClose}>{t`Cancel`}</Button>
              <Button
                variant="filled"
                onClick={handleSubmit}
                busy={validating}
              >{t`Make it`}</Button>
            </>
          )
        }
      >
        {uploading ? (
          <div className={classes.working}>
            <p className={classes.workingLine}>
              {phase === "uploading"
                ? t`Uploading your LiDAR. Keep this window open until it finishes.`
                : jobCopy.startingLine}
            </p>
            <ProgressBar
              label={
                phase === "uploading" ? t`Upload progress` : jobCopy.starting
              }
              value={phase === "uploading" ? uploadPct : undefined}
            />
            {phase === "uploading" && (
              <p className={classes.workingDetail}>
                {totalBytes > 0
                  ? t`${(uploadedBytes / 1e6).toFixed(1)} of ${(totalBytes / 1e6).toFixed(1)} MB · ${uploadPct}%`
                  : t`${(uploadedBytes / 1e6).toFixed(1)} of ${(totalBytes / 1e6).toFixed(1)} MB`}
              </p>
            )}
          </div>
        ) : phase === "done" ? (
          <div className={classes.done}>
            <Icon
              idea="success"
              size={40}
              aria-hidden
              className={classes.doneGlyph}
            />
            <p className={classes.doneName}>
              {submittedJob?.name ?? jobCopy.unnamed} {jobCopy.beingMade}
            </p>
            <p className={classes.workingDetail}>
              {[
                stats?.tileCount
                  ? plural(stats.tileCount, "# area queued.", "# areas queued.")
                  : "",
                jobSeconds ? t`It takes ${formatMinutes(jobSeconds)}.` : "",
                t`We'll let you know when it's ready. You can close this.`,
              ]
                .filter(Boolean)
                .join(" ")}
            </p>
          </div>
        ) : offer.mode === "off" ? (
          <div className={classes.form}>
            <SectionHeader title={MAP_TERRAIN.copy.notHere} />
            <p className={classes.stepLine}>{offer.reason}</p>
          </div>
        ) : mode === "instructions" && portal?.steps === "elvis" ? (
          <ElvisInstructions
            portal={portal}
            pendingBbox={pendingBbox}
            area={area}
            onSelectBbox={onSelectBbox}
            warnCredits={jobWouldExceed && stats === null}
          />
        ) : mode === "instructions" && portal ? (
          <LinkInstructions portal={portal} />
        ) : (
          <div className={classes.form}>
            <p
              className={classes.wideHint}
            >{t`This is easier on a bigger screen.`}</p>

            {(validationError || error) && (
              <ErrorBanner message={validationError ?? error!} />
            )}

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
              <Icon
                idea="upload"
                size={28}
                aria-hidden
                className={classes.dropGlyph}
              />
              <span className={classes.dropLine}>
                {file
                  ? file.name
                  : t`Drop your ${offer.portal.name} ZIP here, or select it in your file system.`}
              </span>
              <span className={classes.dropHint}>
                {file
                  ? t`Choose a different file`
                  : offer.portal.steps === "elvis"
                    ? t`No need to unzip it.`
                    : t`Put all the files in one ZIP.`}
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
              <Button
                icon="info"
                compact
                variant="outline"
                onClick={() => setMode("instructions")}
              >
                {offer.portal.steps === "elvis"
                  ? t`Haven't got one? Order LiDAR from ${offer.portal.name}`
                  : t`Haven't got one? Get LiDAR from ${offer.portal.name}`}
              </Button>
            </div>

            {validating && (
              <p
                className={classes.workingDetail}
                role="status"
              >{t`Reading your ZIP…`}</p>
            )}

            {stats && !validating && (
              <ZipSummary
                stats={stats}
                creditsUsed={creditsUsed}
                creditsQuota={creditsQuota}
                jobCredits={jobCredits}
              />
            )}

            <TextField
              label={t`Name`}
              placeholder={t`Name this area`}
              disabled={upload.held}
              aria-describedby={upload.held ? HELD_REASON_ID : undefined}
              value={topoName}
              onChange={(e) => {
                setTopoName(e.target.value);
                setTopoNameTouched(true);
              }}
            />
            {upload.held && (
              <p id={HELD_REASON_ID} className={classes.summaryNote}>
                {KEPT_FOR_RESUME}
              </p>
            )}

            {offer.vegetation && stats && stats.lazCount > 0 && (
              <Checkbox
                label={t`Vegetation (experimental)`}
                description={t`Also draws how thick the scrub is from the point clouds, which takes longer.`}
                checked={vegetation}
                disabled={upload.held}
                describedBy={upload.held ? HELD_REASON_ID : undefined}
                onChange={setVegetation}
              />
            )}
          </div>
        )}
      </Dialog>
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
    [t`Survey`, stats.surveyNames.join(", ") || "—"],
    [t`Mode`, stats.modeLabel],
    [t`Areas`, String(stats.tileCount)],
    stats.lazCount > 0
      ? [
          t`Point clouds`,
          stats.overlappingSurveys
            ? plural(
                stats.tileCount,
                "{0}× .laz over # area",
                "{0}× .laz over # areas",
                stats.lazCount,
              )
            : `${stats.lazCount}× .laz`,
        ]
      : null,
    stats.demCount > 0
      ? [
          t`DEM`,
          `${stats.demCount}× .tif${stats.demResolutionMeters != null ? ` @ ${formatFixedMetres(stats.demResolutionMeters)}` : ""}`,
        ]
      : null,
    [t`Size`, formatBytes(stats.uncompressedBytes)],
    // Unambiguous quota copy: creditsUsed already includes any queued/running
    // jobs (the server sums non-failed jobs this month), so show the current
    // figure and the projection side by side instead of a bare "N / Q after
    // this job".
    creditsUsed !== null && creditsQuota !== null
      ? [
          t`Credits`,
          jobCredits !== null
            ? t`${formatCreditsOf(creditsUsed, creditsQuota)} used this month · about ${formatCreditsLike(jobCredits, creditsQuota)} for this one`
            : t`${formatCreditsOf(creditsUsed, creditsQuota)} used this month · we can't tell yet what this one will cost`,
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
          {plural(
            stats.derivativeTifCount,
            "# ready-made raster in here (hillshade and the like) will be ignored — yours are drawn from the survey itself.",
            "# ready-made rasters in here (hillshade and the like) will be ignored — yours are drawn from the survey itself.",
          )}
        </p>
      )}
      {stats.overlappingSurveys && (
        <p
          className={classes.summaryNote}
        >{t`More than one survey covers this ground. The best of them is used for each layer — the densest for terrain, the most recent for vegetation — at no extra cost.`}</p>
      )}
    </div>
  );
}

/**
 * The errand: draw the area, take its shapefile to ELVIS, order the tiles.
 * Numbered, because it is done in order and in another tab.
 */
function ElvisInstructions({
  portal,
  pendingBbox,
  area,
  onSelectBbox,
  warnCredits,
}: {
  portal: SharpenPortal;
  pendingBbox: TBbox | null;
  area: number | null;
  onSelectBbox: () => void;
  warnCredits: boolean;
}) {
  return (
    <ol className={classes.steps}>
      <li className={classes.step}>
        <div className={classes.stepBody}>
          <SectionHeader title={t`Mark out what you want covered`} />
          <div className={classes.stepControls}>
            <Button
              icon="pickArea"
              compact
              variant="outline"
              onClick={onSelectBbox}
            >
              {pendingBbox ? t`Draw it again` : t`Draw the area`}
            </Button>
            {pendingBbox && area != null && (
              <StatusPill label={formatArea(area)} />
            )}
            {pendingBbox && (
              <Button
                compact
                variant="outline"
                onClick={() => downloadBboxShapefile(pendingBbox)}
              >{t`Download its shapefile`}</Button>
            )}
          </div>
          {warnCredits && (
            <FieldError
              message={t`An area this size may cost more credits than you have left this month. Try a smaller one.`}
            />
          )}
        </div>
      </li>

      <li className={classes.step}>
        <div className={classes.stepBody}>
          <SectionHeader title={t`Order the data from ELVIS`} />
          <p className={classes.stepLine}>
            <Rich
              parts={rich`In ELVIS, choose <strong>Order Data</strong>, then <strong>Load File</strong> and give it the shapefile. Then press <strong>Search</strong>.`}
              tags={STRONG}
            />
          </p>
          <div className={classes.stepControls}>
            <Button
              icon="openExternal"
              compact
              variant="outline"
              onClick={() =>
                window.open(portal.url, "_blank", "noopener,noreferrer")
              }
            >{t`Open the ELVIS portal`}</Button>
          </div>
        </div>
      </li>

      <li className={classes.step}>
        <div className={classes.stepBody}>
          <SectionHeader title={t`Take the 1 m or 2 m DEM`} />
          <p className={classes.stepLine}>
            <Rich
              parts={rich`Under <strong>NSW Government — Spatial Services</strong> → <strong>Digital Elevation Model</strong>, select the 1 m or 2 m DEM, not the 5 m one: Logjam already has that for all of NSW.`}
              tags={STRONG}
            />
          </p>
          <p className={classes.stepLine}>
            <Rich
              parts={rich`Take the <strong>Point Clouds</strong> too if you want the vegetation layer, which is drawn from them.`}
              tags={STRONG}
            />
          </p>
        </div>
      </li>

      <li className={classes.step}>
        <div className={classes.stepBody}>
          <SectionHeader title={t`Have it sent to you`} />
          <p className={classes.stepLine}>
            <Rich
              parts={rich`Under <strong>Industry</strong>, choose <strong>Recreation</strong>. Enter your email and press <strong>Order datasets</strong>. ELVIS emails you a link to the ZIP — that ZIP is what you bring back here.`}
              tags={STRONG}
            />
          </p>
        </div>
      </li>
    </ol>
  );
}

/**
 * A portal with no errand of its own: where to get the survey, and that what
 * comes back here is one ZIP (the upload reads a ZIP's directory, and some
 * portals serve loose point-cloud files).
 */
function LinkInstructions({ portal }: { portal: SharpenPortal }) {
  return (
    <ol className={classes.steps}>
      <li className={classes.step}>
        <div className={classes.stepBody}>
          <SectionHeader title={t`Get the LiDAR from ${portal.name}`} />
          <p className={classes.stepLine}>
            {t`Find the survey of the ground you want covered and download it.`}
          </p>
          <div className={classes.stepControls}>
            <Button
              icon="openExternal"
              compact
              variant="outline"
              onClick={() =>
                window.open(portal.url, "_blank", "noopener,noreferrer")
              }
            >
              {t`Open the ${portal.name} portal`}
            </Button>
          </div>
        </div>
      </li>

      <li className={classes.step}>
        <div className={classes.stepBody}>
          <SectionHeader title={t`Put the files in one ZIP`} />
          <p className={classes.stepLine}>
            {t`Logjam reads one ZIP. If the files came loose, put them all in a ZIP, then bring it back here.`}
          </p>
        </div>
      </li>
    </ol>
  );
}
