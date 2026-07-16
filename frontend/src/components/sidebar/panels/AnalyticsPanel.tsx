import { useState, useMemo } from "react";
import { ChevronLeft, ChevronRight, ArrowLeft, Info } from "lucide-react";
import type { TAnalytics, TTripLog } from "../../../canyonUtils";
import { tripTitle } from "../../../canyonUtils";
import { CANYONING_TRIP_TYPE, type TripLogCustomFieldDef } from "@logjam/shared";
import TripLogViewDialog from "../../dialogs/TripLogViewDialog";
import classes from "./AnalyticsPanel.module.css";

// ── Helpers ──────────────────────────────────────────────────────

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_ABBR = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

// Analytics is scoped to canyoning trips only. The drilldown's day-trip list is
// filtered client-side from the loaded trips, so it MUST mirror the server's
// predicate (CANYONING_TRIP_WHERE in api/src/routes/analytics.ts) exactly:
// canyon-linked OR tagged canyoning. Filtering on the tag alone would leave the
// heatmap counting a day the day-list then renders as empty.
function isCanyoningTrip(trip: TTripLog): boolean {
  return trip.canyons.length > 0 || trip.types.includes(CANYONING_TRIP_TYPE);
}

function heatClass(count: number, maxCount: number): string {
  if (count === 0 || maxCount === 0) return classes.heat0;
  const level = Math.ceil((count / maxCount) * 4);
  return classes[`heat${Math.min(level, 4) as 1 | 2 | 3 | 4}`];
}

