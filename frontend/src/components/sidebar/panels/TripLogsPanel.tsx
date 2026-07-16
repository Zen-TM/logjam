import { useState, useMemo } from "react";
import { useStoredState } from "../../../useStoredState";
import type { TripLogCustomFieldDef } from "@logjam/shared";
import type { TCanyon, TTripLog } from "../../../canyonUtils";
import { tripTitle } from "../../../canyonUtils";
import TripLogViewDialog from "../../dialogs/TripLogViewDialog";
import TripLogDialog from "../../dialogs/TripLogDialog";
import classes from "./TripLogsPanel.module.css";

// The type-filter dropdown's "no type set" bucket. Distinct from "" (All),
// which never matches an actual trip.types entry.
const NO_TYPE_FILTER_VALUE = "__no_type__";

function TripLogsPanel({
  tripLogs,
  tripLogsTotal,
  loading,
  onRefetchTripLogs,
  onRefetchAnalytics,
  customFieldDefs,
  onCustomFieldDefsChange,
  canyons,
  onPickCoords,
  pickingCoords,
  onQuotaChanged,
  onRefetchCanyons,
  onOpenUnifiedImport,
}: {
  tripLogs: TTripLog[];
  // True trip-log total before the server's list cap; null until known.
  tripLogsTotal: number | null;
  loading: boolean;
  onRefetchTripLogs: () => void;
  onRefetchAnalytics: () => void;
  customFieldDefs: TripLogCustomFieldDef[];
  onCustomFieldDefsChange: (defs: TripLogCustomFieldDef[]) => void;
  canyons: TCanyon[];
  onPickCoords: (onPicked: (lat: number, lng: number) => void) => void;
  pickingCoords: boolean;
  onQuotaChanged: () => void;
  onRefetchCanyons: () => void;
  onOpenUnifiedImport: () => void;
}) {
  // Ephemeral filters — session-scoped, matching the canyon search. They survive
  // the panel's unmount-on-close (and a tab switch) so a mid-task filter isn't
  // retyped, but they're gone next session: a date range remembered for a month
  // hides trips the user never asked to hide (UX finding 5).
  const [search, setSearch] = useStoredState("logjam.tripSearch", "", sessionStorage);
  const [dateFrom, setDateFrom] = useStoredState("logjam.tripDateFrom", "", sessionStorage);
  const [dateTo, setDateTo] = useStoredState("logjam.tripDateTo", "", sessionStorage);
  const [typeFilter, setTypeFilter] = useStoredState("logjam.tripTypeFilter", "", sessionStorage);
  const [viewingTripLog, setViewingTripLog] = useState<TTripLog | null>(null);
  const [editingTripLog, setEditingTripLog] = useState<TTripLog | undefined>(undefined);
  const [showViewDialog, setShowViewDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  // Trip types flattened across the loaded trips — feeds both the type-filter
  // dropdown here and the types field's suggestions in the create/edit dialogs.
  const existingTripTypes = useMemo(
    () => tripLogs.flatMap((t) => t.types),
    [tripLogs],
  );
  const distinctTypes = useMemo(
    () => Array.from(new Set(existingTripTypes)).sort((a, b) => a.localeCompare(b)),
    [existingTripTypes],
  );

  const filtered = useMemo(() => {
    return tripLogs.filter((t) => {
      if (search.trim()) {
        const q = search.toLowerCase();
        const nameMatch =
          t.canyons.some((c) => c.name.toLowerCase().includes(q)) ||
          t.displayName?.toLowerCase().includes(q);
        if (!nameMatch) return false;
      }
      if (dateFrom) {
        if (new Date(t.date) < new Date(dateFrom)) return false;
      }
      if (dateTo) {
        if (new Date(t.date) > new Date(dateTo)) return false;
      }
      if (typeFilter === NO_TYPE_FILTER_VALUE) {
        if (t.types.length > 0) return false;
      } else if (typeFilter) {
        if (!t.types.includes(typeFilter)) return false;
      }
      return true;
    });
  }, [tripLogs, search, dateFrom, dateTo, typeFilter]);

  return (
    <div className={classes.panel}>
      <button
        className={classes.logTripButton}
        onClick={() => setShowCreateDialog(true)}
      >
        Log Trip
      </button>

      <div className={classes.filters}>
        <input
          type="text"
          className={classes.searchInput}
          placeholder="Search by canyon or trip name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search trip logs by canyon or trip name"
        />
        <div className={classes.dateRow}>
          <label className={classes.dateField}>
            <span className={classes.dateLabel}>From</span>
            <input
              type="date"
              className={classes.dateInput}
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </label>
          <label className={classes.dateField}>
            <span className={classes.dateLabel}>To</span>
            <input
              type="date"
              className={classes.dateInput}
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </label>
        </div>
        <select
          className={classes.typeSelect}
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          aria-label="Filter trip logs by type"
        >
          <option value="">All types</option>
          {distinctTypes.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
          <option value={NO_TYPE_FILTER_VALUE}>No type</option>
        </select>
      </div>

      {loading ? (
        <span className={classes.caption}>Loading...</span>
      ) : filtered.length === 0 ? (
        <span className={classes.caption}>
          {tripLogs.length === 0 ? "No trip logs yet." : "No trips match your filters."}
        </span>
      ) : (
        <div className={classes.list}>
          {filtered.map((trip) => (
            <button
              key={trip.id}
              className={classes.tripCard}
              onClick={() => {
                setViewingTripLog(trip);
                setShowViewDialog(true);
              }}
            >
              <span className={classes.canyonName}>{tripTitle(trip)}</span>
              <span className={classes.tripDate}>
                {new Date(trip.date).toLocaleDateString("en-AU", {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                  // Trip dates are stored as UTC-midnight (date-only); format in
                  // UTC so AEST (UTC+10/+11) doesn't render the prior day.
                  timeZone: "UTC",
                })}
              </span>
              {trip.types.length > 0 && (
                <span className={classes.typeChips}>
                  {trip.types.map((t) => (
                    <span key={t} className={classes.typeChip}>{t}</span>
                  ))}
                </span>
              )}
              {trip.notes && (
                <span className={classes.tripNotes}>
                  {trip.notes.length > 80 ? trip.notes.slice(0, 80) + "…" : trip.notes}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* The server caps the trip-log list; warn when the loaded set is a
          truncated view of the true total so the oldest trips aren't silently
          hidden (UX-001). */}
      {!loading && tripLogsTotal != null && tripLogsTotal > tripLogs.length && (
        <span className={classes.truncationNote}>
          Showing your {tripLogs.length} most recent trips of {tripLogsTotal}.
          Older ones aren&rsquo;t loaded.
        </span>
      )}

      {/* Low-frequency actions */}
      <div className={classes.footerActions}>
        <div className={classes.divider} />
        <button className={classes.ghostButton} onClick={onOpenUnifiedImport}>
          Import from file
        </button>
      </div>

      {/* View dialog */}
      <TripLogViewDialog
        open={showViewDialog}
        onClose={() => {
          setShowViewDialog(false);
          setViewingTripLog(null);
        }}
        tripLog={viewingTripLog}
        customFieldDefs={customFieldDefs}
        onMediaChanged={onQuotaChanged}
        onEdit={() => {
          setShowViewDialog(false);
          setEditingTripLog(viewingTripLog ?? undefined);
          setViewingTripLog(null);
          setShowEditDialog(true);
        }}
        onDeleted={() => {
          onRefetchTripLogs();
          onRefetchAnalytics();
          onQuotaChanged();
        }}
      />

      {/* Edit dialog */}
      {editingTripLog && (
        <TripLogDialog
          open={showEditDialog && !pickingCoords}
          onClose={() => {
            setShowEditDialog(false);
            setEditingTripLog(undefined);
          }}
          onSaved={() => {
            setShowEditDialog(false);
            setEditingTripLog(undefined);
            onRefetchTripLogs();
            onRefetchAnalytics();
          }}
          canyons={canyons}
          tripLog={editingTripLog}
          customFieldDefs={customFieldDefs}
          onCustomFieldDefsChange={onCustomFieldDefsChange}
          existingTripTypes={existingTripTypes}
          onPickCoords={onPickCoords}
          onCanyonCreated={onRefetchCanyons}
        />
      )}

      {/* Create dialog */}
      <TripLogDialog
        open={showCreateDialog && !pickingCoords}
        onClose={() => setShowCreateDialog(false)}
        onSaved={() => {
          setShowCreateDialog(false);
          onRefetchTripLogs();
          onRefetchAnalytics();
          onQuotaChanged();
        }}
        canyons={canyons}
        customFieldDefs={customFieldDefs}
        onCustomFieldDefsChange={onCustomFieldDefsChange}
        existingTripTypes={existingTripTypes}
        onPickCoords={onPickCoords}
        onCanyonCreated={onRefetchCanyons}
      />
    </div>
  );
}

export default TripLogsPanel;
