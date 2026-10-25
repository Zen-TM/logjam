// Layers → Terrain → Sharpened areas: the areas the user has made or been sent,
// and what is still being made. The verbs moved here from Maps → LiDAR topos
// unchanged: the confirm copy, the share promise, the refetch and quota refresh.
import { useMemo, useState } from "react";
import {
  LIDAR_JOB_COPY,
  lidarJobSharePromise,
  removeShareConfirm,
  type SharePromiseKind,
} from "@logjam/shared";
import {
  apiFetch,
  getEntityShares,
  shareEntityWith,
  unshareEntityWith,
  type TFriend,
} from "../../placeUtils";
import { messageFromError } from "../../errors/messageFromError";
import { useToast } from "../feedback/ToastProvider";
import type { GeoJsonPolygonal, TopoJob } from "../dialogs/TopoDialog";
import type { CompletedTopoJob } from "../../topoLayerTypes";
import ShareDialog from "../dialogs/ShareDialog";
import {
  Button,
  IconButton,
  IconTile,
  Menu,
  Row,
  StatusPill,
  type MenuEntry,
} from "../../ui";
import {
  MAP_IDENTITY,
  formatDay,
  topoLabel,
  toposBeingMade,
} from "../sidebar/panels/mapsModel";
import { MakingFooter } from "../sidebar/panels/MapsParts";
import { useConfirm } from "../sidebar/panels/useConfirm";
import classes from "./LayersPopover.module.css";

