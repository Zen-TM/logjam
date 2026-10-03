import { Fragment, type ReactNode } from "react";
import {
  contractSectionKeys,
  datePresets,
  dateSummary,
  tripsCountLabel,
  TRIP_SORT_OPTIONS,
  TRIPS_FILTER_SHEET,
  type CustomFieldFilter,
  type ScopedCustomFieldDef,
  type SectionKeysOn,
  type TripSortKey,
} from "@logjam/shared";
import {
  AttributeFilter,
  Button,
  Chip,
  ChipRail,
  FilterField,
  SheetSection,
  SideSheet,
  SwitchRow,
  TextField,
} from "../../../ui";
import classes from "./TripLogFilterSheet.module.css";

const { copy } = TRIPS_FILTER_SHEET;

type Props = {
  sort: TripSortKey;
  onChangeSort: (next: TripSortKey) => void;
  /** The attributes worth offering for the activity rail's selection. */
  filterableDefs: ScopedCustomFieldDef[];
  customFilters: Record<string, CustomFieldFilter>;
  /** `null` removes the filter: an inactive one is ABSENT, never present at
   *  its default, so "is it active" stays `key in custom` for every kind. */
  onChangeCustom: (key: string, next: CustomFieldFilter | null) => void;
  includeUnknowns: boolean;
  onChangeIncludeUnknowns: (next: boolean) => void;
  dateFrom: string;
  dateTo: string;
  onChangeDates: (from: string, to: string) => void;
  onReset: () => void;
  onClose: () => void;
  /** Filters this sheet owns that are set. */
  activeCount: number;
  resultCount: number;
};

/**
 * The sheet's sections, one renderer per section the contract gives Logjam
 * Web. A section the contract does not name cannot be drawn and one it names
 * cannot be left out: the type refuses both, and `logsContracts.test.ts`
 * checks the built map.
 */
export const FILTER_SHEET_SECTIONS: Record<
  SectionKeysOn<typeof TRIPS_FILTER_SHEET, "web">,
  (props: Props) => ReactNode
> = {
  sort: ({ sort, onChangeSort }) => (
    <SheetSection title={copy.sort}>
      <div className={classes.chips}>
        {TRIP_SORT_OPTIONS.map((option) => (
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

  // Each drawn from its definition's SHAPE, by the control the Places sheet
  // uses: a trip's "Rope length, 0-120" and a canyon's grade are the same
  // question asked the same way.
  attributes: ({
    filterableDefs,
    customFilters,
    onChangeCustom,
    includeUnknowns,
    onChangeIncludeUnknowns,
  }) =>
    filterableDefs.length > 0 && (
      <SheetSection title={copy.attributes}>
        {filterableDefs.map((def) => (
          <AttributeFilter
            key={def.key}
            def={def}
            value={customFilters[def.key] ?? null}
            onChange={(next) => onChangeCustom(def.key, next)}
          />
        ))}
        {/* With the attributes because it widens only them: most trips answer
            most attributes not at all, so without it one filter empties the
            logbook and nothing on screen says why. */}
        <SwitchRow
          title={copy.includeMissing}
          checked={includeUnknowns}
          onChange={onChangeIncludeUnknowns}
        />
      </SheetSection>
    ),

  dates: ({ dateFrom, dateTo, onChangeDates }) => {
    const presets = datePresets();
    const activePreset =
      presets.find((preset) => preset.from === dateFrom && preset.to === dateTo)
        ?.label ?? "";
    const set = dateFrom !== "" || dateTo !== "";
    return (
      <SheetSection title={copy.dates}>
        <ChipRail
          label={copy.datePresets}
          options={presets.map((preset) => ({
            value: preset.label,
            label: preset.label,
          }))}
          value={activePreset}
          onChange={(label) => {
            const preset = presets.find((entry) => entry.label === label);
            if (preset) onChangeDates(preset.from ?? "", preset.to ?? "");
          }}
        />
        <FilterField
          label={copy.tripDate}
          summary={dateSummary(set ? [dateFrom || null, dateTo || null] : null)}
          active={set}
          onClear={() => onChangeDates("", "")}
        >
          {/* The bounds are set independently, so one could be moved past the
              other, after which nothing matches and the list empties with no
              reason given. Moving one pushes the other along. */}
          <div className={classes.pair}>
            <TextField
              type="date"
              label={copy.dateFrom}
              value={dateFrom}
              onChange={(event) => {
                const key = event.target.value;
                onChangeDates(
                  key,
                  key && dateTo && key > dateTo ? key : dateTo,
                );
              }}
            />
            <TextField
              type="date"
              label={copy.dateTo}
              value={dateTo}
              onChange={(event) => {
                const key = event.target.value;
                onChangeDates(
                  key && dateFrom && key < dateFrom ? key : dateFrom,
                  key,
                );
              }}
            />
          </div>
        </FilterField>
      </SheetSection>
    );
  },
};

/**
 * Sort and filter for the logbook — everything that isn't the activity rail.
 * It opens BESIDE the list, so the list it narrows stays in view and updates
 * as you go.
 *
 * What it holds, in what order and under what words is its contract
 * (`TRIPS_FILTER_SHEET` in `@logjam/shared`), which Logjam GPS's sheet renders
 * from too.
 */
export default function TripLogFilterSheet(props: Props) {
  return (
    <SideSheet
      title={TRIPS_FILTER_SHEET.title}
      onClose={props.onClose}
      footer={
        <>
          <span className={classes.count}>
            {tripsCountLabel(props.resultCount)}
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
      {contractSectionKeys(TRIPS_FILTER_SHEET, "web").map((key) => (
        <Fragment key={key}>{FILTER_SHEET_SECTIONS[key](props)}</Fragment>
      ))}
    </SideSheet>
  );
}
