import { useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
  Switch,
  Box,
  CircularProgress,
  Typography,
} from "@mui/material";
import classes from "./Sidebar.module.css";
import Arrow from "../../assets/arrow.svg";
import SidebarModule from "./sidebarModule/SidebarModule";
import Filters from "./sidebarModule/filters/Filters";
import CanyonDialog from "../CanyonDialog";
import type { TCanyon, TFilters, RefreshResult } from "../../canyonUtils";
import {
  formatCanyonGrade,
  deleteCanyon,
  refreshFromRopeWiki,
} from "../../canyonUtils";

function Sidebar({
  onChangeFilters,
  filters,
  selectedCanyonID,
  setSelectedCanyonID,
  canyons,
  sidebarOpen,
  setSidebarOpen,
  onRefetch,
  onPickCoords,
  pickingCoords,
  onCancelPickCoords,
  showOwnedCanyons,
  setShowOwnedCanyons,
  showSharedCanyons,
  setShowSharedCanyons,
}: {
  onChangeFilters: (filters: TFilters) => void;
  filters: TFilters;
  selectedCanyonID: string | null;
  setSelectedCanyonID: (id: string | null) => void;
  canyons: TCanyon[];
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  onRefetch: () => void;
  onPickCoords: (onPicked: (lat: number, lng: number) => void) => void;
  pickingCoords: boolean;
  onCancelPickCoords: () => void;
  showOwnedCanyons: boolean;
  setShowOwnedCanyons: (show: boolean) => void;
  showSharedCanyons: boolean;
  setShowSharedCanyons: (show: boolean) => void;
}) {
  const canyon = canyons.find((c) => c.id === selectedCanyonID);
  const [showEdit, setShowEdit] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshResult, setRefreshResult] = useState<RefreshResult | null>(
    null,
  );

  async function handleDelete() {
    if (!canyon) return;
    setDeleting(true);
    try {
      await deleteCanyon(canyon.id);
      setShowDeleteConfirm(false);
      setDeleting(false);
      setSelectedCanyonID(null);
      onRefetch();
    } catch {
      setDeleting(false);
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    setRefreshResult(null);
    try {
      const result = await refreshFromRopeWiki();
      setRefreshResult(result);
      onRefetch();
    } catch {
      setRefreshResult(null);
    } finally {
      setRefreshing(false);
    }
  }

  function sidebarModules() {
    return (
      <>
        <SidebarModule sidebarOpen={sidebarOpen} moduleName="Canyon Options">
          <div className={classes.optionsContent}>
            <button
              className={classes.addButton}
              onClick={() => setShowAdd(true)}
            >
              + Add Canyon
            </button>

            <div className={classes.toggleRow}>
              <span>Show my canyons</span>
              <Switch
                size="small"
                checked={showOwnedCanyons}
                onChange={(_, checked) => setShowOwnedCanyons(checked)}
                sx={{
                  "& .MuiSwitch-switchBase.Mui-checked": {
                    color: "#f97316",
                  },
                  "& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track": {
                    backgroundColor: "#f97316",
                  },
                }}
              />
            </div>
            <div className={classes.toggleRow}>
              <span>Show shared canyons</span>
              <Switch
                size="small"
                checked={showSharedCanyons}
                onChange={(_, checked) => setShowSharedCanyons(checked)}
                sx={{
                  "& .MuiSwitch-switchBase.Mui-checked": {
                    color: "#3b82f6",
                  },
                  "& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track": {
                    backgroundColor: "#3b82f6",
                  },
                }}
              />
            </div>

            <button
              className={classes.refreshButton}
              onClick={handleRefresh}
              disabled={refreshing}
            >
              {refreshing ? "Refreshing..." : "Refresh from RopeWiki"}
            </button>
            {refreshResult && (
              <Typography
                variant="caption"
                sx={{ color: "var(--content-color)", opacity: 0.7 }}
              >
                {refreshResult.added} added, {refreshResult.updated} updated,{" "}
                {refreshResult.unchanged} unchanged
                {refreshResult.userEdited > 0 &&
                  `, ${refreshResult.userEdited} kept (edited)`}
              </Typography>
            )}
          </div>
        </SidebarModule>
        <span className={classes.separator} />
        <SidebarModule sidebarOpen={sidebarOpen} moduleName="Filters">
          <Filters onChangeFilters={onChangeFilters} filters={filters} />
        </SidebarModule>
        <span className={classes.separator} />
      </>
    );
  }

  function canyonInfo() {
    if (!canyon) return null;
    const canyonGrade = formatCanyonGrade(canyon);
    const attr = canyon.attributes;

    return (
      <div className={classes.canyonInfo}>
        {canyon.altNames.length > 0 && (
          <p className={classes.altNames}>
            Also known as: {canyon.altNames.join(", ")}
          </p>
        )}
        {canyon.ropeWikiId != null && (
          <p className={classes.disclaimer}>
            Canyon data imported from RopeWiki.
          </p>
        )}
        {canyonGrade && (
          <p>
            <b>Grade:</b> {canyonGrade}
          </p>
        )}
        <p>
          <b>Location:</b> {canyon.latitude.toFixed(4)},{" "}
          {canyon.longitude.toFixed(4)}
        </p>
        {attr.quality != null && (
          <p>
            <b>Quality:</b> {attr.quality}/5
          </p>
        )}
        {canyon.numAbseils != null && (
          <p>
            <b>Pitches:</b> {canyon.numAbseils}
          </p>
        )}
        {canyon.longestAbseil != null && (
          <p>
            <b>Longest Pitch:</b> {canyon.longestAbseil}m
          </p>
        )}
        {attr.hours != null && (
          <p>
            <b>Hours:</b> {attr.hours}
          </p>
        )}
        {attr.rock_type && (
          <p>
            <b>Rock Type:</b> {attr.rock_type}
          </p>
        )}
        {attr.wetsuits != null && (
          <p>
            <b>Wetsuits Required:</b> {attr.wetsuits}/5
          </p>
        )}
        {attr.description && (
          <p>
            <b>Description:</b>
            <br />
            {attr.description}
          </p>
        )}
        {attr.sources && attr.sources.length > 0 && (
          <div>
            <b>Sources:</b>
            <ul className={classes.sourcesList}>
              {attr.sources.map(([label, url], i) => (
                <li key={i}>
                  {url ? (
                    <a href={url} target="_blank" rel="noopener noreferrer">
                      {label}
                    </a>
                  ) : (
                    label
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className={classes.canyonActions}>
          <button
            className={classes.editButton}
            onClick={() => setShowEdit(true)}
          >
            Edit
          </button>
          <button
            className={classes.deleteButton}
            onClick={() => setShowDeleteConfirm(true)}
          >
            Delete
          </button>
        </div>
      </div>
    );
  }
  return (
    <div
      className={classes.sidebar}
      style={{
        width: sidebarOpen ? "300px" : "50px",
        pointerEvents: pickingCoords ? "none" : undefined,
        opacity: pickingCoords ? 0.5 : undefined,
      }}
    >
      <div
        className={classes.sidebarContent}
        style={{
          opacity: sidebarOpen ? 1 : 0,
        }}
      >
        {selectedCanyonID != null ? (
          <div className={classes.canyonHeader}>
            <button
              className={classes.backButton}
              onClick={() => setSelectedCanyonID(null)}
            >
              <img
                className={`${classes.arrow} icon`}
                src={Arrow}
                alt="Arrow"
              />
            </button>
            <h2 style={{ marginLeft: "0.5em" }}>{canyon?.name}</h2>
          </div>
        ) : (
          <h2>Sidebar</h2>
        )}

        <span className={classes.separator} />
        {selectedCanyonID == null ? sidebarModules() : canyonInfo()}
      </div>
      <button
        className={classes.toggleButton}
        onClick={() => setSidebarOpen(!sidebarOpen)}
      >
        <img
          className={`${classes.arrow} icon`}
          src={Arrow}
          alt="Arrow"
          style={{
            transform: sidebarOpen ? "rotate(0deg)" : "rotate(180deg)",
            transition: "transform 0.3s",
          }}
        />
      </button>

      {/* Edit canyon dialog */}
      {canyon && (
        <CanyonDialog
          canyon={canyon}
          open={showEdit && !pickingCoords}
          onClose={() => setShowEdit(false)}
          onSaved={onRefetch}
          onPickCoords={onPickCoords}
          onCancelPickCoords={onCancelPickCoords}
        />
      )}

      {/* Add canyon dialog */}
      <CanyonDialog
        canyon={null}
        open={showAdd && !pickingCoords}
        onClose={() => setShowAdd(false)}
        onSaved={onRefetch}
        onPickCoords={onPickCoords}
        onCancelPickCoords={onCancelPickCoords}
      />

      {/* Delete confirmation */}
      {canyon && (
        <Dialog
          open={showDeleteConfirm}
          onClose={deleting ? undefined : () => setShowDeleteConfirm(false)}
        >
          <DialogTitle>Delete Canyon</DialogTitle>
          <DialogContent>
            <DialogContentText>
              Are you sure you want to delete {canyon.name}? Trip logs and other
              associated data will also be deleted. This cannot be undone.
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button
              onClick={() => setShowDeleteConfirm(false)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleDelete}
              color="error"
              variant="contained"
              disabled={deleting}
            >
              {deleting ? "Deleting..." : "Delete"}
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </div>
  );
}

export default Sidebar;
