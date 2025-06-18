import { useState } from "react";
import classes from "./Sidebar.module.css";
import Arrow from "../../assets/arrow.svg";
import SidebarModule from "./sidebarModule/SidebarModule";
import Filters from "./sidebarModule/filters/Filters";
import type { TFilters } from "../../canyonUtils";

function Sidebar({
  onChangeFilters,
  filters,
}: {
  onChangeFilters: (filters: TFilters) => void;
  filters: TFilters;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div
      className={classes.sidebar}
      style={{
        width: sidebarOpen ? "300px" : "50px",
      }}
    >
      <h2
        style={{
          opacity: sidebarOpen ? 1 : 0,
          transition: "opacity 0.3s",
        }}
      >
        Sidebar
      </h2>
      <span className={classes.separator} />
      <SidebarModule sidebarOpen={sidebarOpen} moduleName="Filters">
        <Filters onChangeFilters={onChangeFilters} filters={filters} />
      </SidebarModule>
      <span className={classes.separator} />
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
