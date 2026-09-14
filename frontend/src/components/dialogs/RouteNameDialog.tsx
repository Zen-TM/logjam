import { useId, useState } from "react";
import { ROUTE_NAME_MAX_LENGTH, TRACK_COLORS } from "@logjam/shared";
import { Button, Dialog, SwatchPicker, TextField } from "../../ui";
import classes from "./RouteNameDialog.module.css";

type RouteNameDialogProps = {
  open: boolean;
  initialName: string;
  initialColor?: string;
  busy?: boolean;
  onSave: (name: string, color?: string) => void;
  onClose: () => void;
};

/**
 * Names a route on save.
 *
 * Deliberately a dialog, not a window.prompt: a native prompt carries neither
 * the theme nor the length validation that the API enforces.
 */
export default function RouteNameDialog({ open, ...form }: RouteNameDialogProps): React.JSX.Element | null {
  // The form mounts on open, so a reopened dialog starts from the route it is
  // naming now and never from the last one's typing.
  return open ? <RouteNameForm {...form} /> : null;
}

function RouteNameForm({
  initialName,
  initialColor,
  busy = false,
  onSave,
  onClose,
}: Omit<RouteNameDialogProps, "open">) {
  const formId = useId();
  const [name, setName] = useState(initialName);
  const [color, setColor] = useState<string | undefined>(initialColor);

  const trimmed = name.trim();
  const tooLong = trimmed.length > ROUTE_NAME_MAX_LENGTH;
  const canSave = trimmed.length > 0 && !tooLong;

  return (
    <Dialog
      open
      title="Name this route"
      onClose={onClose}
      dismissible={!busy}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="filled" busy={busy} disabled={!canSave}>
            Save
          </Button>
        </>
      }
    >
      {/* A real form, so Enter in the name field saves. */}
      <form
        id={formId}
        className={classes.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (canSave && !busy) onSave(trimmed, color);
        }}
      >
        <TextField
          label="Route name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          error={tooLong ? `Must be at most ${ROUTE_NAME_MAX_LENGTH} characters` : null}
          data-autofocus
        />
        <SwatchPicker label="Route colour" colors={TRACK_COLORS} value={color} onChange={setColor} disabled={busy} />
      </form>
    </Dialog>
  );
}
