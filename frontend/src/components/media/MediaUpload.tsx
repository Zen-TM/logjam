import { useRef, useState } from "react";
import { Upload, Loader2 } from "lucide-react";
import type { MediaItem, MediaLinkedType } from "@logjam/shared";
import { uploadMedia } from "../../canyonUtils";
import { resolveMediaType, generateThumbnail } from "./mediaFiles";
import { messageFromError } from "../../errors/messageFromError";
import classes from "./MediaUpload.module.css";

const ACCEPT =
  "image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm,.gpx,.kml";

export default function MediaUpload({
  linkedType,
  linkedId,
  onUploaded,
  disabled,
  resolveLinkedId,
}: {
  linkedType: MediaLinkedType;
  linkedId: string;
  onUploaded: (item: MediaItem) => void;
  disabled?: boolean;
  // When set, awaited once per upload batch to obtain the linkedId. Lets a
  // not-yet-saved entity (e.g. a draft trip log) be materialised on first
  // upload instead of requiring an existing id up front.
  resolveLinkedId?: () => Promise<string>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const locked = Boolean(disabled) || busy;

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    // Snapshot before any await: the caller resets the input value (emptying
    // the live FileList) immediately after invoking us.
    const selected = Array.from(files);
    setErrors([]);
    setBusy(true);
    const failures: string[] = [];
    try {
      const targetId = resolveLinkedId ? await resolveLinkedId() : linkedId;
      for (const file of selected) {
        const resolved = resolveMediaType(file);
        if (!resolved) {
          failures.push(`${file.name}: unsupported file type`);
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
          {busy ? "Uploading…" : "Drop files or click to upload"}
        </span>
        <span className={classes.sub}>Photos, videos, GPX/KML</span>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
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
