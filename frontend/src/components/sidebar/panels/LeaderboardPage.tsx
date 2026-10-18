// The friends leaderboard — "how am I going against my friends this season?"
//
// Reached from the one row Friends draws for someone who has joined, and it
// replaces the list the way a friend's sharing audit does. FriendsPanel owns
// the fetch, so the row's subtitle and this page read the same board.
//
// PRIVACY: a joined friend is a username and a count, never which canyons; the
// payload carries nothing more (api/src/routes/leaderboard.unit.test.ts).
import { Fragment, type ReactNode } from "react";
import {
  contractSectionKeys,
  LEADERBOARD,
  LEADERBOARD_ASK_MESSAGE,
  leaderboardCount,
  leaderboardHeroTitle,
  leaderboardNudge,
  leaderboardPodiumLine,
  leaderboardSeasonLine,
  medalFor,
  type LeaderboardResponse,
  type Medal,
  type SectionKeysOn,
} from "@logjam/shared";
import classes from "./LeaderboardPage.module.css";
import { useToast } from "../../feedback/ToastProvider";
import { useStoredState } from "../../../useStoredState";
import {
  Avatar,
  Button,
  ErrorState,
  Hero,
  IconTile,
  LoadingState,
  Row,
  SectionHeader,
} from "../../../ui";

const copy = LEADERBOARD.copy;

const MEDAL_HUE: Record<Medal, string> = {
  gold: "var(--hue-medal-gold)",
  silver: "var(--hue-medal-silver)",
  bronze: "var(--hue-medal-bronze)",
};

/** Per device, and holds the season it was dismissed for, so next year's
 *  finish shows again. */
const PODIUM_DISMISSED_KEY = "logjam.leaderboard.podiumDismissed";

function LeaderboardPage({
  board,
  error,
  onRetry,
  onBack,
}: {
  /** `null` while the first load is out. */
  board: LeaderboardResponse | null;
  error: string | null;
  onRetry: () => void;
  onBack: () => void;
}) {
  const toast = useToast();
  // `useStoredState` keeps every storage access in a try/catch.
  const [dismissedSeason, setDismissedSeason] = useStoredState<string | null>(
    PODIUM_DISMISSED_KEY,
    null,
  );

  const joined = board?.joined ? board : null;
  const self = joined?.entries.find((entry) => entry.isSelf);
  const size = joined?.entries.length ?? 0;

  async function handleAsk() {
    try {
      await navigator.clipboard.writeText(LEADERBOARD_ASK_MESSAGE);
      toast.success(copy.askCopied);
    } catch (err) {
      console.error(err);
      toast.error(copy.askCopyFailed);
    }
  }

  // Exhaustive by type: a section the contract names and this page does not
  // draw, or the reverse, fails `tsc` (`LEADERBOARD`, shared/src/contracts).
  const page: Record<
    SectionKeysOn<typeof LEADERBOARD, "web">,
    () => ReactNode
  > = {
    hero: () => (
      <>
        <Hero
          title={
            self ? leaderboardHeroTitle(self.rank, size) : LEADERBOARD.title
          }
          onBack={onBack}
          backLabel="Back to friends"
        />
        {joined && (
          <p className={classes.season}>
            {leaderboardSeasonLine(joined.season)}
          </p>
        )}
      </>
    ),
    podium: () => {
      const podium = joined?.podium;
      return podium && dismissedSeason !== podium.season ? (
        <Row
          leading={medalTile(medalFor(podium.rank, 2))}
          title={leaderboardPodiumLine(podium)}
          trailing={
            <Button
              compact
              variant="outline"
              onClick={() => setDismissedSeason(podium.season)}
            >
              {copy.podiumDismiss}
            </Button>
          }
        />
      ) : null;
    },
    board: () =>
      joined?.entries.map((entry) => {
        const medal = medalFor(entry.rank, size);
        return (
          <Row
            key={entry.userId}
            leading={<Avatar username={entry.username} />}
            title={entry.username}
            subtitle={entry.isSelf ? copy.you : undefined}
            trailing={
              <span className={classes.place}>
                <span className={classes.count}>
                  {leaderboardCount(entry.canyonCount)}
                </span>
                {medalTile(medal)}
                <span className={classes.rank}>#{entry.rank}</span>
              </span>
            }
          />
        );
      }),
    nudge: () =>
      !joined ? null : joined.notJoined.length > 0 ? (
        <div className={classes.nudge}>
          <p className={classes.note}>{leaderboardNudge(joined.notJoined)}</p>
          <Button
            variant="outline"
            icon="copy"
            onClick={() => void handleAsk()}
          >
            {copy.askFriends}
          </Button>
        </div>
      ) : size < 2 ? (
        <div className={classes.nudge}>
          <p className={classes.note}>{copy.alone}</p>
        </div>
      ) : null,
    rules: () => (
      <section className={classes.rulesSection}>
        <SectionHeader title={copy.rulesTitle} />
        <ul className={classes.rules}>
          {copy.rules.split("\n").map((rule) => (
            <li key={rule} className={classes.note}>
              {rule}
            </li>
          ))}
        </ul>
      </section>
    ),
  };

  const keys = contractSectionKeys(LEADERBOARD, "web");
  const render = (key: (typeof keys)[number]) => (
    <Fragment key={key}>{page[key]()}</Fragment>
  );

  return (
    <div className={classes.root}>
      {render("hero")}
      {joined ? (
        <div className={classes.list}>
          {keys.filter((key) => key !== "hero").map(render)}
        </div>
      ) : (
        <div className={classes.emptyArea}>
          {error ? (
            <ErrorState message={error} onRetry={onRetry} />
          ) : (
            <LoadingState label={copy.loading} />
          )}
        </div>
      )}
    </div>
  );
}

/** A medal is a fill with the award glyph, its name for assistive tech. A
 *  podium is ranks 1–3, so last season's finish always has one. */
function medalTile(medal: Medal | null) {
  return (
    medal && (
      <IconTile
        icon="leaderboard"
        hue={MEDAL_HUE[medal]}
        label={`${medal} medal`}
      />
    )
  );
}

export default LeaderboardPage;
