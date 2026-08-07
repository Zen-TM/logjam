// Routes: the drawing tool, the lines the user authored, and the track files
// attached to their canyons.
//
// Two kinds of line live here and they are NOT the same thing. A ROUTE is drawn
// in this app and stored as geometry. A TRACK is a GPX/KML the user uploaded
// against a canyon or trip — it belongs to that canyon, so its row opens the
// canyon rather than pretending to be a route.
//
// Visibility toggles stay in the Layers panel; this panel is about the things,
// not about what the map is currently showing.
import { Pencil } from "lucide-react";
import classes from "./RoutesPanel.module.css";
import TrackIcon from "../../media/TrackIcon";
import type { PanelId } from "../panels";
import type { TCanyon, TRoute, CanyonTrack } from "../../../canyonUtils";
import { formatDistanceM, routeLengthM } from "@logjam/shared";

type RoutesPanelProps = {
  routes: TRoute[];
  /** Owner vs sharee: a route reached through a canyon share is listed, but
   * under the canyon it came with rather than as the user's own work. */
  currentUserId: string | null;
  canyonTracks: CanyonTrack[];
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
  canyons,
  onStartDrawingRoute,
  onSelectRoute,
  setSelectedCanyonID,
  setActivePanel,
}: RoutesPanelProps): React.JSX.Element {
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
    </div>
  );
}
