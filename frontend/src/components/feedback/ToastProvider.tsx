import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toastMs, type ToastAction, type ToastTone } from "@logjam/shared";
import { Toast } from "../../ui";
import classes from "./ToastProvider.module.css";

type ToastEntry = {
  id: number;
  message: string;
  tone: ToastTone;
  action?: ToastAction;
};

type ToastContextValue = {
  error: (message: string, action?: ToastAction) => void;
  /** An outcome that worked. */
  done: (message: string, action?: ToastAction) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

let nextId = 0;
const MAX_TOASTS = 3;

/** One toast's timer. Paused while the pointer is over the stack or focus is in
 *  it, so a message being read (or its Dismiss being reached by keyboard) does
 *  not vanish mid-way (WCAG 2.2.1). */
function TimedToast({
  entry,
  paused,
  onDismiss,
}: {
  entry: ToastEntry;
  paused: boolean;
  onDismiss: (id: number) => void;
}) {
  const remaining = useRef(toastMs(entry.tone, entry.action));
  useEffect(() => {
    if (paused) return;
    const startedAt = Date.now();
    const timer = window.setTimeout(
      () => onDismiss(entry.id),
      remaining.current,
    );
    return () => {
      window.clearTimeout(timer);
      remaining.current -= Date.now() - startedAt;
    };
  }, [paused, entry.id, onDismiss]);
  return (
    <Toast
      message={entry.message}
      tone={entry.tone}
      action={entry.action}
      onDismiss={() => onDismiss(entry.id)}
    />
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);

  const push = useCallback(
    (message: string, tone: ToastTone, action?: ToastAction) => {
      setToasts((prev) => {
        const next = [...prev, { id: nextId++, message, tone, action }];
        return next.length > MAX_TOASTS
          ? next.slice(next.length - MAX_TOASTS)
          : next;
      });
    },
    [],
  );

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Memoize the context value: a fresh object literal each render gives every
  // useToast() consumer a new `toast` identity on every render. Effects that
  // list `toast` in their deps (e.g. App.tsx's error toasts + the user
  // hydration fetch) then re-run on each render — and since pushing a toast
  // re-renders this provider, a single failing fetch + toast becomes an
  // infinite fetch/render loop (React #185 + a request flood). `push` is
  // stable, so the memo only ever recomputes once.
  const value = useMemo<ToastContextValue>(
    () => ({
      error: (m, action) => push(m, "error", action),
      done: (m, action) => push(m, "done", action),
    }),
    [push],
  );

  // A modal Dialog is in the browser's top layer, which no z-index beats; a
  // manual popover joins it, and showing it again after the Dialog opened
  // puts it on top. Hidden when empty so it never sits over a later Dialog.
  const stack = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = stack.current;
    if (!el?.showPopover) return;
    el.hidePopover(); // a no-op when hidden; showPopover() throws if shown
    if (toasts.length > 0) el.showPopover();
  }, [toasts]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        ref={stack}
        popover="manual"
        className={classes.stack}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      >
        {toasts.map((t) => (
          <TimedToast
            key={t.id}
            entry={t}
            paused={hovered || focused}
            onDismiss={dismiss}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}
