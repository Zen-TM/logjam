import { useRef, useState } from "react";
import { Upload, Loader2 } from "lucide-react";
import type { MediaItem, MediaLinkedType } from "@logjam/shared";
import { uploadMedia } from "../../canyonUtils";
import { resolveMediaType, generateThumbnail } from "./mediaFiles";
import { messageFromError } from "../../errors/messageFromError";
import classes from "./MediaUpload.module.css";

// One uploader serves both surfaces; the category narrows what's accepted.
//   visual → photos + videos      track → GPX/KML only      (undefined → all)
type UploadCategory = "visual" | "track";

const ACCEPT_BY_CATEGORY: Record<UploadCategory, string> = {
  visual: "image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm",
  track: ".gpx,.kml",
};
const ACCEPT_ALL = `${ACCEPT_BY_CATEGORY.visual},${ACCEPT_BY_CATEGORY.track}`;

const HINT_BY_CATEGORY: Record<UploadCategory, string> = {
  visual: "Photos & videos",
  track: "GPX or KML",
};

export default function MediaUpload({
  linkedType,
  linkedId,
  onUploaded,
  disabled,
  resolveLinkedId,
  category,
  maxFiles,
  disabledReason,
}: {
  linkedType: MediaLinkedType;
  linkedId: string;
  onUploaded: (item: MediaItem) => void;
  disabled?: boolean;
  // When set, awaited once per upload batch to obtain the linkedId. Lets a
  // not-yet-saved entity (e.g. a draft trip log) be materialised on first
  // upload instead of requiring an existing id up front.
  resolveLinkedId?: () => Promise<string>;
  // Constrain accepted files. Mismatched files are rejected client-side; the
  // server still validates authoritatively.
  category?: UploadCategory;
  // Cap files per selection (e.g. 1 for a canyon's single track). When 1, the
  // native picker is single-select.
  maxFiles?: number;
  // When set, the dropzone is locked and shows this text instead of the hint
  // (e.g. "This canyon already has a track").
  disabledReason?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const accept = category ? ACCEPT_BY_CATEGORY[category] : ACCEPT_ALL;
  const subHint = category ? HINT_BY_CATEGORY[category] : "Photos, videos, GPX/KML";
  const locked = Boolean(disabled) || Boolean(disabledReason) || busy;

  // Whether a resolved file's category is allowed by the `category` prop.
  function categoryAllowed(resolvedCategory: "image" | "video" | "track"): boolean {
    if (!category) return true;
    if (category === "track") return resolvedCategory === "track";
    return resolvedCategory !== "track";
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    // Snapshot before any await: the caller resets the input value (emptying
    // the live FileList) immediately after invoking us.
    const selected = Array.from(files);
    setErrors([]);
    const failures: string[] = [];
    if (maxFiles != null && selected.length > maxFiles) {
      setErrors([`You can upload at most ${maxFiles} file${maxFiles === 1 ? "" : "s"} here.`]);
      return;
    }
    setBusy(true);
    try {
      const targetId = resolveLinkedId ? await resolveLinkedId() : linkedId;
      for (const file of selected) {
        const resolved = resolveMediaType(file);
        if (!resolved) {
          failures.push(`${file.name}: unsupported file type`);
          continue;
        }
        if (!categoryAllowed(resolved.category)) {
          failures.push(
            `${file.name}: ${category === "track" ? "expected a GPX or KML file" : "expected a photo or video"}`,
          );
          continue;
        }
        try {
          const thumbnail = await generateThumbnail(file, resolved.category);
          const item = await uploadMedia({
            linkedType,
            linkedId: targetId,
            file,
            mediaType: resolved.mediaType,
            thumbnail,
          });
          onUploaded(item);
        } catch (err) {
          console.error(err);
          failures.push(`${file.name}: ${messageFromError(err, "upload failed")}`);
        }
      }
    } catch (err) {
      console.error(err);
      failures.push(messageFromError(err, "Couldn't prepare upload."));
    }
    setErrors(failures);
    setBusy(false);
  }

  return (
    <div className={classes.root}>
      <div
        className={[
          classes.dropzone,
          dragging ? classes.dragging : "",
          locked ? classes.locked : "",
        ]
          .filter(Boolean)
          .join(" ")}
        onClick={() => {
          if (!locked) inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!locked) setDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!locked) void handleFiles(e.dataTransfer.files);
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !locked) inputRef.current?.click();
        }}
      >
        {busy ? (
          <Loader2 size={20} className={classes.spinner} />
        ) : (
          <Upload size={20} />
        )}
        <span className={classes.hint}>
          {busy
            ? "Uploading…"
            : disabledReason
              ? disabledReason
              : "Drop files or click to upload"}
        </span>
        {!disabledReason && <span className={classes.sub}>{subHint}</span>}
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={maxFiles !== 1}
          hidden
          onChange={(e) => {
            const input = e.target;
            // handleFiles copies the FileList synchronously (Array.from) before
            // its first await, so resetting value afterwards is safe. Resetting
            // before would empty the live FileList and drop the selection.
            void handleFiles(input.files);
            input.value = "";
          }}
        />
      </div>
      {errors.map((message, i) => (
        <div key={i} className={classes.error}>
          {message}
        </div>
      ))}
    </div>
  );
}
