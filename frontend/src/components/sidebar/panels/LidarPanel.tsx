// Maps → LiDAR topos: the topos the user has made or been sent, what is still
// being made, and the templates topos are made with.
//
// The page answers "what maps have I made, and what is still being made?"
// (shared/DESIGN.md §2): the hero counts the topos; a TAB each for the topos and
// the templates prevents templates being buried under older topos; and what is
// still being made is pinned under both so in-flight progress stays
// immediately visible.
//
// A topo's body CENTRES the map on it (DESIGN.md, "Opening a thing centres
// the map on it"), and turns LiDAR topos on so there is something there to see.
// Whether a topo is DRAWN is not this page's business: visibility belongs to
// the layer (DESIGN.md), which keeps the switch in Layers → LiDAR topos rather
// than duplicating it here.
//
// How topos draw their vector layers opens beside the page as a sheet
// (`TopoStyleSheet`), so the map stays in view while it changes.
import { useEffect, useMemo, useState } from "react";
import {
  lidarJobCopy,
  lidarJobSharePromise,
  removeShareConfirm,
  SHARPEN_NEW_JOBS,
  type SharePromiseKind,
  type VectorStyleSettings,
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
import type {
  GeoJsonPolygonal,
  TopoJob,
  TopoTemplate,
} from "../../dialogs/TopoDialog";
import { fetchTopoTemplates } from "../../dialogs/topoTemplatesFetch";
import type { CompletedTopoJob } from "../../../topoLayerTypes";
import TopoTemplateEditDialog from "../../dialogs/TopoTemplateEditDialog";
import ShareDialog from "../../dialogs/ShareDialog";
import {
  Button,
  ChipRail,
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
  isOlderLidarJob,
  offersTemplates,
  plural,
  topoLabel,
  toposBeingMade,
} from "./mapsModel";
import { MakingFooter } from "./MapsParts";
import { useConfirm } from "./useConfirm";
import TopoStyleSheet from "./TopoStyleSheet";
import { usePanelSheet } from "./usePanelSheet";
import { useIsMobile } from "../../../useIsMobile";
import classes from "./MapsPanel.module.css";

/** The two lists this view holds, one tab each. */
type LidarTab = "topos" | "templates";

const MAKE_LABEL = lidarJobCopy(SHARPEN_NEW_JOBS).make;

/** A sharpened job and an older LiDAR topo, told apart in the list. */
const identityOf = (job: CompletedTopoJob) =>
  job.sharpened ? MAP_IDENTITY.sharpened : MAP_IDENTITY.topo;

export default function LidarPanel({
  views,
  activeTopoJobs,
  completedTopoJobs,
  topoJobsLoaded,
  friends,
  setLidarJobToggles,
  onOpenTopo,
  onExportArea,
  onTopoFlyTarget,
  onRefetchCompletedTopoJobs,
  onDismissActiveJob,
  onOpenTopoWithTemplate,
  onQuotaChanged,
  vectorStyle,
  onVectorStyleChange,
  templateRefetchTrigger,
  onSheetOpenChange,
  onExpandSheet,
  loadsUserData,
}: {
  /** The Maps view switch, drawn under this view's hero (DESIGN.md). */
  views: React.ReactNode;
  activeTopoJobs: TopoJob[];
  completedTopoJobs: CompletedTopoJob[];
  /** False until the first fetch of completed topos settles (shared/DESIGN.md §11). */
  topoJobsLoaded: boolean;
  /** Friends a completed topo can be shared with. */
  friends: TFriend[];
  /** Only to forget a deleted topo's visibility; the switch itself is in Layers. */
  setLidarJobToggles: (
    v:
      | Record<string, boolean>
      | ((prev: Record<string, boolean>) => Record<string, boolean>),
  ) => void;
  onOpenTopo: () => void;
  /** Export an area, over a topo's footprint. */
  onExportArea: (job: CompletedTopoJob) => void;
  onTopoFlyTarget: (footprint: GeoJsonPolygonal) => void;
  onRefetchCompletedTopoJobs: () => void;
  onDismissActiveJob: (jobId: string) => void;
  onOpenTopoWithTemplate: (templateId: string) => void;
  onQuotaChanged: () => void;
  vectorStyle: VectorStyleSettings | null;
  onVectorStyleChange: (next: VectorStyleSettings) => void;
  templateRefetchTrigger: number;
  /** Told when the style sheet opens or closes, so the map insets for it. */
  onSheetOpenChange: (open: boolean) => void;
  onExpandSheet?: () => void;
  /** App's own `authenticated && consentSettled` — the value every
   *  user-data hook in this app takes as `enabled`: the template fetch below
   *  waits for it like the rest. */
  loadsUserData: boolean;
}): React.JSX.Element {
  const toast = useToast();
  const { ask, dialog } = useConfirm();
  const { sheetOpen, openSheet } = usePanelSheet({
    onOpenChange: onSheetOpenChange,
    onExpandSheet,
  });
  const isNarrow = useIsMobile();
  // Which tab of the view is showing. Panel-local: which list you were reading
  // is not worth remembering past a page change.
  const [tab, setTab] = useState<LidarTab>("topos");

  const [templates, setTemplates] = useState<TopoTemplate[]>([]);
  // undefined = closed; null = a new template; a template = editing it.
  const [editingTemplate, setEditingTemplate] = useState<
    TopoTemplate | null | undefined
  >(undefined);
  const [templateFetchCount, setTemplateFetchCount] = useState(0);
  // Non-null = the topo whose share dialog is open, named as its row names it.
  const [shareJob, setShareJob] = useState<{
    id: string;
    label: string;
    promise: SharePromiseKind;
  } | null>(null);

  // A template saved from TopoDialog's "Save as template" bumps
  // `templateRefetchTrigger`, so the list is never a reload behind.
  useEffect(() => {
    // Behind the consent gate this is one more user-data request the gate
    // exists to hold, so it waits with every other fetch.
    if (!loadsUserData) return;
    // Nothing shows a template once new jobs sharpen.
    if (!offersTemplates(SHARPEN_NEW_JOBS)) return;
    // Concurrent-duplicate-safe fetch shared with TopoDialog.
    fetchTopoTemplates()
      .then(setTemplates)
      .catch((err) => {
        console.error(err);
        toast.error(messageFromError(err, "Couldn't load topo templates."));
      });
  }, [toast, templateFetchCount, templateRefetchTrigger, loadsUserData]);

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
                  setLidarJobToggles((previous) => {
                    const next = { ...previous };
                    delete next[job.jobId];
                    return next;
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

  const templateEntries = (template: TopoTemplate): MenuEntry[] => [
    ...(!offersTemplates(SHARPEN_NEW_JOBS)
      ? []
      : ([
          {
            id: "make",
            label: "Make a LiDAR topo with this",
            icon: "lidar",
            onSelect: () => onOpenTopoWithTemplate(template.id),
          },
        ] satisfies MenuEntry[])),
    // The built-in Default is nobody's to change: absent, not disabled.
    ...(template.isSystem
      ? []
      : ([
          {
            id: "edit",
            label: "Edit…",
            icon: "edit",
            onSelect: () => setEditingTemplate(template),
          },
          { id: "delete-sep", separator: true },
          {
            id: "delete",
            label: "Delete",
            icon: "delete",
            danger: true,
            onSelect: () =>
              ask({
                title: `Delete the template “${template.name}”?`,
                message:
                  "The template is deleted. Topos already made with it stay.",
                confirmLabel: "Delete",
                run: async () => {
                  try {
                    await apiFetch(`/topo-templates/${template.id}`, {
                      method: "DELETE",
                    });
                    setTemplates((previous) =>
                      previous.filter((each) => each.id !== template.id),
                    );
                  } catch (err) {
                    console.error(err);
                    toast.error(
                      messageFromError(
                        err,
                        "Couldn't delete template. Please try again.",
                      ),
                    );
                  }
                },
              }),
          },
        ] satisfies MenuEntry[])),
  ];

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
          <IconButton
            icon="colour"
            label="Topo style"
            tone={sheetOpen ? "filled" : "default"}
            aria-expanded={sheetOpen}
            onClick={() => openSheet(!sheetOpen)}
          />
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
              ...(!offersTemplates(SHARPEN_NEW_JOBS)
                ? []
                : [
                    {
                      id: "template",
                      label: "New template…",
                      icon: "add" as const,
                      onSelect: () => setEditingTemplate(null),
                    },
                  ]),
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
        body={
          SHARPEN_NEW_JOBS
            ? "Pick an area and order its LiDAR from the government's survey: Logjam Web draws the contours, slope and hillshade there at the survey's own detail."
            : "Pick an area and Logjam Web builds contours, slope, hillshade and vegetation from the government's LiDAR survey. Save one to Logjam GPS for the field."
        }
        actions={makeTopoButton}
      />
    </div>
  ) : (
    <div className={classes.list}>
      {tab === "topos" && (
        <section className={classes.section} aria-labelledby="maps-topos">
          {/* The tab is the heading: a chip that says "Topos 6" over a heading
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
                description={identityOf(job).label}
                leading={
                  <IconTile
                    icon={identityOf(job).icon}
                    hue={identityOf(job).hue}
                    label={identityOf(job).label}
                  />
                }
                onOpen={
                  job.footprint
                    ? () => onTopoFlyTarget(job.footprint!)
                    : undefined
                }
                trailing={
                  <>
                    {isOlderLidarJob(job, SHARPEN_NEW_JOBS) && (
                      <StatusPill label="Old" tone="outline" />
                    )}
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
      )}

      {tab === "templates" && offersTemplates(SHARPEN_NEW_JOBS) && (
        <section
          className={classes.section}
          aria-labelledby="maps-topo-templates"
        >
          <h3 id="maps-topo-templates" className="visually-hidden">
            Templates
          </h3>
          {templates.map((template) => (
            <Row
              key={template.id}
              title={template.name}
              subtitle={template.isSystem ? "Built in" : undefined}
              description={MAP_IDENTITY.topoTemplate.label}
              leading={
                <IconTile
                  icon={MAP_IDENTITY.topoTemplate.icon}
                  hue={MAP_IDENTITY.topoTemplate.hue}
                  label={MAP_IDENTITY.topoTemplate.label}
                />
              }
              onOpen={() => onOpenTopoWithTemplate(template.id)}
              trailing={
                <Menu
                  label={`Actions for ${template.name}`}
                  title={template.name}
                  placement="right-start"
                  entries={templateEntries(template)}
                  trigger={(props) => (
                    <IconButton
                      {...props}
                      icon="overflow"
                      label={`Actions for ${template.name}`}
                    />
                  )}
                />
              }
            />
          ))}
        </section>
      )}
      <ListEnd>{makeTopoButton}</ListEnd>
    </div>
  );

  const sheet = sheetOpen && (
    <TopoStyleSheet
      value={vectorStyle}
      onChange={onVectorStyleChange}
      onClose={() => openSheet(false)}
    />
  );

  return (
    <div className={classes.root}>
      {/* Narrow web: the sheet takes the page's place, as every page's does. */}
      {isNarrow && sheet ? (
        sheet
      ) : (
        <>
          {hero}
          <div className={classes.rails}>
            {views}
            {!nothingYet && topoJobsLoaded && (
              <ChipRail
                label="LiDAR topos view"
                options={[
                  // The Templates chip counts the built-in Default too, so it
                  // can't say 0 over a list with something in it.
                  {
                    value: "topos",
                    label: "Topos",
                    count: completedTopoJobs.length,
                  },
                  ...(offersTemplates(SHARPEN_NEW_JOBS)
                    ? [
                        {
                          value: "templates" as const,
                          label: "Templates",
                          count: templates.length,
                        },
                      ]
                    : []),
                ]}
                value={tab}
                onChange={setTab}
              />
            )}
          </div>
          {list}
          <MakingFooter
            items={beingMade}
            onDismiss={(item) => onDismissActiveJob(item.id)}
          />
          {sheet}
        </>
      )}

      <TopoTemplateEditDialog
        open={editingTemplate !== undefined}
        onClose={() => setEditingTemplate(undefined)}
        editingTemplate={editingTemplate ?? null}
        onSaved={() => setTemplateFetchCount((count) => count + 1)}
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
