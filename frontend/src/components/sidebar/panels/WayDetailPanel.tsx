// One way: what it is as numbers, and what can be done with it.
//
// EVERY kind gets this page, not just routes (operator, 2026-09-17): opening a
// recorded track or an imported file used to do nothing at all, so the only way
// to learn anything about one was to draw it on the map and look.
//
// What each kind can say for itself differs, and the page says only what it
// knows. A ROUTE carries its geometry inline, so it gets measured figures and a
// real elevation profile. A FILE's geometry is an object in S3 this page has
// not downloaded, so it reports the stats its own row already carries — a
// recording's distance, climb and descent were computed by the recorder and are
// better than anything re-derived here anyway. Neither guesses: a figure that
// is not known is absent rather than zero.
//
// Which verbs appear, and which controls are inline rather than in the ⋯, is
// `wayActions.ts` — not this file's judgement.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CopyPlus,
  Download,
  EllipsisVertical,
  Link2Off,
  MapPin,
  Pencil,
  Share2,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  sharedRowVisibility,
  densifyLine,
  formatDistanceM,
  routeLengthM,
  exportFilename,
  mediaDisplayName,
  routeToGpx,
  routeToKml,
  trackColorName,
  GPX_MIME_TYPE,
  KML_MIME_TYPE,
  TRACK_COLORS,
  type StandaloneFile,
} from "@logjam/shared";
import {
  deleteRoute,
  updateRoute,
  useElevationProfile,
  getEntityShares,
  ownerUsername,
  shareEntityWith,
  unshareEntityWith,
  renameMedia,
  type TRoute,
  type TPlace,
  type TFriend,
} from "../../../placeUtils";
import { messageFromError } from "../../../errors/messageFromError";
import { useToast } from "../../feedback/ToastProvider";
import ConfirmDialog from "../../dialogs/ConfirmDialog";
import ShareDialog from "../../dialogs/ShareDialog";
import RemoveSharedButton from "../../common/RemoveSharedButton";
import ElevationProfile from "../../routes/ElevationProfile";
import {
  Button,
  Hero,
  IconButton,
  Menu,
  SectionHeader,
  Select,
  StatGrid,
  SwatchPicker,
  TextField,
  Dialog,
  type MenuEntry,
  type Stat,
} from "../../../ui";
import { wayProperties, wayVerbs, type WayVerbId } from "./wayActions";
import type { WayItem } from "./waysModel";
import classes from "./WayDetailPanel.module.css";

const VERB_ICON: Partial<Record<WayVerbId, LucideIcon>> = {
  openPlace: MapPin,
  edit: Pencil,
  copy: CopyPlus,
  share: Share2,
  exportGpx: Download,
  exportKml: Download,
  rename: Pencil,
  delete: Trash2,
};

/** A file size for a person. Only ever an approximation — the exact byte count
 *  answers no question anyone opens this page with. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Export never touches the server — a route's geometry is already here. */
