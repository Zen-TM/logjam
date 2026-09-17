// One route: what it is as numbers, and what can be done with it.
//
// Opened programmatically from a row on Ways or a line on the map, never a rail
// item. The figures are the ones Logjam GPS's `routes/RouteStatsBody.tsx` shows
// — distance, climb, descent, the height band, the profile — so the same route
// reads the same on both clients.
//
// A route reached through a place share is READ-ONLY here: the sharee can see
// it and export it, but edit/delete/link belong to the owner. The API enforces
// this with a 403; the UI just doesn't offer the controls.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeftRight,
  Download,
  EllipsisVertical,
  Link2Off,
  MapPin,
  Pencil,
  Share2,
  Trash2,
  X,
} from "lucide-react";
import classes from "./RouteDetailPanel.module.css";
import ConfirmDialog from "../../dialogs/ConfirmDialog";
import ShareDialog from "../../dialogs/ShareDialog";
import RemoveSharedButton from "../../common/RemoveSharedButton";
import { useToast } from "../../feedback/ToastProvider";
import { messageFromError } from "../../../errors/messageFromError";
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
  type MenuEntry,
} from "../../../ui";
import {
  deleteRoute,
  updateRoute,
  useElevationProfile,
  getEntityShares,
  ownerUsername,
  shareEntityWith,
  unshareEntityWith,
  type TRoute,
  type TPlace,
  type TFriend,
} from "../../../placeUtils";
import {
  sharedRowVisibility,
  densifyLine,
  formatDistanceM,
  routeLengthM,
  reverseRoute,
  reverseRouteAnchors,
  exportFilename,
  routeToGpx,
  routeToKml,
  trackColorName,
  GPX_MIME_TYPE,
  KML_MIME_TYPE,
  TRACK_COLORS,
} from "@logjam/shared";

type RouteDetailPanelProps = {
  route: TRoute | null;
  /** Current user id, to decide owner vs sharee. */
  currentUserId: string | null;
  /** Places the user owns, for the link picker. */
  ownedPlaces: TPlace[];
  /**
   * Places shared WITH the user. Not for the picker (a sharee cannot link
   * anything) — this is how a shared route tells whether it is here on a share
   * row of its own or because its place came with it (shared/src/sharing.ts).
   */
  sharedPlaces: TPlace[];
  /** Friends this route can be shared with. */
  friends: TFriend[];
  /** Every route the caller can see, to detect an occupied place slot before
   * linking (the displacement is non-destructive but must not be a surprise). */
  allRoutes: TRoute[];
  onEdit: (route: TRoute) => void;
  onChanged: () => void;
  onClose: () => void;
  /** Open a place's detail panel — where a route that came WITH a shared
   *  place is removed, since it has no share row of its own. */
  onOpenPlace: (placeId: string) => void;
  /** Where along the route the elevation-profile cursor sits, so the map can
   * mark the same spot. Null when the cursor leaves the chart. */
  onHoverPosition: (position: [number, number] | null) => void;
};

/** Trigger a client-side file download. Export never touches the server —
 * the geometry is already here. */
