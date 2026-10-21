import { describe, expect, it, vi } from "vitest";

vi.mock("react", () => ({ useSyncExternalStore: vi.fn() }));
vi.mock("../offline/freeSpace", () => ({ NotEnoughSpaceError: class {} }));
const cache = vi.hoisted(() => ({ downloadPlan: vi.fn() }));
vi.mock("./plansCache", () => cache);

const { onPlanDownloadToast, startPlanDownload } = await import(
  "./planDownloads"
);

describe("startPlanDownload", () => {
  // Mutation: drop the join. A second press, or the plan reopened, would run
  // a second loop over the same files.
  it("joins a plan's running download instead of starting another", async () => {
    let finish!: () => void;
    cache.downloadPlan.mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        finish = () => resolve(true);
      }),
    );
    const toasts: string[] = [];
    const off = onPlanDownloadToast(({ text }) => toasts.push(text));
    const first = startPlanDownload("p");
    const second = startPlanDownload("p");
    expect(second).toBe(first);
    expect(cache.downloadPlan).toHaveBeenCalledTimes(1);
    finish();
    await first;
    expect(toasts).toEqual(["Downloaded for the trip."]);
    off();
  });

  // Mutation: toast on any resolve, and a download the sign-out wipe stopped
  // says "Downloaded for the trip." on the sign-in screen.
  it("says nothing when the wipe stopped the download", async () => {
    cache.downloadPlan.mockResolvedValueOnce(false);
    const toasts: string[] = [];
    const off = onPlanDownloadToast(({ text }) => toasts.push(text));
    await startPlanDownload("q");
    expect(toasts).toEqual([]);
    off();
  });
});
