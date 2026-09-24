import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Toast, type ToastSeverity } from "../../ui";
import classes from "./ToastProvider.module.css";

type ToastEntry = {
  id: number;
  message: string;
  severity: ToastSeverity;
};

type ToastContextValue = {
  error: (message: string) => void;
  success: (message: string) => void;
  info: (message: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

let nextId = 0;
const MAX_TOASTS = 3;
const AUTO_HIDE_MS = 6000;

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
  const remaining = useRef(AUTO_HIDE_MS);
  useEffect(() => {
    if (paused) return;
    const startedAt = Date.now();
    const timer = window.setTimeout(() => onDismiss(entry.id), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current -= Date.now() - startedAt;
    };
  }, [paused, entry.id, onDismiss]);
  return (
    <Toast message={entry.message} severity={entry.severity} onDismiss={() => onDismiss(entry.id)} />
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);

  const push = useCallback((message: string, severity: ToastSeverity) => {
    setToasts((prev) => {
      const next = [...prev, { id: nextId++, message, severity }];
      return next.length > MAX_TOASTS ? next.slice(next.length - MAX_TOASTS) : next;
    });
  }, []);

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
      error: (m) => push(m, "error"),
      success: (m) => push(m, "success"),
      info: (m) => push(m, "info"),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className={classes.stack}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      >
        {toasts.map((t) => (
          <TimedToast key={t.id} entry={t} paused={hovered || focused} onDismiss={dismiss} />
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
