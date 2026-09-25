import { useId, useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { IconButton } from "./Button";
import classes from "./Dialog.module.css";

type DialogProps = {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  /** Pinned below the scrolling body: Cancel, then the ONE primary action. */
  footer?: ReactNode;
  /** Pinned under the title, above the scrolling body: the rail that says which
   *  part of a long form the body is showing. It stays put, so "which group am
   *  I in" is never scrolled off the thing it names. */
  toolbar?: ReactNode;
  /** `small` stays centred at every width (confirms, short forms); `large` is
   *  a long form and fills the screen on narrow web. */
  size?: "small" | "large";
  /** False while a request is in flight: Escape, the close button and the
   *  backdrop then do nothing. */
  dismissible?: boolean;
  /** A confirm: announced as an alert dialog, with its body as the description. */
  alert?: boolean;
  children: ReactNode;
};

/**
 * The modal surface — the counterpart of `SideSheet` for a task that is
 * finished or abandoned before the page behind it is used again. A native
 * `<dialog>` opened with `showModal()`, so the browser supplies the top layer,
 * the inert page behind it and the focus trap.
 *
 * - Focus moves to the element marked `data-autofocus` (a form's first field),
 *   else to the title, and returns to whatever opened it on close. React's own
 *   `autoFocus` fires before the dialog is shown, when nothing in it can take
 *   focus, which is why the attribute is ours.
 * - Escape, the close button and a press that starts AND ends on the backdrop
 *   call `onClose`. A press that starts in a field and ends outside it (a text
 *   selection dragged too far) is not a dismissal.
 * - Rendered into `document.body`, and it stops its own Escape: closing it must
 *   not also close the MUI dialog it was raised from, or clear the selection of
 *   the list behind it.
 */
export function Dialog(props: DialogProps) {
  if (!props.open) return null;
  return createPortal(<OpenDialog {...props} />, document.body);
}

function OpenDialog({
  title,
  onClose,
  footer,
  toolbar,
  size = "small",
  dismissible = true,
  alert = false,
  children,
}: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const latest = useRef({ onClose, dismissible });
  latest.current = { onClose, dismissible };

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const opener = document.activeElement as HTMLElement | null;
    dialog.showModal();
    (dialog.querySelector<HTMLElement>("[data-autofocus]") ?? headingRef.current)?.focus();

    const requestClose = () => {
      if (latest.current.dismissible) latest.current.onClose();
    };
    // On the dialog itself, before the key bubbles on. A menu inside that
    // consumed its own Escape has already prevented it.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      requestClose();
    };
    // The platform's own close request (Escape, Android back). Prevented, so
    // the dialog only ever closes through React state. The key that OPENED
    // this dialog — Escape in the form behind, asking to discard — still has
    // its default action to run, and that lands on the topmost modal, which is
    // now this one: a close request in the opening task is ignored.
    let opening = true;
    const settle = setTimeout(() => {
      opening = false;
    });
    const onCancel = (event: Event) => {
      event.preventDefault();
      if (!opening) requestClose();
    };
    // Chrome still closes a dialog whose cancel was prevented twice with no
    // click between. Keep React the source of truth either way. `close` is
    // queued, so the one this effect's own cleanup fires can land after a
    // remount (StrictMode does one) has shown the dialog again: ignore it then.
    const onNativeClose = () => {
      if (dialog.open) return;
      if (latest.current.dismissible) latest.current.onClose();
      else dialog.showModal();
    };
    // A press on the backdrop targets the dialog element itself; its content
    // fills it edge to edge, so nothing inside does.
    let pressStartedOnBackdrop = false;
    const onPointerDown = (event: PointerEvent) => {
      pressStartedOnBackdrop = event.target === dialog;
    };
    const onClick = (event: MouseEvent) => {
      if (pressStartedOnBackdrop && event.target === dialog) requestClose();
    };

    dialog.addEventListener("keydown", onKeyDown);
    dialog.addEventListener("cancel", onCancel);
    dialog.addEventListener("close", onNativeClose);
    dialog.addEventListener("pointerdown", onPointerDown);
    dialog.addEventListener("click", onClick);
    return () => {
      clearTimeout(settle);
      dialog.removeEventListener("keydown", onKeyDown);
      dialog.removeEventListener("cancel", onCancel);
      dialog.removeEventListener("close", onNativeClose);
      dialog.removeEventListener("pointerdown", onPointerDown);
      dialog.removeEventListener("click", onClick);
      // Closed before focus moves: the opener is inert while the dialog is modal.
      if (dialog.open) dialog.close();
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className={[classes.dialog, size === "large" && classes.large].filter(Boolean).join(" ")}
      role={alert ? "alertdialog" : undefined}
      aria-labelledby={titleId}
      aria-describedby={alert ? bodyId : undefined}
    >
      <header className={classes.head}>
        <h2 id={titleId} ref={headingRef} tabIndex={-1} className={classes.title}>
          {title}
        </h2>
        <IconButton icon={X} label="Close" onClick={onClose} disabled={!dismissible} />
      </header>
      {toolbar && <div className={classes.toolbar}>{toolbar}</div>}
      <div id={bodyId} className={classes.body}>
        {children}
      </div>
      {footer && <footer className={classes.foot}>{footer}</footer>}
    </dialog>
  );
}
