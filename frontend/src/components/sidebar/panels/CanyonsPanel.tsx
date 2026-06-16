import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { ChevronDown, X } from "lucide-react";
import { Slider, Switch } from "@mui/material";
import classes from "./CanyonsPanel.module.css";
import type {
  TCanyon,
  TFilters,
  TDateRange,
  TCustomFieldFilter,
} from "../../../canyonUtils";
import { refreshFromRopeWiki, passesFilters, activeFilterCount } from "../../../canyonUtils";
import type { RefreshResult } from "../../../canyonUtils";
import type { TripLogCustomFieldDef } from "@logjam/shared";
import RopeWikiReviewDialog from "../../dialogs/RopeWikiReviewDialog";
import { useToast } from "../../feedback/ToastProvider";
import { messageFromError } from "../../../errors/messageFromError";

type SliderKey = "v_grade" | "a_grade" | "commitment" | "quality" | "wetsuits";
type ThresholdKey = "pitches" | "longest_pitch" | "hours";

const SLIDER_RANGES: Record<SliderKey, [number, number]> = {
  v_grade: [1, 7],
  a_grade: [1, 7],
  commitment: [1, 6],
  quality: [1, 5],
  wetsuits: [1, 5],
};

const OWNERSHIP_OPTIONS: { value: TFilters["ownership"]; label: string }[] = [
  { value: "all", label: "All" },
  { value: "owned", label: "Mine" },
  { value: "shared", label: "Shared with me" },
];

const ROPEWIKI_OPTIONS: { value: TFilters["ropewiki"]; label: string }[] = [
  { value: "any", label: "Any" },
  { value: "linked", label: "Linked" },
  { value: "unlinked", label: "Not linked" },
];

function gradeSummary(c: TCanyon): string {
  const parts: string[] = [];
  if (c.vGrade != null) parts.push(`V${c.vGrade}`);
  if (c.aGrade != null) parts.push(`A${c.aGrade}`);
  return parts.join(" ");
}

