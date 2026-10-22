// Add a copy (`PLAN_ADD_VERBS`): the caller's own places, ways and finished
// maps, ticked, each sent into the plan as a copy, one request each
// (POST /plans/:id/items), in list order. What is offered is
// `addableFromMirror`: the caller's own, on the server, less what a ticked
// place brings. Everyone in the plan can keep a copy of what is added
// (`addCopyLine`), and the files count against the adder's storage
// (`tripPlanAddCopyPriceLine`). Logjam Web's twin is
// frontend/src/components/plans/PlanAddCopyDialog.tsx. Online only.
import { useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import {
  formatBytes,
  mediaDisplayName,
  messageFromError,
  planAddVerbLabel,
  tripPlanAddCopiesLabel,
  tripPlanAddCopyPriceLine,
  tripPlanAddOutcome,
  untitledJobTitle,
  TRIP_PLAN_ITEM_GROUPS,
  TRIP_PLAN_PAGE,
  type TripPlanItemKind,
  type TripPlanItemGroup,
} from "@logjam/shared";

import { listGeoPdfJobs } from "../api/geoPdfJobs";
import { fetchCurrentUser, useApiQuery } from "../api/queries";
import { unavailableReasonText } from "../auth/capabilities";
import { useRememberedCopyMedia } from "../sharing/rememberedCopyMedia";
import { listStandaloneMedia, type MirrorMedia } from "../sync/mirrorStore";
import { getSyncStateValue } from "../sync/syncDb";
import {
  useMirrorPlaces,
  useMirrorRoutes,
  usePendingCreateIds,
} from "../sync/useSyncQueries";
import { makeStyles, muted, spacing, useHues, useTheme } from "../theme";
import {
  BottomSheet,
  Button,
  ChipRail,
  EmptyState,
  ErrorBanner,
  ErrorState,
  LoadingState,
  Row,
  SelectionMark,
  SwitchRow,
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
const keyOf = (pick: Pick) => `${pick.kind}:${pick.id}`;

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
  const maps = useApiQuery(
    listGeoPdfJobs,
    "Couldn't load your maps.",
    visible && online,
  );
  const [files, setFiles] = useState<MirrorMedia[]>([]);
  const [group, setGroup] = useState<TripPlanItemGroup>("places");
  const [ticked, setTicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [withMedia, toggleMedia] = useRememberedCopyMedia(visible);
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
          geoPdfs: maps.data ?? [],
        },
        { me, pendingCreates, tickedPlaceIds, copyMedia: withMedia },
      ),
    [
      places.data,
      routes.data,
      files,
      maps.data,
      me,
      pendingCreates,
      tickedPlaceIds,
      withMedia,
    ],
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
    maps: offered.geoPdfs.map((pdf) => ({
      kind: "geoPdf" as const,
      id: pdf.id,
      title: pdf.title ?? untitledJobTitle("geoPdfJob"),
      bytes: pdf.resultBytes ?? 0,
      icon: "geoPdf" as const,
      hue: assetHue.geoPdf,
    })),
  };
  // A pick no longer offered (it now comes with a ticked place) is not sent;
  // it comes back ticked if that place is unticked. Sent in list order.
  const picks = [...rows.places, ...rows.ways, ...rows.maps].filter((each) =>
    ticked.includes(keyOf(each)),
  );
  const isTicked = (pick: Pick) => ticked.includes(keyOf(pick));
  const priceLine = tripPlanAddCopyPriceLine({
    bytes: picks.reduce((sum, each) => sum + each.bytes, 0),
    photosToo: tickedPlaceIds.length > 0 && withMedia,
    leftBytes:
      user.data != null
        ? Math.max(0, user.data.storageQuotaBytes - user.data.storageUsedBytes)
        : null,
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
          ...(pick.kind === "place" ? { copyMedia: withMedia } : {}),
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

  const list = rows[group];
  const mapsPending = group === "maps" && maps.data == null;
  return (
    <BottomSheet
      visible={visible}
      // Not while adding: the run's end would land on the next session.
      onClose={() => {
        if (!busy) onClose();
      }}
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
            // A zero is left out, and so is a count not read yet.
            count:
              value === "maps" && maps.data == null
                ? undefined
                : rows[value].length || undefined,
          }))}
        />
        {group === "places" && tickedPlaceIds.length > 0 ? (
          <SwitchRow
            title={copy.bringPhotos}
            checked={withMedia}
            disabled={busy}
            onChange={toggleMedia}
          />
        ) : null}
        {mapsPending && maps.error ? (
          <ErrorState message={maps.error} onRetry={maps.refetch} />
        ) : mapsPending ? (
          <LoadingState />
        ) : list.length === 0 ? (
          <EmptyState icon="place" title={copy.nothingToAdd} />
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
}));
