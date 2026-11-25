import { useState } from "react";
import {
  REGION_CHOICE,
  regionChoiceProblem,
  REGIONS,
  toggleRegion,
  type Region,
} from "@logjam/shared";
import { messageFromError } from "../errors/messageFromError";
import { updateUserPreferences, type TUser } from "../placeUtils";
import BrandMark from "./brand/BrandMark";
import { Button, Checkbox, ErrorBanner } from "../ui";
import classes from "./ConsentGate.module.css";

/**
 * Full-screen "Where do you canyon?" step for a new account, shown by
 * ConsentGate (provider sign-up) and by App (Logjam Web's own sign-up form)
 * once the terms are recorded and there is more than one region to choose.
 */
function RegionStep({
  onDone,
  onSignOut,
  regions = REGIONS,
}: {
  onDone: (user: TUser) => void;
  onSignOut: () => void;
  /** The regions to ask about; only a test passes more than the real ones. */
  regions?: readonly Region[];
}) {
  const [chosen, setChosen] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleContinue(): Promise<void> {
    // Pressing Continue is how the user learns what is missing (shared/DESIGN.md §5).
    const problem = regionChoiceProblem(chosen);
    if (problem) {
      setError(problem);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      onDone(await updateUserPreferences({ regions: chosen }));
    } catch (err) {
      console.error(err);
      setError(messageFromError(err, REGION_CHOICE.saveFailed));
      setSubmitting(false);
    }
  }

  return (
    <div className={classes.container}>
      <div className={classes.card}>
        <BrandMark className={classes.brandMark} />
        <h1 className={classes.title}>{REGION_CHOICE.title}</h1>
        <p className={classes.body}>{REGION_CHOICE.hint}</p>
        {regions.map((region) => (
          <Checkbox
            key={region.id}
            label={region.name}
            checked={chosen.includes(region.id)}
            onChange={() => {
              setChosen((prev) => toggleRegion(prev, region.id, regions));
              setError(null);
            }}
          />
        ))}
        {error && (
          <ErrorBanner
            message={error}
            onRetry={chosen.length > 0 ? handleContinue : undefined}
          />
        )}
        <Button
          variant="filled"
          className={classes.action}
          onClick={handleContinue}
          busy={submitting}
        >
          {REGION_CHOICE.continue}
        </Button>
        <Button
          className={classes.action}
          onClick={onSignOut}
          disabled={submitting}
          disabledReason="Saving your regions…"
        >
          Sign out
        </Button>
      </div>
    </div>
  );
}

export default RegionStep;
