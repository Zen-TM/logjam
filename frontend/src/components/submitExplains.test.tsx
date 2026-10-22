import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../placeUtils", () => ({ recordConsent: vi.fn() }));

import { recordConsent } from "../placeUtils";
import ConsentGate from "./ConsentGate";
import RouteNameDialog from "./dialogs/RouteNameDialog";

afterEach(cleanup);

// shared/DESIGN.md §5: a submit is never disabled for validation — pressing it
// says what is missing. Mutation that turns these red: put `disabled={!agreed}`
// back on the gate's button, or `disabled={!canSave}` on the route name's Save.
describe("pressing a submit with something missing says what", () => {
  it("the consent gate asks for the tick, and records nothing", () => {
    render(
      <ConsentGate
        consentVersion="2026-09-28"
        onAccepted={vi.fn()}
        onSignOut={vi.fn()}
      />,
    );
    const agree = screen.getByRole("button", { name: "Agree and continue" });
    expect((agree as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(agree);
    expect(screen.getByRole("alert").textContent).toContain("Tick the box");
    expect(recordConsent).not.toHaveBeenCalled();
  });

  // Mutation: send CURRENT_CONSENT_VERSION instead of the consentVersion prop
  // from Agree: the server refuses any version but its own current one.
  it("the consent gate records the version the server named", () => {
    vi.mocked(recordConsent).mockResolvedValue({} as never);
    render(
      <ConsentGate
        consentVersion="2999-01-01"
        onAccepted={vi.fn()}
        onSignOut={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Agree and continue" }));
    expect(recordConsent).toHaveBeenCalledWith("2999-01-01");
  });

  it("the route name dialog names the blank field", () => {
    HTMLDialogElement.prototype.showModal ??= function () {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close ??= function () {
      this.removeAttribute("open");
    };
    const onSave = vi.fn();
    render(
      <RouteNameDialog open initialName="" onSave={onSave} onClose={vi.fn()} />,
    );
    const save = screen.getByRole("button", { name: "Save" });
    expect((save as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(save);
    expect(screen.getByRole("alert").textContent).toContain("Name is required");
    expect(onSave).not.toHaveBeenCalled();
  });
});
