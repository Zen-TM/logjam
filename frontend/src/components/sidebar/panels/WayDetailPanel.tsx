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
  removeShareConfirm,
  densifyLine,
  formatBytes,
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
  copyRoute,
  deleteRoute,
  getMediaDownloadUrls,
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
import PlacePicker from "../../common/PlacePicker";
import ElevationProfile from "../../routes/ElevationProfile";
import type { RouteHoverChannel } from "../../map/routeHover";
import {
  Button,
  Hero,
  IconButton,
  Menu,
  SectionHeader,
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
  copyAndRemove: CopyPlus,
  share: Share2,
  exportGpx: Download,
  exportKml: Download,
  download: Download,
  rename: Pencil,
  // Not a bin: this drops the caller's own share and the owner keeps their row.
  removeShare: X,
  delete: Trash2,
};

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
  onCopied,
  onChanged,
  onOpenPlace,
  onDeleteFile,
  routeHover,
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
  /** A copy of a shared route has just been made and is the user's own now —
   *  go and show it to them. The copying itself happens here, because it is
   *  half of "save it and remove the share" and the two halves must not be
   *  able to drift apart. */
  onCopied: (copy: TRoute) => void;
  onChanged: () => void;
  onOpenPlace: (placeId: string) => void;
  onDeleteFile: (file: StandaloneFile) => Promise<void>;
  /** Where along a route the elevation cursor sits, so the map marks it. A
   *  channel rather than a callback into App state: it changes many times a
   *  second (`map/routeHover.ts`). */
  routeHover: RouteHoverChannel;
}): React.JSX.Element {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [renaming, setRenaming] = useState(false);
  /** Which share-ending verb is waiting on its confirmation, if any. */
  const [ending, setEnding] = useState<"remove" | "copyAndRemove" | null>(null);
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

  // The colour as the user last PICKED it, not as the server has confirmed it.
  // A pick is a round trip plus a refetch, and showing the old swatch until
  // both land made the palette feel slow at exactly the moment it should feel
  // instant (operator, 2026-09-17). Cleared once the refetched route agrees.
  const [pendingColour, setPendingColour] = useState<string | null>(null);
  const colour = route?.color ?? file?.color ?? way.color;
  const shownColour = pendingColour ?? colour;
  useEffect(() => {
    if (pendingColour !== null && colour === pendingColour) setPendingColour(null);
  }, [colour, pendingColour]);

  // The SAME densification the server profiled, so a sample index maps straight
  // back to a coordinate on the line — no second interpolation to drift.
  const samplePositions = useMemo(
    () => (route ? densifyLine(route.points) : []),
    [route],
  );
  const handleHoverSample = useCallback(
    (index: number | null) => {
      const position = index == null ? null : samplePositions[index];
      routeHover.set(
        position ? { position: [position.lon, position.lat], color: shownColour } : null,
      );
    },
    [samplePositions, routeHover, shownColour],
  );
  // Closing the panel mid-hover would otherwise strand the map marker.
  useEffect(() => () => routeHover.set(null), [routeHover]);

  const owned = !way.shared;
  // WHICH PLACE, from the live row rather than from `way`.
  //
  // `way` is the snapshot taken when the page was opened and App never replaces
  // it, so linking a route updated the server, refetched the route, and changed
  // nothing on screen: the picker stayed and the place never appeared
  // (operator, 2026-09-17). The route and the file ARE refetched, so they are
  // the authority on where this way lives; `way` is the fallback for a kind
  // that has neither in hand (a friend's place's track).
  const placeId = route?.placeId ?? file?.linkedPlaceId ?? way.placeId;
  const live = { ...way, placeId };
  const properties = wayProperties(live);
  const linkedPlace = ownedPlaces.find((place) => place.id === placeId) ?? null;
  /** The shared place this way arrived through, where it arrived through one.
   *  Whether it DID is `way.viaPlace`, decided once in `waysModel` — this is
   *  only how to name it. */
  const sharingPlace = sharedPlaces.find((place) => place.id === placeId) ?? null;
  const ownerName = route ? ownerUsername(friends, route.ownerId) : null;

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

  /**
   * Take your own copy, optionally dropping the share in the same breath.
   *
   * THE ORDER IS THE GUARANTEE: copy first, unshare second. Reversed, a failure
   * between the two steps leaves the user with neither the share nor a copy —
   * this way the worst case is that they still have both, which they can see
   * and act on.
   */
  const handleCopy = (alsoRemove: boolean) => {
    if (!route) return;
    setEnding(null);
    void run(async () => {
      const copy = await copyRoute(route.id);
      if (alsoRemove) await unshareEntityWith("route", route.id, "me");
      toast.success(
        alsoRemove
          ? `"${copy.name}" is yours now, and ${ownerName ?? "their"} share is removed.`
          : `"${copy.name}" is yours now.`,
      );
      onCopied(copy);
    }, "Couldn't save that route to your Ways.");
  };

  /**
   * Hand back the file the user brought or recorded, byte for byte.
   *
   * An anchor rather than `window.open`: the URL is minted asynchronously, so
   * by the time it arrives the click is no longer a user gesture and a popup
   * would be blocked. A cross-origin `download` attribute is ignored by the
   * browser, but a GPX or KML is not something it can render, so following the
   * link saves it — which is the whole of what this verb promises.
   */
  const handleDownload = () => {
    if (!file) return;
    setBusy(true);
    void (async () => {
      try {
        const { items } = await getMediaDownloadUrls([file.id]);
        const url = items[0]?.displayUrl;
        if (!url) throw new Error("The file could not be fetched.");
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = mediaDisplayName(file);
        anchor.rel = "noopener";
        anchor.click();
      } catch (err) {
        console.error(err);
        toast.error(messageFromError(err, "Couldn't download that file."));
      } finally {
        setBusy(false);
      }
    })();
  };

  const handleRemoveShare = () => {
    if (!route) return;
    setEnding(null);
    void run(async () => {
      await unshareEntityWith("route", route.id, "me");
      toast.success(`${way.title} removed.`);
      onBack();
    }, "Couldn't remove that route.");
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
        handleCopy(false);
        return;
      // Both of these end the share, so both ask first.
      case "copyAndRemove":
        setEnding("copyAndRemove");
        return;
      case "removeShare":
        setEnding("remove");
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
      case "download":
        handleDownload();
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

  const entries: MenuEntry[] = wayVerbs(live, "detail").flatMap((verb, index, all) => {
    const item: MenuEntry = {
      id: verb.id,
      label: verb.label,
      ...(VERB_ICON[verb.id] ? { icon: VERB_ICON[verb.id] } : {}),
      ...(verb.danger ? { danger: true } : {}),
      disabled: busy,
      onSelect: () => runVerb(verb.id),
    };
    // A rule sits above the verbs that end the user's relationship with the
    // way, so the last step of parting with something is never adjacent to an
    // ordinary one. Not keyed on `danger`: Remove belongs below the rule and
    // destroys nothing (wayActions.ts).
    return verb.separated && index > 0 && !all[index - 1].separated
      ? [{ id: `${verb.id}-sep`, separator: true } as MenuEntry, item]
      : [item];
  });

  const handleUnlink = () => {
    if (!route) return;
    const from = linkedPlace?.name;
    void run(async () => {
      await updateRoute(route.id, { placeId: null });
      toast.success(from ? `Unlinked from ${from}.` : "Unlinked.");
    }, "Couldn't unlink the route.");
  };

  const linkNow = (targetPlaceId: string) => {
    if (!route) return;
    const name = ownedPlaces.find((place) => place.id === targetPlaceId)?.name;
    void run(async () => {
      const result = await updateRoute(route.id, { placeId: targetPlaceId });
      // Say it worked. The panel showing the place afterwards is the real
      // confirmation, but it was silent even once that started working, and a
      // write with no acknowledgement reads as a write that did not happen.
      toast.success(name ? `Linked to ${name}.` : "Linked to a place.");
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
  const handleLinkSelected = (targetPlaceId: string) => {
    if (!route) return;
    const incumbent = allRoutes.find(
      (other) => other.placeId === targetPlaceId && other.id !== route.id,
    );
    if (!incumbent) {
      linkNow(targetPlaceId);
      return;
    }
    setPendingLink({
      placeId: targetPlaceId,
      placeName: ownedPlaces.find((place) => place.id === targetPlaceId)?.name ?? "That place",
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
                  color={shownColour ?? "currentColor"}
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
              label="Colour"
              colors={TRACK_COLORS}
              value={shownColour ?? undefined}
              nameOf={trackColorName}
              // NOT disabled while the write is in flight: the swatch already
              // shows the new colour, so greying the control out would be the
              // one visible sign that anything is pending.
              onChange={(next) => {
                setPendingColour(next);
                void run(
                  () => updateRoute(route.id, { color: next }),
                  "Couldn't change the colour.",
                );
              }}
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
            // Typed, not scrolled. A dropdown of every place the user has is
            // hundreds of options deep, and the platform's own type-to-find
            // matches the START of the primary name only — so a place known by
            // an alternative name was unreachable (operator, 2026-09-17).
            <PlacePicker
              label="Link to a place"
              places={ownedPlaces}
              disabled={busy}
              onSelect={(place) => handleLinkSelected(place.id)}
            />
          ) : sharingPlace ? (
            // The place whose share brought this way. Removing THAT is the only
            // way to stop seeing it — it carries no share row of its own.
            <div className={classes.linkRow}>
              <span className={classes.linkName}>{sharingPlace.name}</span>
              <Button compact icon={MapPin} onClick={() => onOpenPlace(sharingPlace.id)}>
                Open
              </Button>
            </div>
          ) : (
            <p className={classes.note}>Not linked to a place.</p>
          )}
        </section>

        {/* What this way IS to the reader, and nothing to press. Removing it
            is a verb and lives in the ⋯ with the others — as a button here it
            was the one action on the page outside the menu, and it read as a
            leftover from another app (operator, 2026-09-17). */}
        {!owned && (
          <section className={classes.section}>
            <p className={classes.note}>
              {way.viaPlace
                ? `Shared with you as part of ${sharingPlace?.name ?? "a place"} — you can see it, but not change it. Removing that place is what stops it showing here.`
                : "Shared with you — you can see it, but not change it."}
            </p>
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

      {/* Removing a share destroys nothing — the owner keeps their row — so the
          wording comes from `removeShareConfirm` (the promise every surface
          makes) and the button is not the red one a delete uses. */}
      <ConfirmDialog
        open={ending === "remove"}
        title={removeShareConfirm({ kindLabel: "route", itemName: way.title, ownerName }).title}
        message={removeShareConfirm({ kindLabel: "route", itemName: way.title, ownerName }).body}
        confirmLabel="Remove"
        confirmColor="primary"
        busy={busy}
        onConfirm={handleRemoveShare}
        onClose={() => setEnding(null)}
      />

      <ConfirmDialog
        open={ending === "copyAndRemove"}
        title="Save to your Ways and remove?"
        message={`A copy of "${way.title}" is saved to your Ways first, then ${
          ownerName ? `${ownerName}'s` : "the owner's"
        } share is removed from your account. The copy is yours to keep and edit — nothing of theirs is deleted.`}
        confirmLabel="Save and remove"
        confirmColor="primary"
        busy={busy}
        onConfirm={() => handleCopy(true)}
        onClose={() => setEnding(null)}
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
