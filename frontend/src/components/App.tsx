import { useState, useEffect, useRef, useCallback } from "react";
import NavRail from "./sidebar/NavRail";
import SidebarPanel from "./sidebar/SidebarPanel";
import Map, { BASE_LAYERS } from "./map/Map";
import SignIn from "./SignIn";
import ImportDialog from "./ImportDialog";
import TopoDialog from "./TopoDialog";
import CanyonDialog from "./CanyonDialog";
import classes from "./App.module.css";
import type { TBbox } from "./map/Map";
import type { TFilters, TCanyon } from "../canyonUtils";
import type { PanelId } from "./sidebar/panels";
import {
  useCanyons,
  useSharedCanyons,
  useFriends,
  useNotifications,
  deleteCanyon,
  shareCanyonWith,
} from "../canyonUtils";
import { useAuth } from "../useAuth";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
  TextField,
  Typography,
  Box,
} from "@mui/material";

function App() {
  const [filters, setFilters] = useState<TFilters>({
    name: null,
    v_grade: null,
    a_grade: null,
    commitment: null,
    quality: null,
    pitches: null,
    longest_pitch: null,
    hours: null,
    wetsuits: null,
  });
  const [selectedCanyonID, setSelectedCanyonID] = useState<string | null>(null);
  const [activePanel, setActivePanel] = useState<PanelId | null>(null);
  const [activeLayerId, setActiveLayerId] = useState(BASE_LAYERS[0].id);

  const [showImport, setShowImport] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const importChecked = useRef(false);

  // Layer visibility toggles
  const [showOwnedCanyons, setShowOwnedCanyons] = useState(true);
  const [showSharedCanyons, setShowSharedCanyons] = useState(true);

  // Coordinate picking mode for CanyonDialog
  const [pickingCoords, setPickingCoords] = useState(false);
  const coordsCallbackRef = useRef<((lat: number, lng: number) => void) | null>(null);

  // Area selection mode
  const [selectingArea, setSelectingArea] = useState(false);
  const [selectedAreaCanyonIds, setSelectedAreaCanyonIds] = useState<string[]>([]);

  // Topo dialog (per-job overlays)
  const [showTopo, setShowTopo] = useState(false);
  const [selectingTopoBbox, setSelectingTopoBbox] = useState(false);
  const [pendingTopoBbox, setPendingTopoBbox] = useState<TBbox | null>(null);
  const [topoOverlayLayers, setTopoOverlayLayers] = useState<{ id: string; pmtilesUrl: string; format?: "raster" | "vector" }[]>([]);

  // Master topo layers from the Overlays panel (communal, persistent)
  const [masterTopoLayers, setMasterTopoLayers] = useState<{ id: string; pmtilesUrl: string; format?: "raster" | "vector" }[]>([]);

  const startPickingCoords = useCallback(
    (onPicked: (lat: number, lng: number) => void) => {
      coordsCallbackRef.current = onPicked;
      setPickingCoords(true);
    },
    [],
  );

  const handleCoordsPicked = useCallback(
    (lat: number, lng: number) => {
      coordsCallbackRef.current?.(lat, lng);
      coordsCallbackRef.current = null;
      setPickingCoords(false);
    },
    [],
  );

  const cancelPickingCoords = useCallback(() => {
    coordsCallbackRef.current = null;
    setPickingCoords(false);
  }, []);

  const startAreaSelection = useCallback(() => {
    setSelectingArea(true);
    setSelectedAreaCanyonIds([]);
  }, []);

  const handleAreaSelected = useCallback((ids: string[]) => {
    setSelectingArea(false);
    setSelectedAreaCanyonIds(ids);
  }, []);

  const cancelAreaSelection = useCallback(() => {
    setSelectingArea(false);
    setSelectedAreaCanyonIds([]);
  }, []);

  // When switching away from canyon-detail via NavRail, clear selectedCanyonID
  const handlePanelChange = useCallback((panel: PanelId | null) => {
    if (panel !== "canyon-detail") {
      setSelectedCanyonID(null);
    }
    setActivePanel(panel);
  }, []);

  // When closing the panel
  const handlePanelClose = useCallback(() => {
    if (activePanel === "canyon-detail") {
      setSelectedCanyonID(null);
    }
    setActivePanel(null);
  }, [activePanel]);

  const auth = useAuth();
  const authenticated = auth.state === "authenticated";
  const { canyons, loaded: canyonsLoaded, refetch } = useCanyons(authenticated);
  const { canyons: sharedCanyons, refetch: refetchShared } = useSharedCanyons(authenticated);
  const { friends, requests: friendRequests, refetch: refetchFriends } = useFriends(authenticated);
  const { notifications, unreadCount, refetch: refetchNotifications } = useNotifications(authenticated);

  // Show import dialog once when user has no canyons after first fetch completes
  useEffect(() => {
    if (canyonsLoaded && !importChecked.current) {
      importChecked.current = true;
      if (canyons.length === 0) {
        setShowImport(true);
      }
    }
  }, [canyonsLoaded, canyons.length]);

  // Derived values
  const allCanyons = [...canyons, ...sharedCanyons];
  const canyon = allCanyons.find((c) => c.id === selectedCanyonID);
  const ownedCanyonIds = new Set(canyons.map((c) => c.id));
  const isOwnedCanyon = canyon != null && ownedCanyonIds.has(canyon.id);

  // Bulk area action state
  const [bulkShareFriendIds, setBulkShareFriendIds] = useState<string[]>([]);
  const [bulkShareSearch, setBulkShareSearch] = useState("");
  const [bulkSharing, setBulkSharing] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);

  const selectedAreaCanyons = selectedAreaCanyonIds
    .map((id) => allCanyons.find((c) => c.id === id))
    .filter((c): c is TCanyon => c != null);
  const ownedAreaCanyons = selectedAreaCanyons.filter((c) =>
    ownedCanyonIds.has(c.id),
  );

  async function handleBulkShare() {
    if (bulkShareFriendIds.length === 0 || ownedAreaCanyons.length === 0)
      return;
    setBulkSharing(true);
    try {
      for (const c of ownedAreaCanyons) {
        for (const fId of bulkShareFriendIds) {
          try {
            await shareCanyonWith(c.id, fId);
          } catch {
            // skip duplicates / errors
          }
        }
      }
      setBulkShareFriendIds([]);
      setSelectedAreaCanyonIds([]);
    } catch {
      // ignore
    } finally {
      setBulkSharing(false);
    }
  }

  async function handleBulkDelete() {
    setBulkDeleting(true);
    try {
      for (const c of ownedAreaCanyons) {
        await deleteCanyon(c.id);
      }
      setShowBulkDeleteConfirm(false);
      setSelectedAreaCanyonIds([]);
      refetch();
    } catch {
      // ignore
    } finally {
      setBulkDeleting(false);
    }
  }

  // While checking for an existing session, render nothing to avoid
  // a brief flash of the sign-in form before the session loads.
  if (auth.state === "loading") return null;

  if (!authenticated) {
    return (
      <SignIn
        authState={auth.state}
        error={auth.error}
        onSignIn={auth.signIn}
        onSignUp={auth.signUp}
        onConfirmSignUp={auth.confirmSignUp}
        goToSignUp={auth.goToSignUp}
        goToSignIn={auth.goToSignIn}
      />
    );
  }

  const dimUI = pickingCoords || selectingArea;

  return (
    <div className={classes.app}>
      <ImportDialog
        open={showImport}
        onClose={() => setShowImport(false)}
        onImported={refetch}
      />
      <TopoDialog
        open={showTopo}
        onClose={() => {
          setShowTopo(false);
          setSelectingTopoBbox(false);
        }}
        onSelectBbox={() => {
          setShowTopo(false);
          setSelectingTopoBbox(true);
        }}
        pendingBbox={pendingTopoBbox}
        onLayersToggle={setTopoOverlayLayers}
      />
      <div
        style={{
          pointerEvents: dimUI ? "none" : undefined,
          opacity: dimUI ? 0.5 : undefined,
        }}
      >
        <NavRail
          activePanel={activePanel}
          onPanelChange={handlePanelChange}
          unreadCount={unreadCount}
        />
        <SidebarPanel
          activePanel={activePanel}
          onClose={handlePanelClose}
          showOwnedCanyons={showOwnedCanyons}
          setShowOwnedCanyons={setShowOwnedCanyons}
          showSharedCanyons={showSharedCanyons}
          setShowSharedCanyons={setShowSharedCanyons}
          activeLayerId={activeLayerId}
          onActiveLayerChange={setActiveLayerId}
          onAddCanyon={() => setShowAdd(true)}
          onOpenTopo={() => setShowTopo(true)}
          onStartAreaSelection={startAreaSelection}
          selectingArea={selectingArea}
          onCancelAreaSelection={cancelAreaSelection}
          onRefetch={refetch}
          filters={filters}
          onChangeFilters={setFilters}
          friends={friends}
          friendRequests={friendRequests}
          onRefetchFriends={refetchFriends}
          onRefetchShared={refetchShared}
          notifications={notifications}
          onRefetchNotifications={refetchNotifications}
          setSelectedCanyonID={setSelectedCanyonID}
          setActivePanel={setActivePanel}
          canyon={canyon}
          isOwnedCanyon={isOwnedCanyon}
          onPickCoords={startPickingCoords}
          pickingCoords={pickingCoords}
          onCancelPickCoords={cancelPickingCoords}
          onTopoLayersChange={setMasterTopoLayers}
        />
      </div>
      <Map
        filters={filters}
        canyons={canyons}
        sharedCanyons={sharedCanyons}
        showOwnedCanyons={showOwnedCanyons}
        showSharedCanyons={showSharedCanyons}
        selectCanyon={(id) => {
          setSelectedCanyonID(id);
          setActivePanel("canyon-detail");
        }}
        pickingCoords={pickingCoords}
        onCoordsPicked={handleCoordsPicked}
        selectingArea={selectingArea}
        onAreaSelected={handleAreaSelected}
        selectingBbox={selectingTopoBbox}
        onBboxSelected={(bbox) => {
          setPendingTopoBbox(bbox);
          setSelectingTopoBbox(false);
          setShowTopo(true);
        }}
        topoLayers={[...masterTopoLayers, ...topoOverlayLayers]}
        activeLayerId={activeLayerId}
      />

      {/* Add canyon dialog */}
      <CanyonDialog
        canyon={null}
        open={showAdd && !pickingCoords}
        onClose={() => setShowAdd(false)}
        onSaved={refetch}
        onPickCoords={startPickingCoords}
        onCancelPickCoords={cancelPickingCoords}
      />

      {/* Bulk area selection dialog */}
      <Dialog
        open={selectedAreaCanyonIds.length > 0}
        onClose={bulkSharing || bulkDeleting ? undefined : () => setSelectedAreaCanyonIds([])}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            backgroundColor: "var(--sandstone-dark)",
            color: "var(--content-color)",
          },
        }}
      >
        <DialogTitle>
          Selected Canyons ({selectedAreaCanyons.length})
        </DialogTitle>
        <DialogContent>
          <Box sx={{ mb: 2 }}>
            {selectedAreaCanyons.map((c) => (
              <Typography key={c.id} variant="body2" sx={{ py: 0.2 }}>
                {c.name}
                {!ownedCanyonIds.has(c.id) && (
                  <span style={{ opacity: 0.5, marginLeft: "0.5em" }}>
                    (shared)
                  </span>
                )}
              </Typography>
            ))}
          </Box>

          {ownedAreaCanyons.length > 0 && (
            <>
              <Typography variant="body2" sx={{ fontWeight: "bold", mb: 0.5 }}>
                Share {ownedAreaCanyons.length} owned canyon
                {ownedAreaCanyons.length !== 1 ? "s" : ""} with:
              </Typography>
              <TextField
                placeholder="Search friends..."
                value={bulkShareSearch}
                onChange={(e) => setBulkShareSearch(e.target.value)}
                size="small"
                fullWidth
                sx={{
                  mb: 0.5,
                  "& .MuiInputBase-input": { fontSize: "0.85em" },
                }}
              />
              {bulkShareSearch.length > 0 && (
                <Box sx={{ mb: 0.5 }}>
                  {friends
                    .filter(
                      (f) =>
                        f.username
                          .toLowerCase()
                          .includes(bulkShareSearch.toLowerCase()) &&
                        !bulkShareFriendIds.includes(f.id),
                    )
                    .map((friend) => (
                      <div
                        key={friend.id}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          padding: "0.4em 0.6em",
                          fontSize: "0.85em",
                        }}
                      >
                        <span>{friend.username}</span>
                        <button
                          style={{
                            backgroundColor: "transparent",
                            border: "1px solid var(--sand-light)",
                            color: "var(--sand-light)",
                            borderRadius: "4px",
                            padding: "0.2em 0.6em",
                            fontSize: "0.85em",
                            cursor: "pointer",
                          }}
                          onClick={() => {
                            setBulkShareFriendIds([
                              ...bulkShareFriendIds,
                              friend.id,
                            ]);
                            setBulkShareSearch("");
                          }}
                        >
                          Add
                        </button>
                      </div>
                    ))}
                </Box>
              )}
              {bulkShareFriendIds.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3em" }}>
                  {bulkShareFriendIds.map((id) => {
                    const f = friends.find((fr) => fr.id === id);
                    if (!f) return null;
                    return (
                      <span
                        key={id}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "0.3em",
                          backgroundColor: "var(--sandstone-light)",
                          color: "var(--content-color)",
                          borderRadius: "12px",
                          padding: "0.2em 0.5em",
                          fontSize: "0.8em",
                        }}
                      >
                        {f.username}
                        <button
                          style={{
                            background: "none",
                            border: "none",
                            color: "var(--content-color)",
                            fontSize: "1em",
                            lineHeight: 1,
                            padding: 0,
                            cursor: "pointer",
                            opacity: 0.7,
                          }}
                          onClick={() =>
                            setBulkShareFriendIds(
                              bulkShareFriendIds.filter((fid) => fid !== id),
                            )
                          }
                        >
                          ✕
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}
              <Box sx={{ display: "flex", gap: 1, mt: 1 }}>
                <Button
                  variant="contained"
                  size="small"
                  onClick={handleBulkShare}
                  disabled={bulkSharing || bulkShareFriendIds.length === 0}
                >
                  {bulkSharing ? "Sharing..." : "Share Selected"}
                </Button>
                <Button
                  variant="contained"
                  color="error"
                  size="small"
                  onClick={() => setShowBulkDeleteConfirm(true)}
                  disabled={bulkDeleting}
                >
                  Delete Selected
                </Button>
              </Box>
            </>
          )}
          {ownedAreaCanyons.length === 0 && (
            <Typography variant="body2" sx={{ opacity: 0.6 }}>
              No owned canyons in selection. Bulk actions only apply to your own
              canyons.
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setSelectedAreaCanyonIds([])}
            disabled={bulkSharing || bulkDeleting}
          >
            Close
          </Button>
        </DialogActions>
      </Dialog>

      {/* Bulk delete confirmation */}
      <Dialog
        open={showBulkDeleteConfirm}
        onClose={
          bulkDeleting ? undefined : () => setShowBulkDeleteConfirm(false)
        }
      >
        <DialogTitle>
          Delete {ownedAreaCanyons.length} Canyon
          {ownedAreaCanyons.length !== 1 ? "s" : ""}?
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            This will permanently delete {ownedAreaCanyons.length} canyon
            {ownedAreaCanyons.length !== 1 ? "s" : ""} and all associated trip
            logs. This cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setShowBulkDeleteConfirm(false)}
            disabled={bulkDeleting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleBulkDelete}
            color="error"
            variant="contained"
            disabled={bulkDeleting}
          >
            {bulkDeleting ? "Deleting..." : "Delete All"}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}

export default App;
