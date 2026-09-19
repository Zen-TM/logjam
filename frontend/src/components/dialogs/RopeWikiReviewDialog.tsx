import { useEffect, useState, useCallback } from "react";
import { applyRopeWikiImport } from "../../placeUtils";
import type {
  RopeWikiApplyDecision,
  RopeWikiCandidatePayload,
} from "../../placeUtils";
import { messageFromError } from "../../errors/messageFromError";
import { ErrorBanner } from "../feedback/ErrorBanner";
import { useToast } from "../feedback/ToastProvider";
import MatchReview from "./MatchReview";
import type { ReviewItem, ReviewDecision } from "./MatchReview";
import { Button, Dialog } from "../../ui";
import classes from "./RopeWikiReviewDialog.module.css";

// ── Adapter: RopeWikiCandidatePayload → ReviewItem ─────────────────────────

function toReviewItem(row: RopeWikiCandidatePayload): ReviewItem {
  const topCandidate = row.candidates[0];
  const topIsGuess =
    topCandidate !== undefined &&
    topCandidate.nameMatch &&
    topCandidate.distanceMeters <= 1000;

  const options = row.candidates.map((c, i) => ({
    id: c.placeId,
    label: c.name,
    distanceMeters: c.distanceMeters,
    isGuess: i === 0 && topIsGuess,
  }));

  const decision: ReviewDecision = topIsGuess
    ? { kind: "link" as const, id: topCandidate.placeId }
    : { kind: "create" as const };

  return {
    incomingLabel: row.rw.name,
    options,
    allowCreate: true,
    allowSkip: true,
    allowNoPlace: false,
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
        targetPlaceId: decision.id,
      };
    case "create":
      return { ropeWikiId: row.ropeWikiId, action: "create" };
    case "skip":
    case "noPlace":
      return { ropeWikiId: row.ropeWikiId, action: "skip" };
  }
}

// ── Component ──────────────────────────────────────────────────────────────────

function RopeWikiReviewDialog({
  open,
  review,
  autoImported,
  onClose,
  onApplied,
}: {
  open: boolean;
  review: RopeWikiCandidatePayload[];
  // Counts of what the refresh already imported automatically (confident
  // non-duplicates), surfaced here so the auto-import is transparent (IMPORT-3).
  autoImported?: { added: number; autoLinked: number; updated: number };
  onClose: () => void;
  onApplied: () => void;
}): React.JSX.Element {
  const toast = useToast();
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const autoParts = [
    autoImported && autoImported.added > 0 ? `${autoImported.added} added` : null,
    autoImported && autoImported.autoLinked > 0 ? `${autoImported.autoLinked} linked to existing` : null,
    autoImported && autoImported.updated > 0 ? `${autoImported.updated} updated` : null,
  ].filter(Boolean);

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
      const result = await applyRopeWikiImport(payload);
      const parts = [
        result.created > 0 ? `${result.created} created` : null,
        result.linked > 0 ? `${result.linked} linked` : null,
        result.skipped > 0 ? `${result.skipped} skipped` : null,
      ].filter(Boolean);
      toast.success(
        parts.length > 0
          ? `Review applied: ${parts.join(", ")}.`
          : "Review applied.",
      );
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
      open={open}
      title="Review possible duplicates"
      size="large"
      dismissible={!submitting}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="filled"
            busy={submitting}
            disabled={review.length === 0}
            onClick={handleApply}
          >
            Apply
          </Button>
        </>
      }
    >
      <div className={classes.body}>
        {/* What the refresh already did, before what it is asking about: a
            count of places that appeared without being asked about is the
            first thing to account for (IMPORT-3). */}
        {autoParts.length > 0 && (
          <p className={classes.intro}>
            Already imported automatically: {autoParts.join(", ")}. The {review.length}{" "}
            below looked like places you may already have, so they were left alone.
          </p>
        )}
        <p className={classes.intro}>
          These RopeWiki places may already be in your collection. For each one, say
          whether to link it to a place you have, create it as new, or skip it.
        </p>
        {error && <ErrorBanner message={error} />}
        <MatchReview items={items} onChange={handleChange} />
      </div>
    </Dialog>
  );
}

export default RopeWikiReviewDialog;
