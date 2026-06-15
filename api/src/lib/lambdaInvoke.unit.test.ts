import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("../services/awsClients", () => ({
  lambda: { send: vi.fn() },
}));
vi.mock("./env", () => ({
  getEnv: vi.fn(),
}));

import { lambda } from "../services/awsClients";
import { getEnv } from "./env";
import { invokeGeoPdfLambda } from "./lambdaInvoke";

const send = (lambda as unknown as { send: Mock }).send;
const getEnvMock = getEnv as unknown as Mock;

beforeEach(() => {
  send.mockReset();
  getEnvMock.mockReset();
});

describe("invokeGeoPdfLambda", () => {
  it("throws without sending when LAMBDA_GEO_PDF_FUNCTION is unset (local dev)", async () => {
    getEnvMock.mockReturnValue({ LAMBDA_GEO_PDF_FUNCTION: undefined });
    await expect(invokeGeoPdfLambda("job-1")).rejects.toThrow(/not configured/);
    expect(send).not.toHaveBeenCalled();
  });

  it("Event-invokes the configured function with the job ID payload on a 202", async () => {
    getEnvMock.mockReturnValue({ LAMBDA_GEO_PDF_FUNCTION: "logjam-geo-pdf-worker" });
    send.mockResolvedValue({ StatusCode: 202 });

    await expect(invokeGeoPdfLambda("job-1")).resolves.toBeUndefined();

    const input = send.mock.calls[0][0].input;
    expect(input.FunctionName).toBe("logjam-geo-pdf-worker");
    expect(input.InvocationType).toBe("Event");
    expect(JSON.parse(Buffer.from(input.Payload).toString())).toEqual({
      GEO_PDF_JOB_ID: "job-1",
    });
  });

  it("throws when the invoke is not accepted (non-202 status)", async () => {
    getEnvMock.mockReturnValue({ LAMBDA_GEO_PDF_FUNCTION: "fn" });
    send.mockResolvedValue({ StatusCode: 500 });
    await expect(invokeGeoPdfLambda("job-1")).rejects.toThrow(/not accepted/);
  });

  it("throws when the invoke reports a FunctionError", async () => {
    getEnvMock.mockReturnValue({ LAMBDA_GEO_PDF_FUNCTION: "fn" });
    send.mockResolvedValue({ StatusCode: 202, FunctionError: "Unhandled" });
    await expect(invokeGeoPdfLambda("job-1")).rejects.toThrow(/functionError=Unhandled/);
  });
});
