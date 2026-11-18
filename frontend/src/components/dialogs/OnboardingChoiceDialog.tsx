// First-login choice screen for an empty account. Non-forced: the
// user picks how to get data in, or starts empty. Nothing auto-runs.
//
// The RopeWiki load runs inline here (no separate dialog) and leaves the user in
// this welcome hub so they can also import files or start empty afterwards.
//
// The two ways in are ROWS, not a stack of buttons: each is a thing to choose
// with a sentence saying what it gets you, which is what a row carries and a
// button does not (DESIGN.md). The recommended one is the accent tile.
import { Fragment, useState } from "react";
import { plural, ROPEWIKI_OFFER, type Region, t } from "@logjam/shared";
import { importFromRopeWiki } from "../../placeUtils";
import { messageFromError } from "../../errors/messageFromError";
import {
  Button,
  Dialog,
  IconTile,
  ProgressBar,
  Row,
  ErrorBanner,
} from "../../ui";
import classes from "./OnboardingChoiceDialog.module.css";

type RegionLoad = {
  state: "idle" | "loading" | "done" | "error";
  summary: string;
  error: string | null;
};

const IDLE: RegionLoad = { state: "idle", summary: "", error: null };

function OnboardingChoiceDialog({
  open,
  canyonRegions,
  onImportFiles,
  onStartEmpty,
  onLoaded,
}: {
  open: boolean;
  /** The user's regions with a canyon list: one RopeWiki row each. */
  canyonRegions: readonly Region[];
  onImportFiles: () => void;
  onStartEmpty: () => void;
  onLoaded: () => void;
}) {
  const [loads, setLoads] = useState<Record<string, RegionLoad>>({});
  const loadOf = (region: Region) => loads[region.id] ?? IDLE;
  const setLoad = (region: Region, load: RegionLoad) =>
    setLoads((prev) => ({ ...prev, [region.id]: load }));

  async function handleLoadRopeWiki(region: Region) {
    setLoad(region, { ...IDLE, state: "loading" });
    try {
      const res = await importFromRopeWiki(region.id);
      onLoaded();
      const skipped = res.skipped + res.errors.length;
      setLoad(region, {
        ...IDLE,
        state: "done",
        summary:
          skipped > 0
            ? plural(
                res.imported,
                "# place loaded, {0} skipped",
                "# places loaded, {0} skipped",
                skipped,
              )
            : plural(res.imported, "# place loaded", "# places loaded"),
      });
    } catch (err) {
      console.error(err);
      setLoad(region, {
        ...IDLE,
        state: "error",
        error: messageFromError(
          err,
          t`Couldn't load the RopeWiki database. You can try again later from the sidebar.`,
        ),
      });
    }
  }

  const loading = canyonRegions.some((r) => loadOf(r).state === "loading");
  const loaded = canyonRegions.some((r) => loadOf(r).state === "done");

  return (
    <Dialog
      open={open}
      title={t`Welcome to Logjam`}
      // Closing without choosing IS starting empty — the hub is not a question
      // that has to be answered, and nothing moves while the load runs.
      onClose={onStartEmpty}
      dismissible={!loading}
      footer={
        <Button
          variant={loaded ? "filled" : "plain"}
          onClick={onStartEmpty}
          disabled={loading}
          disabledReason={t`Loading the place database…`}
        >
          {loaded ? t`Done` : t`Start empty`}
        </Button>
      }
    >
      <div className={classes.body}>
        <p
          className={classes.lede}
        >{t`How would you like to start? You can do any of these later, too.`}</p>

        {canyonRegions.map((region) => {
          const { state, summary, error } = loadOf(region);
          return (
            <Fragment key={region.id}>
              <Row
                title={ROPEWIKI_OFFER.title(region)}
                subtitle={
                  state === "done"
                    ? summary
                    : state === "loading"
                      ? t`Loading…`
                      : ROPEWIKI_OFFER.hint(region)
                }
                leading={
                  <IconTile
                    icon={state === "done" ? "done" : "place"}
                    hue={
                      state === "done"
                        ? "var(--color-success)"
                        : "var(--color-accent)"
                    }
                  />
                }
                // Absent, not disabled, once it has run: there is nothing left to
                // press, and the subtitle says what arrived (DESIGN.md).
                onOpen={
                  state === "done" || state === "loading"
                    ? undefined
                    : () => void handleLoadRopeWiki(region)
                }
              />
              {state === "loading" && (
                <ProgressBar
                  label={
                    canyonRegions.length > 1
                      ? t`Loading the ${region.name} RopeWiki database`
                      : t`Loading the RopeWiki database`
                  }
                />
              )}
              {error && (
                <ErrorBanner
                  message={error}
                  onRetry={() => void handleLoadRopeWiki(region)}
                  onDismiss={() => setLoad(region, IDLE)}
                />
              )}
            </Fragment>
          );
        })}

        <Row
          title={t`Import my own files`}
          subtitle={t`A place list needs name, latitude and longitude. A trip list needs a place name and a date.`}
          leading={<IconTile icon="upload" hue="var(--color-neutral)" />}
          onOpen={onImportFiles}
          disabled={loading}
        />
      </div>
    </Dialog>
  );
}

export default OnboardingChoiceDialog;
