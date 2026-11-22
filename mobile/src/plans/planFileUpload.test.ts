import { beforeEach, describe, expect, it, vi } from "vitest";
import { uploadPlanFile } from "./planFileUpload";

const io = vi.hoisted(() => ({
  presignPlanFile: vi.fn(),
  confirmPlanFile: vi.fn(),
  uploadToPresignedUrl: vi.fn(),
  afterPlanWrite: vi.fn(),
  calls: [] as string[],
}));
vi.mock("./plansApi", () => ({
  presignPlanFile: io.presignPlanFile,
  confirmPlanFile: io.confirmPlanFile,
}));
vi.mock("./plansCache", () => ({ afterPlanWrite: io.afterPlanWrite }));
vi.mock("../api/presignedTransfer", () => ({
  uploadToPresignedUrl: io.uploadToPresignedUrl,
}));

const file = {
  uri: "file:///scratch/a.gpx",
  sizeBytes: 123,
  filename: "Ridge.gpx",
  mediaType: "application/gpx+xml",
  displayName: "Ridge",
  metadata: { bbox: [1, 2, 3, 4], featureCount: 1, positionCount: 9 },
};

beforeEach(() => {
  vi.clearAllMocks();
  io.calls.length = 0;
  io.presignPlanFile.mockImplementation(async () => {
    io.calls.push("presign");
    return { mediaId: "m1", displayUploadUrl: "https://s3/put" };
  });
  io.uploadToPresignedUrl.mockImplementation(async () => {
    io.calls.push("put");
    return { status: 200 };
  });
  io.confirmPlanFile.mockImplementation(async () => {
    io.calls.push("confirm");
    return { item: {} };
  });
});

describe("uploadPlanFile", () => {
  // Mutation: skip the PUT, and the API finds no file in storage.
  it("presigns, puts the file, confirms, then refreshes the plan", async () => {
    await uploadPlanFile("p", file);
    expect(io.calls).toEqual(["presign", "put", "confirm"]);
    expect(io.presignPlanFile).toHaveBeenCalledWith("p", {
      filename: "Ridge.gpx",
      mediaType: "application/gpx+xml",
      displayName: "Ridge",
      metadata: file.metadata,
      sizeBytes: 123,
    });
    expect(io.uploadToPresignedUrl).toHaveBeenCalledWith(
      "https://s3/put",
      "file:///scratch/a.gpx",
      { "Content-Type": "application/gpx+xml" },
    );
    expect(io.confirmPlanFile).toHaveBeenCalledWith("p", "m1", {
      filename: "Ridge.gpx",
      mediaType: "application/gpx+xml",
      displayName: "Ridge",
      metadata: file.metadata,
    });
    expect(io.afterPlanWrite).toHaveBeenCalledWith("p");
  });

  // Mutation: ignore the PUT's status, and a refused upload is confirmed.
  it("does not confirm a PUT that storage refused", async () => {
    io.uploadToPresignedUrl.mockResolvedValue({ status: 403 });
    await expect(uploadPlanFile("p", file)).rejects.toThrow("403");
    expect(io.confirmPlanFile).not.toHaveBeenCalled();
    expect(io.afterPlanWrite).not.toHaveBeenCalled();
  });
});
