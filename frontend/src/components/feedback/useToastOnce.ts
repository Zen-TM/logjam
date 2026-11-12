import { useEffect, useRef } from "react";
import type { useToast } from "./ToastProvider";

/** Toast a load error once per message, unless the panel that is open already says it. */
export function useToastOnce(
  message: string | null,
  saidInPlace: boolean,
  toast: ReturnType<typeof useToast>,
) {
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (!message) last.current = null;
    else if (!saidInPlace && last.current !== message) {
      last.current = message;
      toast.error(message);
    }
  }, [message, saidInPlace, toast]);
}
