import { useMemo, useState } from "react";
import { validateExportRequest, type ExportSelection, type TopoLayerKey } from "@logjam/shared";
import { apiFetch } from "../../placeUtils";
import { messageFromError } from "../../errors/messageFromError";
import { ErrorBanner } from "../feedback/ErrorBanner";
import { type CompletedTopoJob } from "../../topoLayerTypes";
import { Button, Dialog } from "../../ui";
import TopoExportControls from "./TopoExportControls";
import classes from "./topoSettings/topoSettings.module.css";

interface Props {
  open: boolean;
  onClose: () => void;
  job: CompletedTopoJob | null;
  /** Called after an export is successfully queued, so the owner can refetch
   *  the shared exports list (rendered in the LiDAR panel accordion). */
  onExportQueued: () => void;
}

const INITIAL_SELECTION: ExportSelection = {
  format: "mbtiles",
  bundling: "composite",
  layers: ["hillshade", "vegetation", "slope", "contours", "features"],
};

/**
 * Takes a finished topo out of Logjam: which format, bundled how, which layers.
 *
 * What it says in prose is what the controls cannot: that the file is derived
 * data and not a navigation aid, that the style is frozen at this moment, and
 * where the result turns up.
 */
export default function TopoExportDialog({ open, onClose, job, onExportQueued }: Props) {
  const [selection, setSelection] = useState<ExportSelection>(INITIAL_SELECTION);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only the layers this job actually produced can be exported. Absent layers
  // are hidden; the worker also drops empty layers as a backstop. TopoExportControls
  // reconciles the selection against this set.
  const jobLayerNames = useMemo(
    () => new Set<TopoLayerKey>((job?.layers ?? []).map((l) => l.name as TopoLayerKey)),
    [job],
  );

  const canSubmit = !submitting && job !== null && validateExportRequest(selection).ok;

  async function handleExport() {
    if (!job) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch<{ id: string }>("/topo-exports", {
        method: "POST",
        body: {
          sourceJobIds: [job.jobId],
          layers: selection.layers,
          format: selection.format,
          bundling: selection.bundling,
        },
      });
      onExportQueued();
      onClose();
    } catch (err) {
      console.error(err);
      setError(messageFromError(err, "Couldn't queue the export."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      title={`Export ${job?.name ?? "this topo"}`}
      size="large"
      dismissible={!submitting}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="filled" busy={submitting} disabled={!canSubmit} onClick={handleExport}>
            Start export
          </Button>
        </>
      }
    >
      {error && <ErrorBanner message={error} />}

      <TopoExportControls value={selection} onChange={setSelection} availableLayers={jobLayerNames} />

      <p className={classes.exportNote}>
        It appears under Exports and downloads itself when it is ready. Your topo
        style is frozen into it as it is now — restyling later leaves an export
        already made as it was.
      </p>
      <p className={classes.exportNote}>
        What comes out is your own data over someone else's survey, and it may be
        wrong or out of date. It is not a substitute for your own navigation,
        judgement or rescue planning.
      </p>
    </Dialog>
  );
}
