import { Switch } from "@mui/material";
import classes from "../Sidebar.module.css";

function OverlaysPanel({
  showOwnedCanyons,
  setShowOwnedCanyons,
  showSharedCanyons,
  setShowSharedCanyons,
}: {
  showOwnedCanyons: boolean;
  setShowOwnedCanyons: (show: boolean) => void;
  showSharedCanyons: boolean;
  setShowSharedCanyons: (show: boolean) => void;
}) {
  return (
    <div className={classes.optionsContent}>
      <div className={classes.toggleRow}>
        <span>My Canyons</span>
        <Switch
          size="small"
          checked={showOwnedCanyons}
          onChange={(_, checked) => setShowOwnedCanyons(checked)}
          sx={{
            "& .MuiSwitch-switchBase.Mui-checked": { color: "#f97316" },
            "& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track": {
              backgroundColor: "#f97316",
            },
          }}
        />
      </div>
      <div className={classes.toggleRow}>
        <span>Shared Canyons</span>
        <Switch
          size="small"
          checked={showSharedCanyons}
          onChange={(_, checked) => setShowSharedCanyons(checked)}
          sx={{
            "& .MuiSwitch-switchBase.Mui-checked": { color: "#3b82f6" },
            "& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track": {
              backgroundColor: "#3b82f6",
            },
          }}
        />
      </div>
      <div className={classes.toggleRow}>
        <span>LiDAR Topos</span>
        <Switch size="small" disabled checked={false} />
      </div>
    </div>
  );
}

export default OverlaysPanel;
