// Maps → Exports: the files made by Export an area (and, until their 7 days
// run out, exports of LiDAR topos), and the exports still being made.
import { useCallback, useMemo } from "react";
import { type TopoExportJobView } from "@logjam/shared";
import { deleteTopoExport } from "../../../placeUtils";
import { messageFromError } from "../../../errors/messageFromError";
import { useToast } from "../../feedback/ToastProvider";
import type { CompletedTopoJob } from "../../../topoLayerTypes";
import {
  Button,
  EmptyState,
  ErrorState,
  Hero,
  IconButton,
  IconTile,
  ListEnd,
  LoadingState,
  Menu,
  Row,
  type MenuEntry,
} from "../../../ui";
import {
  MAP_IDENTITY,
  downloadFile,
  exportFormatLabel,
  exportLabel,
  exportsBeingMade,
  fileSubtitle,
  plural,
  topoNamesById,
  type MakingItem,
} from "./mapsModel";
import { MakingFooter } from "./MapsParts";
import { useConfirm } from "./useConfirm";
import classes from "./MapsPanel.module.css";

export default function ExportsPanel({
  views,
  topoExports,
  topoExportsTotal,
  loaded,
  error,
  completedTopoJobs,
  onRefetchTopoExports,
  onQuotaChanged,
  onOpenExport,
}: {
  /** The Maps view switch, drawn under this view's hero (DESIGN.md). */
  views: React.ReactNode;
  topoExports: TopoExportJobView[];
  topoExportsTotal: number | null;
  /** False until the first fetch settles: loading is not empty
   *  (shared/DESIGN.md §11). */
  loaded: boolean;
  /** Why the last fetch failed; with nothing to list, it is said in place of
   *  the empty state, with Try again. */
  error: string | null;
  /** Only to name an older export after the topo it was made from. */
  completedTopoJobs: CompletedTopoJob[];
  onRefetchTopoExports: () => void;
  onQuotaChanged: () => void;
  onOpenExport: () => void;
}): React.JSX.Element {
  const toast = useToast();
  const { ask, dialog } = useConfirm();

  const topoNames = useMemo(
    () => topoNamesById(completedTopoJobs),
    [completedTopoJobs],
  );
  const beingMade = useMemo(
    () => exportsBeingMade(topoExports, topoNames),
    [topoExports, topoNames],
  );
  const finished = useMemo(
    () => topoExports.filter((each) => each.status === "completed"),
    [topoExports],
  );

  const deleteExport = useCallback(
    async (id: string, failed: boolean) => {
      try {
        await deleteTopoExport(id);
        onRefetchTopoExports();
        // A failed export holds no bytes, so there is no quota to refresh.
        if (!failed) onQuotaChanged();
      } catch (err) {
        console.error(err);
        toast.error(
          messageFromError(
            err,
            failed ? "Couldn't dismiss export." : "Couldn't delete export.",
          ),
        );
      }
    },
    [onRefetchTopoExports, onQuotaChanged, toast],
  );

  const entries = (
    exportJob: TopoExportJobView,
    label: string,
  ): MenuEntry[] => [
    ...(exportJob.downloadUrl
      ? [
          {
            id: "download",
            label: "Download",
            icon: "download" as const,
            onSelect: () => downloadFile(exportJob.downloadUrl!),
          },
        ]
      : []),
    { id: "delete-sep", separator: true },
    {
      id: "delete",
      label: "Delete",
      icon: "delete",
      danger: true,
      onSelect: () =>
        ask({
          title: `Delete the ${exportFormatLabel(exportJob.format)} export of ${label}?`,
          message: exportJob.bbox
            ? "The exported file is deleted."
            : "The exported file is deleted. The topo it was made from stays.",
          confirmLabel: "Delete",
          run: () => deleteExport(exportJob.id, false),
        }),
    },
  ];

  const nothing = finished.length === 0 && beingMade.length === 0;
  const failed = loaded && error !== null && nothing;

  // The same button is the hero's, the empty state's and the end of the list's.
  const exportAreaButton = (
    <Button compact variant="filled" icon="export" onClick={onOpenExport}>
      Export an area
    </Button>
  );

  return (
    <div className={classes.root}>
      <Hero
        title={
          !loaded || failed
            ? "Exports"
            : finished.length === 0
              ? "No exports yet"
              : plural(finished.length, "export")
        }
        actions={exportAreaButton}
      />
      <div className={classes.rails}>{views}</div>
      {!loaded ? (
        <div className={classes.emptyArea} role="status">
          <LoadingState label="Loading your exports…" />
        </div>
      ) : failed ? (
        <div className={classes.emptyArea}>
          <ErrorState message={error} onRetry={onRefetchTopoExports} />
        </div>
      ) : nothing ? (
        <div className={classes.emptyArea}>
          <EmptyState
            icon="export"
            title="No exports yet"
            body="Draw a box on the map and take its contours, slope, hillshade and heights into a GIS or an offline map app. Exports are kept for 7 days."
            actions={exportAreaButton}
          />
        </div>
      ) : (
        <div className={classes.list}>
          <section className={classes.section} aria-labelledby="maps-exports">
            <h3 id="maps-exports" className="visually-hidden">
              Exports
            </h3>
            {/* The server's TOPO_EXPORT_TTL_MS sweep. */}
            <p className={classes.note}>Kept for 7 days after they're made.</p>
            {finished.map((exportJob) => {
              const label = exportLabel(exportJob, topoNames);
              return (
                <Row
                  key={exportJob.id}
                  data-export-id={exportJob.id}
                  title={label}
                  subtitle={fileSubtitle({
                    format: exportFormatLabel(exportJob.format),
                    bytes: exportJob.resultBytes,
                    createdAt: exportJob.createdAt,
                  })}
                  description={MAP_IDENTITY.export.label}
                  leading={
                    <IconTile
                      icon={MAP_IDENTITY.export.icon}
                      hue={MAP_IDENTITY.export.hue}
                      label={MAP_IDENTITY.export.label}
                    />
                  }
                  // A real anchor, so middle-click and "save as" work.
                  href={exportJob.downloadUrl ?? undefined}
                  download=""
                  trailing={
                    <Menu
                      label={`Actions for ${label}`}
                      title={label}
                      placement="right-start"
                      entries={entries(exportJob, label)}
                      trigger={(props) => (
                        <IconButton
                          {...props}
                          icon="overflow"
                          label={`Actions for ${label}`}
                        />
                      )}
                    />
                  }
                />
              );
            })}
            {topoExportsTotal != null &&
              topoExportsTotal > topoExports.length && (
                <p className={classes.note}>
                  Showing your {topoExports.length} most recent exports of{" "}
                  {topoExportsTotal}. Older ones aren’t loaded.
                </p>
              )}
          </section>
          <ListEnd>{exportAreaButton}</ListEnd>
        </div>
      )}
      <MakingFooter
        items={beingMade}
        onDismiss={(item: MakingItem) => void deleteExport(item.id, true)}
      />
      {dialog}
    </div>
  );
}
