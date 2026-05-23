import classes from "./FilterEmptyState.module.css";

function FilterEmptyState({
  onClearFilters,
}: {
  onClearFilters: () => void;
}): React.ReactElement {
  return (
    <div className={classes.overlay}>
      <div className={classes.box}>
        <span className={classes.message}>No canyons match the current filters.</span>
        <button className={classes.clearBtn} onClick={onClearFilters}>
          Clear filters
        </button>
      </div>
    </div>
  );
}

export default FilterEmptyState;
