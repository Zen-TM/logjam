// The account's slope bands (`uiPreferences.slopeBands`): what the Terrain
// group's statewide slope is coloured in, here and on Logjam GPS.
import { useEffect, useMemo, useState } from "react";
import {
  normalizeUserUiPreferences,
  slopeBandsError,
  type SlopeBand,
  type TUser,
} from "@logjam/shared";

import { useToast } from "./components/feedback/ToastProvider";
import { messageFromError } from "./errors/messageFromError";
import { updateUserPreferences } from "./placeUtils";

/** An editor commits on every change: save once the user pauses, not per step. */
const SAVE_DELAY_MS = 800;

export function useSlopeBands(
  currentUser: TUser | null,
  applyCurrentUser: (user: TUser) => void,
) {
  const toast = useToast();
  const saved = useMemo(
    () => normalizeUserUiPreferences(currentUser?.uiPreferences).slopeBands,
    [currentUser],
  );
  // Once edited, the edit is what both the editor and the map show for the
  // session: a save that comes back while the user edits on must not undo them.
  const [edited, setEdited] = useState<SlopeBand[] | null>(null);
  const valid = edited != null && slopeBandsError(edited) == null;

  useEffect(() => {
    if (!edited || !valid) return;
    const timer = setTimeout(() => {
      updateUserPreferences({ slopeBands: edited })
        .then(applyCurrentUser)
        .catch((err: unknown) =>
          toast.error(messageFromError(err, "Couldn't save your slope bands.")),
        );
    }, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [edited, valid, applyCurrentUser, toast]);

  return {
    /** What the editor shows, mid-edit problems and all. */
    bands: edited ?? saved,
    /** What the map draws: the last bands MapLibre can take. */
    drawn: edited && valid ? edited : saved,
    setBands: setEdited,
  };
}
