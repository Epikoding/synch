import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  Plugin,
  resetObsidianMocks,
  setRequestUrlMock,
} from "../test-stubs/obsidian";
import { SynchPluginController } from "./plugin-controller";

const TestPlugin = Plugin as unknown as new () => Plugin;

describe("SynchPluginController plugin update check", () => {
  beforeEach(() => {
    resetObsidianMocks();
  });

  it("deduplicates in-flight update checks", async () => {
    let resolveRequest: ((value: unknown) => void) | null = null;
    const request = vi.fn(
      async () =>
        await new Promise((resolve) => {
          resolveRequest = resolve;
        }),
    );
    setRequestUrlMock(request);

    const controller = new SynchPluginController({
      plugin: new TestPlugin(),
      refreshUi: vi.fn(),
    });

    const firstCheck = controller.ensurePluginUpdateCheck();
    const secondCheck = controller.ensurePluginUpdateCheck();

    expect(controller.getPluginUpdateStatus()).toEqual({
      state: "checking",
      currentVersion: "0.0.1",
    });
    expect(request).toHaveBeenCalledTimes(1);

    resolveRequest?.({
      status: 200,
      json: { version: "0.0.2" },
    });
    await Promise.all([firstCheck, secondCheck]);

    expect(request).toHaveBeenCalledTimes(1);
    expect(controller.getPluginUpdateStatus()).toEqual({
      state: "update_available",
      currentVersion: "0.0.1",
      latestVersion: "0.0.2",
    });
  });

  it("stores failed update checks for settings rendering", async () => {
    setRequestUrlMock(
      vi.fn(async () => ({
        status: 200,
        json: {},
      })),
    );
    const controller = new SynchPluginController({
      plugin: new TestPlugin(),
      refreshUi: vi.fn(),
    });

    await controller.ensurePluginUpdateCheck();

    expect(controller.getPluginUpdateStatus()).toEqual({
      state: "failed",
      currentVersion: "0.0.1",
      error: "GitHub manifest does not contain a version.",
    });
  });
});
