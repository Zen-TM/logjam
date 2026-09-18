// Maps → GeoPDFs: the printable maps the user has made, the ones still being
// made, and the templates they are made from.
//
// The page answers "what maps have I made, and what is still being made?"
// (DESIGN.md §1). Its hero counts the finished GeoPDFs; a TAB each for the maps
// and the templates they are made from; and what is still being made pinned
// under both. It was two buttons, a stack of job ribbons and two accordions
// that opened closed — so the page's own answer was behind a click — and then
// one scrolling list, which buried the templates under a year of GeoPDFs
// (operator, 2026-09-18).
//
// A GeoPDF's body DOWNLOADS it. A PDF has nowhere in this app to open to — the
// list view carries no extent to centre the map on — and in a browser opening a
// PDF is fetching it. Its ⋯ holds every verb, Download first (DESIGN.md §5).
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, Download, EllipsisVertical, FileText, Pencil, Plus, Share2, Trash2, X } from "lucide-react";
import { removeShareConfirm } from "@logjam/shared";
import {
  apiFetch,
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
import type { GeoPdfTemplate } from "../../dialogs/GeoPdfDialog";
import { Button, ChipRail, EmptyState, Hero, IconButton, IconTile, Menu, Row, StatusPill, type MenuEntry } from "../../../ui";
import { MAP_IDENTITY, downloadFile, fileSubtitle, geoPdfLabel, geoPdfsBeingMade, plural } from "./mapsModel";
import { MakingFooter } from "./MapsParts";
import { useConfirm } from "./useConfirm";
import classes from "./MapsPanel.module.css";

/** The two lists this view holds, one tab each. */
type GeoPdfTab = "maps" | "templates";

export default function GeoPdfsPanel({
  views,
  onOpenGeoPdf,
  onOpenGeoPdfWithTemplate,
  onEditGeoPdfTemplate,
  onCreateGeoPdfTemplate,
  refetchTrigger,
  geoPdfJobsRefetch,
  friends,
}: {
  /** The GeoPDFs | LiDAR topos switch, drawn under this view's hero (§2). */
  views: React.ReactNode;
  onOpenGeoPdf: () => void;
  onOpenGeoPdfWithTemplate: (id: string) => void;
  onEditGeoPdfTemplate: (template: GeoPdfTemplate) => void;
  onCreateGeoPdfTemplate: () => void;
  refetchTrigger: number;
  geoPdfJobsRefetch: number;
  /** Friends a generated GeoPDF can be shared with. */
  friends: TFriend[];
}): React.JSX.Element {
  const toast = useToast();
  const { ask, dialog } = useConfirm();
  // Which tab of the view is showing. Panel-local: which list you were reading
  // is not worth remembering past a page change.
  const [tab, setTab] = useState<GeoPdfTab>("maps");
  const [templates, setTemplates] = useState<GeoPdfTemplate[]>([]);
  const [templatesLoaded, setTemplatesLoaded] = useState(false);
  // Non-null = the GeoPDF whose share dialog is open, with the row's own words
  // so the dialog's title matches what was pressed.
  const [shareJob, setShareJob] = useState<{ id: string; label: string } | null>(null);
  const { jobs, total: jobsTotal, loaded: jobsLoaded, error: jobsError, refetch: refetchJobs } = useGeoPdfJobs(true);

  useEffect(() => {
    if (geoPdfJobsRefetch > 0) refetchJobs();
  }, [geoPdfJobsRefetch, refetchJobs]);

  useEffect(() => {
    if (jobsError) toast.error(jobsError);
  }, [jobsError, toast]);

  const loadTemplates = useCallback(async () => {
    try {
      setTemplates(await apiFetch<GeoPdfTemplate[]>("/geo-pdf-templates"));
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, "Couldn't load GeoPDF templates."));
    } finally {
      setTemplatesLoaded(true);
    }
  }, [toast]);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates, refetchTrigger]);

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
  const made = useMemo(() => jobs.filter((job) => job.status === "completed"), [jobs]);

  const entriesFor = (job: (typeof made)[number]): MenuEntry[] => {
    const label = geoPdfLabel(job);
    const download: MenuEntry[] = job.downloadUrl
      ? [{ id: "download", label: "Download", icon: Download, onSelect: () => downloadFile(job.downloadUrl!) }]
      : [];
    // Owner-only: a GeoPDF shared with you is yours to read and download, not
    // to share on or delete, and the API answers both with 403 — so they are
    // absent rather than offered and refused (DESIGN.md §7).
    if (job.syncRole === "owner") {
      return [
        ...download,
        { id: "share", label: "Share…", icon: Share2, onSelect: () => setShareJob({ id: job.id, label }) },
        { id: "delete-sep", separator: true },
        {
          id: "delete",
          label: "Delete",
          icon: Trash2,
          danger: true,
          onSelect: () =>
            ask({
              title: `Delete ${label}?`,
              message:
                "The PDF is deleted from your account, and friends you shared it with lose it too. The template it was made with stays.",
              confirmLabel: "Delete",
              run: () => deleteJob(job.id),
            }),
        },
      ];
    }
    // A GeoPDF has no place to inherit visibility from, so one that is not
    // yours always reached you on a share of its own, and that share is yours
    // to drop. NOT danger: the owner keeps the original.
    const confirm = removeShareConfirm({ kindLabel: "GeoPDF", itemName: label });
    return [
      ...download,
      { id: "remove-sep", separator: true },
      {
        id: "removeShare",
        label: "Remove",
        icon: X,
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
                toast.error(messageFromError(err, "Couldn't remove that GeoPDF."));
              }
            },
          }),
      },
    ];
  };

  const templateEntries = (template: GeoPdfTemplate): MenuEntry[] => [
    { id: "make", label: "Make a GeoPDF with this", icon: FileText, onSelect: () => onOpenGeoPdfWithTemplate(template.id) },
    { id: "edit", label: "Edit…", icon: Pencil, onSelect: () => onEditGeoPdfTemplate(template) },
    { id: "delete-sep", separator: true },
    {
      id: "delete",
      label: "Delete",
      icon: Trash2,
      danger: true,
      onSelect: () =>
        ask({
          title: `Delete the template “${template.name}”?`,
          message: "The template is deleted. GeoPDFs already made with it stay.",
          confirmLabel: "Delete",
          run: async () => {
            try {
              await apiFetch(`/geo-pdf-templates/${template.id}`, { method: "DELETE" });
              setTemplates((previous) => previous.filter((each) => each.id !== template.id));
            } catch (err) {
              console.error(err);
              toast.error(messageFromError(err, "Couldn't delete template. Please try again."));
            }
          },
        }),
    },
  ];

  const hero = (
    <Hero
      title={!jobsLoaded ? "GeoPDFs" : made.length === 0 ? "No GeoPDFs yet" : plural(made.length, "GeoPDF")}
      actions={
        <Menu
          label="Make a GeoPDF"
          placement="bottom-end"
          entries={[
            { id: "make", label: "Make a GeoPDF", icon: FileText, onSelect: onOpenGeoPdf },
            { id: "template", label: "New template…", icon: Plus, onSelect: onCreateGeoPdfTemplate },
          ]}
          trigger={(props) => (
            <Button {...props} compact variant="filled" icon={Plus} trailingIcon={ChevronDown}>
              Make
            </Button>
          )}
        />
      }
    />
  );

  const nothingYet = jobsLoaded && templatesLoaded && jobs.length === 0 && templates.length === 0;

  const list = !jobsLoaded ? (
    <div className={classes.emptyArea} role="status">
      <p className={classes.loading}>Loading your GeoPDFs…</p>
    </div>
  ) : nothingYet ? (
    <div className={classes.emptyArea}>
      <EmptyState
        icon={FileText}
        title="No GeoPDFs yet"
        body="Frame an area on the map, and Logjam Web makes a map of it to print, or to load into Logjam GPS for the field."
        actions={
          <Button compact variant="filled" icon={FileText} onClick={onOpenGeoPdf}>
            Make a GeoPDF
          </Button>
        }
      />
    </div>
  ) : (
    <div className={classes.list}>
      {tab === "maps" && (
      <section className={classes.section} aria-labelledby="maps-geopdfs">
        {/* The tab is the heading: a chip that says "Maps 12" over a heading
            that says "GEOPDFS 12" is the same line drawn twice. */}
        <h3 id="maps-geopdfs" className="visually-hidden">
          GeoPDFs
        </h3>
        {/* The reaper's `expireCompletedGeoPdfJobs`, on the same TTL as topo
            exports. The page never said so, and a GeoPDF quietly vanishing a
            week later reads as data loss. */}
        <p className={classes.note}>
          {made.length === 0 ? "None finished yet. " : ""}Kept for 7 days after they're made — download one to keep it.
        </p>
        {made.map((job) => {
          const label = geoPdfLabel(job);
          return (
            <Row
              key={job.id}
              data-geopdf-id={job.id}
              title={label}
              subtitle={fileSubtitle({ bytes: job.resultBytes, createdAt: job.createdAt })}
              description={MAP_IDENTITY.geoPdf.label}
              leading={<IconTile icon={FileText} hue={MAP_IDENTITY.geoPdf.hue} label={MAP_IDENTITY.geoPdf.label} />}
              onOpen={job.downloadUrl ? () => downloadFile(job.downloadUrl!) : undefined}
              trailing={
                <>
                  {job.syncRole !== "owner" && <StatusPill label="Shared" tone="outline" />}
                  <Menu
                    label={`Actions for ${label}`}
                    title={label}
                    placement="right-start"
                    entries={entriesFor(job)}
                    trigger={(props) => <IconButton {...props} icon={EllipsisVertical} label={`Actions for ${label}`} />}
                  />
                </>
              }
            />
          );
        })}
        {/* The server caps the list; say so rather than letting older GeoPDFs
            quietly not exist (DESIGN.md §8). */}
        {jobsTotal != null && jobsTotal > jobs.length && (
          <p className={classes.note}>
            Showing your {jobs.length} most recent GeoPDFs of {jobsTotal}. Older ones aren’t loaded.
          </p>
        )}
      </section>
      )}

      {tab === "templates" && (
      <section className={classes.section} aria-labelledby="maps-geopdf-templates">
        <h3 id="maps-geopdf-templates" className="visually-hidden">
          Templates
        </h3>
        {templatesLoaded && templates.length === 0 && (
          <p className={classes.note}>A template keeps paper, scale and layers to make the next GeoPDF with.</p>
        )}
        {templates.map((template) => (
          <Row
            key={template.id}
            title={template.name}
            description={MAP_IDENTITY.geoPdfTemplate.label}
            leading={
              <IconTile
                icon={MAP_IDENTITY.geoPdfTemplate.icon}
                hue={MAP_IDENTITY.geoPdfTemplate.hue}
                label={MAP_IDENTITY.geoPdfTemplate.label}
              />
            }
            // What a template is FOR: making a GeoPDF with it.
            onOpen={() => onOpenGeoPdfWithTemplate(template.id)}
            trailing={
              <Menu
                label={`Actions for ${template.name}`}
                title={template.name}
                placement="right-start"
                entries={templateEntries(template)}
                trigger={(props) => (
                  <IconButton {...props} icon={EllipsisVertical} label={`Actions for ${template.name}`} />
                )}
              />
            }
          />
        ))}
      </section>
      )}
    </div>
  );

  return (
    <div className={classes.root}>
      {hero}
      <div className={classes.rails}>
        {views}
        {!nothingYet && jobsLoaded && (
          <ChipRail
            label="GeoPDFs view"
            options={[
              { value: "maps", label: "Maps", count: made.length },
              { value: "templates", label: "Templates", count: templatesLoaded ? templates.length : undefined },
            ]}
            value={tab}
            onChange={setTab}
          />
        )}
      </div>
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
          blurb={
            <>
              Recipients can view and download this GeoPDF. They cannot delete it, and you can unshare at any time.
            </>
          }
          friends={friends}
          open
          onClose={() => setShareJob(null)}
          listShares={() => getEntityShares("geoPdfJob", shareJob.id)}
          share={(userId) => shareEntityWith("geoPdfJob", shareJob.id, userId)}
          unshare={(userId) => unshareEntityWith("geoPdfJob", shareJob.id, userId)}
        />
      )}

      {dialog}
    </div>
  );
}
