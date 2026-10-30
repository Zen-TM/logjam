// The friends leaderboard — "how am I going against my friends this season?"
//
// Reached from the button in Friends' hero, drawn only for someone who has
// joined, and it replaces the list the way a friend's sharing audit does.
// FriendsPanel owns the fetch, so the button's badge and this page read the
// same board.
//
// PRIVACY: a joined friend is a username and a count, never which canyons; the
// payload carries nothing more (api/src/routes/leaderboard.unit.test.ts).
import { Fragment, useState, type ReactNode } from "react";
import {
  contractSectionKeys,
  LEADERBOARD,
  leaderboardCount,
  leaderboardHeroTitle,
  leaderboardNudge,
  leaderboardPodiumLine,
  leaderboardSeasonLine,
  LEADERBOARD_SETTING,
  medalFor,
  nudgeKind,
  selfStanding,
  type LeaderboardResponse,
  type Medal,
  type SectionKeysOn,
} from "@logjam/shared";
import classes from "./LeaderboardPage.module.css";
import { useStoredState } from "../../../useStoredState";
import {
  Avatar,
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  Hero,
  IconButton,
  IconTile,
  LoadingState,
  Row,
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
  const [rulesOpen, setRulesOpen] = useState(false);
  // `useStoredState` keeps every storage access in a try/catch.
  const [dismissedSeason, setDismissedSeason] = useStoredState<string | null>(
    PODIUM_DISMISSED_KEY,
    null,
  );

  const joined = board?.joined ? board : null;
  const standing = joined ? selfStanding(joined) : null;
  const nudge = joined ? nudgeKind(joined) : null;

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
            standing
              ? leaderboardHeroTitle(standing.rank, standing.size)
              : LEADERBOARD.title
          }
          onBack={onBack}
          backLabel="Back to friends"
          actions={
            <IconButton
              icon="help"
              label={copy.rulesTitle}
              onClick={() => setRulesOpen(true)}
            />
          }
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
          leading={medalTile(medalFor(podium, 2))}
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
        const medal = medalFor(entry, joined.entries.length);
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
      joined && nudge !== null ? (
        <p className={classes.nudge}>
          {nudge === "ask" ? leaderboardNudge(joined.notJoined) : copy.alone}
        </p>
      ) : null,
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
          {board && !board.joined ? (
            <EmptyState icon="leaderboard" title={LEADERBOARD_SETTING.left} />
          ) : error ? (
            <ErrorState message={error} onRetry={onRetry} />
          ) : (
            <LoadingState label={copy.loading} />
          )}
        </div>
      )}
      <Dialog
        open={rulesOpen}
        title={copy.rulesTitle}
        size="small"
        onClose={() => setRulesOpen(false)}
      >
        <ul className={classes.rules}>
          {copy.rules.split("\n").map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </Dialog>
    </div>
  );
}

/** A medal is a fill with the award glyph, its name for assistive tech. */
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
