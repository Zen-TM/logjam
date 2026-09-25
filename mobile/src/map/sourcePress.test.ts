import { describe, expect, it, vi } from "vitest";
import type { NativeSyntheticEvent } from "react-native";

import { stopSourcePress } from "./sourcePress";

describe("stopSourcePress", () => {
  it("stops the tap reaching the map's own handler", () => {
    // Thin, but the thing it wraps is the whole fix: without the call the map
    // opens its "This point" sheet on top of whatever the source selected.
    const stopPropagation = vi.fn();
    stopSourcePress({ stopPropagation } as unknown as NativeSyntheticEvent<unknown>);
    expect(stopPropagation).toHaveBeenCalledOnce();
  });
});