export default function SharpenedAreasView({
  onBack,
  onClose,
  activeTopoJobs,
  completedTopoJobs,
  friends,
  onSharpen,
  onExportArea,
  onFlyTo,
  onRefetchCompletedTopoJobs,
  onDismissActiveJob,
  onQuotaChanged,
}: {
  onBack: () => void;
  onClose: () => void;
  activeTopoJobs: TopoJob[];
  completedTopoJobs: CompletedTopoJob[];
  /** Friends a completed area can be shared with. */
  friends: TFriend[];
  /** Arms the pick, as the Make a map menu does. */
  onSharpen: () => void;
  /** Export an area, over a sharpened area's footprint. */
  onExportArea: (job: CompletedTopoJob) => void;
  onFlyTo: (footprint: GeoJsonPolygonal) => void;
  onRefetchCompletedTopoJobs: () => void;
  onDismissActiveJob: (jobId: string) => void;
  onQuotaChanged: () => void;
}) {
  const toast = useToast();
  const { ask, dialog } = useConfirm();
  // Non-null = the area whose share dialog is open, named as its row names it.
  const [shareJob, setShareJob] = useState<{
    id: string;
    label: string;
    promise: SharePromiseKind;
  } | null>(null);

  const beingMade = useMemo(
    () => toposBeingMade(activeTopoJobs),
    [activeTopoJobs],
  );

  const topoEntries = (job: CompletedTopoJob): MenuEntry[] => {
    const label = topoLabel(job);
    // Not owner-gated: it exports the statewide terrain over the topo's area,
    // which anyone may.
    const exportEntry: MenuEntry[] = job.footprint
      ? [
          {
            id: "export",
            label: "Export this area…",
            icon: "export",
            onSelect: () => onExportArea(job),
          },
        ]
      : [];
    if (job.syncRole === "owner") {
      return [
        ...exportEntry,
        {
          id: "share",
          label: "Share…",
          icon: "shareFriend",
          onSelect: () =>
            setShareJob({
              id: job.jobId,
              label,
              promise: lidarJobSharePromise(job),
            }),
        },
        { id: "delete-sep", separator: true },
        {
          id: "delete",
          label: "Delete",
          icon: "delete",
          danger: true,
          onSelect: () =>
            ask({
              title: `Delete ${label}?`,
              message:
                "The sharpened area is deleted from your account, and friends you shared it with lose it too. Exports already made from it stay until they expire; one still waiting to start is cancelled.",
              confirmLabel: "Delete",
              run: async () => {
                try {
                  await apiFetch(`/topo-jobs/${job.jobId}`, {
                    method: "DELETE",
                  });
                  onRefetchCompletedTopoJobs();
                  onQuotaChanged();
                } catch (err) {
                  console.error(err);
                  toast.error(
                    messageFromError(
                      err,
                      "Couldn't delete the sharpened area. Please try again.",
                    ),
                  );
                }
              },
            }),
        },
      ];
    }
    // A topo is only ever shared DIRECTLY — it has no place to inherit
    // visibility from — so a shared row always has a share of its own to drop
    // (api/src/lib/shareAccess.unit.test.ts).
    const confirm = removeShareConfirm({ kindLabel: "topo", itemName: label });
    return [
      ...exportEntry,
      { id: "remove-sep", separator: true },
      {
        id: "removeShare",
        label: "Remove",
        icon: "close",
        onSelect: () =>
          ask({
            title: confirm.title,
            message: confirm.body,
            confirmLabel: "Remove",
            tone: "primary",
            run: async () => {
              try {
                await unshareEntityWith("topoJob", job.jobId, "me");
                toast.success(`${label} removed.`);
                onRefetchCompletedTopoJobs();
              } catch (err) {
                console.error(err);
                toast.error(
                  messageFromError(err, "Couldn't remove that sharpened area."),
                );
              }
            },
          }),
      },
    ];
  };

  return (
    <>
      <div className={classes.head}>
        <IconButton icon="back" label="Back to terrain" onClick={onBack} />
        <div className={classes.titleBlock}>
          <span className={classes.title}>Sharpened areas</span>
          <span className={classes.subtitle}>
            {completedTopoJobs.length === 1
              ? "1 area"
              : `${completedTopoJobs.length} areas`}
          </span>
        </div>
        <IconButton icon="close" label="Close" onClick={onClose} />
      </div>
      <div className={classes.body}>
        {completedTopoJobs.length === 0 && (
          <div className={classes.emptyLine}>
            <span>None yet.</span>
          </div>
        )}
        {completedTopoJobs.map((job) => {
          const label = topoLabel(job);
          return (
            <Row
              key={job.jobId}
              data-topo-id={job.jobId}
              title={label}
              // A named area keeps its date beneath; an unnamed one IS its date.
              subtitle={job.name ? formatDay(job.createdAt) : undefined}
              leading={
                <IconTile
                  icon={MAP_IDENTITY.sharpened.icon}
                  hue={MAP_IDENTITY.sharpened.hue}
                  label={MAP_IDENTITY.sharpened.label}
                />
              }
              onOpen={job.footprint ? () => onFlyTo(job.footprint!) : undefined}
              trailing={
                <>
                  {job.syncRole !== "owner" && (
                    <StatusPill label="Shared" tone="outline" />
                  )}
                  <Menu
                    label={`Actions for ${label}`}
                    title={label}
                    placement="right-start"
                    entries={topoEntries(job)}
                    trigger={(props) => (
                      <IconButton
                        {...props}
                        icon="overflow"
                        label={`Actions for ${label}`}
                      />
                    )}
                  />
                </>
              }
            />
          );
        })}
        <Button compact variant="filled" icon="lidar" onClick={onSharpen}>
          {LIDAR_JOB_COPY.make}
        </Button>
        <MakingFooter
          items={beingMade}
          onDismiss={(item) => onDismissActiveJob(item.id)}
        />
      </div>

      {shareJob && (
        <ShareDialog
          title={`Share ${shareJob.label}`}
          kind={shareJob.promise}
          friends={friends}
          open
          onClose={() => setShareJob(null)}
          listShares={() => getEntityShares("topoJob", shareJob.id)}
          share={(userId) => shareEntityWith("topoJob", shareJob.id, userId)}
          unshare={(userId) =>
            unshareEntityWith("topoJob", shareJob.id, userId)
          }
        />
      )}

      {dialog}
    </>
  );
}
