import { describe, expect, it, vi } from "vitest";

import type { HttpClient } from "../http/request";
import {
  compareStrictSemver,
  SYNCH_PLUGIN_UPDATE_MANIFEST_URL,
  SynchPluginUpdateChecker,
} from "./update-checker";

describe("compareStrictSemver", () => {
  it("compares newer, equal, and older versions", () => {
    expect(compareStrictSemver("1.2.4", "1.2.3")).toBeGreaterThan(0);
    expect(compareStrictSemver("1.2.3", "1.2.3")).toBe(0);
    expect(compareStrictSemver("1.2.3", "1.3.0")).toBeLessThan(0);
  });

  it("rejects malformed versions", () => {
    expect(() => compareStrictSemver("1.2", "1.2.3")).toThrow(
      "Expected strict x.y.z versions.",
    );
    expect(() => compareStrictSemver("1.2.3-beta.1", "1.2.3")).toThrow(
      "Expected strict x.y.z versions.",
    );
    expect(() => compareStrictSemver("01.2.3", "1.2.3")).toThrow(
      "Expected strict x.y.z versions.",
    );
  });
});

describe("SynchPluginUpdateChecker", () => {
  it("reports an available update from the main branch manifest", async () => {
    const request = vi.fn(async () => ({
      status: 200,
      json: { version: "0.0.2" },
    }));
    const checker = new SynchPluginUpdateChecker({ request } satisfies HttpClient);

    await expect(checker.check("0.0.1")).resolves.toEqual({
      state: "update_available",
      currentVersion: "0.0.1",
      latestVersion: "0.0.2",
    });
    expect(request).toHaveBeenCalledWith({
      url: SYNCH_PLUGIN_UPDATE_MANIFEST_URL,
    });
  });

  it("reports up to date when the remote version is equal or older", async () => {
    const request = vi.fn(async () => ({
      status: 200,
      json: { version: "0.0.1" },
    }));
    const checker = new SynchPluginUpdateChecker({ request } satisfies HttpClient);

    await expect(checker.check("0.0.2")).resolves.toEqual({
      state: "up_to_date",
      currentVersion: "0.0.2",
      latestVersion: "0.0.1",
    });
  });

  it("fails on network errors and non-2xx responses", async () => {
    await expect(
      new SynchPluginUpdateChecker({
        request: vi.fn(async () => {
          throw new Error("offline");
        }),
      }).check("0.0.1"),
    ).rejects.toThrow("offline");

    await expect(
      new SynchPluginUpdateChecker({
        request: vi.fn(async () => ({
          status: 404,
          json: {},
        })),
      }).check("0.0.1"),
    ).rejects.toThrow("GitHub manifest request failed with status 404.");
  });

  it("fails on malformed manifests and versions", async () => {
    await expect(
      new SynchPluginUpdateChecker({
        request: vi.fn(async () => ({
          status: 200,
          json: {},
        })),
      }).check("0.0.1"),
    ).rejects.toThrow("GitHub manifest does not contain a version.");

    await expect(
      new SynchPluginUpdateChecker({
        request: vi.fn(async () => ({
          status: 200,
          json: { version: "0.0.2-beta.1" },
        })),
      }).check("0.0.1"),
    ).rejects.toThrow("Invalid GitHub manifest version: 0.0.2-beta.1");

    await expect(
      new SynchPluginUpdateChecker({
        request: vi.fn(async () => ({
          status: 200,
          json: { version: "0.0.2" },
        })),
      }).check("0.0"),
    ).rejects.toThrow("Invalid current plugin version: 0.0");
  });
});
