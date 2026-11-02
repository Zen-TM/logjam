import type { PlanVerb } from "@logjam/shared";
import type { MenuEntry } from "../../ui";

/** A verb list as menu entries, a rule above the first separated one. */
export function menuEntries<Id extends string>(
  verbs: PlanVerb<Id>[],
  run: (id: Id) => void,
): MenuEntry[] {
  const entries: MenuEntry[] = [];
  let ruled = false;
  for (const verb of verbs) {
    if (verb.separated && !ruled && entries.length > 0) {
      entries.push({ id: `rule-${verb.id}`, separator: true });
      ruled = true;
    }
    entries.push({
      id: verb.id,
      label: verb.label,
      icon: verb.icon,
      danger: verb.danger,
      onSelect: () => run(verb.id),
      disabledReason: verb.disabledReason,
    });
  }
  return entries;
}
