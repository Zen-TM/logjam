// First-login choice screen for an empty account (plan §7e). Non-forced: the
// user picks how to get data in, or starts empty. Nothing auto-runs.
//
// The RopeWiki load runs inline here (no separate dialog) and leaves the user in
// this welcome hub so they can also import files or start empty afterwards.
//
// The two ways in are ROWS, not a stack of buttons: each is a thing to choose
// with a sentence saying what it gets you, which is what a row carries and a
// button does not (§5). The recommended one is the accent tile.
import { useState } from "react";
import { Check, Database, FileUp } from "lucide-react";
import { importFromRopeWiki } from "../../placeUtils";
import { messageFromError } from "../../errors/messageFromError";
import { ErrorBanner } from "../feedback/ErrorBanner";
import { Button, Dialog, IconTile, ProgressBar, Row } from "../../ui";
import classes from "./OnboardingChoiceDialog.module.css";

function OnboardingChoiceDialog({
  open,
  onImportFiles,
  onStartEmpty,
  onLoaded,
}: {
  open: boolean;
  onImportFiles: () => void;
  onStartEmpty: () => void;
  onLoaded: () => void;
}) {
  const [ropewikiState, setRopewikiState] = useState<
    "idle" | "loading" | "done" | "error"
  >("idle");
  const [loadedSummary, setLoadedSummary] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  async function handleLoadRopeWiki() {
    setRopewikiState("loading");
    setError(null);
    try {
      const res = await importFromRopeWiki();
      onLoaded();
      const skipped = res.skipped + res.errors.length;
      setLoadedSummary(
        `${res.imported} place${res.imported !== 1 ? "s" : ""} loaded` +
          (skipped > 0 ? `, ${skipped} skipped` : ""),
      );
      setRopewikiState("done");
    } catch (err) {
      console.error(err);
      setError(
        messageFromError(
          err,
          "Couldn't load the RopeWiki database. You can try again later from the sidebar.",
        ),
      );
      setRopewikiState("error");
    }
  }

  const loading = ropewikiState === "loading";
  const loaded = ropewikiState === "done";

  return (
    <Dialog
      open={open}
      title="Welcome to Logjam"
      // Closing without choosing IS starting empty — the hub is not a question
      // that has to be answered, and nothing moves while the load runs.
      onClose={onStartEmpty}
      dismissible={!loading}
      footer={
        <Button variant={loaded ? "filled" : "plain"} onClick={onStartEmpty} disabled={loading}>
          {loaded ? "Done" : "Start empty"}
        </Button>
      }
    >
      <div className={classes.body}>
        <p className={classes.lede}>How would you like to start? You can do any of these later, too.</p>

        <Row
          title="Load the NSW place database (RopeWiki)"
          subtitle={
            loaded
              ? loadedSummary
              : loading
                ? "Loading…"
                : "Recommended — hundreds of NSW canyons, so your trips have something to match against"
          }
          leading={
            <IconTile
              icon={loaded ? Check : Database}
              hue={loaded ? "var(--completed-place-color)" : "var(--theme-accent)"}
            />
          }
          // Absent, not disabled, once it has run: there is nothing left to
          // press, and the subtitle says what arrived (§7).
          onOpen={loaded || loading ? undefined : handleLoadRopeWiki}
        />
        {loading && <ProgressBar label="Loading the RopeWiki database" />}

        {error && <ErrorBanner message={error} onRetry={handleLoadRopeWiki} onDismiss={() => setError(null)} />}

        <Row
          title="Import my own files"
          subtitle="A place list needs name, latitude and longitude. A logbook needs a place name and a date."
          leading={<IconTile icon={FileUp} hue="var(--theme-bonus-1)" />}
          onOpen={onImportFiles}
          disabled={loading}
        />
      </div>
    </Dialog>
  );
}

export default OnboardingChoiceDialog;
