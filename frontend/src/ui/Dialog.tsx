import {
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { ConfirmCopy } from "@logjam/shared";
import { Button, IconButton } from "./Button";
import classes from "./Dialog.module.css";

type DialogProps = {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  /** Pinned below the scrolling body: Cancel, then the ONE primary action. A
   *  function receives `requestClose`, which a Cancel button calls so it asks
   *  the same question as Escape and ×. */
  footer?: ReactNode | ((requestClose: () => void) => ReactNode);
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
  /** Non-null while the form holds work (shared/DESIGN.md §10): every way out,
   *  `requestClose` included, raises this confirm and `onClose` runs only on
   *  its verb. Null closes at once. Guard: `formDiscard.test.ts`. */
  discard?: ConfirmCopy | null;
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
 * - With `discard`, those same exits ask first. A close that is held for the
 *   confirm is not a close, so the native one is re-shown (`onNativeClose`).
 * - Rendered into `document.body`, and it stops its own Escape, so closing it
 *   does not also close the sheet it was raised from or clear the selection of
 *   the list behind it (Dialog.test.tsx).
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
  discard = null,
  children,
}: DialogProps) {
  const [confirming, setConfirming] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const bodyId = useId();
  // Closes unless a request is in flight or a discard is to be confirmed, and
  // says whether it did. The listeners below take it as an effect event, so
  // they see the latest props without re-binding.
  const requestClose = () => {
    if (!dismissible) return false;
    if (discard) {
      setConfirming(true);
      return false;
    }
    onClose();
    return true;
  };
  const closeIfDismissible = useEffectEvent(requestClose);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const opener = document.activeElement as HTMLElement | null;
    dialog.showModal();
    (
      dialog.querySelector<HTMLElement>("[data-autofocus]") ??
      headingRef.current
    )?.focus();

    const requestClose = () => {
      closeIfDismissible();
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
      if (!closeIfDismissible()) dialog.showModal();
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
    <>
      <dialog
        ref={dialogRef}
        className={[classes.dialog, size === "large" && classes.large]
          .filter(Boolean)
          .join(" ")}
        role={alert ? "alertdialog" : undefined}
        aria-labelledby={titleId}
        aria-describedby={alert ? bodyId : undefined}
      >
        <header className={classes.head}>
          <h2
            id={titleId}
            ref={headingRef}
            tabIndex={-1}
            className={classes.title}
          >
            {title}
          </h2>
          <IconButton
            icon="close"
            label="Close"
            onClick={requestClose}
            disabled={!dismissible}
            disabledReason="Wait for this to finish"
          />
        </header>
        {toolbar && <div className={classes.toolbar}>{toolbar}</div>}
        <div id={bodyId} className={classes.body}>
          {children}
        </div>
        {footer && (
          <footer className={classes.foot}>
            {typeof footer === "function" ? footer(requestClose) : footer}
          </footer>
        )}
      </dialog>
      {discard && (
        <Dialog
          open={confirming}
          title={discard.confirmTitle}
          alert
          onClose={() => setConfirming(false)}
          footer={
            <>
              <Button onClick={() => setConfirming(false)}>Cancel</Button>
              <Button
                variant={
                  discard.tone === "destructive" ? "destructive" : "filled"
                }
                onClick={() => {
                  setConfirming(false);
                  onClose();
                }}
              >
                {discard.confirmLabel}
              </Button>
            </>
          }
        >
          {discard.confirmBody}
        </Dialog>
      )}
    </>
  );
}
