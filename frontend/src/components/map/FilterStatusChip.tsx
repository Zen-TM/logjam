import { X } from "lucide-react";
import classes from "./FilterStatusChip.module.css";

function FilterStatusChip({
  filteredCount,
  totalCount,
  onOpenFilters,
  onClearFilters,
}: {
  filteredCount: number;
  totalCount: number;
  onOpenFilters: () => void;
  onClearFilters: () => void;
}): React.ReactElement {
  return (
    <div className={classes.chip}>
      <button className={classes.label} onClick={onOpenFilters} aria-label="Open filters">
        Showing {filteredCount} of {totalCount}
      </button>
      <button className={classes.clear} onClick={onClearFilters} aria-label="Clear filters">
        <X size={13} />
      </button>
    </div>
  );
}

export default FilterStatusChip;
