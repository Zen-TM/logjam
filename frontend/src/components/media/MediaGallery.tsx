import { useState } from "react";
import { Trash2, FileDown, Play } from "lucide-react";
import { mediaCategory, type MediaItem } from "@logjam/shared";
import { deleteMedia } from "../../canyonUtils";
import { messageFromError } from "../../errors/messageFromError";
import { ErrorBanner } from "../feedback/ErrorBanner";
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
                  className={classes.tileButton}
                  onClick={() => setLightbox(m)}
                  aria-label={`View ${m.filename}`}
                >
                  {m.thumbnailUrl ? (
                    <img
                      className={classes.thumb}
                      src={m.thumbnailUrl}
                      alt={m.filename}
                      loading="lazy"
                    />
                  ) : (
                    <div className={classes.thumbFallback}>{m.filename}</div>
                  )}
                  {isVideo && (
                    <span className={classes.playBadge}>
                      <Play size={16} />
                    </span>
                  )}
                </button>
                {canDelete && (
                  <button
                    className={classes.deleteBtn}
                    onClick={() => void handleDelete(m.id)}
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
                  className={classes.deleteBtnInline}
                  onClick={() => void handleDelete(m.id)}
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

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {lightbox && <Lightbox item={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}
