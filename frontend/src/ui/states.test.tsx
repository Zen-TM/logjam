import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button, ErrorState, LoadingState, Row, StatGrid, SwitchRow } from ".";

afterEach(cleanup);

// The kit's states that are LOGIC rather than looks (UX §4 and §5). The fills
// themselves are CSS (`.row:has(.open)`), so what is asserted here is what the
// CSS keys on: a row has a pressable element exactly when it can be pressed.
// Mutations that turn these red: make `Row` always render its `.open` button;
// drop `aria-disabled` from a Button that carries a reason; stop SwitchRow's
// row click from toggling.
describe("Row is pressable only when it does something", () => {
  it("has nothing to press when it has no onOpen and no href", () => {
    render(<Row title="Grade" subtitle="3B" trailing={<span>x</span>} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("is a button when it opens, and a link when it is one", () => {
    const onOpen = vi.fn();
    render(
      <>
        <Row title="Open me" onOpen={onOpen} />
        <Row title="Download me" href="/f.zip" />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open me" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "Download me" })).toBeTruthy();
  });

  it("does not answer a press while disabled", () => {
    const onOpen = vi.fn();
    render(
      <Row
        title="Later"
        subtitle="Needs a connection"
        disabled
        onOpen={onOpen}
      />,
    );
    const open = screen.getByRole("button", { name: "Later" });
    expect((open as HTMLButtonElement).disabled).toBe(true);
    expect(open.getAttribute("aria-describedby")).toBeTruthy();
  });
});

describe("SwitchRow is one switch whose whole row is the target", () => {
  it("exposes a single switch named by the title and flips on a press anywhere", () => {
    const onChange = vi.fn();
    render(
      <SwitchRow
        title="Show places"
        description="On the map"
        checked={false}
        onChange={onChange}
      />,
    );
    const switches = screen.getAllByRole("switch");
    expect(switches).toHaveLength(1);
    expect(switches[0].getAttribute("aria-labelledby")).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Show places" })).toBeTruthy();
    fireEvent.click(screen.getByText("On the map"));
    expect(onChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(switches[0]);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("answers nothing when disabled", () => {
    const onChange = vi.fn();
    render(
      <SwitchRow
        title="Sync"
        description="Needs an account"
        checked
        disabled
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByText("Needs an account"));
    fireEvent.click(screen.getByRole("switch", { name: "Sync" }));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("StatGrid presses only a stat that copies", () => {
  it("draws a button for a stat with onCopy and none for a read-out", () => {
    const onCopy = vi.fn();
    render(
      <StatGrid
        stats={[
          { label: "Grade", value: "3B" },
          { label: "Position", value: "-33.1, 150.2", onCopy },
        ]}
      />,
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]);
    expect(onCopy).toHaveBeenCalledTimes(1);
  });
});

describe("Button says why it is disabled", () => {
  it("stays focusable, does nothing on press and is described by the reason", () => {
    const onClick = vi.fn();
    render(
      <Button disabled disabledReason="Needs a connection" onClick={onClick}>
        Save
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Save" });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
    expect(
      document.getElementById(button.getAttribute("aria-describedby") as string)
        ?.textContent,
    ).toBe("Needs a connection");
  });

  it("is natively disabled when it has no reason, and while busy", () => {
    render(
      <>
        <Button disabled>Plain</Button>
        <Button busy disabledReason="ignored">
          Busy
        </Button>
      </>,
    );
    expect(
      (screen.getByRole("button", { name: "Plain" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Busy" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});

describe("loading and failed states", () => {
  it("announces a load as a status and a failure as an alert with Try again", () => {
    const onRetry = vi.fn();
    render(
      <>
        <LoadingState label="Loading your places…" />
        <ErrorState message="Couldn't load your places." onRetry={onRetry} />
      </>,
    );
    expect(screen.getByRole("status").textContent).toContain(
      "Loading your places…",
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "Couldn't load your places.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