function formatNumber(n: number | null): string {
  if (n === null) return "—";
  return n.toLocaleString();
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function firstDayOfWeek(year: number, month: number): number {
  return new Date(year, month, 1).getDay();
}

// ── Drilldown state ───────────────────────────────────────────────

type DrilldownLevel =
  | { level: "years" }
  | { level: "months"; year: number }
  | { level: "days"; year: number; month: number }
  | { level: "trips"; year: number; month: number; day: number };

// ── Stat tile ────────────────────────────────────────────────────

function StatTile({
  label,
  value,
  tooltip,
}: {
  label: string;
  value: string;
  tooltip?: string;
}) {
  return (
    <div className={classes.statTile}>
      <span className={classes.statValue}>{value}</span>
      <span className={classes.statLabel}>
        {label}
        {tooltip && (
          <span className={classes.tooltipAnchor} aria-label={tooltip}>
            <Info size={11} />
            <span className={classes.tooltip}>{tooltip}</span>
          </span>
        )}
      </span>
    </div>
  );
}

// ── Completion ring ───────────────────────────────────────────────

function CompletionRing({ total, completed }: { total: number; completed: number }) {
  const pct = total === 0 ? 0 : Math.round((completed / total) * 100);
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;

  return (
    <div className={classes.completionSection}>
      <span className={classes.sectionLabel}>
        Canyon Completion
        <span
          className={classes.tooltipAnchor}
          aria-label="Canyons in your library that have at least one logged trip of any type, out of your total canyons. Counts all trip types, so it can exceed Unique Canyons above (which is canyoning-only)."
        >
          <Info size={11} />
          <span className={classes.tooltip}>
            Canyons in your library that have at least one logged trip of any
            type, out of your total canyons. Counts all trip types, so it can
            exceed Unique Canyons above (which is canyoning-only).
          </span>
        </span>
      </span>
      <div className={classes.ringWrapper}>
        <svg viewBox="0 0 100 100" width={135} height={135} className={classes.ringSvg}>
          <circle
            cx="50" cy="50" r={radius}
            fill="none"
            stroke="rgba(255,255,255,0.08)"
            strokeWidth="8"
          />
          <circle
            cx="50" cy="50" r={radius}
            fill="none"
            stroke="var(--theme-accent)"
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            transform="rotate(-90 50 50)"
            className={classes.ringStrokeDash}
          />
        </svg>
        <div className={classes.ringCenter}>
          <span className={classes.ringPct}>{pct}%</span>
          <span className={classes.ringCaption}>{completed}/{total}</span>
        </div>
      </div>
    </div>
  );
}

// ── Drilldown heatmap ─────────────────────────────────────────────

function DrilldownHeatmap({
  tripDates,
  tripLogs,
  excludedTrips,
  customFieldDefs,
  onRefetchTripLogs,
  onRefetchAnalytics,
  onQuotaChanged,
}: {
  tripDates: Record<string, number>;
  tripLogs: TTripLog[];
  excludedTrips: number;
  customFieldDefs: TripLogCustomFieldDef[];
  onRefetchTripLogs: () => void;
  onRefetchAnalytics: () => void;
  onQuotaChanged: () => void;
}) {
  const currentYear = new Date().getFullYear();
  const [drilldown, setDrilldown] = useState<DrilldownLevel>({ level: "years" });
  const [viewingTripLog, setViewingTripLog] = useState<TTripLog | null>(null);

  // Derive all years that have trip data (plus current year always shown)
  const allYears = useMemo(() => {
    const yearSet = new Set<number>([currentYear]);
    for (const dateStr of Object.keys(tripDates)) {
      yearSet.add(parseInt(dateStr.slice(0, 4), 10));
    }
    return Array.from(yearSet).sort((a, b) => a - b);
  }, [tripDates, currentYear]);

  // Aggregate counts per year
  const countsByYear = useMemo(() => {
    const map: Record<number, number> = {};
    for (const [dateStr, count] of Object.entries(tripDates)) {
      const yr = parseInt(dateStr.slice(0, 4), 10);
      map[yr] = (map[yr] ?? 0) + count;
    }
    return map;
  }, [tripDates]);

  // Aggregate counts per month for a given year
  const countsByMonth = useMemo(() => {
    if (drilldown.level !== "months" && drilldown.level !== "days" && drilldown.level !== "trips") return [];
    const year = drilldown.level === "months" ? drilldown.year
               : drilldown.level === "days" ? drilldown.year
               : drilldown.year;
    const counts = Array(12).fill(0) as number[];
    for (const [dateStr, count] of Object.entries(tripDates)) {
      if (parseInt(dateStr.slice(0, 4), 10) === year) {
        const mo = parseInt(dateStr.slice(5, 7), 10) - 1;
        counts[mo] += count;
      }
    }
    return counts;
  }, [tripDates, drilldown]);

  // Navigation label and controls visibility
  function headerLabel(): string {
    if (drilldown.level === "years") return "All Years";
    if (drilldown.level === "months") return String(drilldown.year);
    if (drilldown.level === "days")
      return `${MONTH_ABBR[drilldown.month]} ${drilldown.year}`;
    const d = new Date(drilldown.year, drilldown.month, drilldown.day);
    return d.toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });
  }

  function canNavigatePrev(): boolean {
    if (drilldown.level === "years") return false;
    if (drilldown.level === "months") return allYears.indexOf(drilldown.year) > 0;
    if (drilldown.level === "days") return true; // can always go prev month
    return false;
  }

  function canNavigateNext(): boolean {
    if (drilldown.level === "years") return false;
    if (drilldown.level === "months") return allYears.indexOf(drilldown.year) < allYears.length - 1;
    if (drilldown.level === "days") return true; // can always go next month
    return false;
  }

  function handlePrev() {
    if (drilldown.level === "months") {
      const idx = allYears.indexOf(drilldown.year);
      if (idx > 0) setDrilldown({ level: "months", year: allYears[idx - 1] });
    } else if (drilldown.level === "days") {
      const { year, month } = drilldown;
      if (month === 0) setDrilldown({ level: "days", year: year - 1, month: 11 });
      else setDrilldown({ level: "days", year, month: month - 1 });
    }
  }

  function handleNext() {
    if (drilldown.level === "months") {
      const idx = allYears.indexOf(drilldown.year);
      if (idx < allYears.length - 1) setDrilldown({ level: "months", year: allYears[idx + 1] });
    } else if (drilldown.level === "days") {
      const { year, month } = drilldown;
      if (month === 11) setDrilldown({ level: "days", year: year + 1, month: 0 });
      else setDrilldown({ level: "days", year, month: month + 1 });
    }
  }

  function handleBack() {
    if (drilldown.level === "months") setDrilldown({ level: "years" });
    else if (drilldown.level === "days")
      setDrilldown({ level: "months", year: drilldown.year });
    else if (drilldown.level === "trips")
      setDrilldown({ level: "days", year: drilldown.year, month: drilldown.month });
  }

  const showNav = drilldown.level !== "years" && drilldown.level !== "trips";
  const maxYearCount = Math.max(...allYears.map((y) => countsByYear[y] ?? 0), 0);
  const maxMonthCount = Math.max(...countsByMonth, 0);

  // Day trips list
  const dayTrips = useMemo(() => {
    if (drilldown.level !== "trips") return [];
    const { year, month, day } = drilldown;
    const padded = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return tripLogs.filter((t) => t.date.startsWith(padded) && isCanyoningTrip(t));
  }, [drilldown, tripLogs]);

  return (
    <div className={classes.heatmapSection}>
      <span className={classes.sectionLabel}>Canyoning activity</span>
      {excludedTrips > 0 && (
        <span className={classes.heatmapCaption}>
          {excludedTrips} trip{excludedTrips !== 1 ? "s" : ""} of other types not shown.
        </span>
      )}

      {/* Navigation header */}
      <div className={classes.heatmapNav}>
        <button
          className={classes.navIconBtn}
          onClick={handleBack}
          disabled={drilldown.level === "years"}
          title="Back"
        >
          <ArrowLeft size={14} />
        </button>
        <span className={classes.navLabel}>{headerLabel()}</span>
        {showNav ? (
          <span className={classes.navArrows}>
            <button
              className={classes.navIconBtn}
              onClick={handlePrev}
              disabled={!canNavigatePrev()}
              title="Previous"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              className={classes.navIconBtn}
              onClick={handleNext}
              disabled={!canNavigateNext()}
              title="Next"
            >
              <ChevronRight size={14} />
            </button>
          </span>
        ) : (
          <span className={classes.navArrows} />
        )}
      </div>

      {/* Level 1: Years */}
      {drilldown.level === "years" && (
        <div className={classes.yearsGrid}>
          {allYears.map((year) => {
            const count = countsByYear[year] ?? 0;
            return (
              <button
                key={year}
                className={`${classes.yearCell} ${heatClass(count, maxYearCount)}`}
                onClick={() => setDrilldown({ level: "months", year })}
              >
                <span className={classes.yearLabel}>{year}</span>
                <span className={classes.yearCount}>{count} trip{count !== 1 ? "s" : ""}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Level 2: Months */}
      {drilldown.level === "months" && (
        <div className={classes.monthsGrid}>
          {MONTH_ABBR.map((abbr, i) => {
            const count = countsByMonth[i] ?? 0;
            return (
              <button
                key={i}
                className={`${classes.monthCell} ${heatClass(count, maxMonthCount)}`}
                onClick={() => setDrilldown({ level: "days", year: drilldown.year, month: i })}
              >
                <span className={classes.monthLabel}>{abbr}</span>
                <span className={classes.monthCount}>{count}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Level 3: Calendar */}
      {drilldown.level === "days" && (() => {
        const { year, month } = drilldown;
        const totalDays = daysInMonth(year, month);
        const startDow = firstDayOfWeek(year, month);
        const dateKey = (d: number) =>
          `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        const maxDayCount = Math.max(
          ...Array.from({ length: totalDays }, (_, i) => tripDates[dateKey(i + 1)] ?? 0),
          0,
        );

        return (
          <div className={classes.calendarGrid}>
            {DAY_ABBR.map((d) => (
              <span key={d} className={classes.calDowHeader}>{d}</span>
            ))}
            {Array.from({ length: startDow }, (_, i) => (
              <span key={`empty-${i}`} />
            ))}
            {Array.from({ length: totalDays }, (_, i) => {
              const day = i + 1;
              const count = tripDates[dateKey(day)] ?? 0;
              return (
                <button
                  key={day}
                  className={`${classes.dayCell} ${heatClass(count, maxDayCount)}`}
                  onClick={() => {
                    if (count > 0)
                      setDrilldown({ level: "trips", year, month, day });
                  }}
                  disabled={count === 0}
                  title={count > 0 ? `${count} trip${count !== 1 ? "s" : ""}` : undefined}
                >
                  {day}
                </button>
              );
            })}
          </div>
        );
      })()}

      {/* Level 4: Trips for a day */}
      {drilldown.level === "trips" && (
        <div className={classes.dayTripsList}>
          {dayTrips.length === 0 ? (
            <span className={classes.emptyText}>No trips found.</span>
          ) : (
            dayTrips.map((trip) => (
              <button
                key={trip.id}
                className={classes.tripCard}
                onClick={() => setViewingTripLog(trip)}
              >
                <span className={classes.tripCanyonName}>{tripTitle(trip)}</span>
                {trip.notes && (
                  <span className={classes.tripNotes}>
                    {trip.notes.length > 80 ? trip.notes.slice(0, 80) + "…" : trip.notes}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      )}

      {/* Trip log view dialog (level 4) */}
      <TripLogViewDialog
        open={viewingTripLog !== null}
        onClose={() => setViewingTripLog(null)}
        tripLog={viewingTripLog}
        customFieldDefs={customFieldDefs}
        onMediaChanged={onQuotaChanged}
        onEdit={() => setViewingTripLog(null)}
        onDeleted={() => {
          setViewingTripLog(null);
          onRefetchTripLogs();
          onRefetchAnalytics();
          onQuotaChanged();
        }}
      />
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────

function AnalyticsPanel({
  analytics,
  loading,
  tripLogs,
  customFieldDefs,
  onRefetchTripLogs,
  onRefetchAnalytics,
  onQuotaChanged,
}: {
  analytics: TAnalytics | null;
  loading: boolean;
  tripLogs: TTripLog[];
  customFieldDefs: TripLogCustomFieldDef[];
  onRefetchTripLogs: () => void;
  onRefetchAnalytics: () => void;
  onQuotaChanged: () => void;
}) {
  if (!analytics) {
    return (
      <div className={classes.panel}>
        <span className={classes.emptyText}>{loading ? "Loading..." : "No data"}</span>
      </div>
    );
  }

  const { heroStats, completion, tripDates } = analytics;

  return (
    <div className={classes.panel}>
      {/* Hero stats */}
      <div className={classes.statGrid}>
        <StatTile
          label="Canyon Trips"
          value={formatNumber(heroStats.totalTrips)}
          tooltip="Trips with a linked canyon, plus any trip tagged canyoning. Trips of other types aren't counted here."
        />
        <StatTile
          label="Unique Canyons"
          value={formatNumber(heroStats.uniqueCanyons)}
          tooltip="Distinct canyons you've logged a canyoning trip on. A named trip with no linked canyon counts once by its name."
        />
        <StatTile label="Days Canyoning" value={formatNumber(heroStats.daysCanyoning)} />
        <StatTile
          label="Total Abseils"
          value={formatNumber(heroStats.totalAbseils)}
          tooltip="Estimated from canyon data. Excludes canyons with no abseil count recorded."
        />
      </div>

      {/* Completion ring */}
      <CompletionRing
        total={completion.totalCanyons}
        completed={completion.canyonsWithTrips}
      />

      {/* Drill-down heatmap */}
      <DrilldownHeatmap
        tripDates={tripDates}
        tripLogs={tripLogs}
        excludedTrips={heroStats.excludedTrips}
        customFieldDefs={customFieldDefs}
        onRefetchTripLogs={onRefetchTripLogs}
        onRefetchAnalytics={onRefetchAnalytics}
        onQuotaChanged={onQuotaChanged}
      />
    </div>
  );
}

export default AnalyticsPanel;
