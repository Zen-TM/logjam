// Add a copy (`PLAN_ADD_VERBS`): the caller's own places, ways and finished
// maps, ticked, each sent into the plan as a copy, one request each
// (POST /plans/:id/items). What is offered is shared (`tripPlanAddable`): a
// route or file that a ticked place brings with it is not offered again.
// Everyone in the plan can keep a copy of what is added (`addCopyLine`), and
// the files count against the adder's storage (`tripPlanAddCopyPrice`).
// Logjam Web's twin is PlanAddCopyDialog (#573). Online only.
import { useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import {
  formatBytes,
  mediaDisplayName,
  mediaSkippedSentence,
  messageFromError,
  planAddVerbLabel,
  tripPlanAddable,
  tripPlanAddCopiesLabel,
  tripPlanAddCopyPrice,
  tripPlanAddedMessage,
  TRIP_PLAN_ITEM_GROUPS,
  TRIP_PLAN_PAGE,
  type TripPlanItemAdd,
  type TripPlanItemGroup,
} from "@logjam/shared";

import { fetchCurrentUser, useApiQuery } from "../api/queries";
import { listGeoPdfJobs } from "../api/geoPdfJobs";
import { unavailableReasonText } from "../auth/capabilities";
import { useRememberedCopyMedia } from "../sharing/rememberedCopyMedia";
import { listStandaloneMedia, type MirrorMedia } from "../sync/mirrorStore";
import { getSyncStateValue } from "../sync/syncDb";
import { useMirrorPlaces, useMirrorRoutes } from "../sync/useSyncQueries";
import { makeStyles, muted, spacing } from "../theme";
import {
  BottomSheet,
  Button,
  ChipRail,
  EmptyState,
  ErrorBanner,
  Row,
  SwitchRow,
} from "../ui";
import { addPlanItem } from "./plansApi";
import { afterPlanWrite } from "./plansCache";

const copy = TRIP_PLAN_PAGE.copy;
const OFFLINE = unavailableReasonText("needs-connection");

type Pick = TripPlanItemAdd & { title: string; bytes: number };

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
  const styles = useStyles();
  const places = useMirrorPlaces();
  const routes = useMirrorRoutes();
  const user = useApiQuery(fetchCurrentUser, copy.addCopyFailed, visible);
  const [files, setFiles] = useState<MirrorMedia[]>([]);
  const [maps, setMaps] = useState<Awaited<ReturnType<typeof listGeoPdfJobs>>>(
    [],
  );
  const [group, setGroup] = useState<TripPlanItemGroup>("places");
  const [ticked, setTicked] = useState<Pick[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [withMedia, toggleMedia] = useRememberedCopyMedia(visible);
  // Only the caller's own routes are theirs to add.
  const [me, setMe] = useState<string | null>(null);
  useEffect(() => {
    void getSyncStateValue("userId").then(setMe).catch(console.error);
  }, []);

  // Files are the mirror's; maps are the account's GeoPDF jobs, online.
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    void Promise.all([
      listStandaloneMedia("import"),
      listStandaloneMedia("track"),
    ])
      .then(([imports, tracks]) => {
        // Not uploaded yet: the API has no row of it to copy.
        if (alive)
          setFiles(
            [...imports, ...tracks].filter(
              (file) => file.syncState === "synced",
            ),
          );
      })
      .catch(console.error);
    if (online)
      void listGeoPdfJobs()
        .then((jobs) => {
          if (alive) setMaps(jobs);
        })
        .catch(console.error);
    return () => {
      alive = false;
    };
  }, [visible, online]);

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
    .filter((each) => each.kind === "place")
    .map((each) => each.id);
  const offered = useMemo(
    () =>
      tripPlanAddable(
        {
          places: (places.data ?? []).filter(
            (place) => place.syncRole === "owner",
          ),
          routes: (routes.data ?? []).map((route) => ({
            ...route,
            ownerId: route.ownerId ?? "",
          })),
          files: files.map((file) => ({
            ...file,
            linkedPlaceId: file.linkedType === "place" ? file.linkedId : null,
          })),
          geoPdfs: maps,
        },
        { me, tickedPlaceIds, copyMedia: withMedia },
      ),
    [places.data, routes.data, files, maps, me, tickedPlaceIds, withMedia],
  );
  const rows: Record<TripPlanItemGroup, Pick[]> = {
    places: offered.places.map((place) => ({
      kind: "place",
      id: place.id,
      title: place.name,
      bytes: 0,
    })),
    ways: [
      ...offered.routes.map((route) => ({
        kind: "route" as const,
        id: route.id,
        title: route.name,
        bytes: 0,
      })),
      ...offered.files.map((file) => ({
        kind: "media" as const,
        id: file.id,
        title: mediaDisplayName(file),
        bytes: file.fileSizeBytes ?? 0,
      })),
    ],
    maps: offered.geoPdfs.map((pdf) => ({
      kind: "geoPdf" as const,
      id: pdf.id,
      title: pdf.title ?? "GeoPDF",
      bytes: pdf.resultBytes ?? 0,
    })),
  };
  // What a ticked place now brings is no longer offered: untick it too.
  const shown = new Set(
    Object.values(rows).flatMap((list) => list.map((each) => each.id)),
  );
  const picks = ticked.filter((each) => shown.has(each.id));
  const isTicked = (id: string) => picks.some((each) => each.id === id);
  const bytes = picks.reduce((sum, each) => sum + each.bytes, 0);
  const left =
    user.data != null
      ? formatBytes(
          Math.max(0, user.data.storageQuotaBytes - user.data.storageUsedBytes),
        )
      : null;

  async function add() {
    if (picks.length === 0) return setError(copy.nothingTicked);
    setBusy(true);
    setError(null);
    let added = 0;
    let skipped = 0;
    let outOfSpace = false;
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
      const why = messageFromError(err, copy.addCopyFailed);
      if (added === 0) {
        setError(why);
        setBusy(false);
        return;
      }
      await afterPlanWrite(planId);
      setBusy(false);
      onClose();
      onDone(
        [
          tripPlanAddedMessage(added, picks.length),
          mediaSkippedSentence(skipped, outOfSpace),
          why,
        ]
          .filter(Boolean)
          .join(" "),
        "error",
      );
      return;
    }
    await afterPlanWrite(planId);
    setBusy(false);
    onClose();
    const photos = mediaSkippedSentence(skipped, outOfSpace);
    onDone(
      [tripPlanAddedMessage(added, picks.length), photos]
        .filter(Boolean)
        .join(" "),
      photos ? "error" : "info",
    );
  }

  const list = rows[group];
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={planAddVerbLabel("copy")}
      footer={
        <View style={styles.footer}>
          {error ? <ErrorBanner message={error} /> : null}
          {left ? (
            <Text style={styles.muted}>
              {[
                tripPlanAddCopyPrice(
                  bytes > 0 ? formatBytes(bytes) : null,
                  left,
                ),
                tickedPlaceIds.length > 0 ? copy.photosCountToo : null,
              ]
                .filter(Boolean)
                .join(" ")}
            </Text>
          ) : null}
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
            count: rows[value].length,
          }))}
        />
        {group === "places" && tickedPlaceIds.length > 0 ? (
          <SwitchRow
            title={copy.bringPhotos}
            checked={withMedia}
            onChange={toggleMedia}
          />
        ) : null}
        {list.length === 0 ? (
          <EmptyState icon="place" title={copy.nothingToAdd} />
        ) : (
          list.map((each) => (
            <Row
              key={each.id}
              icon={
                each.kind === "place"
                  ? "place"
                  : each.kind === "route"
                    ? "route"
                    : each.kind === "geoPdf"
                      ? "geoPdf"
                      : "importedFile"
              }
              title={each.title}
              subtitle={each.bytes > 0 ? formatBytes(each.bytes) : undefined}
              selected={isTicked(each.id)}
              onPress={() =>
                setTicked((was) =>
                  isTicked(each.id)
                    ? was.filter((other) => other.id !== each.id)
                    : [...was, each],
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
