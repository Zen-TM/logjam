import { useEffect, useState } from "react";
import { useIsMobile } from "../../useIsMobile";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  IconButton,
  Typography,
  Box,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { applyRopeWikiImport } from "../../canyonUtils";
import type {
  RopeWikiApplyDecision,
  RopeWikiCandidatePayload,
} from "../../canyonUtils";
import { messageFromError } from "../../errors/messageFromError";
import { ErrorBanner } from "../feedback/ErrorBanner";
import classes from "./RopeWikiReviewDialog.module.css";

type DecisionState = {
  action: "link" | "create" | "skip";
  targetCanyonId?: string;
};

function defaultDecision(row: RopeWikiCandidatePayload): DecisionState {
  const top = row.candidates[0];
  if (top && top.nameMatch && top.distanceMeters <= 1000) {
    return { action: "link", targetCanyonId: top.canyonId };
  }
  return { action: "create" };
}

function RopeWikiReviewDialog({
  open,
  review,
  onClose,
  onApplied,
}: {
  open: boolean;
  review: RopeWikiCandidatePayload[];
  onClose: () => void;
  onApplied: () => void;
}) {
  const isMobile = useIsMobile();
  const [decisions, setDecisions] = useState<Record<number, DecisionState>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const next: Record<number, DecisionState> = {};
    for (const row of review) next[row.ropeWikiId] = defaultDecision(row);
    setDecisions(next);
    setError(null);
  }, [open, review]);

  function setRow(ropeWikiId: number, value: DecisionState) {
    setDecisions((d) => ({ ...d, [ropeWikiId]: value }));
  }

  async function handleApply() {
    setSubmitting(true);
    setError(null);
    try {
      const payload: RopeWikiApplyDecision[] = review.map((row) => {
        const d = decisions[row.ropeWikiId] ?? defaultDecision(row);
        return {
          ropeWikiId: row.ropeWikiId,
          action: d.action,
          targetCanyonId: d.action === "link" ? d.targetCanyonId : undefined,
        };
      });
      await applyRopeWikiImport(payload);
      onApplied();
      onClose();
    } catch (err) {
      console.error(err);
      setError(
        messageFromError(err, "Couldn't apply RopeWiki review decisions."),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      fullScreen={isMobile}
      open={open}
      onClose={submitting ? undefined : onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          backgroundColor: "var(--theme-primary)",
          color: "var(--theme-text-primary)",
        },
      }}
    >
      <DialogTitle
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          pb: 1,
        }}
      >
        Review possible duplicates
        <IconButton
          aria-label="Close dialog"
          size="small"
          onClick={submitting ? undefined : onClose}
          disabled={submitting}
          sx={{ color: "var(--theme-text-primary)" }}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ borderColor: "rgba(255,255,255,0.1)" }}>
        <Typography className={classes.intro}>
          These RopeWiki canyons may already exist in your collection. For each
          one, pick whether to link it to an existing canyon, create it as new,
          or skip it.
        </Typography>
        {error && (
          <Box sx={{ mb: 2 }}>
            <ErrorBanner message={error} />
          </Box>
        )}
        {review.map((row) => {
          const decision = decisions[row.ropeWikiId] ?? defaultDecision(row);
          return (
            <div key={row.ropeWikiId} className={classes.row}>
              <div>
                <div className={classes.rwName}>{row.rw.name}</div>
                <div className={classes.rwCoords}>
                  RopeWiki · {row.rw.latitude.toFixed(4)},{" "}
                  {row.rw.longitude.toFixed(4)}
                </div>
              </div>
              <div className={classes.options}>
                {row.candidates.map((c) => {
                  const selected =
                    decision.action === "link" &&
                    decision.targetCanyonId === c.canyonId;
                  return (
                    <label
                      key={c.canyonId}
                      className={classes.option}
                      htmlFor={`opt-${row.ropeWikiId}-${c.canyonId}`}
                    >
                      <input
                        id={`opt-${row.ropeWikiId}-${c.canyonId}`}
                        type="radio"
                        name={`row-${row.ropeWikiId}`}
                        checked={selected}
                        onChange={() =>
                          setRow(row.ropeWikiId, {
                            action: "link",
                            targetCanyonId: c.canyonId,
                          })
                        }
                      />
                      <span className={classes.optionLabel}>
                        Link to <strong>{c.name}</strong>
                      </span>
                      <span className={classes.optionMeta}>
                        {c.distanceMeters} m
                      </span>
                      {c.nameMatch && (
                        <span className={classes.matchBadge}>name match</span>
                      )}
                    </label>
                  );
                })}
                <label
                  className={classes.option}
                  htmlFor={`opt-${row.ropeWikiId}-create`}
                >
                  <input
                    id={`opt-${row.ropeWikiId}-create`}
                    type="radio"
                    name={`row-${row.ropeWikiId}`}
                    checked={decision.action === "create"}
                    onChange={() =>
                      setRow(row.ropeWikiId, { action: "create" })
                    }
                  />
                  <span className={classes.optionLabel}>
                    Create as new canyon
                  </span>
                </label>
                <label
                  className={classes.option}
                  htmlFor={`opt-${row.ropeWikiId}-skip`}
                >
                  <input
                    id={`opt-${row.ropeWikiId}-skip`}
                    type="radio"
                    name={`row-${row.ropeWikiId}`}
                    checked={decision.action === "skip"}
                    onChange={() => setRow(row.ropeWikiId, { action: "skip" })}
                  />
                  <span className={classes.optionLabel}>Skip</span>
                </label>
              </div>
            </div>
          );
        })}
      </DialogContent>
      <DialogActions>
        <Button
          onClick={onClose}
          disabled={submitting}
          sx={{ color: "var(--theme-text-primary)" }}
        >
          Cancel
        </Button>
        <Button
          variant="contained"
          color="secondary"
          onClick={handleApply}
          disabled={submitting || review.length === 0}
        >
          {submitting ? "Applying..." : "Apply"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default RopeWikiReviewDialog;
