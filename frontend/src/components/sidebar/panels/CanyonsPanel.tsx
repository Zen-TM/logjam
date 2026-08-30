import { useState, useCallback, useEffect, useMemo } from "react";
import { ChevronDown, X } from "lucide-react";
import { Slider, Switch } from "@mui/material";
import classes from "./CanyonsPanel.module.css";
import type {
  TCanyon,
  TFilters,
  TDateRange,
  TCustomFieldFilter,
} from "../../../canyonUtils";
import {
  refreshFromRopeWiki,
  passesFilters,
  activeFilterCount,
  emptyFilters,
} from "../../../canyonUtils";
// The graded axes' bounds double as the "inactive" value, so they come from
// the same place the predicate reads them (shared/src/canyonFilter.ts).
import { CANYON_RANGE_BOUNDS as SLIDER_RANGES, type CanyonRangeKey } from "@logjam/shared";
import type { RefreshResult } from "../../../canyonUtils";
import { useStoredState } from "../../../useStoredState";
import type { PanelId } from "../panels";
import type { TripLogCustomFieldDef } from "@logjam/shared";
import { customFieldDisplayLabel } from "@logjam/shared";
import RopeWikiReviewDialog from "../../dialogs/RopeWikiReviewDialog";
import ConfirmDialog from "../../dialogs/ConfirmDialog";
import { useToast } from "../../feedback/ToastProvider";
import { messageFromError } from "../../../errors/messageFromError";

type SliderKey = CanyonRangeKey;
type ThresholdKey = "pitches" | "longest_pitch" | "hours";

type SortKey = "name" | "recent" | "grade";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "name", label: "Name (A–Z)" },
  { value: "recent", label: "Recently added" },
  { value: "grade", label: "Grade (V/A)" },
];

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

// "Done" is the word the question gets asked in ("have I done Claustral?");
// "Completion" is the label because that's what the analytics panel already
// calls this exact measure (its ring counts canyons with >= 1 logged trip).
const COMPLETION_OPTIONS: { value: TFilters["completion"]; label: string }[] = [
  { value: "any", label: "Any" },
  { value: "done", label: "Done" },
  { value: "not_done", label: "Not done" },
];

function gradeSummary(c: TCanyon): string {
  const parts: string[] = [];
  if (c.vGrade != null) parts.push(`V${c.vGrade}`);
  if (c.aGrade != null) parts.push(`A${c.aGrade}`);
  return parts.join(" ");
}

