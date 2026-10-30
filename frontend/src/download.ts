/** Start a browser download of a presigned URL, which carries its own
 *  Content-Disposition. */
export function triggerDownload(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Save a Blob made in this tab under `fileName`. */
export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // After the click has been handled; a revoke in the same tick can cancel it.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
