// Routes: the drawing tool, the lines the user authored, and the track files
// attached to their canyons.
//
// Two kinds of line live here and they are NOT the same thing. A ROUTE is drawn
// in this app and stored as geometry. A TRACK is a GPX/KML the user uploaded
// against a canyon or trip — it belongs to that canyon, so its row opens the
// canyon rather than pretending to be a route.
//
// A third kind now lives here too: a STANDALONE FILE — an import or a track
// Logjam GPS recorded — which belongs to no canyon at all, so this is the only
// surface it can appear on. Its checkbox IS its map visibility (there is no
// Layers-panel toggle for a per-file list), which is the one deliberate
// exception to the rule below.
//
// Visibility toggles stay in the Layers panel; this panel is about the things,
// not about what the map is currently showing.
import { useState } from "react";
import { Crosshair, Pencil, Trash2 } from "lucide-react";
import classes from "./RoutesPanel.module.css";
import TrackIcon from "../../media/TrackIcon";
import ConfirmDialog from "../../dialogs/ConfirmDialog";
import { ErrorBanner } from "../../feedback/ErrorBanner";
import type { PanelId } from "../panels";
import type { TCanyon, TRoute, CanyonTrack } from "../../../canyonUtils";
import {
  formatDistanceM,
  mediaDisplayName,
  routeLengthM,
  type StandaloneFile,
} from "@logjam/shared";

type RoutesPanelProps = {
  routes: TRoute[];
  /** Owner vs sharee: a route reached through a canyon share is listed, but
   * under the canyon it came with rather than as the user's own work. */
  currentUserId: string | null;
  canyonTracks: CanyonTrack[];
  /** The user's own imports and Logjam GPS recordings (metadata only). */
  standaloneFiles: StandaloneFile[];
  standaloneFilesError: string | null;
  /** Which of those are currently drawn on the map. */
  shownStandaloneIds: string[];
  onToggleStandaloneFile: (id: string) => void;
  onRenameStandaloneFile: (id: string, displayName: string) => void;
  onDeleteStandaloneFile: (file: StandaloneFile) => Promise<void>;
  /** Centre the map on a file's recorded extent. */
  onFlyToStandaloneFile: (file: StandaloneFile) => void;
  /** Owned + shared, for naming a track's canyon. */
  canyons: TCanyon[];
  onStartDrawingRoute: () => void;
  onSelectRoute: (id: string) => void;
  setSelectedCanyonID: (id: string) => void;
  setActivePanel: (panel: PanelId) => void;
};

