import { useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  IconButton,
  Typography,
  Box,
  Divider,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import type { TripLogCustomFieldDef } from "@logjam/shared";
import type { TTripLog } from "../../canyonUtils";
import { useToast } from "../feedback/ToastProvider";
import { messageFromError } from "../../errors/messageFromError";
import { deleteTripLog } from "../../canyonUtils";
import classes from "./TripLogViewDialog.module.css";

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-AU", { year: "numeric", month: "long", day: "numeric" });
}

function formatFieldValue(value: unknown, type: TripLogCustomFieldDef["type"]): string {
  if (value == null || value === "") return "—";
  if (type === "boolean") return value ? "Yes" : "No";
  if (type === "date" && typeof value === "string") {
    return formatDate(value);
  }
  return String(value);
}

function TripLogViewDialog({
  open,
  onClose,
  tripLog,
  canyonName,
  customFieldDefs,
  onEdit,
  onDeleted,
}: {
  open: boolean;
  onClose: () => void;
  tripLog: TTripLog | null;
  canyonName: string;
  customFieldDefs: TripLogCustomFieldDef[];
  onEdit: () => void;
  onDeleted: () => void;
}) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const toast = useToast();

  async function handleDelete() {
    if (!tripLog) return;
    setDeleting(true);
    try {
      await deleteTripLog(tripLog.canyonId, tripLog.id);
      setShowDeleteConfirm(false);
      onDeleted();
      onClose();
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, "Couldn't delete trip log. Please try again."));
    } finally {
      setDeleting(false);
    }
  }

  if (!tripLog) return null;

  return (
    <>
      <Dialog
        open={open && !showDeleteConfirm}
        onClose={onClose}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            backgroundColor: "var(--theme-primary)",
            color: "var(--theme-text-primary)",
            maxHeight: "85vh",
          },
        }}
      >
        <DialogTitle
          sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", pb: 1 }}
        >
          <Box>
            <Typography variant="h6" component="div">
              {canyonName}
            </Typography>
            <Typography variant="body2" sx={{ color: "var(--theme-text-muted)" }}>
              {formatDate(tripLog.date)}
            </Typography>
          </Box>
          <IconButton
            size="small"
            onClick={onClose}
            sx={{ color: "var(--theme-text-primary)", mt: 0.25 }}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>

        <DialogContent dividers sx={{ borderColor: "rgba(255,255,255,0.1)" }}>
          {/* GPX / Track File placeholder */}
          <Box className={classes.section}>
            <Typography variant="caption" className={classes.sectionLabel}>
              Track File
            </Typography>
            <Typography variant="body2" sx={{ color: "var(--theme-text-muted)", fontStyle: "italic" }}>
              File uploads coming soon
            </Typography>
          </Box>

          {/* Custom field values */}
          {customFieldDefs.length > 0 && (
            <>
              <Divider sx={{ borderColor: "rgba(255,255,255,0.1)", my: 1.5 }} />
              <Box className={classes.section}>
                {customFieldDefs.map((def) => {
                  const val = tripLog.customFields[def.key];
                  return (
                    <Box key={def.key} className={classes.fieldRow}>
                      <Typography variant="body2" className={classes.fieldLabel}>
                        {def.label}
                      </Typography>
                      <Typography variant="body2">
                        {formatFieldValue(val, def.type)}
                      </Typography>
                    </Box>
                  );
                })}
              </Box>
            </>
          )}

          {/* Notes */}
          {tripLog.notes && (
            <>
              <Divider sx={{ borderColor: "rgba(255,255,255,0.1)", my: 1.5 }} />
              <Box className={classes.section}>
                <Typography variant="caption" className={classes.sectionLabel}>
                  Notes
                </Typography>
                <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                  {tripLog.notes}
                </Typography>
              </Box>
            </>
          )}

          {/* Media grid placeholder */}
          <Divider sx={{ borderColor: "rgba(255,255,255,0.1)", my: 1.5 }} />
          <Box className={classes.section}>
            <Typography variant="caption" className={classes.sectionLabel}>
              Photos &amp; Videos
            </Typography>
            <Typography variant="body2" sx={{ color: "var(--theme-text-muted)", fontStyle: "italic" }}>
              File uploads coming soon
            </Typography>
          </Box>
        </DialogContent>

        <DialogActions>
          <Button
            color="error"
            onClick={() => setShowDeleteConfirm(true)}
            sx={{ mr: "auto" }}
          >
            Delete
          </Button>
          <Button
            onClick={onClose}
            sx={{ color: "var(--theme-text-primary)" }}
          >
            Close
          </Button>
          <Button variant="contained" color="secondary" onClick={onEdit}>
            Edit
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog
        open={showDeleteConfirm}
        onClose={deleting ? undefined : () => setShowDeleteConfirm(false)}
        PaperProps={{
          sx: {
            backgroundColor: "var(--theme-primary)",
            color: "var(--theme-text-primary)",
          },
        }}
      >
        <DialogTitle>Delete Trip Log?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            This will permanently delete this trip log. This cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setShowDeleteConfirm(false)}
            disabled={deleting}
            sx={{ color: "var(--theme-text-primary)" }}
          >
            Cancel
          </Button>
          <Button
            onClick={handleDelete}
            color="error"
            variant="contained"
            disabled={deleting}
          >
            {deleting ? "Deleting..." : "Delete"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

export default TripLogViewDialog;