function downloadText(filename: string, text: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function WayDetailPanel({
  way,
  route,
  file,
  initialVerb,
  onVerbConsumed,
  friends,
  ownedPlaces,
  sharedPlaces,
  allRoutes,
  onBack,
  onClose,
  onEdit,
  onCopy,
  onChanged,
  onOpenPlace,
  onDeleteFile,
  onHoverPosition,
}: {
  /** The row this page was opened from — the one description every kind has. */
  way: WayItem;
  /** Set when the way is a route: its geometry is inline. */
  route: TRoute | null;
  /** Set when the way is one of the user's OWN files. A file on someone else's
   *  place is not among them, so the page shows what the row knows and no
   *  write controls. */
  file: StandaloneFile | null;
  /**
   * A verb a ROW asked for, run once this page mounts. It is how one verb list
   * serves both surfaces: a row shows Share, Rename and Delete without hosting
   * a second copy of each form (wayActions.ts). CONSUMED, never counted — a
   * request that stays set fires again on every re-render (DESIGN.md §9).
   */
  initialVerb: WayVerbId | null;
  onVerbConsumed: () => void;
  friends: TFriend[];
  ownedPlaces: TPlace[];
  sharedPlaces: TPlace[];
  /** To warn before displacing a place's existing route. */
  allRoutes: TRoute[];
  /** Back to Ways — the list this page is one step inside of. */
  onBack: () => void;
  onClose: () => void;
  onEdit: (route: TRoute) => void;
  /** Take your own copy of a route someone shared with you. */
  onCopy: (route: TRoute) => void;
  onChanged: () => void;
  onOpenPlace: (placeId: string) => void;
  onDeleteFile: (file: StandaloneFile) => Promise<void>;
  /** Where along a route the elevation cursor sits, so the map marks it. */
  onHoverPosition: (position: [number, number] | null) => void;
}): React.JSX.Element {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [pendingLink, setPendingLink] = useState<{
    placeId: string;
    placeName: string;
    incumbentName: string;
  } | null>(null);

  // Only a route has geometry here; null points mean no request is made at all.
  const {
    profile,
    loading: profileLoading,
    error: profileError,
  } = useElevationProfile(route?.points ?? null);

  // The SAME densification the server profiled, so a sample index maps straight
  // back to a coordinate on the line — no second interpolation to drift.
  const samplePositions = useMemo(
    () => (route ? densifyLine(route.points) : []),
    [route],
  );
  const handleHoverSample = useCallback(
    (index: number | null) => {
      const position = index == null ? null : samplePositions[index];
      onHoverPosition(position ? [position.lon, position.lat] : null);
    },
    [samplePositions, onHoverPosition],
  );
  // Closing the panel mid-hover would otherwise strand the map marker.
  useEffect(() => () => onHoverPosition(null), [onHoverPosition]);

  const owned = !way.shared;
  const properties = wayProperties(way);
  const linkedPlace = ownedPlaces.find((place) => place.id === way.placeId) ?? null;
  const viaPlace = sharedPlaces.find((place) => place.id === way.placeId) ?? null;
  const visibility = sharedRowVisibility({
    syncRole: owned ? "owner" : "shared",
    visibleLinkedPlaceIds: viaPlace ? [viaPlace.id] : [],
  });
  const colour = route?.color ?? file?.color ?? way.color;

  const run = async (action: () => Promise<unknown>, failure: string) => {
    setBusy(true);
    try {
      await action();
      onChanged();
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, failure));
    } finally {
      setBusy(false);
    }
  };

  // ── Figures ───────────────────────────────────────────────────────────
  // A route's are measured from the geometry in hand; a file's are the ones its
  // own row carries. "—" where the terrain read has not landed, never a zero.
  const stats: Stat[] = route
    ? [
        // Distance takes the row and climb/descent pair beneath it: those two
        // are one fact about the line, and side by side is what makes them
        // comparable (operator, 2026-09-17).
        { label: "Distance", value: formatDistanceM(routeLengthM(route.points)), span: true },
        { label: "Climb", value: profile ? `↑ ${Math.round(profile.gainM)} m` : "—" },
        { label: "Descent", value: profile ? `↓ ${Math.round(profile.lossM)} m` : "—" },
      ]
    : [
        ...(way.distanceM != null
          ? [{ label: "Distance", value: formatDistanceM(way.distanceM), span: true }]
          : []),
        ...(file?.metadata.elevationGainM != null
          ? [{ label: "Climb", value: `↑ ${Math.round(file.metadata.elevationGainM)} m` }]
          : []),
        ...(file?.metadata.elevationLossM != null
          ? [{ label: "Descent", value: `↓ ${Math.round(file.metadata.elevationLossM)} m` }]
          : []),
        ...(file?.metadata.featureCount != null
          ? [{ label: "Features", value: String(file.metadata.featureCount) }]
          : []),
        ...(file != null ? [{ label: "Size", value: formatBytes(file.fileSizeBytes) }] : []),
      ];

  // ── Verbs ─────────────────────────────────────────────────────────────
  const exportRoute = (format: "gpx" | "kml") => {
    if (!route) return;
    downloadText(
      exportFilename(route.name, format),
      format === "gpx" ? routeToGpx(route.name, route.points) : routeToKml(route.name, route.points),
      format === "gpx" ? GPX_MIME_TYPE : KML_MIME_TYPE,
    );
  };

  const runVerb = (id: WayVerbId) => {
    switch (id) {
      case "openPlace":
        if (way.placeId) onOpenPlace(way.placeId);
        return;
      case "edit":
        if (route) onEdit(route);
        return;
      case "copy":
        if (route) onCopy(route);
        return;
      case "share":
        setShowShare(true);
        return;
      case "exportGpx":
        exportRoute("gpx");
        return;
      case "exportKml":
        exportRoute("kml");
        return;
      case "rename":
        setRenaming(true);
        return;
      case "delete":
        setConfirmDelete(true);
        return;
      case "open":
        return;
    }
  };

  // Run what the row asked for, once. `runVerb` is read through a ref so the
  // effect depends on the REQUEST and not on every render's new closure.
  const runVerbRef = useRef(runVerb);
  runVerbRef.current = runVerb;
  useEffect(() => {
    if (!initialVerb) return;
    runVerbRef.current(initialVerb);
    onVerbConsumed();
  }, [initialVerb, onVerbConsumed]);

  const entries: MenuEntry[] = wayVerbs(way, "detail").flatMap((verb, index, all) => {
    const item: MenuEntry = {
      id: verb.id,
      label: verb.label,
      ...(VERB_ICON[verb.id] ? { icon: VERB_ICON[verb.id] } : {}),
      ...(verb.danger ? { danger: true } : {}),
      disabled: busy,
      onSelect: () => runVerb(verb.id),
    };
    // A rule sits above the destructive verb, so the last step of losing
    // something is never adjacent to an ordinary one.
    return verb.danger && index > 0 && !all[index - 1].danger
      ? [{ id: `${verb.id}-sep`, separator: true } as MenuEntry, item]
      : [item];
  });

  const handleUnlink = () => {
    if (!route) return;
    void run(() => updateRoute(route.id, { placeId: null }), "Couldn't unlink the route.");
  };

  const linkNow = (placeId: string) => {
    if (!route) return;
    void run(async () => {
      const result = await updateRoute(route.id, { placeId });
      if (result.displacedRoute) {
        toast.info(
          `"${result.displacedRoute.name}" was unlinked and kept as a standalone route.`,
        );
      }
    }, "Couldn't link the route.");
  };

  // A place holds at most one way. Linking to an occupied one displaces the
  // incumbent — it survives standalone, so this is not destructive, but it
  // still changes what a sharee of that place sees. Ask first.
  const handleLinkSelected = (placeId: string) => {
    if (!route) return;
    const incumbent = allRoutes.find((other) => other.placeId === placeId && other.id !== route.id);
    if (!incumbent) {
      linkNow(placeId);
      return;
    }
    setPendingLink({
      placeId,
      placeName: ownedPlaces.find((place) => place.id === placeId)?.name ?? "That place",
      incumbentName: incumbent.name,
    });
  };

  const handleDelete = () => {
    if (route) {
      void run(async () => {
        await deleteRoute(route.id);
        onBack();
      }, "Couldn't delete the route.");
      return;
    }
    if (file) {
      setBusy(true);
      void onDeleteFile(file)
        .then(() => onBack())
        .finally(() => setBusy(false));
    }
  };

  return (
    <div className={classes.root}>
      <Hero
        title={way.title}
        onBack={onBack}
        backLabel="Back to Ways"
        actions={
          <>
            <Menu
              label={`Actions for ${way.title}`}
              title={way.title}
              placement="bottom-end"
              entries={entries}
              trigger={(props) => (
                <IconButton {...props} icon={EllipsisVertical} label={`Actions for ${way.title}`} />
              )}
            />
            <IconButton icon={X} label="Close panel" onClick={onClose} />
          </>
        }
      />

      <div className={classes.body}>
        {stats.length > 0 && <StatGrid stats={stats} />}

        {/* Only a route has its geometry here to profile. A recording's climb
            and descent are in the figures above, measured by the recorder that
            walked it — better than anything re-derived from a simplified line. */}
        {route && (
          <section className={classes.section}>
            {profileLoading && <p className={classes.note}>Reading the terrain…</p>}
            {profileError && <p className={classes.note}>{profileError}</p>}
            {profile && (
              <>
                {profile.minM != null && profile.maxM != null && (
                  <p className={classes.band}>
                    {Math.round(profile.minM)}–{Math.round(profile.maxM)} m above sea level
                  </p>
                )}
                {/* The chart's axes named: an unlabelled height profile reads as
                    height over TIME to anyone not told otherwise (mobile §7).
                    This IS the section's heading — a second "Elevation" above it
                    said the same thing twice (operator, 2026-09-17). */}
                <SectionHeader title="Elevation vs distance" />
                <ElevationProfile
                  samples={profile.samples}
                  minM={profile.minM}
                  maxM={profile.maxM}
                  color={colour ?? "currentColor"}
                  onHoverSampleChange={handleHoverSample}
                />
                <p className={classes.attribution}>{profile.attribution}</p>
              </>
            )}
          </section>
        )}

        {/* ── Properties: changed in place, never in the ⋯ (wayActions.ts) ── */}
        {/* Route-only: a file's colour is set by whatever made the file, and
            the API has no way to change it (wayActions.ts). */}
        {properties.colour && route && (
          <section className={classes.section}>
            <SwatchPicker
              label="Colour on the map"
              colors={TRACK_COLORS}
              value={colour ?? undefined}
              nameOf={trackColorName}
              disabled={busy}
              onChange={(next) =>
                void run(() => updateRoute(route.id, { color: next }), "Couldn't change the colour.")
              }
            />
          </section>
        )}

        <section className={classes.section}>
          <SectionHeader title="Place" />
          {linkedPlace ? (
            <div className={classes.linkRow}>
              <span className={classes.linkName}>{linkedPlace.name}</span>
              {owned && route && (
                <Button compact icon={Link2Off} disabled={busy} onClick={handleUnlink}>
                  Unlink
                </Button>
              )}
            </div>
          ) : owned && route ? (
            <Select
              label="Link to a place"
              value=""
              disabled={busy}
              onChange={(event) => event.target.value && handleLinkSelected(event.target.value)}
            >
              <option value="">Not linked to a place</option>
              {ownedPlaces.map((place) => (
                <option key={place.id} value={place.id}>
                  {place.name}
                </option>
              ))}
            </Select>
          ) : viaPlace ? (
            // The place whose share brought this way. Removing THAT is the only
            // way to stop seeing it — it carries no share row of its own.
            <div className={classes.linkRow}>
              <span className={classes.linkName}>{viaPlace.name}</span>
              <Button compact icon={MapPin} onClick={() => onOpenPlace(viaPlace.id)}>
                Open
              </Button>
            </div>
          ) : (
            <p className={classes.note}>Not linked to a place.</p>
          )}
        </section>

        {!owned && (
          <section className={classes.section}>
            <p className={classes.note}>
              {visibility === "via-place"
                ? `Shared with you as part of ${viaPlace?.name} — you can see it, but not change it.`
                : "Shared with you — you can see it, but not change it."}
            </p>
            {visibility === "direct" && route && (
              <RemoveSharedButton
                kindLabel="route"
                itemName={way.title}
                ownerName={ownerUsername(friends, route.ownerId)}
                disabled={busy}
                remove={() => unshareEntityWith("route", route.id, "me")}
                onRemoved={() => {
                  onChanged();
                  onBack();
                }}
              />
            )}
          </section>
        )}
      </div>

      {owned && route && (
        <ShareDialog
          title={`Share ${way.title}`}
          blurb={
            <>
              Recipients see this route on their map and can export it. They
              cannot edit or delete it, and you can unshare at any time.
            </>
          }
          friends={friends}
          open={showShare}
          onClose={() => setShowShare(false)}
          listShares={() => getEntityShares("route", route.id)}
          share={(userId) => shareEntityWith("route", route.id, userId)}
          unshare={(userId) => unshareEntityWith("route", route.id, userId)}
        />
      )}

      {renaming && file && (
        <RenameWayDialog
          file={file}
          busy={busy}
          onSave={(name) => {
            setRenaming(false);
            void run(() => renameMedia(file.id, name), "Couldn't rename that file.");
          }}
          onClose={() => setRenaming(false)}
        />
      )}

      <ConfirmDialog
        open={pendingLink !== null}
        title="Replace this place's route?"
        message={
          pendingLink
            ? `${pendingLink.placeName} already has the route "${pendingLink.incumbentName}". It will be unlinked and kept as a standalone route — nothing is deleted.`
            : ""
        }
        confirmLabel="Replace"
        confirmColor="primary"
        busy={busy}
        onConfirm={() => {
          const target = pendingLink;
          setPendingLink(null);
          if (target) linkNow(target.placeId);
        }}
        onClose={() => setPendingLink(null)}
      />

      <ConfirmDialog
        open={confirmDelete}
        title={route ? "Delete route?" : "Delete this file?"}
        message={`"${way.title}" is removed from your account, so it goes from Logjam GPS and your other devices too. This can't be undone.`}
        confirmLabel="Delete"
        busy={busy}
        onConfirm={() => {
          setConfirmDelete(false);
          handleDelete();
        }}
        onClose={() => setConfirmDelete(false)}
      />
    </div>
  );
}

/** Renaming a file, as a form with a Cancel — never a live field that commits
 *  on blur (DESIGN.md §5). */
function RenameWayDialog({
  file,
  busy,
  onSave,
  onClose,
}: {
  file: StandaloneFile;
  busy: boolean;
  onSave: (name: string) => void;
  onClose: () => void;
}) {
  const current = mediaDisplayName(file);
  const [name, setName] = useState(current);
  const trimmed = name.trim();
  const canSave = trimmed.length > 0 && trimmed !== current;

  return (
    <Dialog
      open
      title="Rename this file"
      onClose={onClose}
      dismissible={!busy}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="filled" busy={busy} disabled={!canSave} onClick={() => onSave(trimmed)}>
            Save
          </Button>
        </>
      }
    >
      <TextField
        label="File name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || !canSave) return;
          event.preventDefault();
          onSave(trimmed);
        }}
        data-autofocus
      />
    </Dialog>
  );
}
