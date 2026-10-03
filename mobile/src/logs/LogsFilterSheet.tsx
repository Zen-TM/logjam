import { Fragment, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import {
  contractSectionKeys,
  datePresets,
  TRIP_SORT_OPTIONS,
  TRIPS_FILTER_SHEET,
  type CustomFieldFilter,
  type ScopedCustomFieldDef,
  type SectionKeysOn,
  type TripSortKey,
} from "@logjam/shared";

import { spacing } from "../theme";
import {
  AttributeFilter,
  BottomSheet,
  Button,
  Chip,
  DatePicker,
  DateRangeFilter,
  SectionHeader,
  SwitchRow,
} from "../ui";

const { copy } = TRIPS_FILTER_SHEET;

type Props = {
  visible: boolean;
  onClose: () => void;
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
  dateFrom: string | null;
  dateTo: string | null;
  onChangeDates: (from: string | null, to: string | null) => void;
  onReset: () => void;
  /** Filters this sheet owns that are set. */
  activeCount: number;
};

type SectionContext = Props & {
  /** Ask the sheet to open its calendar on one bound of the range. */
  pickDate: (bound: 0 | 1) => void;
};

/**
 * The sheet's sections, one renderer per section the contract gives Logjam
 * GPS. A section the contract does not name cannot be drawn and one it names
 * cannot be left out: the type refuses both, and `logsContracts.test.ts`
 * checks the built map.
 */
export const FILTER_SHEET_SECTIONS: Record<
  SectionKeysOn<typeof TRIPS_FILTER_SHEET, "gps">,
  (context: SectionContext) => ReactNode
> = {
  sort: ({ sort, onChangeSort }) => (
    <>
      <SectionHeader title={copy.sort} />
      <View style={styles.chipRow}>
        {TRIP_SORT_OPTIONS.map((option) => (
          <Chip
            key={option.key}
            label={option.label}
            active={sort === option.key}
            onPress={() => onChangeSort(option.key)}
          />
        ))}
      </View>
    </>
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
    filterableDefs.length > 0 ? (
      <>
        <SectionHeader title={copy.attributes} />
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
          icon="help"
          title={copy.includeMissing}
          checked={includeUnknowns}
          onChange={onChangeIncludeUnknowns}
        />
      </>
    ) : null,

  dates: ({ dateFrom, dateTo, onChangeDates, pickDate }) => (
    <>
      <SectionHeader title={copy.dates} />
      <View style={styles.chipRow}>
        {datePresets().map((preset) => (
          <Chip
            key={preset.label}
            label={preset.label}
            active={dateFrom === preset.from && dateTo === preset.to}
            onPress={() => onChangeDates(preset.from, preset.to)}
          />
        ))}
      </View>
      <DateRangeFilter
        label={copy.tripDate}
        value={dateFrom == null && dateTo == null ? null : [dateFrom, dateTo]}
        fromLabel={copy.dateFrom}
        toLabel={copy.dateTo}
        clearLabel={copy.clear}
        onPick={pickDate}
        onClear={() => onChangeDates(null, null)}
      />
    </>
  ),
};

/**
 * Sort and filter for the logbook — everything that isn't the activity rail.
 *
 * What it holds, in what order and under what words is its contract
 * (`TRIPS_FILTER_SHEET` in `@logjam/shared`), which Logjam Web's sheet renders
 * from too. The calendar is a mode of this same sheet, never a second one.
 */
export function LogsFilterSheet(props: Props) {
  const { visible, onClose, dateFrom, dateTo, onChangeDates, activeCount } =
    props;
  const [bound, setBound] = useState<0 | 1 | null>(null);

  const setDateBound = (which: 0 | 1, value: string | null) => {
    let from = which === 0 ? value : dateFrom;
    let to = which === 1 ? value : dateTo;
    // The bounds are set independently, so `from` can be dragged past `to`
    // — after which nothing matches and the list is empty with no
    // explanation. Push the other bound along instead.
    if (from != null && to != null && from > to) {
      if (which === 0) to = from;
      else from = to;
    }
    onChangeDates(from, to);
  };

  return (
    <BottomSheet
      visible={visible}
      // A calendar backs out to the filter list, not out of the sheet.
      onClose={bound == null ? onClose : () => setBound(null)}
      title={
        bound == null
          ? TRIPS_FILTER_SHEET.title
          : `${copy.tripDate} · ${(bound === 0 ? copy.dateFrom : copy.dateTo).toLowerCase()}`
      }
      overlay={
        bound != null ? (
          <DatePicker
            value={bound === 0 ? dateFrom : dateTo}
            onChange={(key) => {
              setDateBound(bound, key);
              setBound(null);
            }}
          />
        ) : null
      }
      footer={
        bound == null ? (
          <View style={styles.actions}>
            {activeCount > 0 ? (
              <View style={styles.action}>
                <Button
                  label={copy.reset}
                  variant="outlineAccent"
                  onPress={props.onReset}
                />
              </View>
            ) : null}
            <View style={styles.action}>
              <Button label={copy.done} icon="done" onPress={onClose} />
            </View>
          </View>
        ) : (
          // Two ways back out of a date, because they mean different things:
          // Cancel keeps whatever bound was already set, Clear removes it.
          <View style={styles.actions}>
            <View style={styles.action}>
              <Button
                label="Cancel"
                variant="ghost"
                onPress={() => setBound(null)}
              />
            </View>
            <View style={styles.action}>
              <Button
                label="Clear this bound"
                variant="outlineAccent"
                onPress={() => {
                  setDateBound(bound, null);
                  setBound(null);
                }}
              />
            </View>
          </View>
        )
      }
    >
      {/* The list stays mounted underneath (see `overlay` on BottomSheet):
          swapping the sheet's CHILDREN for the short picker collapses the
          scroll content, and RN clamps the offset to 0 — so coming back from a
          date threw the user to the top of a long sheet. */}
      <View style={styles.body}>
        {contractSectionKeys(TRIPS_FILTER_SHEET, "gps").map((key) => (
          <Fragment key={key}>
            {FILTER_SHEET_SECTIONS[key]({ ...props, pickDate: setBound })}
          </Fragment>
        ))}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing(1) },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing(0.75) },
  actions: { flexDirection: "row", gap: spacing(1) },
  action: { flex: 1 },
});
