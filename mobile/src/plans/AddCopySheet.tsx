// Add a copy (`PLAN_ADD_VERBS`): the caller's own places, ways and files,
// ticked, each sent into the plan as a copy, one request each
// (POST /plans/:id/items), in list order. What is offered is
// `addableFromMirror`: the caller's own, on the server, less what a ticked
// place brings. Everyone in the plan can keep a copy of what is added
// (`addCopyLine`), and the files count against the adder's storage
// (`tripPlanAddCopyPriceLine`). Logjam Web's twin is
// frontend/src/components/plans/PlanAddCopyDialog.tsx. Online only.
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Text, TextInput, View } from "react-native";
import {
  formatBytes,
  mediaDisplayName,
  messageFromError,
  placeMatchesSearch,
  planAddVerbLabel,
  tripPlanAddCopiesLabel,
  tripPlanAddCopyPriceLine,
  tripPlanAddOutcome,
  tripPlanAddKey,
  tripPlanAddPicks,
  tripPlanInPlanIds,
  TRIP_PLAN_ITEM_GROUPS,
  TRIP_PLAN_PAGE,
  type TripPlanItemKind,
  type TripPlanItemGroup,
  type TripPlanView,
} from "@logjam/shared";

import { fetchCurrentUser, useApiQuery } from "../api/queries";
import { unavailableReasonText } from "../auth/capabilities";
import { listStandaloneMedia, type MirrorMedia } from "../sync/mirrorStore";
import {
  useMirrorPlaces,
  useMirrorRoutes,
  usePendingCreateIds,
} from "../sync/useSyncQueries";
import {
  controlSize,
  makeStyles,
  muted,
  placeholderColor,
  radius,
  spacing,
  useHues,
  useTheme,
} from "../theme";
import {
  BottomSheet,
  Button,
  ChipRail,
  EmptyState,
  ErrorBanner,
  Icon,
  ErrorState,
  LoadingState,
  Row,
  SelectionMark,
} from "../ui";
import type { Glyph } from "../ui";
import { addableFromMirror } from "./addable";
import { addPlanItem } from "./plansApi";
import { afterPlanWrite } from "./plansCache";

const copy = TRIP_PLAN_PAGE.copy;
const OFFLINE = unavailableReasonText("needs-connection");

type Pick = {
  kind: TripPlanItemKind;
  id: string;
  title: string;
  bytes: number;
  altNames?: string[];
  icon: Glyph;
  hue?: string;
  inPlan?: boolean;
};
const keyOf = tripPlanAddKey;

