import { useState, useRef, useEffect } from "react";
import { useIsMobile } from "../../useIsMobile";
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
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { ChevronRight, Minus, Plus } from "lucide-react";
import type { TCanyon, TFriend } from "../../canyonUtils";
import { bulkDeleteCanyons, shareCanyonWith } from "../../canyonUtils";
import { useToast } from "../feedback/ToastProvider";
import { messageFromError } from "../../errors/messageFromError";
import type { TExportFormat } from "../../canyonExport";
import { buildCanyonExport } from "../../canyonExport";
import classes from "./SelectedCanyonsDialog.module.css";

function SelectedCanyonsDialog({
  open,
  selectedCanyons,
  availableCanyons,
  ownedCanyonIds,
  friends,
  onClose,
  onDeleted,
  onQuotaChanged,
  onRemoveCanyon,
  onAddCanyon,
}: {
  open: boolean;
  selectedCanyons: TCanyon[];
  availableCanyons: TCanyon[];
  ownedCanyonIds: Set<string>;
  friends: TFriend[];
  onClose: () => void;
  onDeleted: () => void;
  onQuotaChanged?: () => void;
  onRemoveCanyon: (id: string) => void;
  onAddCanyon: (id: string) => void;
}) {
  const isMobile = useIsMobile();
  const [listOpen, setListOpen] = useState(false);
  const [shareSearch, setShareSearch] = useState("");
  const [shareFriendIds, setShareFriendIds] = useState<string[]>([]);
  const [sharing, setSharing] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [exportFormat, setExportFormat] = useState<TExportFormat>("gpx");
  const [canyonSearch, setCanyonSearch] = useState("");
  const canyonSearchRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  // Reset list state when dialog opens/closes
  useEffect(() => {
    if (!open) {
      setListOpen(false);
      setCanyonSearch("");
    }
  }, [open]);

  const busy = sharing || deleting;
  const ownedCanyons = selectedCanyons.filter((c) => ownedCanyonIds.has(c.id));
  const sharedCount = selectedCanyons.length - ownedCanyons.length;

  const selectedIds = new Set(selectedCanyons.map((c) => c.id));
  const canyonSearchResults =
    canyonSearch.length >= 3
      ? availableCanyons
          .filter(
            (c) =>
              !selectedIds.has(c.id) &&
              ([c.name, ...c.altNames].some((n) =>
                n.toLowerCase().includes(canyonSearch.toLowerCase()),
              )),
          )
          .slice(0, 6)
      : [];

  async function handleShare() {
    if (shareFriendIds.length === 0 || ownedCanyons.length === 0) return;
    setSharing(true);
    try {
      for (const c of ownedCanyons) {
        for (const fId of shareFriendIds) {
          try {
            await shareCanyonWith(c.id, fId);
          } catch (err) {
            console.error(err);
            toast.error(messageFromError(err, "Couldn't share one or more canyons."));
          }
        }
      }
      setShareFriendIds([]);
      onClose();
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, "Couldn't share canyons. Please try again."));
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
      await bulkDeleteCanyons(ownedCanyons.map((c) => c.id));
      setShowDeleteConfirm(false);
      onQuotaChanged?.();
      onDeleted();
      onClose();
      toast.success(`${ownedCanyons.length} canyon${ownedCanyons.length === 1 ? "" : "s"} deleted`);
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, "Couldn't delete canyons. Please try again."));
    } finally {
      setDeleting(false);
    }
  }

  function handleAddCanyonResult(id: string) {
    onAddCanyon(id);
    setCanyonSearch("");
    canyonSearchRef.current?.focus();
  }

  function handleCanyonSearchKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && canyonSearchResults.length === 1) {
      handleAddCanyonResult(canyonSearchResults[0].id);
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
        fullScreen={isMobile}
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
          <IconButton aria-label="Close dialog" size="small" onClick={onClose} disabled={busy} sx={{ color: "var(--theme-text-primary)" }}>
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
            gap: "0.75em",
          }}
        >
          {/* Canyon list accordion */}
          <Box>
            <button
              className={classes.accordionHeader}
              onClick={() => setListOpen((v) => !v)}
              aria-expanded={listOpen}
            >
              <ChevronRight
                size={14}
                className={`${classes.chevron} ${listOpen ? classes.chevronOpen : ""}`}
              />
              <span>
                View list ({selectedCanyons.length} canyon{selectedCanyons.length !== 1 ? "s" : ""}
                {sharedCount > 0 ? `, ${sharedCount} shared` : ""})
              </span>
            </button>

            {listOpen && (
              <Box className={classes.accordionBody}>
                <Box className={classes.canyonList}>
                  {selectedCanyons.map((c) => (
                    <div key={c.id} className={classes.canyonRow}>
                      <button
                        className={classes.minusButton}
                        onClick={() => onRemoveCanyon(c.id)}
                        aria-label={`Remove ${c.name}`}
                      >
                        <Minus size={12} />
                      </button>
                      <span className={classes.canyonName}>
                        <Typography variant="body2" component="span">
                          {c.name}
                        </Typography>
                        {!ownedCanyonIds.has(c.id) && (
                          <span className={classes.sharedLabel}>(shared)</span>
                        )}
                      </span>
                    </div>
                  ))}
                </Box>

                {/* Add canyon search — pinned below list */}
                <Box className={classes.searchAddRow}>
                  {canyonSearchResults.length > 0 && (
                    <Box className={classes.searchResultsDropdown}>
                      {canyonSearchResults.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          className={classes.searchResultItem}
                          onClick={() => handleAddCanyonResult(c.id)}
                        >
                          {c.name}
                          {c.altNames.length > 0 && (
                            <span className={classes.searchResultAltNames}>
                              ({c.altNames.join(", ")})
                            </span>
                          )}
                        </button>
                      ))}
                    </Box>
                  )}
                  <TextField
                    inputRef={canyonSearchRef}
                    inputProps={{ "aria-label": "Search canyons to add" }}
                    placeholder="Search canyons to add..."
                    value={canyonSearch}
                    onChange={(e) => setCanyonSearch(e.target.value)}
                    onKeyDown={handleCanyonSearchKeyDown}
                    size="small"
                    sx={{
                      flex: 1,
                      "& .MuiInputBase-input": { color: "var(--theme-text-primary)", fontSize: "0.8em" },
                      "& .MuiOutlinedInput-notchedOutline": { borderColor: "var(--theme-accent)" },
                    }}
                  />
                  <button
                    className={classes.addButton}
                    onClick={() => {
                      if (canyonSearchResults.length === 1) handleAddCanyonResult(canyonSearchResults[0].id);
                    }}
                    disabled={canyonSearchResults.length !== 1}
                    aria-label="Add canyon"
                  >
                    <Plus size={14} />
                  </button>
                </Box>
              </Box>
            )}
          </Box>

          {/* Export card */}
          <Box className={classes.actionCard}>
            <span className={classes.cardHeading}>Export</span>
            <Box className={classes.cardRow}>
              <Typography variant="body2" sx={{ whiteSpace: "nowrap" }}>
                Format:
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
              <Box className={classes.cardRowRight}>
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
                  Download
                </Button>
              </Box>
            </Box>
          </Box>

          {/* Share card */}
          <Box className={classes.actionCard}>
            <span className={classes.cardHeading}>
              Share{ownedCanyons.length > 0 ? ` (${ownedCanyons.length} owned)` : ""}
            </span>
            {ownedCanyons.length === 0 ? (
              <>
                <Typography variant="body2" className={classes.disabledText}>
                  No owned canyons in selection. Sharing applies to your own canyons only.
                </Typography>
                <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
                  <Button variant="contained" color="secondary" size="small" disabled>
                    Share
                  </Button>
                </Box>
              </>
            ) : (
              <>
                <Typography variant="body2" className={classes.shareCaveat}>
                  Recipients can copy or export shared canyons while the share
                  is active. Unsharing won&rsquo;t remove copies they&rsquo;ve
                  already made.
                </Typography>
                <TextField
                  inputProps={{ "aria-label": "Search friends to share with" }}
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
                <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
                  <Button
                    variant="contained"
                    color="secondary"
                    size="small"
                    onClick={handleShare}
                    disabled={busy || shareFriendIds.length === 0}
                  >
                    {sharing
                      ? "Sharing..."
                      : `Share with ${shareFriendIds.length > 0 ? shareFriendIds.length : ""}`
                          .trim()}
                  </Button>
                </Box>
              </>
            )}
          </Box>
        </DialogContent>

        <DialogActions>
          {ownedCanyons.length > 0 && (
            <Button
              color="error"
              onClick={() => setShowDeleteConfirm(true)}
              disabled={busy}
              sx={{ mr: "auto" }}
            >
              Delete {ownedCanyons.length} owned
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
