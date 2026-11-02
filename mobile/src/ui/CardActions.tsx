import {
  Children,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { View } from "react-native";

import { spacing } from "../theme";
import type { Button } from "./Button";

type ButtonProps = React.ComponentProps<typeof Button>;

// THE BUTTONS IN A CARD'S FOOTER SHARE ITS FULL WIDTH EQUALLY (shared/DESIGN.md
// §9): two get half each, one takes the whole width. A full-width target is the
// one that survives cold hands, and it reads as belonging to the card it fills.
// Three or more stack, each full width: a third of a phone wraps every label.
// Pass `Button`s as children; they are grown and made compact here, so a screen
// never lays the row out itself (guard: `cardActions.test.ts`).
export function CardActions({ children }: { children: ReactNode }) {
  const stacked = Children.toArray(children).filter(isValidElement).length > 2;
  return (
    <View
      style={{ flexDirection: stacked ? "column" : "row", gap: spacing(1) }}
    >
      {Children.map(children, (child) =>
        isValidElement(child)
          ? cloneElement(child as ReactElement<ButtonProps>, {
              compact: true,
              grow: true,
            })
          : null,
      )}
    </View>
  );
}
