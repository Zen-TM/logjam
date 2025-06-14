import { useState } from "react";
import Sidebar from "./sidebar/Sidebar";
import Map from "./map/Map";
import classes from "./App.module.css";
import type { TCanyon, TFilters } from "../canyonUtils";

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
  const [canyons, setCanyons] = useState<TCanyon[]>([]);

  return (
    <div className={classes.app}>
      <Sidebar onChangeFilters={setFilters} filters={filters} />
      <Map filters={filters} />
    </div>
  );
}

export default App;
