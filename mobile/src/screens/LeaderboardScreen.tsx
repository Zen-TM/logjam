// Leaderboard — "how am I going against my friends this season?", pushed from
// the button Friends' hero draws for someone who has joined. Drawn from `LEADERBOARD`
// (shared/src/contracts/leaderboard.ts); every number is the server's.
//
// Online only, like Friends. A guest is gated before any fetch
// (`capabilityScreenBlock`); offline with nothing loaded says so and fetches
// nothing until the connection is back. A board already on screen stays when
// the signal drops.
//
// PRIVACY: usernames and counts only. The server never sends which canyons.
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import {
  contractSectionKeys,
  LEADERBOARD,
  LEADERBOARD_SETTING,
  leaderboardCount,
  leaderboardHeroTitle,
  leaderboardNudge,
  leaderboardPodiumLine,
  leaderboardSeasonLine,
  medalFor,
  messageFromError,
  nudgeKind,
  selfStanding,
  type LeaderboardBoard as Board,
  type LeaderboardResponse,
  type LeaderboardRow,
  type SectionKeysOn,
} from "@logjam/shared";

import { getLeaderboard } from "../api/friends";
import { useAccountState } from "../auth/AccountStateContext";
import { capabilityScreenBlock } from "../auth/capabilities";
import { useConnectivity } from "../map/connectivity";
import { makeStyles, muted, spacing, useHues, useTheme } from "../theme";
import {
  Avatar,
  BottomSheet,
  Button,
  EmptyState,
  ErrorBanner,
  ErrorState,
  Hero,
  IconButton,
  IconTile,
  LoadingState,
  Row,
  Toast,
  type ToastMessage,
} from "../ui";
import { dismissPodium, isPodiumDismissed } from "./leaderboard";

const copy = LEADERBOARD.copy;

type SectionProps = {
  board: Board;
  /** The podium card is drawn: the server sent one and this phone has not
   *  dismissed it. */
  podiumShown: boolean;
  onBack: () => void;
  backLabel: string;
  onDismissPodium: () => void;
  onOpenRules: () => void;
};

/** One drawing per contract section; `tsc` and `leaderboardContracts.test.ts`
 *  hold the set. */
export const LEADERBOARD_SECTIONS: Record<
  SectionKeysOn<typeof LEADERBOARD, "gps">,
  (props: SectionProps) => ReactNode
> = {
  hero: ({ board, onBack, backLabel, onOpenRules }) => {
    const { rank, size } = selfStanding(board);
    return (
      <Hero
        title={leaderboardHeroTitle(rank, size)}
        value={leaderboardSeasonLine(board.season)}
        onBack={onBack}
        backLabel={backLabel}
        actions={
          <IconButton
            icon="help"
            accessibilityLabel={copy.rulesTitle}
            onPress={onOpenRules}
          />
        }
      />
    );
  },
  podium: ({ board, podiumShown, onDismissPodium }) =>
    board.podium && podiumShown ? (
      <Podium podium={board.podium} onDismiss={onDismissPodium} />
    ) : null,
  board: ({ board }) => (
    <>
      {board.entries.map((entry) => (
        <BoardRow
          key={entry.userId}
          entry={entry}
          boardSize={board.entries.length}
        />
      ))}
    </>
  ),
  nudge: ({ board }) => <Nudge board={board} />,
};

