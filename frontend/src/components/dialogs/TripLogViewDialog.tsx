import { useState, useEffect } from "react";
import { useIsMobile } from "../../useIsMobile";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Chip,
  IconButton,
  Typography,
  Box,
  Divider,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import type { TripLogCustomFieldDef, MediaItem } from "@logjam/shared";
import type { TTripLog } from "../../canyonUtils";
import { useToast } from "../feedback/ToastProvider";
import { messageFromError } from "../../errors/messageFromError";
import { deleteTripLog, getTripLog, tripTitle } from "../../canyonUtils";
import MediaGallery from "../media/MediaGallery";
import { typeChipSx } from "../../csvImport/dialogStyles";
import classes from "./TripLogViewDialog.module.css";

function formatDate(iso: string): string {
  const d = new Date(iso);
  // Trip dates (and date-typed custom fields) are stored as UTC-midnight
  // (date-only); format in UTC so AEST (UTC+10/+11) doesn't render the prior day.
  return d.toLocaleDateString("en-AU", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
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
  customFieldDefs,
  onEdit,
  onDeleted,
  canManageMedia = true,
  onMediaChanged,
}: {
  open: boolean;
  onClose: () => void;
  tripLog: TTripLog | null;
  customFieldDefs: TripLogCustomFieldDef[];
  onEdit: () => void;
  onDeleted: () => void;
  canManageMedia?: boolean;
  onMediaChanged?: () => void;
}) {
  const isMobile = useIsMobile();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [mediaLoading, setMediaLoading] = useState(false);
  const toast = useToast();

  // Fetch the trip's media (with fresh presigned URLs) whenever the dialog opens.
  // The trip passed in may come from a list that doesn't include media.
  useEffect(() => {
    if (!open || !tripLog) return;
    const { id } = tripLog;
    setMediaLoading(true);
    getTripLog(id)
      .then((full) => setMedia(full.media ?? []))
      .catch((err) => {
        console.error(err);
        toast.error(messageFromError(err, "Couldn't load trip files."));
      })
      .finally(() => setMediaLoading(false));
  }, [open, tripLog?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleMediaDeleted(id: string) {
    setMedia((prev) => prev.filter((m) => m.id !== id));
    onMediaChanged?.();
  }

  async function handleDelete() {
    if (!tripLog) return;
    setDeleting(true);
    try {
      await deleteTripLog(tripLog.id);
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
        fullScreen={isMobile}
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
              {tripTitle(tripLog)}
            </Typography>
            <Typography variant="body2" sx={{ color: "var(--theme-text-muted)" }}>
              {formatDate(tripLog.date)}
            </Typography>
          </Box>
          <IconButton
            aria-label="Close dialog"
            size="small"
            onClick={onClose}
            sx={{ color: "var(--theme-text-primary)", mt: 0.25 }}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>

        <DialogContent dividers sx={{ borderColor: "rgba(255,255,255,0.1)" }}>
          {/* Linked canyons + types. Type chips use the shared accent-fill
              styling (typeChipSx) — filled and readable in every theme, and
              visually distinct from the default-grey canyon chips (the old
              outlined-secondary chip was too dim). */}
          {(tripLog.canyons.length > 0 || tripLog.types.length > 0) && (
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, alignItems: "center" }}>
              {tripLog.canyons.map((c) => (
                <Chip key={c.id} label={c.name} size="small" />
              ))}
              {tripLog.types.map((t) => (
                <Chip key={t} label={t} size="small" sx={typeChipSx} />
              ))}
            </Box>
          )}

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

          {/* Media — photos & videos. Adding happens in the edit dialog. */}
          <Divider sx={{ borderColor: "rgba(255,255,255,0.1)", my: 1.5 }} />
          <Box className={classes.section}>
            <Typography variant="caption" className={classes.sectionLabel}>
              Photos &amp; Videos
            </Typography>
            <div className={classes.mediaScroll}>
              {mediaLoading ? (
                <Typography variant="body2" sx={{ color: "var(--theme-text-muted)", fontStyle: "italic" }}>
                  Loading files…
                </Typography>
              ) : (
                <MediaGallery
                  media={media}
                  variant="visual"
                  canDelete={canManageMedia}
                  onDeleted={handleMediaDeleted}
                  emptyText="No photos or videos yet."
                />
              )}
            </div>
          </Box>

          {/* Tracks (GPX/KML) */}
          <Divider sx={{ borderColor: "rgba(255,255,255,0.1)", my: 1.5 }} />
          <Box className={classes.section}>
            <Typography variant="caption" className={classes.sectionLabel}>
              Tracks
            </Typography>
            <div className={classes.mediaScroll}>
              {!mediaLoading && (
                <MediaGallery
                  media={media}
                  variant="tracks"
                  canDelete={canManageMedia}
                  onDeleted={handleMediaDeleted}
                  emptyText="No tracks yet."
                />
              )}
            </div>
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