function downloadText(filename: string, text: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function RouteDetailPanel({
  route,
  currentUserId,
  ownedPlaces,
  sharedPlaces,
  friends,
  allRoutes,
  onEdit,
  onChanged,
  onClose,
  onOpenPlace,
  onHoverPosition,
}: RouteDetailPanelProps): React.JSX.Element {
  const toast = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showShare, setShowShare] = useState(false);
  // Place the user picked that already holds a route — pending confirmation.
  const [pendingLink, setPendingLink] = useState<{
    placeId: string;
    placeName: string;
    incumbentName: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  // Above the early return — hooks cannot be conditional. Null points mean no
  // request is made at all.
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

  if (!route) {
    return (
      <div className={classes.root}>
        <Hero title="Route" actions={<IconButton icon={X} label="Close panel" onClick={onClose} />} />
        <p className={classes.note}>No route selected.</p>
      </div>
    );
  }

  const isOwner = currentUserId !== null && route.ownerId === currentUserId;
  const linkedPlace = ownedPlaces.find((c) => c.id === route.placeId) ?? null;
  // The place a SHAREE reached this route through, if that is why they see it.
  // A route linked to a place they cannot see is not an inherited one — the
  // place simply isn't theirs to know about — so only a match here counts.
  const viaPlace =
    sharedPlaces.find((place) => place.id === route.placeId) ?? null;
  const visibility = sharedRowVisibility({
    syncRole: isOwner ? "owner" : "shared",
    visibleLinkedPlaceIds: viaPlace ? [viaPlace.id] : [],
  });

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

  const handleReverse = () =>
    run(
      () =>
        updateRoute(route.id, {
          points: reverseRoute(route.points),
          // Anchors index INTO points, so flipping the geometry without
          // remapping them silently reassigns which vertices the user placed.
          ...(route.anchors
            ? { anchors: reverseRouteAnchors(route.anchors, route.points.length) }
            : {}),
        }),
      "Couldn't reverse the route.",
    );

  const handlePickColor = (color: string) =>
    void run(
      () => updateRoute(route.id, { color }),
      "Couldn't change the route colour.",
    );

  const handleUnlink = () =>
    run(
      () => updateRoute(route.id, { placeId: null }),
      "Couldn't unlink the route.",
    );

  const linkNow = (placeId: string) =>
    run(async () => {
      const result = await updateRoute(route.id, { placeId });
      // Confirm what moved even when the dialog already warned — the write is
      // what makes it true, and a sharee-visible route just changed hands.
      if (result.displacedRoute) {
        toast.info(
          `"${result.displacedRoute.name}" was unlinked and kept as a standalone route.`,
        );
      }
    }, "Couldn't link the route.");

  // A place holds at most one route. Linking to an occupied one displaces the
  // incumbent — it survives standalone, so this is not destructive, but it
  // still changes what a sharee of that place sees. Ask first.
  const handleLinkSelected = (placeId: string) => {
    const incumbent = allRoutes.find(
      (r) => r.placeId === placeId && r.id !== route.id,
    );
    if (!incumbent) {
      void linkNow(placeId);
      return;
    }
    setPendingLink({
      placeId,
      placeName: ownedPlaces.find((c) => c.id === placeId)?.name ?? "That place",
      incumbentName: incumbent.name,
    });
  };

  const handleDelete = () =>
    run(async () => {
      await deleteRoute(route.id);
      onClose();
    }, "Couldn't delete the route.");

  const exportRoute = (format: "gpx" | "kml") =>
    downloadText(
      exportFilename(route.name, format),
      format === "gpx" ? routeToGpx(route.name, route.points) : routeToKml(route.name, route.points),
      format === "gpx" ? GPX_MIME_TYPE : KML_MIME_TYPE,
    );

  // The page's verbs, behind the hero's ⋯ (DESIGN.md §7) rather than a footer
  // of ghost buttons. Export is offered to a sharee too: the geometry is
  // already on their machine, and reading it out is what a share allows.
  const entries: MenuEntry[] = [
    ...(isOwner
      ? ([
          { id: "edit", label: "Edit points", icon: Pencil, disabled: busy, onSelect: () => onEdit(route) },
          {
            id: "reverse",
            label: "Reverse direction",
            icon: ArrowLeftRight,
            disabled: busy,
            onSelect: () => void handleReverse(),
          },
          { id: "share", label: "Share…", icon: Share2, disabled: busy, onSelect: () => setShowShare(true) },
          { id: "sep", separator: true },
        ] satisfies MenuEntry[])
      : []),
    { id: "gpx", label: "Export as GPX", icon: Download, onSelect: () => exportRoute("gpx") },
    { id: "kml", label: "Export as KML", icon: Download, onSelect: () => exportRoute("kml") },
    ...(isOwner
      ? ([
          { id: "sep2", separator: true },
          {
            id: "delete",
            label: "Delete route",
            icon: Trash2,
            danger: true,
            disabled: busy,
            onSelect: () => setConfirmDelete(true),
          },
        ] satisfies MenuEntry[])
      : []),
  ];

  return (
    <div className={classes.root}>
      <Hero
        title={route.name}
        actions={
          <>
            <Menu
              label={`Actions for ${route.name}`}
              title={route.name}
              placement="bottom-end"
              entries={entries}
              trigger={(props) => (
                <IconButton {...props} icon={EllipsisVertical} label={`Actions for ${route.name}`} />
              )}
            />
            <IconButton icon={X} label="Close panel" onClick={onClose} />
          </>
        }
      />

      <div className={classes.body}>
        {/* The three figures Logjam GPS leads with. Distance is always right;
            climb and descent wait on the terrain read, so they say "—" rather
            than a zero that would read as flat ground. */}
        <StatGrid
          stats={[
            { label: "Distance", value: formatDistanceM(routeLengthM(route.points)) },
            { label: "Climb", value: profile ? `↑ ${Math.round(profile.gainM)} m` : "—" },
            { label: "Descent", value: profile ? `↓ ${Math.round(profile.lossM)} m` : "—" },
          ]}
        />

        <section className={classes.section}>
          <SectionHeader title="Elevation" />
          {profileLoading && <p className={classes.note}>Reading the terrain…</p>}
          {profileError && <p className={classes.note}>{profileError}</p>}
          {profile && (
            <>
              {profile.minM != null && profile.maxM != null && (
                <p className={classes.band}>
                  {Math.round(profile.minM)}–{Math.round(profile.maxM)} m above sea level
                </p>
              )}
              {/* The chart's axes named: an unlabelled height profile is read as
                  height over TIME by anyone who has not been told otherwise
                  (mobile §7). */}
              <p className={classes.chartLabel}>Elevation vs distance</p>
              <ElevationProfile
                samples={profile.samples}
                minM={profile.minM}
                maxM={profile.maxM}
                color={route.color}
                onHoverSampleChange={handleHoverSample}
              />
              <p className={classes.attribution}>{profile.attribution}</p>
            </>
          )}
        </section>

        {isOwner && (
          <section className={classes.section}>
            <SwatchPicker
              label="Route colour"
              colors={TRACK_COLORS}
              value={route.color}
              onChange={handlePickColor}
              nameOf={trackColorName}
              disabled={busy}
            />
          </section>
        )}

        <section className={classes.section}>
          <SectionHeader title="Place" />
          {linkedPlace ? (
            <div className={classes.linkRow}>
              <span className={classes.linkName}>{linkedPlace.name}</span>
              {isOwner && (
                <Button compact icon={Link2Off} disabled={busy} onClick={() => void handleUnlink()}>
                  Unlink
                </Button>
              )}
            </div>
          ) : isOwner ? (
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
            // A sharee's place row. It is not decoration: this is the place
            // whose share brought the route, and removing THAT is the only way
            // to stop seeing this (the route carries no share row of its own).
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

        {!isOwner && (
          <section className={classes.section}>
            <p className={classes.note}>
              {visibility === "via-place"
                ? `Shared with you as part of ${viaPlace?.name} — you can view and export this route, but not change it.`
                : "Shared with you — you can view and export this route, but not change it."}
            </p>
            {/* Only on a route shared DIRECTLY: one shared through a place has
                no share row of its own, and the place row above is where that
                ends. */}
            {visibility === "direct" && (
              <RemoveSharedButton
                kindLabel="route"
                itemName={route.name}
                ownerName={ownerUsername(friends, route.ownerId)}
                disabled={busy}
                remove={() => unshareEntityWith("route", route.id, "me")}
                onRemoved={() => {
                  onChanged();
                  onClose();
                }}
              />
            )}
          </section>
        )}
      </div>

      {isOwner && (
        <ShareDialog
          title={`Share ${route.name}`}
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
          if (target) void linkNow(target.placeId);
        }}
        onClose={() => setPendingLink(null)}
      />

      <ConfirmDialog
        open={confirmDelete}
        title="Delete route?"
        message={`"${route.name}" is removed from your account, so it goes from Logjam GPS and your other devices too. This can't be undone.`}
        confirmLabel="Delete"
        busy={busy}
        onConfirm={() => {
          setConfirmDelete(false);
          void handleDelete();
        }}
        onClose={() => setConfirmDelete(false)}
      />
    </div>
  );
}
