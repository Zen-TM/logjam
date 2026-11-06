import { useRef } from "react";
import { importFailureMessage, WAY_IMPORT } from "@logjam/shared";
import { useToast } from "../../feedback/ToastProvider";
import { importWayFile, WAY_IMPORT_ACCEPT } from "./wayImport";

/**
 * The Ways list's and the map's Layers "Import a file": one hidden picker, so
 * both open the same thing. Render `input` once; call `openPicker` from a row.
 */
export function useWayImport(onImported: () => void) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const input = (
    <input
      ref={inputRef}
      type="file"
      accept={WAY_IMPORT_ACCEPT}
      hidden
      data-testid="way-import-input"
      onChange={(event) => {
        const file = event.target.files?.[0];
        // Reset so choosing the same file again still fires.
        event.target.value = "";
        if (!file) return;
        importWayFile(file)
          .then((name) => {
            toast.success(WAY_IMPORT.saved(name));
            onImported();
          })
          .catch((err) => {
            toast.error(importFailureMessage(err, WAY_IMPORT.failed));
          });
      }}
    />
  );
  return { openPicker: () => inputRef.current?.click(), input };
}
