import { Fragment, type ReactNode } from "react";
import {
  areaSizeLabel,
  contractSectionKeys,
  dateSummary,
  defsForType,
  PLACE_ROPEWIKI_OPTIONS,
  PLACE_SORT_OPTIONS,
  PLACES_FILTER_SHEET,
  placesCountLabel,
  type PlaceFilters,
  type PlaceSortKey,
  type ScopedCustomFieldDef,
  type SectionKeysOn,
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
function withCustom(
  filters: PlaceFilters,
  key: string,
  value: CustomFilter | null,
): PlaceFilters {
  const custom = { ...filters.custom };
  if (value == null) delete custom[key];
  else custom[key] = value;
  return { ...filters, custom };
}

const { copy } = PLACES_FILTER_SHEET;

type Props = {
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
};

type DateField = "created_at" | "updated_at";

type SectionContext = Props & {
  /** The definitions in force for the type rail's selection. */
  fieldDefs: ScopedCustomFieldDef[];
  patch: (next: Partial<PlaceFilters>) => void;
  setDateBound: (field: DateField, bound: 0 | 1, value: string) => void;
};

/**
 * The sheet's sections, one renderer per section the contract gives Logjam
 * Web. A section the contract does not name cannot be drawn and one it names
 * cannot be left out: the type refuses both, and
 * `placesContracts.test.ts` checks the built map.
 */
export const FILTER_SHEET_SECTIONS: Record<
  SectionKeysOn<typeof PLACES_FILTER_SHEET, "web">,
  (context: SectionContext) => ReactNode
> = {
  sort: ({ sort, onChangeSort }) => (
    <SheetSection title={copy.sort}>
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
  ),

  attributes: ({ fieldDefs, filters, onChangeFilters, patch }) =>
    fieldDefs.length > 0 && (
      <SheetSection title={copy.attributes}>
        {fieldDefs.map((def) => (
          <AttributeFilter
            key={def.key}
            def={def}
            value={filters.custom[def.key] ?? null}
            onChange={(next) =>
              onChangeFilters(withCustom(filters, def.key, next))
            }
          />
        ))}
        {/* With the attributes because it widens only them. */}
        <SwitchRow
          title={copy.includeMissing}
          checked={filters.include_unknowns}
          onChange={(next) => patch({ include_unknowns: next })}
        />
      </SheetSection>
    ),

  location: ({ filters, patch, onDrawArea, onAreaToView }) => (
    <SheetSection title={copy.location}>
      <div className={classes.chips}>
        {filters.area ? (
          <>
            <Chip
              label={areaSizeLabel(filters.area)}
              icon="pickArea"
              active
              aria-label={`Area set, ${areaSizeLabel(filters.area)}. ${copy.drawArea} again`}
              onClick={onDrawArea}
            />
            <Chip label={copy.clear} onClick={() => patch({ area: null })} />
          </>
        ) : (
          <>
            <Chip label={copy.drawArea} icon="pickArea" onClick={onDrawArea} />
            <Chip label={copy.areaToView} icon="scan" onClick={onAreaToView} />
          </>
        )}
      </div>
    </SheetSection>
  ),

  source: ({ filters, patch }) => (
    <SheetSection title={copy.source}>
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
        title={copy.sharedByMe}
        checked={filters.shared_by_me}
        onChange={(next) => patch({ shared_by_me: next })}
      />
    </SheetSection>
  ),

  dates: ({ filters, patch, setDateBound }) => (
    <SheetSection title={copy.dates}>
      {(["created_at", "updated_at"] as const).map((field) => (
        <FilterField
          key={field}
          label={field === "created_at" ? copy.added : copy.updated}
          summary={dateSummary(filters[field])}
          active={filters[field] != null}
          onClear={() => patch({ [field]: null })}
        >
          <div className={classes.pair}>
            <TextField
              type="date"
              label={copy.dateFrom}
              value={filters[field]?.[0] ?? ""}
              onChange={(event) => setDateBound(field, 0, event.target.value)}
            />
            <TextField
              type="date"
              label={copy.dateTo}
              value={filters[field]?.[1] ?? ""}
              onChange={(event) => setDateBound(field, 1, event.target.value)}
            />
          </div>
        </FilterField>
      ))}
    </SheetSection>
  ),
};

/**
 * Sort and filter for Places — everything that isn't a rail. It opens BESIDE
 * the list, so the list it narrows stays in view and updates as you go.
 *
 * What it holds, in what order and under what words is its contract
 * (`PLACES_FILTER_SHEET` in `@logjam/shared`), which Logjam GPS's sheet renders
 * from too. Which attributes appear follows the type rail, and every one of
 * them is drawn from its definition's SHAPE, never its key.
 */
export default function PlaceFilterSheet(props: Props) {
  const { filters, onChangeFilters, placeCustomFieldDefs } = props;
  const fieldDefs =
    filters.placeTypeId == null
      ? placeCustomFieldDefs
      : defsForType(placeCustomFieldDefs, filters.placeTypeId);

  const patch = (next: Partial<PlaceFilters>) =>
    onChangeFilters({ ...filters, ...next });

  const setDateBound = (field: DateField, bound: 0 | 1, value: string) => {
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

  const context: SectionContext = { ...props, fieldDefs, patch, setDateBound };

  return (
    <SideSheet
      title={PLACES_FILTER_SHEET.title}
      onClose={props.onClose}
      footer={
        <>
          <span className={classes.count}>
            {placesCountLabel(props.resultCount)}
          </span>
          {props.activeCount > 0 && (
            <Button compact variant="outline" onClick={props.onReset}>
              {copy.reset}
            </Button>
          )}
          <Button compact variant="filled" icon="done" onClick={props.onClose}>
            {copy.done}
          </Button>
        </>
      }
    >
      {contractSectionKeys(PLACES_FILTER_SHEET, "web").map((key) => (
        <Fragment key={key}>{FILTER_SHEET_SECTIONS[key](context)}</Fragment>
      ))}
    </SideSheet>
  );
}
