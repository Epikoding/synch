import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetObsidianMocks, setRequestUrlMock } from "../test-stubs/obsidian";
import { BillingClient, parseBillingStatus } from "./client";

describe("BillingClient", () => {
  beforeEach(() => {
    resetObsidianMocks();
  });

  it("reads billing status with the auth session bearer token", async () => {
    const requestUrl = vi.fn(async () => ({
      status: 200,
      json: {
        planId: "starter",
        billingInterval: "monthly",
        active: true,
        status: "active",
        cancelAtPeriodEnd: false,
        periodEnd: "2026-05-09T00:00:00.000Z",
      },
    }));
    setRequestUrlMock(requestUrl);

    await expect(
      new BillingClient().readBillingStatus("https://api.synch.test/", "session-token"),
    ).resolves.toEqual({
      planId: "starter",
      billingInterval: "monthly",
      active: true,
      status: "active",
      cancelAtPeriodEnd: false,
      periodEnd: "2026-05-09T00:00:00.000Z",
    });

    expect(requestUrl).toHaveBeenCalledWith({
      url: "https://api.synch.test/v1/billing/status",
      method: "GET",
      throw: false,
      headers: {
        accept: "application/json",
        authorization: "Bearer session-token",
      },
    });
  });

  it("rejects invalid billing status responses", () => {
    expect(() => parseBillingStatus({
      planId: "starter",
      billingInterval: "weekly",
      active: true,
      status: "active",
      cancelAtPeriodEnd: false,
      periodEnd: null,
    })).toThrow("invalid billing status response");
  });
});