export function LeaderboardScreen({
  onBack,
  backLabel,
}: {
  onBack: () => void;
  backLabel: string;
}) {
  const theme = useTheme();
  const styles = useStyles();

  const { accountState } = useAccountState();
  const guestBlock = useMemo(
    () => capabilityScreenBlock("friends", accountState),
    [accountState],
  );
  const online = useConnectivity() === "online";

  const [response, setResponse] = useState<LeaderboardResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const load = useCallback(async () => {
    if (guestBlock || !online) return;
    await getLeaderboard()
      .then((next) => {
        setResponse(next);
        setLoadError(null);
      })
      .catch((err: unknown) => {
        console.error(err);
        setLoadError(messageFromError(err, copy.loadFailed));
      });
  }, [guestBlock, online]);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const season = response?.joined ? response.podium?.season : undefined;
  const [dismissedNow, setDismissedNow] = useState<string | null>(null);
  // Read once per season, not per render: it is a synchronous store read.
  const storedDismissal = useMemo(
    () => season !== undefined && isPodiumDismissed(season),
    [season],
  );
  const podiumShown =
    season !== undefined && season !== dismissedNow && !storedDismissal;
  const onDismissPodium = useCallback(() => {
    if (season === undefined) return;
    if (!dismissPodium(season)) {
      setToast({
        text: "This phone wouldn't store that setting.",
        tone: "error",
        nonce: Date.now(),
      });
    }
    // Hidden for this visit either way: the press asked for it gone.
    setDismissedNow(season);
  }, [season]);

  const [rulesOpen, setRulesOpen] = useState(false);

  // Every state but the board keeps a hero, so the back arrow is always there.
  const gate = (body: ReactNode) => (
    <View style={styles.root}>
      <Hero title={LEADERBOARD.title} onBack={onBack} backLabel={backLabel} />
      {body}
    </View>
  );
  if (guestBlock) {
    return gate(<EmptyState title={guestBlock.title} hint={guestBlock.hint} />);
  }
  if (response === null) {
    if (!online) return gate(<EmptyState title={copy.offline} />);
    if (loadError) {
      return gate(
        <ErrorState message={loadError} onRetry={() => void load()} />,
      );
    }
    return gate(<LoadingState label={copy.loading} />);
  }
  // Left on another device since Friends drew the row.
  if (!response.joined)
    return gate(<EmptyState title={LEADERBOARD_SETTING.left} />);

  const props: SectionProps = {
    board: response,
    podiumShown,
    onBack,
    backLabel,
    onDismissPodium,
    onOpenRules: () => setRulesOpen(true),
  };
  const [hero, ...rest] = contractSectionKeys(LEADERBOARD, "gps");
  return (
    <View style={styles.root}>
      {/* The hero is pinned; everything under it scrolls (shared/DESIGN.md §2). */}
      {LEADERBOARD_SECTIONS[hero](props)}
      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void onRefresh()}
            tintColor={theme.accent}
          />
        }
      >
        {loadError ? (
          <ErrorBanner message={loadError} onRetry={() => void load()} />
        ) : null}
        {rest.map((key) => (
          <Fragment key={key}>{LEADERBOARD_SECTIONS[key](props)}</Fragment>
        ))}
      </ScrollView>
      <BottomSheet
        visible={rulesOpen}
        onClose={() => setRulesOpen(false)}
        title={copy.rulesTitle}
      >
        <View style={styles.rules}>
          {copy.rules.split("\n").map((rule) => (
            <Text key={rule} style={styles.rule}>
              {rule}
            </Text>
          ))}
        </View>
      </BottomSheet>
      <Toast message={toast} onDismissed={() => setToast(null)} />
    </View>
  );
}

function Podium({
  podium,
  onDismiss,
}: {
  podium: NonNullable<Board["podium"]>;
  onDismiss: () => void;
}) {
  const { medalHue } = useHues();
  const medal = medalFor(podium, 2);
  return (
    <Row
      icon="leaderboard"
      hue={medal ? medalHue[medal] : undefined}
      title={leaderboardPodiumLine(podium)}
      titleNumberOfLines={0}
      right={
        <Button
          label={copy.podiumDismiss}
          variant="ghost"
          compact
          onPress={onDismiss}
        />
      }
    />
  );
}

/** Read-only: a friend's row opens nothing, since there is nothing more of
 *  theirs to see. The medal travels with "#rank", so colour is never the only
 *  signal (shared/DESIGN.md §7). Composed as Logjam Web's board row is. */
function BoardRow({
  entry,
  boardSize,
}: {
  entry: LeaderboardRow;
  boardSize: number;
}) {
  const { medalHue } = useHues();
  const styles = useStyles();
  const medal = medalFor(entry, boardSize);
  const count = leaderboardCount(entry.canyonCount);
  return (
    <Row
      leading={<Avatar username={entry.username} />}
      title={entry.username}
      subtitle={entry.isSelf ? copy.you : undefined}
      accessibilityLabel={[
        `#${entry.rank}`,
        entry.username,
        entry.isSelf ? copy.you : null,
        count,
        medal ? `${medal} medal` : null,
      ]
        .filter(Boolean)
        .join(", ")}
      right={
        <View style={styles.place}>
          <Text style={styles.count}>{count}</Text>
          {medal ? <IconTile icon="leaderboard" hue={medalHue[medal]} /> : null}
          <Text style={styles.rank}>#{entry.rank}</Text>
        </View>
      }
    />
  );
}

function Nudge({ board }: { board: Board }) {
  const styles = useStyles();
  const kind = nudgeKind(board);
  if (kind === null) return null;
  return (
    <Text style={[styles.note, styles.nudge]}>
      {kind === "ask" ? leaderboardNudge(board.notJoined) : copy.alone}
    </Text>
  );
}

const useStyles = makeStyles((theme, textRole) => ({
  root: { flex: 1, backgroundColor: theme.page },
  list: { flex: 1 },
  listContent: {
    paddingHorizontal: spacing(2),
    paddingTop: spacing(1.5),
    gap: spacing(1),
    paddingBottom: spacing(4),
  },
  place: { flexDirection: "row", alignItems: "center", gap: spacing(1) },
  count: { ...textRole.body, color: theme.text },
  rank: { ...textRole.rowTitle, color: theme.text },
  nudge: { paddingTop: spacing(1) },
  note: { ...muted(theme, textRole.paragraph) },
  rules: { gap: spacing(1.5), paddingBottom: spacing(2) },
  rule: { ...textRole.paragraph, color: theme.text },
}));
