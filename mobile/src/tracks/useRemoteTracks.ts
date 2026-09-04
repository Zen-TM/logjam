// Recordings that belong to this account but were not made on THIS phone.
//
// A finished recording is backed up as a standalone media row (origin "track"),
// so a second device sees the row long before it sees the GPX. Without this the
// Saved tab would list only what this handset recorded, and "your recordings
// are backed up" would be true and invisible at the same time.
//
// The local recordings are still the authority for anything made here — they
// hold the points, the stats and the resumable state. This is the other half,
// deduped by `track.mediaId` at the call site.
//
// PRIVACY: media rows carry canyon-area coordinates in their metadata bbox.
// Nothing here logs a row, a name or an extent.
import { useEffect, useState } from "react";

import { listStandaloneMedia, type MirrorMedia } from "../sync/mirrorStore";
import { onMirrorChanged } from "../sync/syncDb";

export function useStandaloneTrackMedia(): MirrorMedia[] {
  const [rows, setRows] = useState<MirrorMedia[]>([]);
  useEffect(() => {
    let mounted = true;
    const refresh = () => {
      listStandaloneMedia("track")
        .then((next) => {
          if (mounted) setRows(next);
        })
        .catch(console.error);
    };
    refresh();
    const unsubscribe = onMirrorChanged(refresh);
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);
  return rows;
}
