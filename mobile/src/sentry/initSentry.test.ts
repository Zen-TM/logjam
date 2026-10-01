import { beforeEach, describe, expect, it, vi } from "vitest";

const init = vi.fn();
vi.mock("@sentry/react-native", () => ({ init }));
vi.mock("./crashReportPreference", () => ({
  areCrashReportsEnabled: () => true,
  readCrashReportChoice: () => "on",
  setCrashReportsEnabled: vi.fn(),
}));

const { initSentry } = await import("./initSentry");

describe("initSentry privacy options", () => {
  beforeEach(() => {
    init.mockClear();
    process.env.EXPO_PUBLIC_SENTRY_DSN =
      "https://key@example.ingest.sentry.io/1";
  });

  // The native iOS SDK's own HTTP breadcrumbs carry raw tile URLs and reach a
  // native crash report without passing beforeBreadcrumb or beforeSend.
  // Mutation: deleting `enableNetworkBreadcrumbs: false` from initSentry.ts.
  it("turns off the native network breadcrumbs", () => {
    initSentry();
    expect(init).toHaveBeenCalledTimes(1);
    expect(init.mock.calls[0][0]).toMatchObject({
      enableNetworkBreadcrumbs: false,
    });
  });

  it("keeps the JS scrubbers and PII off wired", () => {
    initSentry();
    const options = init.mock.calls[0][0];
    expect(options.sendDefaultPii).toBe(false);
    expect(options.beforeSend).toBeTypeOf("function");
    expect(options.beforeBreadcrumb).toBeTypeOf("function");
  });
});
