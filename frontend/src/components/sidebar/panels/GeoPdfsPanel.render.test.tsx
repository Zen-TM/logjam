import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import GeoPdfsPanel from "./GeoPdfsPanel";

// Whether the panel handed the consent gate's value to the job poll.
const seen = vi.hoisted(() => ({ jobPollEnabled: [] as boolean[] }));

const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock("../../feedback/ToastProvider", () => ({ useToast: () => toast }));

vi.mock("../../../placeUtils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../placeUtils")>()),
  useGeoPdfJobs: (enabled: boolean) => {
    seen.jobPollEnabled.push(enabled);
    return {
      jobs: [],
      total: null,
      loaded: false,
      error: null,
      refetch: () => {},
    };
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  seen.jobPollEnabled = [];
});

function renderPanel(loadsUserData: boolean) {
  return render(
    <GeoPdfsPanel
      views={null}
      friends={[]}
      onOpenGeoPdf={() => {}}
      geoPdfJobsRefetch={0}
      loadsUserData={loadsUserData}
    />,
  );
}

// The consent gate held App's own hooks, but this panel polled the job list
// anyway, behind a consent screen the user had not answered.
// Mutation: run the job poll with `true`.
describe("GeoPdfsPanel holds its fetches until the consent gate settles", () => {
  it("asks for nothing while the gate is unsettled", () => {
    renderPanel(false);

    expect(seen.jobPollEnabled).not.toContain(true);
  });

  it("polls the jobs once it settles", () => {
    renderPanel(true);

    expect(seen.jobPollEnabled).toContain(true);
  });
});
