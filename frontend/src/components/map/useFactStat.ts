import type { MapPointFact } from "@logjam/shared";

import type { Stat } from "../../ui";
import { useToast } from "../feedback/ToastProvider";

/** A shared fact as a stat cell: a copyable one copies its text and says so. */
export function useFactStat(): (fact: MapPointFact) => Stat {
  const toast = useToast();
  return (fact) => {
    const { copy } = fact;
    return {
      label: fact.label,
      value: fact.value,
      ...(fact.note ? { note: fact.note } : {}),
      ...(fact.span ? { span: true } : {}),
      ...(fact.parts ? { parts: fact.parts } : {}),
      ...(copy
        ? {
            onCopy: () =>
              void navigator.clipboard
                .writeText(copy.text)
                .then(() => toast.done(copy.copied))
                .catch(() => toast.error(copy.failed)),
          }
        : {}),
    };
  };
}
