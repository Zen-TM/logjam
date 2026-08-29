import { useState } from "react";
import { Trash2, FileDown, Play, ImageOff } from "lucide-react";
import { mediaCategory, type MediaItem } from "@logjam/shared";
import { deleteMedia } from "../../canyonUtils";
import { messageFromError } from "../../errors/messageFromError";
import { ErrorBanner } from "../feedback/ErrorBanner";
import ConfirmDialog from "../dialogs/ConfirmDialog";
import Lightbox from "./Lightbox";
import TrackIcon from "./TrackIcon";
import classes from "./MediaGallery.module.css";

// `variant` selects which media this gallery surfaces:
//   all     → visual grid + track list (default; legacy behaviour)
//   visual  → photos/videos only
//   tracks  → GPX/KML only
export default function MediaGallery({
  media,
  canDelete,
  onDeleted,
  emptyText,
  variant = "all",
}: {
  media: MediaItem[];
  canDelete: boolean;
  onDeleted: (id: string) => void;
  emptyText?: string;
  variant?: "all" | "visual" | "tracks";
}) {
  const [lightbox, setLightbox] = useState<MediaItem | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // FEUI-007: one-tap Trash2 permanently deletes the S3 object with no
  // recovery. Route through the same ConfirmDialog every other destructive
  // surface uses (e.g. the track-card delete in CanyonDetailPanel).
  const [pendingDelete, setPendingDelete] = useState<MediaItem | null>(null);
  // Thumbnails that failed to load (e.g. a 404'd S3 object) — MOBILE-5. Tracked
  // by id so a broken thumb shows a labelled fallback instead of the browser's
  // broken-image glyph.
  const [failedThumbIds, setFailedThumbIds] = useState<Set<string>>(new Set());

  const tracks = media.filter((m) => mediaCategory(m.mediaType) === "track");
  const visual = media.filter((m) => mediaCategory(m.mediaType) !== "track");
  const showVisual = variant !== "tracks";
  const showTracks = variant !== "visual";

  async function handleDelete(id: string) {
    setDeletingId(id);
    setError(null);
    try {
      await deleteMedia(id);
      onDeleted(id);
      // Only close the confirm on success — an error leaves it open (with the
      // banner inside) so the user sees why and can retry, matching the
      // track-card delete in CanyonDetailPanel.
      setPendingDelete(null);
    } catch (err) {
      console.error(err);
      setError(messageFromError(err, "Couldn't delete file."));
    } finally {
      setDeletingId(null);
    }
  }

  // Empty when nothing relevant to this variant is present.
  const relevant =
    variant === "visual" ? visual : variant === "tracks" ? tracks : media;
  if (relevant.length === 0) {
    return <div className={classes.empty}>{emptyText ?? "No files yet."}</div>;
  }

  return (
    <div className={classes.root}>
      {showVisual && visual.length > 0 && (
        <div className={classes.grid}>
          {visual.map((m) => {
            const isVideo = mediaCategory(m.mediaType) === "video";
            return (
              <div key={m.id} className={classes.tile}>
                <button
                  type="button"
                  className={classes.tileButton}
                  onClick={() => setLightbox(m)}
                  aria-label={`View ${m.filename}`}
                >
                  {m.thumbnailUrl && !failedThumbIds.has(m.id) ? (
                    <img
                      className={classes.thumb}
                      src={m.thumbnailUrl}
                      alt={m.filename}
                      loading="lazy"
                      onError={() =>
                        setFailedThumbIds((prev) => new Set(prev).add(m.id))
                      }
                    />
                  ) : (
                    <div className={classes.thumbFallback}>
                      <ImageOff size={18} />
                      <span>{m.filename}</span>
                    </div>
                  )}
                  {isVideo && (
                    <span className={classes.playBadge}>
                      <Play size={16} />
                    </span>
                  )}
                </button>
                {canDelete && (
                  <button
                    type="button"
                    className={classes.deleteBtn}
                    onClick={() => setPendingDelete(m)}
                    disabled={deletingId === m.id}
                    aria-label={`Delete ${m.filename}`}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showTracks && tracks.length > 0 && (
        <div className={classes.trackList}>
          {tracks.map((m) => (
            <div key={m.id} className={classes.trackRow}>
              <a className={classes.trackLink} href={m.displayUrl} download={m.filename}>
                {m.color ? <TrackIcon color={m.color} /> : <FileDown size={16} />}
                <span className={classes.trackName}>{m.filename}</span>
              </a>
              {canDelete && (
                <button
                  type="button"
                  className={classes.deleteBtnInline}
                  onClick={() => setPendingDelete(m)}
                  disabled={deletingId === m.id}
                  aria-label={`Delete ${m.filename}`}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {lightbox && <Lightbox item={lightbox} onClose={() => setLightbox(null)} />}

      <ConfirmDialog
        open={pendingDelete != null}
        title="Delete file?"
        message={
          <>
            This permanently deletes <b>{pendingDelete?.filename}</b>. This cannot
            be undone.
            {/* Rendered inside the dialog (not the page behind it) — the
                modal backdrop would otherwise hide a page-level ErrorBanner. */}
            {error && (
              <ErrorBanner message={error} onDismiss={() => setError(null)} />
            )}
          </>
        }
        busy={deletingId === pendingDelete?.id}
        onConfirm={() => pendingDelete && void handleDelete(pendingDelete.id)}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
}
