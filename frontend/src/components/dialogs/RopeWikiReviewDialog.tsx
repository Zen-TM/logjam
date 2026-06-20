import { useEffect, useState, useCallback } from "react";
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
import MatchReview from "./MatchReview";
import type { ReviewItem, ReviewDecision } from "./MatchReview";
import classes from "./RopeWikiReviewDialog.module.css";

// ── Adapter: RopeWikiCandidatePayload → ReviewItem ─────────────────────────

function toReviewItem(row: RopeWikiCandidatePayload): ReviewItem {
  const topCandidate = row.candidates[0];
  const topIsGuess =
    topCandidate !== undefined &&
    topCandidate.nameMatch &&
    topCandidate.distanceMeters <= 1000;

  const options = row.candidates.map((c, i) => ({
    id: c.canyonId,
    label: c.name,
    distanceMeters: c.distanceMeters,
    isGuess: i === 0 && topIsGuess,
  }));

  const decision: ReviewDecision = topIsGuess
    ? { kind: "link" as const, id: topCandidate.canyonId }
    : { kind: "create" as const };

  return {
    incomingLabel: row.rw.name,
    options,
    allowCreate: true,
    allowSkip: true,
    allowNoCanyon: false,
    decision,
  };
}

/** Map ReviewItem decisions back to the RopeWikiApplyDecision format. */
function toApplyDecision(
  row: RopeWikiCandidatePayload,
  item: ReviewItem,
): RopeWikiApplyDecision {
  const decision = item.decision;
  switch (decision.kind) {
    case "link":
      return {
        ropeWikiId: row.ropeWikiId,
        action: "link",
        targetCanyonId: decision.id,
      };
    case "create":
      return { ropeWikiId: row.ropeWikiId, action: "create" };
    case "skip":
    case "noCanyon":
      return { ropeWikiId: row.ropeWikiId, action: "skip" };
  }
}

// ── Component ──────────────────────────────────────────────────────────────────

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
}): React.JSX.Element {
  const isMobile = useIsMobile();
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setItems(review.map(toReviewItem));
    setError(null);
  }, [open, review]);

  const handleChange = useCallback(
    (index: number, decision: ReviewDecision) => {
      setItems((prev) => {
        const next = [...prev];
        next[index] = { ...next[index], decision };
        return next;
      });
    },
    [],
  );

  async function handleApply(): Promise<void> {
    setSubmitting(true);
    setError(null);
    try {
      const payload: RopeWikiApplyDecision[] = review.map((row, i) =>
        toApplyDecision(row, items[i]),
      );
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
        <MatchReview items={items} onChange={handleChange} />
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