function CanyonsPanel({
  canyons,
  sharedCanyons,
  onAddCanyon,
  onOpenCanyonCsvImport,
  onStartAreaSelection,
  onCancelAreaSelection,
  selectingArea,
  onRefetch,
  filters,
  onChangeFilters,
  filtersAccordionSignal,
  onFlyToCanyon,
  canyonCustomFieldDefs,
}: {
  canyons: TCanyon[];
  sharedCanyons: TCanyon[];
  onAddCanyon: () => void;
  onOpenCanyonCsvImport: () => void;
  onStartAreaSelection: () => void;
  onCancelAreaSelection: () => void;
  selectingArea: boolean;
  onRefetch: () => void;
  filters: TFilters;
  onChangeFilters: (f: TFilters) => void;
  filtersAccordionSignal: number;
  onFlyToCanyon: (lat: number, lng: number) => void;
  canyonCustomFieldDefs: TripLogCustomFieldDef[];
}) {
  // Search
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  const results =
    query.length >= 3
      ? [...canyons, ...sharedCanyons].filter((c) => {
          const q = query.toLowerCase();
          if (c.name.toLowerCase().includes(q)) return true;
          return c.altNames.some((a) => a.toLowerCase().includes(q));
        })
      : [];

  function handleFlyTo(c: TCanyon) {
    setQuery("");
    setSearchOpen(false);
    onFlyToCanyon(c.latitude, c.longitude);
  }

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && results.length === 1) {
      handleFlyTo(results[0]);
    }
    if (e.key === "Escape") {
      setQuery("");
      setSearchOpen(false);
    }
  }

  // Filters accordion
  const [filtersOpen, setFiltersOpen] = useState(false);
  useEffect(() => {
    if (filtersAccordionSignal > 0) setFiltersOpen(true);
  }, [filtersAccordionSignal]);

  const activeCount = activeFilterCount(filters);

  // Live results below the controls (owned bucket vs shared bucket — ownership
  // is structural, so each list is filtered with its own isOwned flag).
  const filteredCanyons = useMemo(
    () => [
      ...canyons
        .filter((c) => passesFilters(c, filters, true))
        .map((c) => ({ canyon: c, owned: true })),
      ...sharedCanyons
        .filter((c) => passesFilters(c, filters, false))
        .map((c) => ({ canyon: c, owned: false })),
    ],
    [canyons, sharedCanyons, filters],
  );

  // ── Live filtering ─────────────────────────────────────────────
  // Sliders keep a local draft so the thumb tracks the drag smoothly; the
  // global filter only commits on release (onChangeCommitted). Full range
  // commits as null — the canonical "inactive" value (see canyonUtils).
  const draftFromFilters = useCallback(
    (f: TFilters): Record<SliderKey, number[]> => ({
      v_grade: f.v_grade ?? SLIDER_RANGES.v_grade,
      a_grade: f.a_grade ?? SLIDER_RANGES.a_grade,
      commitment: f.commitment ?? SLIDER_RANGES.commitment,
      quality: f.quality ?? SLIDER_RANGES.quality,
      wetsuits: f.wetsuits ?? SLIDER_RANGES.wetsuits,
    }),
    [],
  );
  const [sliderDraft, setSliderDraft] = useState(() => draftFromFilters(filters));
  useEffect(() => {
    setSliderDraft(draftFromFilters(filters));
  }, [filters, draftFromFilters]);

  function commitSlider(key: SliderKey, v: number[]) {
    const [min, max] = SLIDER_RANGES[key];
    const value = v[0] === min && v[1] === max ? null : v;
    onChangeFilters({ ...filters, [key]: value });
  }

  function clearFilter(key: keyof TFilters, emptyValue: TFilters[keyof TFilters]) {
    onChangeFilters({ ...filters, [key]: emptyValue });
  }

  function clearButton(onClick: () => void) {
    return (
      <button
        type="button"
        className={classes.clearFilterBtn}
        onClick={onClick}
        aria-label="Clear this filter"
      >
        <X size={12} />
      </button>
    );
  }

  function sliderCell(
    key: SliderKey,
    displayName: string,
    tooltip?: string,
  ) {
    const range = SLIDER_RANGES[key];
    const value = sliderDraft[key];
    const isFull = value[0] === range[0] && value[1] === range[1];
    const isActive = filters[key] != null;
    return (
      <div
        className={`${classes.sliderCell} ${isFull ? classes.sliderInactive : ""}`}
        key={key}
        title={tooltip}
      >
        <div className={classes.sliderLabel}>
          <span className={classes.sliderLabelText}>{displayName}</span>
          <span className={classes.sliderValueGroup}>
            <span className={classes.sliderValue}>
              {isFull ? "Any" : `${value[0]}–${value[1]}`}
            </span>
            {isActive && clearButton(() => clearFilter(key, null))}
          </span>
        </div>
        <Slider
          id={key}
          color="secondary"
          marks
          step={1}
          min={range[0]}
          max={range[1]}
          value={value}
          valueLabelDisplay="auto"
          onChange={(_e, v) => {
            if (Array.isArray(v) && v.length === 2) {
              setSliderDraft((d) => ({ ...d, [key]: v }));
            }
          }}
          onChangeCommitted={(_e, v) => {
            if (Array.isArray(v) && v.length === 2) commitSlider(key, v);
          }}
        />
      </div>
    );
  }

  function thresholdCell(key: ThresholdKey, displayName: string) {
    const current = filters[key];
    const op = current?.[0] ?? "Any";
    const num = current?.[1] ?? 0;
    const isActive = current != null && op !== "Any";
    return (
      <div className={classes.selectCell} key={key}>
        <div className={classes.selectLabel}>
          <span>{displayName}</span>
          {isActive && clearButton(() => clearFilter(key, null))}
        </div>
        <div className={classes.selectContainer}>
          <select
            id={`${key}Operator`}
            className={classes.select}
            value={op}
            onChange={(e) => {
              const nextOp = e.target.value as
                | "Any"
                | "Less than"
                | "More than"
                | "Exactly";
              onChangeFilters({
                ...filters,
                [key]: nextOp === "Any" ? null : [nextOp, num],
              });
            }}
          >
            <option value="Any">Any</option>
            <option value="Less than">&lt;</option>
            <option value="More than">&gt;</option>
            <option value="Exactly">=</option>
          </select>
          {op !== "Any" && (
            <input
              type="number"
              className={classes.numberInput}
              value={num}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v)) {
                  onChangeFilters({ ...filters, [key]: [op, v] });
                }
              }}
            />
          )}
        </div>
      </div>
    );
  }

  function choiceCell<K extends "ownership" | "ropewiki">(
    key: K,
    displayName: string,
    options: { value: TFilters[K]; label: string }[],
    inactiveValue: TFilters[K],
  ) {
    const value = filters[key];
    const isActive = value !== inactiveValue;
    return (
      <div className={classes.selectCell} key={key}>
        <div className={classes.selectLabel}>
          <span>{displayName}</span>
          {isActive && clearButton(() => clearFilter(key, inactiveValue))}
        </div>
        <select
          className={classes.select}
          value={value}
          onChange={(e) =>
            onChangeFilters({ ...filters, [key]: e.target.value as TFilters[K] })
          }
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  function dateRangeCell(key: "created_at" | "updated_at", displayName: string) {
    const range = filters[key];
    const from = range?.[0] ?? "";
    const to = range?.[1] ?? "";
    const isActive = range != null && (range[0] != null || range[1] != null);
    function update(nextFrom: string, nextTo: string) {
      const start = nextFrom || null;
      const end = nextTo || null;
      const next: TDateRange | null =
        start == null && end == null ? null : [start, end];
      onChangeFilters({ ...filters, [key]: next });
    }
    return (
      <div className={classes.selectCell} key={key}>
        <div className={classes.selectLabel}>
          <span>{displayName}</span>
          {isActive && clearButton(() => clearFilter(key, null))}
        </div>
        <div className={classes.dateRow}>
          <label className={classes.dateField}>
            <span className={classes.dateLabel}>From</span>
            <input
              type="date"
              className={classes.dateInput}
              value={from}
              onChange={(e) => update(e.target.value, to)}
            />
          </label>
          <label className={classes.dateField}>
            <span className={classes.dateLabel}>To</span>
            <input
              type="date"
              className={classes.dateInput}
              value={to}
              onChange={(e) => update(from, e.target.value)}
            />
          </label>
        </div>
      </div>
    );
  }

  // ── Custom-field filters ───────────────────────────────────────
  // Custom filters live in a single keyed map; setting a key activates that
  // field's filter, passing null deletes it (the inactive state).
  function setCustomFilter(key: string, value: TCustomFieldFilter | null) {
    const nextCustom = { ...filters.custom };
    if (value == null) delete nextCustom[key];
    else nextCustom[key] = value;
    onChangeFilters({ ...filters, custom: nextCustom });
  }

  function customTextCell(def: TripLogCustomFieldDef) {
    const current = filters.custom[def.key];
    const value = current?.kind === "text" ? current.value : "";
    const isActive = current?.kind === "text";
    return (
      <div className={classes.selectCell} key={def.key}>
        <div className={classes.selectLabel}>
          <span>{def.label}</span>
          {isActive && clearButton(() => setCustomFilter(def.key, null))}
        </div>
        <input
          type="text"
          className={classes.customTextInput}
          placeholder="Contains…"
          value={value}
          onChange={(e) => {
            const v = e.target.value;
            setCustomFilter(def.key, v === "" ? null : { kind: "text", value: v });
          }}
        />
      </div>
    );
  }

  function customNumberCell(def: TripLogCustomFieldDef) {
    const current = filters.custom[def.key];
    const active = current?.kind === "number" ? current : null;
    const op = active?.op ?? "Any";
    const num = active?.value ?? 0;
    return (
      <div className={classes.selectCell} key={def.key}>
        <div className={classes.selectLabel}>
          <span>{def.label}</span>
          {active && clearButton(() => setCustomFilter(def.key, null))}
        </div>
        <div className={classes.selectContainer}>
          <select
            className={classes.select}
            value={op}
            onChange={(e) => {
              const nextOp = e.target.value as
                | "Any"
                | "Less than"
                | "More than"
                | "Exactly";
              setCustomFilter(
                def.key,
                nextOp === "Any"
                  ? null
                  : { kind: "number", op: nextOp, value: num },
              );
            }}
          >
            <option value="Any">Any</option>
            <option value="Less than">&lt;</option>
            <option value="More than">&gt;</option>
            <option value="Exactly">=</option>
          </select>
          {op !== "Any" && (
            <input
              type="number"
              step={def.type === "float" ? "any" : 1}
              className={classes.numberInput}
              value={num}
              onChange={(e) => {
                const v =
                  def.type === "float"
                    ? parseFloat(e.target.value)
                    : parseInt(e.target.value, 10);
                if (!isNaN(v))
                  setCustomFilter(def.key, { kind: "number", op, value: v });
              }}
            />
          )}
        </div>
      </div>
    );
  }

  function customDateCell(def: TripLogCustomFieldDef) {
    const current = filters.custom[def.key];
    const range = current?.kind === "date" ? current.range : null;
    const from = range?.[0] ?? "";
    const to = range?.[1] ?? "";
    const isActive = current?.kind === "date";
    function update(nextFrom: string, nextTo: string) {
      const start = nextFrom || null;
      const end = nextTo || null;
      setCustomFilter(
        def.key,
        start == null && end == null
          ? null
          : { kind: "date", range: [start, end] },
      );
    }
    return (
      <div className={classes.selectCell} key={def.key}>
        <div className={classes.selectLabel}>
          <span>{def.label}</span>
          {isActive && clearButton(() => setCustomFilter(def.key, null))}
        </div>
        <div className={classes.dateRow}>
          <label className={classes.dateField}>
            <span className={classes.dateLabel}>From</span>
            <input
              type="date"
              className={classes.dateInput}
              value={from}
              onChange={(e) => update(e.target.value, to)}
            />
          </label>
          <label className={classes.dateField}>
            <span className={classes.dateLabel}>To</span>
            <input
              type="date"
              className={classes.dateInput}
              value={to}
              onChange={(e) => update(from, e.target.value)}
            />
          </label>
        </div>
      </div>
    );
  }

  function customBooleanCell(def: TripLogCustomFieldDef) {
    const current = filters.custom[def.key];
    const active = current?.kind === "boolean" ? current : null;
    const value = active ? (active.value ? "yes" : "no") : "any";
    return (
      <div className={classes.selectCell} key={def.key}>
        <div className={classes.selectLabel}>
          <span>{def.label}</span>
          {active && clearButton(() => setCustomFilter(def.key, null))}
        </div>
        <select
          className={classes.select}
          value={value}
          onChange={(e) => {
            const v = e.target.value;
            setCustomFilter(
              def.key,
              v === "any" ? null : { kind: "boolean", value: v === "yes" },
            );
          }}
        >
          <option value="any">Any</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      </div>
    );
  }

  function customFieldCell(def: TripLogCustomFieldDef) {
    switch (def.type) {
      case "string":
        return customTextCell(def);
      case "integer":
      case "float":
        return customNumberCell(def);
      case "date":
        return customDateCell(def);
      case "boolean":
        return customBooleanCell(def);
    }
  }

  function handleReset() {
    onChangeFilters({
      name: null,
      v_grade: null,
      a_grade: null,
      commitment: null,
      quality: null,
      pitches: null,
      longest_pitch: null,
      hours: null,
      wetsuits: null,
      ownership: "all",
      created_at: null,
      updated_at: null,
      ropewiki: "any",
      custom: {},
      include_unknowns: false,
    });
  }

  // RopeWiki refresh
  const toast = useToast();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshResult, setRefreshResult] = useState<RefreshResult | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    setRefreshResult(null);
    try {
      const result = await refreshFromRopeWiki();
      setRefreshResult(result);
      onRefetch();
      if (result.review.length > 0) setReviewOpen(true);
      toast.success(
        `Imported successfully! ${result.added} added, ${result.updated} updated`,
      );
    } catch (err) {
      console.error(err);
      setRefreshResult(null);
      toast.error(messageFromError(err, "Couldn't import from RopeWiki."));
    } finally {
      setRefreshing(false);
    }
  }, [onRefetch, toast]);

  return (
    <div className={classes.root}>
      {/* Search */}
      <div className={classes.searchWrapper} ref={searchRef}>
        <input
          className={classes.searchInput}
          type="text"
          placeholder="Search canyons…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSearchOpen(e.target.value.length >= 3);
          }}
          onKeyDown={handleSearchKeyDown}
          onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
          onFocus={() => { if (query.length >= 3) setSearchOpen(true); }}
        />
        {searchOpen && results.length > 0 && (
          <ul className={classes.searchResults}>
            {results.slice(0, 8).map((c) => (
              <li key={c.id}>
                <button
                  className={classes.searchResultItem}
                  onMouseDown={(e) => { e.preventDefault(); handleFlyTo(c); }}
                >
                  {c.name}
                </button>
              </li>
            ))}
          </ul>
        )}
        {searchOpen && query.length >= 3 && results.length === 0 && (
          <div className={classes.searchEmpty}>No matches</div>
        )}
      </div>

      {/* Primary actions */}
      <div className={classes.actions}>
        <button className={classes.addButton} onClick={onAddCanyon}>
          + Add Canyon
        </button>
        <button
          className={classes.selectButton}
          onClick={selectingArea ? onCancelAreaSelection : onStartAreaSelection}
        >
          {selectingArea ? "Cancel Selection" : "Select Canyons"}
        </button>
      </div>

      {/* Filters accordion */}
      <div className={`${classes.accordion} ${filtersOpen ? classes.accordionExpanded : ""}`}>
        <button
          className={classes.accordionHeader}
          onClick={() => setFiltersOpen((v) => !v)}
          aria-expanded={filtersOpen}
        >
          <span className={classes.accordionTitle}>
            Filters
            {activeCount > 0 && (
              <span className={classes.filterBadge}>{activeCount}</span>
            )}
          </span>
          <ChevronDown
            size={16}
            className={`${classes.chevron} ${filtersOpen ? classes.chevronOpen : ""}`}
          />
        </button>
        {filtersOpen && (
          <div className={classes.accordionBody}>
            <div className={classes.accordionScroll}>
              <div className={classes.section}>
                <div className={classes.sectionHeader}>Grades</div>
                <div className={classes.sliderGrid}>
                  {sliderCell("v_grade", "Vertical")}
                  {sliderCell("a_grade", "Aquatic")}
                  {sliderCell("commitment", "Commitment")}
                </div>
              </div>
              <div className={classes.section}>
                <div className={classes.sectionHeader}>Character</div>
                <div className={classes.sliderGrid}>
                  {sliderCell("quality", "Quality")}
                  {sliderCell(
                    "wetsuits",
                    "Wetsuits",
                    "Wetsuit necessity. 1 = not needed (dry or warm); 5 = essential.",
                  )}
                </div>
              </div>
              <div className={classes.section}>
                <div className={classes.sectionHeader}>Logistics</div>
                <div className={classes.selectGrid}>
                  {thresholdCell("pitches", "Pitches")}
                  {thresholdCell("longest_pitch", "Longest pitch (m)")}
                  {thresholdCell("hours", "Hours (h)")}
                </div>
              </div>
              <div className={classes.section}>
                <div className={classes.sectionHeader}>Source</div>
                <div className={classes.selectGrid}>
                  {choiceCell("ownership", "Ownership", OWNERSHIP_OPTIONS, "all")}
                  {choiceCell("ropewiki", "RopeWiki link", ROPEWIKI_OPTIONS, "any")}
                </div>
              </div>
              <div className={classes.section}>
                <div className={classes.sectionHeader}>Dates</div>
                <div className={classes.selectGrid}>
                  {dateRangeCell("created_at", "Added")}
                  {dateRangeCell("updated_at", "Updated")}
                </div>
              </div>
              {canyonCustomFieldDefs.length > 0 && (
                <div className={classes.section}>
                  <div className={classes.sectionHeader}>Custom fields</div>
                  <div className={classes.selectGrid}>
                    {canyonCustomFieldDefs.map((def) => customFieldCell(def))}
                  </div>
                </div>
              )}
            </div>
            <div className={classes.accordionFooter}>
              <div
                className={classes.toggleRow}
                title="When on, canyons missing data for an active filter field are still shown. When off, they're hidden as soon as that filter is changed from its default."
              >
                <span>Include unknowns</span>
                <Switch
                  size="small"
                  checked={filters.include_unknowns}
                  onChange={(_, v) =>
                    onChangeFilters({ ...filters, include_unknowns: v })
                  }
                  color="secondary"
                />
              </div>
              <button className={classes.resetButton} onClick={handleReset}>
                Reset
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Live filtered results */}
      <div className={classes.results}>
        <div className={classes.resultsHeader}>
          {filteredCanyons.length} canyon{filteredCanyons.length === 1 ? "" : "s"}
        </div>
        {filteredCanyons.length === 0 ? (
          <span className={classes.resultsEmpty}>
            No canyons match the current filters.
          </span>
        ) : (
          <div className={classes.resultsList}>
            {filteredCanyons.map(({ canyon, owned }) => {
              const meta = [gradeSummary(canyon), owned ? "" : "Shared"]
                .filter(Boolean)
                .join(" · ");
              return (
                <button
                  key={canyon.id}
                  className={classes.resultCard}
                  onClick={() => onFlyToCanyon(canyon.latitude, canyon.longitude)}
                >
                  <span className={classes.resultName}>{canyon.name}</span>
                  {meta && <span className={classes.resultMeta}>{meta}</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Low-frequency actions */}
      <div className={classes.footerActions}>
        <div className={classes.divider} />
        <button
          className={classes.ghostButton}
          onClick={onOpenCanyonCsvImport}
        >
          Import Canyons from CSV
        </button>
        <button
          className={classes.ghostButton}
          onClick={handleRefresh}
          disabled={refreshing}
        >
          {refreshing ? "Importing..." : "Import from RopeWiki"}
        </button>
      </div>

      {refreshResult && (
        <RopeWikiReviewDialog
          open={reviewOpen}
          review={refreshResult.review}
          onClose={() => setReviewOpen(false)}
          onApplied={() => {
            setRefreshResult({ ...refreshResult, review: [] });
            onRefetch();
          }}
        />
      )}
    </div>
  );
}

export default CanyonsPanel;
