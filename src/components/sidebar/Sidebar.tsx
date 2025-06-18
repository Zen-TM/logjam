import classes from "./Sidebar.module.css";
import Arrow from "../../assets/arrow.svg";
import SidebarModule from "./sidebarModule/SidebarModule";
import Filters from "./sidebarModule/filters/Filters";
import type { TCanyon, TFilters } from "../../canyonUtils";
import { formatCanyonGrade } from "../../canyonUtils";

function Sidebar({
  onChangeFilters,
  filters,
  selectedCanyonID,
  setSelectedCanyonID,
  canyons,
  sidebarOpen,
  setSidebarOpen,
}: {
  onChangeFilters: (filters: TFilters) => void;
  filters: TFilters;
  selectedCanyonID: number | null;
  setSelectedCanyonID: (id: number | null) => void;
  canyons: TCanyon[];
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
}) {
  function sidebarModules() {
    return (
      <>
        <SidebarModule sidebarOpen={sidebarOpen} moduleName="Filters">
          <Filters onChangeFilters={onChangeFilters} filters={filters} />
        </SidebarModule>
        <span className={classes.separator} />
      </>
    );
  }

  function canyonInfo() {
    const canyon = canyons.find((c) => c.id === selectedCanyonID);
    if (!canyon) return null;
    const canyonGrade = formatCanyonGrade(canyon);

    return (
      <div className={classes.canyonInfo}>
        {canyonGrade && (
          <p>
            <b>Grade:</b> {canyonGrade}
          </p>
        )}
        <p>
          <b>Location:</b> {canyon.latitude}, {canyon.longitude}
        </p>
        {canyon.quality && (
          <p>
            <b>Quality:</b> {canyon.quality}/5
          </p>
        )}
        {canyon.pitches && (
          <p>
            <b>Pitches:</b> {canyon.pitches}
          </p>
        )}
        {canyon.longest_pitch && (
          <p>
            <b>Longest Pitch:</b> {canyon.longest_pitch}m
          </p>
        )}
        {canyon.hours && (
          <p>
            <b>Hours:</b> {canyon.hours}
          </p>
        )}
        {canyon.rock_type && (
          <p>
            <b>Rock Type:</b> {canyon.rock_type}
          </p>
        )}
        {canyon.wetsuits && (
          <p>
            <b>Wetsuits Required:</b> {canyon.wetsuits}/5
          </p>
        )}
        {canyon.description && (
          <p>
            <b>Description:</b>
            <br />
            {canyon.description}
          </p>
        )}
      </div>
    );
  }
  return (
    <div
      className={classes.sidebar}
      style={{
        width: sidebarOpen ? "300px" : "50px",
      }}
    >
      <div
        className={classes.sidebarContent}
        style={{
          opacity: sidebarOpen ? 1 : 0,
        }}
      >
        {selectedCanyonID ? (
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
            <h2 style={{ marginLeft: "0.5em" }}>
              {canyons.find((c) => c.id === selectedCanyonID)?.name} Canyon
            </h2>
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
    </div>
  );
}

export default Sidebar;
