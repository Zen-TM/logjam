import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Checkbox } from "./Choice";

afterEach(cleanup);

describe("Checkbox", () => {
  // Mutation: drop `describedBy`, and a disabled checkbox's reason (a held
  // upload's, in the LiDAR form) never reaches a screen reader.
  it("is described by its own line and by the element it is given", () => {
    render(
      <>
        <p id="why">Kept for the upload that stopped.</p>
        <Checkbox
          label="Vegetation"
          description="Also draws the scrub."
          checked={false}
          disabled
          describedBy="why"
          onChange={() => {}}
        />
      </>,
    );
    const box = screen.getByRole("checkbox", { name: /^Vegetation/ });
    const ids = box.getAttribute("aria-describedby")!.split(" ");
    expect(ids).toContain("why");
    expect(ids).toHaveLength(2);
  });
});
