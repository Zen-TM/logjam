import { Check, Scan, SquareDashed } from "lucide-react";
import {
  dateSummary,
  defsForType,
  PLACE_ROPEWIKI_OPTIONS,
  PLACE_SORT_OPTIONS,
  regionEdgesKm,
  type PlaceFilters,
  type PlaceSortKey,
  type ScopedCustomFieldDef,
} from "@logjam/shared";
import {
  AttributeFilter,
  Button,
  Chip,
  FilterField,
  SheetSection,
  SideSheet,
  SwitchRow,
  TextField,
} from "../../../ui";
import classes from "./PlaceFilterSheet.module.css";

type CustomFilter = PlaceFilters["custom"][string];

/** An inactive custom filter is ABSENT, never present at its default, so "is it
 *  active" stays `key in custom` for every kind. */
function withCustom(filters: PlaceFilters, key: string, value: CustomFilter | null): PlaceFilters {
  const custom = { ...filters.custom };
  if (value == null) delete custom[key];
  else custom[key] = value;
  return { ...filters, custom };
}

/**
 * Sort and filter for Places — everything that isn't a rail. It opens BESIDE
 * the list, so the list it narrows stays in view and updates as you go.
 *
 * Visited, not visited and shared are NOT here: they are the status rail, and a
 * second copy could disagree with it. Which attributes appear follows the type
 * rail, and every one of them is drawn from its definition's SHAPE, never its
 * key: a canyon's grades are ordinary attributes, so they get no section of
 * their own and a user's own "Difficulty, 1-5" is drawn exactly like them.
 */
export default function PlaceFilterSheet({
  filters,
  onChangeFilters,
  sort,
  onChangeSort,
  placeCustomFieldDefs,
  onDrawArea,
  onAreaToView,
  onReset,
  onClose,
  activeCount,
  resultCount,
}: {
  filters: PlaceFilters;
  onChangeFilters: (next: PlaceFilters) => void;
  sort: PlaceSortKey;
  onChangeSort: (next: PlaceSortKey) => void;
  placeCustomFieldDefs: ScopedCustomFieldDef[];
  /** Close the panel and draw the area box on the map. */
  onDrawArea: () => void;
  /** Set the area to whatever the map shows now. */
  onAreaToView: () => void;
  onReset: () => void;
  onClose: () => void;
  /** Filters this sheet owns that are set. */
  activeCount: number;
  resultCount: number;
}) {
  const fieldDefs =
    filters.placeTypeId == null ? placeCustomFieldDefs : defsForType(placeCustomFieldDefs, filters.placeTypeId);

  const patch = (next: Partial<PlaceFilters>) => onChangeFilters({ ...filters, ...next });

  const setDateBound = (field: "created_at" | "updated_at", bound: 0 | 1, value: string) => {
    const current = filters[field] ?? [null, null];
    const next: [string | null, string | null] =
      bound === 0 ? [value || null, current[1]] : [current[0], value || null];
    // A `from` after its `to` matches nothing and empties the list with no
    // explanation — push the other bound along instead.
    if (next[0] != null && next[1] != null && next[0] > next[1]) {
      if (bound === 0) next[1] = next[0];
      else next[0] = next[1];
    }
    patch({ [field]: next[0] == null && next[1] == null ? null : next });
  };

  const area = filters.area ? regionEdgesKm(filters.area) : null;

  return (
    <SideSheet
      title="Sort and filter"
      onClose={onClose}
      footer={
        <>
          <span className={classes.count}>
            {resultCount} {resultCount === 1 ? "place" : "places"}
          </span>
          {activeCount > 0 && (
            <Button compact variant="outline" onClick={onReset}>
              Reset
            </Button>
          )}
          <Button compact variant="filled" icon={Check} onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <SheetSection title="Sort">
        <div className={classes.chips}>
          {PLACE_SORT_OPTIONS.map((option) => (
            <Chip
              key={option.key}
              label={option.label}
              active={sort === option.key}
              aria-pressed={sort === option.key}
              onClick={() => onChangeSort(option.key)}
            />
          ))}
        </div>
      </SheetSection>

      {fieldDefs.length > 0 && (
        // "Attributes", not "Fields": a field is the box, not the thing it
        // records (mobile ATTRIBUTE_NOUN).
        <SheetSection title="Attributes">
          {fieldDefs.map((def) => (
            <AttributeFilter
              key={def.key}
              def={def}
              value={filters.custom[def.key] ?? null}
              onChange={(next) => onChangeFilters(withCustom(filters, def.key, next))}
            />
          ))}
        </SheetSection>
      )}

      <SheetSection title="Location">
        <div className={classes.chips}>
          {area ? (
            <>
              <Chip
                label={`${Math.round(area[0])} × ${Math.round(area[1])} km`}
                icon={SquareDashed}
                active
                aria-label={`Area set, ${Math.round(area[0])} by ${Math.round(area[1])} kilometres. Draw it again`}
                onClick={onDrawArea}
              />
              <Chip label="Clear" onClick={() => patch({ area: null })} />
            </>
          ) : (
            <>
              <Chip label="Draw on map" icon={SquareDashed} onClick={onDrawArea} />
              <Chip label="This view" icon={Scan} onClick={onAreaToView} />
            </>
          )}
        </div>
      </SheetSection>

      <SheetSection title="Source">
        <div className={classes.chips}>
          {PLACE_ROPEWIKI_OPTIONS.map((option) => (
            <Chip
              key={option.value}
              label={option.label}
              active={filters.ropewiki === option.value}
              aria-pressed={filters.ropewiki === option.value}
              onClick={() => patch({ ropewiki: option.value })}
            />
          ))}
        </div>
        <SwitchRow
          title="Shared by me"
          description="Only places you have shared with at least one friend."
          checked={filters.shared_by_me}
          onChange={(next) => patch({ shared_by_me: next })}
        />
      </SheetSection>

      <SheetSection title="Dates">
        {(["created_at", "updated_at"] as const).map((field) => (
          <FilterField
            key={field}
            label={field === "created_at" ? "Added" : "Updated"}
            summary={dateSummary(filters[field])}
            active={filters[field] != null}
            onClear={() => patch({ [field]: null })}
          >
            <div className={classes.pair}>
              <TextField
                type="date"
                label="From"
                value={filters[field]?.[0] ?? ""}
                onChange={(event) => setDateBound(field, 0, event.target.value)}
              />
              <TextField
                type="date"
                label="To"
                value={filters[field]?.[1] ?? ""}
                onChange={(event) => setDateBound(field, 1, event.target.value)}
              />
            </div>
          </FilterField>
        ))}
      </SheetSection>

      <SheetSection title="Missing info">
        <SwitchRow
          title="Include places missing this info"
          checked={filters.include_unknowns}
          onChange={(next) => patch({ include_unknowns: next })}
        />
      </SheetSection>
    </SideSheet>
  );
}
