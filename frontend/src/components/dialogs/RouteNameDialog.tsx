import { useId, useState } from "react";
import { Button, Dialog, TextField } from "../../ui";
import { wayNameError } from "../sidebar/panels/waysModel";
import classes from "./RouteNameDialog.module.css";

type RouteNameDialogProps = {
  open: boolean;
  initialName: string;
  busy?: boolean;
  onSave: (name: string) => void;
  onClose: () => void;
};

/**
 * Names a route on save.
 *
 * Deliberately a dialog, not a window.prompt: a native prompt carries neither
 * the theme nor the length validation that the API enforces.
 */
export default function RouteNameDialog({
  open,
  ...form
}: RouteNameDialogProps): React.JSX.Element | null {
  // The form mounts on open, so a reopened dialog starts from the route it is
  // naming now and never from the last one's typing.
  return open ? <RouteNameForm {...form} /> : null;
}

function RouteNameForm({
  initialName,
  busy = false,
  onSave,
  onClose,
}: Omit<RouteNameDialogProps, "open">) {
  const formId = useId();
  const [name, setName] = useState(initialName);

  const [asked, setAsked] = useState(false);
  const error = wayNameError(name, asked);

  return (
    <Dialog
      open
      title="Name this route"
      onClose={onClose}
      dismissible={!busy}
      footer={
        <>
          <Button onClick={onClose} disabled={busy} disabledReason="Saving…">
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="filled" busy={busy}>
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
          if (busy) return;
          setAsked(true);
          if (!wayNameError(name, true)) onSave(name.trim());
        }}
      >
        <TextField
          label="Route name"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setAsked(false);
          }}
          error={error}
          data-autofocus
        />
        {/* No colour here: it is a property of the DRAFT, chosen in the draw
            tool where the line is on the map in that colour as it is built.
            Asking again at save time is two controls for one property. */}
      </form>
    </Dialog>
  );
}
