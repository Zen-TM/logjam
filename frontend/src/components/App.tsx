import { useState } from "react";
import Sidebar from "./sidebar/Sidebar";
import Map from "./map/Map";
import SignIn from "./SignIn";
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

  const auth = useAuth();
  const { canyons } = useCanyons(auth.authenticated);
  const { canyons: sharedCanyons } = useSharedCanyons(auth.authenticated);

  // While checking for an existing session, render nothing to avoid
  // a brief flash of the sign-in form before the session loads.
  if (auth.loading) return null;

  if (!auth.authenticated) {
    return <SignIn onSignIn={auth.signIn} error={auth.error} />;
  }

  return (
    <div className={classes.app}>
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
