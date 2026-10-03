import { Fragment, useCallback, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import {
  areaSizeLabel,
  contractSectionKeys,
  defsForType,
  PLACE_ROPEWIKI_OPTIONS as ROPEWIKI,
  PLACE_SORT_OPTIONS as SORTS,
  PLACES_FILTER_SHEET,
  placesOnMapSummary,
  type CustomFieldFilter,
  type FieldDateRange,
  type PlaceFilters,
  type PlaceSortKey,
  type ScopedCustomFieldDef,
  type SectionKeysOn,
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
import { useFieldDefs } from "../customFields/useFieldDefs";

const { copy } = PLACES_FILTER_SHEET;

/**
 * Sort and filter for the Places screen — everything that isn't the rail.
 *
 * What it holds, in what order and under what words is its contract
 * (`PLACES_FILTER_SHEET` in `@logjam/shared`), which Logjam Web's sheet renders
 * from too. Completion and ownership are NOT here: they are the rail's
 * buckets, and a second copy in this sheet would let the two disagree.
 *
 * EVERY ATTRIBUTE IS DRAWN BY ITS DEFINITION'S SHAPE (the kit's
 * `AttributeFilter`), and which ones appear is decided by the type tab. A
 * canyon's grades are ordinary attributes: they get the control a user's own
 * "Difficulty, 1-5" gets, and no section of their own.
 *
 * PRIVACY: filter state is local to the screen and dies with it. The "show only
 * these on the map" option passes place IDS to the map through an in-memory
 * store — never a bbox (see placeMapFilter.ts, whose store carries no region of
 * interest and derives none). The `area` filter is the one coordinate here: a
 * box the user drew on their own map, held in this screen's state, never
 * persisted and never sent. It is summarised by its SIZE and never by its
 * position — the picker is where you see where it is, on a map, deliberately
 * rather than as a coordinate anyone could read over a shoulder.
 */
type DateField = "created_at" | "updated_at";

/** What a date being picked belongs to: a built-in date or a date attribute. */
type DateTarget =
  | { field: DateField }
  | { attribute: Pick<ScopedCustomFieldDef, "key" | "label"> };

type Mode =
  | { kind: "main" }
  | { kind: "date"; target: DateTarget; bound: 0 | 1 };

type Props = {
  visible: boolean;
  onClose: () => void;
  filters: PlaceFilters;
  onChangeFilters: (next: PlaceFilters) => void;
  sort: PlaceSortKey;
  onChangeSort: (next: PlaceSortKey) => void;
  onReset: () => void;
  /**
   * Open the area picker. A separate SCREEN, so the sheet has to close and
   * re-open around it — a `BottomSheet` is an RN `Modal` in its own window, and
   * a map drawn behind it would be invisible. The screen owns that dance.
   */
  onPickArea: () => void;
  activeCount: number;
  showFilteredOnMap: boolean;
  onChangeShowFilteredOnMap: (next: boolean) => void;
  filteredCount: number;
  totalCount: number;
};

type SectionContext = Props & {
  /** The definitions in force for the type tab's selection. */
  typeDefs: ScopedCustomFieldDef[];
  patch: (next: Partial<PlaceFilters>) => void;
  pickDate: (target: DateTarget, bound: 0 | 1) => void;
};

/** An inactive custom filter is ABSENT, never present at its default, so "is it
 *  active" stays `key in custom` for every kind. */
function withCustom(
  filters: PlaceFilters,
  key: string,
  next: CustomFieldFilter | null,
): Partial<PlaceFilters> {
  const custom = { ...(filters.custom ?? {}) };
  if (next == null) delete custom[key];
  else custom[key] = next;
  return { custom };
}

function dateRangeOf(
  filters: PlaceFilters,
  target: DateTarget,
): FieldDateRange | null {
  if ("field" in target) return filters[target.field];
  const filter = filters.custom?.[target.attribute.key];
  return filter?.kind === "date" ? filter.range : null;
}

function withDateRange(
  filters: PlaceFilters,
  target: DateTarget,
  range: FieldDateRange | null,
): Partial<PlaceFilters> {
  return "field" in target
    ? { [target.field]: range }
    : withCustom(
        filters,
        target.attribute.key,
        range && { kind: "date", range },
      );
}

/**
 * The sheet's sections, one renderer per section the contract gives Logjam
 * GPS. A section the contract does not name cannot be drawn and one it names
 * cannot be left out: the type refuses both, and
 * `placesContracts.test.ts` checks the built map.
 */
export const FILTER_SHEET_SECTIONS: Record<
  SectionKeysOn<typeof PLACES_FILTER_SHEET, "gps">,
  (context: SectionContext) => ReactNode
> = {
  sort: ({ sort, onChangeSort }) => (
    <>
      <SectionHeader title={copy.sort} />
      <View style={styles.chipRow}>
        {SORTS.map((option) => (
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

  attributes: ({ typeDefs, filters, patch, pickDate }) =>
    typeDefs.length > 0 ? (
      <>
        <SectionHeader title={copy.attributes} />
        {typeDefs.map((def) => (
          <AttributeFilter
            key={def.key}
            def={def}
            value={filters.custom?.[def.key] ?? null}
            onChange={(next) => patch(withCustom(filters, def.key, next))}
            onPickDate={(bound) => pickDate({ attribute: def }, bound)}
          />
        ))}
        {/* With the attributes because it widens only them. */}
        <SwitchRow
          icon="help"
          title={copy.includeMissing}
          checked={filters.include_unknowns}
          onChange={(next) => patch({ include_unknowns: next })}
        />
      </>
    ) : null,

  // The chip carries the box's SIZE, not its position; where it is, is
  // answered by tapping it: the picker opens on the box, over the map.
  location: ({ filters, patch, onPickArea }) => (
    <>
      <SectionHeader title={copy.location} />
      <View style={styles.chipRow}>
        <Chip
          label={filters.area ? areaSizeLabel(filters.area) : copy.drawArea}
          active={filters.area != null}
          onPress={onPickArea}
        />
        {filters.area ? (
          <Chip label={copy.clear} onPress={() => patch({ area: null })} />
        ) : null}
      </View>
    </>
  ),

  source: ({ filters, patch }) => (
    <>
      <SectionHeader title={copy.source} />
      <View style={styles.chipRow}>
        {ROPEWIKI.map((option) => (
          <Chip
            key={option.value}
            label={option.label}
            active={filters.ropewiki === option.value}
            onPress={() => patch({ ropewiki: option.value })}
          />
        ))}
      </View>
      <SwitchRow
        icon="shareFriend"
        title={copy.sharedByMe}
        checked={filters.shared_by_me}
        onChange={(next) => patch({ shared_by_me: next })}
      />
    </>
  ),

  dates: ({ filters, patch, pickDate }) => (
    <>
      <SectionHeader title={copy.dates} />
      {(["created_at", "updated_at"] as const).map((field) => (
        <DateRangeFilter
          key={field}
          label={field === "created_at" ? copy.added : copy.updated}
          value={filters[field]}
          fromLabel={copy.dateFrom}
          toLabel={copy.dateTo}
          clearLabel={copy.clear}
          onPick={(bound) => pickDate({ field }, bound)}
          onClear={() => patch({ [field]: null })}
        />
      ))}
    </>
  ),

  onMap: ({
    showFilteredOnMap,
    onChangeShowFilteredOnMap,
    filteredCount,
    totalCount,
  }) => (
    <>
      <SectionHeader title={copy.onMap} />
      <SwitchRow
        icon="map"
        title={copy.showOnMap}
        description={placesOnMapSummary(
          showFilteredOnMap,
          filteredCount,
          totalCount,
        )}
        checked={showFilteredOnMap}
        onChange={onChangeShowFilteredOnMap}
      />
    </>
  ),
};

export function PlaceFilterSheet(props: Props) {
  const { visible, onClose, filters, onChangeFilters, onReset, activeCount } =
    props;
  const [mode, setMode] = useState<Mode>({ kind: "main" });
  // WHICH ATTRIBUTES EXIST is a property of the type tab, not of this sheet. On
  // "Any type" every place attribute is offered; on a type, only that type's —
  // which is what stops a campsite filter asking for a vertical grade.
  const { defs } = useFieldDefs("place");
  const typeDefs =
    filters.placeTypeId == null ? defs : defsForType(defs, filters.placeTypeId);

  const patch = useCallback(
    (next: Partial<PlaceFilters>) => onChangeFilters({ ...filters, ...next }),
    [filters, onChangeFilters],
  );

  const setDateBound = useCallback(
    (target: DateTarget, bound: 0 | 1, value: string | null) => {
      const current = dateRangeOf(filters, target) ?? [null, null];
      const next: FieldDateRange =
        bound === 0 ? [value, current[1]] : [current[0], value];
      // The bounds are set independently, so `from` can be dragged past `to`
      // — after which the predicate matches nothing and the list is empty
      // with no explanation. Push the other bound along instead.
      if (next[0] != null && next[1] != null && next[0] > next[1]) {
        if (bound === 0) next[1] = next[0];
        else next[0] = next[1];
      }
      patch(
        withDateRange(
          filters,
          target,
          next[0] == null && next[1] == null ? null : next,
        ),
      );
    },
    [filters, patch],
  );

  const context: SectionContext = {
    ...props,
    typeDefs,
    patch,
    pickDate: (target, bound) => setMode({ kind: "date", target, bound }),
  };

  const dateLabel =
    mode.kind !== "date"
      ? ""
      : "attribute" in mode.target
        ? mode.target.attribute.label
        : mode.target.field === "created_at"
          ? copy.added
          : copy.updated;
  const title =
    mode.kind === "date"
      ? `${dateLabel} · ${(mode.bound === 0 ? copy.dateFrom : copy.dateTo).toLowerCase()}`
      : PLACES_FILTER_SHEET.title;

  return (
    <BottomSheet
      visible={visible}
      // A date picker backs out to the filter list, not out of the sheet.
      onClose={mode.kind === "main" ? onClose : () => setMode({ kind: "main" })}
      title={title}
      overlay={
        mode.kind === "date" ? (
          <DatePicker
            value={dateRangeOf(filters, mode.target)?.[mode.bound] ?? null}
            onChange={(key) => {
              setDateBound(mode.target, mode.bound, key);
              setMode({ kind: "main" });
            }}
          />
        ) : null
      }
      footer={
        mode.kind === "main" ? (
          <View style={styles.actions}>
            {activeCount > 0 ? (
              <View style={styles.action}>
                <Button
                  label={copy.reset}
                  variant="outlineAccent"
                  onPress={onReset}
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
                onPress={() => setMode({ kind: "main" })}
              />
            </View>
            <View style={styles.action}>
              <Button
                label="Clear this bound"
                variant="outlineAccent"
                onPress={() => {
                  setDateBound(mode.target, mode.bound, null);
                  setMode({ kind: "main" });
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
        {contractSectionKeys(PLACES_FILTER_SHEET, "gps").map((key) => (
          <Fragment key={key}>{FILTER_SHEET_SECTIONS[key](context)}</Fragment>
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
