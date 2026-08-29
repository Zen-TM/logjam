// Files friends have sent me — accept to keep, decline to turn down.
//
// A COPY, not a share. Accepting downloads the file and runs it through the
// SAME import a picked file goes through, so the recipient derives their own
// GeoJSON on their own device from the real bytes. From that moment it is
// theirs: editable, permanent, and unaffected by anything the sender does
// later. Declining is terminal FOR ME ONLY — one object serves every recipient
// of a send, so it deletes nothing for anyone else, and the copy says so.
//
// LAYOUT (DESIGN.md §1, §2): hero states how many are waiting; rows, with the
// per-item verbs in the row's trailing accessory because there are exactly two
// and both are one tap.
//
// PRIVACY: a filename is user text and routinely names a canyon. Rendered here
// (the recipient is entitled to know what they are being offered) and never
// logged, exactly as the sender's side treats it.
import { useCallback, useEffect, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import * as FileSystem from "expo-file-system/legacy";

import { messageFromError } from "@logjam/shared";

import {
  acceptFileSend,
  declineFileSend,
  downloadFileSend,
  getFileSendInbox,
  type InboxFileSend,
} from "../api/fileSends";
import { importVectorSource } from "../imports/vectorImports";
import { listVectorImports } from "../imports/importsDb";
import { importGeoPdfFile } from "../geopdf/importPipeline";
import { runGeoPdfImport } from "../geopdf/importRunner";
import { useConnectivity } from "../map/connectivity";
import { fontSize, spacing, theme } from "../theme";
import {
  Button,
  EmptyState,
  ErrorBanner,
  HeroHeader,
  Row,
  ScreenScroll,
  StatusPill,
} from "../ui";
/** Day + month, as every other list surface renders a date. */
function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

/** A PDF goes through the GeoPDF pipeline; everything else is a vector import. */
function isPdf(filename: string): boolean {
  return filename.toLowerCase().endsWith(".pdf");
}

export function ReceivedFilesScreen({ onBack }: { onBack: () => void }) {
  const [sends, setSends] = useState<InboxFileSend[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const online = useConnectivity() === "online";

  const load = useCallback(async () => {
    if (!online) return;
    try {
      setSends(await getFileSendInbox());
      setError(null);
    } catch (err) {
      console.error(err);
      setError(messageFromError(err, "Couldn't load received files."));
    }
  }, [online]);

  useEffect(() => {
    void load();
  }, [load]);

  const take = useCallback(
    async (send: InboxFileSend) => {
      setBusyId(send.fileSendId);
      setError(null);
      // Deleted in the finally: this is the ONE import entry point whose input
      // is already a `file://` path, so `stageIncomingFile` returns
      // `scratch: null` and both pipelines' own cleanup no-ops. Nothing else
      // sweeps SCRATCH_DIR before sign-out, so a season of accepted GeoPDFs
      // (up to 64 MB each) otherwise just accumulates, uncounted by the Saved
      // capacity meter.
      let scratchUri: string | null = null;
      try {
        const { downloadUrl, filename } = await acceptFileSend(send.fileSendId);
        const uri = await downloadFileSend(
          downloadUrl,
          `received-${send.fileSendId}`,
        );
        scratchUri = uri;
        if (isPdf(filename)) {
          // Through the runner, like every other GeoPDF entry point: it is the
          // "one import at a time" guard, and two would fight over the single
          // native rasteriser.
          await runGeoPdfImport(filename, (onProgress, token) =>
            importGeoPdfFile(filename, uri, onProgress, token),
          );
        } else {
          // The same function the OS "Open in Logjam" intent calls — the
          // recipient's GeoJSON is derived here, from the original bytes,
          // rather than being handed a lossy round trip.
          const existing = await listVectorImports();
          await importVectorSource(
            uri,
            filename,
            existing.length,
            send.sentBy.username,
          );
        }
        await load();
      } catch (err) {
        console.error(err);
        setError(messageFromError(err, "Couldn't save that file."));
      } finally {
        if (scratchUri) {
          await FileSystem.deleteAsync(scratchUri, { idempotent: true }).catch(
            () => {},
          );
        }
        setBusyId(null);
      }
    },
    [load],
  );

  const turnDown = useCallback(
    (send: InboxFileSend) => {
      Alert.alert(
        "Turn down this file?",
        // What decline actually does, and what it does not: the sender keeps
        // their file and any other recipient keeps their copy.
        `You won't get a copy of ${send.filename}. It stays with ${send.sentBy.username}, and anyone else they sent it to still has theirs.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Turn down",
            style: "destructive",
            onPress: () => {
              setBusyId(send.fileSendId);
              declineFileSend(send.fileSendId)
                .then(() => load())
                .catch((err: unknown) => {
                  console.error(err);
                  setError(messageFromError(err, "Couldn't turn that down."));
                })
                .finally(() => setBusyId(null));
            },
          },
        ],
      );
    },
    [load],
  );

  const waiting = (sends ?? []).filter((s) => s.status === "pending");

  return (
    <ScreenScroll>
      <HeroHeader
        title="Received files"
        value={
          !online
            ? "Needs a connection"
            : sends === null
              ? "Loading…"
              : waiting.length === 0
                ? "Nothing waiting"
                : `${waiting.length} waiting`
        }
        onBack={onBack}
      />
      {error ? <ErrorBanner message={error} /> : null}
      {online && sends !== null && sends.length === 0 ? (
        <EmptyState
          title="No files yet"
          hint="Files friends send you land here. They stay for a week."
        />
      ) : null}
      {(sends ?? []).map((send) => {
        const accepted = send.status === "accepted";
        return (
          <View key={send.fileSendId} style={styles.item}>
            <Row
              icon={accepted ? "check-circle" : "file-plus"}
              hue={accepted ? theme.accent : theme.bonus1}
              title={send.filename}
              subtitle={`from ${send.sentBy.username} · ${formatDay(send.createdAt)}`}
              right={
                accepted ? (
                  <StatusPill label="Saved" tone="muted" />
                ) : undefined
              }
            />
            <View style={styles.actions}>
              {accepted ? (
                // The row flips to accepted when the download URL is ISSUED,
                // not when the transfer lands — so an accept on a flaky
                // connection leaves "Saved" with no file. The bytes stay
                // downloadable until the send expires, so offering the retry
                // is the honest fix and costs nothing.
                <Button
                  label="Download again"
                  variant="outlineAccent"
                  onPress={() => void take(send)}
                  disabled={busyId !== null || !online}
                  loading={busyId === send.fileSendId}
                />
              ) : (
                <>
                  <Button
                    label="Save a copy"
                    onPress={() => void take(send)}
                    disabled={busyId !== null || !online}
                    loading={busyId === send.fileSendId}
                  />
                  <Button
                    label="Turn down"
                    variant="outlineAccent"
                    onPress={() => turnDown(send)}
                    disabled={busyId !== null || !online}
                  />
                </>
              )}
            </View>
          </View>
        );
      })}
      {(sends ?? []).length > 0 ? (
        <Text style={styles.hint}>
          A file you save is yours to keep and edit. Anything still waiting
          disappears a week after it was sent.
        </Text>
      ) : null}
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  item: { gap: spacing(0.5), marginBottom: spacing(1) },
  actions: { flexDirection: "row", gap: spacing(1), paddingHorizontal: spacing(2) },
  hint: {
    color: theme.textMuted,
    fontSize: fontSize.xs,
    paddingHorizontal: spacing(2),
    paddingTop: spacing(1),
  },
});
