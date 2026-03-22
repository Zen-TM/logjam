import { useState, useEffect, useRef } from "react";
import Sidebar from "./sidebar/Sidebar";
import Map from "./map/Map";
import SignIn from "./SignIn";
import ImportDialog from "./ImportDialog";
import classes from "./App.module.css";
import type { TFilters } from "../canyonUtils";
import { useCanyons, useSharedCanyons } from "../canyonUtils";
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

  const auth = useAuth();
  const authenticated = auth.state === "authenticated";
  const { canyons, loaded: canyonsLoaded, refetch } = useCanyons(authenticated);
  const { canyons: sharedCanyons } = useSharedCanyons(authenticated);

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
      />
      <Map
        filters={filters}
        canyons={canyons}
        sharedCanyons={sharedCanyons}
        selectCanyon={(id) => {
          setSelectedCanyonID(id);
          setSidebarOpen(true);
        }}
      />
    </div>
  );
}

export default App;
