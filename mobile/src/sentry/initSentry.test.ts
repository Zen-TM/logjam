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

  // Mutation that turns it red: `beforeSend: (event) => event` or
  // `beforeBreadcrumb: (crumb) => crumb` in initSentry.ts, or
  // `sendDefaultPii: true`.
  it("hands Sentry the real scrubbers and keeps PII off", () => {
    initSentry();
    const options = init.mock.calls[0][0];
    expect(options.sendDefaultPii).toBe(false);
    const event = options.beforeSend({
      message: "no fix near -33.5621, 150.4017",
      extra: { latitude: -33.7, name: "Secret Falls" },
      user: { id: "u1" },
    });
    expect(JSON.stringify(event)).not.toMatch(/Secret Falls|150\.4017|-33\.7/);
    expect(event).not.toHaveProperty("user");
    const crumb = options.beforeBreadcrumb({
      category: "fetch",
      message: "GET https://x.test/tiles/12/2456/1578.png",
      data: { name: "Secret Falls" },
    });
    expect(JSON.stringify(crumb)).not.toMatch(/x\.test|Secret Falls|2456/);
  });

  // Mutation that turns it red: `tracesSampleRate: 1` (or any number above 0).
  it("stays crash-only: no performance tracing", () => {
    initSentry();
    expect(init.mock.calls[0][0].tracesSampleRate).toBe(0);
  });
});
