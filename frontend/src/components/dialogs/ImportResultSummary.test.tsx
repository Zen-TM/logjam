import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import ImportResultSummary from "./ImportResultSummary";

afterEach(cleanup);

// Mutation that turns this red: render skippedRows under "Left empty" again.
it("lists dropped rows under their own heading, apart from left-empty fields", () => {
  render(
    <ImportResultSummary
      headline={[{ count: 3, label: "created" }]}
      skippedRows={["Row 4: latitude couldn't be read — skipped"]}
      warnings={["Row 2: depth was left empty"]}
    />,
  );
  expect(screen.getByText("Skipped rows")).toBeTruthy();
  expect(screen.getByText("Left empty")).toBeTruthy();
});
