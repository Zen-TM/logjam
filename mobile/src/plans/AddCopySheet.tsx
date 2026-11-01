// Add a copy (`PLAN_ADD_VERBS`): the caller's own places, ways and files,
// ticked, each sent into the plan as a copy, one request each
// (POST /plans/:id/items), in list order. What is offered is
// `addableFromMirror`: the caller's own, on the server, less what a ticked
// place brings. Everyone in the plan can keep a copy of what is added
// (`addCopyLine`), and the files count against the adder's storage
// (`tripPlanAddCopyPriceLine`). Logjam Web's twin is
// frontend/src/components/plans/PlanAddCopyDialog.tsx. Online only.
import { useEffect, useMemo, useState } from "react";
import { Text, TextInput, View } from "react-native";
import {
  formatBytes,
  mediaDisplayName,
  messageFromError,
  planAddVerbLabel,
  tripPlanAddCopiesLabel,
  tripPlanAddCopyPriceLine,
  tripPlanAddOutcome,
  tripPlanAddKey,
  tripPlanAddPicks,
  TRIP_PLAN_ITEM_GROUPS,
  TRIP_PLAN_PAGE,
  type TripPlanItemKind,
  type TripPlanItemGroup,
} from "@logjam/shared";

import { fetchCurrentUser, useApiQuery } from "../api/queries";
import { unavailableReasonText } from "../auth/capabilities";
import { listStandaloneMedia, type MirrorMedia } from "../sync/mirrorStore";
import { getSyncStateValue } from "../sync/syncDb";
import {
  useMirrorPlaces,
  useMirrorRoutes,
  usePendingCreateIds,
} from "../sync/useSyncQueries";
import {
  controlSize,
  makeStyles,
  muted,
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
  icon: Glyph;
  hue?: string;
};
const keyOf = tripPlanAddKey;

export function AddCopySheet({
  planId,
  visible,
  online,
  onClose,
  onDone,
}: {
  planId: string;
  visible: boolean;
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
  // Only the caller's own routes are theirs to add.
  const [me, setMe] = useState<string | null>(null);
  useEffect(() => {
    void getSyncStateValue("userId").then(setMe).catch(console.error);
  }, []);

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

  const tickedPlaceIds = ticked
    .filter((key) => key.startsWith("place:"))
    .map((key) => key.slice("place:".length));
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
  const rows: Record<TripPlanItemGroup, Pick[]> = {
    // Places keep the accent, as the plan's own list does.
    places: offered.places.map((place) => ({
      kind: "place",
      id: place.id,
      title: place.name,
      bytes: 0,
      icon: "place",
    })),
    ways: [
      ...offered.routes.map((route) => ({
        kind: "route" as const,
        id: route.id,
        title: route.name,
        bytes: 0,
        icon: "route" as const,
        hue: assetHue.route,
      })),
      ...offered.files.map((file) => ({
        kind: "media" as const,
        id: file.id,
        title: mediaDisplayName(file),
        bytes: file.fileSizeBytes ?? 0,
        // A recording and an import look as they do in Saved.
        ...(file.origin === "track"
          ? { icon: "track" as const, hue: assetHue.track }
          : { icon: "importedFile" as const, hue: assetHue.import }),
      })),
    ],
  };
  // What is sent: ticks still offered, in list order (`tripPlanAddPicks`).
  const picks = tripPlanAddPicks([...rows.places, ...rows.ways], ticked);
  const isTicked = (pick: Pick) => ticked.includes(keyOf(pick));
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
        const result = await addPlanItem(planId, {
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
    if (added > 0) await afterPlanWrite(planId);
    setBusy(false);
    if (!outcome) return setError(why);
    onClose();
    onDone(outcome.message, outcome.tone);
  }

  // Ticks outlive a search: they are kept by key, not by what is shown.
  const needle = search.trim().toLowerCase();
  const list = rows[group].filter(
    (each) => !needle || each.title.toLowerCase().includes(needle),
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
            placeholderTextColor={theme.textMuted}
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
            <Row
              key={keyOf(each)}
              icon={each.icon}
              hue={each.hue ?? theme.accent}
              title={each.title}
              subtitle={each.bytes > 0 ? formatBytes(each.bytes) : undefined}
              selected={isTicked(each)}
              disabled={busy}
              right={<SelectionMark selected={isTicked(each)} />}
              onPress={() =>
                setTicked((was) =>
                  was.includes(keyOf(each))
                    ? was.filter((key) => key !== keyOf(each))
                    : [...was, keyOf(each)],
                )
              }
            />
          ))
        )}
      </View>
    </BottomSheet>
  );
}

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
