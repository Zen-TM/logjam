// Layers → Terrain → Sharpened areas: the areas the user has made or been sent,
// and what is still being made. The verbs moved here from Maps → LiDAR topos
// unchanged: the confirm copy, the share promise, the refetch and quota refresh.
import { useMemo, useState } from "react";
import {
  incomingLabel,
  LIDAR_JOB_COPY,
  lidarJobSharePromise,
  removeSharedAreaConfirm,
  plural,
  t,
  type SharePromiseKind,
  type SharpenUnavailable,
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
  LoadingState,
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
  loaded,
  onSharpen,
  sharpenOff,
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
  /** False until the first fetch of completed areas settles (shared/DESIGN.md §11). */
  loaded: boolean;
  /** Opens the dialog for a new area, as the tray's Sharpen an area does. */
  onSharpen: () => void;
  /** Set where the region in view has no sharpening: the button says why. */
  sharpenOff: SharpenUnavailable | null;
  /** Make a map, over a sharpened area's footprint. */
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
            label: t`Make a map…`,
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
          label: t`Share…`,
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
          label: t`Delete`,
          icon: "delete",
          danger: true,
          onSelect: () =>
            ask({
              copy: {
                confirmTitle: t`Delete ${label}?`,
                confirmBody: t`The sharpened area is deleted from your account, and friends you shared it with lose it too. Map files already made from it stay until they expire; one still waiting to start is cancelled.`,
                confirmLabel: t`Delete`,
                tone: "destructive",
              },
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
                      t`Couldn't delete the sharpened area. Try again.`,
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
    const confirm = removeSharedAreaConfirm({
      itemName: label,
    });
    return [
      ...exportEntry,
      { id: "remove-sep", separator: true },
      {
        id: "removeShare",
        label: t`Remove`,
        icon: "close",
        onSelect: () =>
          ask({
            copy: {
              confirmTitle: confirm.title,
              confirmBody: confirm.body,
              confirmLabel: t`Remove`,
              tone: "filled",
            },
            run: async () => {
              try {
                await unshareEntityWith("topoJob", job.jobId, "me");
                toast.done(t`${label} removed.`);
                onRefetchCompletedTopoJobs();
              } catch (err) {
                console.error(err);
                toast.error(
                  messageFromError(
                    err,
                    t`Couldn't remove that sharpened area.`,
                  ),
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
        <IconButton icon="back" label={t`Back to terrain`} onClick={onBack} />
        <div className={classes.titleBlock}>
          <span className={classes.title}>{t`Sharpened areas`}</span>
          {loaded && (
            <span className={classes.subtitle}>
              {plural(completedTopoJobs.length, "# area", "# areas")}
            </span>
          )}
        </div>
        <Button
          compact
          variant="filled"
          icon="lidar"
          onClick={onSharpen}
          disabled={sharpenOff !== null}
          disabledReason={
            sharpenOff ? t`${sharpenOff.state}. ${sharpenOff.reason}` : ""
          }
        >
          {LIDAR_JOB_COPY.make}
        </Button>
        <IconButton icon="close" label={t`Close`} onClick={onClose} />
      </div>
      <div className={classes.body}>
        {!loaded && <LoadingState label={t`Loading your sharpened areas…`} />}
        {loaded && completedTopoJobs.length === 0 && beingMade.length === 0 && (
          <div className={classes.emptyLine}>
            <span>{t`None yet. Pick an area and sharpen it.`}</span>
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
                    <StatusPill label={incomingLabel(null)} tone="outline" />
                  )}
                  <Menu
                    label={t`Actions for ${label}`}
                    title={label}
                    placement="right-start"
                    entries={topoEntries(job)}
                    trigger={(props) => (
                      <IconButton
                        {...props}
                        icon="overflow"
                        label={t`Actions for ${label}`}
                      />
                    )}
                  />
                </>
              }
            />
          );
        })}
        <MakingFooter
          items={beingMade}
          onDismiss={(item) => onDismissActiveJob(item.id)}
        />
      </div>

      {shareJob && (
        <ShareDialog
          title={t`Share ${shareJob.label}`}
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
