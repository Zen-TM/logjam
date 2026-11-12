import { describe, expect, it } from "vitest";
import {
  armBox,
  boxFor,
  boxPickDimsUI,
  endBox,
  isPicking,
  NO_BOX_PICK,
} from "./boxPick";

describe("the box tool, shared by a topo and an export", () => {
  // Map tools stay live during a pick, so the other product can be armed
  // over it. Mutation: let arming one leave the other armed, and a topo's box
  // goes to the export (or the export's to the topo).
  it("draws for the product armed last, and only for it", () => {
    const topoOverExport = armBox(armBox(NO_BOX_PICK, "export"), "topo");
    expect(boxFor(topoOverExport)).toBe("topo");
    expect(isPicking(topoOverExport, "export")).toBe(false);

    const exportOverTopo = armBox(armBox(NO_BOX_PICK, "topo"), "export");
    expect(boxFor(exportOverTopo)).toBe("export");
    expect(isPicking(exportOverTopo, "topo")).toBe(false);
  });

  // Mutation: let ending one product's pick end whichever is armed, and a
  // closed export dialog cancels a topo's pick.
  it("is off once the product it draws for is done", () => {
    expect(boxFor(endBox(armBox(NO_BOX_PICK, "export"), "export"))).toBeNull();
    expect(boxFor(endBox(armBox(NO_BOX_PICK, "topo"), "export"))).toBe("topo");
  });

  // The export dialog is hidden as a round trip while its box is drawn, so a
  // page that opens it then would reopen it on the stale form. Mutation: drop
  // the export from `boxPickDimsUI`.
  it("holds the pages still while it draws an export's box", () => {
    expect(boxPickDimsUI(armBox(NO_BOX_PICK, "export"))).toBe(true);
    // A topo's pick leaves them live.
    expect(boxPickDimsUI(armBox(NO_BOX_PICK, "topo"))).toBe(false);
    expect(boxPickDimsUI(NO_BOX_PICK)).toBe(false);
  });
});
