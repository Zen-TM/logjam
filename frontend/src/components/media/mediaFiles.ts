// Browser-side helpers for media uploads: resolving the canonical MIME type and
// generating client-side thumbnails (canvas resize for images, captured poster
// frame for videos). Tracks have no thumbnail.

import {
  MEDIA_EXTENSION_BY_MIME,
  TRACK_MIME_TYPES,
  mediaCategory,
  type MediaCategory,
} from "@logjam/shared";

const THUMBNAIL_MAX_PX = 400;
const THUMBNAIL_QUALITY = 0.7;

// Browsers report unreliable MIME types for GPX/KML/GeoJSON (often "" or
// application/octet-stream), so tracks are resolved by extension.
//
// INVERTED from the shared table rather than restated: two lists that must
// agree are one declaration (root CLAUDE.md). Hand-keeping this one already
// cost a disagreement — `application/geo+json` joined TRACK_MIME_TYPES when
// standalone imports became media, and this copy kept rejecting the .geojson
// the API had started accepting.
const TRACK_MIME_BY_EXTENSION: Record<string, string> = Object.fromEntries(
  TRACK_MIME_TYPES.map((mime) => [MEDIA_EXTENSION_BY_MIME[mime], mime]),
);

export function resolveMediaType(
  file: File,
): { mediaType: string; category: MediaCategory } | null {
  const fromMime = mediaCategory(file.type);
  if (fromMime === "image" || fromMime === "video") {
    return { mediaType: file.type, category: fromMime };
  }
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension && TRACK_MIME_BY_EXTENSION[extension]) {
    return { mediaType: TRACK_MIME_BY_EXTENSION[extension], category: "track" };
  }
  return null;
}

export async function generateThumbnail(
  file: File,
  category: MediaCategory,
): Promise<Blob | null> {
  if (category === "image") return imageThumbnail(file);
  if (category === "video") return videoThumbnail(file);
  return null;
}

function drawScaled(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
): HTMLCanvasElement {
  const scale = Math.min(1, THUMBNAIL_MAX_PX / Math.max(sourceWidth, sourceHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not supported");
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Couldn't create thumbnail"))),
      "image/jpeg",
      THUMBNAIL_QUALITY,
    );
  });
}

function imageThumbnail(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = drawScaled(img, img.naturalWidth, img.naturalHeight);
        URL.revokeObjectURL(url);
        canvasToJpeg(canvas).then(resolve, reject);
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Couldn't read image"));
    };
    img.src = url;
  });
}

function videoThumbnail(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "metadata";
    let captured = false;
    video.onloadedmetadata = () => {
      // Seek a little past the start to skip black opening frames.
      video.currentTime = Math.min(1, (video.duration || 2) / 2);
    };
    video.onseeked = () => {
      if (captured) return;
      captured = true;
      try {
        const canvas = drawScaled(video, video.videoWidth, video.videoHeight);
        URL.revokeObjectURL(url);
        canvasToJpeg(canvas).then(resolve, reject);
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Couldn't read video"));
    };
    video.src = url;
  });
}