function CanyonsPanel({
  canyons,
  canyonsTotal,
  sharedCanyons,
  onAddCanyon,
  onOpenUnifiedImport,
  onExportCanyons,
  onStartAreaSelection,
  onCancelAreaSelection,
  selectingArea,
  onRefetch,
  filters,
  onChangeFilters,
  filtersAccordionSignal,
  onFlyToCanyon,
  setSelectedCanyonID,
  setActivePanel,
  canyonCustomFieldDefs,
  onExpandSheet,
}: {
  canyons: TCanyon[];
  // True owned-canyon total before the server's list cap; null until known.
  canyonsTotal: number | null;
  sharedCanyons: TCanyon[];
  onAddCanyon: () => void;
  onOpenUnifiedImport: () => void;
  // Hands the ids to the existing Selected Canyons dialog, which owns export.
  onExportCanyons: (canyonIds: string[]) => void;
  onStartAreaSelection: () => void;
  onCancelAreaSelection: () => void;
  selectingArea: boolean;
  onRefetch: () => void;
  filters: TFilters;
  onChangeFilters: (f: TFilters) => void;
  filtersAccordionSignal: number;
  onFlyToCanyon: (lat: number, lng: number) => void;
  setSelectedCanyonID: (id: string | null) => void;
  setActivePanel: (panel: PanelId | null) => void;
  canyonCustomFieldDefs: TripLogCustomFieldDef[];
  // Mobile: request the bottom sheet expand to its full snap. No-op on desktop
  // (SidebarPanel guards on isMobile). Used when opening the filters accordion,
  // which needs the full sheet height to be usable (its scroll region collapses
  // to an unusable sliver in the shorter "half" snap).
  onExpandSheet?: () => void;
}) {
  // Search: a substring query that filters the canyon cards below (matches the
  // primary name or any alternative name). ANDs with the filters. Session-scoped
  // so it survives the panel's unmount-on-close (CANYON-12) but not the session:
  // a search remembered for a month means the user returns to a filtered list
  // and reads it as "my canyons are missing" (UX finding 5).
  const [query, setQuery] = useStoredState("logjam.canyonSearch", "", sessionStorage);
  // Sort order is a preference, not a filter — it hides nothing, so it stays in
  // localStorage and is expected back next month (CANYON-4).
  const [sortKey, setSortKey] = useStoredState<SortKey>(
    "logjam.canyonSort",
    "name",
  );

  // Filters accordion
  const [filtersOpen, setFiltersOpen] = useState(false);
  useEffect(() => {
    if (filtersAccordionSignal > 0) setFiltersOpen(true);
  }, [filtersAccordionSignal]);

  // On mobile the filters accordion's scroll region collapses to an unusable
  // sliver in the "half" snap; expand the sheet to full whenever it opens so the
  // filters get the height they need. Covers both the header toggle and the
  // App-driven filtersAccordionSignal open. No-op on desktop.
  useEffect(() => {
    if (filtersOpen) onExpandSheet?.();
  }, [filtersOpen, onExpandSheet]);

  const activeCount = activeFilterCount(filters);

  // Live results below the controls (owned bucket vs shared bucket — ownership
  // is structural, so each list is filtered with its own isOwned flag).
  const filteredCanyons = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matchesSearch = (c: TCanyon) =>
      q === "" ||
      c.name.toLowerCase().includes(q) ||
      c.altNames.some((a) => a.toLowerCase().includes(q));
    const rows = [
      ...canyons
        .filter((c) => matchesSearch(c) && passesFilters(c, filters, true))
        .map((c) => ({ canyon: c, owned: true })),
      ...sharedCanyons
        .filter((c) => matchesSearch(c) && passesFilters(c, filters, false))
        .map((c) => ({ canyon: c, owned: false })),
    ];
    // Nulls sort last for every key so canyons missing the sort field don't
    // crowd the top. `recent` = newest first; `grade` = easiest first (V then A).
    const compare = (a: TCanyon, b: TCanyon): number => {
      switch (sortKey) {
        case "recent":
          return b.createdAt.localeCompare(a.createdAt);
        case "grade": {
          const av = a.vGrade ?? Infinity;
          const bv = b.vGrade ?? Infinity;
          if (av !== bv) return av - bv;
          const aa = a.aGrade ?? Infinity;
          const ba = b.aGrade ?? Infinity;
          if (aa !== ba) return aa - ba;
          return a.name.localeCompare(b.name);
        }
        case "name":
        default:
          return a.name.localeCompare(b.name);
      }
    };
    return rows.sort((x, y) => compare(x.canyon, y.canyon));
  }, [canyons, sharedCanyons, filters, query, sortKey]);

  // ── Live filtering ─────────────────────────────────────────────
  // Sliders keep a local draft so the thumb tracks the drag smoothly; the
  // global filter only commits on release (onChangeCommitted). Full range
  // commits as null — the canonical "inactive" value (see canyonUtils).
  const draftFromFilters = useCallback(
    (f: TFilters): Record<SliderKey, number[]> => ({
      v_grade: f.v_grade ?? [...SLIDER_RANGES.v_grade],
      a_grade: f.a_grade ?? [...SLIDER_RANGES.a_grade],
      commitment: f.commitment ?? [...SLIDER_RANGES.commitment],
      quality: f.quality ?? [...SLIDER_RANGES.quality],
    }),
    [],
  );
  const [sliderDraft, setSliderDraft] = useState(() => draftFromFilters(filters));
  useEffect(() => {
    setSliderDraft(draftFromFilters(filters));
  }, [filters, draftFromFilters]);

  // Bounded custom-field range sliders keep their own draft map, keyed by field
  // key, synced from the committed filter (defaulting to the field's full span).
  const customDraftFromFilters = useCallback(
    (f: TFilters): Record<string, [number, number]> => {
      const out: Record<string, [number, number]> = {};
      for (const def of canyonCustomFieldDefs) {
        if (def.min == null || def.max == null) continue;
        const cur = f.custom[def.key];
        out[def.key] =
          cur?.kind === "numberRange" ? cur.range : [def.min, def.max];
      }
      return out;
    },
    [canyonCustomFieldDefs],
  );
  const [customSliderDraft, setCustomSliderDraft] = useState(() =>
    customDraftFromFilters(filters),
  );
  useEffect(() => {
    setCustomSliderDraft(customDraftFromFilters(filters));
  }, [filters, customDraftFromFilters]);

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
            // FEUI-005: uncontrolled (defaultValue, not value) so backspacing
            // to empty doesn't get snapped back to the last committed number
            // on every keystroke — React only re-applies `value` bindings,
            // never `defaultValue`, after mount. A commit still fires live on
            // every valid parse; an empty/invalid intermediate state is left
            // alone rather than reverted or force-committed.
            <input
              type="number"
              aria-label={`${displayName} value`}
              className={classes.numberInput}
              defaultValue={num}
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

  function choiceCell<K extends "ownership" | "ropewiki" | "completion">(
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
          aria-label={`Filter ${def.label} contains`}
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
            // FEUI-005: uncontrolled (defaultValue, not value) — see thresholdCell.
            <input
              type="number"
              step={def.type === "float" ? "any" : 1}
              aria-label={`${def.label} value`}
              className={classes.numberInput}
              defaultValue={num}
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

  function customSliderCell(def: TripLogCustomFieldDef) {
    const min = def.min as number;
    const max = def.max as number;
    const current = filters.custom[def.key];
    const draft = customSliderDraft[def.key] ?? [min, max];
    const isFull = draft[0] === min && draft[1] === max;
    const isActive = current?.kind === "numberRange";
    const isInt = def.type === "integer";
    // Continuous-ish step for floats; integer step (with ticks) when small.
    const step = isInt ? 1 : (max - min) / 100 || 1;
    const showMarks = isInt && max - min <= 20;
    const fmt = (n: number) => (isInt ? String(n) : String(Math.round(n * 100) / 100));
    return (
      <div
        className={`${classes.sliderCell} ${isFull ? classes.sliderInactive : ""}`}
        key={def.key}
      >
        <div className={classes.sliderLabel}>
          <span className={classes.sliderLabelText}>
            {customFieldDisplayLabel(def)}
          </span>
          <span className={classes.sliderValueGroup}>
            <span className={classes.sliderValue}>
              {isFull ? "Any" : `${fmt(draft[0])}–${fmt(draft[1])}`}
            </span>
            {isActive && clearButton(() => setCustomFilter(def.key, null))}
          </span>
        </div>
        <Slider
          color="secondary"
          marks={showMarks}
          step={step}
          min={min}
          max={max}
          value={draft}
          valueLabelDisplay="auto"
          onChange={(_e, v) => {
            if (Array.isArray(v) && v.length === 2) {
              setCustomSliderDraft((d) => ({ ...d, [def.key]: v as [number, number] }));
            }
          }}
          onChangeCommitted={(_e, v) => {
            if (Array.isArray(v) && v.length === 2) {
              const full = v[0] === min && v[1] === max;
              setCustomFilter(
                def.key,
                full ? null : { kind: "numberRange", range: v as [number, number] },
              );
            }
          }}
        />
      </div>
    );
  }

  function customFieldCell(def: TripLogCustomFieldDef) {
    switch (def.type) {
      case "string":
        return customTextCell(def);
      case "integer":
      case "float":
        return def.min != null && def.max != null
          ? customSliderCell(def)
          : customNumberCell(def);
      case "date":
        return customDateCell(def);
      case "boolean":
        return customBooleanCell(def);
    }
  }

  function handleReset() {
    // FEUI-004: was a hand-spelled duplicate of EMPTY_CANYON_FILTERS (the two
    // lists that must agree = one declaration + a test anti-pattern) — a new
    // CanyonFilters key would be silently missed here, so Reset would leave
    // that filter active. `custom` gets a fresh object so the singleton's
    // nested record is never shared/mutated.
    onChangeFilters({ ...emptyFilters, custom: {} });
  }

  // RopeWiki refresh
  const toast = useToast();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshResult, setRefreshResult] = useState<RefreshResult | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  // Confirm before firing POST /ropewiki/refresh — the request scrapes the public
  // RopeWiki database and can add many canyons, so it shouldn't fire on a single
  // click with no preface (IMPORT-11).
  const [confirmRefreshOpen, setConfirmRefreshOpen] = useState(false);

  const handleRefresh = useCallback(async () => {
    setConfirmRefreshOpen(false);
    setRefreshing(true);
    setRefreshResult(null);
    try {
      const result = await refreshFromRopeWiki();
      setRefreshResult(result);
      onRefetch();
      if (result.review.length > 0) setReviewOpen(true);
      // Summarise everything the refresh did automatically, and flag the count
      // still needing review, so the auto-import isn't silent (IMPORT-3).
      const autoParts = [
        result.added > 0 ? `${result.added} added` : null,
        result.autoLinked > 0 ? `${result.autoLinked} linked` : null,
        result.updated > 0 ? `${result.updated} updated` : null,
      ].filter(Boolean);
      const summary =
        autoParts.length > 0 ? autoParts.join(", ") : "no new canyons";
      const reviewSuffix =
        result.review.length > 0
          ? ` · ${result.review.length} possible duplicate${result.review.length === 1 ? "" : "s"} to review`
          : "";
      // The corpus is a periodically hand-refreshed snapshot (RopeWiki blocks
      // server-side fetches), so date it — otherwise a months-old import is
      // indistinguishable from a live one.
      const sourceSuffix = result.sourceUpdatedAt
        ? ` · source ${new Date(result.sourceUpdatedAt).toLocaleDateString()}`
        : "";
      toast.success(`RopeWiki import: ${summary}${reviewSuffix}${sourceSuffix}`);
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

      {/* Search — filters the cards below (by name or alternative names) */}
      <div className={classes.searchWrapper}>
        <input
          className={classes.searchInput}
          type="text"
          aria-label="Search canyons"
          placeholder="Search canyons…"
          value={query}
          onChange={(e) => {
            const next = e.target.value;
            // Collapse the filters accordion the instant a search begins so the
            // cards sit right under the search box. Only on the empty→typed
            // transition — don't fight a user who reopened filters mid-search.
            if (query.trim() === "" && next.trim() !== "") setFiltersOpen(false);
            setQuery(next);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setQuery("");
          }}
        />
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
              {/* First section: "have I done it?" is the question this panel
                  gets asked most, so it's the first thing in the accordion. */}
              <div className={classes.section}>
                <div className={classes.sectionHeader}>Trips</div>
                <div className={classes.selectGrid}>
                  {choiceCell(
                    "completion",
                    "Completion",
                    COMPLETION_OPTIONS,
                    "any",
                  )}
                </div>
              </div>
              <div className={classes.section}>
                <div className={classes.sectionHeader}>Grades</div>
                <div className={classes.sliderGrid}>
                  {sliderCell("v_grade", "Vertical")}
                  {sliderCell("a_grade", "Aquatic")}
                  {sliderCell("commitment", "Commitment")}
                  {sliderCell("quality", "Quality")}
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
                <div
                  className={classes.toggleRow}
                  title="When on, show only canyons you've shared with at least one friend."
                >
                  <span>Shared by me</span>
                  <Switch
                    size="small"
                    checked={filters.shared_by_me}
                    onChange={(_, v) =>
                      onChangeFilters({ ...filters, shared_by_me: v })
                    }
                    color="secondary"
                  />
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
          <span>
            {filteredCanyons.length} canyon{filteredCanyons.length === 1 ? "" : "s"}
          </span>
          <label className={classes.sortControl}>
            <span className={classes.visuallyHidden}>Sort canyons by</span>
            <select
              className={classes.select}
              aria-label="Sort canyons"
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {/* The server caps the owned-canyon list; warn when the loaded set is a
            truncated view of the true total so the oldest canyons aren't
            silently hidden (UX-001). */}
        {canyonsTotal != null && canyonsTotal > canyons.length && (
          <div className={classes.truncationNote}>
            Showing your {canyons.length} most recent canyons of {canyonsTotal}.
            Older ones aren&rsquo;t loaded.
          </div>
        )}
        {filteredCanyons.length === 0 ? (
          <span className={classes.resultsEmpty}>
            {query.trim() !== "" || activeCount > 0
              ? "No canyons match your search and filters."
              : "No canyons yet."}
          </span>
        ) : (
          <div className={classes.resultsList}>
            {filteredCanyons.map(({ canyon, owned }) => {
              const shareCount = canyon._count?.shares ?? 0;
              // The filter answers "have I done it" for the list; this answers
              // it per row, which is the half a filter can't — the complaint was
              // having to open a canyon to see whether it had trips. Stated only
              // when non-zero (matching the share badge beside it): a count is
              // worth a word, an absence isn't worth one on 270 of 298 rows.
              // Owned-only for the same reason the completion filter is — on a
              // shared canyon this tally is the owner's, not the viewer's.
              const tripCount = owned ? (canyon._count?.tripLogLinks ?? 0) : 0;
              const meta = [
                gradeSummary(canyon),
                tripCount > 0
                  ? `${tripCount} trip${tripCount === 1 ? "" : "s"}`
                  : "",
                owned
                  ? shareCount > 0
                    ? `Shared with ${shareCount}`
                    : ""
                  : "Shared",
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <button
                  key={canyon.id}
                  className={classes.resultCard}
                  onClick={() => {
                    onFlyToCanyon(canyon.latitude, canyon.longitude);
                    setSelectedCanyonID(canyon.id);
                    setActivePanel("canyon-detail");
                  }}
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
        {/* Export sat behind "select an area on the map" — undiscoverable
            unless you already knew it was there. It exports exactly the list
            shown above (search + filters applied), so the count is stated on
            the button and matches the header count. Opens the existing
            Selected Canyons dialog; no separate export surface. */}
        <button
          className={classes.ghostButton}
          onClick={() => onExportCanyons(filteredCanyons.map((r) => r.canyon.id))}
          disabled={filteredCanyons.length === 0}
        >
          Export {filteredCanyons.length} canyon
          {filteredCanyons.length === 1 ? "" : "s"}
        </button>
        <button
          className={classes.ghostButton}
          onClick={onOpenUnifiedImport}
        >
          Import from file
        </button>
        <button
          className={classes.ghostButton}
          onClick={() => setConfirmRefreshOpen(true)}
          disabled={refreshing}
        >
          {refreshing ? "Importing..." : "Import from RopeWiki"}
        </button>
      </div>

      <ConfirmDialog
        open={confirmRefreshOpen}
        title="Import from RopeWiki?"
        message={
          "This fetches the public NSW canyon list from ropewiki.com and adds any canyons you don't already have, updating RopeWiki-sourced ones you haven't edited. Canyons that look like ones you already have are set aside for you to review before they're imported. Nothing you've edited is overwritten."
        }
        confirmLabel="Fetch from RopeWiki"
        confirmColor="secondary"
        busy={refreshing}
        onConfirm={handleRefresh}
        onClose={() => setConfirmRefreshOpen(false)}
      />

      {refreshResult && (
        <RopeWikiReviewDialog
          open={reviewOpen}
          review={refreshResult.review}
          autoImported={{
            added: refreshResult.added,
            autoLinked: refreshResult.autoLinked,
            updated: refreshResult.updated,
          }}
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
