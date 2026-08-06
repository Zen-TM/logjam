// Detail view for a route selected on the map. Opened programmatically from a
// map click (never a NavRail item), mirroring CanyonDetailPanel.
//
// A route reached through a canyon share is READ-ONLY here: the sharee can see
// it and export it, but edit/delete/link belong to the owner. The API enforces
// this with a 403; the UI just doesn't offer the controls.
import { useState } from "react";
import { Pencil, Trash2, Download, ArrowLeftRight, Link2Off } from "lucide-react";
import classes from "./RouteDetailPanel.module.css";
import shared from "../../../styles/shared.module.css";
import ConfirmDialog from "../../dialogs/ConfirmDialog";
import TrackIcon from "../../media/TrackIcon";
import { useToast } from "../../feedback/ToastProvider";
import { messageFromError } from "../../../errors/messageFromError";
import ElevationProfile from "../../routes/ElevationProfile";
import {
  deleteRoute,
  updateRoute,
  useElevationProfile,
  type TRoute,
  type TCanyon,
} from "../../../canyonUtils";
import {
  formatDistanceM,
  routeLengthM,
  reverseRoute,
  trackPointsToGpx,
} from "@logjam/shared";

type RouteDetailPanelProps = {
  route: TRoute | null;
  /** Current user id, to decide owner vs sharee. */
  currentUserId: string | null;
  /** Canyons the user owns, for the link picker. */
  ownedCanyons: TCanyon[];
  /** Every route the caller can see, to detect an occupied canyon slot before
   * linking (the displacement is non-destructive but must not be a surprise). */
  allRoutes: TRoute[];
  onEdit: (route: TRoute) => void;
  onChanged: () => void;
  onClose: () => void;
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

/** Minimal KML document for one line. GPX has a shared writer already
 * (trackPointsToGpx); KML does not, and one <LineString> does not justify a
 * second serialiser in shared/. */
function routeToKml(name: string, points: [number, number][]): string {
  const escaped = name.replace(/[<>&"']/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!,
  );
  const coords = points
    .map(([lon, lat]) => `${lon.toFixed(6)},${lat.toFixed(6)}`)
    .join(" ");
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escaped}</name>
    <Placemark>
      <name>${escaped}</name>
      <LineString><coordinates>${coords}</coordinates></LineString>
    </Placemark>
  </Document>
</kml>
`;
}

export default function RouteDetailPanel({
  route,
  currentUserId,
  ownedCanyons,
  allRoutes,
  onEdit,
  onChanged,
  onClose,
}: RouteDetailPanelProps): React.JSX.Element {
  const toast = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Canyon the user picked that already holds a route — pending confirmation.
  const [pendingLink, setPendingLink] = useState<{
    canyonId: string;
    canyonName: string;
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

  if (!route) {
    return <span className={classes.caption}>No route selected.</span>;
  }

  const isOwner = currentUserId !== null && route.ownerId === currentUserId;
  const linkedCanyon = ownedCanyons.find((c) => c.id === route.canyonId) ?? null;

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
      () => updateRoute(route.id, { points: reverseRoute(route.points) }),
      "Couldn't reverse the route.",
    );

  const handleUnlink = () =>
    run(
      () => updateRoute(route.id, { canyonId: null }),
      "Couldn't unlink the route.",
    );

  const linkNow = (canyonId: string) =>
    run(async () => {
      const result = await updateRoute(route.id, { canyonId });
      // Confirm what moved even when the dialog already warned — the write is
      // what makes it true, and a sharee-visible route just changed hands.
      if (result.displacedRoute) {
        toast.info(
          `"${result.displacedRoute.name}" was unlinked and kept as a standalone route.`,
        );
      }
    }, "Couldn't link the route.");

  // A canyon holds at most one route. Linking to an occupied one displaces the
  // incumbent — it survives standalone, so this is not destructive, but it
  // still changes what a sharee of that canyon sees. Ask first.
  const handleLinkSelected = (canyonId: string) => {
    const incumbent = allRoutes.find(
      (r) => r.canyonId === canyonId && r.id !== route.id,
    );
    if (!incumbent) {
      void linkNow(canyonId);
      return;
    }
    setPendingLink({
      canyonId,
      canyonName: ownedCanyons.find((c) => c.id === canyonId)?.name ?? "That canyon",
      incumbentName: incumbent.name,
    });
  };

  const handleDelete = () =>
    run(async () => {
      await deleteRoute(route.id);
      onClose();
    }, "Couldn't delete the route.");

  return (
    <div className={classes.root}>
      <div className={classes.summary}>
        <TrackIcon color={route.color} size={20} />
        <div>
          <div className={classes.distance}>
            {formatDistanceM(routeLengthM(route.points))}
          </div>
          <div className={classes.caption}>{route.points.length} points</div>
        </div>
      </div>

      {!isOwner && (
        <p className={classes.caption}>
          Shared with you — you can view and export this route, but not change it.
        </p>
      )}

      <div className={shared.sectionLabel}>Elevation</div>
      {profileLoading && <span className={classes.caption}>Reading the terrain…</span>}
      {profileError && <span className={classes.caption}>{profileError}</span>}
      {profile && (
        <>
          <div className={classes.elevationStats}>
            <span title="Total climb">↑ {Math.round(profile.gainM)} m</span>
            <span title="Total descent">↓ {Math.round(profile.lossM)} m</span>
            {profile.minM != null && profile.maxM != null && (
              <span title="Lowest and highest point">
                {Math.round(profile.minM)}–{Math.round(profile.maxM)} m
              </span>
            )}
          </div>
          <ElevationProfile
            samples={profile.samples}
            minM={profile.minM}
            maxM={profile.maxM}
            color={route.color}
          />
          <span className={classes.caption}>{profile.attribution}</span>
        </>
      )}

      <div className={shared.divider} />

      <div className={shared.sectionLabel}>Canyon</div>
      {linkedCanyon ? (
        <div className={classes.linkRow}>
          <span className={classes.linkName}>{linkedCanyon.name}</span>
          {isOwner && (
            <button
              type="button"
              className={`${shared.btn} ${shared.btnGhost} ${shared.btnXs}`}
              onClick={handleUnlink}
              disabled={busy}
              title="Unlink from this canyon (the route is kept)"
            >
              <Link2Off size={14} /> Unlink
            </button>
          )}
        </div>
      ) : isOwner ? (
        <select
          className={shared.input}
          value=""
          disabled={busy}
          onChange={(e) => e.target.value && handleLinkSelected(e.target.value)}
        >
          <option value="">Link to a canyon…</option>
          {ownedCanyons.map((canyon) => (
            <option key={canyon.id} value={canyon.id}>
              {canyon.name}
            </option>
          ))}
        </select>
      ) : (
        <span className={classes.caption}>Not linked to a canyon.</span>
      )}

      <div className={shared.divider} />

      <div className={classes.actions}>
        <button
          type="button"
          className={`${shared.btn} ${shared.btnGhost} ${shared.btnSm}`}
          onClick={() =>
            downloadText(
              `${route.name}.gpx`,
              trackPointsToGpx(
                route.name,
                route.points.map(([lon, lat]) => ({
                  lon,
                  lat,
                  altitudeM: null,
                  accuracyM: null,
                  timestampMs: 0,
                  segment: 0,
                })),
              ),
              "application/gpx+xml",
            )
          }
        >
          <Download size={14} /> GPX
        </button>
        <button
          type="button"
          className={`${shared.btn} ${shared.btnGhost} ${shared.btnSm}`}
          onClick={() =>
            downloadText(
              `${route.name}.kml`,
              routeToKml(route.name, route.points),
              "application/vnd.google-earth.kml+xml",
            )
          }
        >
          <Download size={14} /> KML
        </button>

        {isOwner && (
          <>
            <button
              type="button"
              className={`${shared.btn} ${shared.btnGhost} ${shared.btnSm}`}
              onClick={() => onEdit(route)}
              disabled={busy}
            >
              <Pencil size={14} /> Edit
            </button>
            <button
              type="button"
              className={`${shared.btn} ${shared.btnGhost} ${shared.btnSm}`}
              onClick={handleReverse}
              disabled={busy}
              title="Reverse the direction of travel"
            >
              <ArrowLeftRight size={14} /> Reverse
            </button>
            <button
              type="button"
              className={`${shared.btn} ${shared.btnOutlineWarning} ${shared.btnSm}`}
              onClick={() => setConfirmDelete(true)}
              disabled={busy}
            >
              <Trash2 size={14} /> Delete
            </button>
          </>
        )}
      </div>

      <ConfirmDialog
        open={pendingLink !== null}
        title="Replace this canyon's route?"
        message={
          pendingLink
            ? `${pendingLink.canyonName} already has the route "${pendingLink.incumbentName}". It will be unlinked and kept as a standalone route — nothing is deleted.`
            : ""
        }
        confirmLabel="Replace"
        confirmColor="primary"
        busy={busy}
        onConfirm={() => {
          const target = pendingLink;
          setPendingLink(null);
          if (target) void linkNow(target.canyonId);
        }}
        onClose={() => setPendingLink(null)}
      />

      <ConfirmDialog
        open={confirmDelete}
        title="Delete route?"
        message={`"${route.name}" will be permanently deleted.`}
        confirmLabel="Delete"
        onConfirm={() => {
          setConfirmDelete(false);
          void handleDelete();
        }}
        onClose={() => setConfirmDelete(false)}
      />
    </div>
  );
}
