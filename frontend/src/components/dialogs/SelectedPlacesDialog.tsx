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
import type { TPlace, TFriend } from "../../placeUtils";
import { bulkDeletePlaces, sharePlaceWith } from "../../placeUtils";
import { useToast } from "../feedback/ToastProvider";
import { messageFromError } from "../../errors/messageFromError";
import type { TExportFormat } from "../../placeExport";
import { buildPlaceExport } from "../../placeExport";
import { fieldSx, selectSx, menuPaperProps } from "../../csvImport/dialogStyles";
import classes from "./SelectedPlacesDialog.module.css";

function SelectedPlacesDialog({
  open,
  selectedPlaces,
  availablePlaces,
  ownedPlaceIds,
  friends,
  onClose,
  onDeleted,
  onQuotaChanged,
  onRemovePlace,
  onAddPlace,
}: {
  open: boolean;
  selectedPlaces: TPlace[];
  availablePlaces: TPlace[];
  ownedPlaceIds: Set<string>;
  friends: TFriend[];
  onClose: () => void;
  onDeleted: () => void;
  onQuotaChanged?: () => void;
  onRemovePlace: (id: string) => void;
  onAddPlace: (id: string) => void;
}) {
  const isMobile = useIsMobile();
  const [listOpen, setListOpen] = useState(false);
  const [shareSearch, setShareSearch] = useState("");
  const [shareFriendIds, setShareFriendIds] = useState<string[]>([]);
  const [sharing, setSharing] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [exportFormat, setExportFormat] = useState<TExportFormat>("gpx");
  const [placeSearch, setPlaceSearch] = useState("");
  const placeSearchRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  // Reset list state when dialog opens/closes
  useEffect(() => {
    if (!open) {
      setListOpen(false);
      setPlaceSearch("");
    }
  }, [open]);

  const busy = sharing || deleting;
  const ownedPlaces = selectedPlaces.filter((c) => ownedPlaceIds.has(c.id));
  const sharedCount = selectedPlaces.length - ownedPlaces.length;

  const selectedIds = new Set(selectedPlaces.map((c) => c.id));
  const placeSearchResults =
    placeSearch.length >= 3
      ? availablePlaces
          .filter(
            (c) =>
              !selectedIds.has(c.id) &&
              ([c.name, ...c.altNames].some((n) =>
                n.toLowerCase().includes(placeSearch.toLowerCase()),
              )),
          )
          .slice(0, 6)
      : [];

  async function handleShare() {
    if (shareFriendIds.length === 0 || ownedPlaces.length === 0) return;
    setSharing(true);
    try {
      for (const c of ownedPlaces) {
        for (const fId of shareFriendIds) {
          try {
            await sharePlaceWith(c.id, fId);
          } catch (err) {
            console.error(err);
            toast.error(messageFromError(err, "Couldn't share one or more places."));
          }
        }
      }
      setShareFriendIds([]);
      onClose();
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, "Couldn't share places. Please try again."));
    } finally {
      setSharing(false);
    }
  }

  function handleExport() {
    const { blob, filename } = buildPlaceExport(selectedPlaces, exportFormat);
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
      await bulkDeletePlaces(ownedPlaces.map((c) => c.id));
      setShowDeleteConfirm(false);
      onQuotaChanged?.();
      onDeleted();
      onClose();
      toast.success(`${ownedPlaces.length} place${ownedPlaces.length === 1 ? "" : "s"} deleted`);
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, "Couldn't delete places. Please try again."));
    } finally {
      setDeleting(false);
    }
  }

  function handleAddPlaceResult(id: string) {
    onAddPlace(id);
    setPlaceSearch("");
    placeSearchRef.current?.focus();
  }

  function handlePlaceSearchKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && placeSearchResults.length === 1) {
      handleAddPlaceResult(placeSearchResults[0].id);
    }
  }

  const dialogSx = {
    backgroundColor: "var(--theme-primary)",
    color: "var(--theme-text-primary)",
    display: "flex",
    flexDirection: "column" as const,
    maxHeight: isMobile ? "100%" : "85vh",
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
          Selected Places ({selectedPlaces.length})
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
          {/* Place list accordion */}
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
                View list ({selectedPlaces.length} place{selectedPlaces.length !== 1 ? "s" : ""}
                {sharedCount > 0 ? `, ${sharedCount} shared` : ""})
              </span>
            </button>

            {listOpen && (
              <Box className={classes.accordionBody}>
                <Box className={classes.placeList}>
                  {selectedPlaces.map((c) => (
                    <div key={c.id} className={classes.placeRow}>
                      <button
                        className={classes.minusButton}
                        onClick={() => onRemovePlace(c.id)}
                        aria-label={`Remove ${c.name}`}
                      >
                        <Minus size={12} />
                      </button>
                      <span className={classes.placeName}>
                        <Typography variant="body2" component="span">
                          {c.name}
                        </Typography>
                        {!ownedPlaceIds.has(c.id) && (
                          <span className={classes.sharedLabel}>(shared)</span>
                        )}
                      </span>
                    </div>
                  ))}
                </Box>

                {/* Add place search — pinned below list */}
                <Box className={classes.searchAddRow}>
                  {placeSearchResults.length > 0 && (
                    <Box className={classes.searchResultsDropdown}>
                      {placeSearchResults.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          className={classes.searchResultItem}
                          onClick={() => handleAddPlaceResult(c.id)}
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
                    inputRef={placeSearchRef}
                    inputProps={{ "aria-label": "Search places to add" }}
                    placeholder="Search places to add..."
                    value={placeSearch}
                    onChange={(e) => setPlaceSearch(e.target.value)}
                    onKeyDown={handlePlaceSearchKeyDown}
                    size="small"
                    sx={{ ...fieldSx, flex: 1 }}
                  />
                  <button
                    className={classes.addButton}
                    onClick={() => {
                      if (placeSearchResults.length === 1) handleAddPlaceResult(placeSearchResults[0].id);
                    }}
                    disabled={placeSearchResults.length !== 1}
                    aria-label="Add place"
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
                sx={selectSx}
                MenuProps={menuPaperProps}
              >
                <MenuItem value="gpx">GPX</MenuItem>
                <MenuItem value="kml">KML</MenuItem>
                <MenuItem value="geojson">GeoJSON</MenuItem>
                <MenuItem value="csv">CSV</MenuItem>
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
              Share{ownedPlaces.length > 0 ? ` (${ownedPlaces.length} owned)` : ""}
            </span>
            {ownedPlaces.length === 0 ? (
              <>
                <Typography variant="body2" className={classes.disabledText}>
                  No owned places in selection. Sharing applies to your own places only.
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
                  Recipients can copy or export shared places while the share
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
                  sx={{ ...fieldSx, mb: 0.5 }}
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
          {ownedPlaces.length > 0 && (
            <Button
              color="error"
              onClick={() => setShowDeleteConfirm(true)}
              disabled={busy}
              sx={{ mr: "auto" }}
            >
              Delete {ownedPlaces.length} owned
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
          Delete {ownedPlaces.length} Place{ownedPlaces.length !== 1 ? "s" : ""}?
        </DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ color: "var(--theme-text-primary)" }}>
            This permanently deletes {ownedPlaces.length} place{ownedPlaces.length !== 1 ? "s" : ""}, along with their photos, tracks, and shares. Your trip logs are kept — they&rsquo;ll be unlinked from these places but stay in your logbook. This cannot be undone.
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

export default SelectedPlacesDialog;
