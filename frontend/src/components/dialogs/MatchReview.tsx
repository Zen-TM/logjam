// "Which of my places is this row talking about?" — one card per name the
// importer could not resolve on its own.
//
// A card that ASKS A QUESTION is answered inside itself (§5), so the options
// live in the card rather than in a dialog raised from it. They are native
// radios in a real `radiogroup` named by the incoming name: a set of exclusive
// choices is what a radio group is, and the platform's arrow keys, Space and
// announcement come free. The group had no accessible name before this — a
// screen reader read six unrelated "Link to …" options with nothing saying
// which name they were for.
import { useId } from "react";
import { Button, StatusPill } from "../../ui";
import classes from "./MatchReview.module.css";

// ── Types ──────────────────────────────────────────────────────────────────────

export type ReviewDecision =
  | { kind: "link"; id: string }
  | { kind: "create" }
  | { kind: "noPlace" }
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
  allowNoPlace: boolean;
  decision: ReviewDecision;
};

export type MatchReviewProps = {
  items: ReviewItem[];
  onChange: (index: number, decision: ReviewDecision) => void;
  /** Optional extra content rendered inside each item, below its options (e.g.
   * an inline create-place form for the item whose decision is "create"). */
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
  const groupId = useId();

  function handleAcceptAllGuesses(): void {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const guess = item.options.find((o) => o.isGuess);
      if (guess) {
        onChange(i, { kind: "link", id: guess.id });
      }
    }
  }

  function handleSetAllRemainingNoPlace(): void {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.allowNoPlace) continue;
      // "Remaining" = items that are still on their initial guess or have no link options
      const hasGuess = item.options.some((o) => o.isGuess);
      const isUntouched =
        isGuessDecision(item) ||
        (item.decision.kind === "noPlace" && !hasGuess) ||
        (item.decision.kind === "create" && item.options.length === 0);
      if (isUntouched) {
        onChange(i, { kind: "noPlace" });
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
  const hasAnyNoPlace = items.some((item) => item.allowNoPlace);
  const hasAnySkip = items.some((item) => item.allowSkip);

  return (
    <div className={classes.container}>
      {(hasAnyGuess || hasAnyNoPlace || hasAnySkip) && (
        <div className={classes.bulkActions}>
          {hasAnyGuess && (
            <Button variant="outline" compact onClick={handleAcceptAllGuesses}>
              Accept all guesses
            </Button>
          )}
          {hasAnyNoPlace && (
            <Button variant="plain" compact onClick={handleSetAllRemainingNoPlace}>
              Set all remaining to No place
            </Button>
          )}
          {hasAnySkip && (
            <Button variant="plain" compact onClick={handleDiscardAllRemaining}>
              Discard all remaining
            </Button>
          )}
        </div>
      )}

      {items.map((item, index) => {
        const nameId = `${groupId}-${index}-name`;
        return (
          <div key={index} className={classes.item}>
            <div id={nameId} className={classes.incomingLabel}>
              {item.incomingLabel}
            </div>
            <div className={classes.options} role="radiogroup" aria-labelledby={nameId}>
              {item.options.map((option) => {
                const selected =
                  item.decision.kind === "link" && item.decision.id === option.id;
                const radioId = `${groupId}-${index}-${option.id}`;
                return (
                  <label key={option.id} className={classes.option} htmlFor={radioId}>
                    <input
                      id={radioId}
                      className={classes.radio}
                      type="radio"
                      name={`${groupId}-${index}`}
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
                    {option.isGuess && <StatusPill label="best guess" />}
                  </label>
                );
              })}

              {item.allowCreate && (
                <label className={classes.option} htmlFor={`${groupId}-${index}-create`}>
                  <input
                    id={`${groupId}-${index}-create`}
                    className={classes.radio}
                    type="radio"
                    name={`${groupId}-${index}`}
                    checked={item.decision.kind === "create"}
                    onChange={() => onChange(index, { kind: "create" })}
                  />
                  <span className={classes.optionLabel}>Create as new place</span>
                </label>
              )}

              {item.allowNoPlace && (
                <label className={classes.option} htmlFor={`${groupId}-${index}-noplace`}>
                  <input
                    id={`${groupId}-${index}-noplace`}
                    className={classes.radio}
                    type="radio"
                    name={`${groupId}-${index}`}
                    checked={item.decision.kind === "noPlace"}
                    onChange={() => onChange(index, { kind: "noPlace" })}
                  />
                  <span className={classes.optionLabel}>No place</span>
                </label>
              )}

              {item.allowSkip && (
                <label className={classes.option} htmlFor={`${groupId}-${index}-skip`}>
                  <input
                    id={`${groupId}-${index}-skip`}
                    className={classes.radio}
                    type="radio"
                    name={`${groupId}-${index}`}
                    checked={item.decision.kind === "skip"}
                    onChange={() => onChange(index, { kind: "skip" })}
                  />
                  <span className={classes.optionLabel}>Discard</span>
                </label>
              )}
            </div>
            {renderItemExtra?.(index, item)}
          </div>
        );
      })}
    </div>
  );
}

export default MatchReview;
