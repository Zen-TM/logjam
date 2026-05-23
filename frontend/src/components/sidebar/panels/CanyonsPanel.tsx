import { useState, useRef, useCallback } from "react";
import { ChevronDown } from "lucide-react";
import { Slider, Select, MenuItem } from "@mui/material";
import classes from "./CanyonsPanel.module.css";
import type { TCanyon, TFilters } from "../../../canyonUtils";
import { refreshFromRopeWiki } from "../../../canyonUtils";
import type { RefreshResult } from "../../../canyonUtils";
import RopeWikiReviewDialog from "../../dialogs/RopeWikiReviewDialog";

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
  onFlyToCanyon,
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
  onFlyToCanyon: (lat: number, lng: number) => void;
}) {
  // Search
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  const allCanyons = [...canyons, ...sharedCanyons];
  const results =
    query.length >= 3
      ? allCanyons.filter((c) => {
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
  const [filterInputs, setFilterInputs] = useState({
    v_grade: filters.v_grade ?? [1, 7],
    a_grade: filters.a_grade ?? [1, 7],
    commitment: filters.commitment ?? [1, 6],
    quality: filters.quality ?? [1, 5],
    pitches: filters.pitches ?? ["Any", 0],
    longest_pitch: filters.longest_pitch ?? ["Any", 0],
    hours: filters.hours ?? ["Any", 0],
    wetsuits: filters.wetsuits ?? [1, 5],
  });

  function sliderCell(
    name: keyof typeof filterInputs,
    displayName: string,
    range: [number, number],
    step = 1,
  ) {
    const value = Array.isArray(filterInputs[name]) && typeof filterInputs[name][0] === "number"
      ? (filterInputs[name] as number[])
      : range;
    return (
      <div className={classes.sliderCell} key={name}>
        <div className={classes.sliderLabel}>
          <span className={classes.sliderLabelText}>{displayName}</span>
          <span className={classes.sliderValue}>{value[0]}–{value[1]}</span>
        </div>
        <Slider
          id={name}
          color="secondary"
          marks={step === 1}
          step={step}
          min={range[0]}
          max={range[1]}
          value={value}
          valueLabelDisplay="auto"
          onChange={(_e, v) => {
            if (Array.isArray(v) && v.length === 2) {
              setFilterInputs({ ...filterInputs, [name]: v });
            }
          }}
        />
      </div>
    );
  }

  function selectCell(name: keyof typeof filterInputs, displayName: string) {
    return (
      <div className={classes.selectCell} key={name}>
        <div className={classes.selectLabel}>{displayName}</div>
        <div className={classes.selectContainer}>
          <Select
            id={`${name}Operator`}
            className={classes.select}
            color="secondary"
            size="small"
            value={(filterInputs[name] as [string, number])[0] ?? "Any"}
            onChange={(e) => {
              setFilterInputs({
                ...filterInputs,
                [name]: [e.target.value, (filterInputs[name] as [string, number])[1] || 0],
              });
            }}
            MenuProps={{
              PaperProps: {
                sx: {
                  backgroundColor: "var(--theme-primary)",
                  boxShadow: "0 8px 16px rgba(0, 0, 0, 0.3)",
                },
              },
            }}
          >
            <MenuItem value="Any">Any</MenuItem>
            <MenuItem value="Less than">&lt;</MenuItem>
            <MenuItem value="More than">&gt;</MenuItem>
            <MenuItem value="Exactly">=</MenuItem>
          </Select>
          {(filterInputs[name] as [string, number])[0] !== "Any" && (
            <input
              type="number"
              className={classes.numberInput}
              value={(filterInputs[name] as [string, number])[1] || 0}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v)) {
                  setFilterInputs({
                    ...filterInputs,
                    [name]: [(filterInputs[name] as [string, number])[0], v],
                  });
                }
              }}
            />
          )}
        </div>
      </div>
    );
  }

  function handleApply() {
    onChangeFilters({ ...filters, ...filterInputs, name: null });
  }

  function handleReset() {
    const reset: TFilters = {
      name: null,
      v_grade: [1, 7],
      a_grade: [1, 7],
      commitment: [1, 6],
      quality: [1, 5],
      pitches: null,
      longest_pitch: null,
      hours: null,
      wetsuits: null,
    };
    onChangeFilters(reset);
    setFilterInputs({
      v_grade: [1, 7],
      a_grade: [1, 7],
      commitment: [1, 6],
      quality: [1, 5],
      pitches: ["Any", 0],
      longest_pitch: ["Any", 0],
      hours: ["Any", 0],
      wetsuits: [1, 5],
    });
  }

  // RopeWiki refresh
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
    } catch {
      setRefreshResult(null);
    } finally {
      setRefreshing(false);
    }
  }, [onRefetch]);

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
          <span>Filters</span>
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
                  {sliderCell("v_grade", "Vertical", [1, 7])}
                  {sliderCell("a_grade", "Aquatic", [1, 7])}
                  {sliderCell("commitment", "Commitment", [1, 6])}
                </div>
              </div>
              <div className={classes.section}>
                <div className={classes.sectionHeader}>Character</div>
                <div className={classes.sliderGrid}>
                  {sliderCell("quality", "Quality", [1, 5])}
                  {sliderCell("wetsuits", "Wetsuits", [1, 5])}
                </div>
              </div>
              <div className={classes.section}>
                <div className={classes.sectionHeader}>Logistics</div>
                <div className={classes.selectGrid}>
                  {selectCell("pitches", "Pitches")}
                  {selectCell("longest_pitch", "Longest pitch")}
                  {selectCell("hours", "Hours")}
                </div>
              </div>
            </div>
            <div className={classes.accordionFooter}>
              <button className={classes.applyButton} onClick={handleApply}>
                Apply
              </button>
              <button className={classes.resetButton} onClick={handleReset}>
                Reset
              </button>
            </div>
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
          {refreshing ? "Refreshing…" : "Refresh from RopeWiki"}
        </button>
        {refreshResult && (
          <span className={classes.refreshResult}>
            {refreshResult.added} added
            {refreshResult.autoLinked > 0 && `, ${refreshResult.autoLinked} linked`}
            , {refreshResult.updated} updated, {refreshResult.unchanged} unchanged
            {refreshResult.userEdited > 0 && `, ${refreshResult.userEdited} kept (edited)`}
            {refreshResult.review.length > 0 && `, ${refreshResult.review.length} need review`}
          </span>
        )}
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
