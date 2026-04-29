import { useState, useMemo } from "react";
import { TextField, Typography, Box } from "@mui/material";
import type { TripLogCustomFieldDef } from "@logjam/shared";
import type { TTripLog } from "../../../canyonUtils";
import TripLogViewDialog from "../../dialogs/TripLogViewDialog";
import TripLogDialog from "../../dialogs/TripLogDialog";
import classes from "./TripLogsPanel.module.css";

function TripLogsPanel({
  tripLogs,
  loading,
  onRefetchTripLogs,
  customFieldDefs,
  onCustomFieldDefsChange,
}: {
  tripLogs: TTripLog[];
  loading: boolean;
  onRefetchTripLogs: () => void;
  customFieldDefs: TripLogCustomFieldDef[];
  onCustomFieldDefsChange: (defs: TripLogCustomFieldDef[]) => void;
}) {
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [viewingTripLog, setViewingTripLog] = useState<TTripLog | null>(null);
  const [editingTripLog, setEditingTripLog] = useState<TTripLog | undefined>(undefined);
  const [showViewDialog, setShowViewDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);

  const filtered = useMemo(() => {
    return tripLogs.filter((t) => {
      if (search.trim()) {
        const q = search.toLowerCase();
        if (!t.canyon?.name.toLowerCase().includes(q)) return false;
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
      <div className={classes.filters}>
        <TextField
          placeholder="Search by canyon name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          size="small"
          fullWidth
          sx={{
            "& .MuiInputBase-input": { fontSize: "0.85em" },
          }}
        />
        <Box sx={{ display: "flex", gap: 1 }}>
          <TextField
            label="From"
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            size="small"
            fullWidth
            InputLabelProps={{ shrink: true }}
            sx={{ "& .MuiInputBase-input": { fontSize: "0.85em" } }}
          />
          <TextField
            label="To"
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            size="small"
            fullWidth
            InputLabelProps={{ shrink: true }}
            sx={{ "& .MuiInputBase-input": { fontSize: "0.85em" } }}
          />
        </Box>
      </div>

      {loading ? (
        <Typography variant="caption" sx={{ opacity: 0.6, px: 1 }}>
          Loading...
        </Typography>
      ) : filtered.length === 0 ? (
        <Typography variant="caption" sx={{ opacity: 0.6, px: 1 }}>
          {tripLogs.length === 0 ? "No trip logs yet." : "No trips match your filters."}
        </Typography>
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
                {trip.canyon?.name ?? "Unknown Canyon"}
              </span>
              <span className={classes.tripDate}>
                {new Date(trip.date).toLocaleDateString("en-AU", {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
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

      {/* View dialog */}
      <TripLogViewDialog
        open={showViewDialog}
        onClose={() => {
          setShowViewDialog(false);
          setViewingTripLog(null);
        }}
        tripLog={viewingTripLog}
        canyonName={viewingTripLog?.canyon?.name ?? ""}
        customFieldDefs={customFieldDefs}
        onEdit={() => {
          setShowViewDialog(false);
          setEditingTripLog(viewingTripLog ?? undefined);
          setViewingTripLog(null);
          setShowEditDialog(true);
        }}
        onDeleted={() => {
          onRefetchTripLogs();
        }}
      />

      {/* Edit dialog */}
      {editingTripLog && (
        <TripLogDialog
          open={showEditDialog}
          onClose={() => {
            setShowEditDialog(false);
            setEditingTripLog(undefined);
          }}
          onSaved={() => {
            setShowEditDialog(false);
            setEditingTripLog(undefined);
            onRefetchTripLogs();
          }}
          canyonId={editingTripLog.canyonId}
          canyonName={editingTripLog.canyon?.name ?? ""}
          tripLog={editingTripLog}
          customFieldDefs={customFieldDefs}
          onCustomFieldDefsChange={onCustomFieldDefsChange}
        />
      )}
    </div>
  );
}

export default TripLogsPanel;
