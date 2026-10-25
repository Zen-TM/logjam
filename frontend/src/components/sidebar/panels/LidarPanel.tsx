// Maps → LiDAR topos: the topos the user has made or been sent, and what is
// still being made.
//
// The page answers "what maps have I made, and what is still being made?"
// (shared/DESIGN.md §2): the hero counts the topos, and what is still being
// made is pinned under the list so in-flight progress stays immediately
// visible.
//
// A topo's body CENTRES the map on it (DESIGN.md, "Opening a thing centres
// the map on it"). A sharpened area is drawn by the Terrain group, so whether
// it is drawn is not this page's business.
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
} from "../../../placeUtils";
import { messageFromError } from "../../../errors/messageFromError";
import { useToast } from "../../feedback/ToastProvider";
import type { GeoJsonPolygonal, TopoJob } from "../../dialogs/TopoDialog";
import type { CompletedTopoJob } from "../../../topoLayerTypes";
import ShareDialog from "../../dialogs/ShareDialog";
import {
  Button,
  EmptyState,
  Hero,
  IconButton,
  IconTile,
  ListEnd,
  Menu,
  Row,
  StatusPill,
  type MenuEntry,
  LoadingState,
} from "../../../ui";
import {
  MAP_IDENTITY,
  formatDay,
  plural,
  topoLabel,
  toposBeingMade,
} from "./mapsModel";
import { MakingFooter } from "./MapsParts";
import { useConfirm } from "./useConfirm";
import classes from "./MapsPanel.module.css";

const MAKE_LABEL = LIDAR_JOB_COPY.make;

export default function LidarPanel({
  views,
  activeTopoJobs,
  completedTopoJobs,
  topoJobsLoaded,
  friends,
  onOpenTopo,
  onExportArea,
  onTopoFlyTarget,
  onRefetchCompletedTopoJobs,
  onDismissActiveJob,
  onQuotaChanged,
}: {
  /** The Maps view switch, drawn under this view's hero (DESIGN.md). */
  views: React.ReactNode;
  activeTopoJobs: TopoJob[];
  completedTopoJobs: CompletedTopoJob[];
  /** False until the first fetch of completed topos settles (shared/DESIGN.md §11). */
  topoJobsLoaded: boolean;
  /** Friends a completed topo can be shared with. */
  friends: TFriend[];
  onOpenTopo: () => void;
  /** Export an area, over a topo's footprint. */
  onExportArea: (job: CompletedTopoJob) => void;
  onTopoFlyTarget: (footprint: GeoJsonPolygonal) => void;
  onRefetchCompletedTopoJobs: () => void;
  onDismissActiveJob: (jobId: string) => void;
  onQuotaChanged: () => void;
}): React.JSX.Element {
  const toast = useToast();
  const { ask, dialog } = useConfirm();
  // Non-null = the topo whose share dialog is open, named as its row names it.
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
                "The topo and its layers are deleted from your account, and friends you shared it with lose it too. Exports already made from it stay until they expire; one still waiting to start is cancelled.",
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
                      "Couldn't delete LiDAR topo. Please try again.",
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
                  messageFromError(err, "Couldn't remove that topo."),
                );
              }
            },
          }),
      },
    ];
  };

  const hero = (
    <Hero
      title={
        !topoJobsLoaded
          ? "LiDAR topos"
          : completedTopoJobs.length === 0
            ? "No LiDAR topos yet"
            : plural(completedTopoJobs.length, "LiDAR topo")
      }
      actions={
        <>
          <Menu
            label={MAKE_LABEL}
            placement="bottom-end"
            entries={[
              {
                id: "make",
                label: MAKE_LABEL,
                icon: "lidar",
                onSelect: onOpenTopo,
              },
            ]}
            trigger={(props) => (
              <Button
                {...props}
                compact
                variant="filled"
                icon="add"
                trailingIcon="expand"
              >
                Make
              </Button>
            )}
          />
        </>
      }
    />
  );

  const nothingYet =
    topoJobsLoaded && completedTopoJobs.length === 0 && beingMade.length === 0;

  // The same button is the empty state's and the end of the list's.
  const makeTopoButton = (
    <Button compact variant="filled" icon="lidar" onClick={onOpenTopo}>
      {MAKE_LABEL}
    </Button>
  );

  const list = !topoJobsLoaded ? (
    <div className={classes.emptyArea} role="status">
      <LoadingState label="Loading your LiDAR topos…" />
    </div>
  ) : nothingYet ? (
    <div className={classes.emptyArea}>
      <EmptyState
        icon="lidar"
        title="No LiDAR topos yet"
        body="Pick an area and order its LiDAR from the government's survey: Logjam Web draws the contours, slope and hillshade there at the survey's own detail."
        actions={makeTopoButton}
      />
    </div>
  ) : (
    <div className={classes.list}>
      <section className={classes.section} aria-labelledby="maps-topos">
        {/* The hero is the heading: one that says "6 LiDAR topos" over one
            that says "LIDAR TOPOS 6" is the same line drawn twice. */}
        <h3 id="maps-topos" className="visually-hidden">
          LiDAR topos
        </h3>
        {completedTopoJobs.length === 0 && (
          <p className={classes.note}>None finished yet.</p>
        )}
        {completedTopoJobs.map((job) => {
          const label = topoLabel(job);
          return (
            <Row
              key={job.jobId}
              data-topo-id={job.jobId}
              title={label}
              // A named topo keeps its date beneath; an unnamed one IS its date.
              subtitle={job.name ? formatDay(job.createdAt) : undefined}
              description={MAP_IDENTITY.sharpened.label}
              leading={
                <IconTile
                  icon={MAP_IDENTITY.sharpened.icon}
                  hue={MAP_IDENTITY.sharpened.hue}
                  label={MAP_IDENTITY.sharpened.label}
                />
              }
              onOpen={
                job.footprint
                  ? () => onTopoFlyTarget(job.footprint!)
                  : undefined
              }
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
      </section>
      <ListEnd>{makeTopoButton}</ListEnd>
    </div>
  );

  return (
    <div className={classes.root}>
      {hero}
      <div className={classes.rails}>{views}</div>
      {list}
      <MakingFooter
        items={beingMade}
        onDismiss={(item) => onDismissActiveJob(item.id)}
      />

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
    </div>
  );
}
