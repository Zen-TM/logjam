import { deleteMedia } from "../../placeUtils";
import { ApiError } from "../../errors/ApiError";

/**
 * Takes back the files a dialog uploaded this open, one at a time so a failure
 * leaves only the files still there to retry (`onGone` untracks each as it
 * goes). A file the server no longer has was deleted elsewhere: that is the
 * outcome wanted, not a failure.
 */
export async function discardUploads(
  ids: readonly string[],
  onGone: (id: string) => void,
): Promise<void> {
  for (const id of ids) {
    try {
      await deleteMedia(id);
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 404)) throw err;
    }
    onGone(id);
  }
}
