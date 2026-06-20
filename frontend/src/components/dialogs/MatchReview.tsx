import { Button, Box } from "@mui/material";
import classes from "./MatchReview.module.css";

// ── Types ──────────────────────────────────────────────────────────────────────

export type ReviewDecision =
  | { kind: "link"; id: string }
  | { kind: "create" }
  | { kind: "noCanyon" }
  | { kind: "skip" };

export type ReviewItemOption = {
  id: string;
  label: string;
  distanceMeters?: number;
  isGuess: boolean;
};

export type ReviewItem = {
  incomingLabel: string;
  options: ReviewItemOption[];
  allowCreate: boolean;
  allowSkip: boolean;
  allowNoCanyon: boolean;
  decision: ReviewDecision;
};

export type MatchReviewProps = {
  items: ReviewItem[];
  onChange: (index: number, decision: ReviewDecision) => void;
  /** Optional extra content rendered inside each item, below its options (e.g.
   * an inline create-canyon form for the item whose decision is "create"). */
  renderItemExtra?: (index: number, item: ReviewItem) => React.ReactNode;
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDistance(meters: number): string {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(1)} km`;
  }
  return `${Math.round(meters)} m`;
}

/** True when an item's decision is still its initial guess (a link whose option is flagged isGuess). */
function isGuessDecision(item: ReviewItem): boolean {
  if (item.decision.kind !== "link") return false;
  const guessOption = item.options.find((o) => o.isGuess);
  return guessOption !== undefined && guessOption.id === item.decision.id;
}

// ── Component ──────────────────────────────────────────────────────────────────

function MatchReview({ items, onChange, renderItemExtra }: MatchReviewProps): React.JSX.Element {
  function handleAcceptAllGuesses(): void {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const guess = item.options.find((o) => o.isGuess);
      if (guess) {
        onChange(i, { kind: "link", id: guess.id });
      }
    }
  }

  function handleSetAllRemainingNoCanyon(): void {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.allowNoCanyon) continue;
      // "Remaining" = items that are still on their initial guess or have no link options
      const hasGuess = item.options.some((o) => o.isGuess);
      const isUntouched =
        isGuessDecision(item) ||
        (item.decision.kind === "noCanyon" && !hasGuess) ||
        (item.decision.kind === "create" && item.options.length === 0);
      if (isUntouched) {
        onChange(i, { kind: "noCanyon" });
      }
    }
  }

  function handleDiscardAllRemaining(): void {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.allowSkip) continue;
      // "Remaining" = items still on their initial guess (untouched by the user).
      if (isGuessDecision(item)) {
        onChange(i, { kind: "skip" });
      }
    }
  }

  const hasAnyGuess = items.some((item) => item.options.some((o) => o.isGuess));
  const hasAnyNoCanyon = items.some((item) => item.allowNoCanyon);
  const hasAnySkip = items.some((item) => item.allowSkip);

  return (
    <div className={classes.container}>
      {(hasAnyGuess || hasAnyNoCanyon || hasAnySkip) && (
        <Box className={classes.bulkActions}>
          {hasAnyGuess && (
            <Button
              variant="outlined"
              size="small"
              onClick={handleAcceptAllGuesses}
              sx={{
                color: "var(--theme-accent)",
                borderColor: "var(--theme-accent)",
                textTransform: "none",
              }}
            >
              Accept all guesses
            </Button>
          )}
          {hasAnyNoCanyon && (
            <Button
              variant="outlined"
              size="small"
              onClick={handleSetAllRemainingNoCanyon}
              sx={{
                color: "var(--theme-text-muted)",
                borderColor: "var(--theme-text-muted)",
                textTransform: "none",
              }}
            >
              Set all remaining to No canyon
            </Button>
          )}
          {hasAnySkip && (
            <Button
              variant="outlined"
              size="small"
              onClick={handleDiscardAllRemaining}
              sx={{
                color: "var(--theme-text-muted)",
                borderColor: "var(--theme-text-muted)",
                textTransform: "none",
              }}
            >
              Discard all remaining
            </Button>
          )}
        </Box>
      )}

      {items.map((item, index) => (
        <div key={index} className={classes.item}>
          <div className={classes.incomingLabel}>{item.incomingLabel}</div>
          <div className={classes.options}>
            {item.options.map((option) => {
              const selected =
                item.decision.kind === "link" && item.decision.id === option.id;
              const radioId = `match-review-${index}-${option.id}`;
              return (
                <label key={option.id} className={classes.option} htmlFor={radioId}>
                  <input
                    id={radioId}
                    type="radio"
                    name={`match-review-${index}`}
                    checked={selected}
                    onChange={() => onChange(index, { kind: "link", id: option.id })}
                  />
                  <span className={classes.optionLabel}>
                    Link to <strong>{option.label}</strong>
                  </span>
                  {option.distanceMeters !== undefined && (
                    <span className={classes.optionMeta}>
                      {formatDistance(option.distanceMeters)}
                    </span>
                  )}
                  {option.isGuess && (
                    <span className={classes.guessBadge}>best guess</span>
                  )}
                </label>
              );
            })}

            {item.allowCreate && (
              <label
                className={classes.option}
                htmlFor={`match-review-${index}-create`}
              >
                <input
                  id={`match-review-${index}-create`}
                  type="radio"
                  name={`match-review-${index}`}
                  checked={item.decision.kind === "create"}
                  onChange={() => onChange(index, { kind: "create" })}
                />
                <span className={classes.optionLabel}>Create as new canyon</span>
              </label>
            )}

            {item.allowNoCanyon && (
              <label
                className={classes.option}
                htmlFor={`match-review-${index}-nocanyon`}
              >
                <input
                  id={`match-review-${index}-nocanyon`}
                  type="radio"
                  name={`match-review-${index}`}
                  checked={item.decision.kind === "noCanyon"}
                  onChange={() => onChange(index, { kind: "noCanyon" })}
                />
                <span className={classes.optionLabel}>No canyon</span>
              </label>
            )}

            {item.allowSkip && (
              <label
                className={classes.option}
                htmlFor={`match-review-${index}-skip`}
              >
                <input
                  id={`match-review-${index}-skip`}
                  type="radio"
                  name={`match-review-${index}`}
                  checked={item.decision.kind === "skip"}
                  onChange={() => onChange(index, { kind: "skip" })}
                />
                <span className={classes.optionLabel}>Discard</span>
              </label>
            )}
          </div>
          {renderItemExtra?.(index, item)}
        </div>
      ))}
    </div>
  );
}

export default MatchReview;
