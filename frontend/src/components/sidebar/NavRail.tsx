import {
  Layers,
  Map,
  MapPin,
  Mountain,
  BookOpen,
  BarChart3,
  Users,
  Bell,
  CircleUser,
} from "lucide-react";
import type { PanelId } from "./panels";
import classes from "./NavRail.module.css";

const TOP_ITEMS: { id: PanelId; label: string; Icon: typeof Layers }[] = [
  { id: "layers", label: "Layers", Icon: Layers },
  { id: "canyons", label: "Canyons", Icon: MapPin },
  { id: "geopdfs", label: "GeoPDFs", Icon: Map },
  { id: "lidar", label: "LiDAR", Icon: Mountain },
  { id: "trip-logs", label: "Trip Logs", Icon: BookOpen },
  { id: "analytics", label: "Analytics", Icon: BarChart3 },
  { id: "friends", label: "Friends", Icon: Users },
];

const BOTTOM_ITEMS: { id: PanelId; label: string; Icon: typeof Layers }[] = [
  { id: "notifications", label: "Alerts", Icon: Bell },
  { id: "account", label: "Account", Icon: CircleUser },
];

function NavRail({
  activePanel,
  onPanelChange,
  unreadCount,
}: {
  activePanel: PanelId | null;
  onPanelChange: (panel: PanelId | null) => void;
  unreadCount: number;
}) {
  function handleClick(id: PanelId) {
    onPanelChange(activePanel === id ? null : id);
  }

  return (
    <nav className={classes.navRail}>
      {TOP_ITEMS.map(({ id, label, Icon }) => (
        <button
          key={id}
          className={`${classes.navItem} ${activePanel === id ? classes.active : ""}`}
          onClick={() => handleClick(id)}
          title={label}
        >
          <Icon size={20} />
          <span className={classes.label}>{label}</span>
        </button>
      ))}

      <div className={classes.spacer} />

      {BOTTOM_ITEMS.map(({ id, label, Icon }) => (
        <button
          key={id}
          className={`${classes.navItem} ${activePanel === id ? classes.active : ""}`}
          onClick={() => handleClick(id)}
          title={label}
        >
          <Icon size={20} />
          <span className={classes.label}>{label}</span>
          {id === "notifications" && unreadCount > 0 && (
            <span className={classes.badge}>{unreadCount}</span>
          )}
        </button>
      ))}
    </nav>
  );
}

export default NavRail;
