// Maps → GeoPDFs: the printable maps the user has made, and the ones still
// being made.
//
// The page answers "what maps have I made, and what is still being made?"
// (shared/DESIGN.md §2). Its hero counts the finished GeoPDFs, and what is
// still being made is pinned under the list so in-flight progress stays
// immediately visible.
//
// A GeoPDF's body DOWNLOADS it. A PDF has nowhere in this app to open to — the
// list view carries no extent to centre the map on — and in a browser opening a
// PDF is fetching it. Its ⋯ holds every verb, Download first (DESIGN.md).
import { useCallback, useEffect, useMemo, useState } from "react";
import { removeShareConfirm } from "@logjam/shared";
import {
  deleteGeoPdfJob,
  getEntityShares,
  shareEntityWith,
  unshareEntityWith,
  useGeoPdfJobs,
  type TFriend,
} from "../../../placeUtils";
import { messageFromError } from "../../../errors/messageFromError";
import { useToast } from "../../feedback/ToastProvider";
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
  downloadFile,
  fileSubtitle,
  geoPdfLabel,
  geoPdfsBeingMade,
  plural,
} from "./mapsModel";
import { MakingFooter } from "./MapsParts";
import { useConfirm } from "./useConfirm";
import classes from "./MapsPanel.module.css";

