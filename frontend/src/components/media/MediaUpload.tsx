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
}: {
  linkedType: MediaLinkedType;
  linkedId: string;
  onUploaded: (item: MediaItem) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const locked = Boolean(disabled) || busy;

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setErrors([]);
    setBusy(true);
    const failures: string[] = [];
    for (const file of Array.from(files)) {
      const resolved = resolveMediaType(file);
      if (!resolved) {
        failures.push(`${file.name}: unsupported file type`);
        continue;
      }
      try {
        const thumbnail = await generateThumbnail(file, resolved.category);
        const item = await uploadMedia({
          linkedType,
          linkedId,
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
            const files = e.target.files;
            e.target.value = "";
            void handleFiles(files);
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