export function AddCopySheet({
  plan,
  visible,
  online,
  me,
  onClose,
  onDone,
}: {
  plan: TripPlanView;
  visible: boolean;
  /** The caller's user id: only their own routes are theirs to add. */
  me: string | null;
  online: boolean;
  onClose: () => void;
  onDone: (message: string, tone: "info" | "error") => void;
}) {
  const theme = useTheme();
  const { assetHue } = useHues();
  const styles = useStyles();
  const places = useMirrorPlaces();
  const routes = useMirrorRoutes();
  const pendingCreates = usePendingCreateIds();
  const user = useApiQuery(fetchCurrentUser, copy.addCopyFailed, visible);
  const [files, setFiles] = useState<MirrorMedia[]>([]);
  const [group, setGroup] = useState<TripPlanItemGroup>("places");
  const [ticked, setTicked] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Files are the mirror's imports and recordings.
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    void Promise.all([
      listStandaloneMedia("import"),
      listStandaloneMedia("track"),
    ])
      .then(([imports, tracks]) => {
        if (alive) setFiles([...imports, ...tracks]);
      })
      .catch(console.error);
    return () => {
      alive = false;
    };
  }, [visible]);

  const [openedFor, setOpenedFor] = useState(false);
  if (visible !== openedFor) {
    setOpenedFor(visible);
    if (visible) {
      setTicked([]);
      setSearch("");
      setGroup("places");
      setError(null);
    }
  }

  const tickedKeys = useMemo(() => new Set(ticked), [ticked]);
  const tickedPlaceIds = useMemo(
    () =>
      ticked
        .filter((key) => key.startsWith("place:"))
        .map((key) => key.slice("place:".length)),
    [ticked],
  );
  const offered = useMemo(
    () =>
      addableFromMirror(
        {
          places: places.data ?? [],
          routes: routes.data ?? [],
          files,
        },
        { me, pendingCreates, tickedPlaceIds },
      ),
    [places.data, routes.data, files, me, pendingCreates, tickedPlaceIds],
  );
  // Items don't record their source, so "already in the plan" is a match on
  // name and position (`tripPlanInPlanIds`).
  const inPlan = useMemo(
    () => tripPlanInPlanIds(plan, offered),
    [plan, offered],
  );
  const rows = useMemo(
    (): Record<TripPlanItemGroup, Pick[]> => ({
      // Places keep the accent, as the plan's own list does.
      places: offered.places.map((place) => ({
        kind: "place",
        id: place.id,
        title: place.name,
        altNames: place.altNames,
        bytes: 0,
        icon: "place",
        inPlan: inPlan.has(place.id),
      })),
      ways: [
        ...offered.routes.map((route) => ({
          kind: "route" as const,
          id: route.id,
          title: route.name,
          bytes: 0,
          icon: "route" as const,
          hue: assetHue.route,
          inPlan: inPlan.has(route.id),
        })),
        ...offered.files.map((file) => ({
          kind: "media" as const,
          id: file.id,
          title: mediaDisplayName(file),
          bytes: file.fileSizeBytes ?? 0,
          inPlan: inPlan.has(file.id),
          // A recording and an import look as they do in Saved.
          ...(file.origin === "track"
            ? { icon: "track" as const, hue: assetHue.track }
            : { icon: "importedFile" as const, hue: assetHue.import }),
        })),
      ],
    }),
    [offered, assetHue, inPlan],
  );
  // What is sent: ticks still offered, in list order (`tripPlanAddPicks`).
  const picks = tripPlanAddPicks(
    [...rows.places, ...rows.ways].filter((each) => !each.inPlan),
    ticked,
  );
  const toggle = useCallback(
    (key: string) =>
      setTicked((was) =>
        was.includes(key) ? was.filter((each) => each !== key) : [...was, key],
      ),
    [],
  );
  const priceLine = tripPlanAddCopyPriceLine({
    bytes: picks.reduce((sum, each) => sum + each.bytes, 0),
    placesPicked: picks.some((each) => each.kind === "place"),
    quotaBytes: user.data?.storageQuotaBytes ?? null,
    usedBytes: user.data?.storageUsedBytes ?? null,
  });

  async function add() {
    if (picks.length === 0) return setError(copy.nothingTicked);
    setBusy(true);
    setError(null);
    let added = 0;
    let skipped = 0;
    let outOfSpace = false;
    let why: string | null = null;
    try {
      for (const pick of picks) {
        const result = await addPlanItem(plan.id, {
          kind: pick.kind,
          id: pick.id,
        });
        added += 1;
        skipped += result.mediaSkipped ?? 0;
        outOfSpace ||= result.mediaOutOfSpace === true;
      }
    } catch (err) {
      why = messageFromError(err, copy.addCopyFailed);
    }
    const outcome = tripPlanAddOutcome({
      added,
      asked: picks.length,
      skipped,
      outOfSpace,
      why,
    });
    if (added > 0) await afterPlanWrite(plan.id);
    setBusy(false);
    if (!outcome) return setError(why);
    onClose();
    onDone(outcome.message, outcome.tone);
  }

  // Ticks outlive a search: they are kept by key, not by what is shown.
  const needle = search.trim().toLowerCase();
  const list = rows[group].filter((each) =>
    placeMatchesSearch({ name: each.title, altNames: each.altNames }, search),
  );
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      // Not while adding: the run's end would land on the next session.
      closable={!busy}
      title={planAddVerbLabel("copy")}
      footer={
        <View style={styles.footer}>
          {error ? <ErrorBanner message={error} /> : null}
          {priceLine ? <Text style={styles.muted}>{priceLine}</Text> : null}
          <Button
            label={tripPlanAddCopiesLabel(picks.length)}
            loading={busy}
            disabled={!online}
            disabledReason={OFFLINE}
            onPress={() => void add()}
          />
          {online ? null : <Text style={styles.offline}>{OFFLINE}</Text>}
        </View>
      }
    >
      <View style={styles.body}>
        <Text style={styles.muted}>{copy.addCopyLine}</Text>
        <ChipRail
          scroll
          value={group}
          onChange={setGroup}
          options={TRIP_PLAN_ITEM_GROUPS.map(({ group: value, title }) => ({
            value,
            label: title,
            // A zero is left out.
            count: rows[value].length || undefined,
          }))}
        />
        <View style={styles.searchWrap}>
          <Icon idea="search" size={16} color={theme.textMuted} />
          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder={copy.searchByName}
            placeholderTextColor={placeholderColor(theme)}
            accessibilityLabel={copy.searchByName}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
        </View>
        {list.length === 0 ? (
          <EmptyState
            icon="place"
            title={needle ? copy.searchNoMatch : copy.nothingToAdd}
          />
        ) : (
          list.map((each) => (
            <PickRow
              key={keyOf(each)}
              pick={each}
              ticked={tickedKeys.has(keyOf(each))}
              disabled={busy}
              accent={theme.accent}
              onToggle={toggle}
            />
          ))
        )}
      </View>
    </BottomSheet>
  );
}

/** Memoised: a tick or a keystroke redraws only the rows that changed. */
const PickRow = memo(function PickRow({
  pick,
  ticked,
  disabled,
  accent,
  onToggle,
}: {
  pick: Pick;
  ticked: boolean;
  disabled: boolean;
  accent: string;
  onToggle: (key: string) => void;
}) {
  return (
    <Row
      icon={pick.icon}
      hue={pick.hue ?? accent}
      title={pick.title}
      subtitle={
        pick.inPlan
          ? TRIP_PLAN_PAGE.copy.inPlan
          : pick.bytes > 0
            ? formatBytes(pick.bytes)
            : undefined
      }
      selected={ticked}
      disabled={disabled || pick.inPlan}
      right={pick.inPlan ? undefined : <SelectionMark selected={ticked} />}
      onPress={() => onToggle(keyOf(pick))}
    />
  );
});

const useStyles = makeStyles((theme, textRole) => ({
  body: { gap: spacing(1) },
  muted: { ...muted(theme, textRole.detail) },
  offline: { ...muted(theme, textRole.detail), textAlign: "center" },
  footer: { gap: spacing(1) },
  // As the trip log's place picker draws its search.
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(1),
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: theme.lineStrong,
    backgroundColor: theme.card,
    paddingHorizontal: spacing(1.5),
    minHeight: controlSize.lg,
  },
  searchInput: { ...textRole.body, flex: 1, color: theme.text },
}));
