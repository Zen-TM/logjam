import { useState } from "react";
import { ChevronLeft, ChevronRight, Play, ImageOff } from "lucide-react";
import { mediaCategory, type MediaItem } from "@logjam/shared";
import Lightbox from "./Lightbox";
import { slideshowDots } from "./slideshowDots";
import classes from "./CanyonSlideshow.module.css";

// Square photo/video slideshow shown at the top of the canyon detail panel.
// Images render in their native aspect ratio, letterboxed on black. Videos show
// their poster thumbnail with a play badge. No auto-advance; clicking a slide
// opens the full-res lightbox. Callers pass visual-only media (no tracks).
const MAX_DOTS = 7;

export default function CanyonSlideshow({ media }: { media: MediaItem[] }) {
  const [index, setIndex] = useState(0);
  const [lightbox, setLightbox] = useState<MediaItem | null>(null);
  // Slides that failed to load (e.g. a 404'd S3 object) — MOBILE-5. Tracked by
  // id so a broken slide shows a labelled fallback instead of the browser's
  // broken-image glyph on the black letterbox.
  const [failedSlideIds, setFailedSlideIds] = useState<Set<string>>(new Set());

  if (media.length === 0) return null;

  const safeIndex = Math.min(index, media.length - 1);
  const current = media[safeIndex];
  const isVideo = mediaCategory(current.mediaType) === "video";
  const slideSrc = isVideo ? current.thumbnailUrl : current.displayUrl;
  const slideFailed = failedSlideIds.has(current.id);
  const dots = slideshowDots(media.length, safeIndex, MAX_DOTS);

  function step(delta: number) {
    setIndex((prev) => {
      const count = media.length;
      const base = Math.min(prev, count - 1);
      return ((base + delta) % count + count) % count;
    });
  }

  return (
    <div className={classes.root}>
      <div className={classes.frame}>
        <button
          className={classes.slide}
          onClick={() => setLightbox(current)}
          aria-label={`View ${current.filename}`}
        >
          {slideSrc && !slideFailed ? (
            <img
              className={classes.image}
              src={slideSrc}
              alt={current.filename}
              onError={() =>
                setFailedSlideIds((prev) => new Set(prev).add(current.id))
              }
            />
          ) : (
            <div className={classes.fallback}>
              <ImageOff size={22} />
              <span>{current.filename}</span>
            </div>
          )}
          {isVideo && (
            <span className={classes.playBadge}>
              <Play size={22} />
            </span>
          )}
        </button>
        {media.length > 1 && (
          <>
            <button
              className={`${classes.arrow} ${classes.arrowLeft}`}
              onClick={() => step(-1)}
              aria-label="Previous photo"
            >
              <ChevronLeft size={20} />
            </button>
            <button
              className={`${classes.arrow} ${classes.arrowRight}`}
              onClick={() => step(1)}
              aria-label="Next photo"
            >
              <ChevronRight size={20} />
            </button>
          </>
        )}
      </div>

      {media.length > 1 && (
        <div className={classes.dots}>
          {dots.map((dot) => (
            <button
              key={dot.index}
              className={[
                classes.dot,
                classes[dot.size],
                dot.index === safeIndex ? classes.active : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => setIndex(dot.index)}
              aria-label={`Go to photo ${dot.index + 1}`}
              aria-current={dot.index === safeIndex}
            />
          ))}
        </div>
      )}

      {lightbox && <Lightbox item={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}
