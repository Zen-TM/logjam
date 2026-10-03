// Place status identity for the Places screen: the shared label and hue, plus
// the Feather glyph this client draws it with. The status rule, the labels and
// the row summary live in `@logjam/shared` (`placeStatus.ts`), so Logjam GPS
// and Logjam Web cannot disagree about what "Visited" means.
import { PLACE_STATUS_LABELS, type PlaceStatus } from "@logjam/shared";

import { placeHue } from "../theme";
import { type Glyph } from "../ui";

export type PlaceStatusMeta = {
  /** Rail chip label. */
  label: string;
  icon: Glyph;
  hue: string;
};

export const PLACE_STATUS_META: Record<PlaceStatus, PlaceStatusMeta> = {
  done: {
    label: PLACE_STATUS_LABELS.done,
    icon: "success",
    hue: placeHue.done,
  },
  todo: {
    label: PLACE_STATUS_LABELS.todo,
    icon: "place",
    hue: placeHue.todo,
  },
  shared: {
    label: PLACE_STATUS_LABELS.shared,
    icon: "friends",
    hue: placeHue.shared,
  },
};
