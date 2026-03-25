import { useState, useEffect, useRef, useCallback } from "react";
import Sidebar from "./sidebar/Sidebar";
import Map from "./map/Map";
import SignIn from "./SignIn";
import ImportDialog from "./ImportDialog";
import classes from "./App.module.css";
import type { TFilters } from "../canyonUtils";
import {
  useCanyons,
  useSharedCanyons,
  useFriends,
  useNotifications,
} from "../canyonUtils";
import { useAuth } from "../useAuth";

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
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [showImport, setShowImport] = useState(false);
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
    setSidebarOpen(true);
  }, []);

  const cancelAreaSelection = useCallback(() => {
    setSelectingArea(false);
    setSelectedAreaCanyonIds([]);
  }, []);

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

  return (
    <div className={classes.app}>
      <ImportDialog
        open={showImport}
        onClose={() => setShowImport(false)}
        onImported={refetch}
      />
      <Sidebar
        onChangeFilters={setFilters}
        filters={filters}
        selectedCanyonID={selectedCanyonID}
        setSelectedCanyonID={setSelectedCanyonID}
        canyons={[...canyons, ...sharedCanyons]}
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
        onRefetch={refetch}
        onRefetchShared={refetchShared}
        onPickCoords={startPickingCoords}
        pickingCoords={pickingCoords}
        onCancelPickCoords={cancelPickingCoords}
        showOwnedCanyons={showOwnedCanyons}
        setShowOwnedCanyons={setShowOwnedCanyons}
        showSharedCanyons={showSharedCanyons}
        setShowSharedCanyons={setShowSharedCanyons}
        ownedCanyonIds={new Set(canyons.map((c) => c.id))}
        friends={friends}
        friendRequests={friendRequests}
        onRefetchFriends={refetchFriends}
        notifications={notifications}
        unreadCount={unreadCount}
        onRefetchNotifications={refetchNotifications}
        onStartAreaSelection={startAreaSelection}
        selectingArea={selectingArea}
        onCancelAreaSelection={cancelAreaSelection}
        selectedAreaCanyonIds={selectedAreaCanyonIds}
        onClearAreaSelection={() => setSelectedAreaCanyonIds([])}
      />
      <Map
        filters={filters}
        canyons={canyons}
        sharedCanyons={sharedCanyons}
        showOwnedCanyons={showOwnedCanyons}
        showSharedCanyons={showSharedCanyons}
        selectCanyon={(id) => {
          setSelectedCanyonID(id);
          setSidebarOpen(true);
        }}
        pickingCoords={pickingCoords}
        onCoordsPicked={handleCoordsPicked}
        selectingArea={selectingArea}
        onAreaSelected={handleAreaSelected}
      />
    </div>
  );
}

export default App;
