import { useState } from "react";
import { Trash2, FileDown, X, Play } from "lucide-react";
import { mediaCategory, type MediaItem } from "@logjam/shared";
import { deleteMedia } from "../../canyonUtils";
import { messageFromError } from "../../errors/messageFromError";
import classes from "./MediaGallery.module.css";

export default function MediaGallery({
  media,
  canDelete,
  onDeleted,
  emptyText,
}: {
  media: MediaItem[];
  canDelete: boolean;
  onDeleted: (id: string) => void;
  emptyText?: string;
}) {
  const [lightbox, setLightbox] = useState<MediaItem | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tracks = media.filter((m) => mediaCategory(m.mediaType) === "track");
  const visual = media.filter((m) => mediaCategory(m.mediaType) !== "track");

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

  if (media.length === 0) {
    return <div className={classes.empty}>{emptyText ?? "No files yet."}</div>;
  }

  return (
    <div className={classes.root}>
      {visual.length > 0 && (
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

      {tracks.length > 0 && (
        <div className={classes.trackList}>
          {tracks.map((m) => (
            <div key={m.id} className={classes.trackRow}>
              <a className={classes.trackLink} href={m.displayUrl} download={m.filename}>
                <FileDown size={16} />
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

      {error && <div className={classes.error}>{error}</div>}

      {lightbox && (
        <div className={classes.lightbox} onClick={() => setLightbox(null)} role="dialog">
          <button
            className={classes.lightboxClose}
            onClick={() => setLightbox(null)}
            aria-label="Close"
          >
            <X size={22} />
          </button>
          <div className={classes.lightboxContent} onClick={(e) => e.stopPropagation()}>
            {mediaCategory(lightbox.mediaType) === "video" ? (
              <video
                className={classes.lightboxMedia}
                src={lightbox.displayUrl}
                controls
                autoPlay
              />
            ) : (
              <img
                className={classes.lightboxMedia}
                src={lightbox.displayUrl}
                alt={lightbox.filename}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
