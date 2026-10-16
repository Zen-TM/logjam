import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import GeoPdfsPanel from "./GeoPdfsPanel";

// What the panel asked the API for, and whether it handed the consent gate's
// value to the job poll.
const seen = vi.hoisted(() => ({
  paths: [] as string[],
  jobPollEnabled: [] as boolean[],
}));

const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock("../../feedback/ToastProvider", () => ({ useToast: () => toast }));

vi.mock("../../../placeUtils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../placeUtils")>()),
  apiFetch: (path: string) => {
    seen.paths.push(path);
    return Promise.resolve([]);
  },
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
  seen.paths = [];
  seen.jobPollEnabled = [];
});

function renderPanel(loadsUserData: boolean) {
  return render(
    <GeoPdfsPanel
      views={null}
      friends={[]}
      onOpenGeoPdf={() => {}}
      onOpenGeoPdfWithTemplate={() => {}}
      onEditGeoPdfTemplate={() => {}}
      onCreateGeoPdfTemplate={() => {}}
      refetchTrigger={0}
      geoPdfJobsRefetch={0}
      loadsUserData={loadsUserData}
    />,
  );
}

// FECO-005: the gate held App's own hooks, but this panel fetched anyway —
// `useGeoPdfJobs(true)` polled the job list and an ungated effect loaded the
// templates, both behind a consent screen the user had not answered.
// Mutation: run the job poll with `true`, or drop the `loadsUserData` guard
// from the templates effect.
describe("GeoPdfsPanel holds its fetches until the consent gate settles", () => {
  it("asks for nothing while the gate is unsettled", () => {
    renderPanel(false);

    expect(seen.jobPollEnabled).not.toContain(true);
    expect(seen.paths).toEqual([]);
  });

  it("polls the jobs and loads the templates once it settles", async () => {
    renderPanel(true);

    expect(seen.jobPollEnabled).toContain(true);
    await waitFor(() => expect(seen.paths).toContain("/geo-pdf-templates"));
  });
});