export default function GeoPdfsPanel({
  views,
  onOpenGeoPdf,
  geoPdfJobsRefetch,
  friends,
  loadsUserData,
}: {
  /** The Maps view switch, drawn under this view's hero (DESIGN.md). */
  views: React.ReactNode;
  onOpenGeoPdf: () => void;
  geoPdfJobsRefetch: number;
  /** Friends a generated GeoPDF can be shared with. */
  friends: TFriend[];
  /** App's own `authenticated && consentSettled` — the value every
   *  user-data hook in this app takes as `enabled`. Nothing here fetches — the
   *  job poll included — until it is true. */
  loadsUserData: boolean;
}): React.JSX.Element {
  const toast = useToast();
  const { ask, dialog } = useConfirm();
  // Non-null = the GeoPDF whose share dialog is open, with the row's own words
  // so the dialog's title matches what was pressed.
  const [shareJob, setShareJob] = useState<{
    id: string;
    label: string;
  } | null>(null);
  const {
    jobs,
    total: jobsTotal,
    loaded: jobsLoaded,
    error: jobsError,
    refetch: refetchJobs,
  } = useGeoPdfJobs(loadsUserData);

  useEffect(() => {
    if (geoPdfJobsRefetch > 0) refetchJobs();
  }, [geoPdfJobsRefetch, refetchJobs]);

  useEffect(() => {
    if (jobsError) toast.error(jobsError);
  }, [jobsError, toast]);

  const deleteJob = useCallback(
    async (id: string) => {
      try {
        await deleteGeoPdfJob(id);
        refetchJobs();
      } catch (err) {
        console.error(err);
        toast.error(messageFromError(err, "Couldn't delete GeoPDF."));
      }
    },
    [refetchJobs, toast],
  );

  // `jobs` arrives newest first (GET /geo-pdf orders by createdAt desc), and
  // filtering keeps that order.
  const beingMade = useMemo(() => geoPdfsBeingMade(jobs), [jobs]);
  const made = useMemo(
    () => jobs.filter((job) => job.status === "completed"),
    [jobs],
  );

  const entriesFor = (job: (typeof made)[number]): MenuEntry[] => {
    const label = geoPdfLabel(job);
    const download: MenuEntry[] = job.downloadUrl
      ? [
          {
            id: "download",
            label: "Download",
            icon: "download",
            onSelect: () => downloadFile(job.downloadUrl!),
          },
        ]
      : [];
    // Owner-only: a GeoPDF shared with you is yours to read and download, not
    // to share on or delete, and the API answers both with 403 — so they are
    // absent rather than offered and refused (DESIGN.md, api/src/lib/shareAccess.unit.test.ts).
    if (job.syncRole === "owner") {
      return [
        ...download,
        {
          id: "share",
          label: "Share…",
          icon: "shareFriend",
          onSelect: () => setShareJob({ id: job.id, label }),
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
                "The PDF is deleted from your account, and friends you shared it with lose it too.",
              confirmLabel: "Delete",
              run: () => deleteJob(job.id),
            }),
        },
      ];
    }
    // A GeoPDF has no place to inherit visibility from, so one that is not
    // yours always reached you on a share of its own, and that share is yours
    // to drop. NOT danger: the owner keeps the original.
    const confirm = removeShareConfirm({
      kindLabel: "GeoPDF",
      itemName: label,
    });
    return [
      ...download,
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
                await unshareEntityWith("geoPdfJob", job.id, "me");
                toast.success(`${label} removed.`);
                refetchJobs();
              } catch (err) {
                console.error(err);
                toast.error(
                  messageFromError(err, "Couldn't remove that GeoPDF."),
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
        !jobsLoaded
          ? "GeoPDFs"
          : made.length === 0
            ? "No GeoPDFs yet"
            : plural(made.length, "GeoPDF")
      }
      actions={
        <Button compact variant="filled" icon="add" onClick={onOpenGeoPdf}>
          Make
        </Button>
      }
    />
  );

  const nothingYet = jobsLoaded && jobs.length === 0;

  // The same button is the empty state's and the end of the list's.
  const makeGeoPdfButton = (
    <Button compact variant="filled" icon="geoPdf" onClick={onOpenGeoPdf}>
      Make a GeoPDF
    </Button>
  );

  const list = !jobsLoaded ? (
    <div className={classes.emptyArea} role="status">
      <LoadingState label="Loading your GeoPDFs…" />
    </div>
  ) : nothingYet ? (
    <div className={classes.emptyArea}>
      <EmptyState
        icon="geoPdf"
        title="No GeoPDFs yet"
        body="Frame an area on the map, and Logjam Web makes a map of it to print, or to load into Logjam GPS for the field."
        actions={makeGeoPdfButton}
      />
    </div>
  ) : (
    <div className={classes.list}>
      <section className={classes.section} aria-labelledby="maps-geopdfs">
        <h3 id="maps-geopdfs" className="visually-hidden">
          GeoPDFs
        </h3>
        {/* Kept via `expireCompletedGeoPdfJobs` on the same TTL as topo
            exports; explaining the retention prevents a vanishing GeoPDF from
            reading as data loss. */}
        <p className={classes.note}>
          {made.length === 0 ? "None finished yet. " : ""}Kept for 7 days after
          they're made — download one to keep it.
        </p>
        {made.map((job) => {
          const label = geoPdfLabel(job);
          return (
            <Row
              key={job.id}
              data-geopdf-id={job.id}
              title={label}
              subtitle={fileSubtitle({
                bytes: job.resultBytes,
                createdAt: job.createdAt,
              })}
              description={MAP_IDENTITY.geoPdf.label}
              leading={
                <IconTile
                  icon="geoPdf"
                  hue={MAP_IDENTITY.geoPdf.hue}
                  label={MAP_IDENTITY.geoPdf.label}
                />
              }
              // A real anchor, so middle-click and "save as" work.
              href={job.downloadUrl ?? undefined}
              download=""
              trailing={
                <>
                  {job.syncRole !== "owner" && (
                    <StatusPill label="Shared" tone="outline" />
                  )}
                  <Menu
                    label={`Actions for ${label}`}
                    title={label}
                    placement="right-start"
                    entries={entriesFor(job)}
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
        {/* The server caps the list; say so rather than letting older GeoPDFs
            quietly not exist (shared/DESIGN.md §11). */}
        {jobsTotal != null && jobsTotal > jobs.length && (
          <p className={classes.note}>
            Showing your {jobs.length} most recent GeoPDFs of {jobsTotal}. Older
            ones aren’t loaded.
          </p>
        )}
      </section>
      <ListEnd>{makeGeoPdfButton}</ListEnd>
    </div>
  );

  return (
    <div className={classes.root}>
      {hero}
      <div className={classes.rails}>{views}</div>
      {list}
      <MakingFooter
        items={beingMade}
        // A failed job holds no file, so dismissing it is a delete with nothing
        // to warn about.
        onDismiss={(item) => void deleteJob(item.id)}
      />

      {shareJob && (
        <ShareDialog
          title={`Share ${shareJob.label}`}
          kind="geoPdfJob"
          friends={friends}
          open
          onClose={() => setShareJob(null)}
          listShares={() => getEntityShares("geoPdfJob", shareJob.id)}
          share={(userId) => shareEntityWith("geoPdfJob", shareJob.id, userId)}
          unshare={(userId) =>
            unshareEntityWith("geoPdfJob", shareJob.id, userId)
          }
        />
      )}

      {dialog}
    </div>
  );
}
