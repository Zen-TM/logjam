import { beforeEach, describe, expect, it, vi } from "vitest";

const answers: boolean[] = [];
let activeId: string | null = null;
const finishTrackRecording = vi.fn(
  async (_id: string): Promise<string | null> => null,
);
const discardTrackRecording = vi.fn(async (_id: string) => {});

vi.mock("../ui", () => ({
  confirm: async () => answers.shift() ?? false,
}));
vi.mock("../auth/guestModePreference", () => ({
  readEntryChoice: () => "user",
}));
vi.mock("./recordingPreferences", () => ({
  markTrackBackupNoticeShown: vi.fn(),
  needsTrackBackupNotice: () => false,
}));
vi.mock("./trackBackup", () => ({
  retryTrackBackup: vi.fn(),
  TrackBackupError: class extends Error {},
}));
vi.mock("./trackRecorder", () => ({
  finishTrackRecording: (id: string) => finishTrackRecording(id),
  discardTrackRecording: (id: string) => discardTrackRecording(id),
  isActiveRecording: async (id: string) => activeId === id,
}));
vi.mock("./tracksDb", () => ({ getTrack: vi.fn(async () => null) }));
vi.mock("./tripTrackSource", () => ({ recordedTrackSource: vi.fn() }));

const { confirmDiscardRecording, confirmFinishRecording } = await import(
  "./finishRecordingPrompt"
);
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  answers.length = 0;
  activeId = "t1";
  finishTrackRecording.mockClear();
  discardTrackRecording.mockClear();
});

// Mutation that turns these red: drop the `isActiveRecording` check from
// either function, and a confirm queued behind another one acts on a track
// the first already finished or deleted.
describe("a confirm answered after the recording has ended", () => {
  it("does not discard a finished track", async () => {
    answers.push(true);
    activeId = null;
    confirmDiscardRecording("t1", vi.fn(), vi.fn());
    await settle();
    expect(discardTrackRecording).not.toHaveBeenCalled();
  });

  it("does not finish a discarded track", async () => {
    answers.push(true);
    activeId = null;
    confirmFinishRecording("t1");
    await settle();
    expect(finishTrackRecording).not.toHaveBeenCalled();
  });

  it("still acts on the recording that is still active", async () => {
    answers.push(true, true);
    const onDiscarded = vi.fn();
    confirmDiscardRecording("t1", onDiscarded, vi.fn());
    confirmFinishRecording("t1");
    await settle();
    expect(discardTrackRecording).toHaveBeenCalledWith("t1");
    expect(finishTrackRecording).toHaveBeenCalledWith("t1");
    expect(onDiscarded).toHaveBeenCalled();
  });
});
