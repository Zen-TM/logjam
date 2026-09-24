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
