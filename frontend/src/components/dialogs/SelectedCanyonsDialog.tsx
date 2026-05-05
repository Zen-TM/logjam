import { useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  DialogContentText,
  Button,
  IconButton,
  Typography,
  Box,
  TextField,
  Select,
  MenuItem,
  Divider,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import type { TCanyon, TFriend } from "../../canyonUtils";
import { deleteCanyon, shareCanyonWith } from "../../canyonUtils";
import type { TExportFormat } from "../../canyonExport";
import { buildCanyonExport } from "../../canyonExport";
import classes from "./SelectedCanyonsDialog.module.css";

function SelectedCanyonsDialog({
  open,
  selectedCanyons,
  ownedCanyonIds,
  friends,
  onClose,
  onDeleted,
}: {
  open: boolean;
  selectedCanyons: TCanyon[];
  ownedCanyonIds: Set<string>;
  friends: TFriend[];
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [shareSearch, setShareSearch] = useState("");
  const [shareFriendIds, setShareFriendIds] = useState<string[]>([]);
  const [sharing, setSharing] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [exportFormat, setExportFormat] = useState<TExportFormat>("gpx");

  const busy = sharing || deleting;
  const ownedCanyons = selectedCanyons.filter((c) => ownedCanyonIds.has(c.id));

  async function handleShare() {
    if (shareFriendIds.length === 0 || ownedCanyons.length === 0) return;
    setSharing(true);
    try {
      for (const c of ownedCanyons) {
        for (const fId of shareFriendIds) {
          try {
            await shareCanyonWith(c.id, fId);
          } catch {
            // skip duplicates / errors
          }
        }
      }
      setShareFriendIds([]);
      onClose();
    } catch {
      // ignore
    } finally {
      setSharing(false);
    }
  }

  function handleExport() {
    const { blob, filename } = buildCanyonExport(selectedCanyons, exportFormat);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      for (const c of ownedCanyons) {
        await deleteCanyon(c.id);
      }
      setShowDeleteConfirm(false);
      onDeleted();
      onClose();
    } catch {
      // ignore
    } finally {
      setDeleting(false);
    }
  }

  const dialogSx = {
    backgroundColor: "var(--theme-primary)",
    color: "var(--theme-text-primary)",
    display: "flex",
    flexDirection: "column" as const,
    maxHeight: "85vh",
  };

  const inputSx = {
    mb: 0.5,
    "& .MuiInputBase-input": { color: "var(--theme-text-primary)", fontSize: "0.85em" },
    "& .MuiInputLabel-root": { color: "var(--theme-text-muted)" },
    "& .MuiOutlinedInput-notchedOutline": { borderColor: "var(--theme-accent)" },
  };

  return (
    <>
      <Dialog
        open={open && !showDeleteConfirm}
        onClose={busy ? undefined : onClose}
        maxWidth="sm"
        fullWidth
        PaperProps={{ sx: dialogSx }}
      >
        <DialogTitle
          sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", pb: 1 }}
        >
          Selected Canyons ({selectedCanyons.length})
          <IconButton size="small" onClick={onClose} disabled={busy} sx={{ color: "var(--theme-text-primary)" }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>

        <DialogContent
          dividers
          sx={{
            borderColor: "rgba(255,255,255,0.1)",
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            flex: "1 1 auto",
            overflow: "hidden",
          }}
        >
          <Box className={classes.canyonList}>
            {selectedCanyons.map((c) => (
              <div key={c.id} className={classes.canyonRow}>
                <Typography variant="body2" component="span">
                  {c.name}
                </Typography>
                {!ownedCanyonIds.has(c.id) && (
                  <span className={classes.sharedLabel}>(shared)</span>
                )}
              </div>
            ))}
          </Box>

          <Divider sx={{ borderColor: "rgba(255,255,255,0.1)", my: 1 }} />

          <Box sx={{ display: "flex", alignItems: "center", gap: 1, pb: 0.5 }}>
            <Typography variant="body2" sx={{ whiteSpace: "nowrap" }}>
              Export {selectedCanyons.length} canyon{selectedCanyons.length !== 1 ? "s" : ""} as:
            </Typography>
            <Select
              size="small"
              value={exportFormat}
              onChange={(e) => setExportFormat(e.target.value as TExportFormat)}
              sx={{
                fontSize: "0.85em",
                color: "var(--theme-text-primary)",
                "& .MuiOutlinedInput-notchedOutline": { borderColor: "var(--theme-accent)" },
                "& .MuiSvgIcon-root": { color: "var(--theme-text-primary)" },
              }}
              MenuProps={{
                PaperProps: {
                  sx: { backgroundColor: "var(--theme-primary)", color: "var(--theme-text-primary)" },
                },
              }}
            >
              <MenuItem value="gpx">GPX</MenuItem>
              <MenuItem value="kml">KML</MenuItem>
              <MenuItem value="geojson">GeoJSON</MenuItem>
            </Select>
          </Box>

          <Divider sx={{ borderColor: "rgba(255,255,255,0.1)", my: 1 }} />

          <Box className={classes.actions}>
            {ownedCanyons.length > 0 ? (
              <>
                <Typography variant="body2" sx={{ fontWeight: "bold" }}>
                  Share {ownedCanyons.length} owned canyon{ownedCanyons.length !== 1 ? "s" : ""} with:
                </Typography>
                <TextField
                  placeholder="Search friends..."
                  value={shareSearch}
                  onChange={(e) => setShareSearch(e.target.value)}
                  size="small"
                  fullWidth
                  sx={inputSx}
                />
                {shareSearch.length > 0 && (
                  <Box>
                    {friends
                      .filter(
                        (f) =>
                          f.username.toLowerCase().includes(shareSearch.toLowerCase()) &&
                          !shareFriendIds.includes(f.id),
                      )
                      .map((friend) => (
                        <div key={friend.id} className={classes.friendSearchResultItem}>
                          <span>{friend.username}</span>
                          <button
                            className={classes.addFriendButton}
                            onClick={() => {
                              setShareFriendIds([...shareFriendIds, friend.id]);
                              setShareSearch("");
                            }}
                          >
                            Add
                          </button>
                        </div>
                      ))}
                  </Box>
                )}
                {shareFriendIds.length > 0 && (
                  <div className={classes.selectedFriendChips}>
                    {shareFriendIds.map((id) => {
                      const f = friends.find((fr) => fr.id === id);
                      if (!f) return null;
                      return (
                        <span key={id} className={classes.friendChip}>
                          {f.username}
                          <button
                            className={classes.chipRemove}
                            onClick={() => setShareFriendIds(shareFriendIds.filter((fid) => fid !== id))}
                          >
                            ✕
                          </button>
                        </span>
                      );
                    })}
                  </div>
                )}
              </>
            ) : (
              <Typography variant="body2" sx={{ opacity: 0.6 }}>
                No owned canyons in selection. Bulk actions only apply to your own canyons.
              </Typography>
            )}
          </Box>
        </DialogContent>

        <DialogActions>
          {ownedCanyons.length > 0 && (
            <>
              <Button
                variant="outlined"
                size="small"
                onClick={handleExport}
                disabled={busy}
                sx={{
                  borderColor: "var(--theme-accent)",
                  color: "var(--theme-accent)",
                  "&:hover": {
                    backgroundColor: "color-mix(in srgb, var(--theme-accent) 12%, transparent)",
                    borderColor: "var(--theme-accent)",
                  },
                }}
              >
                Export
              </Button>
              <Button
                variant="contained"
                color="secondary"
                size="small"
                onClick={handleShare}
                disabled={busy || shareFriendIds.length === 0}
              >
                {sharing ? "Sharing..." : "Share Selected"}
              </Button>
              <Button
                color="error"
                onClick={() => setShowDeleteConfirm(true)}
                disabled={busy}
                sx={{ mr: "auto", order: -1 }}
              >
                Delete Selected
              </Button>
            </>
          )}
          {ownedCanyons.length === 0 && (
            <Button
              variant="outlined"
              size="small"
              onClick={handleExport}
              disabled={busy}
              sx={{
                borderColor: "var(--theme-accent)",
                color: "var(--theme-accent)",
                "&:hover": {
                  backgroundColor: "color-mix(in srgb, var(--theme-accent) 12%, transparent)",
                  borderColor: "var(--theme-accent)",
                },
              }}
            >
              Export
            </Button>
          )}
          <Button onClick={onClose} disabled={busy} sx={{ color: "var(--theme-text-primary)" }}>
            Close
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={showDeleteConfirm}
        onClose={deleting ? undefined : () => setShowDeleteConfirm(false)}
        PaperProps={{
          sx: { backgroundColor: "var(--theme-primary)", color: "var(--theme-text-primary)" },
        }}
      >
        <DialogTitle>
          Delete {ownedCanyons.length} Canyon{ownedCanyons.length !== 1 ? "s" : ""}?
        </DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ color: "var(--theme-text-primary)" }}>
            This will permanently delete {ownedCanyons.length} canyon{ownedCanyons.length !== 1 ? "s" : ""} and all associated trip logs. This cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setShowDeleteConfirm(false)}
            disabled={deleting}
            sx={{ color: "var(--theme-text-primary)" }}
          >
            Cancel
          </Button>
          <Button onClick={handleDelete} color="error" variant="contained" disabled={deleting}>
            {deleting ? "Deleting..." : "Delete All"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

export default SelectedCanyonsDialog;
