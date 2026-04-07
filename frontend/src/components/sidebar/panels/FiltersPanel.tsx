import Filters from "../sidebarModule/filters/Filters";
import type { TFilters } from "../../../canyonUtils";

function FiltersPanel({
  filters,
  onChangeFilters,
}: {
  filters: TFilters;
  onChangeFilters: (filters: TFilters) => void;
}) {
  return <Filters onChangeFilters={onChangeFilters} filters={filters} />;
}

export default FiltersPanel;