export default function RoutesPanel({
  routes,
  currentUserId,
  canyonTracks,
  standaloneFiles,
  standaloneFilesError,
  shownStandaloneIds,
  onToggleStandaloneFile,
  onRenameStandaloneFile,
  onDeleteStandaloneFile,
  onFlyToStandaloneFile,
  canyons,
  onStartDrawingRoute,
  onSelectRoute,
  setSelectedCanyonID,
  setActivePanel,
}: RoutesPanelProps): React.JSX.Element {
  const [pendingDelete, setPendingDelete] = useState<StandaloneFile | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const ownRoutes = routes.filter((route) => route.ownerId === currentUserId);
  const sharedRoutes = routes.filter((route) => route.ownerId !== currentUserId);
  const canyonName = (id: string) =>
    canyons.find((canyon) => canyon.id === id)?.name ?? "Unnamed canyon";

  const routeRow = (route: TRoute) => (
    <button
      key={route.id}
      type="button"
      className={classes.row}
      onClick={() => onSelectRoute(route.id)}
    >
      <TrackIcon color={route.color} size={16} />
      <span className={classes.rowName}>{route.name}</span>
      <span className={classes.rowMeta}>
        {formatDistanceM(routeLengthM(route.points))}
      </span>
    </button>
  );

  return (
    <div className={classes.root}>
      <button
        type="button"
        className={classes.drawButton}
        onClick={onStartDrawingRoute}
      >
        <Pencil size={14} /> Draw a route
      </button>

      <div className={classes.sectionLabel}>My routes</div>
      {ownRoutes.length === 0 ? (
        <span className={classes.caption}>
          No routes yet. Draw one and it lands here.
        </span>
      ) : (
        ownRoutes.map(routeRow)
      )}

      {sharedRoutes.length > 0 && (
        <>
          <div className={classes.sectionLabel}>Shared with me</div>
          {sharedRoutes.map(routeRow)}
        </>
      )}

      <div className={classes.divider} />

      <div className={classes.sectionLabel}>Tracks</div>
      {canyonTracks.length === 0 ? (
        <span className={classes.caption}>
          No track files. GPX and KML uploaded to a canyon appear here.
        </span>
      ) : (
        canyonTracks.map((track) => (
          <button
            key={track.mediaId}
            type="button"
            className={classes.row}
            onClick={() => {
              setSelectedCanyonID(track.canyonId);
              setActivePanel("canyon-detail");
            }}
          >
            <TrackIcon color={track.color} size={16} />
            <span className={classes.rowName}>{canyonName(track.canyonId)}</span>
          </button>
        ))
      )}

      <div className={classes.divider} />

      <div className={classes.sectionLabel}>My files</div>
      {standaloneFilesError && <ErrorBanner message={standaloneFilesError} />}
      {standaloneFiles.length === 0 ? (
        <span className={classes.caption}>
          Nothing yet. Tracks you record in Logjam GPS and files you import
          there appear here.
        </span>
      ) : (
        standaloneFiles.map((file) => (
          <StandaloneFileRow
            key={file.id}
            file={file}
            shown={shownStandaloneIds.includes(file.id)}
            onToggle={() => onToggleStandaloneFile(file.id)}
            onRename={(name) => onRenameStandaloneFile(file.id, name)}
            onFlyTo={() => onFlyToStandaloneFile(file)}
            onDelete={() => setPendingDelete(file)}
          />
        ))
      )}

      <ConfirmDialog
        open={pendingDelete != null}
        title="Delete this file?"
        message="The file and its track are removed from every device. This can't be undone."
        busy={deleteBusy}
        onConfirm={() => {
          if (!pendingDelete) return;
          setDeleteBusy(true);
          void onDeleteStandaloneFile(pendingDelete).finally(() => {
            setDeleteBusy(false);
            setPendingDelete(null);
          });
        }}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
}

/** One standalone file: draw it, rename it, find it, delete it. Deliberately
 * plain — the panel surface is a stopgap while the map layer is the point. */
function StandaloneFileRow({
  file,
  shown,
  onToggle,
  onRename,
  onFlyTo,
  onDelete,
}: {
  file: StandaloneFile;
  shown: boolean;
  onToggle: () => void;
  onRename: (displayName: string) => void;
  onFlyTo: () => void;
  onDelete: () => void;
}): React.JSX.Element {
  const current = mediaDisplayName(file);
  const [name, setName] = useState(current);
  const commit = () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === current) {
      setName(current);
      return;
    }
    onRename(trimmed);
  };
  const distanceM = file.metadata.distanceM;

  // A file linked to a canyon is that canyon's way, and the canyon-tracks layer
  // already draws it — so it gets no toggle of its own rather than a checkbox
  // that appears to do nothing. The disabled input keeps the row's columns
  // aligned with its neighbours.
  const isCanyonWay = file.linkedCanyonId !== null;

  return (
    <div className={classes.fileRow}>
      <input
        type="checkbox"
        checked={shown && !isCanyonWay}
        onChange={onToggle}
        disabled={isCanyonWay}
        title={isCanyonWay ? "Drawn as this canyon's route" : undefined}
        aria-label={
          isCanyonWay
            ? `${current} is a canyon's route and is already on the map`
            : `Show ${current} on the map`
        }
      />
      <TrackIcon color={file.color} size={16} />
      <input
        className={classes.fileName}
        value={name}
        onChange={(event) => setName(event.target.value)}
        onBlur={commit}
        aria-label="File name"
      />
      {distanceM != null && (
        <span className={classes.rowMeta}>{formatDistanceM(distanceM)}</span>
      )}
      <button
        type="button"
        className={classes.iconBtn}
        onClick={onFlyTo}
        disabled={file.metadata.bbox == null}
        title="Centre the map here"
      >
        <Crosshair size={14} />
      </button>
      <button
        type="button"
        className={classes.iconBtn}
        onClick={onDelete}
        title="Delete file"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}
