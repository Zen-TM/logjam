import { describe, it, expect } from "vitest";
import { MEDIA_SIZE_CAPS } from "@logjam/shared";
import { AppError } from "../middleware/errorHandler";
import { validateUploadSizes } from "./mediaUploadValidation";

function catchErr(fn: () => unknown): AppError {
  try {
    fn();
  } catch (e) {
    return e as AppError;
  }
  throw new Error("expected validateUploadSizes to throw");
}

describe("validateUploadSizes", () => {
  it("accepts a valid image with thumbnail", () => {
    expect(validateUploadSizes("image", 1024, 256)).toEqual({
      sizeBytes: 1024,
      thumbnailSizeBytes: 256,
    });
  });

  it("accepts a track without thumbnail (null normalised)", () => {
    expect(validateUploadSizes("track", 512, undefined)).toEqual({
      sizeBytes: 512,
      thumbnailSizeBytes: null,
    });
    expect(validateUploadSizes("track", 512, null)).toEqual({
      sizeBytes: 512,
      thumbnailSizeBytes: null,
    });
  });

  it("accepts sizes at exactly the category cap", () => {
    const out = validateUploadSizes(
      "video",
      MEDIA_SIZE_CAPS.video,
      MEDIA_SIZE_CAPS.image,
    );
    expect(out.sizeBytes).toBe(MEDIA_SIZE_CAPS.video);
  });

  it.each([
    ["missing", undefined],
    ["null", null],
    ["zero", 0],
    ["negative", -5],
    ["non-integer", 10.5],
    ["string", "100"],
  ])("400s when sizeBytes is %s", (_label, value) => {
    const err = catchErr(() => validateUploadSizes("image", value, 256));
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(400);
  });

  it("413s when sizeBytes exceeds the category cap", () => {
    const err = catchErr(() =>
      validateUploadSizes("image", MEDIA_SIZE_CAPS.image + 1, 256),
    );
    expect(err.statusCode).toBe(413);
  });

  it("400s when a thumbnail-bearing category omits thumbnailSizeBytes", () => {
    const err = catchErr(() => validateUploadSizes("image", 1024, undefined));
    expect(err.statusCode).toBe(400);
  });

  it("400s when a track declares a thumbnail", () => {
    const err = catchErr(() => validateUploadSizes("track", 1024, 256));
    expect(err.statusCode).toBe(400);
  });

  it("413s when the thumbnail exceeds the image cap", () => {
    const err = catchErr(() =>
      validateUploadSizes("video", 1024, MEDIA_SIZE_CAPS.image + 1),
    );
    expect(err.statusCode).toBe(413);
  });
});
