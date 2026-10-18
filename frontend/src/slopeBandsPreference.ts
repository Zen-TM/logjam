// The account's slope bands (`uiPreferences.slopeBands`): what the Terrain
// group's statewide slope is coloured in, here and on Logjam GPS.
import { useCallback, useEffect, useMemo, useState } from "react";
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
  // session, so a save that comes back while the user edits on leaves it be.
  // The map keeps the last edit MapLibre can take while the editor holds one
  // it would refuse, and that edit is the one saved.
  const [edit, setEdit] = useState<{
    bands: SlopeBand[];
    lastValid: SlopeBand[] | null;
  } | null>(null);
  const setBands = useCallback(
    (bands: SlopeBand[]) =>
      setEdit((prev) => ({
        bands,
        lastValid:
          slopeBandsError(bands) == null ? bands : (prev?.lastValid ?? null),
      })),
    [],
  );
  const lastValid = edit?.lastValid ?? null;

  useEffect(() => {
    if (!lastValid) return;
    const timer = setTimeout(() => {
      updateUserPreferences({ slopeBands: lastValid })
        .then(applyCurrentUser)
        .catch((err: unknown) =>
          toast.error(messageFromError(err, "Couldn't save your slope bands.")),
        );
    }, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [lastValid, applyCurrentUser, toast]);

  return {
    /** What the editor shows, mid-edit problems and all. */
    bands: edit?.bands ?? saved,
    /** What the map draws: the last bands MapLibre can take. */
    drawn: lastValid ?? saved,
    setBands,
  };
}
