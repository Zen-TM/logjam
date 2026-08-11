// The rename form, rendered INSIDE an already-open sheet as a MODE of it —
// never as its own Modal. A second Modal opening over a settled sheet does not
// reliably take focus, and its backdrop stacks into a double-dark scrim.
//
// Because the sheet is already open and focused when this mounts, focus can be
// claimed on the first frame and the keyboard rises together with the form
// appearing, instead of shoving a settled sheet upwards a beat later.
//
// Lives in `ui/` rather than beside one screen because two surfaces render it:
// the Saved tab's per-item sheet (every asset kind) and the waypoint sheet on
// the map. A waypoint also carries notes, so the field is opt-in — pass
// `initialNotes` (even as "") to show it, omit it for a name-only rename.
import { useCallback, useEffect, useRef, useState } from "react";
import type { TextInput } from "react-native";

import { Button } from "./Button";
import { TextField } from "./TextField";

export function RenameForm({
  initialName,
  initialNotes,
  onSubmit,
}: {
  initialName: string;
  /** Omit for a name-only rename; pass a string (or null) to show notes. */
  initialNotes?: string | null;
  /**
   * Called with only what CHANGED, so a caller can hand the result straight to
   * an outbox update without writing fields the user never touched. Not called
   * at all when nothing changed — closing is the caller's job either way.
   */
  onSubmit: (changed: { name?: string; notes?: string | null }) => void;
}) {
  const [name, setName] = useState(initialName);
  const [notes, setNotes] = useState(initialNotes ?? "");
  const inputRef = useRef<TextInput>(null);
  const showNotes = initialNotes !== undefined;

  useEffect(() => {
    // `autoFocus` runs before the field is attached and is unreliable here; an
    // explicit focus on the next frame is not.
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  const commit = useCallback(() => {
    const trimmedName = name.trim();
    const changed: { name?: string; notes?: string | null } = {};
    // An empty name is a no-op, not a clear: every entity here requires one,
    // and the server would reject it after the sheet had already closed.
    if (trimmedName && trimmedName !== initialName) changed.name = trimmedName;
    if (showNotes) {
      const trimmedNotes = notes.trim();
      const before = initialNotes ?? "";
      // Emptied notes clear the column (null), rather than storing "".
      if (trimmedNotes !== before) changed.notes = trimmedNotes || null;
    }
    onSubmit(changed);
  }, [initialName, initialNotes, name, notes, onSubmit, showNotes]);

  return (
    <>
      <TextField
        label="Name"
        value={name}
        onChangeText={setName}
        inputRef={inputRef}
        returnKeyType={showNotes ? "next" : "done"}
        onSubmitEditing={showNotes ? undefined : commit}
      />
      {showNotes ? (
        <TextField label="Notes" value={notes} onChangeText={setNotes} multiline />
      ) : null}
      <Button label="Save" icon="check" onPress={commit} />
    </>
  );
}
