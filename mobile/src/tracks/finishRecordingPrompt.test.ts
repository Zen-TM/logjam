// What finishing a recording says, and what it offers next. Everything the
// module reaches for is mocked: what is under test is the wording and the
// threshold for the "Log a trip" offer.
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  confirmFinishRecording,
  onLogTripRequest,
  onRecordingToast,
} from "./finishRecordingPrompt";

const state = vi.hoisted(() => ({
  guest: false,
  noticeDue: false,
  pointCount: 10,
  mediaId: "media-1" as string | null,
}));

vi.mock("../ui", () => ({ confirm: vi.fn(async () => true) }));
vi.mock("../auth/guestModePreference", () => ({
  readEntryChoice: () => (state.guest ? "guest" : "account"),
}));
vi.mock("./recordingPreferences", () => ({
  needsTrackBackupNotice: () => state.noticeDue,
  markTrackBackupNoticeShown: vi.fn(),
}));
vi.mock("./trackBackup", () => ({
  retryTrackBackup: vi.fn(),
  TrackBackupError: class extends Error {},
}));
vi.mock("./trackRecorder", () => ({
  finishTrackRecording: vi.fn(async () => state.mediaId),
  isActiveRecording: vi.fn(async () => true),
}));
vi.mock("./tracksDb", () => ({
  getTrack: vi.fn(async () => ({ id: "t1", pointCount: state.pointCount })),
}));
vi.mock("./tripTrackSource", () => ({
  recordedTrackSource: (track: { id: string }) => ({ name: track.id }),
}));

type Toast = { text: string; action?: { label: string; onPress: () => void } };

async function finish(): Promise<Toast> {
  let toast: Toast | undefined;
  const off = onRecordingToast((message) => (toast = message));
  confirmFinishRecording("t1");
  await vi.waitFor(() => expect(toast).toBeDefined());
  off();
  return toast as Toast;
}

beforeEach(() => {
  state.guest = false;
  state.noticeDue = false;
  state.pointCount = 10;
  state.mediaId = "media-1";
});

describe("finishing a recording", () => {
  it("says it is saved and offers Log a trip", async () => {
    const toast = await finish();
    expect(toast.text).toBe("Recording saved.");
    expect(toast.action?.label).toBe("Log a trip");
  });

  it("hands the recording to whoever opens the form when the offer is pressed", async () => {
    const asked: unknown[] = [];
    const off = onLogTripRequest((track) => asked.push(track));
    (await finish()).action?.onPress();
    off();
    expect(asked).toEqual([{ name: "t1" }]);
  });

  // Mutation: change `>= 2` to `>= 1` in announceFinished and this goes red.
  it("offers nothing for a recording with under 2 points: nothing to attach", async () => {
    state.pointCount = 1;
    expect((await finish()).action).toBeUndefined();
  });

  // Mutation: drop `queued &&` from `notice` and the unqueued case reads the
  // backup notice.
  it("says where it went on the first queued recording, keeping the offer", async () => {
    state.noticeDue = true;
    const toast = await finish();
    expect(toast.text).toBe(
      "Saved on this phone. It goes up when you have signal.",
    );
    expect(toast.action?.label).toBe("Log a trip");
  });

  it("does not claim a backup for a guest, or for a recording that was not queued", async () => {
    state.noticeDue = true;
    state.guest = true;
    expect((await finish()).text).toBe("Recording saved.");
    state.guest = false;
    state.mediaId = null;
    expect((await finish()).text).toBe("Recording saved.");
  });
});
