import { useState, useMemo } from "react";
import type { TripLogCustomFieldDef } from "@logjam/shared";
import type { TCanyon, TTripLog } from "../../../canyonUtils";
import TripLogViewDialog from "../../dialogs/TripLogViewDialog";
import TripLogDialog from "../../dialogs/TripLogDialog";
import classes from "./TripLogsPanel.module.css";

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
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [viewingTripLog, setViewingTripLog] = useState<TTripLog | null>(null);
  const [editingTripLog, setEditingTripLog] = useState<TTripLog | undefined>(undefined);
  const [showViewDialog, setShowViewDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  const filtered = useMemo(() => {
    return tripLogs.filter((t) => {
      if (search.trim()) {
        const q = search.toLowerCase();
        const nameMatch =
          t.canyon?.name.toLowerCase().includes(q) ||
          t.displayName?.toLowerCase().includes(q);
        if (!nameMatch) return false;
      }
      if (dateFrom) {
        if (new Date(t.date) < new Date(dateFrom)) return false;
      }
      if (dateTo) {
        if (new Date(t.date) > new Date(dateTo)) return false;
      }
      return true;
    });
  }, [tripLogs, search, dateFrom, dateTo]);

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
              <span className={classes.canyonName}>
                {trip.canyon?.name ?? trip.displayName ?? "No canyon"}
              </span>
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
        canyonName={viewingTripLog?.canyon?.name ?? viewingTripLog?.displayName ?? "No canyon"}
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
        onPickCoords={onPickCoords}
        onCanyonCreated={onRefetchCanyons}
      />
    </div>
  );
}

export default TripLogsPanel;
