import type { MapPointFact } from "@logjam/shared";
import { Clipboard } from "react-native";

import type { Stat } from "../ui";

/**
 * A copyable fact's press: it copies the fact's text and says so. RN core
 * Clipboard: deprecated upstream but still shipped, and it needs no native
 * module. It cannot refuse, so `failed` is Logjam Web's.
 */
export const copyFact =
  (
    copy: NonNullable<MapPointFact["copy"]>,
    onInfo: (message: string) => void,
  ) =>
  () => {
    Clipboard.setString(copy.text);
    onInfo(copy.copied);
  };

/** A shared fact as a stat cell. */
export function factStat(
  fact: MapPointFact,
  onInfo: (message: string) => void,
): Stat {
  return {
    label: fact.label,
    value: fact.value,
    ...(fact.note ? { note: fact.note } : {}),
    ...(fact.span ? { span: true } : {}),
    ...(fact.parts ? { parts: fact.parts } : {}),
    ...(fact.copy ? { onCopy: copyFact(fact.copy, onInfo) } : {}),
  };
}
